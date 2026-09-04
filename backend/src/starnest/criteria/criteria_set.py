"""A named collection of criteria, and the weights that say how much each counts.

`reqs.md` 3.4. One primitive serves two purposes that look different and are not:
**work-format scenarios** (`local_employment` versus `remote_only`) and **per-person sets**
(`alex`, `partner`). Both are one opinion about the same 41 measured attributes, and switching
between them recalculates from stored data without fetching anything (`reqs.md` 5.6).

**A set is a full copy, never a sparse overlay**, and the arithmetic leaves no choice
(`reqs.md` Q191). Weights sum to 100 within a pillar, so raising one criterion from 22 to 40
is only meaningful if its siblings fall to compensate -- a set holding the single override
would carry 40 plus five inherited weights totalling 78, and sum to 118. Rebalancing *is* what
an override means, and it necessarily touches the siblings, so the siblings must be this set's
own rows.
"""

from collections.abc import Iterable
from decimal import Decimal
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.candidates import LevelId
from starnest.criteria.criterion import Criterion
from starnest.criteria.identifiers import CriteriaSetId
from starnest.criteria.rebalancing import TOTAL, WeightedItem, rebalance
from starnest.data import AttributeId, CompoundRuleId, MatchRuleId, PillarId


class CriteriaSetError(ValueError):
    """A criteria set that could not produce a score, or could produce two different ones."""


class UnknownCriterionError(LookupError):
    """This set imposes no rule on that attribute.

    A miss rather than a malformed value, so a `LookupError` -- an attribute with no criterion
    is descriptive and never scored (`reqs.md` 3.3), which is a legitimate state to ask about.
    """


