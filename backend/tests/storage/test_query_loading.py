"""Where the SQL is found, and that it is found once.

The path is the fragile part. `storage/queries/` sits **outside** the Python package
deliberately (`reqs.md` Q200) and is therefore resolved by walking up from a source file, which
is exactly the kind of expression that keeps working right up until a file moves. The container
mirrors the repository so that one expression serves both (`backend/Dockerfile`), and the
assertion below is on that mirroring rather than on any absolute path.
"""

import pytest

from starnest.storage import QUERY_DIRECTORY, load_queries

QUERIES_THE_TWO_SEAMS_NEED = (
    "select_levels",
    "select_pillars",
    "select_attributes",
    "select_data_sources",
    "select_breakdown_schemes",
    "select_active_values",
    "select_values",
    "count_values",
    "select_value_payloads",
    "insert_value",
    "insert_rejected_value",
    "select_external_scores",
    "insert_external_score",
    "select_household",
    "upsert_household",
    "replace_household_citizenships",
    "select_settings",
    "upsert_settings",
)


def test_the_sql_sits_beside_the_backend_rather_than_inside_it() -> None:
    """`storage/` and `backend/` are siblings in the repository and in the image alike."""
    assert QUERY_DIRECTORY.is_dir()
    assert QUERY_DIRECTORY.parent.name == "storage"
    assert (QUERY_DIRECTORY.parent.parent / "backend").is_dir()


def test_the_queries_are_parsed_once_per_process() -> None:
    """Every store asks for them at construction, and one copy is enough."""
    assert load_queries() is load_queries()


@pytest.mark.parametrize("name", QUERIES_THE_TWO_SEAMS_NEED)
def test_the_query_each_seam_calls_by_name_exists(name: str) -> None:
    """A missing block is an `AttributeError` at the first call, which may be months away.

    `test_query_schema_conformance.py` proves every query matches the schema; this proves the
    particular ones these stores name are present at all, which is the other half of the same
    worry.
    """
    assert hasattr(load_queries(), name)
