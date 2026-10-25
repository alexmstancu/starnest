"""`the_ranking`: what it reads to rank a level, and how often (PL-064, PL-065).

The fakes answer only what a ranking asks. The value store counts its reads, because "one read
per level" is a property no response shows: 32 reads return the same body as one.
"""

import pytest
from fastapi import HTTPException

from starnest.api.rankings import the_ranking
from starnest.candidates import Candidate, Level
from starnest.data import ActiveValue, ConfidenceLevel, Count, Value
from starnest.evaluation import MatchStatus
from starnest.household import HouseholdNotConfiguredError, Settings

from ..evaluation.builders import A_SMALL_SCALE, a_criterion, a_set, a_value

COUNTRY = Level(id="country", depth_order=1)
PORTUGAL = "country.portugal"
SPAIN = "country.spain"
GREECE = "country.greece"


class CountingValueStore:
    def __init__(self, *paired: ActiveValue) -> None:
        self.paired = paired
        self.reads: list[dict[str, object]] = []

    async def read_active_values_with_freshness(self, *, level=None, candidates=(), attributes=()):
        self.reads.append({"level": level, "candidates": candidates, "attributes": attributes})
        return self.paired

    async def read_active_values(self, **_: object):
        raise AssertionError("a ranking reads values with their freshness, never without")


class OneSet:
    async def read_criteria_set(self, criteria_set: str, *, level: str):
        return a_set([a_criterion()])


class Roster:
    async def read_candidates(self, *, level: str | None = None):
        return tuple(
            Candidate(id=each, name=each.removeprefix("country."), level=COUNTRY)
            for each in (PORTUGAL, SPAIN, GREECE)
        )


class NoHousehold:
    def __init__(self, scale: int | None = A_SMALL_SCALE) -> None:
        self.scale = scale

    async def get_settings(self):
        return Settings(score_scale_max=self.scale)

    async def get_household(self):
        raise HouseholdNotConfiguredError("no household")


class NoRules:
    async def read_attributes(self, *, level: str):
        return ()

    async def read_match_rules(self, *, level: str):
        return ()

    async def read_compound_rules(self, *, level: str):
        return ()

    async def read_results(self, *, level: str):
        return ()


def an_active(candidate: str, figure: int, *, value_id: int, fresh: bool = True) -> ActiveValue:
    value: Value = a_value(candidate=candidate, payload=Count(count=figure), id=value_id)
    return ActiveValue(value=value, is_fresh=fresh)


async def rank_with(store: CountingValueStore, households: NoHousehold | None = None):
    return await the_ranking(
        "minimal",
        "country",
        OneSet(),  # type: ignore[arg-type]
        Roster(),  # type: ignore[arg-type]
        store,  # type: ignore[arg-type]
        households or NoHousehold(),  # type: ignore[arg-type]
        NoRules(),  # type: ignore[arg-type]
        NoRules(),  # type: ignore[arg-type]
    )


def by_candidate(ranking):
    return {str(result.candidate): result for result in ranking.results}


async def test_a_ranking_reads_its_values_once_for_the_whole_level() -> None:
    """PL-065: one statement, one snapshot -- not one per candidate on the roster."""
    store = CountingValueStore(
        an_active(PORTUGAL, 90, value_id=1), an_active(SPAIN, 10, value_id=2)
    )

    await rank_with(store)

    assert store.reads == [{"level": "country", "candidates": (), "attributes": ()}]


async def test_a_candidate_with_no_values_stays_in_the_ranking() -> None:
    """Built from the roster, not from the values: Greece has nothing stored and is still
    there, as `insufficient_data` (`reqs.md` 5.4)."""
    store = CountingValueStore(
        an_active(PORTUGAL, 90, value_id=1), an_active(SPAIN, 10, value_id=2)
    )

    ranking = await rank_with(store)

    greece = by_candidate(ranking)[GREECE]
    assert greece.match_status is MatchStatus.INSUFFICIENT_DATA
    assert ranking.values[GREECE] == ()


async def test_a_figure_the_view_calls_stale_drops_a_grade() -> None:
    """PL-064: the stale ids come from the same read that chose the figures."""
    store = CountingValueStore(
        an_active(PORTUGAL, 90, value_id=1, fresh=False), an_active(SPAIN, 10, value_id=2)
    )

    ranking = await rank_with(store)

    assert ranking.stale_values == frozenset({1})
    found = by_candidate(ranking)
    assert found[PORTUGAL].coverage_by_confidence[ConfidenceLevel.MEDIUM] == 100
    assert found[SPAIN].coverage_by_confidence[ConfidenceLevel.HIGH] == 100


async def test_no_scale_is_refused_before_any_value_is_read() -> None:
    """The sad path `make rank` prints: a 409 naming the unset scale, and nothing read."""
    store = CountingValueStore(an_active(PORTUGAL, 90, value_id=1))

    with pytest.raises(HTTPException) as refused:
        await rank_with(store, NoHousehold(scale=None))

    assert refused.value.status_code == 409
    assert refused.value.detail["code"] == "score_scale_not_set"
    assert store.reads == []
