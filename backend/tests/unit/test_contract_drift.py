"""What the application serves, against what `docs/openapi.yaml` designs.

`CLAUDE.md`: the contract was hand-written as the design and FastAPI now generates it, so
something has to hold the two together. This is that something -- and it exists because a
refactor that renamed an operation or moved a path would otherwise break every client silently,
including the interface, which generates its typed client from the designed file.

**It checks the operations that exist, not all forty.** Asserting the unimplemented ones would
be a test that fails for being early rather than for being wrong; the guard is that what IS
implemented has not drifted from what was designed.
"""

from pathlib import Path

import pytest
import yaml

from starnest.api import build_app

DESIGNED = Path(__file__).resolve().parents[3] / "docs" / "openapi.yaml"

IMPLEMENTED = {
    "getSettings": ("get", "/settings"),
    "listLevels": ("get", "/levels"),
    "listCriteriaSets": ("get", "/criteria-sets"),
    "listCandidates": ("get", "/candidates"),
    "getCriteriaSet": ("get", "/criteria-sets/{criteriaSetId}"),
    "updateCriterion": ("patch", "/criteria-sets/{criteriaSetId}/criteria/{attributeId}"),
    "getRanking": ("get", "/rankings"),
}
"""Everything served today, by the operation id the design gives it.

Seven rather than the four `docs/mine2e.md` M3 names: the interface cannot render a screen
without the levels for its toggle, the criteria sets for its switcher and the candidates behind
its counts. The plan under-counted, which building it is what found.
"""


@pytest.fixture(scope="module")
def served() -> dict:
    """What FastAPI generates from the code, with no store behind it.

    The schema is built from the routes and their models, so nothing has to connect.
    """
    return build_app(
        households=None,  # type: ignore[arg-type]
        criteria_store=None,  # type: ignore[arg-type]
        candidates=None,  # type: ignore[arg-type]
        values=None,  # type: ignore[arg-type]
        catalog_store=None,  # type: ignore[arg-type]
    ).openapi()


@pytest.fixture(scope="module")
def designed() -> dict:
    return yaml.safe_load(DESIGNED.read_text())


def _operations(document: dict, *, prefix: str = "") -> dict[str, tuple[str, str]]:
    found = {}
    for path, item in document["paths"].items():
        for method, operation in item.items():
            if method == "parameters":
                continue
            identifier = operation.get("operationId")
            if identifier:
                found[identifier] = (method, path.removeprefix(prefix))
    return found


@pytest.mark.parametrize("operation", sorted(IMPLEMENTED))
def test_every_implemented_operation_keeps_its_designed_id(
    served: dict, designed: dict, operation: str
) -> None:
    """The id is what a generated client names its method, so a rename is a breaking change."""
    assert operation in _operations(designed), "the design no longer contains this operation"
    assert operation in _operations(served), "the application no longer serves this operation"


@pytest.mark.parametrize("operation", sorted(IMPLEMENTED))
def test_every_implemented_operation_keeps_its_designed_method_and_path(
    served: dict, designed: dict, operation: str
) -> None:
    """Paths are compared with the `/v1` prefix removed.

    The design writes paths without it and the application serves them under it (`arch.md`
    7.6), so the prefix is the one difference that is deliberate. Any other is drift.
    """
    served_method, served_path = _operations(served, prefix="/v1")[operation]
    designed_method, designed_path = _operations(designed)[operation]

    assert served_method == designed_method
    assert _shape_of(served_path) == _shape_of(designed_path)


def _shape_of(path: str) -> str:
    """A path with its parameter names replaced, so only the structure is compared.

    The design writes `{criteriaSetId}` and the application writes `{criteria_set_id}`, because
    one is a contract's spelling and the other is Python's. What must not differ is how many
    parameters there are and where they sit -- a client builds the URL from the design, and a
    segment that moved would send it to the wrong route.
    """
    segments = path.strip("/").split("/")
    return "/".join("{}" if segment.startswith("{") else segment for segment in segments)


def test_nothing_is_served_that_the_design_never_described(served: dict, designed: dict) -> None:
    """An endpoint invented in code is an endpoint no client knows about and no reviewer saw.

    The healthcheck is the case that makes this worth stating: `compose.yaml` calls a real
    endpoint rather than a `/health` route added for it, precisely so that adding a path stays a
    change to a document with other consumers.
    """
    invented = set(_operations(served, prefix="/v1")) - set(_operations(designed))

    assert invented == set()
