"""Apply or roll back migrations on the database `.env` names.

Run from `backend/`: `uv run python ../tools/migrate.py apply|rollback` (`make migrate`,
`make rollback`). The URL is read with python-dotenv, the parser the backend's settings use for
`.env`, and handed to yoyo in-process, so no shell or make string handling ever touches it
(RF-1). Only the file is read: `.env` wins over a URL exported in the shell, as it did in make.

**A refusal reads as one, never as a traceback** (P95). A migration's own `RAISE EXCEPTION` is
printed as written. A refusal by the database itself -- a foreign key a rollback's delete still
meets -- names the table, the constraint and the remedy, in the database's own words, so it
cannot go out of date. Either way yoyo has undone the transaction: nothing was changed.
"""

import sys
from collections.abc import Callable
from pathlib import Path

from dotenv import dotenv_values
from psycopg import errors
from yoyo.scripts.main import main as yoyo

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "storage" / "migrations"
COMMANDS = ("apply", "rollback")

NOTHING_CHANGED = "Nothing was changed: the migration's transaction was undone."
REMEDY = (
    "Remove the rows that still refer to it and run this again, or restore the backup make "
    "migrate took before that migration was applied (backups/, named by the time it was taken)."
)


def yoyo_arguments(
    command: str, env_file: Path = ROOT / ".env", migrations: Path = MIGRATIONS
) -> list[str]:
    if command not in COMMANDS:
        raise SystemExit(f"usage: migrate.py {'|'.join(COMMANDS)}")
    url = dotenv_values(env_file).get("DATABASE_URL")
    if not url:
        raise SystemExit(f"migrate: no DATABASE_URL in {env_file} -- run make env")
    # yoyo names its driver in the scheme; a plain postgresql:// is psycopg2, never installed.
    database = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return [command, "--batch", "--database", database, str(migrations)]


def run(
    command: str,
    env_file: Path = ROOT / ".env",
    migrations: Path = MIGRATIONS,
    say: Callable[[str], None] = print,
) -> int:
    try:
        return yoyo(yoyo_arguments(command, env_file, migrations)) or 0
    except errors.RaiseException as refusal:
        say(f"migrate: {refusal.diag.message_primary}")
        say(NOTHING_CHANGED)
        return 1
    except errors.IntegrityError as refused:
        diagnosis = refused.diag
        say(f"migrate: the database refused: {diagnosis.message_primary}")
        say(f"  table: {diagnosis.table_name}, constraint: {diagnosis.constraint_name}")
        if diagnosis.message_detail:
            say(f"  {diagnosis.message_detail}")
        say(NOTHING_CHANGED)
        say(REMEDY)
        return 1


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else ""))
