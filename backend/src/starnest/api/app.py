"""The REST surface assembled: the `/v1` prefix, the routers, and the one error shape.

`arch.md` 7.6. Versioned from the first request, because the contract has consumers other than
the interface and adding a prefix afterwards breaks all of them.

**This module builds the app; it does not decide what the app talks to.** The stores arrive
already constructed and are put on the application state, so the same endpoints serve the real
database and a test's fakes without knowing which they have.
"""

from fastapi import FastAPI

from starnest.api import catalog, criteria, rankings, settings
from starnest.api.errors import domain_error_handler
from starnest.candidates import CandidateStore
from starnest.criteria import CriteriaStore
from starnest.data import CatalogStore, ValueStore
from starnest.household import HouseholdStore

API_PREFIX = "/v1"


def build_app(
    *,
    households: HouseholdStore,
    criteria_store: CriteriaStore,
    candidates: CandidateStore,
    values: ValueStore,
    catalog_store: CatalogStore,
    display_name: str = "Starnest",
) -> FastAPI:
    """One application, wired to the stores it was given.

    `display_name` is the only place the product name appears as a value, and it is a value
    rather than an identifier (`CLAUDE.md`): renaming the product is a change to one string.
    """
    app = FastAPI(
        title=display_name,
        version="1.0.0",
        # No CORS configuration anywhere. The interface is served same-origin through nginx,
        # and there is no authentication to protect (reqs.md 10).
    )
    app.state.household = households
    app.state.criteria = criteria_store
    app.state.candidates = candidates
    app.state.values = values
    app.state.catalog = catalog_store

    for router in (settings.router, catalog.router, criteria.router, rankings.router):
        app.include_router(router, prefix=API_PREFIX)

    # One handler for every domain fault, rather than a try/except in each endpoint: two
    # endpoints reporting the same fault differently is how a client comes to branch on prose.
    #
    # Registered against `ValueError` and `LookupError` rather than `Exception`, for two
    # reasons. Starlette treats a handler on `Exception` as the server-error handler and
    # re-raises after responding, so domain faults escaped instead of being rendered. And those
    # two ARE the house contract: every fault the domain raises is one or the other, stated in
    # `criteria/` and asserted by its tests. Anything else is a bug, and a bug should reach the
    # logs as a 500 rather than be dressed as a tidy error body nobody investigates.
    app.add_exception_handler(ValueError, domain_error_handler)
    app.add_exception_handler(LookupError, domain_error_handler)
    return app
