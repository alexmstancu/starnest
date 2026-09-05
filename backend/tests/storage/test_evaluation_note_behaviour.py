"""Why an evaluation was kept, and what counts as not having said.

`openapi.yaml` has accepted a `note` on `POST /evaluations` and returned one on
`EvaluationSummary` since the contract was written, while the schema had nowhere to put it --
so a note round-tripped through the API and vanished (known-issues D4). Migration 0110 gives it
a column, the same way 0013 did for band labels when the contract promised storage the database
could not provide.

The field earns its place rather than merely being owed one. `reqs.md` Q155 makes an evaluation
something written **only when deliberately kept**, so "why did I keep this one" is the obvious
question about it, and the alternative is a list of near-identical timestamps.
"""

import psycopg
import pytest
from psycopg import errors

from .evaluation_rows import record_an_evaluation

pytestmark = pytest.mark.storage


def _note_of(connection: psycopg.Connection, evaluation: int) -> str | None:
    row = connection.execute("SELECT note FROM evaluation WHERE id = %s", (evaluation,)).fetchone()
    assert row is not None
    return row[0]


def test_a_note_is_stored_with_the_evaluation(connection: psycopg.Connection) -> None:
    """The whole point: what the contract accepts, the schema now keeps."""
    evaluation = record_an_evaluation(connection, note="before the tax change")

    assert _note_of(connection, evaluation) == "before the tax change"


def test_keeping_an_evaluation_without_saying_why_is_allowed(
    connection: psycopg.Connection,
) -> None:
    """The common case, and why the column is nullable rather than NOT NULL."""
    evaluation = record_an_evaluation(connection)

    assert _note_of(connection, evaluation) is None


@pytest.mark.parametrize("blank", ["", "   ", "\t\n"], ids=["empty", "spaces", "whitespace"])
def test_a_blank_note_is_refused(connection: psycopg.Connection, blank: str) -> None:
    """An empty string is not "no note" -- it is a note that displays as nothing.

    The same distinction `ScaleAnchor` draws for band labels: absence is `NULL`, and conflating
    the two puts a blank where a sentence should have been.
    """
    with pytest.raises(errors.CheckViolation):
        record_an_evaluation(connection, note=blank)
