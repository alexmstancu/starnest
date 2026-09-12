"""The rule you impose on one attribute.

`reqs.md` 3.4. An `Attribute` says what is knowable; a `Criterion` says whether more of it is
better, how much it is worth, and where it stops being acceptable. **It is the only place a
preference may live**, which is why the same measured rent scores differently under two
criteria sets and neither is wrong.

**Nothing here names an attribute, a weight or a goal.** The shipped opinions are catalog rows
(`arch.md` 1.2); what lives here is the shape a row has to have, and the combinations that are
not a rule at all.
"""

from decimal import Decimal
from enum import StrEnum
from itertools import pairwise
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.criteria.identifiers import CriteriaSetId
from starnest.criteria.thresholds import MatchingThreshold
from starnest.data import AttributeId, BreakdownOptionId, PillarId, ValueType

# The fewest anchors that describe a mapping. One point fixes no line: interpolation needs two
# ends, and a scale with a single anchor cannot say what any other value scores.
_ANCHORS_NEEDED_TO_INTERPOLATE = 2


class CriterionDeclarationError(ValueError):
    """A criterion declares a combination that is not a rule.

    Distinct from `ThresholdShapeError`, which is about a threshold suiting a value type. This
    is about the criterion's own fields contradicting each other -- a `target_range` goal with
    no band, a `select` reducer naming no option.
    """


class Goal(StrEnum):
    """Which direction is better, or which band is.

    **This is a preference, not a property of the attribute** (`reqs.md` 3.4). A large expat
    community is a soft landing to one person and a bubble to another; fixing it on the
    attribute would encode one person's taste as objective truth.
    """

    MINIMISE = "minimise"
    MAXIMISE = "maximise"
    TARGET_RANGE = "target_range"


class NormalisationMethod(StrEnum):
    """How a measured figure becomes a score (`reqs.md` 5.1).

    `FIXED` is stable -- a candidate's score does not move when another candidate is added.
    `PERCENTILE` is relative by design, and is the reason a ranking of one candidate needs a
    sad-path test. `AS_IS` is for figures already on the score scale.
    """

    FIXED = "fixed"
    PERCENTILE = "percentile"
    AS_IS = "as_is"


class ReducerMode(StrEnum):
    """What to do with an attribute broken down into several options (`reqs.md` 3.3b).

    `SELECT` picks the one option that applies -- the two-bedroom rent for a household of
    three. `AGGREGATE` reads all of them together.
    """

    SELECT = "select"
    AGGREGATE = "aggregate"


class TargetRange(BaseModel):
    """The four numbers of a `target_range` goal, all in the attribute's own unit (`reqs.md` 5.1).

    Everything from `minimum` to `maximum` scores full marks; the score falls linearly to 0 at
    `zero_below` and at `zero_above`. Built by `Criterion.target_range` only when all four are
    set, so holding one means the scale is complete.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    minimum: Decimal
    maximum: Decimal
    zero_below: Decimal
    zero_above: Decimal


class ScaleAnchor(BaseModel):
    """One point of a `fixed` scale: an input value and the score it maps to.

    A row rather than a field of a JSON blob, so "500 EUR to 100" is inspectable in the
    drill-down that explains a number (`reqs.md` Q121).

    **The label names the band starting here**, not the single point -- an anchor at 500
    labelled `affordable` means everything from 500 up to the next anchor reads as affordable.
    It is display text and never a substitute for the figure: the value stored is always the
    number, and a band is a reading of it (`reqs.md` 5.1).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    input_value: Decimal = Field(allow_inf_nan=False)
    score: int = Field(ge=0)
    label: str | None = None

    @model_validator(mode="after")
    def _reject_a_blank_label(self) -> Self:
        """An empty label is not "no label" -- it is a band that displays as nothing.

        Absence is `None`, and conflating the two would put a blank word on the screen where
        the number should have been.
        """
        if self.label is not None and not self.label.strip():
            raise CriterionDeclarationError(
                "a band label is a word or it is absent; an empty one displays as nothing"
            )
        return self


