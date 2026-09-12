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

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from starnest.data import CatalogStore
from starnest.data_acquisition import (
    GateResearcher,
    RunStore,
    SourceAdapter,
    declarations_that_disagree,
)
from starnest.storage import refuse_if_behind

if TYPE_CHECKING:
    from fastapi import FastAPI
    from psycopg_pool import AsyncConnectionPool


class Environment(BaseSettings):
    """Technical configuration, read from the environment exactly once.

    Values come from real environment variables, or from a `.env` file in development.
    `.env` is never committed; `.env.example` documents the shape with placeholder values.
    """

    model_config = SettingsConfigDict(
        # Both, because the application is started from two places: the repository root by
        # `make serve`, and `backend/` by anything run inside the package. In a container
        # neither exists and the values come from real environment variables, which is the
        # arrangement `.env` imitates rather than replaces.
        env_file=(".env", "../.env"),
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
    llm_model: str = Field(
        default="claude-sonnet-5",
        description="Which model the LLM path asks (reqs.md 6.10). A name rather than a "
        "hardcoded constant, because the best model for the money changes.",
    )
    llm_input_usd_per_mtok: Decimal | None = Field(
        default=None,
        description="US dollars per million input tokens, exactly as Anthropic's pricing page "
        "states it. **No default**: a run that cannot measure its own cost cannot be capped, "
        "and a default of zero would make the cap ornamental (reqs.md 6.3).",
    )
    llm_output_usd_per_mtok: Decimal | None = Field(
        default=None, description="US dollars per million output tokens."
    )
    llm_usd_per_web_search: Decimal | None = Field(
        default=None,
        description="US dollars per web search. The page publishes it per 1,000 searches.",
    )
    eur_usd_rate: Decimal | None = Field(
        default=None,
        description="How many US dollars one euro buys, as the ECB quotes it (1 EUR = n USD). "
        "Anthropic bills in USD and this application works in euro, so a conversion is needed "
        "-- and it names its rate, which is the rule reqs.md 5.5 applies to every monetary "
        "value. The ECB publishes a daily reference rate.",
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
        PostgresCatalogStore,
        PostgresCriteriaStore,
        PostgresEvaluationStore,
        PostgresHouseholdStore,
        PostgresMatchRuleResultStore,
        PostgresRunStore,
        PostgresValueStore,
    )

    environment = Environment()  # type: ignore[call-arg]
    pool = AsyncConnectionPool(environment.database_url, min_size=1, open=False)

    catalog = PostgresCatalogStore(pool)
    runs = PostgresRunStore(pool)
    adapters = _the_sources(catalog, environment)
    app = build_app(
        households=PostgresHouseholdStore(pool),
        criteria_store=PostgresCriteriaStore(pool),
        candidates=PostgresCandidateStore(pool),
        values=PostgresValueStore(pool),
        catalog_store=catalog,
        run_store=runs,
        match_rule_results=PostgresMatchRuleResultStore(pool),
        evaluation_store=PostgresEvaluationStore(pool),
        # The one place a concrete source is named. `api/` holds only the interface, which is
        # what lets the acceptance suite drive the same endpoints against a stub.
        adapters=adapters,
        # The gate researcher is the third permitted LLM use and is not a `SourceAdapter`: it
        # produces a proposed answer to a judgement, not a figure (`reqs.md` 6.10 use 3).
        researcher=_the_researcher(environment),
        display_name=environment.app_display_name,
    )

    @app.on_event("startup")
    async def _start() -> None:
        await start_up(
            database_url=environment.database_url,
            pool=pool,
            catalog=catalog,
            runs=runs,
            adapters=adapters,
        )
        # **The last source joins here, because its declaration is derived.** The fallback asks
        # a model about attributes *no other source covers*, and which those are is a fact about
        # the catalog and the registry together -- so it cannot be built before a connection
        # exists. It is asked only by a run that names its attributes (`asked_this_run`), so a
        # sweep of a level stays free.
        app.state.adapters = (*adapters, *await _the_fallback(environment, catalog, adapters))

    @app.on_event("shutdown")
    async def _close_the_pool() -> None:
        await pool.close()

    return environment, app


@dataclass(frozen=True)
class Booted:
    """What the startup checks found, so a caller can assert on the outcome rather than on a
    log line -- and so the boot log has one thing to print."""

    migrations_applied: int
    sources_registered: tuple[str, ...]
    runs_swept: tuple[int, ...]


async def start_up(
    *,
    database_url: str,
    pool: "AsyncConnectionPool",
    catalog: CatalogStore,
    runs: RunStore,
    adapters: Sequence[SourceAdapter],
    migrations: Path | None = None,
) -> Booted:
    """`arch.md` 9.2, in order, and it fails loudly rather than degrading.

    The environment is read by `Environment`; everything here needs a connection. Compare the
    schema and refuse if the database is behind, check every adapter declaration against the
    catalog, and sweep the runs a dead process left behind.

    **A function rather than a hook body**, so the sequence can be run without a server: the
    thing worth testing is the order and the refusals, not FastAPI's event plumbing.

    **Every decision is logged**, because the boot log is what answers "why did it refuse to
    start" (`arch.md` 9.4) -- and nothing logged here is the API key, which `Environment` will
    not render at all. **Configuring logging is not this function's business**: reaching into
    the root logger from a function whose job is checking a schema would take the handlers off
    whoever called it, which is exactly what it did to the test that read these lines.
    """
    boot = logging.getLogger("starnest.boot")

    state = (
        refuse_if_behind(database_url)
        if migrations is None
        else refuse_if_behind(database_url, migrations=migrations)
    )
    boot.info("schema is current: %d migrations applied", len(state.applied))

    await pool.open(wait=True)

    disagreements = declarations_that_disagree(adapters, await catalog.read_attributes())
    if disagreements:
        raise AdapterDeclarationError(
            "the adapters and the catalog disagree, so a run would fail halfway through:\n"
            + "\n".join(f"  - {complaint}" for complaint in disagreements)
        )
    registered = tuple(sorted(str(adapter.data_source) for adapter in adapters))
    boot.info(
        "%d sources registered, every declaration matched: %s",
        len(adapters),
        ", ".join(registered),
    )

    swept = await runs.sweep_abandoned_runs(finished_at=datetime.now(tz=UTC))
    if swept:
        boot.warning(
            "%d run(s) were left running by a process that died and are now failed: %s",
            len(swept),
            ", ".join(str(run) for run in swept),
        )
    else:
        boot.info("no abandoned run to sweep")

    return Booted(
        migrations_applied=len(state.applied), sources_registered=registered, runs_swept=swept
    )


def _the_sources(catalog: object, environment: "Environment") -> tuple:
    """Every source, constructed. The registry the startup check validates.

    Separate from `build` so that the check has something to be handed rather than something to
    reach into, and so that "which sources does this application have?" is one function.

    **The LLM path joins only when it is fully configured** -- a key and all three prices. A
    missing key is an ordinary state (the MVP's figures come from structured sources), and a key
    without prices is refused rather than run blind, because a run that cannot measure its own
    cost cannot be capped.
    """
    import httpx

    from starnest.data_sources.eurostat import EurostatAdapter, TaxWedgeEstimateAdapter
    from starnest.data_sources.imf import ImfAdapter
    from starnest.data_sources.oecd import OecdAdapter
    from starnest.data_sources.open_meteo import OpenMeteoAdapter
    from starnest.data_sources.who import WhoAdapter
    from starnest.data_sources.world_bank import WorldBankAdapter

    return (
        EurostatAdapter(httpx.AsyncClient(timeout=60)),
        WorldBankAdapter(httpx.AsyncClient(timeout=60)),
        WhoAdapter(httpx.AsyncClient(timeout=60)),
        ImfAdapter(httpx.AsyncClient(timeout=60)),
        OecdAdapter(httpx.AsyncClient(timeout=120)),
        TaxWedgeEstimateAdapter(httpx.AsyncClient(timeout=60)),
        # Reads the places it measures at from the catalog (D4), so it holds the store.
        OpenMeteoAdapter(httpx.AsyncClient(timeout=120), catalog),  # type: ignore[arg-type]
        *_the_paid_sources(environment),
    )


def _the_researcher(environment: "Environment") -> GateResearcher | None:
    """The model, as something that can read the official pages about a gate, or nothing."""
    llm = _the_model(environment)
    if llm is None:
        return None

    from starnest.data_sources.llm import LlmGateResearcher

    return LlmGateResearcher(llm)  # type: ignore[arg-type]


async def _the_fallback(
    environment: "Environment", catalog: CatalogStore, registered: Sequence[SourceAdapter]
) -> tuple:
    """The LLM fallback, declaring every scoreable attribute nothing else answers.

    "No dataset covers this" is literally "no adapter declares it" (`reqs.md` 6.10 use 1), so
    the set is derived from the registry rather than kept by hand -- a hand-kept list would drift
    the first time an adapter gained an attribute.
    """
    llm = _the_model(environment)
    if llm is None:
        return ()

    from starnest.data_sources.llm import LlmFallbackAdapter
    from starnest.data_sources.llm.fallback import ANSWERABLE

    covered = {attribute for adapter in registered for attribute in adapter.attributes}
    uncovered = tuple(
        attribute.id
        for attribute in await catalog.read_attributes()
        if attribute.id not in covered
        and attribute.value_type in ANSWERABLE
        and not attribute.is_retired
    )
    if not uncovered:
        return ()
    logging.getLogger("starnest.boot").info(
        "the llm may be asked about %d attribute(s) no other source covers", len(uncovered)
    )
    return (LlmFallbackAdapter(llm, answers=uncovered),)  # type: ignore[arg-type]


def _the_paid_sources(environment: "Environment") -> tuple:
    """The LLM adapters, or nothing at all, with the reason logged either way."""
    boot = logging.getLogger("starnest.boot")
    llm = _the_model(environment)
    if llm is None:
        return ()
    from starnest.data_sources.llm import LlmEmployersAdapter

    boot.info("the llm path is configured: model %s", environment.llm_model)
    return (LlmEmployersAdapter(llm),)


def _the_model(environment: "Environment") -> object | None:
    """The model, priced, or `None` with the reason said out loud."""
    boot = logging.getLogger("starnest.boot")
    if not environment.anthropic_api_key:
        boot.info("no anthropic api key: the llm path is off, and every other source is free")
        return None

    from anthropic import AsyncAnthropic

    from starnest.data_sources.llm import (
        LlmPricing,
        LlmWithSearch,
        PricingNotConfiguredError,
    )

    try:
        pricing = LlmPricing.configured(
            input_usd_per_million_tokens=environment.llm_input_usd_per_mtok,
            output_usd_per_million_tokens=environment.llm_output_usd_per_mtok,
            usd_per_web_search=environment.llm_usd_per_web_search,
            eur_usd_rate=environment.eur_usd_rate,
        )
    except PricingNotConfiguredError as unpriced:
        # Not a startup failure: the application runs perfectly well without the LLM path, and
        # refusing to boot over an unused feature would be worse than saying so.
        boot.warning("the llm path is off: %s", unpriced)
        return None

    # On the record, because a spend measured with an unknown rate is a spend nobody can check.
    boot.info("llm prices: %s", pricing.describe())
    return LlmWithSearch(
        AsyncAnthropic(api_key=environment.anthropic_api_key).messages,
        model=environment.llm_model,
        pricing=pricing,
    )


def _configure_logging(level: str) -> None:
    """One format for the application's own log, at the level the environment names.

    `force=True` because uvicorn configures the root logger too, and whichever ran last would
    otherwise decide the format for both. **Called only by `run`**, because evicting handlers is
    a thing only the owner of a process may do.
    """
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
        force=True,
    )


