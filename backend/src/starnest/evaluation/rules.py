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
from dataclasses import dataclass, field
from decimal import Decimal

from starnest.candidates import CandidateId
from starnest.criteria import Criterion
from starnest.criteria.thresholds import (
    BooleanThreshold,
    LabelThreshold,
    MatchingThreshold,
    RangeThreshold,
    ShareThreshold,
)
from starnest.data import (
    AssignedScore,
    AttributeId,
    Boolean,
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleId,
    CompoundRuleShape,
    LabelSet,
    MatchResult,
    MatchRule,
    MatchRuleId,
    MatchRuleResult,
    RuleOutcome,
    ShareComposition,
    Value,
)
from starnest.evaluation.magnitudes import UnscoreableValueError, threshold_reading
from starnest.evaluation.wording import (
    NO_NAMES,
    Names,
    attribute_called,
    band_in_words,
    band_words,
    figure_in_words,
    gate_called,
    place_called,
    quoted,
    readable_figure,
    readable_identifier,
    unit_words,
    yes_or_no,
)


@dataclass(frozen=True, kw_only=True)
class RuleWarning:
    """A flag beside a candidate: something worth knowing that rules nothing out.

    Exactly one of the two names the rule that raised it: a compound rule whose outcome is a
    warning, or a gate the criteria set holds as a warning rather than a gate (D56).
    """

    detail: str
    compound_rule: CompoundRuleId | None = None
    match_rule: MatchRuleId | None = None
    input_values: tuple[int, ...] = ()
    """The ids of the value rows the rule read to fire -- the source/date chain behind the
    flag. Frozen with a saved evaluation so the warning can be reopened to the figures that
    triggered it (ST-07). Empty when the caller passed figures without their value ids, and for
    a gate, which reads no value."""
    gate_answer: MatchRuleResult | None = None
    """The answer a gate held as a warning read, by its stored version -- the mirror of
    `NonMatch.gate_answer`. None for a compound rule, and for a gate decided by citizenship."""
    citizenships: tuple[CandidateId, ...] = ()
    """The household citizenships a gate decided by citizenship read in place of an answer,
    none of which clears it (Q239). Empty for anything else."""


@dataclass(frozen=True)
class NonMatch:
    """Why a candidate does not match. Exactly one of the three names the rule that said so."""

    reason_detail: str
    criterion: AttributeId | None = None
    match_rule: MatchRuleId | None = None
    compound_rule: CompoundRuleId | None = None
    input_values: tuple[int, ...] = ()
    """The ids of the value rows the rule judged, so a saved non-match can be reopened to the
    figures that produced it (ST-07, FU-A3): a compound rule's inputs in condition order -- the
    mirror of `RuleWarning.input_values` -- or the one row a criterion threshold judged. Empty
    for a gate, which reads no value, and when the caller passed figures without their ids."""
    gate_answer: MatchRuleResult | None = None
    """The answer a gate refusal read (FU-A4). Its `id` names the stored version, which never
    changes, so a saved refusal reopens to this answer after any correction (`reqs.md` Q237).
    None for a threshold or a compound rule, on refusals saved before versions existed, and for
    a gate decided by citizenship."""
    citizenships: tuple[CandidateId, ...] = ()
    """The household citizenships a gate decided by citizenship read in place of an answer,
    none of which clears it (Q239). Empty for anything else."""


