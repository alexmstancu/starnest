"""An estimate of the total tax rate at 167% of the average wage, from Eurostat's own figures.

**Why it exists** (Q207). The total tax rate is read from OECD Taxing Wages, which does not cover
Romania, Bulgaria, Croatia, Cyprus or Malta. Eurostat covers them, but publishes the full tax
wedge -- employer's contributions included -- only at 67% of the average wage.

**How.** At 67% Eurostat gives both the full wedge and the employee's side of it, so the
employer's contribution rate can be backed out:

    wedge = (tax + employee + employer) / (gross + employer)
    employer = (wedge * gross - tax - employee) / (1 - wedge)

That rate, as a share of gross, is applied to the 167% gross, and the wedge recomputed with the
167% tax and employee contributions. Every input is a Eurostat figure; nothing is typed in.

**Where it is wrong, and by how much -- measured, not guessed.** Tested against OECD's published
167% wedge on twelve countries OECD covers: within a point where employer contributions are a
flat rate (Portugal, Czechia, Spain, Italy, Sweden, Finland); one to two and a half points off
where they are capped (Germany, Austria, Belgium); six to eight off where they are reduced for
low wages or classified differently (France, Poland, the Netherlands). The method assumes the
67% employer rate still holds at 167%, and caps and reductions are exactly where it does not.

So it is published at **`low` confidence** under its own source, `eurostat_estimate`, **ranked
below OECD**. Where OECD has a figure, OECD's is active and this one is stored beside it as a
visible second opinion; where OECD has none, this is the only figure and it is active. No list of
countries anywhere decides which -- source priority does, as it does for every attribute.
"""

from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Final

import httpx
from pydantic import ValidationError

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    ConfidenceLevel,
    DataSourceId,
    Measurements,
    Ratio,
    ReferencePeriod,
    Value,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.eurostat.geography import eurostat_code_for
from starnest.data_sources.eurostat.jsonstat import JsonStatError, observations
from starnest.data_sources.eurostat.manifest import BASE_URL

EUROSTAT_ESTIMATE = DataSourceId("eurostat_estimate")
TOTAL_TAX_RATE = AttributeId("country.total_tax_rate_effective")

LOW, HIGH = "P1_NCH_AW67", "P1_NCH_AW167"
"""A single person without children at 67% and 167% of the average wage.

67% because it is the only income at which Eurostat publishes the full wedge; 167% because it is
where Q205 reads the rate.
"""

COMPONENTS: Final = ("GRS", "TAX", "SOC")
"""Gross earnings, taxes, and the employee's social contributions, from `earn_nt_net`."""


class TaxWedgeEstimateAdapter(SourceAdapter):
    """Seven Eurostat series in, one estimated rate per country out."""

    def __init__(self, client: httpx.AsyncClient, *, base_url: str = BASE_URL) -> None:
        self._client = client
        self._base_url = base_url

    @property
    def data_source(self) -> DataSourceId:
        return EUROSTAT_ESTIMATE

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return (TOTAL_TAX_RATE,)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        if attribute.id != TOTAL_TAX_RATE:
            return Acquired(
                failures=(_a_failure(attribute.id, f"this estimate answers only {TOTAL_TAX_RATE}"),)
            )
        try:
            series = await self._series()
        except httpx.HTTPError as unreachable:
            return Acquired(failures=(_a_failure(attribute.id, str(unreachable)),))
        except JsonStatError as unreadable:
            return Acquired(failures=(_a_failure(attribute.id, str(unreadable)),))
        return _estimates(series, attribute, candidates)

    async def _series(self) -> dict[str, dict[tuple[str, str], Decimal]]:
        """Each of the seven series by `(geo, period)`, fetched as its own slice.

        One slice per component because the JSON-stat decoder keeps only place and period; asking
        for several at once would return figures with nothing to say which was which.
        """
        found: dict[str, dict[tuple[str, str], Decimal]] = {}
        for case in (LOW, HIGH):
            for component in COMPONENTS:
                found[f"{case}:{component}"] = await self._slice(
                    "earn_nt_net", currency="EUR", ecase=case, estruct=component
                )
        found["wedge"] = await self._slice("earn_nt_taxwedge", unit="RT")
        return found

    async def _slice(self, dataset: str, **filters: str) -> dict[tuple[str, str], Decimal]:
        response = await self._client.get(
            f"{self._base_url}/{dataset}", params={"format": "JSON", "lang": "EN", **filters}
        )
        response.raise_for_status()
        return {(o.geo, o.period): o.figure for o in observations(response.json())}


