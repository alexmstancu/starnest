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

import pytest
from fastapi import FastAPI

from starnest.main import Environment, build, create_app

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

        **The roster is deliberate.** P4 adds a source at a time, and each one should be a line
        changed here rather than a thing that appeared."""
        _, app = build()

        assert {str(adapter.data_source) for adapter in app.state.adapters} == {
            "eurostat",
            "world_bank",
            "who",
            "imf",
            "oecd",
        }

    def test_no_two_adapters_claim_to_be_the_same_source(self) -> None:
        """Two adapters sharing a `data_source` would write values indistinguishable in
        provenance, and the active-value rule picks between sources by name."""
        _, app = build()

        sources = [str(adapter.data_source) for adapter in app.state.adapters]
        assert len(sources) == len(set(sources))

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
