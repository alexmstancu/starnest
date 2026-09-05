"""The candidate roster, and the country codes every structured source keys on.

Migration `0120` seeds the 32 ISO alpha-2 codes. `0015` added the column and deliberately left
it empty: a schema migration says what a column is, and which code belongs to which country is
catalog data like every other row (`arch.md` 1.2).

These tests are against the seeded catalog rather than rows they invent, because the seed is
what the application actually runs on -- a code missing from it is a country no adapter can ask
about, and that is exactly the failure worth catching here.
"""

import psycopg
import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.candidates import Candidate
from starnest.storage import PostgresCandidateStore

pytestmark = pytest.mark.storage

EUROSTATS_OWN_SPELLINGS = {"EL", "UK"}
"""Eurostat's codes for Greece and the United Kingdom. Neither is ISO, and neither belongs in
this column -- the adapter translates, because whose spelling it is, is a fact about Eurostat.
"""


@pytest.fixture
def candidates(pool: AsyncConnectionPool) -> PostgresCandidateStore:
    return PostgresCandidateStore(pool)


async def test_every_seeded_country_comes_back(candidates: PostgresCandidateStore) -> None:
    found = await candidates.read_candidates(level="country")

    assert len(found) == 32
    assert all(isinstance(candidate, Candidate) for candidate in found)


async def test_every_country_carries_an_iso_code(candidates: PostgresCandidateStore) -> None:
    """A country with no code is a country no structured source can be asked about, and it
    would reach the ranking as insufficient data for a reason that is ours rather than the
    world's."""
    found = await candidates.read_candidates(level="country")

    uncoded = [str(candidate.id) for candidate in found if candidate.country_code is None]
    assert uncoded == []


async def test_the_codes_are_iso_and_not_any_sources_own(
    candidates: PostgresCandidateStore,
) -> None:
    """Greece is GR and the United Kingdom is GB. Storing Eurostat's EL and UK would make this
    a Eurostat column, and the next adapter would have to know whose standard it held."""
    found = {str(c.id): c.country_code for c in await candidates.read_candidates(level="country")}

    assert found["country.greece"] == "GR"
    assert found["country.united_kingdom"] == "GB"
    assert not EUROSTATS_OWN_SPELLINGS & set(found.values())


async def test_no_two_countries_share_a_code(candidates: PostgresCandidateStore) -> None:
    """The column is unique in the schema; this is the seeded data agreeing with it, which is
    what a copy-paste in a 32-line VALUES list would break."""
    codes = [c.country_code for c in await candidates.read_candidates(level="country")]

    assert len(set(codes)) == len(codes)


async def test_a_candidate_carries_the_level_record_rather_than_a_copy_of_it(
    candidates: PostgresCandidateStore,
) -> None:
    """`parent_level` is derived from the level, not read off the candidate's own column.

    The database keeps that column so one composite key can check a candidate against its
    parent; a second copy held in memory is a thing that can disagree, and a derived one cannot.
    """
    (country, *_) = await candidates.read_candidates(level="country")

    assert country.level.id == "country"
    assert country.parent_level is None
    assert country.is_top_level


async def test_reading_without_a_level_returns_every_candidate(
    candidates: PostgresCandidateStore, connection: psycopg.Connection
) -> None:
    """No level given is not "the default level": it is every place under evaluation."""
    everything = await candidates.read_candidates()

    assert len(everything) == 32
