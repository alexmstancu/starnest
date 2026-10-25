"""Every rollback down to the first replacement completes on a database that holds nothing.

The refusals written into rollbacks (P95, TL-N2, TL-N5) fire on what a person recorded. On an
empty database there is nothing recorded, so each must stand aside: a refusal that fired here
would wall off every rollback below it. Rolled back by yoyo itself, from the head down to
`0441`, each at its own revision, and applied again.
"""

import psycopg
import pytest

from .private_database import private_database, yoyo

pytestmark = pytest.mark.storage

LOWEST = "0441-health-joins-the-minimal-set"


def newest_applied(url: str) -> str:
    with psycopg.connect(url) as connection:
        row = connection.execute("SELECT max(migration_id) FROM _yoyo_migration").fetchone()
        assert row is not None
        return row[0]


def test_every_rollback_since_0441_completes_on_an_empty_database_and_applies_again(
    database_url: str,
) -> None:
    with private_database(database_url, "chain") as url:
        head = newest_applied(url)

        yoyo("rollback", "--revision", LOWEST, database=url)
        assert newest_applied(url) < LOWEST

        yoyo("apply", database=url)
        assert newest_applied(url) == head
