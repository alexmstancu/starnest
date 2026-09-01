"""How the application is tuned, as opposed to how the world is.

`reqs.md` 3.10. Four application-wide values that are neither about a place nor about the
household, edited in the Settings tab and read from four different modules: `min_coverage` and
`score_scale_max` by `evaluation`, `comparator_limit` by `comparison`, `run_spend_cap_eur` by
`data_acquisition`.

**Not to be confused with `starnest.main.Environment`.** That holds technical configuration --
the database URL, the API key, the display name -- read from the environment at startup and
never edited by anyone using the application. This is the opposite: domain policy, stored in a
row, changed by the user whenever they like.

**Typed fields rather than a key/value bag**, for the reason `reqs.md` 3.10 gives: a
`setting_key`/`setting_value` pair makes every setting text, so nothing can check that
`min_coverage` is a percentage or that `comparator_limit` is a positive integer.

**Nothing here has a default, and that is the whole point.** Every one of the four is marked
provisional -- 60, 100, 5, and an unset spend cap -- and a provisional number written into
code stops being provisional the moment someone reads it there. The migration seeds no row for
the same reason. A setting that is unset is unset, and the code that reads it says so.
"""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class Settings(BaseModel):
    """The four tuning values, each of which may legitimately not be set yet.

    Carries no identifier, exactly as `Household` carries none: there is one set of settings
    for the one household, `HouseholdStore` names none, and the database says `CHECK (id = 1)`.

    A `Settings` with every field `None` is not a broken record -- it is precisely what "not
    configured yet" means, and it is indistinguishable from the absence of the row. That is
    why reading settings has no not-configured error to raise, while reading the household
    does: the household's required fields could not be represented as absent.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    min_coverage: Decimal | None = Field(
        default=None,
        ge=0,
        le=100,
        description=(
            "A percentage, 0-100. Below this share of its scored criteria answered, a "
            "candidate is reported insufficient_data rather than given a total "
            "(`reqs.md` 5.3). Provisionally 60."
        ),
    )
    score_scale_max: int | None = Field(
        default=None, gt=0, description="The top of the score range. Provisionally 100."
    )
    comparator_limit: int | None = Field(
        default=None,
        ge=1,
        description=(
            "How many comparators one comparison may hold (`reqs.md` 8.5). Provisionally 5, "
            "and a setting rather than a constant so that it is never hardcoded."
        ),
    )
    run_spend_cap_eur: Decimal | None = Field(
        default=None,
        ge=0,
        description=(
            "The ceiling on what one data acquisition run may cost in API calls "
            "(`reqs.md` 6.3). The spend cap is not the household budget -- different word, "
            "deliberately different thing (`reqs.md` 1.4)."
        ),
    )
