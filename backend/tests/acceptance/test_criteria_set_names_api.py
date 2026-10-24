"""A set's name is trimmed, at most 60 characters and unique among live sets, and a new set's
identifier is derived from it when the request gives none (map-C03 B4).

PL-036 (UF-032): rename accepted a name another set already had. PL-041 (UF-066): nothing capped
a name. S4: a name of spaces was accepted. PL-039 (UF-047, S1): the client derived the identifier
under a rule of its own, so "Ελλάδα" could not be created and "2026 plan" was refused; the server
now derives it, skipping every identifier any set has held, deleted ones included (D-C03-2).
"""

from collections.abc import AsyncIterator, Awaitable, Callable

import httpx
import pytest
from psycopg_pool import AsyncConnectionPool

from .contract import validate

pytestmark = pytest.mark.acceptance

DEFAULT = "local_employment"
SIXTY = "S" * 60


@pytest.fixture
async def purged_afterwards(
    purge_criteria_set: Callable[[str], Awaitable[None]],
) -> AsyncIterator[list[str]]:
    """Ids a test may make; each is purged afterwards, live, deleted or never made."""
    made: list[str] = []
    yield made
    for identifier in made:
        await purge_criteria_set(identifier)


def _the_three_bodies(scratch: str, name: str) -> list[tuple[str, str, dict[str, str]]]:
    """Create, rename and duplicate, each carrying `name` and nothing else wrong."""
    return [
        ("POST", "/v1/criteria-sets", {"id": "never_made_by_b4", "name": name}),
        ("PATCH", f"/v1/criteria-sets/{scratch}", {"name": name}),
        (
            "POST",
            f"/v1/criteria-sets/{scratch}/duplicate",
            {"id": "never_made_by_b4", "name": name},
        ),
    ]


async def _name_of(api: httpx.AsyncClient, criteria_set: str) -> str:
    return (await api.get(f"/v1/criteria-sets/{criteria_set}")).json()["name"]


class TestANameIsUnique:
    async def test_renaming_to_another_sets_name_in_any_case_with_spaces_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """T36-B1: refused with the name, and the set keeps its own."""
        taken = await _name_of(api, DEFAULT)

        refused = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}", json={"name": f"  {taken.upper()} "}
        )

        assert refused.status_code == 409
        assert refused.json()["code"] == "criteria_set_name_taken"
        assert refused.json()["details"] == {"name": taken.upper()}
        assert await _name_of(api, a_scratch_criteria_set) == "Scratch"

    @pytest.mark.parametrize("identifier", [{"id": "taken_name_by_b4"}, {}])
    @pytest.mark.parametrize(
        "path", ["/v1/criteria-sets", f"/v1/criteria-sets/{DEFAULT}/duplicate"]
    )
    async def test_creating_or_duplicating_under_a_taken_name_is_refused(
        self,
        api: httpx.AsyncClient,
        purged_afterwards: list[str],
        path: str,
        identifier: dict[str, str],
    ) -> None:
        """T36-B2, with an identifier given and with one derived: a derived one never takes the
        next candidate over a name, because no identifier makes a taken name free."""
        listed = (await api.get("/v1/criteria-sets")).json()
        purged_afterwards.extend(["taken_name_by_b4", "local_employment_2"])

        refused = await api.post(path, json={**identifier, "name": await _name_of(api, DEFAULT)})

        assert (refused.status_code, refused.json()["code"]) == (409, "criteria_set_name_taken")
        assert (await api.get("/v1/criteria-sets")).json() == listed


class TestANameIsTrimmedAndBounded:
    async def test_a_name_is_stored_trimmed(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        renamed = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}", json={"name": "  Alex \t"}
        )

        assert renamed.status_code == 200
        assert await _name_of(api, a_scratch_criteria_set) == "Alex"

    @pytest.mark.parametrize("name", ["   ", "\t\n", "S" * 61, f" {'S' * 61} "])
    async def test_a_blank_or_long_name_is_refused_on_every_body(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, name: str
    ) -> None:
        """T36-B5 (S4) and T41-B1: a name of spaces, or one past 60 once trimmed."""
        listed = (await api.get("/v1/criteria-sets")).json()

        answers = [
            await api.request(method, path, json=body)
            for method, path, body in _the_three_bodies(a_scratch_criteria_set, name)
        ]

        assert [answer.status_code for answer in answers] == [422, 422, 422]
        assert (await api.get("/v1/criteria-sets")).json() == listed

    async def test_sixty_characters_are_enough(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        renamed = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}", json={"name": f" {SIXTY} "}
        )

        assert (renamed.status_code, renamed.json()["name"]) == (200, SIXTY)

    async def test_a_longer_name_stored_before_the_cap_still_reads_and_can_be_shortened(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, database_url: str
    ) -> None:
        """T41-B1: the cap is on the requests, never on the stored set."""
        long_name = "L" * 80
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                await connection.execute(
                    "UPDATE criteria_set SET name = %s WHERE id = %s",
                    (long_name, a_scratch_criteria_set),
                )

        read = await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")
        listed = (await api.get("/v1/criteria-sets")).json()["items"]
        renamed = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}", json={"name": "Short again"}
        )

        assert (read.status_code, read.json()["name"]) == (200, long_name)
        assert {"id": a_scratch_criteria_set, "name": long_name}.items() <= next(
            item for item in listed if item["id"] == a_scratch_criteria_set
        ).items()
        assert (renamed.status_code, renamed.json()["name"]) == (200, "Short again")


class TestTheServerDerivesTheIdentifier:
    async def test_a_name_whose_identifier_a_deleted_set_holds_takes_the_next_free_one(
        self, api: httpx.AsyncClient, purged_afterwards: list[str]
    ) -> None:
        """T39-B2 (D-C03-1, D-C03-2): a deleted set keeps its identifier, so it is skipped."""
        purged_afterwards.extend(["partner", "partner_2"])
        made = await api.post("/v1/criteria-sets", json={"id": "partner", "name": "Partner"})
        assert made.status_code == 201
        assert (await api.delete("/v1/criteria-sets/partner")).status_code == 204

        created = await api.post("/v1/criteria-sets", json={"name": "Partner"})

        assert created.status_code == 201
        validate("createCriteriaSet", created.json(), status=201)
        assert (created.json()["id"], created.json()["name"]) == ("partner_2", "Partner")
        assert (await api.post("/v1/criteria-sets/partner/restore")).status_code == 409

    @pytest.mark.parametrize(
        ("name", "derived"), [("Ελλάδα", "set"), ("2026 plan by B4", "set_2026_plan_by_b4")]
    )
    async def test_a_name_with_no_usable_start_is_still_created(
        self, api: httpx.AsyncClient, purged_afterwards: list[str], name: str, derived: str
    ) -> None:
        """PL-039 and S1: no Latin letters at the start is a prefix, never a refusal."""
        purged_afterwards.append(derived)

        created = await api.post("/v1/criteria-sets", json={"name": name})

        assert (created.status_code, created.json()["id"]) == (201, derived)

    async def test_a_duplicate_with_no_identifier_is_given_one_and_located_there(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, purged_afterwards: list[str]
    ) -> None:
        purged_afterwards.append("copied_by_b4")

        copied = await api.post(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/duplicate", json={"name": "Copied by B4"}
        )

        assert (copied.status_code, copied.json()["id"]) == (201, "copied_by_b4")
        assert copied.headers["Location"] == "/v1/criteria-sets/copied_by_b4"
