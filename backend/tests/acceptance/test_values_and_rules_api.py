"""Values with their provenance, manual entry, and the gates' answers -- over HTTP (W4-E).

Gate B asks that a value's reference date and retrieval date be **displayable**, which means
served; `reqs.md` 6.5 that a value may be typed only where its attribute says so; and `reqs.md`
3.7 that a gate's answer carry its sources and an audited override.
"""

import asyncio
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, ClassVar

import httpx
import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import Value
from starnest.storage import PostgresValueStore

from .conftest import a_stub_source, an_api
from .contract import response_schema, validate, validate_refusal

pytestmark = pytest.mark.acceptance

COUNTRY = "country"
NATURALISATION = "country.naturalisation_pathway"
"""A Quantity in years that declares manual entry: no dataset publishes it (`reqs.md` 6.9)."""

AN_IDENTIFIER = re.compile(r"(country|city)\.[a-z0-9_]+")

OVERBURDEN = "country.housing_cost_overburden_rate"
"""Declares no manual entry: its values come from Eurostat."""

A_TYPED_VALUE = {
    "candidate": "country.portugal",
    "attribute": NATURALISATION,
    "payload": {"magnitude": 5, "unit": "years"},
    "reference_period": {"start": "2026-01-01", "end": "2026-12-31"},
    "retrieval_date": "2026-09-11T10:00:00Z",
    "quote": "Lei da Nacionalidade, art. 6: five years of legal residence",
    "citations": ["https://www.pgdlisboa.pt/leis/lei_mostra_articulado.php?nid=614"],
}


class _HeldBeforeAppending(PostgresValueStore):
    """Holds each `append` until a second request reaches it too, so two submissions have both
    finished whatever they read before either writes."""

    def __init__(self, pool: AsyncConnectionPool) -> None:
        super().__init__(pool)
        self._both_here = asyncio.Barrier(2)

    async def append(self, values: Sequence[Value]) -> tuple[Value, ...]:
        async with asyncio.timeout(10):
            await self._both_here.wait()
        return await super().append(values)


def _identity_of(value: dict[str, Any]) -> dict[str, Any]:
    """What names one stored observation: its id and its natural key."""
    return {
        "value_id": value["id"],
        "candidate": value["candidate"],
        "attribute": value["attribute"],
        "data_source": value["data_source"],
        "reference_period": value["reference_period"],
        "retrieval_date": datetime.fromisoformat(value["retrieval_date"]),
    }


def _identity_in(details: dict[str, Any]) -> dict[str, Any]:
    return details | {"retrieval_date": datetime.fromisoformat(details["retrieval_date"])}


