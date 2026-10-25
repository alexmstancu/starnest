"""A gate's answer, and who may replace it (`reqs.md` 3.7, 6.10 use 3).

One live answer per gate per candidate, so a new answer replaces the old one and its pages as
the answer that stands -- while every answer written is kept as an immutable version with its own
pages (`reqs.md` Q237), so a correction never destroys what it corrects. **Except
that a model never replaces a person** (NEW-02). A research pass reads the answers once when it
starts, so a person can confirm or override a gate while the pass runs -- and the proposal
written afterwards used to overwrite that answer, silently, which is the one thing a confirmed
answer must never be.
"""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import MatchResult, MatchRuleResult
from starnest.household import Household
from starnest.storage import PostgresHouseholdStore, PostgresMatchRuleResultStore

pytestmark = pytest.mark.storage

GATE = "uk_skilled_worker"
UNITED_KINGDOM = "country.united_kingdom"
MORNING = datetime(2026, 10, 15, 9, 0, tzinfo=UTC)
NOON = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)
OFFICIAL_PAGE = "https://www.gov.uk/skilled-worker-visa"
ANOTHER_PAGE = "https://www.gov.uk/government/publications/skilled-worker-visa-eligible-occupations"


def an_answer(
    source: str, result: MatchResult, page: str, *, at: datetime, **overrides: object
) -> MatchRuleResult:
    fields: dict[str, object] = {
        "match_rule": GATE,
        "candidate": UNITED_KINGDOM,
        "match_result": result,
        "data_source": source,
        "retrieval_date": at,
        "reason": f"{source} answered {result}",
        "citations": (page,),
    }
    return MatchRuleResult(**(fields | overrides))  # type: ignore[arg-type]


@pytest.fixture
async def answers(pool: AsyncConnectionPool) -> AsyncIterator[PostgresMatchRuleResultStore]:
    """The store, with every answer a test records removed afterwards.

    `match_rule_result` is not among the tables the storage suite empties, and the acceptance
    suite counts answers, so a row left here would fail a test there for no reason of its own.
    """
    try:
        yield PostgresMatchRuleResultStore(pool)
    finally:
        async with pool.connection() as connection:
            await connection.execute("TRUNCATE match_rule_answer CASCADE")


async def the_answer(store: PostgresMatchRuleResultStore) -> MatchRuleResult:
    (answer,) = await store.read_results(candidate=UNITED_KINGDOM, match_rule=GATE)
    return answer