@dataclass(frozen=True, kw_only=True)
class Citizenship:
    """The household's citizenships against the gates' catalog, for one candidate (Q239).

    **Which citizenship clears which gate is catalog data** (`reqs.md` 7.3): a gate names the
    citizenships that clear it, and one decided by citizenship -- EU free movement -- does not
    match where none of the household's clears it. Both only where the gate concerns the
    candidate. **No citizenship recorded decides nothing**: the gates then read their recorded
    answers as they always did, because deriving a refusal from an absent household would be
    the fabricated judgement this application exists to prevent.
    """

    candidate: str = ""
    held: frozenset[CandidateId] = frozenset()
    gates: Mapping[str, MatchRule] = field(default_factory=dict)

    def clears(self, gate: str) -> bool:
        rule = self.gates.get(gate)
        return rule is not None and rule.is_cleared_for(self.candidate, self.held)

    def refuses(self, gate: str) -> bool:
        rule = self.gates.get(gate)
        return (
            rule is not None
            and rule.decided_by_citizenship
            and bool(self.held)
            and rule.concerns(self.candidate)
            and not self.clears(gate)
        )


NO_CITIZENSHIP = Citizenship()


def judgements_of(
    *,
    rules: Sequence[CompoundRule],
    figures: Mapping[str, Decimal],
    level: str,
    value_ids: Mapping[str, int] | None = None,
    names: Names = NO_NAMES,
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
                detail=_detail(rule, figures, names),
                input_values=_inputs_read(rule, sources),
            )
            for rule in fired
            if rule.outcome is RuleOutcome.WARNING
        ),
        tuple(
            NonMatch(
                compound_rule=rule.id,
                reason_detail=_detail(rule, figures, names),
                input_values=_inputs_read(rule, sources),
            )
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


def _detail(rule: CompoundRule, figures: Mapping[str, Decimal], names: Names) -> str:
    """Why it fired, in the figures that made it fire, so the reader can check it.

    "Mild now, brutal later: Projected summer heat days 36.91 days per year, at least 25". Each
    figure is printed at a readable precision with its unit, and its band in words (PL-067).
    """
    return f"{rule.name}: " + "; ".join(
        f"{condition.attribute_name or attribute_called(names, str(condition.attribute))}"
        f" {_figure(figures.get(str(condition.attribute)), str(condition.attribute), names)},"
        f" {band_words(condition.threshold_min, condition.threshold_max)}"
        for condition in rule.conditions
    )


def _figure(figure: Decimal | None, attribute: str, names: Names) -> str:
    """The figure that fired the rule. A derived one -- the estimated tax rate is a division,
    arriving as `43.32847052546540994843612212` -- reads "43.33"."""
    return "no figure" if figure is None else figure_in_words(names, attribute, figure)


def describe_compound_rule(rule: CompoundRule, names: Names = NO_NAMES) -> str:
    """What a rule tests, in words, for its row on screen (PL-155, UF-039).

    Written from the rule's own conditions or inputs whenever it is read, so it cannot disagree
    with the bands it describes; every attribute by its catalog name, never its key. "Applies
    when Cost of living index is at most 80 and Total tax rate is at least 40%."

    **It says what the rule tests, never what it does**: each criteria set holds a rule as a
    gate or as a warning (0516), so an outcome written here from the catalog would contradict
    every set that holds it the other way. The row's own select says which it is.
    """
    return f"Applies when {_what_it_tests(rule, names)}."


def _what_it_tests(rule: CompoundRule, names: Names) -> str:
    """The condition each shape fires on, as `reqs.md` 3.7a defines it."""
    if rule.shape is CompoundRuleShape.ALL_CONDITIONS_HOLD:
        return " and ".join(_condition_in_words(condition, names) for condition in rule.conditions)
    measured = " plus ".join(
        attribute_called(names, str(read.attribute))
        for read in rule.inputs
        if read.attribute is not None
    )
    if rule.shape is CompoundRuleShape.SHARE_OF_HOUSEHOLD_FIELD:
        fields = " and ".join(
            unit_words(readable_identifier(str(read.household_field)))
            for read in rule.inputs
            if read.household_field is not None
        )
        share = (
            "a share not yet chosen"
            if rule.threshold_max is None
            else f"{readable_figure(rule.threshold_max * 100)}%"
        )
        return f"{measured} is more than {share} of the household's {fields}"
    floor = (
        "a floor not yet chosen"
        if rule.threshold_min is None
        else readable_figure(rule.threshold_min)
    )
    return f"{measured} is below {floor}"


def _condition_in_words(condition: CompoundRuleCondition, names: Names) -> str:
    """ "Total tax rate is at least 40%", or "... has no bound set" where nobody chose one."""
    attribute = str(condition.attribute)
    called = condition.attribute_name or attribute_called(names, attribute)
    if condition.threshold_min is None and condition.threshold_max is None:
        return f"{called} has no bound set"
    band = band_in_words(names, attribute, condition.threshold_min, condition.threshold_max)
    return f"{called} is {band}"


def gates_that_rule_out(
    *,
    enforced: Sequence[MatchRuleId],
    answers: Sequence[MatchRuleResult],
    names: Names = NO_NAMES,
    citizenship: Citizenship = NO_CITIZENSHIP,
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

    **The household's citizenships come first** (Q239): a gate one of them clears rules nothing
    out whatever was recorded, and a gate decided by citizenship that none clears rules out with
    no answer at all, naming the citizenships it read.
    """
    return tuple(
        NonMatch(match_rule=rule, reason_detail=detail, gate_answer=answer, citizenships=held)
        for rule, answer, detail, held in _gates_failed(enforced, answers, names, citizenship)
    )


def gates_that_warn(
    *,
    held_as_warnings: Sequence[MatchRuleId],
    answers: Sequence[MatchRuleResult],
    names: Names = NO_NAMES,
    citizenship: Citizenship = NO_CITIZENSHIP,
) -> tuple[RuleWarning, ...]:
    """The gates a set holds as warnings that a candidate fails (D56).

    The same failures `gates_that_rule_out` reads -- a confirmed `not_matching` answer, never
    `unknown` and never a proposal -- reported as a flag that keeps the candidate matching.
    """
    return tuple(
        RuleWarning(match_rule=rule, detail=detail, gate_answer=answer, citizenships=held)
        for rule, answer, detail, held in _gates_failed(
            held_as_warnings, answers, names, citizenship
        )
    )


_GateFailure = tuple[MatchRuleId, MatchRuleResult | None, str, tuple[CandidateId, ...]]


def _gates_failed(
    gates: Sequence[MatchRuleId],
    answers: Sequence[MatchRuleResult],
    names: Names,
    citizenship: Citizenship,
) -> tuple[_GateFailure, ...]:
    """Each of these gates the candidate fails, in the order given, with why in words: by the
    household's citizenships where they decide it, by its recorded answer otherwise."""
    failed = {
        answer.match_rule: answer
        for answer in answers
        if answer.match_result is MatchResult.NOT_MATCHING and not answer.is_proposal
    }
    failures: list[_GateFailure] = []
    for rule in gates:
        if citizenship.clears(str(rule)):
            continue
        if citizenship.refuses(str(rule)):
            held = tuple(sorted(citizenship.held))
            failures.append((rule, None, _not_cleared(str(rule), held, names), held))
        elif rule in failed:
            detail = (
                failed[rule].reason
                or f"{gate_called(names, str(rule))} answered not matching, with no reason recorded"
            )
            failures.append((rule, failed[rule], detail, ()))
    return tuple(failures)


def _not_cleared(gate: str, held: Sequence[CandidateId], names: Names) -> str:
    """ "EU/EEA free movement: no citizenship the household holds (United Kingdom) clears it"."""
    places = ", ".join(place_called(names, str(place)) for place in held)
    return f"{gate_called(names, gate)}: no citizenship the household holds ({places}) clears it"


def thresholds_that_rule_out(
    criteria: Sequence[Criterion],
    values: Sequence[Value],
    names: Names = NO_NAMES,
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
    is present and on the wrong side of the line produces a `NonMatch`, named by its criterion
    and carrying the id of the very value it judged (FU-A3), whatever its type.
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
        reason = _crosses(threshold, value, names)
        if reason is not None:
            reasons.append(
                NonMatch(
                    criterion=criterion.attribute,
                    reason_detail=reason,
                    input_values=() if value.id is None else (value.id,),
                )
            )
    return tuple(reasons)


def _reading_in_words(value: Value, reading: Decimal, names: Names) -> str:
    """ "70% of its scale (7 on 0 to 10)" for an assigned score; the figure and unit otherwise."""
    if isinstance(value.payload, AssignedScore):
        given = value.payload
        return (
            f"{readable_figure(reading)}% of its scale ({readable_figure(given.value)} on "
            f"{readable_figure(given.range_min)} to {readable_figure(given.range_max)})"
        )
    return figure_in_words(names, str(value.attribute), reading)


def _bound_in_words(value: Value, bound: Decimal, names: Names) -> str:
    if isinstance(value.payload, AssignedScore):
        return f"{readable_figure(bound)}%"
    return figure_in_words(names, str(value.attribute), bound)


def _crosses(threshold: MatchingThreshold, value: Value, names: Names) -> str | None:
    """Why the value is on the wrong side of the line, or None when it is admitted or cannot be
    judged -- no figure, a rejected value, or a payload of a shape this threshold does not read.

    A payload mismatch cannot normally happen -- a criterion refuses a threshold that does not
    suit its value type, and a value's type matches its criterion -- so the `isinstance` guards
    are a safe default, never a silent rule-out, for a row written past the domain.

    **In words** (PL-067): the attribute as the catalog names it, the figure with its unit and
    at a readable precision, a label in quotes rather than as a Python repr. An assigned score
    is judged and worded as a percentage of its own scale (C06-S1), with the figure as given.
    """
    attribute = str(value.attribute)
    called = attribute_called(names, attribute)
    if isinstance(threshold, RangeThreshold):
        try:
            figure = threshold_reading(value)
        except UnscoreableValueError:
            return None
        if threshold.min_value is not None and figure < threshold.min_value:
            return (
                f"{called} is {_reading_in_words(value, figure, names)}, below your minimum of "
                f"{_bound_in_words(value, threshold.min_value, names)}"
            )
        if threshold.max_value is not None and figure > threshold.max_value:
            return (
                f"{called} is {_reading_in_words(value, figure, names)}, above your maximum of "
                f"{_bound_in_words(value, threshold.max_value, names)}"
            )
        return None
    if isinstance(threshold, LabelThreshold):
        if not isinstance(value.payload, LabelSet):
            return None
        present = threshold.label in value.payload.labels
        if threshold.containment_rule == "must_contain" and not present:
            return f"{called} does not include {quoted(threshold.label)}, which you require"
        if threshold.containment_rule == "must_not_contain" and present:
            return f"{called} includes {quoted(threshold.label)}, which you ruled out"
        return None
    if isinstance(threshold, BooleanThreshold):
        if not isinstance(value.payload, Boolean):
            return None
        if value.payload.value != threshold.required_value:
            return (
                f"{called} is {yes_or_no(value.payload.value)}, "
                f"and you require {yes_or_no(threshold.required_value)}"
            )
        return None
    if isinstance(threshold, ShareThreshold):
        if not isinstance(value.payload, ShareComposition):
            return None
        share = next(
            (slice_.share for slice_ in value.payload.shares if slice_.label == threshold.label),
            Decimal(0),
        )
        part = f"{quoted(threshold.label)} in {called}"
        if threshold.min_share is not None and share < threshold.min_share:
            return (
                f"{part} is {readable_figure(share)}%, below your minimum of "
                f"{readable_figure(threshold.min_share)}%"
            )
        if threshold.max_share is not None and share > threshold.max_share:
            return (
                f"{part} is {readable_figure(share)}%, above your maximum of "
                f"{readable_figure(threshold.max_share)}%"
            )
        return None
    return None
