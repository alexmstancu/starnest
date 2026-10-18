"""A gate's answer, and who may replace it (`reqs.md` 3.7, 6.10 use 3).

One answer per gate per candidate, so a new answer replaces the old one and its pages. **Except
that a model never replaces a person** (NEW-02). A research pass reads the answers once when it
starts, so a person can confirm or override a gate while the pass runs -- and the proposal
written afterwards used to overwrite that answer, silently, which is the one thing a confirmed
answer must never be.
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from psycopg_pool import AsyncConnectionPool

from starnest.data import MatchResult, MatchRuleResult
from starnest.storage import PostgresMatchRuleResultStore

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
            await connection.execute("TRUNCATE match_rule_result CASCADE")


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
