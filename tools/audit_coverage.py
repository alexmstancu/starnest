#!/usr/bin/env python3
"""Per-package coverage audit of the backend.

**A global coverage floor hides a bad neighbourhood.** One under-tested package disappears
behind a codebase's worth of well-tested ones, and gets less visible as the codebase grows: at
2,900 measurable points, a new 100-point module at zero moves the total by three points and
trips nothing. This holds each package of `arch.md` 6.1 to the bar on its own, so a failure
reads as "evaluation is under-tested" rather than "something, somewhere, is".

**Deliberately per-package rather than per-file.** Eighteen of the seventy-five backend files
have fewer than ten measurable points, where one uncovered line is worth more than ten
percentage points. A per-file rule would spend most of its noise budget on files whose
percentage means almost nothing, and a gate nobody trusts is a gate nobody keeps.

**Lines and branches are two floors, held apart** (BE-38). Blending them into one ratio let full
line coverage carry branches below the bar: a package at 1000/1000 lines and 800/1000 branches
read 90% and passed. Each package, and the total, clears 85% of its lines *and* 85% of its
branches. `pyproject.toml`'s `fail_under` can only hold the blend, so this is where the two
floors are enforced.

Reads `backend/coverage.json`, which `make coverage` writes. It reads only; it never edits.

    make coverage && uv run python tools/audit_coverage.py

Exit code 0 means every package and the total clear both floors.
"""

import json
import sys
from pathlib import Path
from typing import NamedTuple

BACKEND = Path(__file__).resolve().parent.parent / "backend"
REPORT = BACKEND / "coverage.json"

BAR = 85.0
"""The floor `pyproject.toml` applies to the blended total, applied here to each package's lines
and to its branches, each on its own.

Not higher: a package is finished when its tests are, and a bar set at where the code happens
to sit today turns every new module into a gate failure on its way to being written.
"""

TOP_LEVEL = "starnest (top level)"
"""`main.py` and the package `__init__`. Not a package of `arch.md` 6.1, but not exempt either.

It was 45.9% until `tests/unit/test_composition_root.py` was written, which is exactly the
shape of gap this audit exists to make visible: one file, invisible in a 97.8% total, and the
one file whose failure means the container does not start.
"""


TOTAL = "total"

METRICS = {
    "lines": ("covered_lines", "num_statements"),
    "branches": ("covered_branches", "num_branches"),
}
"""The two floors, and the fields of a coverage.py summary each one reads."""


class Shortfall(NamedTuple):
    """One package, or the total, below the bar on one of the two metrics."""

    scope: str
    metric: str
    covered: int
    measurable: int

    def __str__(self) -> str:
        return (
            f"{self.scope}: {self.metric} {self.covered / self.measurable * 100:.1f}% "
            f"({self.covered}/{self.measurable}), needs {BAR:.0f}%"
        )


def failures_in(report: dict) -> list[Shortfall]:
    """Every package, and the total, below the bar on its lines or its branches.

    Each metric on its own. One with nothing measurable is no evidence either way, so it is
    skipped rather than failed: a package of straight-line code has no branches to cover.
    """
    return [
        Shortfall(scope, metric, summary[covered], summary[measurable])
        for scope, summary in every_scope(report)
        for metric, (covered, measurable) in METRICS.items()
        if summary[measurable] and summary[covered] / summary[measurable] * 100 < BAR
    ]


def every_scope(report: dict) -> list[tuple[str, dict[str, int]]]:
    """Each package in name order, then the total -- all four counts of each, kept apart."""
    return [*sorted(totals_by_package(report).items()), (TOTAL, report["totals"])]


def package_of(path: str) -> str:
    """Which package a measured file belongs to.

    Paths arrive as `src/starnest/<package>/...`; anything shallower than that is `main.py` or
    the top-level `__init__`, which are grouped rather than dropped. Sub-packages report under
    their parent -- `data_sources/eurostat` under `data_sources` -- because that is the unit
    `arch.md` 6.1 names and the unit somebody would go and fix.
    """
    parts = path.split("/")
    return parts[2] if len(parts) > 3 else TOP_LEVEL


def totals_by_package(report: dict) -> dict[str, dict[str, int]]:
    """Each package's lines and branches, covered and measurable, summed over its files.

    Kept as four counts rather than one ratio: a blend lets full line coverage carry a package
    whose every `if` was entered one way and never the other -- the fault branch coverage
    exists to catch, discarded on the way to the report.
    """
    counted = [field for fields in METRICS.values() for field in fields]
    packages: dict[str, dict[str, int]] = {}
    for path, measured in report["files"].items():
        totals = packages.setdefault(package_of(path), dict.fromkeys(counted, 0))
        for field in counted:
            totals[field] += measured["summary"][field]
    return packages


def main() -> int:
    if not REPORT.exists():
        print(f"no coverage report at {REPORT}")
        print("run `make coverage` first -- this audit reads what that writes, it does not")
        print("run the tests itself, so that the gate measures one run rather than two")
        return 1

    return report_on(json.loads(REPORT.read_text()))


def report_on(report: dict) -> int:
    """Print every package and the total against both floors; 1 when any falls short."""
    shortfalls = failures_in(report)
    short = {shortfall.scope for shortfall in shortfalls}

    print(f"=== every package clears {BAR:.0f}% of its lines and {BAR:.0f}% of its branches ===")
    for scope, summary in every_scope(report):
        status = "FAIL" if scope in short else "ok"
        print(f"  {status:<5} {scope:<24} {reading_of(summary)}")

    if shortfalls:
        print()
        for shortfall in shortfalls:
            print(f"  {shortfall}")
        print(f"\n{len(shortfalls)} FLOOR(S) BELOW THE BAR")
        return 1
    print("\nALL CHECKS PASS")
    return 0


def reading_of(summary: dict[str, int]) -> str:
    """Both metrics side by side, each as its own percentage."""
    readings = []
    for metric, (covered, measurable) in METRICS.items():
        if summary[measurable]:
            percentage = summary[covered] / summary[measurable] * 100
            figure = f"{percentage:5.1f}% ({summary[covered]}/{summary[measurable]})"
        else:
            figure = "nothing measurable"
        readings.append(f"{metric} {figure:<20}")
    return "  ".join(readings).rstrip()


if __name__ == "__main__":
    sys.exit(main())
