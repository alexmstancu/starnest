"""The named gates a candidate passes or fails, and the rules that read more than one figure.

`reqs.md` 3.7 and 3.7a. Both catalogs are **objective**, which is why they are here: whether a
visa route exists, and whether two figures read together say something neither says alone, are
facts about the world. Whether a gate is *enforced* and whether a compound rule is *applied*
are preferences, and both live in a criteria set (`arch.md` 3.6) -- a module this one may not
import.

**The comparison is code; the rule is data.** `CompoundRuleShape` names three comparisons and
performs none of them: the implementations belong to `evaluation/` (`devplan.md` W2-A). Every
field below is a parameter and none is an instruction, which is the guardrail of `reqs.md` 3.0
-- there is no operator, no connective and no nesting, because those would be a small
expression language and the first rule needing an "or" would break its grammar.

**A rule whose numbers are still TBD ships with them absent and cannot fire** (`reqs.md` 7.4,
`devplan.md` 0.3 rule 2). Nothing here requires a bound or supplies a default. `is_decided` is
how a caller asks whether anybody has finished writing the rule, and both compound rules the
MVP ships answer no.
"""

from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.candidates import CandidateId, LevelId
from starnest.data.identifiers import (
    AttributeId,
    CatalogId,
    CompoundRuleId,
    DataSourceId,
    MatchRuleId,
)
from starnest.data.reference_period import ReferencePeriod


class MalformedMatchRuleResultError(ValueError):
    """A gate's answer contradicts itself: a half-recorded override, or a moment with no zone."""


class CompoundRuleDeclarationError(ValueError):
    """A catalog row carries something its shape has no meaning for."""


class MatchResult(StrEnum):
    """What one gate says about one candidate.

    **Close to the evaluation's match status, and deliberately not the same enumeration.** An
    evaluation reports `matching`, `not_matching` or `insufficient_data`; a gate reports
    `matching`, `not_matching` or `unknown`. The first two members mean the same thing in both
    -- there is one match vocabulary in this application -- but the third members answer
    different questions and must not be merged.

    `unknown` is a gate **nobody has researched yet**: the Swiss quota may well be open, and
    nobody has looked. `insufficient_data` is a candidate whose values are **too sparse to
    score**. A country whose visa route is `unknown` may be perfectly scoreable, and a country
    with every gate answered may still be unscoreable. One enumeration covering both would
    make each of those states unsayable.
    """

    MATCHING = "matching"
    NOT_MATCHING = "not_matching"
    UNKNOWN = "unknown"


