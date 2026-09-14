"""A transcribed table as a `SourceAdapter`: one table, one publisher, one attribute.

**It stores the figure under the publisher that published it**, not under `manual` or `llm`.
Who moved the number into the repository does not change who published it: an RSF score read off
RSF's table is an RSF figure, and the catalog already ranks `rsf`, `ef_epi` and `mipex` first for
their attributes. The route it took is recorded where a reader can check it -- the page on every
row, and the table's confidence -- rather than by pretending it was typed by the household
(`manual`, which ranks last) or guessed by a model (`llm`).

**The retrieval date is the day the table was read**, not the day a run happens to copy it from
the file. `reqs.md` 3.6 keeps that date to answer "when did anyone last look?", and a run that
re-reads a file nobody has re-transcribed has not looked at the publisher again.

**Nothing is filled in.** A candidate the table does not list produces no value -- EF does not
rank the United Kingdom, MIPEX does not cover Liechtenstein -- and that gap reaches the ranking
as coverage.
"""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime, time
from decimal import Decimal

from pydantic import ValidationError

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    AttributeId,
    ConfidenceLevel,
    DataSourceId,
    Index,
    Measurements,
    Payload,
    Quantity,
    Ratio,
    ReferencePeriod,
    Value,
    ValueType,
)
from starnest.data_acquisition import Acquired, AcquisitionFailure, SourceAdapter
from starnest.data_sources.published_tables.table import PublishedTable, Row
from starnest.data_sources.transport import a_failure

ShapedAs = Callable[[Decimal], Payload]


class PublishedTableAdapter(SourceAdapter):
    """Serves one transcription. Free, local, and as strict about its input as any API adapter."""

    def __init__(self, table: PublishedTable) -> None:
        self._table = table

    @property
    def data_source(self) -> DataSourceId:
        return DataSourceId(self._table.data_source)

    @property
    def attributes(self) -> tuple[AttributeId, ...]:
        return (AttributeId(self._table.attribute),)

    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        if str(attribute.id) != self._table.attribute:
            return Acquired(
                failures=(
                    AcquisitionFailure(
                        attribute=attribute.id,
                        reason=f"{self._table.publication} answers only {self._table.attribute}",
                    ),
                )
            )

        shaped = _shaped_by(attribute)
        measuring = Measurements(
            attribute=attribute,
            data_source=self.data_source,
            retrieved=datetime.combine(self._table.transcribed_on, time(), tzinfo=UTC),
            confidence_level=ConfidenceLevel(self._table.confidence),
        )
        by_code = {row.country_code: row for row in self._table.rows}

        values: list[Value] = []
        failures: list[AcquisitionFailure] = []
        for candidate in candidates:
            if candidate.country_code is None:
                failures.append(
                    a_failure(
                        attribute.id,
                        "the candidate carries no country code to look up in the table",
                        candidate=str(candidate.id),
                    )
                )
                continue
            row = by_code.get(str(candidate.country_code).upper())
            if row is None:
                continue
            try:
                values.append(self._a_value(row, shaped, measuring, candidate))
            except ValidationError as refused:
                # A figure outside the scale the catalog declares is a transcription slip or a
                # publisher surprise, and either way it is one country's problem, not the run's.
                failures.append(
                    a_failure(attribute.id, _the_reason(refused), candidate=str(candidate.id))
                )
        return Acquired(values=tuple(values), failures=tuple(failures))

    def _a_value(
        self, row: Row, shaped: ShapedAs, measuring: Measurements, candidate: Candidate
    ) -> Value:
        citations = tuple(dict.fromkeys((row.page, self._table.publisher_url)))
        return measuring.figure(
            candidate=candidate,
            period=ReferencePeriod(start=row.period_start, end=row.period_end),
            payload=shaped(row.figure),
            quote=row.workings or f"{self._table.publication}: {row.figure}",
            citations=citations,
        )


def _shaped_by(attribute: Attribute) -> ShapedAs:
    """How a figure becomes this attribute's payload, read off the catalog once per fetch.

    A missing declaration is a broken catalog rather than a bad row, so it raises once instead
    of being recorded against every country.
    """
    if attribute.value_type is ValueType.INDEX:
        bounds = attribute.index_parameters
        if bounds is None:
            raise ValueError(f"{attribute.id} is an Index and the catalog gives it no scale")
        return lambda figure: Index(
            value=figure,
            provider=bounds.provider,
            scale_min=bounds.scale_min,
            scale_max=bounds.scale_max,
        )
    if attribute.value_type is ValueType.QUANTITY:
        unit = attribute.quantity_parameters
        if unit is None:
            raise ValueError(f"{attribute.id} is a Quantity and the catalog gives it no unit")
        return lambda figure: Quantity(magnitude=figure, unit=unit.unit)
    if attribute.value_type is ValueType.RATIO:
        share = attribute.ratio_parameters
        if share is None:
            raise ValueError(f"{attribute.id} is a Ratio and the catalog names no basis for it")
        return lambda figure: Ratio(value=figure, basis=share.basis)
    raise ValueError(
        f"{attribute.id} is a {attribute.value_type}, and a transcribed table carries index, "
        "quantity and ratio figures only"
    )


def _the_reason(refused: ValidationError) -> str:
    first = refused.errors()[0]
    original = first.get("ctx", {}).get("error")
    return str(original) if original is not None else str(first.get("msg", refused))
