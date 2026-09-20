"""The composition root, built the way production builds it.

**This file exists because of a bug that eighteen acceptance tests missed.** The Dockerfile
asked uvicorn for `starnest.main:app`, and what the module offers is `create_app()` behind
`--factory`. Every acceptance test passed throughout, because each one builds the application
itself, with its own stubs, and none of them ever took the path the container takes. The
container found it by restart-looping.

So these assert the wiring rather than the behaviour: that the entry point the Dockerfile names
exists and returns something, that the routers the container's healthcheck depends on are
mounted, and that every adapter is actually reachable from the app. **Defects live in seams**,
and this is the seam between the code and the thing that starts it.

**Nothing here touches a database.** `build()` constructs the pool with `open=False` -- it makes
a connection object, it does not connect -- which is what makes the composition root testable
at all, and is asserted below rather than assumed.
"""

from decimal import Decimal

import pytest
from fastapi import FastAPI

from starnest.data import Attribute, RatioParameters, ValueType
from starnest.main import (
    Environment,
    _the_fallback,
    _the_model,
    _the_paid_sources,
    _the_researcher,
    build,
    create_app,
)

UNREACHABLE = "postgresql://nobody:nothing@127.0.0.1:1/no_such_database"
"""Port 1, a database nobody created. Anything that dials this fails loudly and immediately."""


@pytest.fixture(autouse=True)
def _a_configured_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Real environment variables, which pydantic-settings prefers over any `.env` on disk.

    Pointed at nothing reachable on purpose: a test that quietly used the developer's own
    database would pass here and prove nothing about a container that has neither.
    """
    monkeypatch.setenv("DATABASE_URL", UNREACHABLE)
    monkeypatch.setenv("APP_DISPLAY_NAME", "Starnest")


class TestTheEntryPointTheContainerNames:
    def test_create_app_returns_an_application(self) -> None:
        """`uvicorn starnest.main:create_app --factory`, in one assertion.

        The Dockerfile's CMD is the only caller. If this ever stops being true the container
        restart-loops, and nothing else in the suite notices.
        """
        assert isinstance(create_app(), FastAPI)

    def test_build_returns_the_environment_too_because_run_needs_it(self) -> None:
        """`run()` reads host, port and log level off it. A `build()` that returned only the
        app would push that back into a second read of the environment."""
        environment, app = build()

        assert isinstance(environment, Environment)
        assert isinstance(app, FastAPI)

    def test_building_never_opens_a_connection(self) -> None:
        """The pool is constructed with `open=False` and opened by the application's startup
        event. If that changed, this would raise rather than return -- which is also what makes
        every other test in this file possible."""
        _, app = build()

        assert app is not None


class TestWhatIsActuallyWiredIn:
    def test_the_endpoint_the_healthcheck_calls_is_mounted(self) -> None:
        """`compose.yaml` polls `/v1/settings`. A router left unmounted means a container that
        never reports healthy, and nothing else here would say why."""
        paths = _routed_paths()

        assert "/v1/settings" in paths

    @pytest.mark.parametrize(
        "path",
        [
            "/v1/household",
            "/v1/pillars",
            "/v1/attributes",
            "/v1/criteria-sets/{criteria_set_id}",
            "/v1/rankings",
            "/v1/data-acquisition-runs",
        ],
    )
    def test_every_router_reaches_the_application(self, path: str) -> None:
        """One path per router. A router that is written, tested and never included is a
        module the acceptance suite exercises through its own app and the container does not
        serve at all."""
        assert path in _routed_paths()

    def test_every_source_is_wired_and_reachable_from_the_app(self) -> None:
        """The adapters are what `POST /data-acquisition-runs` fans out over. One that is
        written but never passed here is a source that silently fetches nothing -- no error,
        no failure row, just an attribute that stays empty for a reason nobody can see.

        **The roster is deliberate.** P4 added a source at a time, and each one should be a line
        changed here rather than a thing that appeared.

        **The free seven are asserted exactly; the paid ones are asserted to be paid.** Whether
        the LLM path is wired depends on whether a key and prices are configured, which is a
        property of the machine rather than of the code -- this test asserted an exact set and
        started failing the moment somebody pasted a key.
        """
        _, app = build()

        wired = {str(adapter.data_source) for adapter in app.state.adapters}
        paid = {str(a.data_source) for a in app.state.adapters if a.costs_money}

        assert wired - paid == {
            "eurostat",
            "world_bank",
            "who",
            "imf",
            "oecd",
            "eurostat_estimate",
            "open_meteo",
            # Transcribed tables, one per file in `published_tables/tables/` (Q230). Each is
            # the publisher the catalog already ranks first for its attribute.
            "rsf",
            "ef_epi",
            "mipex",
            # Statutory paid leave is national law in 31 jurisdictions and no publisher prints
            # it as one table, so the transcription is stored under `national_law` -- the
            # source the catalog already ranks for it.
            "national_law",
        }
        # Nothing but the LLM path charges, and it is the only thing that may appear here
        # because of configuration rather than because of code.
        assert paid <= {"llm"}

    def test_no_two_adapters_answer_one_attribute_as_the_same_source(self) -> None:
        """Provenance has to say which adapter answered, and it names a source and an attribute.

        **The pair is the grain, not the source alone.** This asserted that no two adapters
        share a `data_source`, which was true only while every publisher had one route to it.
        OECD now has two -- an API for the tax wedge, a workbook for the Family Database -- and
        they answer disjoint attributes, so nothing is ambiguous: `run.py` asks an adapter only
        about the attributes it declares, and a retry narrows by intersecting with them. Giving
        the workbook a second source id to keep the old wording would put a falsehood in the
        provenance, because an OECD figure read off OECD's own file is an OECD figure.

        `check_declarations` enforces exactly this at boot and is the authority; this restates
        it over what the composition root actually wires.
        """
        _, app = build()

        claims = [
            (str(adapter.data_source), str(attribute))
            for adapter in app.state.adapters
            for attribute in adapter.attributes
        ]
        assert len(claims) == len(set(claims))

    def test_every_store_the_routers_read_is_present(self) -> None:
        """`api/` reads these off `app.state` by name, so a missing one is an `AttributeError`
        at request time rather than at startup."""
        _, app = build()

        for store in ("household", "criteria", "candidates", "values", "catalog", "runs"):
            assert getattr(app.state, store) is not None


class TestTheOnePlaceTheProductNameIsAValue:
    def test_the_display_name_reaches_the_application_title(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Renaming the product is a change to one environment variable (`CLAUDE.md`). If the
        title were a literal in `build_app`, this would pass with the old name."""
        monkeypatch.setenv("APP_DISPLAY_NAME", "Somewhere Else")

        _, app = build()

        assert app.title == "Somewhere Else"


