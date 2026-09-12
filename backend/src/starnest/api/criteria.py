"""The criteria set a ranking is computed with, and everything the user changes about it.

`GET` shows the set; `PATCH` changes one criterion and returns **the pillar the server
rebalanced**, not an acknowledgement.

**A criterion is the subjective half of the ontology** (`reqs.md` 3.0): the attribute is what is
knowable about a place, and the criterion is the rule the household imposes on it -- its
direction, its bands, its scale anchors, its matching threshold. All of it is editable here,
because "nothing hardcoded" is not satisfied by a value living in a database row that only a
migration can reach.

**The rebalance happens here and only here.** `arch.md` 8.1: the interface renders what the API
returns and computes nothing, because the moment the client works out where the weight went, the
rebalancing rules exist twice and drift -- and the place that divergence would be least visible
is exactly a weight table that looks plausible either way. So the response carries every
criterion in the pillar with its new weight, and the screen prints them.

The arithmetic itself is `criteria/rebalancing.py` and is reached through
`CriteriaSet.with_criterion_weight`, so this module holds no rule about what a weight change
means. It reads the set, asks the domain for the changed one, and writes it back.
"""

from decimal import Decimal
from typing import ClassVar

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field

from starnest.api.bodies import ContractBody
from starnest.api.dependencies import Criteria
from starnest.criteria import (
    BooleanThreshold,
    CriteriaSet,
    CriteriaSetError,
    Criterion,
    Goal,
    LabelThreshold,
    MatchingThreshold,
    NormalisationMethod,
    RangeThreshold,
    ReducerMode,
    ScaleAnchor,
    ShareThreshold,
    UnknownCriterionError,
)
from starnest.criteria.criteria_set import THE_SCORING_RULE

router = APIRouter(tags=["criteria"])


class ScaleAnchorBody(BaseModel):
    input_value: float
    score: int
    label: str | None = None


class CriterionBody(ContractBody):
    """A criterion as the contract's `Criterion` shape."""

    omit_when_absent: ClassVar[frozenset[str]] = frozenset({"reducer_mode"})
    """The design types `reducer_mode` as an enum of two strings and says "omit when the
    attribute has no breakdown", so null is not a value it has."""

    attribute: str
    pillar: str
    is_scored: bool
    weight: float
    weight_locked: bool
    goal: str
    normalisation_method: str
    blocks_if_missing: bool
    target_range_min: float | None = None
    target_range_max: float | None = None
    zero_score_below: float | None = None
    zero_score_above: float | None = None
    breakdown_option: str | None = None
    reducer_mode: str | None = None
    scale_anchors: tuple[ScaleAnchorBody, ...] = ()
    # The contract has always described this on `Criterion` -- it inherits every field of
    # `CriterionInput` -- and it was never served. Nothing noticed because it is optional, so
    # the response stayed valid while a threshold was invisible to every client. An editor that
    # cannot read the rule it edits would overwrite it on the first save.
    matching_threshold: dict[str, object] | None = None


class PillarWeightBody(BaseModel):
    pillar: str
    level: str
    weight: float
    weight_locked: bool


class CriteriaSetBody(BaseModel):
    id: str
    name: str
    criteria: tuple[CriterionBody, ...]
    pillar_weights: tuple[PillarWeightBody, ...]
    enforced_match_rules: tuple[str, ...] = ()
    applied_compound_rules: tuple[str, ...] = ()


class LabelThresholdBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    containment_rule: str


class ThresholdBody(BaseModel):
    """One matching threshold, in whichever of the four shapes the attribute's type takes.

    **One body for four shapes**, because the contract types it as a `oneOf` and which one
    applies is decided by the attribute rather than by the client. Sending fields from two
    shapes at once is refused rather than resolved by precedence: a threshold that meant
    something other than what was sent is the fabricated judgement this application prevents.
    """

    model_config = ConfigDict(extra="forbid")

    min_value: Decimal | None = None
    max_value: Decimal | None = None
    labels: tuple[LabelThresholdBody, ...] | None = None
    required_value: bool | None = None
    label: str | None = None
    min_share: Decimal | None = None
    max_share: Decimal | None = None


