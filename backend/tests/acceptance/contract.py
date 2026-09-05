"""Validating a response against the DESIGN, not against our own models.

`docs/openapi.yaml` is hand-written and deliberately ahead of the code, and the interface
generates its typed client from it. That independence is the whole point: an assertion written
beside the endpoint is a restatement of what its author meant, and fails only when the code
disagrees with the author. A schema written earlier, for a different consumer, fails when the
code disagrees with what was **agreed**.

Two defects this session are the argument. The API grew an `insufficient_reason` field the
contract did not have -- every backend test passed, and the interface's generated client simply
had no such field. And `coverage` went over the wire as the string `"100"` where the contract
says `number` -- correct in Python, wrong on the wire, invisible to anything that did not look
at the bytes.
"""

from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

DESIGN = Path(__file__).resolve().parents[3] / "docs" / "openapi.yaml"

_CONTRACT: dict[str, Any] = yaml.safe_load(DESIGN.read_text())


class ContractViolationError(AssertionError):
    """A response does not match the shape `docs/openapi.yaml` promises for it."""


def response_schema(operation_id: str, status: int = 200) -> dict[str, Any] | None:
    """The JSON schema the design declares for one operation's response.

    Returns `None` where the design declares no body -- a 204, or a response documented without
    a schema. A caller treats that as "nothing to validate" rather than as an empty object,
    because those are different claims.
    """
    for item in _CONTRACT["paths"].values():
        for method, operation in item.items():
            if method == "parameters" or operation.get("operationId") != operation_id:
                continue
            content = operation.get("responses", {}).get(str(status), {}).get("content", {})
            return content.get("application/json", {}).get("schema") or None
    raise LookupError(f"the design declares no operation called {operation_id!r}")


def validate(operation_id: str, body: Any, status: int = 200) -> None:
    """Check a response body against the design, raising with every violation found.

    Every violation rather than the first: a shape that is wrong in three places should be
    reported in three places, so a fix is one pass rather than three.
    """
    schema = response_schema(operation_id, status)
    if schema is None:
        return
    # The design's `$ref`s are document-relative -- `#/components/schemas/Ranking` -- so the
    # fragment is validated with the contract's own components carried alongside it. Registering
    # the whole document under a base URI would work too, and did not: a fragment given an `$id`
    # becomes its own document, and every `#/components/...` then resolves inside the fragment.
    validator = Draft202012Validator({**schema, "components": _CONTRACT["components"]})
    errors = sorted(validator.iter_errors(body), key=lambda error: list(error.path))
    if errors:
        raise ContractViolationError(
            f"{operation_id} does not match docs/openapi.yaml:\n"
            + "\n".join(f"  at {list(error.path) or '<root>'}: {error.message}" for error in errors)
        )


def undeclared_fields(operation_id: str, body: Any, status: int = 200) -> list[str]:
    """Every key in a response that the design never declared, as dotted paths.

    **JSON Schema permits extra properties by default**, so `validate` above passes a response
    carrying a field nobody agreed to -- which is exactly how `insufficient_reason` reached the
    server while the interface's generated client had no such field. Schema validation catches
    the wrong type and the missing key; only this catches the extra one.

    Done by walking rather than by injecting `additionalProperties: false`, because the design
    composes with `allOf` -- `Criterion` is `CriterionInput` plus two fields -- and a subschema
    forbidding extras would reject the very fields its sibling contributes.
    """
    schema = response_schema(operation_id, status)
    return [] if schema is None else sorted(_undeclared(body, schema, path=""))


def _resolved(schema: dict[str, Any]) -> dict[str, Any]:
    """A schema with its `$ref` followed, once."""
    reference = schema.get("$ref")
    if not reference:
        return schema
    node: Any = _CONTRACT
    for segment in reference.removeprefix("#/").split("/"):
        node = node[segment]
    return _resolved(node)


def _declared(schema: dict[str, Any]) -> set[str] | None:
    """The property names an object schema allows, or None where it allows anything.

    `allOf` is unioned, which is what composition means: `Criterion` allows everything
    `CriterionInput` allows plus its own two. A schema with no `properties` and no `allOf`
    describes a free-form object, and returning None says "nothing to check" rather than
    "nothing is allowed".
    """
    schema = _resolved(schema)
    if schema.get("additionalProperties") is True:
        return None
    names: set[str] = set(schema.get("properties", {}))
    for part in schema.get("allOf", []):
        allowed = _declared(part)
        if allowed is None:
            return None
        names |= allowed
    return names or None


def _undeclared(body: Any, schema: dict[str, Any], *, path: str) -> list[str]:
    schema = _resolved(schema)
    if isinstance(body, list):
        items = schema.get("items")
        if not isinstance(items, dict):
            return []
        return [
            found
            for index, entry in enumerate(body)
            for found in _undeclared(entry, items, path=f"{path}[{index}]")
        ]
    if not isinstance(body, dict):
        return []

    allowed = _declared(schema)
    # A `oneOf`/`anyOf` branchpoint has no single set of permitted keys, so strictness is not
    # decidable here and is deliberately not guessed at.
    if allowed is None or schema.get("oneOf") or schema.get("anyOf"):
        return []

    extra = [f"{path}.{key}".lstrip(".") for key in body if key not in allowed]
    properties = {**schema.get("properties", {})}
    for part in schema.get("allOf", []):
        properties.update(_resolved(part).get("properties", {}))
    nested = [
        found
        for key, value in body.items()
        if key in properties
        for found in _undeclared(value, properties[key], path=f"{path}.{key}".lstrip("."))
    ]
    return extra + nested
