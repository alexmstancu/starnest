"""`GET /holdings`: what the database holds at a level, against the design (PL-051, PL-052, PL-054).

The figures and their arithmetic are proved in `tests/storage/test_holdings.py`; this is the
client's view -- the shape the design promises, populated with every kind of gap, and the
refusals the parameters can earn.
"""

import httpx
import pytest

from .conftest import a_stub_source, an_api
from .contract import undeclared_fields, validate

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
MONTH_START = "2026-10-01T00:00:00+03:00"
DECLINES_FOR = "country.portugal"
HAS_NO_ROW_FOR = "country.liechtenstein"
BORROWS_A_NEIGHBOURS_FIGURES = HAS_NO_ROW_FOR


async def test_a_database_with_every_kind_of_gap_matches_the_designed_shape(
    database_url: str,
) -> None:
    source = a_stub_source(silent_about=(DECLINES_FOR,), no_row_for=(HAS_NO_ROW_FOR,))
    async with an_api(database_url, (source,)) as api:
        await api.post(
            "/v1/data-acquisition-runs",
            json={"level": COUNTRY, "candidates": [DECLINES_FOR, HAS_NO_ROW_FOR, "country.spain"]},
        )

        response = await api.get("/v1/holdings", params={"level": COUNTRY, "since": MONTH_START})

    body = response.json()
    assert response.status_code == 200
    validate("getHoldings", body)
    assert undeclared_fields("getHoldings", body) == []
    gaps = body["gaps"]
    assert {gap["candidate"] for gap in gaps["failed"]} == {DECLINES_FOR}
    assert {gap["candidate"] for gap in gaps["unanswered"]} == {HAS_NO_ROW_FOR}
    assert body["values_stored"] == 2
    assert (
        body["values_stored"] + sum(len(listed) for listed in gaps.values())
        == (body["pairs_total"])
    )


async def test_an_unknown_level_is_refused_naming_it(api: httpx.AsyncClient) -> None:
    response = await api.get("/v1/holdings", params={"level": "planet", "since": MONTH_START})

    assert response.status_code == 422
    assert response.json()["code"] == "unknown_scope"
    assert response.json()["details"] == {"level": "planet", "unknown_levels": ["planet"]}


@pytest.mark.parametrize("since", [None, "2026-10-01T00:00:00", "the first"])
async def test_a_month_start_that_is_missing_or_has_no_zone_is_refused(
    api: httpx.AsyncClient, since: str | None
) -> None:
    """The browser's own month boundary (C04-N10). A time with no zone would be read in the
    database's, which is the clock decision the request exists to keep off the server."""
    params = {"level": COUNTRY} | ({} if since is None else {"since": since})

    response = await api.get("/v1/holdings", params=params)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"


async def test_a_switched_off_source_s_attributes_are_not_counted_as_fetchable(
    api: httpx.AsyncClient,
) -> None:
    """The pairs are what a source the household consults can fetch (Q232). With the only
    source off, what is left is what a stand-in can lend."""
    params = {"level": COUNTRY, "since": MONTH_START}
    before = (await api.get("/v1/holdings", params=params)).json()["pairs_total"]
    try:
        switched = await api.patch("/v1/data-sources/eurostat", json={"is_enabled": False})
        assert switched.status_code == 200

        after = (await api.get("/v1/holdings", params=params)).json()
    finally:
        restored = await api.patch("/v1/data-sources/eurostat", json={"is_enabled": True})
        assert restored.status_code == 200

    assert before - after["pairs_total"] == 32 * 2
    lent = {gap["candidate"] for gap in after["gaps"]["not_reached"]}
    assert after["pairs_total"] > 0
    assert lent == {BORROWS_A_NEIGHBOURS_FIGURES}
