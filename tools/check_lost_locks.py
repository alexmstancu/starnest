"""Read-only: did a replacement drop a weight lock or an exclusion on this database? (P97)

Run from `backend/`: `uv run python ../tools/check_lost_locks.py`.

`0442`, `0444`, `0445` and `0488` moved criteria onto a successor (or a new type) and, before
P97 was fixed, carried the weight but not `weight_locked`, and wrote `is_scored` as `true`. No
migration can repair a database they already ran on: the old rows are gone. What is left is the
dump `make migrate` took just before each one, so this compares, set by set, what each old
criterion held in that dump with what its successor holds now.

**It writes nothing.** The database is read in a read-only transaction, for when each migration
last ran and what the criteria hold now; a dump is read by `pg_restore -f -` in the backup
container, which prints its rows and restores nothing. Whether you still want a lock it reports
is yours to decide, in Configure.

Exit 0 when nothing was lost, 1 when something was, 2 when it cannot check.
"""

import re
import subprocess
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: The backup service names each dump by the moment it was taken, in the container's UTC.
DUMP_NAME = re.compile(r"(\d{8}-\d{6})\.dump")


@dataclass(frozen=True)
class Replacement:
    migration: str
    retiring: str
    successor: str


#: The successor is what the criterion is called now: `0488` replaced what `0444` retyped.
REPLACEMENTS = (
    Replacement(
        "0442-crime-splits-into-a-rate-and-a-composite",
        "country.crime_safety_index",
        "country.homicide_rate",
    ),
    Replacement(
        "0444-house-price-ratio-stops-blocking",
        "country.house_price_to_income_ratio",
        "country.housing_price_level",
    ),
    Replacement(
        "0445-total-tax-rate-replaces-income-tax",
        "country.income_tax_effective",
        "country.total_tax_rate_effective",
    ),
    Replacement(
        "0488-housing-is-priced-by-what-it-costs-to-live-in",
        "country.house_price_to_income_ratio",
        "country.housing_price_level",
    ),
)


@dataclass(frozen=True)
class Chosen:
    """What a person sets on a criterion beside its weight."""

    weight_locked: bool
    is_scored: bool


#: (criteria set, attribute) -> what is chosen on that criterion.
Criteria = dict[tuple[str, str], Chosen]


def dump_time(dump: Path) -> datetime | None:
    named = DUMP_NAME.fullmatch(dump.name)
    if named is None:
        return None
    return datetime.strptime(named.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=UTC)


def newest_dump_before(dumps: Iterable[Path], moment: datetime) -> Path | None:
    dated = [(taken, dump) for dump in dumps if (taken := dump_time(dump)) and taken < moment]
    return max(dated)[1] if dated else None


def criteria_in(copy_text: str) -> Criteria:
    """The criterion rows in pg_restore's plain output: one `COPY ... FROM stdin;` block."""
    lines = iter(copy_text.splitlines())
    for line in lines:
        header = re.match(r"COPY (?:\w+\.)?criterion \(([^)]*)\) FROM stdin;", line)
        if header:
            break
    else:
        raise ValueError("the dump holds no criterion rows")
    columns = [column.strip().strip('"') for column in header.group(1).split(",")]
    criteria: Criteria = {}
    for line in lines:
        if line == "\\.":
            return criteria
        row = dict(zip(columns, line.split("\t"), strict=True))
        criteria[row["criteria_set"], row["attribute"]] = Chosen(
            weight_locked=row["weight_locked"] == "t", is_scored=row["is_scored"] == "t"
        )
    raise ValueError("the dump's criterion rows end without their terminator")


def what_was_lost(replacement: Replacement, before: Criteria, now: Criteria) -> list[str]:
    lost = []
    for (criteria_set, attribute), chosen in sorted(before.items()):
        if attribute != replacement.retiring:
            continue
        current = now.get((criteria_set, replacement.successor))
        if current is None:
            continue
        where = f"{replacement.migration[:4]}: {criteria_set}, {replacement.successor}"
        if chosen.weight_locked and not current.weight_locked:
            lost.append(f"{where} -- was locked before, is unlocked now")
        if not chosen.is_scored and current.is_scored:
            lost.append(f"{where} -- was excluded from scoring before, is scored now")
    return lost


@dataclass(frozen=True)
class Live:
    #: When each migration was last applied.
    applied: dict[str, datetime]
    criteria: Criteria


def read_live(url: str) -> Live:
    import psycopg

    migrations = [replacement.migration for replacement in REPLACEMENTS]
    with psycopg.connect(url, options="-c default_transaction_read_only=on") as connection:
        applied = connection.execute(
            "SELECT migration_id, max(created_at_utc) FROM _yoyo_log "
            "WHERE operation = 'apply' AND migration_id = ANY(%s) GROUP BY migration_id",
            (migrations,),
        ).fetchall()
        criteria = connection.execute(
            "SELECT criteria_set, attribute, weight_locked, is_scored FROM criterion"
        ).fetchall()
    return Live(
        applied={migration: at.replace(tzinfo=UTC) for migration, at in applied},
        criteria={(row[0], row[1]): Chosen(row[2], row[3]) for row in criteria},
    )


def restore_criteria(dump: Path) -> str:
    """The dump's criterion rows as text, by the backup container's pg_restore: no database."""
    done = subprocess.run(
        [
            "docker",
            "compose",
            "--profile",
            "tools",
            "run",
            "--rm",
            "-T",
            "--no-deps",
            "--entrypoint",
            "sh",
            "backup",
            "-c",
            f"pg_restore --data-only --table=criterion -f - /backups/{dump.name}",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return done.stdout


def check(
    live: Live, dumps: list[Path], read_dump: Callable[[Path], str], say: Callable[[str], None]
) -> int:
    lost: list[str] = []
    unchecked = 0
    for replacement in REPLACEMENTS:
        applied = live.applied.get(replacement.migration)
        if applied is None:
            say(f"{replacement.migration}: never applied here, nothing to check")
            continue
        dump = newest_dump_before(dumps, applied)
        if dump is None:
            say(f"{replacement.migration}: no dump older than {applied:%Y-%m-%d %H:%M} UTC")
            unchecked += 1
            continue
        say(f"{replacement.migration}: applied {applied:%Y-%m-%d %H:%M} UTC, read {dump.name}")
        lost += what_was_lost(replacement, criteria_in(read_dump(dump)), live.criteria)
    for line in lost:
        say(f"  LOST {line}")
    if lost:
        say("Lock each again in Configure if you still want it; this changed nothing.")
        return 1
    return 2 if unchecked else 0


def main(env_file: Path = ROOT / ".env", backups: Path = ROOT / "backups") -> int:
    from dotenv import dotenv_values

    url = dotenv_values(env_file).get("DATABASE_URL")
    if not url:
        print(f"check_lost_locks: no DATABASE_URL in {env_file} -- run make env")
        return 2
    return check(read_live(url), sorted(backups.glob("*.dump")), restore_criteria, print)


if __name__ == "__main__":
    sys.exit(main())
