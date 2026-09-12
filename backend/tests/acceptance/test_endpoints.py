"""The four endpoints minE2E needs, over HTTP, against the real database.

Not unit tests of the handlers: these go through routing, validation, serialisation and the
error handler, because that is the whole of what a client meets. A response shape that is right
in Python and wrong on the wire is still wrong.

The seeded catalog is what they read -- 32 countries, the `minimal` criteria set of `0121` --
because that is what the application actually ships with, and a fixture invented to be
convenient would prove the endpoints work against data that does not exist.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import httpx
import pytest
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

pytestmark = pytest.mark.acceptance

MINIMAL = "minimal"
COUNTRY = "country"
OVERBURDEN = "country.housing_cost_overburden_rate"
OVERCROWDING = "country.overcrowding_rate"
SATISFACTION = "country.life_satisfaction"

A_YEAR = ReferencePeriod(start=date(2025, 1, 1), end=date(2025, 12, 31))

GOOD, POOR = "better", "worse"
"""Two profiles rather than two numbers.

Which number is better depends on the criterion's goal -- 5% housing overburden is good and 5%
ICT employment is not -- so the figure is chosen per attribute by `_a_figure` from the goal the
catalog declares, and the test says only which of the pair a candidate should be."""


async def _set_the_score_scale(pool: AsyncConnectionPool, scale: int | None) -> None:
    async with pool.connection() as connection:
        await connection.execute(
            "INSERT INTO settings (id, score_scale_max) VALUES (1, %s)"
            " ON CONFLICT (id) DO UPDATE SET score_scale_max = EXCLUDED.score_scale_max",
            (scale,),
        )


def _weight_per_pillar(criteria: list[dict]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for criterion in criteria:
        totals[criterion["pillar"]] = totals.get(criterion["pillar"], 0) + float(
            criterion["weight"]
        )
    return totals


def _a_figure(candidate: str, attribute: str, figure: str) -> Value:
    """One stored figure, for a candidate that should look good or bad on this criterion.

    `figure` is `GOOD` or `POOR` rather than a number, because which number is good depends on
    the criterion's goal: 5% housing overburden is excellent and 5% ICT employment is not. The
    caller says what it wants the candidate to look like and this works out the figure from
    what the catalog declares, so a criterion added by the next P4 stream needs no edit here.
    """
    shape = _CATALOG[attribute]
    strong = figure == GOOD
    wanted = strong if shape.goal == "maximise" else not strong

    if shape.value_type == "Index":
        # Any bounds the figure sits inside are valid; the catalog's own are the WGI scale.
        return _stored(
            candidate,
            attribute,
            ValueType.INDEX,
            Index(
                value=Decimal("1.8" if wanted else "-0.4"),
                provider="World Bank WGI",
                scale_min=Decimal("-2.5"),
                scale_max=Decimal("2.5"),
            ),
            source="world_bank",
        )
    if shape.value_type == "Quantity":
        return _stored(
            candidate,
            attribute,
            ValueType.QUANTITY,
            Quantity(magnitude=Decimal("8.1" if wanted else "6.3"), unit=shape.unit or "units"),
        )
    return _stored(
        candidate,
        attribute,
        ValueType.RATIO,
        Ratio(value=Decimal("90" if wanted else "9"), basis="households"),
    )


class _Shape:
    """What the catalog says an attribute is, and what the criterion wants of it."""

    __slots__ = ("goal", "unit", "value_type")

    def __init__(self, value_type: str, unit: str | None, goal: str) -> None:
        self.value_type = value_type
        self.unit = unit
        self.goal = goal


_CATALOG: dict[str, _Shape] = {}
"""Filled by `_learn_the_catalog`, so the figure helper never restates the catalog."""


async def _learn_the_catalog(api: httpx.AsyncClient, criteria_set: str) -> list[dict]:
    """The criteria of a set, and the shape of every attribute they name.

    Read through the API rather than hardcoded, which is what stopped these tests breaking
    every time a P4 stream added a source. They broke twice that way, each time reporting a
    catalog that had grown rather than a mapper that had failed.
    """
    attributes = (await api.get("/v1/attributes", params={"level": COUNTRY})).json()["items"]
    by_id = {a["id"]: a for a in attributes}
    criteria = (await api.get(f"/v1/criteria-sets/{criteria_set}")).json()["criteria"]
    for criterion in criteria:
        declared = by_id[criterion["attribute"]]
        _CATALOG[criterion["attribute"]] = _Shape(
            declared["value_type"], declared["unit"], criterion["goal"]
        )
    return criteria


def _stored(
    candidate: str,
    attribute: str,
    value_type: ValueType,
    payload: object,
    source: str = "eurostat",
) -> Value:
    return Value(
        candidate=candidate,
        attribute=attribute,
        value_type=value_type,
        data_source=source,
        reference_period=A_YEAR,
        retrieval_date=datetime.now(UTC),
        confidence_level=ConfidenceLevel.HIGH,
        payload=payload,  # type: ignore[arg-type]
    )


class TestGetSettings:
    async def test_the_endpoint_the_healthcheck_calls_answers(self, api: httpx.AsyncClient) -> None:
        """compose.yaml's healthcheck uses a real endpoint rather than a `/health` route
        invented for it, so this failing takes the container down."""
        response = await api.get("/v1/settings")

        assert response.status_code == 200

    async def test_unset_settings_come_back_as_null_rather_than_as_a_default(
        self, api: httpx.AsyncClient
    ) -> None:
        """The shipped state. All four are provisional by design (`reqs.md` 3.10), and a
        default invented here would be a number nobody chose arriving as one they did."""
        body = (await api.get("/v1/settings")).json()

        assert body == {
            "min_coverage": None,
            "score_scale_max": None,
            "comparator_limit": None,
            "run_spend_cap_eur": None,
        }


class TestGetCriteriaSet:
    async def test_the_minimal_set_comes_back_whole(self, api: httpx.AsyncClient) -> None:
        """Whole means nothing was dropped on the way out, which is a property of the set
        rather than a list of its members.

        **This used to name the three attributes the set shipped with**, and broke twice as P4
        added sources -- each time reporting a catalog that had grown, not a mapper that had
        failed. What a dropped criterion actually looks like is a pillar whose weights no
        longer sum to 100, because the criteria within a pillar must (`reqs.md` 3.8), and no
        list of names is needed to see it.
        """
        response = await api.get(f"/v1/criteria-sets/{MINIMAL}", params={"level": COUNTRY})

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == MINIMAL
        assert body["criteria"], "a set with no criteria cannot rank anything"
        for pillar, weight in _weight_per_pillar(body["criteria"]).items():
            assert round(weight) == 100, f"{pillar} does not add up, so a criterion went missing"

    async def test_the_criteria_carry_the_interpretation_that_scores_them(
        self, api: httpx.AsyncClient
    ) -> None:
        body = (await api.get(f"/v1/criteria-sets/{MINIMAL}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["goal"] == "minimise"
        assert overburden["normalisation_method"] == "percentile"

    async def test_the_pillar_weights_come_with_it(self, api: httpx.AsyncClient) -> None:
        """A screen that showed criteria without pillar weights would show a set that cannot
        add up.

        Asserted as the relationship rather than as the list: every pillar a criterion names
        carries a weight, and the weights total 100 across the level. Which pillars those are
        is a fact about the catalog on the day, and changes every time a source lands.
        """
        body = (await api.get(f"/v1/criteria-sets/{MINIMAL}")).json()

        weighted = {w["pillar"] for w in body["pillar_weights"]}
        assert {c["pillar"] for c in body["criteria"]} <= weighted
        assert round(sum(float(w["weight"]) for w in body["pillar_weights"])) == 100

    async def test_a_set_that_does_not_exist_is_a_404_in_the_one_error_shape(
        self, api: httpx.AsyncClient
    ) -> None:
        """A client branches on `code`, never on prose (`arch.md` 7.6)."""
        response = await api.get("/v1/criteria-sets/nobody_made_this")

        assert response.status_code == 404
        assert response.json()["code"] == "not_found"
        assert response.json()["message"]


class TestUpdateCriterion:
    async def test_moving_a_weight_returns_the_rebalanced_pillar(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The whole pillar, because the whole pillar changed. Returning only the criterion
        asked about would leave the screen showing a set that does not sum to 100."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}", json={"weight": 70}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["pillar"] == "housing"
        weights = {c["attribute"]: Decimal(str(c["weight"])) for c in body["criteria"]}
        assert weights == {OVERBURDEN: Decimal(70), OVERCROWDING: Decimal(30)}

    async def test_the_pillar_still_sums_to_one_hundred(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The invariant the rebalance exists to hold, checked on what the wire carried rather
        than on what the domain believed."""
        body = (
            await api.patch(
                f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
                json={"weight": 65},
            )
        ).json()

        assert sum(Decimal(str(c["weight"])) for c in body["criteria"]) == Decimal(100)

    async def test_the_change_is_stored_and_not_merely_reported(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}", json={"weight": 80}
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert Decimal(str(overburden["weight"])) == Decimal(80)

    async def test_a_weight_outside_the_percentage_range_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """FastAPI's own validation, which is the contract's `minimum`/`maximum` enforced."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 140},
        )

        assert response.status_code == 422


class TestEditingHowACriterionJudges:
    """The criterion editor: goal, method, anchors, bands and thresholds (`reqs.md` 3.4).

    **This is the subjective half of the ontology becoming editable.** Every one of these
    fields was designed on `CriterionInput`, declared in the contract, and dropped on the floor
    -- so a client could set a target band and be told it worked (P21). Until now a criterion's
    direction could only be changed by a migration, which made it configuration in name and
    code in practice.

    Each test changes one field group and reads it back through `GET`, because an endpoint that
    reports a change it did not store is the defect this class exists about.
    """

    async def test_the_direction_a_criterion_scores_in_can_be_changed(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The field that decides whether a bigger number is better or worse -- which is to say,
        the field that decides the ranking."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"goal": "maximise"},
        )

        assert response.status_code == 200
        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["goal"] == "maximise"

    async def test_scale_anchors_are_replaced_whole_and_keep_their_labels(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """Anchors are where the tuning actually happens (Q206): 35% to 100 and 55% to 0 is how
        the tax rate got its scale. A label lets a number display as a word without ceasing to
        be a number (`reqs.md` 5.1), so the label has to survive the round trip."""
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={
                "normalisation_method": "fixed",
                "scale_anchors": [
                    {"input_value": 5, "score": 100, "label": "comfortable"},
                    {"input_value": 25, "score": 0, "label": "overburdened"},
                ],
            },
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert [
            (a["input_value"], a["score"], a["label"]) for a in overburden["scale_anchors"]
        ] == [
            (5, 100, "comfortable"),
            (25, 0, "overburdened"),
        ]

    async def test_a_target_band_and_its_zero_points_are_stored_together(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """`target_range` is the third goal: it scores its band and falls linearly to its zero
        points. All four numbers are one decision, which is why they are sent together."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={
                "goal": "target_range",
                "normalisation_method": "fixed",
                "target_range_min": 5,
                "target_range_max": 10,
                "zero_score_below": 0,
                "zero_score_above": 30,
            },
        )

        assert response.status_code == 200
        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["goal"] == "target_range"
        assert (overburden["target_range_min"], overburden["target_range_max"]) == (5, 10)
        assert (overburden["zero_score_below"], overburden["zero_score_above"]) == (0, 30)

    async def test_a_band_with_a_method_that_would_score_something_else_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """**The guard this endpoint makes reachable for the first time** (P20). A band with
        `as_is` used to be *inverted* -- 26 degrees inside an 18-26 band scored 74, not 100 --
        and the combination was unreachable through the API only because this endpoint ignored
        `goal`. Refused in the domain, in two CHECKs and in the scoring itself.
        """
        refused = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={
                "goal": "target_range",
                "normalisation_method": "as_is",
                "target_range_min": 5,
                "target_range_max": 10,
                "zero_score_below": 0,
                "zero_score_above": 30,
            },
        )

        assert refused.status_code == 422
        assert refused.json()["code"] == "invalid_criterion"
        assert "cannot express a band" in refused.json()["message"]

    async def test_a_band_with_no_bounds_is_refused_rather_than_scoring_nothing(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """A goal of `target_range` with no range is not a rule, and the domain says so rather
        than storing something that cannot score."""
        refused = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"goal": "target_range"},
        )

        assert refused.status_code == 422

    async def test_whether_a_missing_figure_blocks_can_be_changed(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """`blocks_if_missing` decides whether one absent figure makes a candidate unscoreable
        rather than merely less covered (`reqs.md` 5.3)."""
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"blocks_if_missing": True},
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["blocks_if_missing"] is True