class TestAProposalNeverReplacesAPerson:
    async def test_a_proposal_written_after_a_manual_answer_leaves_it_intact(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        await answers.record(an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON))

        kept = await the_answer(answers)
        assert (kept.data_source, kept.match_result) == ("manual", MatchResult.MATCHING)
        assert kept.is_proposal is False
        assert kept.retrieval_date == MORNING
        assert kept.reason == "manual answered matching"

    async def test_the_manual_answers_pages_are_left_with_it(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        """The pages are the answer's evidence: a proposal that was not written brings none."""
        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        await answers.record(an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON))

        assert (await the_answer(answers)).citations == (OFFICIAL_PAGE,)

    async def test_an_override_a_person_gave_survives_a_proposal(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        overridden = an_answer(
            "manual",
            MatchResult.NOT_MATCHING,
            OFFICIAL_PAGE,
            at=MORNING,
            override_reason="no sponsor will hire from abroad in this field",
            override_date=MORNING,
        )
        await answers.record(overridden)

        await answers.record(an_answer("llm", MatchResult.MATCHING, ANOTHER_PAGE, at=NOON))

        kept = await the_answer(answers)
        assert kept.override_reason == overridden.override_reason
        assert kept.match_result is MatchResult.NOT_MATCHING

    async def test_an_answer_from_another_human_source_survives_a_proposal(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        """`national_law` is read by a person, like `manual`: only a model's answer proposes."""
        await answers.record(
            an_answer("national_law", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING)
        )

        await answers.record(an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON))

        assert (await the_answer(answers)).data_source == "national_law"


class TestWhatStillReplacesAnAnswer:
    async def test_a_manual_answer_replaces_a_proposal(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        """Confirming a proposal is writing it as `manual`, so this is how one is confirmed."""
        await answers.record(an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=MORNING))

        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=NOON))

        kept = await the_answer(answers)
        assert (kept.data_source, kept.match_result) == ("manual", MatchResult.MATCHING)
        assert kept.is_proposal is False
        assert kept.citations == (OFFICIAL_PAGE,)

    async def test_a_proposal_replaces_a_proposal(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("llm", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        await answers.record(an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON))

        kept = await the_answer(answers)
        assert (kept.match_result, kept.retrieval_date) == (MatchResult.NOT_MATCHING, NOON)
        assert kept.is_proposal is True
        assert kept.citations == (ANOTHER_PAGE,)

    async def test_a_manual_answer_replaces_a_manual_answer(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("manual", MatchResult.UNKNOWN, OFFICIAL_PAGE, at=MORNING))

        await answers.record(an_answer("manual", MatchResult.MATCHING, ANOTHER_PAGE, at=NOON))

        kept = await the_answer(answers)
        assert (kept.match_result, kept.citations) == (MatchResult.MATCHING, (ANOTHER_PAGE,))

    async def test_a_proposal_is_recorded_where_nobody_has_answered(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("llm", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        kept = await the_answer(answers)
        assert kept.is_proposal is True
        assert kept.citations == (OFFICIAL_PAGE,)


class TestItSaysWhetherItStoredTheAnswer:
    """`record` answers whether it wrote, so the endpoint can refuse what the store declined
    (NEW-36) instead of answering 200 with somebody else's answer -- while the research pass,
    which declines silently by design, simply does not ask."""

    async def test_an_answer_where_none_stood_is_stored(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        stored = await answers.record(
            an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING)
        )

        assert stored is True

    async def test_a_proposal_over_a_person_s_answer_is_declined(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        stored = await answers.record(
            an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON)
        )

        assert stored is False

    async def test_a_proposal_over_a_proposal_is_stored(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("llm", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        stored = await answers.record(
            an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON)
        )

        assert stored is True

    async def test_a_person_s_answer_over_a_proposal_is_stored(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("llm", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        stored = await answers.record(
            an_answer("manual", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON)
        )

        assert stored is True


async def versions_of(pool: AsyncConnectionPool) -> list[Any]:
    """Every version the pair has had, oldest first, with its pages."""
    async with pool.connection() as connection:
        cursor = await connection.execute(
            """
            SELECT v.id, v.data_source, v.match_result, v.reason, v.override_reason,
                   v.override_date, v.retrieval_date,
                   ARRAY(SELECT c.url FROM match_rule_answer_citation AS c
                         WHERE c.answer = v.id ORDER BY c.url) AS citations
            FROM   match_rule_answer AS v
            WHERE  v.match_rule = %s AND v.candidate = %s
            ORDER  BY v.recorded_at, v.id
            """,
            (GATE, UNITED_KINGDOM),
        )
        return list(await cursor.fetchall())


class TestEveryAnswerIsKept:
    """A gate answer is a version, never edited once written; the live row points at the one
    that stands (`reqs.md` Q237, PL-143)."""

    async def test_a_correction_keeps_the_answer_it_replaced_with_its_pages_and_override(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        first = an_answer(
            "manual",
            MatchResult.NOT_MATCHING,
            OFFICIAL_PAGE,
            at=MORNING,
            override_reason="no sponsor will hire from abroad in this field",
            override_date=MORNING,
        )
        await answers.record(first)

        await answers.record(an_answer("manual", MatchResult.MATCHING, ANOTHER_PAGE, at=NOON))

        kept, corrected = await versions_of(pool)
        assert (kept[1], kept[2], kept[3]) == ("manual", "not_matching", first.reason)
        assert (kept[4], kept[5], kept[6]) == (first.override_reason, MORNING, MORNING)
        assert kept[7] == [OFFICIAL_PAGE]
        assert (corrected[2], corrected[7]) == ("matching", [ANOTHER_PAGE])

    async def test_a_declined_proposal_leaves_no_version(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        assert not await answers.record(
            an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON)
        )

        assert [version[1] for version in await versions_of(pool)] == ["manual"]

    async def test_the_live_answer_points_at_the_version_it_shows(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        for answer in (
            an_answer("llm", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING),
            an_answer("manual", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON),
            an_answer("manual", MatchResult.UNKNOWN, OFFICIAL_PAGE, at=NOON),
        ):
            await answers.record(answer)
            live = await the_answer(answers)
            newest = (await versions_of(pool))[-1]

            assert live.id == newest[0]
            assert (str(live.data_source), str(live.match_result), live.reason) == newest[1:4]
            assert list(live.citations) == newest[7]

    async def test_every_reader_sees_one_live_answer_per_pair(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        """History never reaches a reader: a superseded not_matching that did would rule a
        candidate out on an answer somebody corrected."""
        await answers.record(
            an_answer("manual", MatchResult.NOT_MATCHING, OFFICIAL_PAGE, at=MORNING)
        )
        await answers.record(an_answer("manual", MatchResult.MATCHING, ANOTHER_PAGE, at=NOON))

        whole_level = await answers.read_results(level="country")

        assert [(str(a.match_rule), str(a.candidate), a.match_result) for a in whole_level] == [
            (GATE, UNITED_KINGDOM, MatchResult.MATCHING)
        ]

    async def test_two_first_answers_at_once_both_keep_their_version(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        """Two people answering a pair nobody has answered: the upserts serialise on the live
        row, both versions stay, and the live row shows the one it points at."""
        await asyncio.gather(
            answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING)),
            answers.record(an_answer("manual", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON)),
        )

        versions = await versions_of(pool)
        live = await the_answer(answers)
        assert len(versions) == 2
        (shown,) = [version for version in versions if version[0] == live.id]
        assert (str(live.match_result), list(live.citations)) == (shown[2], shown[7])


class TestARecheckIsKeptBesideAPerson:
    """D53. A re-check asks again about a person's answer because a person asked, and what it
    finds is a version beside that answer -- served as its pending proposal -- never over it."""

    async def test_a_rechecked_proposal_is_kept_beside_the_person_s_answer(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))
        before = await the_answer(answers)

        kept = await answers.propose_beside(
            an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON, is_proposal=True)
        )

        after = await the_answer(answers)
        assert kept is True
        assert after.model_copy(update={"pending_proposal": None}) == before
        pending = after.pending_proposal
        assert pending is not None
        assert (pending.data_source, pending.match_result) == ("llm", MatchResult.NOT_MATCHING)
        assert (pending.retrieval_date, pending.citations) == (NOON, (ANOTHER_PAGE,))
        assert pending.is_proposal is True
        assert pending.recorded_at is not None and pending.recorded_at >= after.recorded_at

    async def test_a_person_recording_again_settles_the_pending_proposal(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        """Taking the proposal is recording its answer; either way it is no longer pending."""
        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))
        await answers.propose_beside(
            an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON, is_proposal=True)
        )

        await answers.record(an_answer("manual", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON))

        settled = await the_answer(answers)
        assert settled.match_result is MatchResult.NOT_MATCHING
        assert settled.pending_proposal is None

    async def test_nothing_is_kept_where_no_person_answered(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        await answers.record(an_answer("llm", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING))

        kept = await answers.propose_beside(
            an_answer("llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON, is_proposal=True)
        )
        unanswered = await answers.propose_beside(
            an_answer(
                "llm", MatchResult.NOT_MATCHING, ANOTHER_PAGE, at=NOON, is_proposal=True
            ).model_copy(update={"match_rule": "ch_eu_efta_quota"})
        )

        assert (kept, unanswered) == (False, False)
        assert (await the_answer(answers)).pending_proposal is None
        async with pool.connection() as connection:
            cursor = await connection.execute("SELECT count(*) FROM match_rule_answer")
            assert await cursor.fetchone() == (1,)

    async def test_a_person_s_answer_is_never_kept_beside_another(
        self, answers: PostgresMatchRuleResultStore
    ) -> None:
        with pytest.raises(ValueError, match="only a proposal"):
            await answers.propose_beside(
                an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=MORNING)
            )


async def hold_citizenships(pool: AsyncConnectionPool, *citizenships: str) -> None:
    await PostgresHouseholdStore(pool).replace_household(
        Household(
            net_income=Decimal("4000"),
            number_adults=2,
            number_children=0,
            home_country_candidate="country.romania",
            citizenships=frozenset(citizenships),
        )
    )


class TestAnAnswerRecordsTheCitizenshipsItAssumed:
    """Q239. Each version keeps the household citizenships it was written against, and the read
    flags it for a re-check once the household's differ -- never expiring or overwriting it."""

    async def test_an_answer_assumes_the_household_s_citizenships_and_needs_no_recheck(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        await hold_citizenships(pool, "country.romania", "country.italy")

        await answers.record(an_answer("manual", MatchResult.NOT_MATCHING, OFFICIAL_PAGE, at=NOON))

        recorded = await the_answer(answers)
        assert recorded.assumed_citizenships == ("country.italy", "country.romania")
        assert recorded.needs_recheck is False

    async def test_a_change_of_citizenship_flags_the_answer_and_leaves_it_standing(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        await hold_citizenships(pool, "country.romania")
        await answers.record(an_answer("manual", MatchResult.NOT_MATCHING, OFFICIAL_PAGE, at=NOON))
        before = await the_answer(answers)

        await hold_citizenships(pool, "country.romania", "country.united_kingdom")

        after = await the_answer(answers)
        assert after.needs_recheck is True
        assert after.model_copy(update={"needs_recheck": False}) == before

    async def test_recording_again_under_the_new_citizenships_settles_the_flag(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        await hold_citizenships(pool, "country.romania")
        await answers.record(an_answer("manual", MatchResult.NOT_MATCHING, OFFICIAL_PAGE, at=NOON))
        await hold_citizenships(pool, "country.ireland")

        await answers.record(an_answer("manual", MatchResult.MATCHING, OFFICIAL_PAGE, at=NOON))

        settled = await the_answer(answers)
        assert (settled.assumed_citizenships, settled.needs_recheck) == (
            ("country.ireland",),
            False,
        )

    async def test_an_answer_recorded_with_no_household_assumed_nothing_and_is_never_flagged(
        self, answers: PostgresMatchRuleResultStore, pool: AsyncConnectionPool
    ) -> None:
        """Nobody knows what it assumed, so flagging it would claim something unknown."""
        await answers.record(an_answer("manual", MatchResult.NOT_MATCHING, OFFICIAL_PAGE, at=NOON))
        await hold_citizenships(pool, "country.united_kingdom")

        recorded = await the_answer(answers)
        assert (recorded.assumed_citizenships, recorded.needs_recheck) == ((), False)
