"""The composition root.

The one place in the system that knows concrete types, and the one place that reads the
environment (arch.md 6.8, 7.5). Nothing else names a database driver, an HTTP client or an
API key.

Two kinds of configuration are kept apart, deliberately:

    technical  -- how to reach things: connection string, API key, port, log level.
                  Environment variables, read here, never in git.

    domain     -- attributes, weights, thresholds, sources.
                  Rows in the database, shipped as migrations (arch.md 1.2).

Confusing the two is how "nothing hardcoded" quietly stops being true.
"""

from typing import TYPE_CHECKING

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

if TYPE_CHECKING:
    from fastapi import FastAPI


class Environment(BaseSettings):
    """Technical configuration, read from the environment exactly once.

    Values come from real environment variables, or from a `.env` file in development.
    `.env` is never committed; `.env.example` documents the shape with placeholder values.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # No env_prefix. The product name must not appear in an environment-variable
        # prefix (CLAUDE.md); these names describe what they configure, not what ships.
    )

    database_url: str = Field(
        description="PostgreSQL connection string. Never contains a default -- an "
        "application that invents a database to connect to is worse than one that refuses."
    )
    anthropic_api_key: str | None = Field(
        default=None,
        description="Only needed for the LLM acquisition path (reqs.md 6.10). Absent is "
        "valid: the MVP is country-level and uses it for one attribute.",
    )
    port: int = 8000
    host: str = Field(
        default="127.0.0.1",
        description="There is no authentication, ever (reqs.md 10). Binding to localhost "
        "IS the security model, so it is stated rather than assumed. In a container this "
        "becomes 0.0.0.0, and the published port is what stays bound to localhost.",
    )
    log_level: str = "INFO"

    app_display_name: str = Field(
        default="Starnest",
        description="The only place the product name is a value in this system, and it is a "
        "value rather than an identifier. Used for the page title, headings and About text. "
        "Renaming the product is a change to this one string.",
    )

    def __repr__(self) -> str:
        """Never render the API key. This object reaches logs and tracebacks."""
        return f"Environment(database_url=<redacted>, port={self.port}, host={self.host!r})"

    __str__ = __repr__


def build() -> tuple[Environment, "FastAPI"]:
    """Every concrete type, constructed and wired. The only place that names an implementation.

    Separate from `run` so that a caller which wants the application without a server -- the
    acceptance suite, or a script -- gets one without starting uvicorn. Nothing below this
    function knows which store implementation it holds, which is what makes the seams of
    `arch.md` 6.3 real rather than decorative.

    **The pool is opened lazily by the application, not here.** Constructing it is synchronous;
    connecting is not, and a composition root that awaited would have to be async for the
    benefit of one line.
    """
    from psycopg_pool import AsyncConnectionPool

    from starnest.api import build_app
    from starnest.storage import (
        PostgresCandidateStore,
        PostgresCriteriaStore,
        PostgresHouseholdStore,
        PostgresValueStore,
    )

    environment = Environment()  # type: ignore[call-arg]
    pool = AsyncConnectionPool(environment.database_url, min_size=1, open=False)

    app = build_app(
        households=PostgresHouseholdStore(pool),
        criteria_store=PostgresCriteriaStore(pool),
        candidates=PostgresCandidateStore(pool),
        values=PostgresValueStore(pool),
        display_name=environment.app_display_name,
    )

    @app.on_event("startup")
    async def _open_the_pool() -> None:
        await pool.open(wait=True)

    @app.on_event("shutdown")
    async def _close_the_pool() -> None:
        await pool.close()

    return environment, app


def run() -> None:
    """Build the application and serve it.

    Binding to `host` is the security model, stated rather than assumed: there is no
    authentication and there never will be (`reqs.md` 10), so what the socket is bound to is
    the whole of it.

    The startup checks `arch.md` 9.2 names -- refusing to start against a schema the code does
    not recognise, validating adapter declarations against the catalog, sweeping abandoned runs
    -- are not here yet. minE2E is the first thing that runs at all (`docs/mine2e.md` M3), and
    each of those needs a thing that does not exist to check against.
    """
    import uvicorn

    environment, app = build()
    uvicorn.run(
        app, host=environment.host, port=environment.port, log_level=environment.log_level.lower()
    )
