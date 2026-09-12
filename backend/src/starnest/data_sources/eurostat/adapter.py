"""Eurostat as a `SourceAdapter`: one HTTP call per attribute, values out.

**The most recent year each country actually reported**, per country, independently. Eurostat
publishes on its own timetable and a country that reported in 2024 sits beside one whose latest
is 2022 -- so taking "the latest year" as a single figure for the whole dataset would silently
drop every country that had not filed yet. Each country brings back its own newest figure, and
the reference period says which year that was.

**Nothing is filled in.** A country the response has no figure for produces no value: no zero,
no last year's number carried forward for another country's benefit, no neighbour's. That gap
travels all the way to the ranking as coverage, which is the number `reqs.md` 5.3 exists to
make visible.

**Confidence follows Eurostat's own flag.** An unflagged figure from an official statistical
agency is `high`; one Eurostat marks provisional or estimated is `medium`, because a figure its
publisher has not settled is not one we should present as settled. The rule is Eurostat's
judgement read off, never ours invented (`reqs.md` 5.7).
"""

from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime
from decimal import Decimal

import httpx

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    DataSourceId,
    Measurements,
    Quantity,
    Ratio,
    ReferencePeriod,
    Value,
    ValuePayload,
    ValueType,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.eurostat.geography import eurostat_code_for
from starnest.data_sources.eurostat.jsonstat import (
    JsonStatError,
    Observation,
    observations,
)
from starnest.data_sources.eurostat.manifest import (
    BASE_URL,
    QUERIES,
    EurostatDensity,
    EurostatShare,
)
from starnest.data_sources.transport import JsonOverHttp, SourceUnavailableError, a_failure

EUROSTAT = DataSourceId("eurostat")

UNSETTLED_FLAGS = frozenset({"p", "e"})
"""Provisional and estimated. Eurostat's own marks that a figure is not yet settled."""

TOO_LARGE_TO_ANSWER_NOW = 413
"""Eurostat's "your request will be treated asynchronously; try again later".

Documented as a 413 carrying a `warning` rather than an `error` (the API guidelines), and it is
not a failure of the request -- the same request will answer once the extraction is prepared.
Reported in those words so a retry is an obvious next step rather than a guess.
"""


class EurostatAdapter(SourceAdapter):
    """The dissemination API, which is free, unauthenticated and returns JSON-stat.

    **The whole series is fetched, not the recent periods.** The API offers `lastTimePeriod` and
    it would shrink every response, and it would also be wrong here: countries publish on their
    own timetables, and of the 31 that answer `ilc_lvho07a` today, three have newest figures
    from 2018, 2020 and 2024 rather than 2025. Trimming to the last few periods would turn those
    three into `insufficient_data` -- a smaller request buying a quieter, worse answer.
    """

    def __init__(self, client: httpx.AsyncClient, *, base_url: str = BASE_URL) -> None:
        self._endpoint = JsonOverHttp(client, base_url=base_url, explain=_why)

    @property
    def data_source(self) -> DataSourceId:
        return EUROSTAT

    @property
    def attributes(self) -> tuple:
        return tuple(QUERIES)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        query = QUERIES.get(attribute.id)
        if query is None:
            return Acquired(
                failures=(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        reason=f"eurostat publishes no series for {attribute.id} in this adapter",
                    ),
                )
            )
        try:
            if isinstance(query, EurostatShare):
                reported, describe = await self._shares(query)
            elif isinstance(query, EurostatDensity):
                reported, describe = await self._densities(query)
            else:
                reported = observations(await self._get(query.dataset, dict(query.filters)))
                describe = _as_published
        # One clause for the transport and one for the JSON-stat decoder: Eurostat's own
        # explanation of a 413 comes through `_why`, which the transport calls.
        except (SourceUnavailableError, JsonStatError) as unavailable:
            return Acquired(failures=(a_failure(attribute.id, str(unavailable)),))
        return self._values_from(reported, attribute, candidates, describe=describe)

    async def _shares(
        self, share: EurostatShare
    ) -> tuple[list[Observation], Callable[[Observation], str]]:
        """Every place-and-year for which all the components exist, as one share each.

        A year missing any component is not a year we have -- dividing 2025 taxes by 2024
        earnings would describe no year at all -- so it is skipped rather than approximated,
        and the newest-year rule downstream then picks each country's newest *complete* year.
        A flag on any component carries onto the share: a rate built from a provisional figure
        is itself provisional.
        """
        components: dict[str, dict[tuple[str, str], Observation]] = {}
        for component in (share.whole, *share.parts):
            query = share.slice_for(component)
            reported = observations(await self._get(query.dataset, dict(query.filters)))
            components[component] = {(o.geo, o.period): o for o in reported}

        shares: list[Observation] = []
        workings: dict[tuple[str, str], str] = {}
        for key, whole in components[share.whole].items():
            parts = [components[part].get(key) for part in share.parts]
            if whole.figure == 0 or any(part is None for part in parts):
                continue
            present = [part for part in parts if part is not None]
            figure = sum(part.figure for part in present) / whole.figure * 100
            flag = next((o.flag for o in (whole, *present) if o.flag in UNSETTLED_FLAGS), None)
            shares.append(Observation(geo=key[0], period=key[1], figure=figure, flag=flag))
            workings[key] = (
                " + ".join(
                    f"{name} {part.figure}" for name, part in zip(share.parts, present, strict=True)
                )
                + f" of {share.whole} {whole.figure} = {figure:.1f}%"
            )

        def describe(observation: Observation) -> str:
            return (
                f"Eurostat {share.dataset} {observation.period}: "
                f"{workings[(observation.geo, observation.period)]}"
            )

        return shares, describe

    async def _densities(
        self, density: EurostatDensity
    ) -> tuple[list[Observation], Callable[[Observation], str]]:
        """Every place-and-year with a length, over that place's newest land area.

        A place with no area, or an area of zero, has no density; it is skipped rather than
        guessed, and reaches the ranking as missing coverage like any other gap.
        """
        lengths = observations(
            await self._get(density.length.dataset, dict(density.length.filters))
        )
        areas = observations(await self._get(density.area.dataset, dict(density.area.filters)))
        newest_area: dict[str, Observation] = {}
        for area in areas:
            if area.geo not in newest_area or area.period > newest_area[area.geo].period:
                newest_area[area.geo] = area

        densities: list[Observation] = []
        workings: dict[tuple[str, str], str] = {}
        for length in lengths:
            area = newest_area.get(length.geo)
            if area is None or area.figure == 0:
                continue
            figure = length.figure / area.figure * density.per
            flag = next((o.flag for o in (length, area) if o.flag in UNSETTLED_FLAGS), None)
            densities.append(
                Observation(geo=length.geo, period=length.period, figure=figure, flag=flag)
            )
            workings[(length.geo, length.period)] = (
                f"Eurostat {density.length.dataset} {length.period}: {length.figure} km over "
                f"{area.figure} km² of land ({density.area.dataset} {area.period}) = "
                f"{figure:.1f} per {density.per:,} km²"
            )

        def describe(observation: Observation) -> str:
            return workings[(observation.geo, observation.period)]

        return densities, describe

    async def _get(self, dataset: str, filters: dict[str, str]) -> dict:
        answered = await self._endpoint.get(
            f"/{dataset}", params={"format": "JSON", "lang": "EN", **filters}
        )
        return dict(answered)

    def _values_from(
        self,
        reported: Sequence[Observation],
        attribute: Attribute,
        candidates: Sequence[Candidate],
        *,
        describe: Callable[[Observation], str],
    ) -> Acquired:
        measuring = Measurements(
            attribute=attribute, data_source=EUROSTAT, retrieved=datetime.now(UTC)
        )
        by_geo: dict[str, list[Observation]] = {}
        for observation in reported:
            by_geo.setdefault(observation.geo, []).append(observation)

        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        for candidate in candidates:
            if candidate.country_code is None:
                failures.append(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        candidate=str(candidate.id),
                        reason="the candidate carries no country code to ask Eurostat for",
                    )
                )
                continue
            found = by_geo.get(eurostat_code_for(candidate.country_code))
            if not found:
                # Not a failure. Eurostat simply has nothing for this country, which is the
                # ordinary state of a sparse indicator and must reach the ranking as coverage.
                continue
            newest = max(found, key=lambda observation: observation.period)
            values.append(
                _a_value(
                    newest,
                    measuring=measuring,
                    candidate=candidate,
                    quote=describe(newest),
                )
            )
        return Acquired(values=tuple(values), failures=tuple(failures))


