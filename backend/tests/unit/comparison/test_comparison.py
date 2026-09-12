"""A focus candidate against comparators, and what each difference is worth (`reqs.md` 8.5).

The test this module exists for is `test_a_big_gap_on_a_small_criterion_does_not_lead`: the
synthesis is ordered by weighted contribution, and ordering it by the raw difference would
produce sentences that read plausibly and mislead (`devplan.md` C5).
"""

from decimal import Decimal

import pytest

from starnest.comparison import ComparisonError, compare
from starnest.evaluation import AttributeScore, CandidateResult, MatchStatus

TAX = "country.total_tax_rate_effective"
COASTLINE = "country.coastline_access"
PRICES = "country.cost_of_living_index"
PORTUGAL = "country.portugal"
SPAIN = "country.spain"
GREECE = "country.greece"


def a_score(attribute: str, score: int | None, weight: str) -> AttributeScore:
    return AttributeScore(
        attribute=attribute,
        pillar="economics",
        normalised_score=score,
        effective_weight=Decimal(weight),
        contribution=Decimal(0) if score is None else Decimal(score) * Decimal(weight) / 100,
    )


def a_result(candidate: str, score: int | None, *rows: AttributeScore) -> CandidateResult:
    return CandidateResult(
        candidate=candidate,
        score=score,
        coverage=Decimal(100),
        match_status=MatchStatus.MATCHING if score is not None else MatchStatus.INSUFFICIENT_DATA,
        attribute_scores=rows,
    )


THE_RANKING = (
    # Portugal leads on both tax and coastline, and trails on prices. The coastline gap is by
    # far the largest raw number and worth almost nothing; the tax gap is small and decisive.
    a_result(
        PORTUGAL,
        60,
        a_score(TAX, 70, "40"),
        a_score(COASTLINE, 95, "2"),
        a_score(PRICES, 40, "10"),
    ),
    a_result(
        SPAIN,
        50,
        a_score(TAX, 50, "40"),
        a_score(COASTLINE, 80, "2"),
        a_score(PRICES, 60, "10"),
    ),
    a_result(
        GREECE,
        40,
        a_score(TAX, 30, "40"),
        a_score(COASTLINE, 90, "2"),
        a_score(PRICES, 55, "10"),
    ),
)
FIGURES = {
    PORTUGAL: {TAX: Decimal("41.5"), COASTLINE: Decimal("1793"), PRICES: Decimal("94.5")},
    SPAIN: {TAX: Decimal("47.9"), COASTLINE: Decimal("4964"), PRICES: Decimal("88.2")},
    GREECE: {TAX: Decimal("52.0"), COASTLINE: Decimal("13676"), PRICES: Decimal("85.0")},
}


def a_comparison(**overrides: object):
    fields: dict[str, object] = {
        "results": THE_RANKING,
        "focus": PORTUGAL,
        "comparators": [SPAIN],
        "magnitudes": FIGURES,
        "comparator_limit": 5,
    }
    return compare(**(fields | overrides))  # type: ignore[arg-type]


class TestTheTable:
    def test_each_row_carries_both_sides_and_the_gap_in_the_attributes_own_unit(self) -> None:
        row = next(r for r in a_comparison().attributes if str(r.attribute) == TAX)

        (cell,) = row.comparators
        assert row.focus_magnitude == Decimal("41.5")
        assert cell.magnitude == Decimal("47.9")
        assert cell.delta == Decimal("-6.4")

    def test_the_gap_is_worth_the_score_difference_times_the_weight(self) -> None:
        """Portugal scores 70 on tax against Spain's 50, at an effective weight of 40: eight
        points of the total."""
        row = next(r for r in a_comparison().attributes if str(r.attribute) == TAX)

        (cell,) = row.comparators
        assert cell.weighted_contribution == Decimal(8)

    def test_a_missing_figure_leaves_the_gap_unanswered_rather_than_zero(self) -> None:
        """Zero would say "the same", which is a different claim from "we do not know"."""
        ranking = (
            a_result(PORTUGAL, 60, a_score(TAX, 70, "40")),
            a_result(SPAIN, 50, a_score(TAX, None, "40")),
        )

        row = a_comparison(results=ranking, magnitudes={PORTUGAL: FIGURES[PORTUGAL]}).attributes[0]

        (cell,) = row.comparators
        assert (cell.delta, cell.weighted_contribution) == (None, None)

    def test_every_comparator_gets_a_column(self) -> None:
        comparison = a_comparison(comparators=[SPAIN, GREECE])

        assert [str(c.candidate) for c in comparison.comparators] == [SPAIN, GREECE]
        assert all(len(row.comparators) == 2 for row in comparison.attributes)