class CriterionInput(BaseModel):
    """Only the fields present are changed, and a field this endpoint cannot change is refused.

    **Every field the contract designs is now applied.** They used to be dropped: Pydantic
    ignores unknown fields by default, so `goal`, `normalisation_method`, `scale_anchors` and
    the rest were accepted with a 200 and changed nothing -- a client could set a target band
    and be told it worked (`known-issues.md` P21). `extra="forbid"` keeps anything genuinely
    unknown a 422 rather than a silence.

    **Present, not merely non-null.** `model_fields_set` is what "only the fields present are
    changed" means in practice: sending `target_range_min: null` *clears* the bound, and not
    sending it leaves the bound alone. Reading `None` as "unchanged" would make a bound
    impossible to remove through the API.
    """

    model_config = ConfigDict(extra="forbid")

    # `Decimal` on the way IN and `float` on the way out, deliberately. A JSON number parsed
    # into a Decimal is exact, and the weight then reaches the rebalancing arithmetic without
    # having been through binary floating point. Coming back it is a display figure the contract
    # types as `number`, and JSON has no other kind.
    weight: Decimal | None = Field(default=None, ge=0, le=100)
    is_scored: bool | None = None
    weight_locked: bool | None = None

    goal: Goal | None = None
    normalisation_method: NormalisationMethod | None = None
    blocks_if_missing: bool | None = None
    target_range_min: Decimal | None = None
    target_range_max: Decimal | None = None
    zero_score_below: Decimal | None = None
    zero_score_above: Decimal | None = None
    breakdown_option: str | None = None
    reducer_mode: ReducerMode | None = None
    scale_anchors: tuple[ScaleAnchorBody, ...] | None = None
    matching_threshold: ThresholdBody | None = None

    def the_scoring_rule(self) -> dict[str, object]:
        """The fields this request actually carries, as the domain's own values.

        Only what was sent, so an untouched field is untouched -- and only what belongs to the
        scoring rule, because `weight` has to go through the rebalancing path instead.
        """
        sent = self.model_fields_set & THE_SCORING_RULE
        rule: dict[str, object] = {name: getattr(self, name) for name in sent}
        if "scale_anchors" in rule:
            anchors = self.scale_anchors or ()
            rule["scale_anchors"] = tuple(
                ScaleAnchor(input_value=Decimal(str(a.input_value)), score=a.score, label=a.label)
                for a in anchors
            )
        if "matching_threshold" in rule:
            rule["matching_threshold"] = _the_threshold_in(self.matching_threshold)
        return rule


def _the_threshold_in(sent: ThresholdBody | None) -> MatchingThreshold | None:
    """Which of the four shapes was sent, or nothing at all.

    **Decided by which fields are present, not by an order of precedence.** The domain then
    refuses a shape the attribute's value type cannot take, so this function never has to know
    what a `LabelSet` is (`criteria/thresholds.py`).
    """
    if sent is None:
        return None

    shapes = {
        "range": {"min_value", "max_value"},
        "labels": {"labels"},
        "boolean": {"required_value"},
        "share": {"label", "min_share", "max_share"},
    }
    named = {shape for shape, fields in shapes.items() if sent.model_fields_set & fields}
    if len(named) != 1:
        raise CriteriaSetError(
            "a matching threshold takes exactly one shape; this request names "
            f"{sorted(named) or 'none'}"
        )

    (shape,) = named
    if shape == "range":
        return RangeThreshold(min_value=sent.min_value, max_value=sent.max_value)
    if shape == "boolean":
        return BooleanThreshold(required_value=bool(sent.required_value))
    if shape == "share":
        return ShareThreshold(
            label=sent.label or "", min_share=sent.min_share, max_share=sent.max_share
        )

    labels = sent.labels or ()
    if len(labels) != 1:
        # The schema holds one row per label and the domain models one label, so a criterion
        # with several is a state the database permits and no criterion can represent
        # (`storage/criteria_store.py` refuses to read one). Saying so here keeps the two ends
        # agreeing rather than writing something that cannot be read back.
        raise CriteriaSetError(
            f"a criterion carries one label threshold, and {len(labels)} were sent"
        )
    return LabelThreshold(label=labels[0].label, containment_rule=labels[0].containment_rule)


class RebalancedPillar(BaseModel):
    """What a weight change actually produced: the whole pillar, as it now stands."""

    pillar: str
    criteria: tuple[CriterionBody, ...]


@router.get(
    "/criteria-sets/{criteria_set_id}",
    operation_id="getCriteriaSet",
    response_model=CriteriaSetBody,
)
async def get_criteria_set(
    criteria_set_id: str, criteria: Criteria, level: str | None = None
) -> CriteriaSetBody:
    """One whole set. `level` narrows the criteria and the pillar weights together.

    Never one without the other: weights sum to 100 within a level, so narrowing only the
    criteria would return a set whose pillar weights summed to 200 -- and the domain would
    refuse to build it, which is the right outcome reached the wrong way.
    """
    return _set_body(await criteria.read_criteria_set(criteria_set_id, level=level))


