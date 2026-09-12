"""The four tuning values, read and replaced (`reqs.md` 3.10).

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
from starnest.household import Settings

router = APIRouter(tags=["settings"])


class SettingsBody(BaseModel):
    """`SettingsInput` from the contract, which `Settings` is defined as.

    **The two percentages travel as numbers, not as `Decimal`.** The contract types them
    `number`, and Pydantic renders a `Decimal` as a JSON string -- which is lossless, and not
    what the design says. It went unnoticed while every setting was null (`known-issues.md` P16).
    """

    min_coverage: float | None = None
    score_scale_max: int | None = None
    comparator_limit: int | None = None
    run_spend_cap_eur: float | None = None


@router.get("/settings", operation_id="getSettings", response_model=SettingsBody)
async def get_settings(households: Households) -> SettingsBody:
    settings = await households.get_settings()
    return SettingsBody(
        min_coverage=None if settings.min_coverage is None else float(settings.min_coverage),
        score_scale_max=settings.score_scale_max,
        comparator_limit=settings.comparator_limit,
        run_spend_cap_eur=(
            None if settings.run_spend_cap_eur is None else float(settings.run_spend_cap_eur)
        ),
    )


@router.put("/settings", operation_id="replaceSettings", response_model=SettingsBody)
async def replace_settings(body: SettingsBody, households: Households) -> SettingsBody:
    """Store all four, and answer with what was stored.

    **Replaced whole, never patched**, for the reason the household is: these four decide what a
    score means, and a partial write would leave a ranking computed half against the old scale
    and half against the new. **A null stays null** -- it is a decision the household has not
    made, and substituting a default here would be this application choosing what "enough
    coverage" means (`devplan.md` 0.3).
    """
    await households.replace_settings(
        Settings(
            min_coverage=None if body.min_coverage is None else Decimal(str(body.min_coverage)),
            score_scale_max=body.score_scale_max,
            comparator_limit=body.comparator_limit,
            run_spend_cap_eur=(
                None if body.run_spend_cap_eur is None else Decimal(str(body.run_spend_cap_eur))
            ),
        )
    )
    return await get_settings(households)
