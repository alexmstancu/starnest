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
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from starnest.candidates import CandidateId
from starnest.criteria import TOTAL, CriteriaSet, Criterion
from starnest.data import CompoundRule, ConfidenceLevel, MatchRuleResult, Value
from starnest.evaluation.magnitudes import PublishedFigure, UnscoreableValueError, figure_of
from starnest.evaluation.normalisation import scores_for
from starnest.evaluation.results import AttributeScore, CandidateResult, MatchStatus
from starnest.evaluation.rules import gates_that_rule_out, judgements_of
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
    compound_rules: Sequence[CompoundRule] = (),
    gate_answers: Mapping[str, Sequence[MatchRuleResult]] = {},
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
    readings = _readings_by_criterion(scored_criteria, values)
    scores = _scores_by_criterion(scored_criteria, readings, score_scale_max=score_scale_max)

    # **Which compound rules a set applies is a preference** (`reqs.md` 3.7a), on the same
    # footing as which gates it enforces: "whether rent-against-spend concerns you". The gate
    # half of `_result_for` has always filtered on `enforced_match_rules`; this half applied
    # whatever the catalog held at the level, so a rule one set opted out of still raised
    # warnings -- and, with an outcome of `not_matching`, still removed countries -- from every
    # other set's ranking (P43). Narrowed once here rather than per candidate: it is a property
    # of the set, and the answer is the same for all 32.
    applied = tuple(rule for rule in compound_rules if rule.id in criteria.applied_compound_rules)

    results = tuple(
        _result_for(
            candidate,
            scored_criteria=scored_criteria,
            weights=weights,
            readings=readings,
            scores=scores,
            min_coverage=min_coverage,
            criteria=criteria,
            compound_rules=applied,
            figures=_magnitudes_of(values.get(candidate, ())),
            gate_answers=gate_answers.get(candidate, ()),
            level=level,
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


@dataclass(frozen=True)
class Reading:
    """One value as scoring sees it: the figure, what it is worth, and which row it came from.

    The three travel together because they are one value's three answers, and the last two stay
    out of the arithmetic: normalisation never sees a confidence -- a low-confidence figure is
    not discounted (`reqs.md` 5.7) -- and never sees an identifier. Both are needed afterwards.
    The result says how much of a score rests on a weak figure, and a saved evaluation pins the
    exact row behind every contribution, which closes the provenance chain from a total down to
    a source and a date.
    """

    figure: PublishedFigure
    confidence: ConfidenceLevel
    value: int | None


def _readings_by_criterion(
    scored: Sequence[Criterion], values: ValuesByCandidate
) -> dict[str, dict[str, Reading]]:
    """Every comparable figure, per criterion, per candidate.

    A value that carries no figure -- rejected, or of a type nothing can compare -- is simply
    absent, which is the same state as never having been fetched. That is deliberate: from the
    point of view of a score there is no difference between a figure nobody found and a figure
    that could not be read, and coverage reports both the same way.
    """
    by_attribute = {str(criterion.attribute): criterion for criterion in scored}
    readings: dict[str, dict[str, Reading]] = {attribute: {} for attribute in by_attribute}
    for candidate, candidate_values in values.items():
        for value in candidate_values:
            attribute = str(value.attribute)
            if attribute not in by_attribute:
                continue
            try:
                figure = figure_of(value)
            except UnscoreableValueError:
                continue
            readings[attribute][candidate] = Reading(
                figure=figure, confidence=value.confidence_level, value=value.id
            )
    return readings


def _magnitudes_of(values: Sequence[Value]) -> dict[str, Decimal]:
    """Every figure this candidate has, by attribute -- whatever any criterion makes of it.

    **What a compound rule reads, and deliberately wider than what scoring reads** (P46). The
    rules used to be handed the *scored* readings, so a rule could only see an attribute that
    carried a scored criterion: unticking a criterion silently disabled every rule reading it,
    and a rule over a descriptive attribute -- which by definition has no criterion (`reqs.md`
    3.0) -- could never fire at all. Both are things `reqs.md` 3.7a says a rule may do.

    A value nothing can compare is absent rather than zero, and `_holds` treats an absent figure
    as a condition that does not hold: an unmeasured condition is not a satisfied one.
    """
    magnitudes: dict[str, Decimal] = {}
    for value in values:
        try:
            magnitudes[str(value.attribute)] = figure_of(value).magnitude
        except UnscoreableValueError:
            continue
    return magnitudes


def _scores_by_criterion(
    scored: Sequence[Criterion],
    readings: Mapping[str, Mapping[str, Reading]],
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
        answered = readings.get(attribute, {})
        candidates = sorted(answered)
        try:
            column = scores_for(
                [answered[candidate].figure for candidate in candidates],
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
    readings: Mapping[str, Mapping[str, Reading]],
    scores: Mapping[str, Mapping[str, int]],
    min_coverage: Decimal | None,
    criteria: CriteriaSet,
    compound_rules: Sequence[CompoundRule],
    figures: Mapping[str, Decimal],
    gate_answers: Sequence[MatchRuleResult],
    level: str,
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
        if candidate in readings.get(str(criterion.attribute), {})
    }
    coverage = coverage_of(weights, answered)
    resting_on = confidence_split(
        weights,
        {attribute: readings[attribute][candidate].confidence for attribute in answered},
    )
    effective = redistribute(weights, answered)

    breakdown = tuple(
        _attribute_score(
            criterion, candidate, effective=effective, scores=scores, readings=readings
        )
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
    warnings, ruled_out_by_a_rule = judgements_of(
        rules=compound_rules, figures=figures, level=level
    )
    refusals = (
        gates_that_rule_out(enforced=criteria.enforced_match_rules, answers=gate_answers)
        + ruled_out_by_a_rule
    )
    return CandidateResult(
        candidate=CandidateId(candidate),
        score=int(total.quantize(Decimal(1), rounding=ROUND_HALF_UP)),
        coverage=coverage,
        coverage_by_confidence=resting_on,
        # A candidate that does not match keeps its score and stays visible, with the reason
        # beside it (`reqs.md` 5.4).
        match_status=MatchStatus.NOT_MATCHING if refusals else MatchStatus.MATCHING,
        attribute_scores=breakdown,
        warnings=warnings,
        non_match_reasons=refusals,
    )


def _attribute_score(
    criterion: Criterion,
    candidate: str,
    *,
    effective: Mapping[str, Decimal],
    scores: Mapping[str, Mapping[str, int]],
    readings: Mapping[str, Mapping[str, Reading]],
) -> AttributeScore:
    attribute = str(criterion.attribute)
    score = scores.get(attribute, {}).get(candidate)
    weight = effective[attribute]
    reading = readings.get(attribute, {}).get(candidate)
    return AttributeScore(
        attribute=criterion.attribute,
        pillar=criterion.pillar,
        normalised_score=score,
        effective_weight=weight,
        contribution=Decimal(0) if score is None else Decimal(score) * weight / TOTAL,
        # Only where the figure was actually scored: a reading that no method could place
        # contributed nothing, and naming the row it came from would suggest otherwise.
        used_value=reading.value if reading is not None and score is not None else None,
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
        (
            result
            for result in results
            # A ranked candidate is one in the running: a non-matching one keeps its score and
            # its place in the list, and carries no rank (`openapi.yaml`, CandidateResult.rank).
            if result.score is not None and result.match_status is MatchStatus.MATCHING
        ),
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
