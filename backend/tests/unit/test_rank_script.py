"""`make rank`'s printing, as a pure function over the ranking the API serves (D20, N11).

`scripts/rank.py` is outside coverage and was never run by a test, so the day it diverged from
the API -- or crashed on a removed argument -- nothing said so. It now calls `the_ranking`, and
what is left to test is how it prints.
"""

import importlib.util
from decimal import Decimal
from pathlib import Path
from types import ModuleType

import pytest

from starnest.api.rankings import TheRanking
from starnest.data import ConfidenceLevel
from starnest.evaluation import CandidateResult, MatchStatus
from starnest.household import Settings

from .evaluation.builders import a_criterion, a_set

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "rank.py"


@pytest.fixture(scope="module")
def rank_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("rank_script", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def a_result(candidate: str, **fields: object) -> CandidateResult:
    defaults: dict[str, object] = {
        "candidate": candidate,
        "score": None,
        "coverage": Decimal(0),
        "match_status": MatchStatus.INSUFFICIENT_DATA,
        "insufficient_reason": "nothing stored",
    }
    return CandidateResult(**(defaults | fields))  # type: ignore[arg-type]


def a_ranking(*results: CandidateResult) -> TheRanking:
    return TheRanking(
        criteria=a_set([a_criterion()]),
        roster=(),
        results=results,
        score_scale_max=10,
        values={},
        stale_values=frozenset(),
    )


PORTUGAL = a_result(
    "country.portugal",
    score=8,
    rank=1,
    coverage=Decimal(100),
    coverage_by_confidence={ConfidenceLevel.HIGH: Decimal(75), ConfidenceLevel.LOW: Decimal(25)},
    match_status=MatchStatus.MATCHING,
    insufficient_reason=None,
)
GREECE = a_result("country.greece")


def test_it_prints_the_scale_the_floor_and_each_row(rank_script: ModuleType) -> None:
    lines = list(
        rank_script.lines_of(a_ranking(GREECE, PORTUGAL), Settings(min_coverage=Decimal(60)))
    )

    assert lines[0] == "scale 0-10, coverage floor 60%"
    rows = [line for line in lines if "country." in line]
    assert "country.portugal" in rows[0] and "25%" in rows[0] and "matching" in rows[0]
    assert rows[0].lstrip().startswith("1.")
    assert "country.greece" in rows[1] and "--" in rows[1]


def test_the_unscored_are_listed_with_their_reason(rank_script: ModuleType) -> None:
    lines = list(rank_script.lines_of(a_ranking(PORTUGAL, GREECE), Settings()))

    assert lines[0] == "scale 0-10, coverage floor none"
    assert "1 without a score:" in lines
    assert lines[-1] == "  country.greece: nothing stored"


def test_nothing_unscored_prints_no_such_section(rank_script: ModuleType) -> None:
    lines = list(rank_script.lines_of(a_ranking(PORTUGAL), Settings()))

    assert not any("without a score" in line for line in lines)