class TestTheSynthesis:
    def test_a_big_gap_on_a_small_criterion_does_not_lead(self) -> None:
        """`devplan.md` C5. Spain has 3,171 km more coastline and pays 6.4 points more tax:
        the coastline gap is the larger number and worth a third of a point, the tax gap is
        worth eight. Ordering by the raw difference would put the coastline first and mislead.
        """
        (synthesis,) = a_comparison().synthesis

        assert synthesis.advantages[0].startswith("country.total_tax_rate_effective")
        assert "worth +8.0 points" in synthesis.advantages[0]
        # The coastline gap is 3,171 km and second, because it is worth 0.3 of a point.
        assert synthesis.advantages[1].startswith("country.coastline_access")

    def test_it_reads_in_words_the_reader_can_check_against_the_table(self) -> None:
        (synthesis,) = a_comparison(names={TAX: "Total tax rate"}).synthesis

        assert synthesis.advantages[0] == "Total tax rate: 70 against 50, worth +8.0 points"

    def test_disadvantages_are_the_gaps_the_other_way(self) -> None:
        (synthesis,) = a_comparison().synthesis

        assert synthesis.disadvantages == (
            "country.cost_of_living_index: 40 against 60, worth -2.0 points",
        )

    def test_each_pair_quotes_its_own_comparator(self) -> None:
        """With two comparators, the first version of this quoted Spain's numbers in Greece's
        sentences: the sentence looked up the first cell that had a contribution rather than
        the one belonging to the pair being described."""
        spain, greece = a_comparison(comparators=[SPAIN, GREECE]).synthesis

        assert (
            spain.advantages[0]
            == "country.total_tax_rate_effective: 70 against 50, worth +8.0 points"
        )
        assert greece.advantages[0] == (
            "country.total_tax_rate_effective: 70 against 30, worth +16.0 points"
        )

    def test_the_score_delta_heads_the_pair(self) -> None:
        (synthesis,) = a_comparison().synthesis

        assert synthesis.score_delta == 10

    def test_only_the_top_few_are_listed(self) -> None:
        rows = tuple(a_score(f"country.a{i}", 90, "10") for i in range(6))
        theirs = tuple(a_score(f"country.a{i}", 10, "10") for i in range(6))
        ranking = (a_result(PORTUGAL, 60, *rows), a_result(SPAIN, 50, *theirs))

        (synthesis,) = a_comparison(results=ranking, magnitudes={}, top=3).synthesis

        assert len(synthesis.advantages) == 3

    def test_an_unscoreable_candidate_has_no_score_delta(self) -> None:
        ranking = (THE_RANKING[0], a_result(SPAIN, None, a_score(TAX, None, "40")))

        (synthesis,) = a_comparison(results=ranking).synthesis

        assert synthesis.score_delta is None


class TestWhatCannotBeCompared:
    def test_a_candidate_that_is_not_in_this_ranking(self) -> None:
        """Which is also how levels stay unmixed: a city is not in a country ranking."""
        with pytest.raises(ComparisonError, match="not in this ranking"):
            a_comparison(comparators=["city.lisbon"])

    def test_more_comparators_than_the_configured_limit(self) -> None:
        with pytest.raises(ComparisonError, match="limit of 1"):
            a_comparison(comparators=[SPAIN, GREECE], comparator_limit=1)

    def test_the_limit_is_the_callers_and_has_no_default(self) -> None:
        """`reqs.md` 8.5: configurable, never hardcoded. A default here would be the bound."""
        with pytest.raises(TypeError):
            compare(  # type: ignore[call-arg]
                results=THE_RANKING, focus=PORTUGAL, comparators=[SPAIN], magnitudes=FIGURES
            )

    def test_a_focus_compared_with_itself(self) -> None:
        with pytest.raises(ComparisonError, match="itself"):
            a_comparison(comparators=[PORTUGAL])

    def test_the_same_comparator_twice(self) -> None:
        with pytest.raises(ComparisonError, match="twice"):
            a_comparison(comparators=[SPAIN, SPAIN])

    def test_no_comparators_at_all(self) -> None:
        with pytest.raises(ComparisonError, match="at least one"):
            a_comparison(comparators=[])