class MatchRule(BaseModel):
    """A named yes/no gate attached to no attribute: a visa route, a quota, a manual exclusion.

    Distinct from a criterion's matching threshold, which reads a measured value and decides.
    A gate carries a judgement with nothing to compute (`reqs.md` 3.7), which is also why it
    has no value type, no unit and no goal.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: MatchRuleId
    name: str = Field(min_length=1)
    level: LevelId | None = Field(
        default=None,
        description=(
            "Null where the gate is asked at every level -- a candidate excluded by hand is "
            "excluded whether it is a country or a city."
        ),
    )

    def applies_at(self, level: str) -> bool:
        """Whether this gate is asked at that level.

        Written once here rather than at every call site, because "no level means every level"
        is the kind of null that is read as "not applicable anywhere" by whoever meets it next.
        """
        return self.level is None or self.level == level


class MatchRuleResult(BaseModel):
    """One gate's answer for one candidate, with the dates, the pages and any override.

    **A gate ages like any other finding**, so it carries the same two dates a value does and
    for the same reason (`reqs.md` 3.7): a UK Skilled Worker answer researched in 2026 and
    still displayed in 2028 is worse than no answer, because it looks current. The reference
    period is what the judgement holds *for* -- a Swiss quota is annual, a visa route holds
    until the rules change -- and the retrieval date is when somebody last checked.

    **It shows its sources.** A gate is displayed as the reason a candidate is out, which is
    the heaviest burden of proof in the product, and an answer whose reasoning cannot be
    retraced is an opinion rather than a finding (`reqs.md` 6.9).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    match_rule: MatchRuleId
    candidate: CandidateId
    match_result: MatchResult
    data_source: DataSourceId = Field(
        description="Where the judgement came from -- usually `manual` or `llm` (`reqs.md` 6.10)."
    )
    retrieval_date: datetime = Field(description="When the gate was last checked.")
    reason: str | None = Field(
        default=None, description="Why, in words. What is displayed beside a candidate that is out."
    )
    reference_period: ReferencePeriod | None = Field(
        default=None,
        description=(
            "What period the judgement holds for. Absent where nobody recorded one, which is "
            "an answer with no expiry rather than an answer that never expires."
        ),
    )
    citations: tuple[str, ...] = Field(
        default=(), description="The pages the judgement was read from (`reqs.md` 3.7, 6.9)."
    )
    override_reason: str | None = None
    override_date: datetime | None = None

    @model_validator(mode="after")
    def _enforce_what_an_answer_may_claim(self) -> "MatchRuleResult":
        self._reject_a_half_recorded_override()
        self._reject_a_moment_with_no_timezone()
        return self

    def _reject_a_half_recorded_override(self) -> None:
        """Mirrors `match_rule_result_override_is_all_or_nothing`, with a sentence instead.

        An override is audited (`reqs.md` 3.7), and an audit trail is the reason together with
        the moment it was given. A reason with no date is an unattributed exclusion; a date
        with no reason is a marker nobody can explain. The database refuses both, and this
        refuses them where the answer was assembled, so the fault names itself rather than
        arriving as a constraint name from a driver several layers away.
        """
        if (self.override_reason is None) != (self.override_date is None):
            recorded, missing = (
                ("a reason", "the date it was given")
                if self.override_reason is not None
                else ("a date", "the reason it was given for")
            )
            raise MalformedMatchRuleResultError(
                f"an override is a reason and a date together, and the override of "
                f"{self.match_rule!r} on {self.candidate!r} has {recorded} without {missing}"
            )

    def _reject_a_moment_with_no_timezone(self) -> None:
        """Both dates here are instants the system records, never spans in the world.

        `arch.md` 9.6 keeps the two kinds apart by type, and a naive datetime is the one way
        the distinction leaks: it looks like an instant and is not one.
        """
        for named, moment in (
            ("retrieval_date", self.retrieval_date),
            ("override_date", self.override_date),
        ):
            if moment is not None and moment.tzinfo is None:
                raise MalformedMatchRuleResultError(
                    f"{named} is a moment in time and must carry a timezone"
                )

    @property
    def is_overridden(self) -> bool:
        """Whether a person set this answer aside, which travels with the candidate everywhere."""
        return self.override_reason is not None


class CompoundRuleShape(StrEnum):
    """Which comparison a rule performs -- a name, and nothing else.

    **No behaviour lives here, deliberately.** The three shapes are implemented in
    `evaluation/` (`devplan.md` W2-A), which this module may not import and does not need to.
    A rule is a row naming a shape and its parameters; naming the shape is what keeps every
    stored field a parameter rather than an instruction (`reqs.md` 3.7a).

    `AllConditionsHold` replaced a ratio between two attributes, which was arithmetic nonsense
    for every rule written against it -- dividing degrees Celsius by a count of days divides an
    interval scale by a count, and near a mean of 0 degrees the quotient explodes and then
    changes sign. Read plainly, those rules were conjunctions of independent thresholds all
    along, so the shape is the conjunction. **AND is the only connective and it is implicit in
    the name**; a rule needing "or" is two rules, or a new shape and a release.
    """

    SHARE_OF_HOUSEHOLD_FIELD = "ShareOfHouseholdField"
    SUM_BELOW_FLOOR = "SumBelowFloor"
    ALL_CONDITIONS_HOLD = "AllConditionsHold"


class RuleOutcome(StrEnum):
    """What a rule firing does, and it is a parameter rather than two kinds of rule.

    `warning` flags without ruling anything out and never touches the score; `not_matching`
    makes the same row a computed gate, speaking the one match vocabulary a `MatchRule` speaks
    (`reqs.md` 3.7a).
    """

    WARNING = "warning"
    NOT_MATCHING = "not_matching"