def _routed_paths() -> set[str]:
    """What the application actually serves, read off its own OpenAPI document.

    Not `app.routes`, which also holds router-inclusion records with no path of their own. The
    document is the same thing `make openapi` generates and the contract-drift test compares
    against, so a path missing here is a path missing there.
    """
    _, app = build()
    return set(app.openapi()["paths"])


FULLY_CONFIGURED: dict[str, object] = {
    "anthropic_api_key": "sk-ant-not-a-real-key",
    "llm_input_usd_per_mtok": Decimal(2),
    "llm_output_usd_per_mtok": Decimal(10),
    "llm_usd_per_web_search": Decimal("0.01"),
    "eur_usd_rate": Decimal("1.1592"),
    "llm_input_tokens_per_call": 12_000,
}
"""Every variable the LLM path needs before it will join (Q219, `reqs.md` 6.3). Named once, so a
test about one missing piece is that piece removed rather than five lines retyped."""


class TestWiringTheLlmPath:
    """**The path joins only when it is fully configured**, and says why when it does not.

    Three states, all ordinary: no key at all (the MVP's figures come from structured sources), a
    key with no prices (refused, because a run that cannot measure its own cost cannot be
    capped), and both (registered). None of them is a startup failure -- refusing to boot over an
    unused feature would be worse than saying so in the log.
    """

    @pytest.fixture(autouse=True)
    def _without_the_developers_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """**These tests build their own environment and must read nothing else.**

        They used to construct `Environment` with `.env` still in play, so they passed while the
        key was blank and failed the moment somebody pasted a real one -- a test that depends on
        a developer's private file is a test that breaks for the wrong reason.
        """
        for name in (
            "ANTHROPIC_API_KEY",
            "LLM_MODEL",
            "LLM_INPUT_USD_PER_MTOK",
            "LLM_OUTPUT_USD_PER_MTOK",
            "LLM_USD_PER_WEB_SEARCH",
            "EUR_USD_RATE",
            "LLM_INPUT_TOKENS_PER_CALL",
        ):
            monkeypatch.delenv(name, raising=False)

    def an_environment(self, **overrides: object) -> Environment:
        fields: dict[str, object] = {
            "database_url": "postgresql://localhost/starnest",
            # `_env_file=None` for the same reason: what this test configures is all there is.
            "_env_file": None,
        }
        return Environment(**(fields | overrides))  # type: ignore[arg-type]

    def a_configured_environment(self, **overrides: object) -> Environment:
        """Everything the LLM path requires, so a test about one missing piece removes one."""
        return self.an_environment(**(FULLY_CONFIGURED | overrides))

    def test_no_key_means_no_model_and_a_line_in_the_log(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level("INFO", logger="starnest.boot"):
            model = _the_model(self.an_environment())

        assert model is None
        assert "no anthropic api key" in caplog.text

    def test_a_key_without_prices_is_refused_with_the_reason(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The refusal names the variables, because "the llm path is off" alone would send
        somebody looking at the key."""
        with caplog.at_level("WARNING", logger="starnest.boot"):
            model = _the_model(self.an_environment(anthropic_api_key="sk-ant-not-a-real-key"))

        assert model is None
        assert "LLM_INPUT_USD_PER_MTOK" in caplog.text

    def test_prices_without_the_call_size_are_refused_too(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The same rule as the prices, for the same reason: a path that cannot estimate a run
        cannot warn before spending (`reqs.md` 6.3). Off, with the variable named."""
        with caplog.at_level("WARNING", logger="starnest.boot"):
            model = _the_model(self.a_configured_environment(llm_input_tokens_per_call=None))

        assert model is None
        assert "LLM_INPUT_TOKENS_PER_CALL" in caplog.text

    def test_a_key_and_every_price_makes_a_model(self) -> None:
        model = _the_model(self.a_configured_environment())

        assert model is not None

    def test_the_configured_path_registers_the_employers_source(self) -> None:
        sources = _the_paid_sources(self.a_configured_environment())

        assert [str(source.data_source) for source in sources] == ["llm"]
        assert all(source.costs_money for source in sources)

    def test_an_unconfigured_path_registers_nothing(self) -> None:
        assert _the_paid_sources(self.an_environment()) == ()

    def test_the_researcher_follows_the_same_rule(self) -> None:
        assert _the_researcher(self.an_environment()) is None
        assert _the_researcher(self.a_configured_environment()) is not None

    def test_every_source_that_charges_can_say_what_it_would_cost(self) -> None:
        """**The two declarations have to agree.** A source that charges and estimates nothing
        would report a paid run as free -- the plan would say zero, the household would agree to
        it, and the bill would arrive anyway. Asserted over the registry this application ships
        rather than over a class written by a test, because that is where the mistake would be.
        """
        paid = _the_paid_sources(self.a_configured_environment())

        assert paid, "nothing paid was registered, so this asserts nothing"
        for source in paid:
            estimate = source.estimate_for(10)
            assert source.costs_money
            assert estimate.calls == 10, f"{source.data_source} counted no calls"
            assert estimate.cost_eur > 0, f"{source.data_source} priced a paid run at nothing"
            assert estimate.basis, f"{source.data_source} priced a run without saying how"

    def test_the_researcher_can_say_what_a_pass_would_cost(self) -> None:
        """The same rule for the thing that spends the most (`reqs.md` 6.10 use 3)."""
        researcher = _the_researcher(self.a_configured_environment())

        assert researcher is not None
        assert researcher.costs_money
        assert researcher.estimate_for(128).cost_eur > 0

    def test_the_key_is_never_in_what_the_log_would_print(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """`arch.md` 9.4: never the API key. The boot log names the model, not the credential."""
        with caplog.at_level("INFO", logger="starnest.boot"):
            _the_paid_sources(
                self.a_configured_environment(anthropic_api_key="sk-ant-a-key-that-must-not-appear")
            )

        assert "sk-ant-a-key-that-must-not-appear" not in caplog.text


class TestTheFallbackDeclaration:
    """ "No dataset covers this" is literally "no adapter declares it" (`reqs.md` 6.10 use 1).

    Derived from the registry rather than kept by hand, because a hand-kept list drifts the first
    time an adapter gains an attribute -- and the drift would be silent, with a model quietly
    answering something a real source had started publishing.
    """

    async def test_it_declares_the_scoreable_attributes_nothing_else_answers(self) -> None:
        environment = Environment(
            _env_file=None,
            database_url="postgresql://localhost/starnest",
            **FULLY_CONFIGURED,  # type: ignore[arg-type]
        )

        (fallback,) = await _the_fallback(environment, _ACatalogOfThree(), [_AnsweringOne()])

        assert set(fallback.attributes) == {"country.uncovered_ratio"}

    async def test_with_no_model_there_is_no_fallback(self) -> None:
        environment = Environment(_env_file=None, database_url="postgresql://localhost/starnest")

        assert await _the_fallback(environment, _ACatalogOfThree(), []) == ()


class _AnsweringOne:
    """A source that covers one of the catalog's three attributes."""

    @property
    def data_source(self) -> str:
        return "eurostat"

    @property
    def attributes(self) -> tuple[str, ...]:
        return ("country.covered_ratio",)


class _ACatalogOfThree:
    """Three attributes: one covered, one not, one that carries no magnitude."""

    async def read_attributes(self, level: str | None = None) -> list[Attribute]:
        return [
            Attribute(
                id="country.covered_ratio",
                name="Covered",
                level="country",
                value_type=ValueType.RATIO,
                pillar="housing",
                ratio_parameters=RatioParameters(basis="households"),
            ),
            Attribute(
                id="country.uncovered_ratio",
                name="Uncovered",
                level="country",
                value_type=ValueType.RATIO,
                pillar="housing",
                ratio_parameters=RatioParameters(basis="households"),
            ),
            Attribute(
                id="country.climate_zone",
                name="A label set, which carries no magnitude",
                level="country",
                value_type=ValueType.LABEL_SET,
                pillar="climate",
            ),
        ]
