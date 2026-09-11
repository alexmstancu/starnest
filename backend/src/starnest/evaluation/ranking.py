"""One criteria set run against the candidates at one level (`reqs.md` 5).

The whole of scoring in one function, because every step depends on the one before it and the
order is the argument: figures, then scores, then redistribution, then the total, then rank.

**Normalisation is per criterion across all candidates, not per candidate.** `percentile` scores
a candidate by its standing among the others, so the column has to be assembled before any
candidate has a score. That is why this takes every candidate at once rather than being called
in a loop -- a per-candidate signature would make the relative method impossible to implement
and the mistake would only surface as scores that looked plausible.

**What is deliberately not here** (`docs/mine2e.md` M1): matching thresholds and the match rules
that produce `not_matching`; the three compound-rule shapes; `parent_not_matching`; and writing
any of it down. Every candidate that can be scored is therefore `matching`, and the first
ranking shows `matching` beside `insufficient_data` and nothing else. `not_matching` arrives
with the thresholds, which `reqs.md` 7.4 leaves TBD on purpose.
"""

from collections.abc import Mapping, Sequence
from decimal import ROUND_HALF_UP, Decimal

from starnest.candidates import CandidateId
from starnest.criteria import TOTAL, CriteriaSet, Criterion
from starnest.data import ConfidenceLevel, Value
from starnest.evaluation.magnitudes import PublishedFigure, UnscoreableValueError, figure_of
from starnest.evaluation.normalisation import scores_for
from starnest.evaluation.results import AttributeScore, CandidateResult, MatchStatus
from starnest.evaluation.weighting import confidence_split, coverage_of, redistribute

ValuesByCandidate = Mapping[str, Sequence[Value]]


class RankingError(ValueError):
    """The ranking could not be produced, and producing a wrong one is not the alternative."""


def rank_candidates(
    *,
    criteria: CriteriaSet,
    level: str,
    values: ValuesByCandidate,
    score_scale_max: int,
    min_coverage: Decimal | None = None,
) -> tuple[CandidateResult, ...]:
    """Score every candidate, and put them in order.

    `values` holds the ACTIVE values per candidate -- one per attribute, already chosen by the
    active-value rule (`arch.md` 4). Choosing between competing sources is a question about
    stored rows and belongs to `data/`; by the time a figure reaches here, which figure it is
    has been settled.

    `min_coverage` and `score_scale_max` are settings the user edits (`reqs.md` 3.10). Both
    arrive as arguments, and `score_scale_max` has no default: substituting 100 where the user
    has set nothing is the plausible-looking fabrication `devplan.md` 0.3 exists to forbid.
    """
    scored_criteria = _criteria_to_score(criteria, level)
    if not scored_criteria:
        raise RankingError(
            f"{criteria.id} scores nothing at level {level}, so there is no ranking to produce"
        )
    criteria.refuse_unless_its_anchors_fit(score_scale_max)

    weights = _level_wide_weights(criteria, scored_criteria, level)
    figures, confidences = _figures_by_criterion(scored_criteria, values)
    scores = _scores_by_criterion(scored_criteria, figures, score_scale_max=score_scale_max)

    results = tuple(
        _result_for(
            candidate,
            scored_criteria=scored_criteria,
            weights=weights,
            figures=figures,
            confidences=confidences,
            scores=scores,
            min_coverage=min_coverage,
        )
        for candidate in sorted(values)
    )
    return _ranked(results)


def _criteria_to_score(criteria: CriteriaSet, level: str) -> tuple[Criterion, ...]:
    """The criteria that count, at this level.

    Excluding a criterion is a decision that it does not apply, so it takes no weight and
    leaves no gap -- it is absent from everything downstream rather than present at zero
    (`reqs.md` 5.3).
    """
    return tuple(
        criterion
        for criterion in criteria.criteria
        if criterion.attribute.level_id == level and criterion.is_scored
    )


def _level_wide_weights(
    criteria: CriteriaSet, scored: Sequence[Criterion], level: str
) -> dict[str, Decimal]:
    """Each criterion's weight across the whole level, not just within its pillar.

    The two-level weighting flattened: a criterion's real share is its weight within its pillar
    times its pillar's weight within the level (`reqs.md` 7). Flattening once here means
    redistribution and coverage each have a single set of weights to work from, and a pillar
    that no candidate has any data for spreads its share like any other gap rather than needing
    a rule of its own.

    `CriteriaSet` has already refused a criterion whose pillar carries no weight at its own
    level, so the lookup below cannot miss. Re-checking here would be a branch no test could
    reach, which is worse than no check at all: it would read as a case that happens.
    """
    pillar_weights = {
        (weight.pillar, weight.level): weight.weight for weight in criteria.pillar_weights
    }
    return {
        str(criterion.attribute): criterion.weight
        * pillar_weights[(criterion.pillar, level)]
        / TOTAL
        for criterion in scored
    }


