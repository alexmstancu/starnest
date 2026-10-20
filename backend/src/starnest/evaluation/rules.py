"""What the rules say about one candidate: warnings, and the gates that rule it out.

`reqs.md` 3.7, 3.7a, 5.2 and 5.4. Three mechanisms produce a non-match and all feed **one**
reporting surface, so the reader never looks in more than one place: a **match rule** is a named
gate answered by research (a visa route, a quota, a manual exclusion), a **compound rule** reads
more than one figure at once, and a **matching threshold** is a single criterion's own hard line
on its one attribute's figure (`reqs.md` 5.2). A compound rule's outcome says which it is -- a
warning flags without ruling anything out, and never changes a score.

**An undecided rule does not fire** (`reqs.md` 7.4, `devplan.md` D5). Every threshold the MVP
ships is TBD, and firing one on an invented number is exactly the fabricated judgement this
application exists to prevent. Both shipped compound rules are therefore silent until the
household chooses their numbers, and that silence is the intended state rather than a gap.

**A candidate that does not match keeps its score** and stays visible with the reason
(`reqs.md` 5.4). Nothing here filters anything out.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from starnest.criteria import Criterion
from starnest.criteria.thresholds import (
    BooleanThreshold,
    LabelThreshold,
    MatchingThreshold,
    RangeThreshold,
    ShareThreshold,
)
from starnest.data import (
    AttributeId,
    Boolean,
    CompoundRule,
    CompoundRuleId,
    CompoundRuleShape,
    LabelSet,
    MatchResult,
    MatchRuleId,
    MatchRuleResult,
    RuleOutcome,
    ShareComposition,
    Value,
)
from starnest.evaluation.magnitudes import UnscoreableValueError, magnitude_of


@dataclass(frozen=True)
class RuleWarning:
    """A flag beside a candidate: something worth knowing that rules nothing out."""

    compound_rule: CompoundRuleId
    detail: str
    input_values: tuple[int, ...] = ()
    """The ids of the value rows the rule read to fire -- the source/date chain behind the
    flag. Frozen with a saved evaluation so the warning can be reopened to the figures that
    triggered it (ST-07). Empty when the caller passed figures without their value ids."""


@dataclass(frozen=True)
class NonMatch:
    """Why a candidate does not match. Exactly one of the three names the rule that said so."""

    reason_detail: str
    criterion: AttributeId | None = None
    match_rule: MatchRuleId | None = None
    compound_rule: CompoundRuleId | None = None


def judgements_of(
    *,
    rules: Sequence[CompoundRule],
    figures: Mapping[str, Decimal],
    level: str,
    value_ids: Mapping[str, int] | None = None,
) -> tuple[tuple[RuleWarning, ...], tuple[NonMatch, ...]]:
    """Every compound rule that fires for one candidate, split by what its outcome does.

    A rule that reads a figure the candidate does not have cannot hold: an unmeasured condition
    is not a satisfied one, and treating absence as agreement would flag candidates for what
    nobody found.

    `value_ids` maps each attribute to the id of the value its figure came from, so a warning can
    record the rows it read (ST-07). Optional: a caller that tracks no ids -- a test passing bare
    magnitudes -- leaves a warning's `input_values` empty, which is the honest "unknown chain".
    """
    sources = value_ids or {}
    fired = [
        rule
        for rule in rules
        if rule.applies_at(level) and rule.is_decided and _holds(rule, figures)
    ]
    return (
        tuple(
            RuleWarning(
                compound_rule=rule.id,
                detail=_detail(rule, figures),
                input_values=_inputs_read(rule, sources),
            )
            for rule in fired
            if rule.outcome is RuleOutcome.WARNING
        ),
        tuple(
            NonMatch(compound_rule=rule.id, reason_detail=_detail(rule, figures))
            for rule in fired
            if rule.outcome is RuleOutcome.NOT_MATCHING
        ),
    )


def _inputs_read(rule: CompoundRule, value_ids: Mapping[str, int]) -> tuple[int, ...]:
    """The value ids behind the figures this rule's conditions read, in condition order. A
    condition whose attribute has no id on record contributes nothing -- the rule still fired on
    its magnitude, but there is no row to point at."""
    return tuple(
        value_ids[str(condition.attribute)]
        for condition in rule.conditions
        if str(condition.attribute) in value_ids
    )


def _holds(rule: CompoundRule, figures: Mapping[str, Decimal]) -> bool:
    """Whether the rule's comparison is true of these figures.

    Only `AllConditionsHold` is implemented, and it is the only shape the country level ships.
    The other two read a household field and a sum of inputs; they belong to the city level and
    arrive with it (`devplan.md` W2-A). A rule of an unimplemented shape is left silent rather
    than guessed at, which is the same rule as an undecided one.
    """
    if rule.shape is not CompoundRuleShape.ALL_CONDITIONS_HOLD:
        return False
    return all(
        _within(
            figures.get(str(condition.attribute)), condition.threshold_min, condition.threshold_max
        )
        for condition in rule.conditions
    )


def _within(figure: Decimal | None, minimum: Decimal | None, maximum: Decimal | None) -> bool:
    """Both bounds inclusive, either unbounded, and a missing figure never satisfies."""
    if figure is None:
        return False
    if minimum is not None and figure < minimum:
        return False
    return not (maximum is not None and figure > maximum)


def _detail(rule: CompoundRule, figures: Mapping[str, Decimal]) -> str:
    """Why it fired, in the figures that made it fire, so the reader can check it."""
    return f"{rule.name}: " + ", ".join(
        f"{condition.names_the_attribute}"
        f" {_figure(figures.get(str(condition.attribute)))}"
        f" within {_bound(condition.threshold_min)} to {_bound(condition.threshold_max)}"
        for condition in rule.conditions
    )


_READABLE_DECIMALS = 4
"""Past anything the catalog measures, and short enough to read in a table cell."""


def _bound(bound: Decimal | None) -> str:
    return "any" if bound is None else f"{bound:g}"


def _figure(figure: Decimal | None) -> str:
    """The figure that fired the rule, at a precision a person can read.

    **The bounds were formatted and the figures were not**, which only showed once a derived
    figure reached a rule: the estimated tax rate is a division, so it arrives as
    `43.32847052546540994843612212` and the warning printed all 26 digits.

    **It only ever shortens.** A figure already at a sane precision is printed exactly as it
    arrived -- 52.0 stays "52.0", not "52" -- because how many decimals a publisher printed is
    itself information. Only a figure carrying more than four is rounded. `normalize()` is
    deliberately not used to tidy trailing zeros: it renders 60 as `6E+1`.
    """
    if figure is None:
        return "no figure"
    decimals = -figure.as_tuple().exponent
    if isinstance(decimals, int) and decimals > _READABLE_DECIMALS:
        figure = figure.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return f"{figure:f}"


def gates_that_rule_out(
    *,
    enforced: Sequence[MatchRuleId],
    answers: Sequence[MatchRuleResult],
) -> tuple[NonMatch, ...]:
    """The enforced gates a candidate fails, in the order the criteria set enforces them.

    **Only an answer of `not_matching` rules anything out.** `unknown` is a gate nobody has
    researched yet, and treating it as a failure would exclude a candidate for what has not been
    looked into -- the opposite of what an unanswered question means.

    **And only a confirmed answer.** A gate a model researched is a *proposal* until a human
    writes it (`reqs.md` 6.10 use 3): it is displayed with its sources so somebody can check it,
    and it rules nothing out in the meantime. Excluding a country because a model said so, with
    nobody having looked, is the exact failure the whole inventory of permitted LLM uses exists
    to prevent.

    A gate the criteria set does not enforce is not consulted: whether a gate counts is the
    set's preference, and the answer itself is a finding about the candidate (`arch.md` 3.6).
    """
    failed = {
        answer.match_rule: answer
        for answer in answers
        if answer.match_result is MatchResult.NOT_MATCHING and not answer.is_proposal
    }
    return tuple(
        NonMatch(
            match_rule=rule,
            reason_detail=failed[rule].reason or f"{rule} answers not_matching for this candidate",
        )
        for rule in enforced
        if rule in failed
    )


def thresholds_that_rule_out(
    criteria: Sequence[Criterion],
    values: Sequence[Value],
) -> tuple[NonMatch, ...]:
    """The criteria whose matching threshold this candidate's value crosses (`reqs.md` 5.2).

    The third way a candidate does not match, beside a gate and a compound rule, and the only one
    tied to a single attribute's own figure. **A threshold the household set is decided by having
    been set** -- there is no TBD number to leave undecided as a compound rule has -- so it fires
    as soon as a value crosses it.

    **Every criterion is judged, scored or not.** Excluding a criterion takes it out of the
    weights and the coverage, never out of matching (BE-01), so `criteria` is the whole level
    rather than what scores.

    **A missing or unplaceable figure never rules out.** You cannot cross a line you have no
    figure for; that is insufficient coverage, not a non-match (`reqs.md` 5.3). Only a value that
    is present and on the wrong side of the line produces a `NonMatch`, named by its criterion.
    """
    by_attribute = {str(value.attribute): value for value in values}
    reasons = []
    for criterion in criteria:
        threshold = criterion.matching_threshold
        if threshold is None:
            continue
        value = by_attribute.get(str(criterion.attribute))
        if value is None:
            continue
        reason = _crosses(threshold, value)
        if reason is not None:
            reasons.append(NonMatch(criterion=criterion.attribute, reason_detail=reason))
    return tuple(reasons)


def _crosses(threshold: MatchingThreshold, value: Value) -> str | None:
    """Why the value is on the wrong side of the line, or None when it is admitted or cannot be
    judged -- no figure, a rejected value, or a payload of a shape this threshold does not read.

    A payload mismatch cannot normally happen -- a criterion refuses a threshold that does not
    suit its value type, and a value's type matches its criterion -- so the `isinstance` guards
    are a safe default, never a silent rule-out, for a row written past the domain.
    """
    if isinstance(threshold, RangeThreshold):
        try:
            figure = magnitude_of(value)
        except UnscoreableValueError:
            return None
        if threshold.min_value is not None and figure < threshold.min_value:
            return f"{value.attribute} is {figure:g}, below your minimum of {threshold.min_value:g}"
        if threshold.max_value is not None and figure > threshold.max_value:
            return f"{value.attribute} is {figure:g}, above your maximum of {threshold.max_value:g}"
        return None
    if isinstance(threshold, LabelThreshold):
        if not isinstance(value.payload, LabelSet):
            return None
        present = threshold.label in value.payload.labels
        if threshold.containment_rule == "must_contain" and not present:
            return f"{value.attribute} does not carry {threshold.label!r}, which you require"
        if threshold.containment_rule == "must_not_contain" and present:
            return f"{value.attribute} carries {threshold.label!r}, which you ruled out"
        return None
    if isinstance(threshold, BooleanThreshold):
        if not isinstance(value.payload, Boolean):
            return None
        if value.payload.value != threshold.required_value:
            return (
                f"{value.attribute} is {value.payload.value}, "
                f"and you require {threshold.required_value}"
            )
        return None
    if isinstance(threshold, ShareThreshold):
        if not isinstance(value.payload, ShareComposition):
            return None
        share = next(
            (slice_.share for slice_ in value.payload.shares if slice_.label == threshold.label),
            Decimal(0),
        )
        if threshold.min_share is not None and share < threshold.min_share:
            return (
                f"{threshold.label!r} is {share:g}%, below your minimum of {threshold.min_share:g}%"
            )
        if threshold.max_share is not None and share > threshold.max_share:
            return (
                f"{threshold.label!r} is {share:g}%, above your maximum of {threshold.max_share:g}%"
            )
        return None
    return None
