"""One focus candidate against a few comparators (`reqs.md` 8.5).

**The synthesis is derived from weighted contribution, never from the raw delta.** A country
2,000 km ahead on coastline and 2 points behind on tax is not "ahead": the advantage is worth a
tenth of a score point and the disadvantage several. Ranking by the raw difference would produce
sentences that read plausibly and mislead, which is the bug this module is shaped to prevent
(`reqs.md` 8.5, `devplan.md` C5).

**Templated from the numbers, never written by a model** (Q24). Deterministic, instant, free,
and identical every time it is reopened -- and every sentence is a restatement of arithmetic the
reader can check in the table above it.

**Always live** (Q25): this computes from a ranking that was computed from stored values, so a
weight change is reflected the moment the ranking is recomputed. Nothing here is stored; a saved
comparison is post-MVP, where freezing is the point.

**Levels are never mixed**, which costs nothing to enforce here: a ranking runs at one level, so
a candidate from another simply is not in it, and is refused by name rather than silently missed.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from starnest.candidates import CandidateId
from starnest.criteria import TOTAL
from starnest.data import AttributeId, PillarId
from starnest.evaluation import AttributeScore, CandidateResult

Magnitudes = Mapping[str, Mapping[str, Decimal]]
"""The figure each candidate holds for each attribute, in the attribute's own unit."""


class ComparisonError(ValueError):
    """The comparison asked for cannot be drawn."""


@dataclass(frozen=True)
class ComparatorCell:
    """One comparator's side of one attribute: its figure, its score, and what the gap is worth."""

    candidate: CandidateId
    normalised_score: int | None
    magnitude: Decimal | None
    delta: Decimal | None
    """Focus minus comparator, in the attribute's own unit. None unless both have a figure."""
    weighted_contribution: Decimal | None
    """What that gap is worth to the total: the score difference times the effective weight."""


@dataclass(frozen=True)
class AttributeComparison:
    """One row of the table: the focus, then one cell per comparator."""

    attribute: AttributeId
    pillar: PillarId
    focus_score: int | None
    focus_magnitude: Decimal | None
    comparators: tuple[ComparatorCell, ...]


@dataclass(frozen=True)
class Synthesis:
    """What the numbers say about one pair, in sentences derived from them."""

    comparator: CandidateId
    score_delta: int | None
    advantages: tuple[str, ...]
    disadvantages: tuple[str, ...]


@dataclass(frozen=True)
class Comparison:
    """A focus candidate, its comparators, the per-attribute table and the synthesis."""

    focus: CandidateResult
    comparators: tuple[CandidateResult, ...]
    attributes: tuple[AttributeComparison, ...]
    synthesis: tuple[Synthesis, ...]


def compare(
    *,
    results: Sequence[CandidateResult],
    focus: str,
    comparators: Sequence[str],
    magnitudes: Magnitudes,
    names: Mapping[str, str] | None = None,
    comparator_limit: int,
    top: int = 3,
) -> Comparison:
    """The focus against each comparator, attribute by attribute, with the synthesis.

    `results` is one level's ranking, already computed. `comparator_limit` is a setting and has
    no default here: it is configurable by design (`reqs.md` 8.5), and a number chosen in this
    file would be the hardcoded bound that requirement exists to forbid.
    """
    display_names = names or {}
    if not comparators:
        raise ComparisonError("a comparison needs at least one comparator")
    if len(comparators) > comparator_limit:
        raise ComparisonError(
            f"{len(comparators)} comparators is more than the configured limit of "
            f"{comparator_limit}"
        )
    if focus in comparators:
        raise ComparisonError(f"{focus} cannot be compared with itself")
    if len(set(comparators)) != len(comparators):
        raise ComparisonError("a comparator appears twice, which would draw the same column twice")

    ranked = {str(result.candidate): result for result in results}
    focus_result = _the_candidate(ranked, focus)
    comparator_results = tuple(_the_candidate(ranked, candidate) for candidate in comparators)

    rows = _rows(focus_result, comparator_results, magnitudes)
    return Comparison(
        focus=focus_result,
        comparators=comparator_results,
        attributes=rows,
        synthesis=tuple(
            _synthesis(focus_result, comparator, rows, names=display_names, top=top)
            for comparator in comparator_results
        ),
    )


def _the_candidate(ranked: Mapping[str, CandidateResult], candidate: str) -> CandidateResult:
    """A candidate of this ranking, or a refusal naming it.

    A candidate at another level is not in this ranking, which is how "levels are never mixed"
    enforces itself: the refusal says the candidate is not part of the ranking rather than
    quietly leaving a column out.
    """
    try:
        return ranked[candidate]
    except KeyError:
        raise ComparisonError(
            f"{candidate!r} is not in this ranking, so it cannot be compared within it"
        ) from None


