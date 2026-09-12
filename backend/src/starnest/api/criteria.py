"""The criteria set a ranking is computed with, and the one thing the user changes about it.

Two endpoints. `GET` shows the set; `PATCH` moves one weight and returns **the pillar the server
rebalanced**, not an acknowledgement.

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
from pydantic import BaseModel, Field

from starnest.api.bodies import ContractBody
from starnest.api.dependencies import Criteria
from starnest.criteria import CriteriaSet, CriteriaSetError, Criterion, UnknownCriterionError

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


class CriterionInput(BaseModel):
    """Only the fields present are changed.

    minE2E sends one of them. The rest are declared because the contract declares them, and an
    endpoint that silently ignored a field a client sent would be worse than one that refuses
    it.
    """

    # `Decimal` on the way IN and `float` on the way out, deliberately. A JSON number parsed
    # into a Decimal is exact, and the weight then reaches the rebalancing arithmetic without
    # having been through binary floating point. Coming back it is a display figure the contract
    # types as `number`, and JSON has no other kind.
    weight: Decimal | None = Field(default=None, ge=0, le=100)
    is_scored: bool | None = None
    weight_locked: bool | None = None


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
    """
    if change.weight is None:
        return current
    return current.with_criterion_weight(attribute, change.weight)


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
    )


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
