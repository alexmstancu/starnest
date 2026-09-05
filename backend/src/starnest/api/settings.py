"""`GET /v1/settings` -- the four tuning values.

The smallest endpoint in the contract and the first one anything calls: the compose healthcheck
uses it rather than a `/health` route invented for the purpose, because adding a path would be a
change to `openapi.yaml`, which has consumers other than this application.

**Every field may be null**, and that is the shipped state. `min_coverage`, `score_scale_max`,
`comparator_limit` and `run_spend_cap_eur` are provisional by design (`reqs.md` 3.10): the
document proposes values and the user chooses them, so an unset one is a decision not yet made
rather than a fault.
"""

from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel

from starnest.api.dependencies import Households

router = APIRouter(tags=["settings"])


class SettingsBody(BaseModel):
    """`SettingsInput` from the contract, which `Settings` is defined as."""

    min_coverage: Decimal | None = None
    score_scale_max: int | None = None
    comparator_limit: int | None = None
    run_spend_cap_eur: Decimal | None = None


@router.get("/settings", operation_id="getSettings", response_model=SettingsBody)
async def get_settings(households: Households) -> SettingsBody:
    settings = await households.get_settings()
    return SettingsBody(
        min_coverage=settings.min_coverage,
        score_scale_max=settings.score_scale_max,
        comparator_limit=settings.comparator_limit,
        run_spend_cap_eur=settings.run_spend_cap_eur,
    )