class AdapterDeclarationError(RuntimeError):
    """An adapter claims something the catalog does not bear out. A startup error, by design:
    the alternative is a run that fails halfway through for a reason that reads like a source's
    fault (`arch.md` 9.2 step 3)."""


def create_app() -> "FastAPI":
    """The application alone, for a server that wants to construct it itself.

    **A factory, not a module-level `app`.** uvicorn is told `--factory`, so this is called at
    startup rather than at import: a module-level instance would build a connection pool the
    moment anything imported `starnest.main`, including a test that only wanted `Environment`.
    An import that connects to a database is an import that fails for reasons unrelated to what
    imported it.
    """
    return build()[1]


def run() -> None:
    """Build the application and serve it.

    Binding to `host` is the security model, stated rather than assumed: there is no
    authentication and there never will be (`reqs.md` 10), so what the socket is bound to is
    the whole of it.

    The startup checks of `arch.md` 9.2 run in `build`'s startup hook, where a connection
    exists: the schema comparison that refuses to start when the database is behind, the
    adapter declarations checked against the catalog, and the sweep of runs a dead process left
    behind.
    """
    import uvicorn

    environment, app = build()
    # **Configured here and nowhere else.** `basicConfig(force=True)` evicts whatever handlers
    # are already on the root logger, which is right for a process that owns its own output and
    # wrong everywhere else: called from `build`, it took pytest's log capture away and made two
    # tests fail for a reason that had nothing to do with them. The entry point owns the
    # process, so the entry point configures the logging.
    _configure_logging(environment.log_level)
    uvicorn.run(
        app, host=environment.host, port=environment.port, log_level=environment.log_level.lower()
    )