class Criterion(BaseModel):
    """One attribute, one goal, one weight, and where it stops being acceptable.

    Frozen. Adjusting a criterion produces a new one, which is what makes the criteria set it
    belongs to a value rather than a mutable graph -- and rebalancing has to rewrite its
    siblings anyway (`reqs.md` Q191).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    criteria_set: CriteriaSetId
    attribute: AttributeId
    # Restated from the attribute for the same reason a value restates it: it makes the link a
    # composite key, so the threshold child cannot contradict the attribute's declared type
    # (`arch.md` 3.3b).
    value_type: ValueType
    # Required here although `attribute.pillar` is nullable, and the narrowing is deliberate:
    # weights sum to 100 *within a pillar*, so a scored criterion outside every pillar would
    # have no weight to sum into and no pillar weight to be multiplied by. An attribute with
    # no pillar is descriptive, and a descriptive attribute carries no criterion at all
    # (`reqs.md` 3.3). The contract agrees -- `Criterion` requires `pillar`.
    pillar: PillarId

    is_scored: bool = True
    weight: Decimal = Field(ge=0, le=100, allow_inf_nan=False)
    weight_locked: bool = False

    goal: Goal
    target_range_min: Decimal | None = Field(default=None, allow_inf_nan=False)
    target_range_max: Decimal | None = Field(default=None, allow_inf_nan=False)
    zero_score_below: Decimal | None = Field(default=None, allow_inf_nan=False)
    zero_score_above: Decimal | None = Field(default=None, allow_inf_nan=False)

    normalisation_method: NormalisationMethod = NormalisationMethod.FIXED
    scale_anchors: tuple[ScaleAnchor, ...] = ()

    breakdown_option: BreakdownOptionId | None = None
    reducer_mode: ReducerMode | None = None

    # Whether its absence makes the candidate unscoreable, as opposed to merely reducing
    # coverage. A different question from `is_scored` (`reqs.md` 5.3).
    blocks_if_missing: bool = False

    matching_threshold: MatchingThreshold | None = None

    @model_validator(mode="after")
    def _reject_a_criterion_that_is_not_a_rule(self) -> Self:
        self._reject_a_target_range_that_names_no_band()
        self._reject_a_target_range_the_method_cannot_draw()
        self._reject_a_zero_score_inside_the_band()
        self._reject_a_reducer_that_disagrees_with_its_option()
        self._reject_a_scale_that_cannot_be_read()
        self._reject_anchors_that_run_against_the_goal()
        self._reject_a_threshold_of_the_wrong_shape()
        return self

    @property
    def target_range(self) -> TargetRange | None:
        """The four numbers as one scale, or None while any of them is unset."""
        if (
            self.target_range_min is None
            or self.target_range_max is None
            or self.zero_score_below is None
            or self.zero_score_above is None
        ):
            return None
        return TargetRange(
            minimum=self.target_range_min,
            maximum=self.target_range_max,
            zero_below=self.zero_score_below,
            zero_above=self.zero_score_above,
        )

    def _reject_a_target_range_that_names_no_band(self) -> None:
        """A `target_range` goal is four numbers, and the band itself is two of them.

        Without the band there is nothing that scores 100, so the goal says nothing. The
        bounds are permitted on the other two goals -- and ignored by them -- because the
        schema permits that too, and refusing here would make the domain stricter than the
        constraint for no gain.
        """
        if self.goal is not Goal.TARGET_RANGE:
            return
        if self.target_range_min is None or self.target_range_max is None:
            raise CriterionDeclarationError(
                f"{self.attribute} aims at a target range but names no band; a target range "
                "needs both a minimum and a maximum, in the attribute's own unit"
            )

    def _reject_a_target_range_the_method_cannot_draw(self) -> None:
        """A band is a scale, and `fixed` is the only method that draws one.

        **The combination used to score, and to score something else.** `percentile` ranks a
        column by standing, so a band it knows nothing about was silently ignored and the
        candidates were ordered as though higher were better. `as_is` reads the figure as a
        score and inverts it unless the goal is `maximise`, so a target range came out scored as
        a minimisation -- a plausible number meaning the opposite of what was asked for, which
        is the exact failure `reqs.md` 10 forbids.

        Refused here rather than clamped or ignored: the household asked for a band, and the
        honest answer to "this method cannot express one" is to say so.
        """
        if self.goal is not Goal.TARGET_RANGE:
            return
        if self.normalisation_method is not NormalisationMethod.FIXED:
            raise CriterionDeclarationError(
                f"{self.attribute} aims at a target range and normalises "
                f"`{self.normalisation_method}`, which cannot express a band: `percentile` "
                "scores by standing among the candidates and `as_is` reads the figure as a "
                "score. A target range is a `fixed` scale -- the band, and where the score "
                "reaches zero on each side"
            )

    def _reject_a_zero_score_inside_the_band(self) -> None:
        """The falloff points sit outside the band, because the band is what scores 100.

        A `zero_score_above` below the top of the band would say a value scores both 100 and
        0, which is not a stricter rule but an unreadable one.
        """
        if (
            self.target_range_min is not None
            and self.target_range_max is not None
            and self.target_range_min > self.target_range_max
        ):
            raise CriterionDeclarationError(
                f"the target range of {self.attribute} runs "
                f"{self.target_range_min} to {self.target_range_max}, which is backwards"
            )
        if (
            self.zero_score_below is not None
            and self.target_range_min is not None
            and self.zero_score_below > self.target_range_min
        ):
            raise CriterionDeclarationError(
                f"{self.attribute} scores 0 below {self.zero_score_below}, which is inside "
                f"its target band starting at {self.target_range_min}"
            )
        if (
            self.zero_score_above is not None
            and self.target_range_max is not None
            and self.zero_score_above < self.target_range_max
        ):
            raise CriterionDeclarationError(
                f"{self.attribute} scores 0 above {self.zero_score_above}, which is inside "
                f"its target band ending at {self.target_range_max}"
            )

    def _reject_a_reducer_that_disagrees_with_its_option(self) -> None:
        """Selecting one option means naming it; aggregating means not naming one."""
        if self.reducer_mode is ReducerMode.SELECT and self.breakdown_option is None:
            raise CriterionDeclarationError(
                f"{self.attribute} selects one breakdown option but names none; say which"
            )
        if self.reducer_mode is ReducerMode.AGGREGATE and self.breakdown_option is not None:
            raise CriterionDeclarationError(
                f"{self.attribute} aggregates across every breakdown option and also names "
                f"{self.breakdown_option}; it does one or the other"
            )

    def _reject_a_scale_that_cannot_be_read(self) -> None:
        """Zero anchors is undeclared; one is unreadable.

        **An empty scale is legal and common.** 26 of the 41 shipped country criteria
        normalise `fixed` and none of them ships an anchor -- the numbers are the user's to
        set once real data exists (`devplan.md` 0.3), and requiring them here would force
        someone to invent one. A single anchor is different: it fixes no line, so no other
        value has a score, and that is a half-finished edit rather than a decision deferred.
        """
        if len(self.scale_anchors) == 1:
            raise CriterionDeclarationError(
                f"{self.attribute} has one scale anchor, which maps that single value and "
                "nothing else; a fixed scale needs at least two points, or none at all"
            )
        inputs = [anchor.input_value for anchor in self.scale_anchors]
        if len(set(inputs)) != len(inputs):
            raise CriterionDeclarationError(
                f"{self.attribute} anchors the same input value twice, so it maps to two "
                "different scores"
            )

    def _reject_anchors_that_run_against_the_goal(self) -> None:
        """Anchors whose scores rise where the goal says lower is better, or the reverse.

        **With `fixed`, the anchors carry the direction** and `goal` is not applied on top of
        them -- applying it would invert a correctly written scale. So the two can disagree, and
        when they do the criterion ranks every candidate upside down with no error anywhere.
        Judged by input value, not by the order the anchors were written in; a plateau is a view
        about the attribute, not a contradiction, so the check is on direction only.
        """
        if self.goal is Goal.TARGET_RANGE or len(self.scale_anchors) < 2:
            return
        scores = [
            anchor.score for anchor in sorted(self.scale_anchors, key=lambda a: a.input_value)
        ]
        rising = any(later > earlier for earlier, later in pairwise(scores))
        falling = any(later < earlier for earlier, later in pairwise(scores))
        if self.goal is Goal.MINIMISE and rising:
            raise CriterionDeclarationError(
                f"{self.attribute} is to minimise, but its anchors' scores rise as the value "
                "rises -- it would reward exactly what it means to penalise"
            )
        if self.goal is Goal.MAXIMISE and falling:
            raise CriterionDeclarationError(
                f"{self.attribute} is to maximise, but its anchors' scores fall as the value "
                "rises -- it would penalise exactly what it means to reward"
            )

    def _reject_a_threshold_of_the_wrong_shape(self) -> None:
        """A range on a climate zone, a containment rule on a rent.

        Checked here as well as in the database because the constraint fires with a foreign
        key violation, and this fires with a sentence naming what the shape does judge.
        """
        if self.matching_threshold is not None:
            self.matching_threshold.refuse_unless_it_suits(self.value_type)

    def refuse_unless_its_anchors_fit(self, score_scale_max: int) -> None:
        """Every anchor maps its input to a score the scale actually has.

        **Not a `Field` bound, because the ceiling is not a constant.** It is
        `settings.score_scale_max`, a row the user edits (`reqs.md` 3.10), so it cannot be
        known when this class is defined -- `ScaleAnchor.score` carries the floor it always
        has and takes its ceiling here, from whoever holds the settings.

        The frozen side of the same rule is enforced by the database: an evaluation records
        the scale it used and `0107` holds every score it stores inside it. Nothing equivalent
        is possible for a live criterion, which belongs to no evaluation and so has no scale
        beside it in any row -- which is exactly why this method exists rather than a CHECK.

        Called where a criteria set is written or read for scoring. An anchor scoring 4200 on
        a scale of 100 is not a large score; it is a number with no meaning, and it would
        reach a ranking as one (known-issues D25).
        """
        for anchor in self.scale_anchors:
            if anchor.score > score_scale_max:
                raise CriterionDeclarationError(
                    f"{self.attribute} anchors {anchor.input_value} to a score of "
                    f"{anchor.score}, and the score scale stops at {score_scale_max}"
                )

    @property
    def counts_toward_coverage(self) -> bool:
        """Whether an absent value for this criterion is a gap in the evidence.

        Excluding a criterion from scoring is a decision that it does not apply, so nothing
        is missing and **coverage is unaffected** (`reqs.md` 5.3). This is the property that
        keeps the two questions apart wherever coverage is computed.
        """
        return self.is_scored

    @property
    def declares_a_readable_scale(self) -> bool:
        """Whether `fixed` normalisation could actually produce a score from this criterion.

        A `fixed` criterion with no anchors is legal and is exactly what ships; it simply
        cannot be scored yet. Saying so here means the ranking reports it as undeclared
        rather than discovering an empty list mid-arithmetic.
        """
        if self.normalisation_method is not NormalisationMethod.FIXED:
            return True
        return len(self.scale_anchors) >= _ANCHORS_NEEDED_TO_INTERPOLATE

    def band_label_for(self, figure: Decimal) -> str | None:
        """The word this figure displays as, or `None` where no band names it.

        The label belongs to the band running from its anchor up to the next one, so the
        answer is the label of the highest anchor at or below the figure. A figure beneath
        every anchor has no band, which is not an error -- it is a scale that starts higher
        than the value being read.

        **The band is found first and its label read second, in that order.** Every anchor
        ends the band below it whether or not it carries a word, so skipping the unlabelled
        ones would let a lower band's label run on through a band that was deliberately left
        unnamed -- and a wrong word beside a right number is the failure worth refusing.
        """
        at_or_below = [anchor for anchor in self.scale_anchors if anchor.input_value <= figure]
        if not at_or_below:
            return None
        return max(at_or_below, key=lambda anchor: anchor.input_value).label