class TestThePageBounds:
    """**The page bounds the contract declares are the bounds the code enforces.**

    `openapi.yaml` gives `limit` a maximum of 1000, and the code took a bare `int`: `?limit=
    100000` served a page the contract says cannot be asked for, and a negative bound went
    straight into `LIMIT`/`OFFSET`, where PostgreSQL refuses it -- a 500 for a request that was
    merely wrong. Both listings take the same parameters and are checked together.
    """

    @pytest.mark.parametrize("path", ["/v1/values", "/v1/data-acquisition-runs"])
    async def test_a_page_larger_than_the_contract_allows_is_refused(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        response = await api.get(path, params={"limit": 100000})

        assert response.status_code == 422

    @pytest.mark.parametrize("path", ["/v1/values", "/v1/data-acquisition-runs"])
    async def test_a_negative_page_bound_is_refused_rather_than_reaching_the_database(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        assert (await api.get(path, params={"limit": -1})).status_code == 422
        assert (await api.get(path, params={"offset": -1})).status_code == 422

    @pytest.mark.parametrize("path", ["/v1/values", "/v1/data-acquisition-runs"])
    async def test_the_largest_page_the_contract_allows_is_served(
        self, api: httpx.AsyncClient, path: str
    ) -> None:
        """The control: the bound refuses what is over it, and serves what is on it."""
        response = await api.get(path, params={"limit": 1000, "offset": 0})

        assert response.status_code == 200


class TestReadingValues:
    async def test_both_dates_come_back_and_are_not_the_same_thing(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """The period a figure describes and the moment it was fetched, never merged
        (`reqs.md` 3.6) -- Gate B's "both displayable"."""
        body = (await api.get("/v1/values", params={"candidate": "country.portugal"})).json()

        value = body["items"][0]
        assert value["reference_period"] == {"start": "2025-01-01", "end": "2025-12-31"}
        assert value["retrieval_date"].startswith("20")
        assert value["retrieval_date"][:10] != value["reference_period"]["start"]

    async def test_by_default_only_the_value_being_scored_comes_back(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        await api.post("/v1/values/manual", json=A_TYPED_VALUE)
        await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"retrieval_date": "2026-09-10T10:00:00Z"}
        )

        active = (
            await api.get(
                "/v1/values", params={"candidate": "country.portugal", "attribute": NATURALISATION}
            )
        ).json()
        everything = (
            await api.get(
                "/v1/values",
                params={
                    "candidate": "country.portugal",
                    "attribute": NATURALISATION,
                    "include_superseded": True,
                },
            )
        ).json()

        assert [value["is_active"] for value in active["items"]] == [True]
        assert active["total"] == 1
        assert sorted(value["is_active"] for value in everything["items"]) == [False, True]
        assert everything["total"] == 2

    async def test_a_stored_reason_with_an_id_is_served_with_the_name(
        self, api: httpx.AsyncClient, stored_figures: None, database_url: str
    ) -> None:
        """Values are append-only, so a reason stored before reasons were worded is named at
        read time, and a note to developers is taken out (PL-072, N3)."""
        from datetime import UTC, date, datetime

        from psycopg_pool import AsyncConnectionPool

        from starnest.data import ConfidenceLevel, ReferencePeriod, Value, ValueType
        from starnest.storage import PostgresValueStore

        rejected = Value(
            candidate="country.portugal",
            attribute=OVERBURDEN,
            value_type=ValueType.RATIO,
            data_source="eurostat",
            reference_period=ReferencePeriod(start=date(2019, 1, 1), end=date(2019, 12, 31)),
            retrieval_date=datetime.now(UTC),
            confidence_level=ConfidenceLevel.HIGH,
            payload=None,
            rejection_reason=(
                f"96.3 is outside the credible range 0 to 60 declared for {OVERBURDEN} "
                "(known-issues.md P37)"
            ),
        )
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await PostgresValueStore(pool).append([rejected])

        body = (
            await api.get(
                "/v1/values",
                params={
                    "candidate": "country.portugal",
                    "attribute": OVERBURDEN,
                    "include_superseded": True,
                },
            )
        ).json()
        name = (await api.get(f"/v1/attributes/{OVERBURDEN}")).json()["name"]

        (reason,) = [v["rejection_reason"] for v in body["items"] if v["rejection_reason"]]
        assert reason == f"96.3 is outside the credible range 0 to 60 declared for {name}"

    async def test_a_payload_carries_numbers_not_strings(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        body = (await api.get("/v1/values", params={"attribute": OVERBURDEN})).json()

        assert all(isinstance(value["payload"]["value"], int | float) for value in body["items"])


class TestReadingWhatARunReConfirmed:
    """PL-049, UF-073 (Δ5). A run that re-read a transcribed table produced figures no row
    carries its id for, so `data_acquisition_run` alone read them as gone."""

    ONE_PAIR: ClassVar[dict[str, Any]] = {
        "level": COUNTRY,
        "candidates": ["country.portugal"],
        "attributes": [OVERBURDEN],
    }

    async def test_values_reconfirmed_by_a_run_are_the_ones_its_reuse_rows_name(
        self, database_url: str
    ) -> None:
        transcribed = a_stub_source(
            answers=(OVERBURDEN,), silent_about=(), retrieved=datetime(2026, 9, 19, tzinfo=UTC)
        )
        async with an_api(database_url, (transcribed,)) as api:
            first = (await api.post("/v1/data-acquisition-runs", json=self.ONE_PAIR)).json()
            second = (await api.post("/v1/data-acquisition-runs", json=self.ONE_PAIR)).json()
            produced = (
                await api.get(
                    "/v1/values",
                    params={"data_acquisition_run": first["id"], "include_superseded": True},
                )
            ).json()
            reconfirmed = (
                await api.get(
                    "/v1/values",
                    params={"reconfirmed_by_run": second["id"], "include_superseded": True},
                )
            ).json()

        validate("listValues", reconfirmed)
        assert [value["id"] for value in produced["items"]] != [], "the premise: one was stored"
        assert [value["id"] for value in reconfirmed["items"]] == [
            value["id"] for value in produced["items"]
        ]
        assert reconfirmed["total"] == 1

    async def test_asking_by_both_runs_at_once_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.get(
            "/v1/values", params={"data_acquisition_run": 1, "reconfirmed_by_run": 2}
        )

        assert response.status_code == 422
        body = response.json()
        assert body["code"] == "invalid_request"
        assert [
            (problem["location"], problem["kind"]) for problem in body["details"]["errors"]
        ] == [(["query", "reconfirmed_by_run"], "mutually_exclusive")]
        validate_refusal(body)


class TestTypingAValue:
    async def test_it_is_stored_under_the_manual_source_at_medium_confidence(
        self, api: httpx.AsyncClient
    ) -> None:
        """Medium by default: a source tier says nothing useful about a typed value, so the
        default is a deliberately unflattering middle (`reqs.md` 5.7)."""
        response = await api.post("/v1/values/manual", json=A_TYPED_VALUE)

        assert response.status_code == 201
        stored = response.json()
        assert stored["data_source"] == "manual"
        assert stored["confidence_level"] == "medium"
        assert stored["payload"] == {"magnitude": 5, "unit": "years"}
        assert stored["citations"] == A_TYPED_VALUE["citations"]
        assert stored["is_active"] is True

    async def test_resubmitting_the_identical_value_is_idempotent_not_a_crash(
        self, api: httpx.AsyncClient
    ) -> None:
        """A second POST of the same manual value -- same natural key, retrieval_date included --
        returns the already-stored value, not a 500 from the now-idempotent no-op append."""
        first = await api.post("/v1/values/manual", json=A_TYPED_VALUE)
        second = await api.post("/v1/values/manual", json=A_TYPED_VALUE)

        assert first.status_code == 201
        assert second.status_code == 201
        assert second.json()["id"] == first.json()["id"]  # the same row, not a second one

        everything = (
            await api.get(
                "/v1/values",
                params={
                    "candidate": A_TYPED_VALUE["candidate"],
                    "attribute": A_TYPED_VALUE["attribute"],
                    "include_superseded": True,
                },
            )
        ).json()
        assert everything["total"] == 1  # idempotent: no duplicate row

    async def test_a_manual_figure_resubmitted_with_another_value_is_refused_409(
        self, api: httpx.AsyncClient
    ) -> None:
        """NEW-23. The same natural key with another figure used to answer 201 with the *old*
        figure, so the household believed six years was recorded while five stood. A correction
        is a new observation: a new retrieval date, never the same one with another number."""
        first = await api.post("/v1/values/manual", json=A_TYPED_VALUE)
        refused = await api.post(
            "/v1/values/manual",
            json=A_TYPED_VALUE | {"payload": {"magnitude": 6, "unit": "years"}},
        )

        assert first.status_code == 201
        assert refused.status_code == 409
        assert refused.json()["code"] == "conflicting_observation"
        validate("enterValueManually", refused.json(), status=409)
        assert _identity_in(refused.json()["details"]) == _identity_of(first.json())
        stored = (
            await api.get(
                "/v1/values",
                params={"candidate": A_TYPED_VALUE["candidate"], "attribute": NATURALISATION},
            )
        ).json()["items"]
        assert [value["payload"]["magnitude"] for value in stored] == [5]

    async def test_of_two_figures_submitted_at_once_for_one_observation_one_is_refused(
        self, database_url: str
    ) -> None:
        """Both requests read nothing on record, then both append on their own connection: the
        loser's insert is a no-op, and it used to answer 201 showing the winner's figure. Held
        together just before the append, the way the reviewer reproduced it."""
        async with an_api(database_url, (a_stub_source(),), values=_HeldBeforeAppending) as api:
            answers = await asyncio.gather(
                api.post("/v1/values/manual", json=A_TYPED_VALUE),
                api.post(
                    "/v1/values/manual",
                    json=A_TYPED_VALUE | {"payload": {"magnitude": 6, "unit": "years"}},
                ),
            )
            stored = (
                await api.get(
                    "/v1/values",
                    params={"candidate": A_TYPED_VALUE["candidate"], "attribute": NATURALISATION},
                )
            ).json()["items"]

        stored_figure = stored[0]["payload"]["magnitude"]
        by_status = {answer.status_code: answer.json() for answer in answers}
        assert sorted(by_status) == [201, 409]
        assert by_status[201]["payload"]["magnitude"] == stored_figure
        assert by_status[409]["code"] == "conflicting_observation"
        assert _identity_in(by_status[409]["details"]) == _identity_of(stored[0])
        assert len(stored) == 1

    async def test_a_manual_figure_resubmitted_with_new_words_is_still_the_same_one(
        self, api: httpx.AsyncClient
    ) -> None:
        """The control (NEW-33): the quote and the pages do not make another observation."""
        first = await api.post("/v1/values/manual", json=A_TYPED_VALUE)
        again = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"quote": "worded again", "citations": []}
        )

        assert again.status_code == 201
        assert again.json()["id"] == first.json()["id"]

    async def test_an_attribute_that_does_not_declare_manual_entry_refuses_it(
        self, api: httpx.AsyncClient
    ) -> None:
        """The fastest route to a plausible number with no measurement behind it is an open
        field; the attribute has to have said yes (`reqs.md` 6.5)."""
        response = await api.post(
            "/v1/values/manual",
            json=A_TYPED_VALUE
            | {"attribute": OVERBURDEN, "payload": {"value": 5, "basis": "households"}},
        )

        assert response.status_code == 409
        assert response.json()["code"] == "manual_entry_not_permitted"

    async def test_a_value_of_the_wrong_shape_is_refused_and_says_why(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"payload": {"labels": ["five years"]}}
        )

        assert response.status_code == 409
        assert response.json()["code"] == "invalid_value"
        assert "Quantity" in response.json()["message"]

    async def test_a_candidate_that_does_not_exist_is_a_404(self, api: httpx.AsyncClient) -> None:
        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"candidate": "country.atlantis"}
        )

        assert response.status_code == 404

    async def test_an_attribute_that_does_not_exist_is_a_404(self, api: httpx.AsyncClient) -> None:
        response = await api.post(
            "/v1/values/manual", json=A_TYPED_VALUE | {"attribute": "country.happiness"}
        )

        assert response.status_code == 404