class CompoundRuleInput(BaseModel):
    """One figure a rule reads: either an attribute, or a household number. Never both.

    **Order is part of the input rather than decoration.** It is what lets a shape tell the
    figure being measured from the figure it is measured against -- a share needs to know what
    it is a share *of*.

    **No bound here.** The two shapes that take inputs compare what their inputs produce
    *together*, so the bound is on the rule and there is nothing for a single input to be
    compared against.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    input_order: int = Field(gt=0)
    attribute: AttributeId | None = None
    household_field: CatalogId | None = Field(
        default=None,
        description=(
            "A household number a rule may read, from the controlled vocabulary of `reqs.md` "
            "3.7a. A catalog identifier rather than a field of the household record: what is "
            "named here is a row in a reference table, so a rule cannot name a field that "
            "does not exist."
        ),
    )

    @model_validator(mode="after")
    def _reject_an_input_that_names_neither_or_both(self) -> "CompoundRuleInput":
        """Mirrors `compound_rule_input_is_one_thing`.

        An input naming nothing supplies no figure; an input naming two supplies two, and
        which of them the shape reads would be decided by whichever column somebody looked at
        first.
        """
        figures = [it for it in (self.attribute, self.household_field) if it is not None]
        if len(figures) != 1:
            raise CompoundRuleDeclarationError(
                f"input {self.input_order} names one attribute or one household field, and "
                f"this one names {len(figures)}"
            )
        return self


class CompoundRuleCondition(BaseModel):
    """One bound on one attribute, in that attribute's own unit.

    Both ends are inclusive and `None` is unbounded on that side. **Both `None` is legal and is
    what the MVP ships**: every threshold in `reqs.md` 7.4 is TBD, so requiring a bound would
    force somebody to invent one (`devplan.md` 0.3 rule 2). An unbounded condition is one
    nobody has decided yet rather than one that admits everything -- `is_decided` is the
    difference, and it is why an undecided rule simply does not fire.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    ordinal: int = Field(
        gt=0,
        description=(
            "The order the condition is displayed and explained in. It carries no arithmetic "
            "meaning, because AND does not care which conjunct comes first."
        ),
    )
    attribute: AttributeId
    threshold_min: Decimal | None = Field(default=None, allow_inf_nan=False)
    threshold_max: Decimal | None = Field(default=None, allow_inf_nan=False)

    @model_validator(mode="after")
    def _reject_a_band_that_runs_backwards(self) -> "CompoundRuleCondition":
        """Mirrors `compound_rule_condition_is_ordered`. A band low to high, or no band."""
        if (
            self.threshold_min is not None
            and self.threshold_max is not None
            and self.threshold_min > self.threshold_max
        ):
            raise CompoundRuleDeclarationError(
                f"a condition on {self.attribute!r} runs low to high, and this one runs "
                f"{self.threshold_min} to {self.threshold_max}"
            )
        return self

    @property
    def is_decided(self) -> bool:
        """Whether anybody has yet said what this condition compares against."""
        return self.threshold_min is not None or self.threshold_max is not None


_THE_BOUND_EACH_SHAPE_READS: Mapping[CompoundRuleShape, str | None] = {
    CompoundRuleShape.SHARE_OF_HOUSEHOLD_FIELD: "threshold_max",
    CompoundRuleShape.SUM_BELOW_FLOOR: "threshold_min",
    CompoundRuleShape.ALL_CONDITIONS_HOLD: None,
}
"""Which rule-level bound each shape reads, and `None` for the shape that reads none.

`ShareOfHouseholdField` fires above a ceiling and `SumBelowFloor` below a floor, so each takes
exactly one and the other means nothing to it. `AllConditionsHold` takes none at all: every
number it compares is a bound on one named attribute in that attribute's own unit, and those
live one per condition.

Stated once and read from both directions -- what a shape may declare, and what it still needs
before it can fire -- because two tables saying the same thing would drift.
"""

_RULE_LEVEL_BOUNDS = ("threshold_min", "threshold_max")


