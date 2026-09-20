"""What the rules say about one candidate: warnings, and the gates that rule it out.

`reqs.md` 3.7, 3.7a and 5.4. Two mechanisms produce a non-match and both feed **one** reporting
surface, so the reader never looks in two places: a **match rule** is a named gate answered by
research (a visa route, a quota, a manual exclusion), and a **compound rule** reads more than one
figure at once. A compound rule's outcome says which it is -- a warning flags without ruling
anything out, and never changes a score.

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

from starnest.data import (
    AttributeId,
    CompoundRule,
    CompoundRuleId,
    CompoundRuleShape,
    MatchResult,
    MatchRuleId,
    MatchRuleResult,
    RuleOutcome,
)


@dataclass(frozen=True)
class RuleWarning:
    """A flag beside a candidate: something worth knowing that rules nothing out."""

    compound_rule: CompoundRuleId
    detail: str


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
) -> tuple[tuple[RuleWarning, ...], tuple[NonMatch, ...]]:
    """Every compound rule that fires for one candidate, split by what its outcome does.

    A rule that reads a figure the candidate does not have cannot hold: an unmeasured condition
    is not a satisfied one, and treating absence as agreement would flag candidates for what
    nobody found.
    """
    fired = [
        rule
        for rule in rules
        if rule.applies_at(level) and rule.is_decided and _holds(rule, figures)
    ]
    return (
        tuple(
            RuleWarning(compound_rule=rule.id, detail=_detail(rule, figures))
            for rule in fired
            if rule.outcome is RuleOutcome.WARNING
        ),
        tuple(
            NonMatch(compound_rule=rule.id, reason_detail=_detail(rule, figures))
            for rule in fired
            if rule.outcome is RuleOutcome.NOT_MATCHING
        ),
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
        f"{condition.attribute} {_figure(figures.get(str(condition.attribute)))}"
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
