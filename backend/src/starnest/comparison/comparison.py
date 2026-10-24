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

**Every gap reads comparator minus focus** (PL-091). The focus is the baseline and each
comparator is read against it, as the matrix draws it: a positive gap, worth or score delta means
the comparator is ahead, and its advantages are what it leads on. Every difference here is taken
by `_against_focus`, so no number can run the other way.

**A pair's lines are pillars** (PL-100), each worth the comparator's pillar contribution minus
the focus's: the figure the matrix shows for that pillar under "Weighted impact", so the lines
explain the total gap. A pillar either side has no score on is named as not comparable and is in
neither list (PL-099), and with either total missing there are no lines at all (C07-F).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal

from starnest.candidates import CandidateId
from starnest.data import AttributeId, PillarId
from starnest.evaluation import AttributeScore, CandidateResult, contribution_of

Magnitudes = Mapping[str, Mapping[str, Decimal]]
"""The figure each candidate holds for each attribute, in the attribute's own unit -- except a
Monetary attribute, whose figure is its EUR equivalent, the only one comparable across candidates
that may hold different currencies (`magnitudes.py`, `reqs.md` 5.5)."""


class ComparisonError(ValueError):
    """The comparison asked for cannot be drawn."""


@dataclass(frozen=True)
class ComparatorCell:
    """One comparator's side of one attribute: its figure, its score, and what the gap is worth."""

    candidate: CandidateId
    normalised_score: int | None
    magnitude: Decimal | None
    delta: Decimal | None
    """Comparator minus focus, in the attribute's own unit -- in EUR for a Monetary attribute, the
    figure both sides are read as (`magnitudes.py`). None unless both have a figure."""
    weighted_contribution: Decimal | None
    """What the score gap is worth to the focus's total, comparator minus focus: the exact score
    difference times the focus's effective weight. None unless both were scored."""


@dataclass(frozen=True)
class AttributeComparison:
    """One row of the table: the focus, then one cell per comparator."""

    attribute: AttributeId
    pillar: PillarId
    focus_score: int | None
    focus_magnitude: Decimal | None
    focus_effective_weight: Decimal
    """What the attribute counted for in the focus's total: its share of the whole level after
    the focus's redistribution, the number Rank prints (PL-098, P1-43). Zero where the focus
    was not scored on it."""
    comparators: tuple[ComparatorCell, ...]


@dataclass(frozen=True)
class SynthesisLine:
    """One pillar of a pair's synthesis, and what its gap is worth to the total."""

    pillar: PillarId
    worth: Decimal
    """The comparator's pillar contribution minus the focus's, in score points. Never zero in a
    list: a pillar worth nothing either way is neither led nor trailed on."""