class PillarWeight(BaseModel):
    """How much one vertical counts, at one level, in one set.

    **The level lives here rather than on the pillar** (`reqs.md` Q187): a set holds one
    opinion about `housing` at country level and a different one at city level, and the two
    sum to 100 independently of each other.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    pillar: PillarId
    level: LevelId
    weight: Decimal = Field(ge=0, le=100, allow_inf_nan=False)
    weight_locked: bool = False


class CriteriaSet(BaseModel):
    """Every criterion, every pillar weight, and which gates this reading enforces.

    Frozen, and every adjustment returns a new set. That is not ceremony: a weight change
    rewrites its siblings, so an in-place edit would leave the set summing to something other
    than 100 for as long as the caller took to finish -- and a reader arriving mid-edit would
    see a ranking computed from it.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: CriteriaSetId
    name: str = Field(min_length=1)
    criteria: tuple[Criterion, ...] = ()
    pillar_weights: tuple[PillarWeight, ...] = ()
    # Which gates this reading enforces, and which multi-input rules it applies. Both are
    # preferences: that a visa route exists is a fact, and treating its absence as
    # disqualifying is an opinion (`reqs.md` 3.7). Sets rather than lists -- a rule is
    # enforced or it is not, and enforcing it twice means nothing.
    enforced_match_rules: frozenset[MatchRuleId] = frozenset()
    applied_compound_rules: frozenset[CompoundRuleId] = frozenset()

    @model_validator(mode="after")
    def _reject_a_set_that_could_not_produce_one_score(self) -> Self:
        self._reject_a_criterion_belonging_to_another_set()
        self._reject_a_second_rule_on_one_attribute()
        self._reject_a_pillar_weighted_twice()
        self._reject_a_criterion_in_an_unweighted_pillar()
        self._reject_weights_that_do_not_sum()
        return self

    def _reject_a_criterion_belonging_to_another_set(self) -> None:
        for criterion in self.criteria:
            if criterion.criteria_set != self.id:
                raise CriteriaSetError(
                    f"the criterion on {criterion.attribute} belongs to set "
                    f"{criterion.criteria_set}, not to {self.id}"
                )

    def _reject_a_second_rule_on_one_attribute(self) -> None:
        """One criterion per attribute per set, which the schema's natural key also says.

        Two rules on one attribute would make the score ambiguous rather than stricter: there
        would be no answer to which goal applies.
        """
        attributes = [criterion.attribute for criterion in self.criteria]
        repeated = sorted({name for name in attributes if attributes.count(name) > 1})
        if repeated:
            raise CriteriaSetError(
                f"{self.id} imposes two rules on the same attribute: {', '.join(repeated)}"
            )

    def _reject_a_pillar_weighted_twice(self) -> None:
        keys = [(weight.pillar, weight.level) for weight in self.pillar_weights]
        repeated = sorted(
            {f"{pillar} at {level}" for pillar, level in keys if keys.count((pillar, level)) > 1}
        )
        if repeated:
            raise CriteriaSetError(
                f"{self.id} weights the same pillar twice: {', '.join(repeated)}"
            )

    def _reject_a_criterion_in_an_unweighted_pillar(self) -> None:
        """A criterion whose pillar carries no weight contributes nothing and says nothing.

        A criterion's contribution is its own score times its weight within the pillar times
        the pillar's weight within the level. With no pillar weight that product is undefined
        rather than zero -- and reporting it as zero would silently drop the criterion out of
        a ranking that still claimed full coverage.

        The reverse is deliberately *not* refused: a pillar weighted with no criteria under it
        is a legitimate state -- a level whose weights are seeded before its criteria are --
        and `pillars_with_no_criteria` reports it instead.
        """
        weighted = {(weight.pillar, weight.level) for weight in self.pillar_weights}
        for criterion in self.criteria:
            if (criterion.pillar, criterion.attribute.level_id) not in weighted:
                raise CriteriaSetError(
                    f"{criterion.attribute} is judged under pillar {criterion.pillar}, which "
                    f"carries no weight at level {criterion.attribute.level_id} in {self.id}"
                )

    def _reject_weights_that_do_not_sum(self) -> None:
        """100 within a pillar across criteria, and 100 within a level across pillars.

        **Excluded criteria are counted.** `is_scored: false` redistributes weight at scoring
        time (`reqs.md` 5.3); it does not remove the row or renumber its siblings, so the
        stored weights still have to sum. Skipping them here would let a set that sums to 100
        become one that sums to 60 by unticking three boxes, and the redistribution downstream
        would then be dividing by the wrong total.
        """
        for (pillar, level), weights in _grouped_criterion_weights(self.criteria).items():
            total = sum(weights, Decimal(0))
            if total != TOTAL:
                raise CriteriaSetError(
                    f"the criteria under {pillar} at level {level} in {self.id} sum to "
                    f"{total}, not {TOTAL}"
                )
        for level, weights in _grouped_pillar_weights(self.pillar_weights).items():
            total = sum(weights, Decimal(0))
            if total != TOTAL:
                raise CriteriaSetError(
                    f"the pillar weights at level {level} in {self.id} sum to {total}, not {TOTAL}"
                )

    def refuse_unless_its_anchors_fit(self, score_scale_max: int) -> None:
        """Every anchor of every criterion, against the one scale they all score onto.

        Here rather than only on `Criterion` because a set is what gets saved and what gets
        scored, so a whole-set guarantee should be one call. A caller looping the criteria
        itself would be a caller who can miss one.

        Not a `model_validator`: the scale is not among the things a set contains, and every
        other check on this class is a relationship between its own parts.
        """
        for criterion in self.criteria:
            criterion.refuse_unless_its_anchors_fit(score_scale_max)

    # --- reading ------------------------------------------------------------

    @property
    def levels(self) -> tuple[LevelId, ...]:
        """Every level this set has an opinion about.

        Read off the criteria's own identifiers rather than stored: an attribute id *is*
        `<level>.<name>` (`reqs.md` 3.3), so the level is already part of what a criterion
        names and a second copy could disagree with it.
        """
        return tuple(sorted({criterion.attribute.level_id for criterion in self.criteria}))

    @property
    def pillars_with_no_criteria(self) -> tuple[tuple[PillarId, LevelId], ...]:
        """Pillars carrying weight that nothing scores into.

        Not an error -- seeding a level's pillar weights before its criteria is how a level
        gets built -- but worth surfacing, because such a pillar's share of the score has
        nowhere to go and the level would silently score out of less than 100.
        """
        judged = {(criterion.pillar, criterion.attribute.level_id) for criterion in self.criteria}
        return tuple(
            (weight.pillar, weight.level)
            for weight in self.pillar_weights
            if (weight.pillar, weight.level) not in judged
        )

    def criterion_for(self, attribute: AttributeId | str) -> Criterion:
        """The rule this set imposes on that attribute.

        Raises `UnknownCriterionError` rather than returning `None`: an absent criterion means
        the attribute is descriptive here, and a caller that quietly scored a `None` would
        invent an opinion the user never expressed.
        """
        for criterion in self.criteria:
            if criterion.attribute == attribute:
                return criterion
        raise UnknownCriterionError(f"{self.id} imposes no rule on {attribute}")

    def criteria_under(self, pillar: PillarId | str, level: LevelId | str) -> tuple[Criterion, ...]:
        """Every criterion sharing one pillar at one level -- the group a weight sums within."""
        return tuple(
            criterion
            for criterion in self.criteria
            if criterion.pillar == pillar and criterion.attribute.level_id == level
        )

    # --- editing ------------------------------------------------------------

    def duplicated_as(self, new_id: CriteriaSetId | str, name: str) -> "CriteriaSet":
        """A full, independent copy under a new identifier.

        Every criterion row is copied and re-pointed, because a set is a copy and not an
        overlay (`reqs.md` Q191). After this the two sets share nothing, and neither one's
        edits reach the other.
        """
        copied = CriteriaSetId(new_id)
        return self.model_copy(
            update={
                "id": copied,
                "name": name,
                "criteria": tuple(
                    criterion.model_copy(update={"criteria_set": copied})
                    for criterion in self.criteria
                ),
            }
        )

    def with_criterion_weight(self, attribute: AttributeId | str, weight: Decimal) -> "CriteriaSet":
        """Set one criterion's weight and rebalance its pillar siblings proportionally.

        The siblings are the criteria sharing its pillar *at its level* -- the group the sum
        rule applies to. Raises `WeightsAllLockedError` when the locks leave nowhere for the
        change to be absorbed, which is the case the interface must report rather than
        silently break the sum (`reqs.md` 3.4).
        """
        moved = self.criterion_for(attribute)
        siblings = self.criteria_under(moved.pillar, moved.attribute.level_id)
        rebalanced = rebalance(
            [
                WeightedItem(str(sibling.attribute), sibling.weight, sibling.weight_locked)
                for sibling in siblings
            ],
            moved=str(moved.attribute),
            to=weight,
        )
        return self.model_copy(
            update={
                "criteria": tuple(
                    criterion.model_copy(update={"weight": rebalanced[str(criterion.attribute)]})
                    if str(criterion.attribute) in rebalanced
                    else criterion
                    for criterion in self.criteria
                )
            }
        )

    def with_pillar_weight(
        self, pillar: PillarId | str, level: LevelId | str, weight: Decimal
    ) -> "CriteriaSet":
        """Set one pillar's weight at one level and rebalance the other pillars there.

        The same arithmetic as `with_criterion_weight`, over the other of the two levels of
        weighting -- which is exactly why `rebalance` is written once against an identifier
        and a number rather than twice against two record types.
        """
        at_level = [entry for entry in self.pillar_weights if entry.level == level]
        if not any(entry.pillar == pillar for entry in at_level):
            raise UnknownCriterionError(
                f"{self.id} carries no weight for pillar {pillar} at level {level}"
            )
        rebalanced = rebalance(
            [
                WeightedItem(str(entry.pillar), entry.weight, entry.weight_locked)
                for entry in at_level
            ],
            moved=str(pillar),
            to=weight,
        )
        return self.model_copy(
            update={
                "pillar_weights": tuple(
                    entry.model_copy(update={"weight": rebalanced[str(entry.pillar)]})
                    if entry.level == level
                    else entry
                    for entry in self.pillar_weights
                )
            }
        )


def _grouped_criterion_weights(
    criteria: Iterable[Criterion],
) -> dict[tuple[PillarId, LevelId], list[Decimal]]:
    grouped: dict[tuple[PillarId, LevelId], list[Decimal]] = {}
    for criterion in criteria:
        grouped.setdefault((criterion.pillar, criterion.attribute.level_id), []).append(
            criterion.weight
        )
    return grouped


def _grouped_pillar_weights(
    pillar_weights: Iterable[PillarWeight],
) -> dict[LevelId, list[Decimal]]:
    grouped: dict[LevelId, list[Decimal]] = {}
    for weight in pillar_weights:
        grouped.setdefault(weight.level, []).append(weight.weight)
    return grouped
