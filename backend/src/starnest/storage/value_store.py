"""`ValueStore` against PostgreSQL: read the values behind a score, append new ones.

`arch.md` 6.3. **There is no UPDATE and no DELETE in this file, and there must never be one.**
Values are never overwritten and never discarded (`reqs.md` 3.6): a correction is a new row
that supersedes the old one, and a figure that failed validation is inserted already carrying
its `rejection_reason` rather than updated into rejection afterwards.

**Being active is read from the view, never from a column.** `active_value` applies the five
ordering rules of `arch.md` 4 at query time, so a new value or a re-ranked source changes the
answer everywhere at once. Reimplementing that ranking in Python would give it a second
definition that could drift, and drift silently.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import CandidateId
from starnest.data import (
    AssignedScore,
    AttributeId,
    Boolean,
    BreakdownOptionId,
    ConfidenceLevel,
    Count,
    DataSourceId,
    ExternalScore,
    Index,
    LabelSet,
    Monetary,
    Payload,
    Quantity,
    Ratio,
    ReferencePeriod,
    ShareComposition,
    Text,
    Value,
    ValueListing,
    ValueStore,
    ValueType,
    payload_class_for,
)
from starnest.storage.connections import acquire
from starnest.storage.queries import load_queries


class PostgresValueStore(ValueStore):
    """The value seam, backed by the append-only `value` table and the `active_value` view."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        self._pool = pool
        self._queries = load_queries()

    async def read_active_values(
        self,
        *,
        level: str | None = None,
        candidates: Sequence[str] = (),
        attributes: Sequence[str] = (),
    ) -> tuple[Value, ...]:
        """One query for the whole ranking, payloads included.

        The payload travels with the row here and nowhere else in this file: this is the read
        a slider drag repeats, so it pays the wider SELECT rather than a second round trip.

        Citations do not come back. They belong to the drill-down, which is what `read_values`
        serves, and joining them onto every row of a ranking would multiply the hot query by
        the number of pages behind each figure.
        """
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_active_values(
                    connection,
                    level=level,
                    candidates=_filter_or_none(candidates),
                    attributes=_filter_or_none(attributes),
                )
            ]
        return tuple(
            _value_from(
                row,
                payload=_payload_from(row.value_type, row.payload),
                rejection_reason=None,
                citations=(),
            )
            for row in rows
        )

    async def read_values(
        self,
        *,
        candidate: str | None = None,
        attribute: str | None = None,
        include_superseded: bool = True,
        limit: int | None = None,
        offset: int = 0,
    ) -> tuple[ValueListing, ...]:
        """Every stored value for the drill-down: superseded, rejected and active together.

        Two reads rather than one. The page of values is selected first and its payloads are
        fetched by id, because this screen is not on the hot path and paying one extra round
        trip is cheaper than a third copy of the ten-branch payload CASE
        (`storage/queries/values.sql`).
        """
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_values(
                    connection,
                    candidate=candidate,
                    attribute=attribute,
                    include_superseded=include_superseded,
                    limit_rows=limit,
                    offset_rows=offset,
                )
            ]
            payloads = await self._read_payloads(connection, [row.id for row in rows])
        return tuple(
            ValueListing(
                value=_value_from(
                    row,
                    payload=payloads.get(row.id),
                    rejection_reason=row.rejection_reason,
                    citations=tuple(row.citations),
                ),
                # Computed by the view, never by this method: which value wins depends on every
                # other value for the same attribute, and this row knows nothing about them.
                is_active=row.is_active,
            )
            for row in rows
        )

    async def _read_payloads(
        self, connection: AsyncConnection, value_ids: Sequence[int]
    ) -> Mapping[int, Payload | None]:
        if not value_ids:
            return {}
        return {
            row.id: _payload_from(row.value_type, row.payload)
            async for row in self._queries.select_value_payloads(
                connection, value_ids=list(value_ids)
            )
        }

    async def count_values(
        self,
        *,
        candidate: str | None = None,
        attribute: str | None = None,
        include_superseded: bool = True,
    ) -> int:
        async with acquire(self._pool) as connection:
            return await self._queries.count_values(
                connection,
                candidate=candidate,
                attribute=attribute,
                include_superseded=include_superseded,
            )

    async def append(self, values: Sequence[Value]) -> tuple[Value, ...]:
        """Store each value in its own transaction, returning it with the id it was given.

        Per value rather than per batch, which is `arch.md` 7.1 rather than an optimisation:
        an acquisition run commits one work item at a time so that a crash, a halt or a failing
        adapter costs only the item in flight. A batch that rolled back would discard the good
        figures alongside the one that broke, and selective retry would then have nothing to
        tell it what is missing.
        """
        return tuple([await self._append_one(value) for value in values])

    async def _append_one(self, value: Value) -> Value:
        async with acquire(self._pool) as connection:
            value_id = await self._insert_row(connection, value)
            if value.payload is not None:
                await _insert_payload(self._queries, connection, value_id, value.payload)
            if value.citations:
                await self._queries.insert_value_citations(
                    connection, value_id=value_id, urls=list(value.citations)
                )
        return value.model_copy(update={"id": value_id})

    async def _insert_row(self, connection: AsyncConnection, value: Value) -> int:
        """The parent row, written as accepted or as rejected -- never accepted then amended.

        Two statements rather than one with a nullable argument, because the alternative that
        rules out is the dangerous one: a rejection is recorded by storing the value as
        rejected, never by updating a stored value into rejection.
        """
        common = _row_parameters(value)
        if value.is_rejected:
            row = await self._queries.insert_rejected_value(
                connection, **common, rejection_reason=value.rejection_reason
            )
        else:
            row = await self._queries.insert_value(connection, **common)
        return row.id

    async def read_external_scores(
        self, *, candidate: str | None = None, level: str | None = None
    ) -> tuple[ExternalScore, ...]:
        async with acquire(self._pool) as connection:
            rows = [
                row
                async for row in self._queries.select_external_scores(
                    connection, candidate=candidate, level=level
                )
            ]
        return tuple(_external_score_from(row) for row in rows)

    async def append_external_score(self, score: ExternalScore) -> ExternalScore:
        """Store one published figure.

        It comes back unchanged. `ExternalScore` carries no identifier -- an edition is
        identified by its candidate, its source and its reference period, which is also how
        "the current edition" is derived rather than stored -- so there is nothing the database
        assigns for this record to be given back.
        """
        async with acquire(self._pool) as connection:
            await self._queries.insert_external_score(
                connection,
                candidate=str(score.candidate),
                data_source=str(score.data_source),
                published_value=score.published_value,
                published_scale=score.published_scale,
                published_rank=score.published_rank,
                published_rank_of=score.published_rank_of,
                reference_period_start=score.reference_period.start,
                reference_period_end=score.reference_period.end,
                retrieval_date=score.retrieval_date,
                methodology_url=score.methodology_url,
                caveats=score.caveats,
            )
        return score


