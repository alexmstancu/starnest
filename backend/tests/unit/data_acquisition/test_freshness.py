"""What a run need not ask about again.

The planner re-fetched everything in scope until this existed, so the behaviour under test is
new and the default -- a null threshold -- must reproduce exactly what it did before.
"""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta

from starnest.candidates import Candidate
from starnest.data import Attribute, RatioParameters, ValueType
from starnest.data_acquisition import attributes_still_fresh
from starnest.data_acquisition.freshness import still_fresh_everywhere

NOW = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
A_YEAR = timedelta(days=365)
PORTUGAL = "country.portugal"
SPAIN = "country.spain"
RENT = "country.rent"
TAX = "country.tax"


def _asked(days_ago: int) -> datetime:
    return NOW - timedelta(days=days_ago)


class TestWhenNothingIsSkipped:
    def test_an_unset_threshold_skips_nothing(self) -> None:
        """The shipped state, and exactly what the planner did before this existed."""
        assert (
            still_fresh_everywhere(
                attributes=[RENT],
                candidates=[PORTUGAL],
                last_retrieved={(PORTUGAL, RENT): _asked(1)},
                refetch_older_than=None,
                now=NOW,
            )
            == frozenset()
        )

    def test_an_empty_roster_skips_nothing(self) -> None:
        """ "Every candidate is fresh" must not be vacuously true of no candidates."""
        assert (
            still_fresh_everywhere(
                attributes=[RENT],
                candidates=[],
                last_retrieved={},
                refetch_older_than=A_YEAR,
                now=NOW,
            )
            == frozenset()
        )

    def test_an_attribute_never_fetched_is_asked_about(self) -> None:
        assert (
            still_fresh_everywhere(
                attributes=[RENT],
                candidates=[PORTUGAL],
                last_retrieved={},
                refetch_older_than=A_YEAR,
                now=NOW,
            )
            == frozenset()
        )


class TestWhatIsSkipped:
    def test_an_attribute_fresh_for_every_candidate_is_skipped(self) -> None:
        assert still_fresh_everywhere(
            attributes=[RENT],
            candidates=[PORTUGAL, SPAIN],
            last_retrieved={(PORTUGAL, RENT): _asked(1), (SPAIN, RENT): _asked(2)},
            refetch_older_than=A_YEAR,
            now=NOW,
        ) == frozenset({RENT})

    def test_one_stale_candidate_keeps_the_whole_attribute_in_scope(self) -> None:
        """The conservative half of a rectangle: a gap anywhere is asked about everywhere."""
        assert (
            still_fresh_everywhere(
                attributes=[RENT],
                candidates=[PORTUGAL, SPAIN],
                last_retrieved={
                    (PORTUGAL, RENT): _asked(1),
                    (SPAIN, RENT): _asked(400),
                },
                refetch_older_than=A_YEAR,
                now=NOW,
            )
            == frozenset()
        )

    def test_one_missing_candidate_keeps_the_whole_attribute_in_scope(self) -> None:
        assert (
            still_fresh_everywhere(
                attributes=[RENT],
                candidates=[PORTUGAL, SPAIN],
                last_retrieved={(PORTUGAL, RENT): _asked(1)},
                refetch_older_than=A_YEAR,
                now=NOW,
            )
            == frozenset()
        )

    def test_attributes_are_judged_independently(self) -> None:
        assert still_fresh_everywhere(
            attributes=[RENT, TAX],
            candidates=[PORTUGAL],
            last_retrieved={(PORTUGAL, RENT): _asked(1), (PORTUGAL, TAX): _asked(400)},
            refetch_older_than=A_YEAR,
            now=NOW,
        ) == frozenset({RENT})

    def test_a_figure_exactly_at_the_threshold_is_asked_about_again(self) -> None:
        """Fresh means newer than the threshold, so the boundary re-asks rather than skips."""
        assert (
            still_fresh_everywhere(
                attributes=[RENT],
                candidates=[PORTUGAL],
                last_retrieved={(PORTUGAL, RENT): NOW - A_YEAR},
                refetch_older_than=A_YEAR,
                now=NOW,
            )
            == frozenset()
        )


COUNTRY = {"id": "country", "depth_order": 1}
IN_PORTUGAL = Candidate(id=PORTUGAL, name="Portugal", level=COUNTRY, country_code="PT")
IN_SPAIN = Candidate(id=SPAIN, name="Spain", level=COUNTRY, country_code="ES")


def an_attribute(identifier: str) -> Attribute:
    return Attribute(
        id=identifier,
        name=identifier,
        level="country",
        value_type=ValueType.RATIO,
        pillar="housing",
        ratio_parameters=RatioParameters(basis="households"),
    )


class LastRetrieved:
    """The one read `attributes_still_fresh` makes of a run store, answered from a table and
    recorded, so a test can say whether the store was asked at all."""

    def __init__(self, answers: Mapping[tuple[str, str], datetime]) -> None:
        self._answers = answers
        self.asked: list[tuple[str | None, list[str], list[str]]] = []

    async def last_retrieved(self, *, level=None, candidates=(), attributes=()):  # type: ignore[no-untyped-def]
        self.asked.append((level, list(candidates), list(attributes)))
        return self._answers


class TestAskingTheStoreWhatIsStillFresh:
    """One answer for a run and for its plan (BE-25). The run dropped fresh attributes and the
    plan did not ask, so the estimate a household confirmed counted work the run then skipped."""

    async def test_a_null_age_reads_nothing_from_the_store(self) -> None:
        """The shipped state costs no query: with no age set, nothing can be fresh."""
        store = LastRetrieved({(PORTUGAL, RENT): _asked(1)})

        fresh = await attributes_still_fresh(
            runs=store,  # type: ignore[arg-type]
            level="country",
            attributes=[an_attribute(RENT)],
            candidates=[IN_PORTUGAL],
            refetch_older_than=None,
            now=NOW,
        )

        assert fresh == frozenset()
        assert store.asked == []

    async def test_it_judges_what_the_store_says_was_last_retrieved(self) -> None:
        store = LastRetrieved(
            {(PORTUGAL, RENT): _asked(1), (SPAIN, RENT): _asked(2), (PORTUGAL, TAX): _asked(400)}
        )

        fresh = await attributes_still_fresh(
            runs=store,  # type: ignore[arg-type]
            level="country",
            attributes=[an_attribute(RENT), an_attribute(TAX)],
            candidates=[IN_PORTUGAL, IN_SPAIN],
            refetch_older_than=A_YEAR,
            now=NOW,
        )

        assert fresh == frozenset({RENT})
        assert store.asked == [("country", [PORTUGAL, SPAIN], [RENT, TAX])]