def _figures_by_criterion(
    scored: Sequence[Criterion], values: ValuesByCandidate
) -> tuple[dict[str, dict[str, PublishedFigure]], dict[str, dict[str, ConfidenceLevel]]]:
    """Every comparable figure, per criterion, per candidate -- and what each figure is worth.

    A value that carries no figure -- rejected, or of a type nothing can compare -- is simply
    absent, which is the same state as never having been fetched. That is deliberate: from the
    point of view of a score there is no difference between a figure nobody found and a figure
    that could not be read, and coverage reports both the same way.

    **The confidence travels beside the figure, not inside it.** Normalisation must never see
    it -- a low-confidence figure is not discounted (`reqs.md` 5.7) -- but the result has to say
    how much of a score rests on one, and after this point the value is gone.
    """
    by_attribute = {str(criterion.attribute): criterion for criterion in scored}
    figures: dict[str, dict[str, PublishedFigure]] = {attribute: {} for attribute in by_attribute}
    confidences: dict[str, dict[str, ConfidenceLevel]] = {
        attribute: {} for attribute in by_attribute
    }
    for candidate, candidate_values in values.items():
        for value in candidate_values:
            attribute = str(value.attribute)
            if attribute not in by_attribute:
                continue
            try:
                figures[attribute][candidate] = figure_of(value)
            except UnscoreableValueError:
                continue
            confidences[attribute][candidate] = value.confidence_level
    return figures, confidences


def _scores_by_criterion(
    scored: Sequence[Criterion],
    figures: Mapping[str, Mapping[str, PublishedFigure]],
    *,
    score_scale_max: int,
) -> dict[str, dict[str, int]]:
    """Each criterion's column of figures, normalised together.

    A criterion whose column cannot be normalised -- one candidate under `percentile`, a figure
    off the scale under `as_is` -- contributes nothing to anybody rather than failing the whole
    ranking. The candidates keep the coverage penalty for it, so the refusal is visible in the
    number beside the score rather than swallowed.
    """
    columns: dict[str, dict[str, int]] = {}
    for criterion in scored:
        attribute = str(criterion.attribute)
        answered = figures.get(attribute, {})
        candidates = sorted(answered)
        try:
            column = scores_for(
                [answered[candidate] for candidate in candidates],
                method=criterion.normalisation_method,
                goal=criterion.goal,
                score_scale_max=score_scale_max,
                anchors=criterion.scale_anchors,
                target=criterion.target_range,
            )
        except ValueError:
            columns[attribute] = {}
            continue
        columns[attribute] = dict(zip(candidates, column, strict=True))
    return columns


def _result_for(
    candidate: str,
    *,
    scored_criteria: Sequence[Criterion],
    weights: Mapping[str, Decimal],
    figures: Mapping[str, Mapping[str, PublishedFigure]],
    confidences: Mapping[str, Mapping[str, ConfidenceLevel]],
    scores: Mapping[str, Mapping[str, int]],
    min_coverage: Decimal | None,
) -> CandidateResult:
    answered = {
        str(criterion.attribute)
        for criterion in scored_criteria
        if candidate in scores.get(str(criterion.attribute), {})
    }
    # What was *found*, as distinct from what *scored*. The two differ when a figure exists and
    # its criterion's method could not place it, and the reason sentence has to know which.
    found = {
        str(criterion.attribute)
        for criterion in scored_criteria
        if candidate in figures.get(str(criterion.attribute), {})
    }
    coverage = coverage_of(weights, answered)
    resting_on = confidence_split(
        weights, {attribute: confidences[attribute][candidate] for attribute in answered}
    )
    effective = redistribute(weights, answered)

    breakdown = tuple(
        _attribute_score(criterion, candidate, effective=effective, scores=scores)
        for criterion in scored_criteria
    )
    refusal = _why_it_cannot_be_scored(
        scored_criteria, answered, found=found, coverage=coverage, min_coverage=min_coverage
    )
    if refusal is not None:
        return CandidateResult(
            candidate=CandidateId(candidate),
            score=None,
            coverage=coverage,
            coverage_by_confidence=resting_on,
            match_status=MatchStatus.INSUFFICIENT_DATA,
            attribute_scores=breakdown,
            insufficient_reason=refusal,
        )
    total = sum((row.contribution for row in breakdown), Decimal(0))
    return CandidateResult(
        candidate=CandidateId(candidate),
        score=int(total.quantize(Decimal(1), rounding=ROUND_HALF_UP)),
        coverage=coverage,
        coverage_by_confidence=resting_on,
        match_status=MatchStatus.MATCHING,
        attribute_scores=breakdown,
    )


