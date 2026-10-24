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

SCORE_PROPERTIES = frozenset({"score", "normalised_score", "score_delta", "parent_score"})
"""The names a score goes by anywhere in the contract."""

SCALE = "score_scale_max"

ANCHORS = "scale_anchors"
"""Not walked into. An anchor's `score` is configuration -- the score a figure is GIVEN -- not a
result, and anchors do not rescale when the range changes (P1-42), so a criteria set is not a
score-bearing response."""

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


def _children(schema: dict) -> Iterator[dict]:
    for combinator in ("allOf", "anyOf", "oneOf"):
        yield from schema.get(combinator, ())
    yield from (child for name, child in schema.get("properties", {}).items() if name != ANCHORS)
    if isinstance(schema.get("items"), dict):
        yield schema["items"]
    if isinstance(schema.get("additionalProperties"), dict):
        yield schema["additionalProperties"]


def _reaches_a_score(document: dict, schema: dict, seen: set[int] | None = None) -> bool:
    seen = set() if seen is None else seen
    schema = _resolve(document, schema)
    if id(schema) in seen:
        return False
    seen.add(id(schema))
    if SCORE_PROPERTIES & schema.get("properties", {}).keys():
        return True
    return any(_reaches_a_score(document, child, seen) for child in _children(schema))


def _required_at_root(document: dict, schema: dict) -> set[str]:
    """The root's own `required`, and that of every `allOf` member it is built from."""
    schema = _resolve(document, schema)
    required = set(schema.get("required", ()))
    for member in schema.get("allOf", ()):
        required |= _required_at_root(document, member)
    return required


def _success_schemas(document: dict) -> Iterator[tuple[str, dict]]:
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
                    yield operation["operationId"], schema


def _documents() -> dict[str, dict]:
    return {
        "target": yaml.safe_load(DESIGN.read_text()),
        "served": served_schema(),
    }


@pytest.fixture(params=["target", "served"])
def document(request: pytest.FixtureRequest) -> dict:
    return _documents()[request.param]


def _score_bearing(document: dict) -> dict[str, dict]:
    return {
        operation: schema
        for operation, schema in _success_schemas(document)
        if _reaches_a_score(document, schema)
    }


class TestEveryScoreCarriesItsScale:
    def test_the_operations_that_send_a_score_are_the_ones_named(self, document: dict) -> None:
        """A list of names would go stale silently; the walk finds them, and this says which
        it found, so a new score-bearing operation is a decision rather than an accident."""
        assert set(_score_bearing(document)) == SCORE_BEARING_OPERATIONS

    def test_each_requires_the_scale_at_its_root(self, document: dict) -> None:
        missing = {
            operation
            for operation, schema in _score_bearing(document).items()
            if SCALE not in _required_at_root(document, schema)
        }

        assert missing == set()


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
        assert set(_score_bearing(self.DOCUMENT)) == {"scored"}

    def test_an_anchor_score_is_configuration_and_not_a_result(self) -> None:
        criteria_set = {"properties": {ANCHORS: {"items": {"properties": {"score": {}}}}}}

        assert not _reaches_a_score({}, criteria_set)

    def test_a_required_scale_in_an_all_of_member_counts(self) -> None:
        (schema,) = _score_bearing(self.DOCUMENT).values()

        assert SCALE in _required_at_root(self.DOCUMENT, schema)
