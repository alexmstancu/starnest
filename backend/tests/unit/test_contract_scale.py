"""Every response that carries a score carries the scale it is on (PL-062, `C05` M1).

**A score without its scale is a number nobody can draw.** The top of the range is a setting the
user edits, and a saved ranking freezes the value it was computed on. The interface used to
assume 100 because the scale never travelled with the scores, so a pillar of 128 on a scale of
150 was drawn, and printed, as 100.

The rule is checked on both documents: the target, which the interface generates its client
from, and the truth, which is what the server actually sends.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import ClassVar

import pytest
import yaml

from starnest.api.document import served_schema

DESIGN = Path(__file__).resolve().parents[3] / "docs" / "openapi.yaml"

SCORE_PROPERTIES = frozenset(
    {
        "score",
        "normalised_score",
        "parent_score",
        "score_delta",
        "delta_vs_home",
        "contribution",
        "weighted_contribution",
        "worth",
    }
)
"""The names anything measured in score points goes by anywhere in the contract: a score, a
difference between two, or a share of one. `delta` is not among them -- it is in the attribute's
own unit."""

SCALE = "score_scale_max"

ANCHORS = "scale_anchors"
"""An anchor's own `score` is configuration -- the score a figure is GIVEN -- not a result, and
anchors do not rescale when the range changes (P1-42), so a criteria set is not a score-bearing
response. Only that one field is exempt: anything else under an anchor is walked as usual."""

ANCHOR_CONFIGURATION = frozenset({"score"})

SCORE_BEARING_OPERATIONS = frozenset(
    {
        "getRanking",
        "getRankedCandidateDetail",
        "getEvaluation",
        "getCandidateScoreDetail",
        "getComparison",
    }
)
"""Named so a walker that silently finds nothing cannot pass the guard by vacuity."""


def _resolve(document: dict, schema: dict) -> dict:
    while "$ref" in schema:
        node: dict = document
        for part in schema["$ref"].removeprefix("#/").split("/"):
            node = node[part]
        schema = node
    return schema


def _children(schema: dict, exempt: frozenset[str]) -> Iterator[tuple[dict, frozenset[str]]]:
    """Each child, with the property names exempt in it. An exemption carries through the
    combinators and the array that only wrap the object it was meant for, and stops at the
    object's own properties."""
    for combinator in ("allOf", "anyOf", "oneOf"):
        yield from ((child, exempt) for child in schema.get(combinator, ()))
    for name, child in schema.get("properties", {}).items():
        yield child, ANCHOR_CONFIGURATION if name == ANCHORS else frozenset()
    for container in ("items", "additionalProperties"):
        if isinstance(schema.get(container), dict):
            yield schema[container], exempt


def _reaches_a_score(
    document: dict,
    schema: dict,
    exempt: frozenset[str] = frozenset(),
    seen: set[tuple[int, frozenset[str]]] | None = None,
) -> bool:
    seen = set() if seen is None else seen
    schema = _resolve(document, schema)
    if (id(schema), exempt) in seen:
        return False
    seen.add((id(schema), exempt))
    if (SCORE_PROPERTIES - exempt) & schema.get("properties", {}).keys():
        return True
    return any(
        _reaches_a_score(document, child, child_exempt, seen)
        for child, child_exempt in _children(schema, exempt)
    )


def _required_at_root(document: dict, schema: dict) -> set[str]:
    """The root's own `required`, and that of every `allOf` member it is built from."""
    schema = _resolve(document, schema)
    required = set(schema.get("required", ()))
    for member in schema.get("allOf", ()):
        required |= _required_at_root(document, member)
    return required


def _success_schemas(document: dict) -> Iterator[tuple[tuple[str, str], dict]]:
    """Every success response on its own, keyed by operation and status: a 206 that carries the
    scale must not hide a 200 that does not."""
    for item in document["paths"].values():
        for method, operation in item.items():
            if method == "parameters":
                continue
            for status, response in operation.get("responses", {}).items():
                if not str(status).startswith("2"):
                    continue
                content = _resolve(document, response).get("content", {})
                schema = content.get("application/json", {}).get("schema")
                if schema is not None:
                    yield (operation["operationId"], str(status)), schema


def _documents() -> dict[str, dict]:
    return {
        "target": yaml.safe_load(DESIGN.read_text()),
        "served": served_schema(),
    }


@pytest.fixture(params=["target", "served"])
def document(request: pytest.FixtureRequest) -> dict:
    return _documents()[request.param]