@router.patch(
    "/criteria-sets/{criteria_set_id}/criteria/{attribute_id}",
    operation_id="updateCriterion",
    response_model=RebalancedPillar,
)
async def update_criterion(
    criteria_set_id: str, attribute_id: str, change: CriterionInput, criteria: Criteria
) -> RebalancedPillar:
    """Move one weight, and return the pillar it moved within.

    The whole pillar comes back because the whole pillar changed: raising one criterion lowers
    its unlocked siblings so the pillar still sums to 100 (`reqs.md` 5.2). Returning only the
    criterion that was asked about would leave the screen showing a set that does not add up.

    Raises `WeightsAllLockedError` -- a 409 -- when every other weight in the pillar is locked,
    naming the locks so the screen can say which ones.
    """
    current = await criteria.read_criteria_set(criteria_set_id)
    changed = _applied(current, attribute_id, change)
    await criteria.replace_criteria_set(changed)

    pillar = changed.criterion_for(attribute_id).pillar
    level = changed.criterion_for(attribute_id).attribute.level_id
    return RebalancedPillar(
        pillar=str(pillar),
        criteria=tuple(
            _criterion_body(criterion) for criterion in changed.criteria_under(pillar, level)
        ),
    )


def _applied(current: CriteriaSet, attribute: str, change: CriterionInput) -> CriteriaSet:
    """The set with the change applied, as the domain would have it.

    `with_criterion_weight` is where rebalancing happens; nothing here decides where the weight
    goes. A change carrying no weight is not an error -- the contract says only the fields
    present are changed -- it simply produces the set unaltered.

    **The two flags are applied, and used not to be.** Both were declared on the body and
    dropped on the floor: excluding a criterion from scoring, or locking its weight, answered
    200 and changed nothing. Neither rebalances -- see `with_criterion_flags`.
    """
    changed = current
    if change.weight is not None:
        changed = changed.with_criterion_weight(attribute, change.weight)
    if change.is_scored is not None or change.weight_locked is not None:
        changed = changed.with_criterion_flags(
            attribute, is_scored=change.is_scored, weight_locked=change.weight_locked
        )
    rule = change.the_scoring_rule()
    if rule:
        changed = changed.with_criterion_scoring(attribute, rule)
    return changed


def _set_body(criteria_set: CriteriaSet) -> CriteriaSetBody:
    return CriteriaSetBody(
        id=str(criteria_set.id),
        name=criteria_set.name,
        criteria=tuple(_criterion_body(criterion) for criterion in criteria_set.criteria),
        pillar_weights=tuple(
            PillarWeightBody(
                pillar=str(weight.pillar),
                level=str(weight.level),
                weight=weight.weight,
                weight_locked=weight.weight_locked,
            )
            for weight in criteria_set.pillar_weights
        ),
        enforced_match_rules=tuple(str(rule) for rule in criteria_set.enforced_match_rules),
        applied_compound_rules=tuple(str(rule) for rule in criteria_set.applied_compound_rules),
    )


def _criterion_body(criterion: Criterion) -> CriterionBody:
    return CriterionBody(
        attribute=str(criterion.attribute),
        pillar=str(criterion.pillar),
        is_scored=criterion.is_scored,
        weight=criterion.weight,
        weight_locked=criterion.weight_locked,
        goal=str(criterion.goal),
        normalisation_method=str(criterion.normalisation_method),
        blocks_if_missing=criterion.blocks_if_missing,
        target_range_min=criterion.target_range_min,
        target_range_max=criterion.target_range_max,
        zero_score_below=criterion.zero_score_below,
        zero_score_above=criterion.zero_score_above,
        breakdown_option=criterion.breakdown_option,
        reducer_mode=str(criterion.reducer_mode) if criterion.reducer_mode else None,
        scale_anchors=tuple(
            ScaleAnchorBody(input_value=anchor.input_value, score=anchor.score, label=anchor.label)
            for anchor in criterion.scale_anchors
        ),
        matching_threshold=_threshold_body(criterion.matching_threshold),
    )