def _rows(
    focus: CandidateResult,
    comparators: Sequence[CandidateResult],
    magnitudes: Magnitudes,
) -> tuple[AttributeComparison, ...]:
    """One row per attribute the focus was scored on, in the ranking's own order."""
    scores_of = {
        str(result.candidate): {str(row.attribute): row for row in result.attribute_scores}
        for result in (focus, *comparators)
    }
    return tuple(
        AttributeComparison(
            attribute=row.attribute,
            pillar=row.pillar,
            focus_score=row.normalised_score,
            focus_magnitude=_magnitude(magnitudes, str(focus.candidate), str(row.attribute)),
            comparators=tuple(
                _cell(
                    comparator=comparator,
                    attribute=str(row.attribute),
                    focus_score=row.normalised_score,
                    focus_magnitude=_magnitude(
                        magnitudes, str(focus.candidate), str(row.attribute)
                    ),
                    effective_weight=row.effective_weight,
                    scored=scores_of[str(comparator.candidate)].get(str(row.attribute)),
                    magnitudes=magnitudes,
                )
                for comparator in comparators
            ),
        )
        for row in focus.attribute_scores
    )


def _cell(
    *,
    comparator: CandidateResult,
    attribute: str,
    focus_score: int | None,
    focus_magnitude: Decimal | None,
    effective_weight: Decimal,
    scored: AttributeScore | None,
    magnitudes: Magnitudes,
) -> ComparatorCell:
    """One comparator's cell. A gap needs both sides; either missing leaves it unanswered.

    **The weight is the focus's effective weight**, after redistribution for what the focus was
    missing, because the contribution answers "what is this gap worth to the focus's total?".
    """
    their_score = scored.normalised_score if scored is not None else None
    their_magnitude = _magnitude(magnitudes, str(comparator.candidate), attribute)
    delta = (
        focus_magnitude - their_magnitude
        if focus_magnitude is not None and their_magnitude is not None
        else None
    )
    contribution = (
        (Decimal(focus_score) - Decimal(their_score)) * effective_weight / TOTAL
        if focus_score is not None and their_score is not None
        else None
    )
    return ComparatorCell(
        candidate=comparator.candidate,
        normalised_score=their_score,
        magnitude=their_magnitude,
        delta=delta,
        weighted_contribution=contribution,
    )


def _magnitude(magnitudes: Magnitudes, candidate: str, attribute: str) -> Decimal | None:
    return magnitudes.get(candidate, {}).get(attribute)


def _synthesis(
    focus: CandidateResult,
    comparator: CandidateResult,
    rows: Sequence[AttributeComparison],
    *,
    names: Mapping[str, str],
    top: int,
) -> Synthesis:
    """The pair's top advantages and disadvantages, by what each gap is worth.

    Ordered by weighted contribution, so a large gap on a criterion that barely counts never
    outranks a small gap on one that decides the score. Ties break on the attribute's name, so
    the same comparison reads identically every time it is drawn.
    """
    worth = [
        (row, cell.weighted_contribution)
        for row in rows
        for cell in row.comparators
        if cell.candidate == comparator.candidate and cell.weighted_contribution is not None
    ]
    ahead = sorted(
        (pair for pair in worth if pair[1] > 0), key=lambda pair: (-pair[1], str(pair[0].attribute))
    )
    behind = sorted(
        (pair for pair in worth if pair[1] < 0), key=lambda pair: (pair[1], str(pair[0].attribute))
    )
    return Synthesis(
        comparator=comparator.candidate,
        score_delta=(
            focus.score - comparator.score
            if focus.score is not None and comparator.score is not None
            else None
        ),
        advantages=tuple(
            _sentence(row, comparator.candidate, contribution, names)
            for row, contribution in ahead[:top]
        ),
        disadvantages=tuple(
            _sentence(row, comparator.candidate, contribution, names)
            for row, contribution in behind[:top]
        ),
    )


def _sentence(
    row: AttributeComparison,
    comparator: CandidateId,
    contribution: Decimal,
    names: Mapping[str, str],
) -> str:
    """One line of the synthesis, restating the arithmetic of the row it came from.

    **The comparator is named rather than assumed.** A first version took the first cell with a
    contribution, which quoted the first comparator's figures in every other comparator's
    sentences -- wrong in a way that reads perfectly.
    """
    attribute = str(row.attribute)
    their_score = next(
        cell.normalised_score for cell in row.comparators if cell.candidate == comparator
    )
    return (
        f"{names.get(attribute, attribute)}: {row.focus_score} against {their_score}, "
        f"worth {contribution:+.1f} points"
    )
