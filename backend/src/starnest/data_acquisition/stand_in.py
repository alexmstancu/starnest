"""A run's last step: where a candidate has no source, borrow the declared substitute's figure.

`reqs.md` Q195 and Q208. **Visibly, or not at all.** Each copy is stored under `data_source =
stand_in` at `low` confidence, with a quote naming whose figure it is, why it transfers, and the
original as its publisher issued it. Stored under the original publisher it would rank as that
publisher and read as a measurement of the wrong place -- "fabrication with the paperwork filled
in", which is the one thing this application must not do.

**Written every run, whether or not a real figure exists.** The stand-in source ranks below
every source that measures a place, so a real figure wins the active-value rule the day one is
published, and the copy stays stored beside it as what it always was. No list anywhere says who
currently needs a stand-in; the active-value rule already answers that.

**Only a real figure is borrowed.** A substitute whose own active figure is itself a stand-in has
nothing to lend, and a chain of borrowings would put a third country's number on screen under the
second one's name.
"""

from collections.abc import Sequence
from datetime import UTC, datetime

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    DataSourceId,
    StandIn,
    Value,
    ValueStore,
)
from starnest.data_acquisition.adapter import Acquired, AcquisitionFailure
from starnest.data_acquisition.run import RunOutcome

STAND_IN = DataSourceId("stand_in")
"""The `data_source` row every borrowed figure names. Seeded by migration `0460`."""


async def stand_in(
    *,
    stand_ins: Sequence[StandIn],
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
    values: ValueStore,
    run: int | None = None,
    retrieved_at: datetime | None = None,
) -> RunOutcome:
    """Borrow every declared figure within the run's scope, and append the copies.

    Runs after every source has been asked, so a substitute's figure fetched in this same run is
    the one borrowed. Only declarations whose candidate *and* attribute are in scope are acted
    on: a run narrowed to Germany has no business writing anything for Liechtenstein.
    """
    in_scope = _the_declarations_in_scope(stand_ins, attributes, candidates)
    if not in_scope:
        return RunOutcome(stored=(), failures=())

    substitutes_figures = await values.read_active_values(
        candidates=sorted({str(declared.substitute) for declared in in_scope}),
        attributes=sorted({str(declared.attribute) for declared in in_scope}),
    )
    borrowed = figures_standing_in(
        in_scope, substitutes_figures, retrieved_at=retrieved_at or datetime.now(tz=UTC)
    )
    stamped = tuple(
        value.model_copy(update={"data_acquisition_run": run}) for value in borrowed.values
    )
    stored = await values.append(stamped) if stamped else ()
    return RunOutcome(stored=tuple(stored), failures=borrowed.failures)


def _the_declarations_in_scope(
    stand_ins: Sequence[StandIn],
    attributes: Sequence[Attribute],
    candidates: Sequence[Candidate],
) -> list[StandIn]:
    wanted_attributes = {attribute.id for attribute in attributes}
    wanted_candidates = {candidate.id for candidate in candidates}
    return [
        declared
        for declared in stand_ins
        if declared.attribute in wanted_attributes and declared.candidate in wanted_candidates
    ]


def figures_standing_in(
    stand_ins: Sequence[StandIn], substitutes_figures: Sequence[Value], *, retrieved_at: datetime
) -> Acquired:
    """The copies each declaration produces from the substitutes' active figures.

    Every breakdown option is borrowed, as each is a figure in its own right. A declaration whose
    substitute has no real figure produces a failure naming both places, so the gap is reported
    as the gap it is rather than as silence.
    """
    values: list[Value] = []
    failures: list[AcquisitionFailure] = []
    for declared in stand_ins:
        lendable = [
            figure
            for figure in substitutes_figures
            if figure.candidate == declared.substitute
            and figure.attribute == declared.attribute
            and figure.data_source != STAND_IN
            and not figure.is_rejected
        ]
        if not lendable:
            failures.append(
                AcquisitionFailure(
                    attribute=declared.attribute,
                    candidate=str(declared.candidate),
                    data_source=STAND_IN,
                    reason=(
                        f"{declared.substitute_name} stands in for {declared.candidate_name} "
                        "here, and has no figure of its own to lend"
                    ),
                )
            )
            continue
        values.extend(_borrowed(figure, declared, retrieved_at) for figure in lendable)
    return Acquired(values=tuple(values), failures=tuple(failures))


def _borrowed(figure: Value, declared: StandIn, retrieved_at: datetime) -> Value:
    """The substitute's figure, restated as a stand-in for the candidate.

    The reference period and the payload are the original's: the number describes the same
    period whichever country it is shown beside. The retrieval date is this copy's own, because
    that is when the application made it.
    """
    as_published = (
        f" As published for {declared.substitute_name}: {figure.quote}" if figure.quote else ""
    )
    return figure.model_copy(
        update={
            "candidate": declared.candidate,
            "data_source": STAND_IN,
            "confidence_level": ConfidenceLevel.LOW,
            "retrieval_date": retrieved_at,
            "quote": (
                f"{declared.substitute_name}'s figure, standing in for "
                f"{declared.candidate_name}. {declared.reason}{as_published}"
            ),
            "data_acquisition_run": None,
            "id": None,
        }
    )
