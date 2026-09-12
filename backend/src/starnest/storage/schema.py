"""Whether the database is behind the code, asked in one question at boot.

`arch.md` 9.2 step 2. Migrations are plain `.sql` files applied by yoyo, which records what it
has applied -- so "is the schema behind?" is the difference between the files on disk and the
rows in that table.

**Refusing to start is the point.** An application running against a schema missing the column
it was written for does not fail at boot; it fails later, on the first write that needs the
column, as a value nobody can explain. `make migrate` is deliberately never automatic
(`arch.md` 7.4), so the refusal is what connects the two: it names the gap and the command.
"""

from dataclasses import dataclass
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[3].parent / "storage" / "migrations"
"""Where the migrations live: `storage/migrations/`, a top-level peer of `backend/` (`reqs.md`
Q200). Resolved from this file rather than configured, because it is a fact about the repository
rather than a choice an operator makes."""


class SchemaBehindError(RuntimeError):
    """The database is missing migrations the code expects. Names them, and the way to apply."""


@dataclass(frozen=True)
class SchemaState:
    """What is on disk against what has been applied."""

    applied: tuple[str, ...]
    unapplied: tuple[str, ...]

    @property
    def is_behind(self) -> bool:
        return bool(self.unapplied)


def schema_state(database_url: str, migrations: Path = MIGRATIONS) -> SchemaState:
    """Which migrations this database has, and which it is missing.

    Read through yoyo rather than by querying its table directly: the table is yoyo's own shape
    and reading it here would be this module knowing another tool's schema.
    """
    from yoyo import get_backend, read_migrations

    backend = get_backend(_as_yoyo_url(database_url))
    available = read_migrations(str(migrations))
    with backend.lock():
        to_apply = backend.to_apply(available)
        return SchemaState(
            applied=tuple(
                migration.id
                for migration in available
                if migration.id not in {pending.id for pending in to_apply}
            ),
            unapplied=tuple(migration.id for migration in to_apply),
        )


def refuse_if_behind(database_url: str, migrations: Path = MIGRATIONS) -> SchemaState:
    """The startup check. Raises `SchemaBehindError` naming every missing migration."""
    state = schema_state(database_url, migrations)
    if state.is_behind:
        raise SchemaBehindError(
            f"the database is behind the code by {len(state.unapplied)} migration(s): "
            f"{', '.join(state.unapplied)}. Run `make migrate` -- it backs up first -- and start "
            "again. Nothing is applied automatically (arch.md 7.4)."
        )
    return state


def _as_yoyo_url(database_url: str) -> str:
    """yoyo names the psycopg3 driver itself, and not as psycopg does.

    `postgresql://` reaches yoyo's psycopg2 backend, which is not installed; the same URL with
    `postgresql+psycopg://` reaches the one that is. `make migrate` passes the second form, and
    this accepts either so that `DATABASE_URL` can stay the plain one the application connects
    with.
    """
    if database_url.startswith("postgresql+"):
        return database_url
    return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
