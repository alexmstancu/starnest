"""Migrate the browser suite's copy, or run the suite on it (`make e2e`, P100).

Run from `backend/`: `uv run python ../tools/e2e_copy.py migrate|suite <name> [suite args]`.
Make works out the copy's name and checks it; this script builds the URL that reaches it.

**Make never holds the password.** The user, password and port are read with python-dotenv, the
parser compose and the backend use, so every legal dotenv spelling -- quotes, a `# comment`, a
`$(` -- means what it means to them. A key `.env` leaves out falls back to the environment, as it
does for compose: inside a make recipe that is make's own answer for it. The user and password
are percent-encoded, so an `@`, `%`, `#` or `/` in them cannot move the URL's host or end it.
The URL is handed to yoyo in-process and to npm through the environment: it is on no command
line, and no message here names it.
"""

import os
import re
import socket
import sys
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import quote

from dotenv import dotenv_values
from yoyo.scripts.main import main as yoyo

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = ("migrate", "suite")
USAGE = f"usage: e2e_copy.py {'|'.join(COMMANDS)} <name>_e2e [suite arguments]"
#: PostgreSQL keeps 63 bytes of a name, the limit make's `E2E_FIT` measures too (RA-3).
LONGEST_NAME = 63
COPY_NAME = re.compile(r"[A-Za-z0-9_-]+_e2e")


def copy_url(
    name: str, env_file: Path = ROOT / ".env", environ: Mapping[str, str] = os.environ
) -> str:
    """The copy's URL, with the credentials and port compose would use for the live database."""
    refuse_unless_a_copy(name)
    written = dotenv_values(env_file)

    def setting(key: str) -> str:
        value = written.get(key)
        return environ.get(key, "") if value is None else value

    user = setting("POSTGRES_USER")
    if not user:
        raise SystemExit("e2e: no POSTGRES_USER -- run make env")
    port = setting("DATABASE_PORT") or "5432"
    if not (port.isascii() and port.isdigit() and 1 <= int(port) <= 65535):
        raise SystemExit("e2e: DATABASE_PORT is not a port number from 1 to 65535 -- refusing")
    password = quote(setting("POSTGRES_PASSWORD"), safe="")
    return f"postgresql://{quote(user, safe='')}:{password}@127.0.0.1:{int(port)}/{name}"


def refuse_unless_a_copy(name: str) -> None:
    """The last word before a connection: whatever make handed over, only a copy is reached."""
    if COPY_NAME.fullmatch(name) is None or len(name.encode()) > LONGEST_NAME:
        raise SystemExit(
            f"e2e: {name!r} is not a copy's name -- a plain name ending in _e2e, at most "
            f"{LONGEST_NAME} bytes -- refusing"
        )


def migrate(name: str, env_file: Path = ROOT / ".env") -> int:
    # yoyo names its driver in the scheme; a plain postgresql:// is psycopg2, never installed.
    database = copy_url(name, env_file).replace("postgresql://", "postgresql+psycopg://", 1)
    return yoyo(["apply", "--batch", "--database", database, str(ROOT / "storage" / "migrations")])


def suite_environment(
    name: str, env_file: Path = ROOT / ".env", environ: Mapping[str, str] = os.environ
) -> dict[str, str]:
    """npm's environment: this one, with the copy's URL in place of any it inherited."""
    return {**environ, "E2E_DATABASE_URL": copy_url(name, env_file, environ)}


def refuse_unless_the_ports_are_free(environ: Mapping[str, str] = os.environ) -> None:
    """Refuse when a suite port already answers: a server left there by an earlier run would
    answer Playwright in place of the one this run starts, and the new interface would be tested
    against old code while every test passed."""
    for key in ("E2E_BACKEND_PORT", "E2E_UI_PORT"):
        port = environ.get(key, "")
        if not port.isdigit():
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            # As the servers bind: a port in TIME_WAIT is free, one that listens is not.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", int(port)))
            except OSError:
                raise SystemExit(
                    f"e2e: something already listens on 127.0.0.1:{port} ({key}), probably a "
                    "server left by an earlier run -- stop it "
                    f"(lsof -nP -iTCP:{port} -sTCP:LISTEN) and run again"
                ) from None


def main(arguments: list[str]) -> int:
    if len(arguments) < 2 or arguments[0] not in COMMANDS:
        raise SystemExit(USAGE)
    command, name, *suite_arguments = arguments
    if command == "migrate":
        if suite_arguments:
            raise SystemExit(USAGE)
        return migrate(name)
    refuse_unless_the_ports_are_free()
    environment = suite_environment(name)
    os.chdir(ROOT / "ui")
    # npm takes this process's place, so no Python stands between the terminal and Playwright.
    os.execvpe("npm", ["npm", "run", "e2e", "--", *suite_arguments], environment)
    return 1  # pragma: no cover -- execvpe returns only by raising


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
