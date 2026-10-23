"""Apply or roll back migrations on the database `.env` names.

Run from `backend/`: `uv run python ../tools/migrate.py apply|rollback` (`make migrate`,
`make rollback`). The URL is read with python-dotenv, the parser the backend's settings use for
`.env`, and handed to yoyo in-process, so no shell or make string handling ever touches it
(RF-1). Only the file is read: `.env` wins over a URL exported in the shell, as it did in make.
"""

import sys
from pathlib import Path

from dotenv import dotenv_values
from yoyo.scripts.main import main as yoyo

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = ("apply", "rollback")


def yoyo_arguments(command: str, env_file: Path = ROOT / ".env") -> list[str]:
    if command not in COMMANDS:
        raise SystemExit(f"usage: migrate.py {'|'.join(COMMANDS)}")
    url = dotenv_values(env_file).get("DATABASE_URL")
    if not url:
        raise SystemExit(f"migrate: no DATABASE_URL in {env_file} -- run make env")
    # yoyo names its driver in the scheme; a plain postgresql:// is psycopg2, never installed.
    database = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return [command, "--batch", "--database", database, str(ROOT / "storage" / "migrations")]


if __name__ == "__main__":
    sys.exit(yoyo(yoyo_arguments(sys.argv[1] if len(sys.argv) > 1 else "")))
