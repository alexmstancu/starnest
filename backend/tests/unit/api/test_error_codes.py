"""Every code the server can send is in the contract, and the contract lists no other (PL-003).

A client branches on `code` and words each one itself (`arch.md` 7.6), so the codes are part of
the contract: `ErrorCode` in `docs/openapi.yaml`, from which the interface generates its union.
A code the server sends and the list lacks is one no client can word, so it falls back to prose
it does not control; a code the list names and nothing sends is a sentence written for nothing.

**Read from the code, never kept by hand.** The domain's refusals are the rows of `STATUS_FOR`;
the ones an endpoint raises itself are written beside it, and are found by walking the syntax of
every module in `api/`. A list kept here would drift exactly as the contract did.
"""

import ast
from collections.abc import Iterator
from pathlib import Path

import yaml

import starnest.api
from starnest.api.document import served_schema
from starnest.api.errors import STATUS_FOR, ErrorBody

DESIGN = Path(__file__).resolve().parents[4] / "docs" / "openapi.yaml"
API_MODULES = sorted(Path(starnest.api.__file__).parent.glob("*.py"))
ADD_IT = "add each one to ErrorCode, in docs/openapi.yaml and in api/errors.py"


def _listed() -> set[str]:
    """The codes the design lists."""
    return set(yaml.safe_load(DESIGN.read_text())["components"]["schemas"]["ErrorCode"]["enum"])


def _sendable() -> set[str]:
    """Every code the server can send: the domain's refusals, and those written in `api/`."""
    from_the_domain = {code for _, code in STATUS_FOR.values()}
    written, _ = _written_in_the_api()
    return from_the_domain | written


def _written_in_the_api() -> tuple[set[str], list[str]]:
    """The codes written in `api/`, and every place a code is given in a form nothing reads."""
    codes: set[str] = set()
    unreadable: list[str] = []
    for module in API_MODULES:
        for given, typed in _codes_given(ast.parse(module.read_text())):
            if isinstance(given, ast.Constant) and isinstance(given.value, str):
                codes.add(given.value)
            elif not typed:
                unreadable.append(f"api/{module.name}:{given.lineno}")
    return codes, unreadable


def _codes_given(tree: ast.AST) -> Iterator[tuple[ast.expr, bool]]:
    """Every expression given as an error's code, and whether `ErrorBody`'s type checks it.

    A code is a `"code"` key or a `code=` argument. A refusal an endpoint raises is a plain dict
    handed to `HTTPException`, which nothing types, so only a literal there can be read. A
    variable given to `ErrorBody` is checked against `ErrorCode` as the body is built -- and the
    one renderer that gives it one reads it from `STATUS_FOR`.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values, strict=True):
                if isinstance(key, ast.Constant) and key.value == "code":
                    yield value, False
        elif isinstance(node, ast.Call):
            typed = isinstance(node.func, ast.Name) and node.func.id == ErrorBody.__name__
            yield from (
                (keyword.value, typed) for keyword in node.keywords if keyword.arg == "code"
            )


class TestTheContractListsEveryCode:
    def test_every_code_the_server_can_send_is_listed(self) -> None:
        unlisted = sorted(_sendable() - _listed())

        assert unlisted == [], (
            f"the server can send codes the contract never lists: {unlisted}; {ADD_IT}"
        )

    def test_every_listed_code_is_one_the_server_can_send(self) -> None:
        """The reverse: the interface would word a refusal that never comes."""
        never_sent = sorted(_listed() - _sendable())

        assert never_sent == [], f"the contract lists codes nothing sends: {never_sent}"

    def test_every_code_written_in_the_api_can_be_read(self) -> None:
        """A code built at run time would pass both tests above without either reading it."""
        _, unreadable = _written_in_the_api()

        assert unreadable == [], f"write these codes as string literals: {unreadable}"


class TestTheServedErrorIsTypedByTheSameList:
    def test_the_generated_contract_types_the_code_by_it(self) -> None:
        """`ErrorBody.code` is `ErrorCode`, so `openapi.implemented.yaml` carries the list too."""
        schemas = served_schema()["components"]["schemas"]

        assert (
            schemas["ErrorBody"]["properties"]["code"]["$ref"] == "#/components/schemas/ErrorCode"
        )
        assert set(schemas["ErrorCode"]["enum"]) == _listed()