def _attribute_score(
    criterion: Criterion,
    candidate: str,
    *,
    effective: Mapping[str, Decimal],
    scores: Mapping[str, Mapping[str, int]],
) -> AttributeScore:
    attribute = str(criterion.attribute)
    score = scores.get(attribute, {}).get(candidate)
    weight = effective[attribute]
    return AttributeScore(
        attribute=criterion.attribute,
        pillar=criterion.pillar,
        normalised_score=score,
        effective_weight=weight,
        contribution=Decimal(0) if score is None else Decimal(score) * weight / TOTAL,
    )


def _why_it_cannot_be_scored(
    scored_criteria: Sequence[Criterion],
    answered: set[str],
    *,
    found: set[str],
    coverage: Decimal,
    min_coverage: Decimal | None,
) -> str | None:
    """The sentence a screen shows instead of a score, or None when there is a score.

    Two floors, and they say different things (`reqs.md` 5.3). A blocking criterion is one the
    user declared the candidate unscoreable without, whatever else was found. The coverage floor
    is the general case: too little of what was asked for was answered for a total to mean
    anything.

    **A blocking criterion fails in one of two ways, and they are named apart.** Either no
    figure was found, and the fix is to fetch one; or a figure was found and its criterion's
    method could not place it -- the `fixed` method before its anchors are chosen, or
    `percentile` with a single candidate -- and fetching more changes nothing. Until 2026-09-11
    both read "no figure for", which was false for the second kind. It had stayed accidentally
    true only because every blocking `fixed` criterion also happened to have no data.
    """
    unanswered = [
        criterion
        for criterion in scored_criteria
        if criterion.blocks_if_missing and str(criterion.attribute) not in answered
    ]
    if unanswered:
        missing = sorted(str(c.attribute) for c in unanswered if str(c.attribute) not in found)
        unplaced = sorted(
            f"{c.attribute} (normalised {c.normalisation_method.value})"
            for c in unanswered
            if str(c.attribute) in found
        )
        problems = []
        if missing:
            problems.append("no figure for " + ", ".join(missing))
        if unplaced:
            problems.append("figures that could not be scored for " + ", ".join(unplaced))
        return (
            "; ".join(problems)
            + ", which this criteria set requires before scoring a candidate at all"
        )
    if coverage == 0:
        return (
            "no figure was found for any scored criterion, so there is nothing to compute a "
            "total from"
        )
    if min_coverage is not None and coverage < min_coverage:
        return (
            f"only {coverage:.0f}% of the scored weight was answered, against a floor of "
            f"{min_coverage:.0f}%"
        )
    return None


def _ranked(results: Sequence[CandidateResult]) -> tuple[CandidateResult, ...]:
    """Rank the scored candidates, leaving the unscored without one.

    **Equal scores share a rank**, and the next rank skips accordingly -- two candidates tied at
    first are both first and the next is third. Breaking a tie on candidate id would put one
    country above another for alphabetical reasons and show it as a finding.

    Unscored candidates keep their place in the returned order and carry `rank = None`. They are
    never filtered out: the reason a candidate is not scored is a thing this product exists to
    show (`reqs.md` 5.4).
    """
    scored = sorted(
        (result for result in results if result.score is not None),
        key=lambda result: -(result.score or 0),
    )
    ranks: dict[str, int] = {}
    for position, result in enumerate(scored, start=1):
        previous = scored[position - 2] if position > 1 else None
        ranks[str(result.candidate)] = (
            ranks[str(previous.candidate)]
            if previous is not None and previous.score == result.score
            else position
        )
    return tuple(
        result.model_copy(update={"rank": ranks.get(str(result.candidate))}) for result in results
    )