@dataclass(frozen=True)
class Synthesis:
    """What the numbers say about one pair, read from the comparator's side: the pillars it
    leads and trails the focus on, and those that cannot be compared."""

    comparator: CandidateId
    score_delta: int | None
    """The comparator's total minus the focus's. None when either has no total."""
    advantages: tuple[str, ...]
    """Deprecated: the same gaps as sentences, attribute by attribute, until the interface
    reads `ahead` (expand, then contract)."""
    disadvantages: tuple[str, ...]
    """Deprecated, until the interface reads `behind`."""
    ahead: tuple[SynthesisLine, ...]
    """The pillars the comparator leads on, most worth first. Empty when either has no total."""
    behind: tuple[SynthesisLine, ...]
    """The pillars it trails on, costliest first. Empty when either has no total."""
    not_comparable: tuple[PillarId, ...]
    """The pillars either side has no score on, in the focus's order, and in neither list."""


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
            focus_effective_weight=row.effective_weight,
            comparators=tuple(
                _cell(
                    comparator=comparator,
                    attribute=str(row.attribute),
                    focus_exact_score=row.exact_score,
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
    focus_exact_score: Decimal | None,
    focus_magnitude: Decimal | None,
    effective_weight: Decimal,
    scored: AttributeScore | None,
    magnitudes: Magnitudes,
) -> ComparatorCell:
    """One comparator's cell. A gap needs both sides; either missing leaves it unanswered.

    **Both gaps read comparator minus focus**, the raw figure's and the score's, so the cell
    says how far the comparator is from the baseline.
    **The weight is the focus's effective weight**, after redistribution for what the focus was
    missing, because the contribution answers "what is this gap worth to the focus's total?".
    **The scores are the exact ones** (`reqs.md` 5.1, NEW-17): the displayed scores are rounded,
    and weighing their difference could order two near-equal gaps the wrong way round.
    """
    their_score = scored.normalised_score if scored is not None else None
    their_exact_score = scored.exact_score if scored is not None else None
    their_magnitude = _magnitude(magnitudes, str(comparator.candidate), attribute)
    score_gap = _against_focus(focus_exact_score, their_exact_score)
    return ComparatorCell(
        candidate=comparator.candidate,
        normalised_score=their_score,
        magnitude=their_magnitude,
        delta=_against_focus(focus_magnitude, their_magnitude),
        weighted_contribution=(
            None if score_gap is None else contribution_of(score_gap, effective_weight)
        ),
    )


def _against_focus[Number: (int, Decimal)](
    focus: Number | None, theirs: Number | None
) -> Number | None:
    """The comparator's number minus the focus's, or None unless both have one."""
    return None if focus is None or theirs is None else theirs - focus


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
    """The comparator against the focus, by what each gap is worth: the pillars it leads on,
    most worth first, and those it trails on, costliest first -- with, until the interface reads
    those, the same gaps as sentences, attribute by attribute.

    Ordered by weighted contribution, so a large gap on something that barely counts never
    outranks a small gap on what decides the score. Ties keep an order that does not move -- the
    focus's pillar order for a line, the attribute's name for a sentence -- so the same
    comparison reads identically every time it is drawn.
    """
    worth = [
        (row, cell.weighted_contribution)
        for row in rows
        for cell in row.comparators
        if cell.candidate == comparator.candidate and cell.weighted_contribution is not None
    ]
    leads = sorted(
        (pair for pair in worth if pair[1] > 0), key=lambda pair: (-pair[1], str(pair[0].attribute))
    )
    trails = sorted(
        (pair for pair in worth if pair[1] < 0), key=lambda pair: (pair[1], str(pair[0].attribute))
    )
    lines, not_comparable = _pillar_lines(focus, comparator)
    if focus.score is None or comparator.score is None:
        # A line is a share of the gap between two totals, and either missing total leaves no
        # gap to share (C07-F). What could not be compared is still named.
        lines = ()
    return Synthesis(
        comparator=comparator.candidate,
        score_delta=_against_focus(focus.score, comparator.score),
        advantages=tuple(
            _sentence(row, comparator.candidate, contribution, names)
            for row, contribution in leads[:top]
        ),
        disadvantages=tuple(
            _sentence(row, comparator.candidate, contribution, names)
            for row, contribution in trails[:top]
        ),
        ahead=_most_worth_first([line for line in lines if line.worth > 0], top=top),
        behind=_most_worth_first([line for line in lines if line.worth < 0], top=top),
        not_comparable=not_comparable,
    )


def _pillar_lines(
    focus: CandidateResult, comparator: CandidateResult
) -> tuple[tuple[SynthesisLine, ...], tuple[PillarId, ...]]:
    """Each of the focus's pillars, in its order: a line where both sides have a score, and
    otherwise a pillar that cannot be compared.

    **Worth each side's own contribution** (C07-B), so a line is the matrix's "Weighted impact"
    for its pillar and carries each candidate's redistribution: a candidate missing a whole
    pillar weighs its others more, and its lines say so.
    """
    ours, theirs = _scored_contributions(focus), _scored_contributions(comparator)
    pillars = [pillar_score.pillar for pillar_score in focus.pillar_scores]
    worth = {pillar: _against_focus(ours.get(pillar), theirs.get(pillar)) for pillar in pillars}
    lines = tuple(
        SynthesisLine(pillar=pillar, worth=gap) for pillar, gap in worth.items() if gap is not None
    )
    return lines, tuple(pillar for pillar, gap in worth.items() if gap is None)


def _scored_contributions(result: CandidateResult) -> dict[PillarId, Decimal]:
    """What each pillar with a score put into the total. **A pillar nobody scored is absent,
    not zero**: its contribution is zero because nothing was measured, and subtracting it would
    list a gap no evidence stands behind (PL-099)."""
    return {
        pillar_score.pillar: pillar_score.contribution
        for pillar_score in result.pillar_scores
        if pillar_score.score is not None
    }


def _most_worth_first(lines: Sequence[SynthesisLine], *, top: int) -> tuple[SynthesisLine, ...]:
    """The `top` lines worth most either way. The sort is stable, so ties keep the focus's
    pillar order."""
    return tuple(sorted(lines, key=lambda line: -abs(line.worth))[:top])


def _sentence(
    row: AttributeComparison,
    comparator: CandidateId,
    contribution: Decimal,
    names: Mapping[str, str],
) -> str:
    """One line of the synthesis, restating the arithmetic of the row it came from: the
    comparator's score, against the focus's, and what the gap is worth comparator minus focus.

    **The comparator is named rather than assumed.** A first version took the first cell with a
    contribution, which quoted the first comparator's figures in every other comparator's
    sentences -- wrong in a way that reads perfectly.
    """
    attribute = str(row.attribute)
    their_score = next(
        cell.normalised_score for cell in row.comparators if cell.candidate == comparator
    )
    return (
        f"{names.get(attribute, attribute)}: {their_score} against {row.focus_score}, "
        f"worth {contribution:+.1f} points"
    )
