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

Reads `backend/coverage.json`, which `make coverage` writes. It reads only; it never edits.

    make coverage && uv run python tools/audit_coverage.py

Exit code 0 means every package clears the bar.
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
REPORT = BACKEND / "coverage.json"

BAR = 85.0
"""The same floor `pyproject.toml` applies to the total, applied to each package.

Not higher: a package is finished when its tests are, and a bar set at where the code happens
to sit today turns every new module into a gate failure on its way to being written.
"""

TOP_LEVEL = "starnest (top level)"
"""`main.py` and the package `__init__`. Not a package of `arch.md` 6.1, but not exempt either.

It was 45.9% until `tests/unit/test_composition_root.py` was written, which is exactly the
shape of gap this audit exists to make visible: one file, invisible in a 97.8% total, and the
one file whose failure means the container does not start.
"""


class Audit:
    def __init__(self) -> None:
        self.failures = 0

    def check(self, package: str, covered: int, measurable: int) -> None:
        if not measurable:
            print(f"  ----  {package:<24} nothing measurable yet")
            return
        percentage = covered / measurable * 100
        if percentage < BAR:
            self.failures += 1
            print(
                f"  FAIL  {package:<24} {percentage:5.1f}%  "
                f"({covered}/{measurable}, needs {BAR:.0f}%)"
            )
        else:
            print(f"  ok    {package:<24} {percentage:5.1f}%  ({covered}/{measurable})")


def package_of(path: str) -> str:
    """Which package a measured file belongs to.

    Paths arrive as `src/starnest/<package>/...`; anything shallower than that is `main.py` or
    the top-level `__init__`, which are grouped rather than dropped. Sub-packages report under
    their parent -- `data_sources/eurostat` under `data_sources` -- because that is the unit
    `arch.md` 6.1 names and the unit somebody would go and fix.
    """
    parts = path.split("/")
    return parts[2] if len(parts) > 3 else TOP_LEVEL


def totals_by_package(report: dict) -> dict[str, list[int]]:
    """Lines *and* branches together, which is what the bar means.

    Counting only lines would pass a package whose every `if` was entered one way and never
    the other -- the fault branch coverage exists to catch, discarded on the way to the report.
    """
    packages: dict[str, list[int]] = {}
    for path, measured in report["files"].items():
        summary = measured["summary"]
        totals = packages.setdefault(package_of(path), [0, 0])
        totals[0] += summary["covered_lines"] + summary["covered_branches"]
        totals[1] += summary["num_statements"] + summary["num_branches"]
    return packages


def main() -> int:
    if not REPORT.exists():
        print(f"no coverage report at {REPORT}")
        print("run `make coverage` first -- this audit reads what that writes, it does not")
        print("run the tests itself, so that the gate measures one run rather than two")
        return 1

    report = json.loads(REPORT.read_text())
    audit = Audit()

    print(f"=== every package clears {BAR:.0f}% of lines and branches ===")
    for package, (covered, measurable) in sorted(totals_by_package(report).items()):
        audit.check(package, covered, measurable)

    total = report["totals"]
    overall = total["covered_lines"] + total["covered_branches"]
    measurable = total["num_statements"] + total["num_branches"]
    print(f"\n  total: {overall / measurable * 100:.1f}%  ({overall}/{measurable})")

    if audit.failures:
        print(f"\n{audit.failures} PACKAGE(S) BELOW THE BAR")
        return 1
    print("\nALL CHECKS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