class _Workings:
    """One country's estimate, and the arithmetic that produced it, for the provenance."""

    __slots__ = (
        "_parts",
        "employer",
        "employer_rate",
        "labour_cost",
        "period",
        "rate",
        "wedge_at_67",
    )

    def __init__(self, series: dict[str, dict[tuple[str, str], Decimal]], key: tuple[str, str]):
        g, t, s = (series[f"{LOW}:{c}"][key] for c in COMPONENTS)
        wedge = series["wedge"][key] / 100
        gross, tax, employee = (series[f"{HIGH}:{c}"][key] for c in COMPONENTS)
        self.period = key[1]
        self.wedge_at_67 = series["wedge"][key]
        self.employer_rate = (wedge * g - t - s) / ((1 - wedge) * g)
        self.employer = gross * self.employer_rate
        self.labour_cost = gross + self.employer
        self.rate = (tax + employee + self.employer) / self.labour_cost * 100
        self._parts = (tax, employee)

    def quote(self) -> str:
        tax, employee = self._parts
        return (
            f"Estimated from Eurostat {self.period}: the employer's contributions, backed out of "
            f"the {self.wedge_at_67}% wedge at 67% of the average wage, are "
            f"{self.employer_rate * 100:.1f}% of gross; at 167%, (tax {tax} + employee {employee}"
            f" + employer {self.employer:.0f}) over labour cost {self.labour_cost:.0f} = "
            f"{self.rate:.1f}%. Approximate where contributions are capped or vary with the wage"
        )


def _estimates(
    series: dict[str, dict[tuple[str, str], Decimal]],
    attribute: Attribute,
    candidates: Sequence[Candidate],
) -> Acquired:
    measuring = Measurements(
        attribute=attribute,
        data_source=EUROSTAT_ESTIMATE,
        retrieved=datetime.now(UTC),
        # An estimate assembled from seven series is ours, not Eurostat's, and `low` says so --
        # which is also what keeps it ranked below the published rate (`reqs.md` Q207).
        confidence_level=ConfidenceLevel.LOW,
    )
    basis = _the_basis_of(attribute)

    values: list[Value] = []
    failures: list[AcquisitionFailure] = []
    for candidate in candidates:
        if candidate.country_code is None:
            failures.append(
                _a_failure(
                    attribute.id,
                    "the candidate carries no country code to ask Eurostat for",
                    candidate=str(candidate.id),
                )
            )
            continue
        key = _newest_complete_year(series, eurostat_code_for(candidate.country_code))
        if key is None:
            # Not a failure: Eurostat lacks one of the seven series for this country in every
            # year, so there is nothing to estimate from. A gap, reported as coverage.
            continue
        workings = _Workings(series, key)
        if not Decimal(0) <= workings.employer_rate < 1:
            failures.append(
                _a_failure(
                    attribute.id,
                    f"the employer rate backed out for {key[1]} is "
                    f"{workings.employer_rate * 100:.1f}% of gross, which no contribution system "
                    "produces; the series disagree and no estimate is made",
                    candidate=str(candidate.id),
                )
            )
            continue
        try:
            values.append(
                measuring.figure(
                    candidate=candidate,
                    period=ReferencePeriod(
                        start=date(int(key[1]), 1, 1), end=date(int(key[1]), 12, 31)
                    ),
                    payload=Ratio(value=workings.rate, basis=basis),
                    quote=workings.quote(),
                )
            )
        except ValidationError as refused:
            failures.append(_a_failure(attribute.id, str(refused), candidate=str(candidate.id)))
    return Acquired(values=tuple(values), failures=tuple(failures))


def _newest_complete_year(
    series: dict[str, dict[tuple[str, str], Decimal]], geo: str
) -> tuple[str, str] | None:
    """The newest year in which all seven series have a figure for this place.

    **All seven, the same year** -- the rule the effective-rate share established and a mutation
    proved worth having: dividing one year's taxes by another's earnings produces a plausible
    number describing no year at all.
    """
    years = [{period for (place, period) in figures if place == geo} for figures in series.values()]
    shared = set.intersection(*years) if years else set()
    return (geo, max(shared)) if shared else None


def _the_basis_of(attribute: Attribute) -> str:
    if attribute.ratio_parameters is None:
        raise ValueError(f"{attribute.id} is a Ratio and the catalog gives it no basis")
    return attribute.ratio_parameters.basis


def _a_failure(
    attribute: AttributeId, reason: str, candidate: str | None = None
) -> AcquisitionFailure:
    return AcquisitionFailure(attribute=attribute, reason=reason, candidate=candidate)
