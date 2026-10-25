"""`tools/check_lost_locks.py` finds a lock or an exclusion a replacement dropped (P97)."""

import importlib.util
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "tools" / "check_lost_locks.py"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_lost_locks", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


script = load_script()

TAX = "0445-total-tax-rate-replaces-income-tax"
APPLIED = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)


def dumped(*rows: tuple[str, str, str, str]) -> str:
    """pg_restore's plain output for the criterion table, with the columns out of order."""
    body = "".join(f"7\t{s}\t{a}\t35.5\t{locked}\t{scored}\n" for s, a, locked, scored in rows)
    return (
        "-- PostgreSQL database dump\n\n"
        "COPY public.criterion (id, criteria_set, attribute, weight, weight_locked, is_scored) "
        f"FROM stdin;\n{body}\\.\n\n"
    )


def live(**criteria: tuple[bool, bool]) -> object:
    return script.Live(
        applied={TAX: APPLIED},
        criteria={
            (criteria_set, "country.total_tax_rate_effective"): script.Chosen(*chosen)
            for criteria_set, chosen in criteria.items()
        },
    )


DUMPS = [Path("backups/20260911-115959.dump"), Path("backups/20260911-120001.dump")]


def run(state: object, dump_text: str, dumps: list[Path] = DUMPS) -> tuple[int, list[str], list]:
    said: list[str] = []
    read: list[Path] = []

    def read_dump(dump: Path) -> str:
        read.append(dump)
        return dump_text

    return script.check(state, dumps, read_dump, said.append), said, read


def test_a_lock_and_an_exclusion_dropped_by_a_replacement_are_named() -> None:
    before = dumped(
        ("local_employment", "country.income_tax_effective", "t", "f"),
        ("remote_only", "country.income_tax_effective", "f", "t"),
    )

    code, said, read = run(live(local_employment=(False, True), remote_only=(False, True)), before)

    assert code == 1
    assert read == [DUMPS[0]], "the dump read is the newest one taken before the migration"
    assert [line for line in said if "LOST" in line] == [
        "  LOST 0445: local_employment, country.total_tax_rate_effective -- was locked before, "
        "is unlocked now",
        "  LOST 0445: local_employment, country.total_tax_rate_effective -- was excluded from "
        "scoring before, is scored now",
    ]


def test_a_lock_still_held_or_set_since_is_not_reported() -> None:
    before = dumped(("local_employment", "country.income_tax_effective", "f", "t"))

    code, said, _ = run(live(local_employment=(True, False)), before)

    assert code == 0
    assert not [line for line in said if "LOST" in line]


def test_a_set_that_no_longer_judges_the_successor_is_not_reported() -> None:
    before = dumped(("deleted_since", "country.income_tax_effective", "t", "f"))

    assert run(live(), before)[0] == 0


def test_with_no_dump_before_the_migration_it_says_it_cannot_check() -> None:
    code, said, read = run(live(), dumped(), dumps=[DUMPS[1], Path("backups/notes.txt")])

    assert code == 2
    assert read == []
    assert f"{TAX}: no dump older than 2026-09-11 12:00 UTC" in said


def test_a_migration_never_applied_is_passed_over() -> None:
    _, said, _ = run(live(), dumped())

    assert (
        "0442-crime-splits-into-a-rate-and-a-composite: never applied here, nothing to check"
        in (said)
    )


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("-- an empty dump\n", id="no criterion rows"),
        pytest.param(dumped().removesuffix("\\.\n\n"), id="rows without their terminator"),
    ],
)
def test_a_dump_it_cannot_read_is_refused_rather_than_read_as_empty(text: str) -> None:
    with pytest.raises(ValueError, match="criterion rows"):
        script.criteria_in(text)


def test_without_a_database_url_it_refuses(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("LOG_LEVEL=info\n")

    assert script.main(env_file=tmp_path / ".env", backups=tmp_path) == 2