ADMIN_EASE = "country.residency_admin_ease"
"""An AssignedScore that declares manual entry, scored `as_is` by the shipped `local_employment`."""

SEVEN_ON_ZERO_TO_TEN = A_TYPED_VALUE | {
    "attribute": ADMIN_EASE,
    "payload": {
        "value": 7,
        "range_min": 0,
        "range_max": 10,
        "assigned_by": "human",
        "rationale": "Permits are applied for online; registration is one office visit",
    },
    "quote": "AIMA: residence permits are requested through the online portal",
}


class TestATypedScoreIsScoredOnItsOwnScale:
    """PL-083 (UF-071), along the whole path a reader takes: the API, storage, and the drill-down.

    The range survived the first two and was dropped at scoring, so a review typed 7 on 0-10 for
    Portugal and read back a score of 7, and Portugal's governance fell for a figure that should
    have raised it.
    """

    async def test_seven_on_zero_to_ten_reads_seventy_in_the_drill_down(
        self, api: httpx.AsyncClient
    ) -> None:
        await api.put("/v1/settings", json={"score_scale_max": 100})
        stored = await api.post("/v1/values/manual", json=SEVEN_ON_ZERO_TO_TEN)
        assert stored.status_code == 201

        detail = await api.get(
            "/v1/rankings/candidates/country.portugal",
            params={"criteria_set": "local_employment", "level": COUNTRY},
        )

        assert detail.status_code == 200
        rows = detail.json()["attribute_scores"]
        (row,) = [row for row in rows if row["attribute"] == ADMIN_EASE]
        assert row["normalised_score"] == 70