def _filter_or_none(identifiers: Sequence[str]) -> list[str] | None:
    """An empty filter means "do not narrow", which the SQL spells as a NULL array."""
    return [str(identifier) for identifier in identifiers] or None


def _row_parameters(value: Value) -> dict[str, Any]:
    """The provenance every value carries, whether it was accepted or rejected.

    The two dates stay two parameters. `reference_period_*` is the span in the world the figure
    describes and `retrieval_date` is the instant it was fetched (`reqs.md` 3.6,
    `arch.md` 9.6), and the schema types them `date` and `timestamptz` accordingly.
    """
    return {
        "candidate": str(value.candidate),
        "attribute": str(value.attribute),
        "value_type": str(value.value_type),
        "data_source": str(value.data_source),
        "breakdown_option": _text_or_none(value.breakdown_option),
        "data_acquisition_run": value.data_acquisition_run,
        "reference_period_start": value.reference_period.start,
        "reference_period_end": value.reference_period.end,
        "retrieval_date": value.retrieval_date,
        "confidence_level": str(value.confidence_level),
        "quote": value.quote,
    }


def _text_or_none(identifier: str | None) -> str | None:
    return None if identifier is None else str(identifier)


async def _insert_payload(
    queries: Any, connection: AsyncConnection, value_id: int, payload: Payload
) -> None:
    """The one typed child row, chosen by the payload's own type.

    Nothing here re-checks that the payload matches the value's declared type. The composite
    foreign keys of `arch.md` 3.3b make that the database's problem -- a Monetary value refuses
    a quantity payload -- and a second check in Python would be a second thing to keep true.
    """
    match payload:
        case Monetary():
            await queries.insert_monetary_payload(
                connection,
                value_id=value_id,
                amount=payload.amount,
                currency=str(payload.currency),
                amount_eur=payload.amount_eur,
                fx_rate=payload.fx_rate,
                fx_rate_date=payload.fx_rate_date,
            )
        case Quantity():
            await queries.insert_quantity_payload(
                connection,
                value_id=value_id,
                magnitude=payload.magnitude,
                unit=str(payload.unit),
            )
        case Count():
            await queries.insert_count_payload(
                connection, value_id=value_id, count=payload.count, basis=payload.basis
            )
        case Ratio():
            await queries.insert_ratio_payload(
                connection, value_id=value_id, value=payload.value, basis=payload.basis
            )
        case Index():
            await queries.insert_index_payload(
                connection,
                value_id=value_id,
                value=payload.value,
                provider=payload.provider,
                scale_min=payload.scale_min,
                scale_max=payload.scale_max,
            )
        case LabelSet():
            await queries.insert_labelset_payload(
                connection, value_id=value_id, labels=list(payload.labels)
            )
        case ShareComposition():
            await queries.insert_sharecomp_payload(
                connection,
                value_id=value_id,
                labels=[share.label for share in payload.shares],
                shares=[share.share for share in payload.shares],
            )
        case Boolean():
            await queries.insert_boolean_payload(connection, value_id=value_id, value=payload.value)
        case AssignedScore():
            await queries.insert_assigned_score_payload(
                connection,
                value_id=value_id,
                value=payload.value,
                range_min=payload.range_min,
                range_max=payload.range_max,
                assigned_by=str(payload.assigned_by),
                rationale=payload.rationale,
            )
        case Text():
            await queries.insert_text_payload(connection, value_id=value_id, body=payload.body)
        case _:  # pragma: no cover -- unreachable while the ten types are the ten types
            raise TypeError(f"no payload table for {type(payload).__name__}")


