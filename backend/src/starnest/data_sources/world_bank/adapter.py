"""The World Bank as a `SourceAdapter`: one HTTP call per attribute, values out.

**One call carries all three series.** A WGI dimension is published as an estimate plus two
series describing how solid it is, and the v2 API accepts them semicolon-separated in a single
request -- so the provenance costs nothing extra to collect.

**Every figure is `high` confidence, and the provenance says why it might not deserve to be.**
Unlike Eurostat, the World Bank flags nothing here as provisional: all 32 candidates carry a
settled figure from an official international source. But the estimates are not equally solid --
Liechtenstein's rests on 4 underlying sources, Germany's on 13 -- and rather than invent a cut
point where a `high` becomes a `medium`, the source count and standard error are written into
the quote, where a reader sees them beside the number. **A threshold chosen before there is a
distribution to choose it against is a made-up number wearing a rigorous face**; this keeps the
signal until there is a reason to act on it (`docs/d6-scale-anchors.md` takes the same line on
scale anchors).

**Nothing is filled in.** A country the World Bank has no figure for produces no value: no zero,
no last year's number, no neighbour's. That gap travels to the ranking as coverage.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime

import httpx
from pydantic import ValidationError

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    DataSourceId,
    Index,
    IndexParameters,
    Measurements,
    ReferencePeriod,
    Value,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.world_bank.manifest import (
    BASE_URL,
    INDICATORS,
    MOST_RECENT_NON_EMPTY,
    WGI_DATABANK,
    GovernanceIndicator,
)
from starnest.data_sources.world_bank.response import Reading, WorldBankError, readings

WORLD_BANK = DataSourceId("world_bank")

ROWS_PER_COUNTRY = 3
"""Estimate, source count, standard error. Used to size the request so it comes back whole."""


class WorldBankAdapter(SourceAdapter):
    """The v2 indicator API, which is free, unauthenticated and returns JSON."""

    def __init__(self, client: httpx.AsyncClient, *, base_url: str = BASE_URL) -> None:
        self._client = client
        self._base_url = base_url

    @property
    def data_source(self) -> DataSourceId:
        return WORLD_BANK

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return tuple(INDICATORS)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        indicator = INDICATORS.get(attribute.id)
        if indicator is None:
            return Acquired(
                failures=(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        reason=f"the world bank publishes no series for {attribute.id} in this "
                        "adapter",
                    ),
                )
            )

        askable, failures = _split_by_whether_we_can_ask(attribute.id, candidates)
        if not askable:
            return Acquired(failures=tuple(failures))

        try:
            document = await self._get(indicator, askable)
            reported = readings(document)
        except httpx.HTTPStatusError as refused:
            return Acquired(failures=(*failures, _a_failure(attribute.id, str(refused))))
        except (httpx.HTTPError, WorldBankError) as unreachable:
            return Acquired(failures=(*failures, _a_failure(attribute.id, str(unreachable))))

        found = self._values_from(reported, indicator, attribute, askable)
        return Acquired(values=found.values, failures=(*failures, *found.failures))

    async def _get(self, indicator: GovernanceIndicator, candidates: Sequence[Candidate]) -> object:
        """All three series for every country, in one request.

        `per_page` is sized to the answer rather than left at the default 50, and the decoder
        refuses a split result -- between them, a response cannot come back quietly truncated.
        """
        countries = ";".join(str(candidate.country_code) for candidate in candidates)
        response = await self._client.get(
            f"{self._base_url}/country/{countries}/indicator/{';'.join(indicator.series)}",
            params={
                "format": "JSON",
                "source": WGI_DATABANK,
                "mrnev": MOST_RECENT_NON_EMPTY,
                "per_page": str(len(candidates) * ROWS_PER_COUNTRY),
            },
        )
        response.raise_for_status()
        return response.json()

    def _values_from(
        self,
        reported: Sequence[Reading],
        indicator: GovernanceIndicator,
        attribute: Attribute,
        candidates: Sequence[Candidate],
    ) -> Acquired:
        measuring = Measurements(
            attribute=attribute, data_source=WORLD_BANK, retrieved=datetime.now(UTC)
        )
        by_country: dict[str, dict[str, Reading]] = {}
        for reading in reported:
            by_country.setdefault(reading.country, {})[reading.series] = reading

        bounds = _the_scale_of(attribute)

        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        for candidate in candidates:
            series = by_country.get(str(candidate.country_code), {})
            estimate = series.get(indicator.estimate)
            if estimate is None:
                # Not a failure. The World Bank simply has nothing for this country, which must
                # reach the ranking as coverage rather than as an error somebody has to triage.
                continue
            try:
                values.append(
                    _a_value(
                        estimate,
                        bounds=bounds,
                        certainty=_Certainty(
                            sources=series.get(indicator.source_count),
                            standard_error=series.get(indicator.standard_error),
                        ),
                        measuring=measuring,
                        candidate=candidate,
                    )
                )
            except ValidationError as outside_its_scale:
                # The catalog's bounds come from the World Bank's own documentation, which says
                # "approx. -2.5 to +2.5" -- so a figure outside them is the source doing
                # something its documentation did not promise, not a fault of ours. Recorded and
                # the run continues, because one odd country must not cost the other 31.
                failures.append(
                    _a_failure(
                        attribute.id, _the_reason(outside_its_scale), candidate=str(candidate.id)
                    )
                )
        return Acquired(values=tuple(values), failures=tuple(failures))


class _Certainty:
    """What the World Bank says about how solid one estimate is.

    Either part may be absent -- the series are requested together but arrive independently --
    and the sentence adapts rather than printing "None sources".
    """

    __slots__ = ("sources", "standard_error")

    def __init__(self, sources: Reading | None, standard_error: Reading | None) -> None:
        self.sources = sources
        self.standard_error = standard_error

    def described(self) -> str:
        parts = []
        if self.sources is not None:
            counted = int(self.sources.figure)
            parts.append(f"{counted} underlying source{'' if counted == 1 else 's'}")
        if self.standard_error is not None:
            parts.append(f"standard error {self.standard_error.figure}")
        return f" ({', '.join(parts)})" if parts else ""


def _split_by_whether_we_can_ask(
    attribute: AttributeId, candidates: Sequence[Candidate]
) -> tuple[tuple[Candidate, ...], tuple[AcquisitionFailure, ...]]:
    """Candidates the request can name, and a failure for each one it cannot.

    Separated before the call rather than filtered during it: a candidate with no country code
    cannot be asked about, and building a URL with an empty segment would ask the World Bank for
    every country on earth instead.
    """
    askable = tuple(c for c in candidates if c.country_code is not None)
    unaskable = tuple(
        _a_failure(
            attribute,
            "the candidate carries no country code to ask the world bank for",
            candidate=str(c.id),
        )
        for c in candidates
        if c.country_code is None
    )
    return askable, unaskable


def _a_failure(
    attribute: AttributeId, reason: str, candidate: str | None = None
) -> AcquisitionFailure:
    return AcquisitionFailure(attribute=attribute, reason=reason, candidate=candidate)


def _a_value(
    estimate: Reading,
    *,
    bounds: IndexParameters,
    certainty: _Certainty,
    measuring: Measurements,
    candidate: Candidate,
) -> Value:
    return measuring.figure(
        candidate=candidate,
        period=_whole_year(estimate.period),
        payload=Index(
            value=estimate.figure,
            provider=bounds.provider,
            scale_min=bounds.scale_min,
            scale_max=bounds.scale_max,
        ),
        quote=f"World Bank WGI {estimate.period}: {estimate.figure}{certainty.described()}",
    )


def _whole_year(period: str) -> ReferencePeriod:
    """A WGI estimate describes a whole year, and both ends of it are recorded.

    The reference period is what the data describes; the retrieval date is when we fetched it,
    and the two are never merged (`reqs.md` 3.6).
    """
    year = int(period)
    return ReferencePeriod(start=date(year, 1, 1), end=date(year, 12, 31))


def _the_scale_of(attribute: Attribute) -> IndexParameters:
    """The bounds the catalog publishes this attribute on, resolved once for the whole fetch.

    **Before the loop, not inside it.** An `Index` attribute with no bounds is a broken catalog
    rather than a failed fetch, so it raises -- loudly, and once -- instead of being recorded 32
    times as though the World Bank had done something wrong. Reading it here also keeps the
    per-candidate `except ValueError` narrow enough to mean one thing.
    """
    bounds = attribute.index_parameters
    if bounds is None:
        raise ValueError(f"{attribute.id} is an Index and the catalog gives it no scale")
    return bounds


def _the_reason(refused: ValidationError) -> str:
    """The domain error out of Pydantic's wrapper, so a failure reads as a sentence.

    `starnest.data` documents the arrangement: `MalformedPayloadError` arrives wrapped in a
    `ValidationError` and the original is recoverable from the context. Without this, the
    recorded reason would be a paragraph of Pydantic diagnostics with the sentence buried in it.
    """
    first = refused.errors()[0]
    original = first.get("ctx", {}).get("error")
    return str(original) if original is not None else str(first.get("msg", refused))
