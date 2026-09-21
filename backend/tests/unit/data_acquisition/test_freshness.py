"""What a run need not ask about again.

The planner re-fetched everything in scope until this existed, so the behaviour under test is
new and the default -- a null threshold -- must reproduce exactly what it did before.
"""

from datetime import UTC, datetime, timedelta

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