def _value_from(
    row: Any,
    *,
    payload: Payload | None,
    rejection_reason: str | None,
    citations: tuple[str, ...],
) -> Value:
    """One row of `value` or of `active_value`, as the domain object `data/` declared.

    The two fields the two queries do not agree on are passed in rather than read off the row,
    because they are genuinely different questions: `active_value` cannot return a rejected
    value at all (`arch.md` 4, rule 1), and the ranking read deliberately leaves citations to
    the drill-down. Reaching for a column that may not be there would hide that difference.

    Columns the domain has no field for are dropped rather than carried: `is_fresh` and
    `is_active` are both derived facts about a row's standing among other rows, and `Value` is
    deliberately a fact about one figure (`data/value.py`).

    `is_active` is dropped here and then paired back on by `read_values`, in a `ValueListing`.
    The contract requires it on every value it returns, so losing it outright left `api/`
    unable to populate a required field (known-issues D6) -- but putting it ON the value would
    be storing a comparison on the thing compared, which is what this paragraph refuses.
    """
    return Value(
        candidate=CandidateId(row.candidate),
        attribute=AttributeId(row.attribute),
        value_type=ValueType(row.value_type),
        data_source=DataSourceId(row.data_source),
        reference_period=ReferencePeriod(
            start=row.reference_period_start, end=row.reference_period_end
        ),
        retrieval_date=row.retrieval_date,
        confidence_level=ConfidenceLevel(row.confidence_level),
        payload=payload,
        breakdown_option=(
            BreakdownOptionId(row.breakdown_option) if row.breakdown_option else None
        ),
        rejection_reason=rejection_reason,
        quote=row.quote,
        citations=citations,
        data_acquisition_run=row.data_acquisition_run,
        id=row.id,
    )


def _payload_from(value_type: str, payload: Mapping[str, Any] | None) -> Payload | None:
    """The jsonb payload as its class, or `None` for a value that stores no figure.

    **The JSON keys are the payload class's fields, one for one**, so there is no translation
    step here and there must not be one: `values.sql` builds each object out of the columns the
    class declares, and a mismatch is a fault in one of the two to be fixed rather than
    absorbed.

    A row with no typed child produces an object whose every field is empty, because the CASE
    builds it from a LEFT JOIN that found nothing. That is a real state -- a figure breaking a
    type-implicit rule has nothing storable and is written as the parent row alone, carrying
    the reason (`reqs.md` 3.3a) -- so it is read back as no payload rather than as a payload
    that fails validation.
    """
    if payload is None or _holds_nothing(payload):
        return None
    return payload_class_for(value_type).model_validate(payload)


def _holds_nothing(payload: Mapping[str, Any]) -> bool:
    """Whether every field of the assembled object is absent.

    `None` for a scalar column that was not there, and an empty list for the two types whose
    payload is a list of rows -- `jsonb_agg` over no rows is coalesced to `[]`, not to null.
    """
    return all(field is None or field == [] for field in payload.values())


def _external_score_from(row: Any) -> ExternalScore:
    return ExternalScore(
        candidate=CandidateId(row.candidate),
        data_source=DataSourceId(row.data_source),
        published_scale=row.published_scale,
        reference_period=ReferencePeriod(
            start=row.reference_period_start, end=row.reference_period_end
        ),
        retrieval_date=row.retrieval_date,
        published_value=row.published_value,
        published_rank=row.published_rank,
        published_rank_of=row.published_rank_of,
        methodology_url=row.methodology_url,
        caveats=row.caveats,
    )