class TestTheThresholdThatDecidesAMatch:
    """A matching threshold is one of the two mechanisms that make a candidate `not_matching`
    (`reqs.md` 3.0), and the endpoint could neither set one nor show one.

    **It was never served either.** The contract has always described it on `Criterion`, which
    inherits every field of `CriterionInput`; the response never carried it. Nothing noticed
    because it is optional -- so the response stayed valid while the rule was invisible, and an
    editor that cannot read the rule it edits overwrites it on the first save.
    """

    async def test_a_range_threshold_is_stored_and_read_back(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": {"max_value": 12}},
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["matching_threshold"] == {"min_value": None, "max_value": 12}

    async def test_sending_null_clears_it_rather_than_leaving_it_alone(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """**Present, not merely non-null.** An explicit null removes the threshold; leaving the
        field out leaves it alone. Reading null as "unchanged" would make a threshold impossible
        to remove through the API."""
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": {"min_value": 2, "max_value": 12}},
        )

        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": None},
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["matching_threshold"] is None

    async def test_leaving_the_field_out_leaves_the_threshold_alone(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The control for the test above: without it, "null clears" would also pass if every
        request cleared the threshold."""
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": {"max_value": 12}},
        )

        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 60},
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["matching_threshold"] == {"min_value": None, "max_value": 12}

    async def test_a_threshold_shape_the_attribute_cannot_take_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """A label threshold cannot judge a `Ratio`. The domain refuses it, naming the types the
        shape does apply to -- so the answer says what would have been legal."""
        refused = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={
                "matching_threshold": {
                    "labels": [{"label": "tropical", "containment_rule": "must_not_contain"}]
                }
            },
        )

        assert refused.status_code == 422

    async def test_a_threshold_naming_two_shapes_at_once_is_refused(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """Resolving it by precedence would store a threshold meaning something other than what
        was sent, which is the fabricated judgement this application exists to prevent."""
        refused = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": {"max_value": 12, "required_value": True}},
        )

        assert refused.status_code == 422

    async def test_an_empty_threshold_object_is_refused_rather_than_meaning_nothing(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """`{}` is not "no threshold" -- null is. An empty object names no shape at all."""
        refused = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"matching_threshold": {}},
        )

        assert refused.status_code == 422


class TestTheFlagsOnACriterion:
    """`is_scored` and `weight_locked`, which the endpoint declared and dropped on the floor.

    Both were on the request body and neither was applied: excluding a criterion from scoring,
    or locking its weight, answered 200 and changed nothing. An endpoint that reports success
    for a change it did not make is worse than one that refuses the change.
    """

    async def test_excluding_a_criterion_from_scoring_is_stored(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"is_scored": False},
        )

        body = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert overburden["is_scored"] is False

    async def test_excluding_a_criterion_moves_no_weight(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """Its weight is redistributed when the ranking is computed (`reqs.md` 5.3), so moving
        it here would change numbers nobody asked to change."""
        before = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"is_scored": False},
        )

        after = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        assert {c["attribute"]: c["weight"] for c in after["criteria"]} == {
            c["attribute"]: c["weight"] for c in before["criteria"]
        }

    async def test_locking_a_weight_is_stored_and_then_refuses_a_rebalance(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The flag is only worth storing if it does its job: with the one sibling locked, there
        is nowhere for a change to the other to go, and the API says so (409)."""
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERCROWDING}",
            json={"weight_locked": True},
        )

        refused = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 90},
        )

        assert refused.status_code == 409
        assert refused.json()["code"] == "weights_all_locked"

    async def test_a_weight_and_a_flag_in_one_request_both_land(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        body = (
            await api.patch(
                f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
                json={"weight": 60, "is_scored": False},
            )
        ).json()

        overburden = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert Decimal(str(overburden["weight"])) == Decimal(60)
        assert overburden["is_scored"] is False

    async def test_a_field_nobody_designed_is_refused_rather_than_ignored(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """`extra="forbid"` outlives the editor. It was added because every designed field was
        being accepted with a 200 and dropped (P21); those fields are served now, and what it
        still catches is a field the contract never described -- `pillar` belongs to the
        attribute, and no request may move a criterion to another one.
        """
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"pillar": "economics"},
        )

        assert response.status_code == 422

    async def test_an_empty_change_changes_nothing_and_is_not_an_error(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """The contract says only the fields present are changed, and none is present."""
        before = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}", json={}
        )

        after = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()
        assert response.status_code == 200
        assert after["criteria"] == before["criteria"]


