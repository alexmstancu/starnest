"""The served contract, written down.

Shared between `scripts/openapi.py`, which writes `docs/openapi.implemented.yaml`, and the test
that checks the committed copy is still fresh. One rule for how the document is rendered, in one
place: if the generator and the freshness check spelled it differently, the check would fail for
formatting and pass for drift, which is precisely backwards.
"""

import yaml

from starnest.api.app import build_app

GENERATED_HEADER = """# GENERATED -- do not edit. Run `make openapi`.
#
# Exactly what the application serves today, written from the routes FastAPI has. The hand-
# written design lives in `openapi.yaml` and is deliberately ahead of this; the difference
# between the two files is the work remaining.
"""


def served_schema() -> dict:
    """The OpenAPI document FastAPI builds from the routes, with no stores behind it.

    Constructing the application needs the seams and never uses them: the schema comes from the
    routes and their models, so nothing connects to anything and this is safe to call from a
    unit test.
    """
    return build_app(
        households=None,  # type: ignore[arg-type]
        criteria_store=None,  # type: ignore[arg-type]
        candidates=None,  # type: ignore[arg-type]
        values=None,  # type: ignore[arg-type]
        catalog_store=None,  # type: ignore[arg-type]
    ).openapi()


def as_yaml(schema: dict) -> str:
    """The document as it is committed: header, then sorted YAML.

    Sorted deliberately. FastAPI builds the schema from dictionaries whose order can shift
    between versions, and an unsorted dump would churn the committed file for reasons that are
    not changes -- which trains a reader to ignore its diffs.
    """
    return GENERATED_HEADER + yaml.safe_dump(schema, sort_keys=True, default_flow_style=False)