class CompoundRule(BaseModel):
    """A rule over more than one input, for what is only visible when two figures are read together.

    Rent at 1,410 EUR clears a 2,000 ceiling comfortably and still consumes 56% of a 2,500
    household budget. No criterion can say so, because a criterion judges exactly one attribute
    (`reqs.md` 3.7a).

    **A rule carries inputs or conditions, never both and never the wrong kind.** The schema
    makes that a constraint through the composite key `(id, shape)` that each child row is
    pinned to; this restates it, because a catalog row arrives from a migration and a
    constraint name is not an explanation of what went wrong.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: CompoundRuleId
    name: str = Field(min_length=1)
    shape: CompoundRuleShape
    outcome: RuleOutcome
    level: LevelId | None = Field(
        default=None, description="Null where the rule applies at every level."
    )
    threshold_min: Decimal | None = Field(default=None, allow_inf_nan=False)
    threshold_max: Decimal | None = Field(default=None, allow_inf_nan=False)
    inputs: tuple[CompoundRuleInput, ...] = ()
    conditions: tuple[CompoundRuleCondition, ...] = ()

    @model_validator(mode="after")
    def _enforce_what_the_shape_may_carry(self) -> "CompoundRule":
        self._reject_children_of_the_kind_another_shape_reads()
        self._reject_a_bound_this_shape_cannot_read()
        self._reject_children_that_collide()
        return self

    def _reject_children_of_the_kind_another_shape_reads(self) -> None:
        """The composite key `(id, shape)` of `0007-gates-and-outside-opinions.sql`, in Python.

        A rule holding both would be answerable two ways, and which way it was answered would
        depend on which child table the reader happened to join.
        """
        if self.shape is CompoundRuleShape.ALL_CONDITIONS_HOLD:
            if self.inputs:
                raise CompoundRuleDeclarationError(
                    f"{self.id!r} is {self.shape} and reads conditions; an input belongs to a "
                    f"shape that compares a list of figures as a whole"
                )
        elif self.conditions:
            raise CompoundRuleDeclarationError(
                f"{self.id!r} is {self.shape} and reads inputs; a condition is a bound on one "
                f"attribute, which only {CompoundRuleShape.ALL_CONDITIONS_HOLD} takes"
            )

    def _reject_a_bound_this_shape_cannot_read(self) -> None:
        """Mirrors `compound_rule_thresholds_suit_the_shape`.

        The forbidden bounds are named rather than the required ones: a rule whose number is
        still TBD ships with it absent, so requiring one here would force somebody to invent
        it (`devplan.md` 0.3 rule 2). Nothing checks that the pair runs low to high, because
        no shape reads both and a pair can therefore never be present.
        """
        readable = _THE_BOUND_EACH_SHAPE_READS[self.shape]
        for bound in _RULE_LEVEL_BOUNDS:
            if bound != readable and getattr(self, bound) is not None:
                instead = (
                    f"the bound it reads is {readable}"
                    if readable is not None
                    else "it reads its bounds from its conditions, one per attribute"
                )
                raise CompoundRuleDeclarationError(
                    f"{self.id!r} is {self.shape} and cannot declare {bound}; {instead}"
                )

    def _reject_children_that_collide(self) -> None:
        """Two children occupying one position, or two bounds on one attribute.

        The primary keys and the unique constraint of `0007` say the same. The last is the one
        worth a sentence: two conditions on one attribute always reduce to a single narrower
        band, so a second one is either a mistake or the beginning of a grammar.
        """
        positions = [an_input.input_order for an_input in self.inputs]
        if len(set(positions)) != len(positions):
            raise CompoundRuleDeclarationError(
                f"two inputs of {self.id!r} share a position, and position is what tells a "
                f"shape which figure is which"
            )
        ordinals = [condition.ordinal for condition in self.conditions]
        if len(set(ordinals)) != len(ordinals):
            raise CompoundRuleDeclarationError(f"two conditions of {self.id!r} share an ordinal")
        attributes = [condition.attribute for condition in self.conditions]
        if len(set(attributes)) != len(attributes):
            raise CompoundRuleDeclarationError(
                f"{self.id!r} bounds one attribute twice, and two bounds on one attribute are "
                f"one narrower band"
            )

    def applies_at(self, level: str) -> bool:
        """Whether this rule is applied at that level. No level means every level."""
        return self.level is None or self.level == level

    @property
    def is_decided(self) -> bool:
        """Whether every number this rule compares against has been chosen.

        A rule missing one is stored and left inactive rather than defaulted (`reqs.md` 7.4):
        it is a rule nobody has finished writing, and firing it on an invented number is
        exactly the fabricated judgement this application exists to prevent. Both compound
        rules the MVP ships answer `False`, and that is the intended shipping state.

        A rule reading nothing is undecided too. `AllConditionsHold` over no conditions would
        be a conjunction over the empty set, which holds vacuously and would flag every
        candidate on the strength of nobody having said anything.
        """
        readable = _THE_BOUND_EACH_SHAPE_READS[self.shape]
        if readable is not None:
            return bool(self.inputs) and getattr(self, readable) is not None
        return bool(self.conditions) and all(condition.is_decided for condition in self.conditions)