class TestGetRanking:
    async def test_a_ranking_of_real_countries_from_stored_figures(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """minE2E's acceptance condition, over HTTP: a ranked table with a score, a coverage
        percentage and a match status, from figures with reference dates."""
        criteria = await _learn_the_catalog(api, MINIMAL)

        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, 100)
            # Every criterion the set actually holds, so coverage is 100% whatever P4 added
            # last. Naming them here meant the assertion below silently became a test of
            # partial coverage each time a source landed.
            await PostgresValueStore(pool).append(
                [
                    _a_figure(candidate, criterion["attribute"], figure)
                    for candidate, figure in (("country.portugal", GOOD), ("country.greece", POOR))
                    for criterion in criteria
                ]
            )

            response = await api.get(
                "/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY}
            )

        assert response.status_code == 200
        body = response.json()
        ranked = {c["candidate"]: c for c in body["candidates"] if c["rank"] is not None}
        assert ranked["country.portugal"]["rank"] == 1
        assert ranked["country.portugal"]["score"] > ranked["country.greece"]["score"]
        assert ranked["country.portugal"]["coverage"] == 100
        assert ranked["country.portugal"]["match_status"] == "matching"

    async def test_countries_with_no_figures_are_returned_as_insufficient_data(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """Never filtered out. The reason a candidate is out is a thing this product exists to
        show (`reqs.md` 5.4), and a ranking that hid them would be a shorter list that looked
        complete."""
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, 100)
            await PostgresValueStore(pool).append(
                [
                    _a_figure("country.portugal", OVERBURDEN, "5"),
                    _a_figure("country.greece", OVERBURDEN, "28"),
                ]
            )

            body = (
                await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
            ).json()

        unscored = [c for c in body["candidates"] if c["score"] is None]
        assert len(unscored) == 30
        assert all(c["match_status"] == "insufficient_data" for c in unscored)
        assert all(c["insufficient_reason"] for c in unscored)

    async def test_every_candidate_appears_exactly_once(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, 100)

            body = (
                await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
            ).json()

        candidates = [c["candidate"] for c in body["candidates"]]
        assert len(candidates) == 32
        assert len(set(candidates)) == 32

    async def test_no_score_scale_is_refused_rather_than_assumed_to_be_one_hundred(
        self, api: httpx.AsyncClient, database_url: str
    ) -> None:
        """`devplan.md` 0.3's stop rule applied to a number.

        `score_scale_max` is nullable and unseeded by design. Substituting 100 would produce a
        whole ranking on a scale nobody chose, and every number in it would look right.
        """
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await _set_the_score_scale(pool, None)

            response = await api.get(
                "/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY}
            )

        assert response.status_code == 409
        assert "score_scale_max" in response.text