def _why(refused: httpx.HTTPStatusError) -> str:
    """What went wrong, in words a retry can act on.

    A 413 is the one status that is not a fault: Eurostat is preparing the extraction and the
    same request will answer later. Reporting it as a plain HTTP error would send somebody
    looking for a mistake in a request that had none.
    """
    if refused.response.status_code == TOO_LARGE_TO_ANSWER_NOW:
        return (
            "eurostat is preparing this extraction and asked us to try the same request again "
            "later; nothing is wrong with it"
        )
    return str(refused)


def _as_published(observation: Observation) -> str:
    """The provenance of a figure Eurostat publishes whole: which year, and the number itself."""
    return f"Eurostat {observation.period}: {observation.figure}"


def _a_value(
    observation: Observation,
    *,
    measuring: Measurements,
    candidate: Candidate,
    quote: str,
) -> Value:
    return measuring.figure(
        candidate=candidate,
        period=_whole_year(observation.period),
        payload=_payload_for(measuring.attribute, observation.figure),
        quote=quote,
        # Per figure, not per fetch: Eurostat flags individual observations as provisional or
        # estimated, so two countries in one response can be worth different amounts.
        confidence_level=(
            ConfidenceLevel.MEDIUM if observation.flag in UNSETTLED_FLAGS else ConfidenceLevel.HIGH
        ),
    )


def _whole_year(period: str) -> ReferencePeriod:
    """An annual figure describes a whole year, and both ends of it are recorded.

    The reference period is what the data describes; the retrieval date is when we fetched it,
    and the two are never merged (`reqs.md` 3.6). A figure for 2024 fetched today is a 2024
    figure, and next year it will be a stale one -- which only works if the year is stored.
    """
    year = int(period)
    return ReferencePeriod(start=date(year, 1, 1), end=date(year, 12, 31))


def _payload_for(attribute: Attribute, figure: Decimal) -> ValuePayload:
    """The figure in the shape the catalog says this attribute takes.

    Read off the `Attribute` rather than decided here, so adding an attribute of an existing
    type stays a pure data change. A type the catalog declares and this adapter has no series
    for cannot arrive: `QUERIES` names three attributes and the manifest is what `attributes`
    reports.
    """
    if attribute.value_type is ValueType.RATIO:
        if attribute.ratio_parameters is None:
            raise ValueError(f"{attribute.id} is a Ratio and the catalog gives it no basis")
        return Ratio(value=figure, basis=attribute.ratio_parameters.basis)
    if attribute.value_type is ValueType.QUANTITY:
        if attribute.quantity_parameters is None:
            raise ValueError(f"{attribute.id} is a Quantity and the catalog gives it no unit")
        return Quantity(magnitude=figure, unit=attribute.quantity_parameters.unit)
    raise ValueError(
        f"{attribute.id} is a {attribute.value_type}, which this adapter does not know how to "
        "build from a Eurostat figure"
    )