def _threshold_body(threshold: MatchingThreshold | None) -> dict[str, object] | None:
    """A threshold in the one of four shapes it has, as the contract's `oneOf` describes them.

    Each shape serialises only its own fields, so a client can tell which one arrived by what
    is present -- the same way the request is read. `labels` is a one-entry array because the
    contract types it as an array while a criterion carries one (see `_the_threshold_in`).
    """
    if threshold is None:
        return None
    if isinstance(threshold, RangeThreshold):
        return {
            "min_value": _number_or_none(threshold.min_value),
            "max_value": _number_or_none(threshold.max_value),
        }
    if isinstance(threshold, BooleanThreshold):
        return {"required_value": threshold.required_value}
    if isinstance(threshold, ShareThreshold):
        return {
            "label": threshold.label,
            "min_share": _number_or_none(threshold.min_share),
            "max_share": _number_or_none(threshold.max_share),
        }
    if isinstance(threshold, LabelThreshold):
        return {
            "labels": [{"label": threshold.label, "containment_rule": threshold.containment_rule}]
        }
    raise CriteriaSetError(f"there is no serialisation for a {type(threshold).__name__}")


def _number_or_none(figure: Decimal | None) -> float | None:
    """The contract types every threshold bound as `number`, and JSON has one kind."""
    return None if figure is None else float(figure)


class DuplicateRequest(BaseModel):
    """What the copy will be called, and what to call it."""

    id: str
    name: str


@router.post(
    "/criteria-sets/{criteria_set_id}/duplicate",
    operation_id="duplicateCriteriaSet",
    status_code=201,
)
async def duplicate_criteria_set(
    criteria_set_id: str, wanted: DuplicateRequest, criteria: Criteria, response: Response
) -> CriteriaSetBody:
    """Copy a set whole, under a new identifier.

    **A full copy, never a sparse overlay** (`reqs.md` Q191). "Inherit from the default for
    anything not overridden" cannot hold: weights sum to 100 within a pillar, so an override
    that did not move its siblings would sum to 118. `CriteriaSet.duplicated_as` produces the
    copy and the store writes it, so what a copy contains is decided in one place -- the domain
    -- rather than here and in the SQL separately.

    A duplicate is how a user gets a set they may change without touching the shipped one, which
    is what makes `local_employment` safe to leave exactly as seeded.
    """
    original = await criteria.read_criteria_set(criteria_set_id)
    copy = original.duplicated_as(wanted.id, wanted.name)
    await criteria.create_criteria_set(copy)
    response.headers["Location"] = f"/v1/criteria-sets/{wanted.id}"
    return _set_body(copy)


class NewCriteriaSetBody(BaseModel):
    id: str
    name: str


class RenameBody(BaseModel):
    name: str


class PillarWeightInput(BaseModel):
    weight: float = Field(ge=0, le=100)
    weight_locked: bool | None = None


class PillarWeightsBody(BaseModel):
    items: tuple[PillarWeightBody, ...]


class EnforcementBody(BaseModel):
    is_enforced: bool


class ApplicationBody(BaseModel):
    is_applied: bool


@router.post(
    "/criteria-sets",
    operation_id="createCriteriaSet",
    status_code=201,
    response_model=CriteriaSetBody,
)
async def create_criteria_set(body: NewCriteriaSetBody, criteria: Criteria) -> CriteriaSetBody:
    """A new, empty set of priorities.

    **Empty, not copied.** The design gives this an identifier and a name and nothing else, and
    choosing a set to copy from would be this endpoint deciding whose priorities a new set
    starts from. A set with no criteria scores nothing, and `GET /rankings` says exactly that
    rather than producing a ranking out of an empty opinion.

    Refused with 409 when the identifier is taken: silently replacing a set somebody built is
    the worst kind of success (`criteria/store.py`).
    """
    await criteria.create_criteria_set(CriteriaSet(id=body.id, name=body.name))
    return _set_body(await criteria.read_criteria_set(body.id))


@router.patch(
    "/criteria-sets/{criteria_set_id}",
    operation_id="renameCriteriaSet",
    response_model=CriteriaSetBody,
)
async def rename_criteria_set(
    criteria_set_id: str, body: RenameBody, criteria: Criteria
) -> CriteriaSetBody:
    """The name, and only the name. Weights move through their own endpoints."""
    current = await criteria.read_criteria_set(criteria_set_id)
    await criteria.replace_criteria_set(current.model_copy(update={"name": body.name}))
    return _set_body(await criteria.read_criteria_set(criteria_set_id))


@router.delete(
    "/criteria-sets/{criteria_set_id}", operation_id="deleteCriteriaSet", status_code=204
)
async def delete_criteria_set(criteria_set_id: str, criteria: Criteria) -> Response:
    """Discard a set of priorities.

    **A saved evaluation froze its own copy** (`reqs.md` Q193), so deleting the set it was
    computed from leaves it readable -- which is why this store has a delete and `ValueStore`
    deliberately does not: an opinion may be withdrawn, a measurement may not.
    """
    await criteria.delete_criteria_set(criteria_set_id)
    return Response(status_code=204)