class TestTheListsTheInterfaceNeedsBeforeItCanRender:
    """Levels, criteria sets and candidates. Not in `docs/mine2e.md` M3's list of four, and
    the interface cannot draw a screen without them -- the plan under-counted, and building it
    is what found that."""

    async def test_the_levels_come_back_in_nesting_order(self, api: httpx.AsyncClient) -> None:
        """`depth_order` is what tells a caller which level screens first. Nothing here names
        `country` or `city`: levels are ordered records (`reqs.md` 3.1)."""
        body = (await api.get("/v1/levels")).json()

        orders = [level["depth_order"] for level in body["items"]]
        assert orders == sorted(orders)
        assert body["items"][0]["parent_level"] is None

    async def test_the_criteria_sets_come_back_as_headers_only(
        self, api: httpx.AsyncClient
    ) -> None:
        """Reading 41 criteria per set to fill a dropdown would make the most frequently
        rendered element the most expensive one."""
        body = (await api.get("/v1/criteria-sets")).json()

        assert {s["id"] for s in body["items"]} >= {MINIMAL, "local_employment"}
        assert all(set(s) == {"id", "name"} for s in body["items"])

    async def test_the_candidates_at_a_level_come_back_whole(self, api: httpx.AsyncClient) -> None:
        """Bounded by the catalog, so returned whole rather than paginated (`arch.md` 7.6)."""
        body = (await api.get("/v1/candidates", params={"level": COUNTRY})).json()

        assert len(body["items"]) == 32
        assert all(candidate["level"] == COUNTRY for candidate in body["items"])

    async def test_filtering_candidates_by_a_parent_that_has_none_returns_nothing(
        self, api: httpx.AsyncClient
    ) -> None:
        """The filter is applied rather than ignored: silently dropping it would return every
        country to a caller that asked for one country's cities."""
        body = (await api.get("/v1/candidates", params={"parent": "country.portugal"})).json()

        assert body["items"] == []


