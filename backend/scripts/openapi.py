"""Write `docs/openapi.implemented.yaml`: exactly what the application serves today.

Two contracts, with different jobs.

**`docs/openapi.yaml` is the target.** Hand-written, 40 operations, deliberately ahead of the
code -- it is the design, and the interface generates its typed client from it. Nothing
regenerates it, and nothing should: doing so would delete every operation not yet built, which
is most of the plan.

**This writes the truth.** Generated from the routes FastAPI actually has, so the gap between
the two is visible and countable rather than remembered. It is committed, which is what lets a
test notice when the code moved and nobody regenerated.

    make openapi

`test_contract_drift.py` fails when it is stale, so forgetting is caught here rather than later
by a client.
"""

from pathlib import Path

from starnest.api.document import as_yaml, served_schema

IMPLEMENTED = Path(__file__).resolve().parents[2] / "docs" / "openapi.implemented.yaml"


def main() -> int:
    schema = served_schema()
    IMPLEMENTED.write_text(as_yaml(schema))
    print(f"wrote docs/{IMPLEMENTED.name}: {len(schema['paths'])} paths")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