class TestTheGates:
    async def test_every_gate_comes_back_and_one_is_asked_at_every_level(
        self, api: httpx.AsyncClient
    ) -> None:
        body = (await api.get("/v1/match-rules", params={"level": "country"})).json()

        levels = {rule["id"]: rule["level"] for rule in body["items"]}
        assert levels["uk_skilled_worker"] == "country"
        assert levels["not_manually_excluded"] is None

    async def test_every_gate_says_what_it_tests_in_words(self, api: httpx.AsyncClient) -> None:
        """PL-155: catalog text from `reqs.md` 7.3's "Matches when" column, never an id."""
        response = await api.get("/v1/match-rules")
        validate("listMatchRules", response.json())

        described = {rule["id"]: rule["description"] for rule in response.json()["items"]}

        assert described["ch_eu_efta_quota"] == (
            "The annual Swiss EU/EFTA permit quota has capacity for this household."
        )
        assert all(described.values()), f"a gate says nothing: {described}"
        assert not any(gate in text for text in described.values() for gate in described)

    async def test_an_answer_is_recorded_and_read_back_with_its_pages(
        self, api: httpx.AsyncClient
    ) -> None:
        answer = {
            "match_result": "matching",
            "reason": "Romanian citizens move freely within the EU",
            "citations": ["https://eur-lex.europa.eu/eli/dir/2004/38/oj"],
        }

        put = await api.put("/v1/match-rule-results/eu_free_movement/country.portugal", json=answer)
        listed = (
            await api.get("/v1/match-rule-results", params={"candidate": "country.portugal"})
        ).json()

        assert put.status_code == 200
        (stored,) = listed["items"]
        assert stored["match_result"] == "matching"
        assert stored["citations"] == answer["citations"]
        assert stored["data_source"] == "manual"
        assert stored["override_date"] is None

    async def test_an_override_is_dated_by_the_server_not_the_client(
        self, api: httpx.AsyncClient
    ) -> None:
        """An audit trail whose dates the audited party supplies is not one (`reqs.md` 3.7)."""
        response = await api.put(
            "/v1/match-rule-results/not_manually_excluded/country.greece",
            json={"match_result": "not_matching", "override_reason": "ruled out by hand: heat"},
        )

        assert response.json()["override_reason"] == "ruled out by hand: heat"
        assert response.json()["override_date"] is not None

    async def test_a_new_answer_replaces_the_old_one_and_its_pages(
        self, api: httpx.AsyncClient
    ) -> None:
        path = "/v1/match-rule-results/uk_skilled_worker/country.united_kingdom"
        await api.put(
            path, json={"match_result": "unknown", "citations": ["https://example.org/old"]}
        )

        await api.put(
            path, json={"match_result": "matching", "citations": ["https://example.org/new"]}
        )

        (answer,) = (
            await api.get("/v1/match-rule-results", params={"match_rule": "uk_skilled_worker"})
        ).json()["items"]
        assert answer["match_result"] == "matching"
        assert answer["citations"] == ["https://example.org/new"]

    @pytest.mark.parametrize(
        ("path", "status"),
        [
            ("/v1/match-rule-results/no_such_gate/country.portugal", 404),
            ("/v1/match-rule-results/eu_free_movement/country.atlantis", 404),
        ],
        ids=["an unknown gate", "an unknown candidate"],
    )
    async def test_naming_what_does_not_exist_is_a_404(
        self, api: httpx.AsyncClient, path: str, status: int
    ) -> None:
        response = await api.put(path, json={"match_result": "matching"})

        assert response.status_code == status

    async def test_a_candidate_at_another_level_is_refused_with_422(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """A country gate is not asked of a city (NEW-64, G-S3), and nothing is stored."""
        async with await psycopg.AsyncConnection.connect(database_url, autocommit=True) as db:
            await db.execute(
                "INSERT INTO candidate (id, name, level, parent_level, parent_candidate,"
                " parent_required) SELECT 'city.portugal.porto', 'Porto', l.id, 'country',"
                " 'country.portugal', l.requires_parent FROM level AS l WHERE l.id = 'city'"
            )
            try:
                response = await api.put(
                    "/v1/match-rule-results/uk_skilled_worker/city.portugal.porto",
                    json={"match_result": "matching"},
                )
                (stored,) = await (
                    await db.execute(
                        "SELECT count(*) FROM match_rule_answer"
                        " WHERE candidate = 'city.portugal.porto'"
                    )
                ).fetchone()
            finally:
                await db.execute("DELETE FROM candidate WHERE id = 'city.portugal.porto'")

        assert (response.status_code, response.json()["code"]) == (
            422,
            "invalid_match_rule_result",
        )
        validate("putMatchRuleResult", response.json(), status=422)
        assert stored == 0
        # PL-150: the sentence names the gate and the place; the ids travel in `details`.
        assert "UK Skilled Worker route" in response.json()["message"]
        assert "Porto" in response.json()["message"]
        assert not AN_IDENTIFIER.search(response.json()["message"])
        assert "uk_skilled_worker" not in response.json()["message"]
        assert response.json()["details"] == {
            "match_rule": "uk_skilled_worker",
            "candidate": "city.portugal.porto",
        }

    async def test_an_unknown_source_is_refused(self, api: httpx.AsyncClient) -> None:
        response = await api.put(
            "/v1/match-rule-results/eu_free_movement/country.portugal",
            json={"match_result": "matching", "data_source": "a_blog"},
        )

        assert response.status_code == 422
        assert response.json()["code"] == "unknown_data_source"


class TestAModelsAnswerNeverReplacesAPersons:
    """NEW-36. A model's answer is a proposal until a person writes it (`reqs.md` 6.10 use 3),
    so the store declines one sent over an answer a person recorded (NEW-02). The endpoint then
    answered 200 with the person's answer -- a success for a write that never happened, and the
    response read like the model's answer had been accepted. It is refused instead, and nothing
    changes; the research pass, which writes no response, still declines silently."""

    PATH: ClassVar[str] = "/v1/match-rule-results/uk_skilled_worker/country.united_kingdom"
    A_PERSONS_ANSWER: ClassVar[dict] = {
        "match_result": "matching",
        "reason": "checked the official page myself",
        "data_source": "manual",
        "citations": ["https://www.gov.uk/skilled-worker-visa"],
    }
    A_MODELS_ANSWER: ClassVar[dict] = {
        "match_result": "not_matching",
        "reason": "the model read a list of eligible occupations",
        "data_source": "llm",
        "citations": ["https://www.gov.uk/government/publications/skilled-worker-visa"],
    }

    async def _the_answer(self, api: httpx.AsyncClient) -> dict:
        (answer,) = (
            await api.get("/v1/match-rule-results", params={"match_rule": "uk_skilled_worker"})
        ).json()["items"]
        return answer

    async def test_a_model_s_answer_over_a_person_s_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        await api.put(self.PATH, json=self.A_PERSONS_ANSWER)

        response = await api.put(self.PATH, json=self.A_MODELS_ANSWER)

        assert response.status_code == 409, f"answered {response.status_code}"
        assert response.json()["code"] == "answer_recorded_by_a_person"
        assert response.json()["message"].startswith(
            "a person has answered UK Skilled Worker route for United Kingdom"
        )
        assert "uk_skilled_worker" not in response.json()["message"]
        assert not AN_IDENTIFIER.search(response.json()["message"])
        assert response.json()["details"] == {
            "match_rule": "uk_skilled_worker",
            "candidate": "country.united_kingdom",
        }
        assert response_schema("putMatchRuleResult", 409) == {"$ref": "#/components/schemas/Error"}
        validate("putMatchRuleResult", response.json(), status=409)

    async def test_the_person_s_answer_stands_with_its_pages(self, api: httpx.AsyncClient) -> None:
        await api.put(self.PATH, json=self.A_PERSONS_ANSWER)
        before = await self._the_answer(api)

        await api.put(self.PATH, json=self.A_MODELS_ANSWER)

        assert await self._the_answer(api) == before

    async def test_a_model_s_answer_over_a_person_s_override_is_refused(
        self, api: httpx.AsyncClient
    ) -> None:
        path = "/v1/match-rule-results/not_manually_excluded/country.greece"
        await api.put(
            path, json={"match_result": "not_matching", "override_reason": "ruled out by hand"}
        )

        response = await api.put(
            path,
            json={"match_result": "matching", "data_source": "llm", "citations": ["https://a"]},
        )

        assert (response.status_code, response.json()["code"]) == (
            409,
            "answer_recorded_by_a_person",
        )

    async def test_a_model_s_answer_where_nobody_answered_is_stored_as_a_proposal(
        self, api: httpx.AsyncClient
    ) -> None:
        response = await api.put(self.PATH, json=self.A_MODELS_ANSWER)

        assert response.status_code == 200
        assert (response.json()["data_source"], response.json()["is_proposal"]) == ("llm", True)

    async def test_a_model_s_answer_replaces_a_proposal(self, api: httpx.AsyncClient) -> None:
        await api.put(self.PATH, json=self.A_MODELS_ANSWER)

        response = await api.put(self.PATH, json=self.A_MODELS_ANSWER | {"match_result": "unknown"})

        assert response.status_code == 200
        assert (await self._the_answer(api))["match_result"] == "unknown"

    async def test_a_person_s_answer_still_replaces_a_proposal(
        self, api: httpx.AsyncClient
    ) -> None:
        """Confirming a proposal is writing it as `manual`, so this is how one is confirmed."""
        await api.put(self.PATH, json=self.A_MODELS_ANSWER)

        response = await api.put(self.PATH, json=self.A_PERSONS_ANSWER)

        assert response.status_code == 200
        assert (await self._the_answer(api))["is_proposal"] is False


class TestTheCompoundRules:
    async def test_both_compound_rules_carry_their_decided_bounds(
        self, api: httpx.AsyncClient
    ) -> None:
        """Both shipped rules have been decided, and their bounds are visible over the wire.

        `cheap_but_taxed` got its numbers on 2026-09-19 (`0474`): cheap is a cost of living at
        or below 80 on an index where EU27 is 100, taxed a total rate at or above 40% of the
        whole cost of employment. `mild_now_brutal_later` was the last TBD (`reqs.md` 7.4),
        decided with the household on 2026-10-09 (`0496`) once projected_summer_heat_days could be
        fetched: a temperate annual mean (10-16 C) projected many hot days (>= 25). Both were
        chosen against real figures, never invented.
        """
        body = (await api.get("/v1/compound-rules", params={"level": "country"})).json()

        rules = {rule["id"]: rule for rule in body["items"]}
        assert set(rules) == {"cheap_but_taxed", "mild_now_brutal_later"}
        assert all(rule["outcome"] == "warning" for rule in rules.values())

        def bounds(rule_id: str) -> dict[str, tuple[object, object]]:
            return {
                condition["attribute"]: (condition["threshold_min"], condition["threshold_max"])
                for condition in rules[rule_id]["conditions"]
            }

        assert bounds("cheap_but_taxed") == {
            "country.cost_of_living_index": (None, 80),
            "country.total_tax_rate_effective": (40, None),
        }
        assert bounds("mild_now_brutal_later") == {
            "country.avg_annual_temperature": (10, 16),
            "country.projected_summer_heat_days": (25, None),
        }

    async def test_each_rule_says_what_it_tests_from_its_conditions(
        self, api: httpx.AsyncClient
    ) -> None:
        """PL-155: names, bands and units, read from the conditions; never an id or a token."""
        response = await api.get("/v1/compound-rules", params={"level": "country"})
        validate("listCompoundRules", response.json())

        described = {rule["id"]: rule["description"] for rule in response.json()["items"]}

        assert described["cheap_but_taxed"].startswith("Flags a candidate when ")
        assert "is at most 80" in described["cheap_but_taxed"]
        assert "is at least 40%" in described["cheap_but_taxed"]
        assert "between 10 and 16 degrees Celsius" in described["mild_now_brutal_later"]
        assert not any(AN_IDENTIFIER.search(text) for text in described.values())
        assert not any("AllConditionsHold" in text for text in described.values())

    async def test_each_rule_names_the_attributes_it_reads(self, api: httpx.AsyncClient) -> None:
        body = (await api.get("/v1/compound-rules")).json()

        cheap = next(rule for rule in body["items"] if rule["id"] == "cheap_but_taxed")
        assert [condition["attribute"] for condition in cheap["conditions"]] == [
            "country.cost_of_living_index",
            "country.total_tax_rate_effective",
        ]

    async def test_an_undecided_rule_warns_nobody_in_a_ranking(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        body = (
            await api.get("/v1/rankings", params={"criteria_set": "minimal", "level": COUNTRY})
        ).json()

        assert all(candidate["warnings"] == [] for candidate in body["candidates"])


class TestExternalScores:
    async def test_they_come_back_from_their_own_endpoint(
        self, api: httpx.AsyncClient, an_external_score: None
    ) -> None:
        """Separate from `/values` deliberately: an external score is not a measurement of an
        attribute, and a client that could confuse the two would eventually score one
        (`reqs.md` 3.5a)."""
        body = (
            await api.get("/v1/external-scores", params={"candidate": "country.portugal"})
        ).json()

        (score,) = body["items"]
        assert score["data_source"] == "numbeo"
        assert score["published_scale"] == "0-100, higher is safer"
        assert score["caveats"]

    async def test_another_candidates_scores_are_not_returned(
        self, api: httpx.AsyncClient, an_external_score: None
    ) -> None:
        body = (await api.get("/v1/external-scores", params={"candidate": "country.greece"})).json()

        assert body["items"] == []


class TestTheWarningTheHouseholdDecided:
    """`cheap_but_taxed`, end to end: figures in, warning out (`0474`).

    **A warning is the third thing a ranking can say.** It changes neither the score nor the
    match status -- Romania keeps both -- and it says the one thing the score cannot: that the
    cost advantage is partly taken back in tax. The cost-of-living criterion already rewards
    being cheap; this is about the pair.
    """

    @staticmethod
    async def figures_for(database_url: str, pairs: dict[str, tuple[str, str]]) -> None:
        """A cost of living and a total tax rate per country, as the rule reads them."""
        from datetime import UTC, date, datetime
        from decimal import Decimal

        from psycopg_pool import AsyncConnectionPool

        from starnest.data import (
            ConfidenceLevel,
            Index,
            Quantity,
            Ratio,
            ReferencePeriod,
            Value,
            ValueType,
        )
        from starnest.storage import PostgresValueStore

        a_year = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))

        def other(candidate: str, attribute: str, payload: object) -> Value:
            return Value(
                candidate=candidate,
                attribute=attribute,
                value_type=payload.value_type,  # type: ignore[attr-defined]
                data_source="eurostat",
                reference_period=a_year,
                retrieval_date=datetime.now(UTC),
                confidence_level=ConfidenceLevel.HIGH,
                payload=payload,  # type: ignore[arg-type]
            )

        written = []
        for candidate, (cost, tax) in pairs.items():
            # **Six criteria block in the shipped set, and a blocked candidate is never
            # judged by a rule** -- the rules judge a candidate that *could* be scored, so
            # "the tax is high here" is never said about a country whose tax nobody has. Four
            # of the six are nothing to do with this warning and are supplied so the fifth and
            # sixth can be.
            written.extend(
                [
                    other(
                        candidate,
                        "country.political_economic_stability",
                        Index(
                            value=Decimal("0.8"),
                            provider="World Bank WGI",
                            scale_min=Decimal("-2.5"),
                            scale_max=Decimal("2.5"),
                        ),
                    ),
                    other(
                        candidate,
                        "country.rule_of_law",
                        Index(
                            value=Decimal("0.7"),
                            provider="World Bank WGI",
                            scale_min=Decimal("-2.5"),
                            scale_max=Decimal("2.5"),
                        ),
                    ),
                    other(
                        candidate,
                        "country.healthcare_system_quality",
                        Index(
                            value=Decimal(78),
                            provider="WHO UHC",
                            scale_min=Decimal(0),
                            scale_max=Decimal(100),
                        ),
                    ),
                    other(
                        candidate,
                        "country.homicide_rate",
                        Quantity(magnitude=Decimal("1.2"), unit="per_100000_population"),
                    ),
                ]
            )
            written.append(
                Value(
                    candidate=candidate,
                    attribute="country.cost_of_living_index",
                    value_type=ValueType.QUANTITY,
                    data_source="eurostat",
                    reference_period=a_year,
                    retrieval_date=datetime.now(UTC),
                    confidence_level=ConfidenceLevel.HIGH,
                    payload=Quantity(magnitude=Decimal(cost), unit="eu27_average_100"),
                )
            )
            written.append(
                Value(
                    candidate=candidate,
                    attribute="country.total_tax_rate_effective",
                    value_type=ValueType.RATIO,
                    data_source="eurostat",
                    reference_period=a_year,
                    retrieval_date=datetime.now(UTC),
                    confidence_level=ConfidenceLevel.HIGH,
                    payload=Ratio(value=Decimal(tax), basis="labour_cost"),
                )
            )
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            async with pool.connection() as connection:
                await connection.execute(
                    "INSERT INTO settings (id, score_scale_max) VALUES (1, 100)"
                    " ON CONFLICT (id) DO UPDATE SET score_scale_max = 100, min_coverage = NULL"
                )
            await PostgresValueStore(pool).append(written)

    async def ranked(self, api: httpx.AsyncClient) -> dict:
        body = (
            await api.get(
                "/v1/rankings", params={"criteria_set": "local_employment", "level": COUNTRY}
            )
        ).json()
        return {candidate["candidate"]: candidate for candidate in body["candidates"]}

    # Their own figures, and the four cases the pair of numbers has to tell apart. **Four
    # countries rather than one, because `percentile` cannot place a single candidate**: a
    # column of one has no standing to report, so the blocking criteria could not be scored
    # and nothing was judged at all.
    THE_ROSTER: ClassVar = {
        "country.romania": ("65.1", "42.8"),  # cheap and taxed
        "country.bulgaria": ("62.5", "33.0"),  # cheaper still, and lightly taxed
        "country.poland": ("73.3", "39.2"),  # cheap, and just under the line
        "country.belgium": ("116.2", "58.6"),  # taxed hardest of anybody, and expensive
    }

    async def test_a_cheap_country_taxed_heavily_is_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Romania's own figures: 65.1 on the index, 42.8% of the cost of employment."""
        await self.figures_for(database_url, self.THE_ROSTER)

        romania = (await self.ranked(api))["country.romania"]

        assert [w["compound_rule"] for w in romania["warnings"]] == ["cheap_but_taxed"]
        # The detail carries the figures that made it fire, so a reader can check the judgement
        # rather than take it (`reqs.md` 3.7a).
        assert "65.1" in romania["warnings"][0]["detail"]
        assert "42.8" in romania["warnings"][0]["detail"]

    async def test_the_warning_reads_in_words_with_units(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """The catalog's names and units, and a band said as a band (PL-067)."""
        await self.figures_for(database_url, self.THE_ROSTER)

        (warning,) = (await self.ranked(api))["country.romania"]["warnings"]

        assert "42.8%, at least" in warning["detail"]
        assert not AN_IDENTIFIER.search(warning["detail"])
        assert "to any" not in warning["detail"]

    async def test_the_warning_names_its_inputs_and_a_saved_one_keeps_them(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """D46: the figures a warning read, each with its source and dates, served live and
        kept by a saved ranking exactly as the live one showed them (PL-144)."""
        await self.figures_for(database_url, self.THE_ROSTER)
        (live,) = (await self.ranked(api))["country.romania"]["warnings"]

        kept = await api.post(
            "/v1/evaluations", json={"criteria_set": "local_employment", "level": COUNTRY}
        )
        assert kept.status_code == 201
        saved = (await api.get(f"/v1/evaluations/{kept.json()['id']}")).json()
        romania = next(c for c in saved["candidates"] if c["candidate"] == "country.romania")

        assert [(i["attribute"], i["data_source"]) for i in live["inputs"]] == [
            ("country.cost_of_living_index", "eurostat"),
            ("country.total_tax_rate_effective", "eurostat"),
        ]
        assert all(i["reference_period"] and i["retrieval_date"] for i in live["inputs"])
        assert romania["warnings"] == [live]

    async def test_a_blocking_criterion_nobody_answered_is_named_not_keyed(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Portugal has no figures here, so the shipped set's blocking criteria refuse it, and
        the sentence names them as the catalog does (PL-067)."""
        await self.figures_for(database_url, self.THE_ROSTER)

        reason = (await self.ranked(api))["country.portugal"]["insufficient_reason"]

        assert reason.startswith("no figure for ")
        assert not AN_IDENTIFIER.search(reason)

    async def test_it_changes_neither_the_score_nor_the_status(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """**A warning flags; it does not rule out** (`reqs.md` 5.4)."""
        await self.figures_for(database_url, self.THE_ROSTER)

        romania = (await self.ranked(api))["country.romania"]

        assert romania["match_status"] == "matching", romania["insufficient_reason"]
        assert romania["score"] is not None
        assert romania["non_match_reasons"] == []

    async def test_cheap_and_lightly_taxed_is_not_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """**Bulgaria is the reason the rule takes two numbers.** It is the cheapest country on
        the roster at 62.5 and taxes at 33%, so the advantage is not taken back -- and a rule
        that warned here would only be saying "cheap", which the criterion already scores."""
        await self.figures_for(database_url, self.THE_ROSTER)

        assert (await self.ranked(api))["country.bulgaria"]["warnings"] == []

    async def test_expensive_and_heavily_taxed_is_not_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Belgium taxes most of anybody at 58.6% and costs 116. Heavy tax alone is not this
        warning: there is no cheapness being taken back."""
        await self.figures_for(database_url, self.THE_ROSTER)

        assert (await self.ranked(api))["country.belgium"]["warnings"] == []

    async def test_a_country_just_under_the_tax_line_is_not_warned(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Poland at 39.2% against a bound of 40. **The boundary is where a threshold either
        means something or does not**, and 0.8 of a percentage point is the whole difference
        between this country and Romania as far as this rule is concerned."""
        await self.figures_for(database_url, self.THE_ROSTER)

        assert (await self.ranked(api))["country.poland"]["warnings"] == []