class TestReadingACriteriaSetAtALevel:
    """`level` narrows the criteria and the pillar weights **together**, never one without the
    other. Weights sum to 100 within a level, so a read that narrowed only the criteria would
    return a set whose pillar weights summed to 200 -- and the domain would refuse to build it,
    which is the right outcome reached the wrong way."""

    async def test_narrowing_to_a_level_narrows_both_halves(self, api: httpx.AsyncClient) -> None:
        whole = (await api.get(f"/v1/criteria-sets/{MINIMAL}")).json()
        country = (await api.get(f"/v1/criteria-sets/{MINIMAL}", params={"level": COUNTRY})).json()

        assert len(country["criteria"]) == len(whole["criteria"])
        assert len(country["pillar_weights"]) == len(whole["pillar_weights"])

    async def test_a_level_the_set_says_nothing_about_comes_back_empty_not_broken(
        self, api: httpx.AsyncClient
    ) -> None:
        """The MVP is the country level (`reqs.md` 1.3), so `minimal` has no city criteria.
        An empty set is the honest answer and must not be an error."""
        response = await api.get(f"/v1/criteria-sets/{MINIMAL}", params={"level": "city"})

        assert response.status_code == 200
        assert response.json()["criteria"] == []


class TestTheWeightsTheRebalanceProduces:
    async def test_the_weight_that_was_asked_for_is_the_weight_that_lands(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        body = (
            await api.patch(
                f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
                json={"weight": 65},
            )
        ).json()

        moved = next(c for c in body["criteria"] if c["attribute"] == OVERBURDEN)
        assert Decimal(str(moved["weight"])) == Decimal(65)

    @pytest.mark.parametrize("weight", [0, 100], ids=["nothing", "everything"])
    async def test_the_ends_of_the_range_are_accepted(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str, weight: int
    ) -> None:
        """A criterion worth nothing is a decision, and one worth everything is a pillar with
        one criterion in it. Both are legal, and a range that excluded them would make the
        boundary a surprise."""
        response = await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": weight},
        )

        assert response.status_code == 200
        assert sum(Decimal(str(c["weight"])) for c in response.json()["criteria"]) == Decimal(100)

    async def test_only_the_pillar_that_moved_comes_back(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        """Rebalancing is within a pillar (`reqs.md` 5.2). Returning the whole set would invite
        a screen to redraw criteria that did not change."""
        body = (
            await api.patch(
                f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
                json={"weight": 60},
            )
        ).json()

        assert body["pillar"] == "housing"
        assert {c["pillar"] for c in body["criteria"]} == {"housing"}

    async def test_the_other_pillars_are_left_alone(
        self, api: httpx.AsyncClient, a_scratch_criteria_set: str
    ) -> None:
        await api.patch(
            f"/v1/criteria-sets/{a_scratch_criteria_set}/criteria/{OVERBURDEN}",
            json={"weight": 60},
        )

        whole = (await api.get(f"/v1/criteria-sets/{a_scratch_criteria_set}")).json()

        satisfaction = next(c for c in whole["criteria"] if c["attribute"] == SATISFACTION)
        assert Decimal(str(satisfaction["weight"])) == Decimal(100)


class TestARankingIsComputedAndNotStored:
    async def test_two_identical_requests_agree(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """Adjusting a weight recalculates from stored values and never re-fetches
        (`reqs.md` 5.6). Two reads of unchanged data must therefore agree exactly."""
        first = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()
        second = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()

        assert [c["score"] for c in first["candidates"]] == [
            c["score"] for c in second["candidates"]
        ]

    async def test_nothing_is_written_by_reading_a_ranking(
        self, api: httpx.AsyncClient, stored_figures: None, database_url: str
    ) -> None:
        """An evaluation is written only when deliberately kept (`reqs.md` Q155). A GET that
        stored one would bury the few that matter under hundreds from an afternoon of tuning."""
        async with AsyncConnectionPool(database_url, min_size=1, open=False) as pool:
            await pool.open(wait=True)
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
            async with pool.connection() as connection:
                kept = await (
                    await connection.execute("SELECT count(*) FROM evaluation")
                ).fetchone()

        assert kept == (0,)

    async def test_the_ranked_come_before_the_unscoreable(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """A response read straight through is already the dashboard's order."""
        body = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()

        ranks = [c["rank"] for c in body["candidates"]]
        first_unranked = next(i for i, rank in enumerate(ranks) if rank is None)
        assert all(rank is None for rank in ranks[first_unranked:])

    async def test_a_score_is_never_present_without_a_matching_status(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """`score` is null exactly when `match_status` is insufficient_data, and never
        otherwise. A zero would be a claim that everything measured badly."""
        body = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()

        for candidate in body["candidates"]:
            unscored = candidate["score"] is None
            assert unscored == (candidate["match_status"] == "insufficient_data")

    async def test_coverage_is_a_percentage_on_every_row(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        body = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()

        assert all(0 <= float(c["coverage"]) <= 100 for c in body["candidates"])

    async def test_an_unscoreable_candidate_says_why(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        """ "Insufficient data" on its own tells a user nothing they can act on."""
        body = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()

        unscored = [c for c in body["candidates"] if c["score"] is None]
        assert unscored
        assert all(c["insufficient_reason"] for c in unscored)


class TestWhatARankingSaysItRestsOn:
    """`reqs.md` 5.7: coverage says how much of the weight is backed by data, and this says what
    that data is worth. Six countries are ranked partly on estimates or a neighbour's figure, and
    without it they would be indistinguishable from the measured."""

    async def test_a_scored_candidate_says_how_its_covered_weight_splits(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        body = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()

        portugal = next(c for c in body["candidates"] if c["candidate"] == "country.portugal")
        assert portugal["coverage_by_confidence"] == {
            "absolute": 0,
            "high": 100,
            "medium": 0,
            "low": 0,
        }

    async def test_a_candidate_with_nothing_covered_has_no_split_rather_than_zeros(
        self, api: httpx.AsyncClient, stored_figures: None
    ) -> None:
        body = (
            await api.get("/v1/rankings", params={"criteria_set": MINIMAL, "level": COUNTRY})
        ).json()

        france = next(c for c in body["candidates"] if c["candidate"] == "country.france")
        assert france["coverage_by_confidence"] is None