@router.put(
    "/criteria-sets/{criteria_set_id}/pillar-weights/{pillar_id}",
    operation_id="updatePillarWeight",
    response_model=PillarWeightsBody,
)
async def update_pillar_weight(
    criteria_set_id: str,
    pillar_id: str,
    body: PillarWeightInput,
    criteria: Criteria,
) -> PillarWeightsBody:
    """Move one pillar's weight, and answer with every pillar weight at that level.

    The outer half of the two-level weighting, rebalanced by the same arithmetic as the inner
    half (`criteria/rebalancing.py`). The whole level comes back because the whole level
    changed; returning one number would leave the screen showing weights that do not sum.
    """
    current = await criteria.read_criteria_set(criteria_set_id)
    level = _the_level_of(current, pillar_id)
    changed = current.with_pillar_weight(pillar_id, level, Decimal(str(body.weight)))
    if body.weight_locked is not None:
        changed = changed.model_copy(
            update={
                "pillar_weights": tuple(
                    weight.model_copy(update={"weight_locked": body.weight_locked})
                    if str(weight.pillar) == pillar_id and str(weight.level) == level
                    else weight
                    for weight in changed.pillar_weights
                )
            }
        )
    await criteria.replace_criteria_set(changed)
    return PillarWeightsBody(
        items=tuple(
            PillarWeightBody(
                pillar=str(weight.pillar),
                level=str(weight.level),
                weight=weight.weight,
                weight_locked=weight.weight_locked,
            )
            for weight in changed.pillar_weights
            if str(weight.level) == level
        )
    )


def _the_level_of(criteria_set: CriteriaSet, pillar: str) -> str:
    """Which level this pillar carries weight at, read from the set rather than assumed.

    The design addresses a pillar weight by set and pillar, and a set may weigh the same pillar
    at both levels. Naming `country` here would be the hardcoded level `reqs.md` 3.1 forbids --
    nothing may assume there are exactly two, or which one is meant -- so the level comes from
    the set, and a pillar weighted at more than one is refused rather than guessed at.
    """
    levels = {
        str(weight.level) for weight in criteria_set.pillar_weights if str(weight.pillar) == pillar
    }
    if not levels:
        raise UnknownCriterionError(f"{criteria_set.id} carries no weight for pillar {pillar!r}")
    if len(levels) > 1:
        raise CriteriaSetError(
            f"{criteria_set.id} weighs {pillar!r} at {', '.join(sorted(levels))}; the design "
            "addresses a pillar weight by set and pillar alone, so this one is ambiguous"
        )
    return levels.pop()


@router.put(
    "/criteria-sets/{criteria_set_id}/match-rules/{match_rule_id}",
    operation_id="setMatchRuleEnforcement",
    status_code=204,
)
async def set_match_rule_enforcement(
    criteria_set_id: str, match_rule_id: str, body: EnforcementBody, criteria: Criteria
) -> Response:
    """Whether this set enforces a gate.

    **A preference, not a fact** (`arch.md` 3.6): the gate's answer belongs to the candidate and
    stays stored either way; this decides only whether it counts against the score.
    """
    current = await criteria.read_criteria_set(criteria_set_id)
    enforced = set(current.enforced_match_rules)
    enforced.add(match_rule_id) if body.is_enforced else enforced.discard(match_rule_id)
    await criteria.replace_criteria_set(
        current.model_copy(update={"enforced_match_rules": frozenset(enforced)})
    )
    return Response(status_code=204)


@router.put(
    "/criteria-sets/{criteria_set_id}/compound-rules/{compound_rule_id}",
    operation_id="setCompoundRuleApplication",
    status_code=204,
)
async def set_compound_rule_application(
    criteria_set_id: str, compound_rule_id: str, body: ApplicationBody, criteria: Criteria
) -> Response:
    """Whether this set applies a compound rule. An undecided rule fires either way -- which is
    to say, not at all (`reqs.md` 7.4)."""
    current = await criteria.read_criteria_set(criteria_set_id)
    applied = set(current.applied_compound_rules)
    applied.add(compound_rule_id) if body.is_applied else applied.discard(compound_rule_id)
    await criteria.replace_criteria_set(
        current.model_copy(update={"applied_compound_rules": frozenset(applied)})
    )
    return Response(status_code=204)
