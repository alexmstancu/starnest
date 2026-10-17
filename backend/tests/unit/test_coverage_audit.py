"""The coverage audit holds lines and branches to the bar each on its own (BE-38).

Blending them into one ratio let full line coverage carry branches below the bar: a package at
1000/1000 lines and 800/1000 branches read 90% and passed, which is exactly the fault branch
coverage exists to catch -- every `if` entered one way and never the other.

The audit is a script under `tools/`, not a package, so it is loaded from its path.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

AUDIT = Path(__file__).resolve().parents[3] / "tools" / "audit_coverage.py"


def _the_audit() -> ModuleType:
    spec = importlib.util.spec_from_file_location("audit_coverage", AUDIT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audit = _the_audit()

WELL_COVERED = (9000, 9000, 9000, 9000)
"""A package big enough that the total clears both floors whatever its neighbour does."""


def a_report(**packages: tuple[int, int, int, int]) -> dict:
    """`api=(covered lines, lines, covered branches, branches)`, shaped as coverage.json is."""
    files = {
        f"src/starnest/{package}/module.py": {"summary": a_summary(*counts)}
        for package, counts in packages.items()
    }
    return {"files": files, "totals": a_summary(*map(sum, zip(*packages.values(), strict=True)))}


def a_summary(covered_lines: int, lines: int, covered_branches: int, branches: int) -> dict:
    return {
        "covered_lines": covered_lines,
        "num_statements": lines,
        "covered_branches": covered_branches,
        "num_branches": branches,
    }


def shortfalls_of(report: dict) -> list[tuple[str, str]]:
    return [(shortfall.scope, shortfall.metric) for shortfall in audit.failures_in(report)]


def test_full_lines_cannot_carry_branches_below_the_bar() -> None:
    report = a_report(api=(1000, 1000, 800, 1000), data=WELL_COVERED)

    assert shortfalls_of(report) == [("api", "branches")]


def test_full_branches_cannot_carry_lines_below_the_bar() -> None:
    report = a_report(api=(800, 1000, 1000, 1000), data=WELL_COVERED)

    assert shortfalls_of(report) == [("api", "lines")]


def test_a_package_short_on_both_is_named_for_both() -> None:
    report = a_report(api=(800, 1000, 800, 1000), data=WELL_COVERED)

    assert shortfalls_of(report) == [("api", "lines"), ("api", "branches")]


def test_a_package_with_no_branches_is_held_to_its_lines() -> None:
    """Straight-line code has no branches to cover, which is no evidence either way."""
    covered = a_report(household=(90, 100, 0, 0), data=WELL_COVERED)
    uncovered = a_report(household=(80, 100, 0, 0), data=WELL_COVERED)

    assert shortfalls_of(covered) == []
    assert shortfalls_of(uncovered) == [("household", "lines")]


def test_exactly_the_bar_on_both_passes() -> None:
    report = a_report(api=(85, 100, 85, 100))

    assert shortfalls_of(report) == []


def test_just_under_the_bar_fails() -> None:
    report = a_report(api=(849, 1000, 1000, 1000), data=WELL_COVERED)

    assert shortfalls_of(report) == [("api", "lines")]


def test_the_total_is_held_to_both_floors() -> None:
    """The total is the figure `fail_under` blends, so it is read in two here as well."""
    short_on_branches = a_report(data=WELL_COVERED)
    short_on_branches["totals"] = a_summary(1000, 1000, 800, 1000)
    short_on_lines = a_report(data=WELL_COVERED)
    short_on_lines["totals"] = a_summary(800, 1000, 1000, 1000)

    assert shortfalls_of(short_on_branches) == [("total", "branches")]
    assert shortfalls_of(short_on_lines) == [("total", "lines")]


def test_nothing_measurable_is_reported_not_failed() -> None:
    report = a_report(candidates=(0, 0, 0, 0), data=WELL_COVERED)

    assert shortfalls_of(report) == []


def test_files_of_one_package_are_summed_before_the_bar_is_applied() -> None:
    """Held per package, not per file: one weak file inside a strong package passes."""
    report = a_report(data=WELL_COVERED)
    report["files"]["src/starnest/data/weak.py"] = {"summary": a_summary(1, 10, 1, 10)}

    assert shortfalls_of(report) == []


class TestWhatTheGateReads:
    def test_a_shortfall_is_named_and_the_audit_exits_one(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        exit_code = audit.report_on(a_report(api=(1000, 1000, 800, 1000), data=WELL_COVERED))

        printed = capsys.readouterr().out
        assert exit_code == 1
        assert "api: branches 80.0% (800/1000), needs 85%" in printed
        assert "ALL CHECKS PASS" not in printed

    def test_both_floors_cleared_exits_zero(self, capsys: pytest.CaptureFixture[str]) -> None:
        exit_code = audit.report_on(a_report(api=(90, 100, 90, 100), data=WELL_COVERED))

        printed = capsys.readouterr().out
        assert exit_code == 0
        assert "lines  90.0% (90/100)" in printed and "branches  90.0% (90/100)" in printed
        assert "ALL CHECKS PASS" in printed

    def test_a_metric_with_nothing_measurable_says_so(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        audit.report_on(a_report(household=(10, 10, 0, 0), data=WELL_COVERED))

        assert "branches nothing measurable" in capsys.readouterr().out

    def test_no_report_to_read_is_a_failure_not_a_pass(
        self, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The audit reads what `make coverage` wrote; it never runs the tests itself."""
        monkeypatch.setattr(audit, "REPORT", AUDIT.parent / "no-such-coverage.json")

        assert audit.main() == 1
        assert "run `make coverage` first" in capsys.readouterr().out