def _score_bearing(document: dict) -> dict[tuple[str, str], dict]:
    return {
        response: schema
        for response, schema in _success_schemas(document)
        if _reaches_a_score(document, schema)
    }


def _missing_the_scale(document: dict) -> set[tuple[str, str]]:
    return {
        response
        for response, schema in _score_bearing(document).items()
        if SCALE not in _required_at_root(document, schema)
    }


class TestEveryScoreCarriesItsScale:
    def test_the_operations_that_send_a_score_are_the_ones_named(self, document: dict) -> None:
        """A list of names would go stale silently; the walk finds them, and this says which
        it found, so a new score-bearing operation is a decision rather than an accident."""
        assert {operation for operation, _status in _score_bearing(document)} == (
            SCORE_BEARING_OPERATIONS
        )

    def test_each_requires_the_scale_at_its_root(self, document: dict) -> None:
        assert _missing_the_scale(document) == set()


class TestTheWalk:
    """The guard is only as good as the walk it rests on."""

    DOCUMENT: ClassVar[dict] = {
        "paths": {
            "/scored": {
                "get": {
                    "operationId": "scored",
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/A"}}
                            }
                        },
                        "404": {
                            "content": {
                                "application/json": {"schema": {"$ref": "#/components/schemas/S"}}
                            }
                        },
                    },
                }
            }
        },
        "components": {
            "schemas": {
                "A": {
                    "allOf": [
                        {"$ref": "#/components/schemas/B"},
                        {"type": "object", "required": [SCALE]},
                    ]
                },
                "B": {"properties": {"rows": {"items": {"$ref": "#/components/schemas/S"}}}},
                "S": {
                    "properties": {
                        "normalised_score": {},
                        "loop": {"$ref": "#/components/schemas/S"},
                    }
                },
            }
        },
    }

    def test_a_score_behind_refs_and_arrays_is_found(self) -> None:
        assert set(_score_bearing(self.DOCUMENT)) == {("scored", "200")}

    def test_an_anchor_score_is_configuration_and_not_a_result(self) -> None:
        criteria_set = {"properties": {ANCHORS: {"items": {"properties": {"score": {}}}}}}

        assert not _reaches_a_score({}, criteria_set)

    def test_a_required_scale_in_an_all_of_member_counts(self) -> None:
        (schema,) = _score_bearing(self.DOCUMENT).values()

        assert SCALE in _required_at_root(self.DOCUMENT, schema)


def _answering(responses: dict[str, dict], schemas: dict | None = None) -> dict:
    """A document with one operation, `scored`, answering each status with its schema."""
    return {
        "paths": {
            "/scored": {
                "get": {
                    "operationId": "scored",
                    "responses": {
                        status: {"content": {"application/json": {"schema": schema}}}
                        for status, schema in responses.items()
                    },
                }
            }
        },
        "components": {"schemas": schemas or {}},
    }


class TestTheGuardsBlindSpots:
    """Each of these passed the first guard without a scale (review of e83e3ff)."""

    @pytest.mark.parametrize(
        "score_points",
        [
            "weighted_contribution",
            "worth",
            "contribution",
            "delta_vs_home",
            "score_delta",
            "parent_score",
        ],
    )
    def test_a_field_in_score_points_needs_the_scale(self, score_points: str) -> None:
        document = _answering({"200": {"properties": {score_points: {}}}})

        assert _missing_the_scale(document) == {("scored", "200")}

    def test_a_result_nested_under_an_anchor_needs_the_scale(self) -> None:
        anchor = {"properties": {"score": {}, "result": {"$ref": "#/components/schemas/R"}}}
        document = _answering(
            {"200": {"properties": {ANCHORS: {"items": anchor}}}},
            {"R": {"properties": {"normalised_score": {}}}},
        )

        assert _missing_the_scale(document) == {("scored", "200")}

    def test_only_the_anchors_own_score_is_configuration(self) -> None:
        anchor = {"properties": {"score": {}, "detail": {"properties": {"score": {}}}}}

        assert _reaches_a_score({}, {"properties": {ANCHORS: {"items": anchor}}})

    def test_each_success_response_is_held_on_its_own(self) -> None:
        scored = {"properties": {"score": {}}}
        document = _answering({"200": scored, "206": {**scored, "required": [SCALE]}})

        assert _missing_the_scale(document) == {("scored", "200")}
