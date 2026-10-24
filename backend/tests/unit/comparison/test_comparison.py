"""A focus candidate against comparators, and what each difference is worth (`reqs.md` 8.5).

The tests this module exists for are `test_a_big_gap_on_a_small_criterion_does_not_lead` and
its pillar-level restatement, `test_a_big_gap_on_a_light_pillar_does_not_lead`: the synthesis is
ordered by weighted contribution, and ordering it by the raw difference would produce lines that
read plausibly and mislead (`devplan.md` C5).
"""

from decimal import Decimal

import grimp
import pytest

from starnest.comparison import ComparatorLimitExceededError, ComparisonError, compare
from starnest.criteria import Goal, NormalisationMethod, ScaleAnchor
from starnest.data import Count
from starnest.evaluation import (
    AttributeScore,
    CandidateResult,
    MatchStatus,
    PublishedFigure,
    rank_candidates,
)
from starnest.evaluation.results import PillarScore

from ..evaluation.builders import a_criterion, a_pillar_weight, a_set, a_value

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
        exact_score=None if score is None else Decimal(score),
        effective_weight=Decimal(weight),
        contribution=Decimal(0) if score is None else Decimal(score) * Decimal(weight) / 100,
    )


def a_result(
    candidate: str,
    score: int | None,
    *rows: AttributeScore,
    pillars: tuple[PillarScore, ...] = (),
) -> CandidateResult:
    return CandidateResult(
        candidate=candidate,
        score=score,
        coverage=Decimal(100),
        match_status=MatchStatus.MATCHING if score is not None else MatchStatus.INSUFFICIENT_DATA,
        attribute_scores=rows,
        pillar_scores=pillars,
    )


def a_pillar(pillar: str, score: int | None, weight: str) -> PillarScore:
    """One pillar's part in a total, rolled up as `pillars_of` rolls it: its score times what it
    counted for, and nothing at all from a pillar nobody scored."""
    return PillarScore(
        pillar=pillar,
        score=score,
        weight=Decimal(weight),
        contribution=Decimal(0) if score is None else Decimal(score) * Decimal(weight) / 100,
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


def figures(**by_attribute: str) -> dict[str, PublishedFigure]:
    return {
        attribute: PublishedFigure(Decimal(figure)) for attribute, figure in by_attribute.items()
    }


FIGURES = {
    PORTUGAL: figures(**{TAX: "41.5", COASTLINE: "1793", PRICES: "94.5"}),
    SPAIN: figures(**{TAX: "47.9", COASTLINE: "4964", PRICES: "88.2"}),
    GREECE: figures(**{TAX: "52.0", COASTLINE: "13676", PRICES: "85.0"}),
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
        """Spain's 47.9% against Portugal's 41.5%: the gap reads comparator minus focus."""
        row = next(r for r in a_comparison().attributes if str(r.attribute) == TAX)

        (cell,) = row.comparators
        assert row.focus_magnitude == Decimal("41.5")
        assert cell.magnitude == Decimal("47.9")
        assert cell.delta == Decimal("6.4")

    def test_the_gap_is_worth_the_score_difference_times_the_weight(self) -> None:
        """Spain scores 50 on tax against Portugal's 70, at an effective weight of 40: eight
        points of the total, against Spain."""
        row = next(r for r in a_comparison().attributes if str(r.attribute) == TAX)

        (cell,) = row.comparators
        assert cell.weighted_contribution == Decimal(-8)

    def test_the_weight_is_the_focuss_and_not_the_comparators(self) -> None:
        """**Which side's weight it is decides the number** (`comparison.py` `_cell`): the
        contribution answers "what is this gap worth to the *focus's* total", so it is the
        focus's effective weight after redistribution for what the focus was missing.

        The two differ in real rankings, because redistribution is per candidate: a comparator
        missing figures elsewhere carries a larger share on everything it did answer. Every
        candidate in `THE_RANKING` holds identical weights, so no test there could tell the two
        apart -- and switching `_cell` to the comparator's weight passed the whole file.

        Spain scores 50 against Portugal's 70 at a focus weight of 40: eight points behind. Read
        off Spain's weight of 10 it would be two, and the synthesis would rank the gap fifth of
        five.
        """
        ranking = (
            a_result(PORTUGAL, 60, a_score(TAX, 70, "40")),
            a_result(SPAIN, 50, a_score(TAX, 50, "10")),
        )

        (cell,) = a_comparison(results=ranking).attributes[0].comparators
        assert cell.weighted_contribution == Decimal(-8)

    def test_a_missing_figure_leaves_the_gap_unanswered_rather_than_zero(self) -> None:
        """Zero would say "the same", which is a different claim from "we do not know"."""
        ranking = (
            a_result(PORTUGAL, 60, a_score(TAX, 70, "40")),
            a_result(SPAIN, 50, a_score(TAX, None, "40")),
        )

        row = a_comparison(results=ranking, magnitudes={PORTUGAL: FIGURES[PORTUGAL]}).attributes[0]

        (cell,) = row.comparators
        assert (cell.delta, cell.weighted_contribution) == (None, None)

    def test_no_raw_gap_between_figures_on_different_scales(self) -> None:
        """7 on 0-10 against 70 on 0-100 is the same judgement, and their difference, -63, is in
        no unit (C06-S2, P1-52). The figures and the score gap still stand; only the raw gap
        goes."""
        ranking = (
            a_result(PORTUGAL, 60, a_score(PRICES, 70, "40")),
            a_result(SPAIN, 50, a_score(PRICES, 70, "40")),
        )
        on_two_scales = {
            PORTUGAL: {PRICES: PublishedFigure(Decimal(7), (Decimal(0), Decimal(10)))},
            SPAIN: {PRICES: PublishedFigure(Decimal(70), (Decimal(0), Decimal(100)))},
        }

        row = a_comparison(results=ranking, magnitudes=on_two_scales).attributes[0]

        (cell,) = row.comparators
        assert (row.focus_magnitude, cell.magnitude) == (Decimal(7), Decimal(70))
        assert cell.delta is None
        assert cell.weighted_contribution == Decimal(0)

    @pytest.mark.parametrize(
        "scale",
        [None, (Decimal(0), Decimal(10))],
        ids=["both-undeclared", "one-declared-scale"],
    )
    def test_figures_on_one_scale_keep_their_raw_gap(
        self, scale: tuple[Decimal, Decimal] | None
    ) -> None:
        ranking = (
            a_result(PORTUGAL, 60, a_score(PRICES, 70, "40")),
            a_result(SPAIN, 50, a_score(PRICES, 40, "40")),
        )
        on_one_scale = {
            PORTUGAL: {PRICES: PublishedFigure(Decimal(7), scale)},
            SPAIN: {PRICES: PublishedFigure(Decimal(4), scale)},
        }

        (cell,) = a_comparison(results=ranking, magnitudes=on_one_scale).attributes[0].comparators

        assert cell.delta == Decimal(-3)

    def test_a_declared_scale_against_none_has_no_raw_gap(self) -> None:
        """A figure on a declared scale and one on none are not known to share a unit."""
        ranking = (
            a_result(PORTUGAL, 60, a_score(PRICES, 70, "40")),
            a_result(SPAIN, 50, a_score(PRICES, 40, "40")),
        )
        mixed = {
            PORTUGAL: {PRICES: PublishedFigure(Decimal(7), (Decimal(0), Decimal(10)))},
            SPAIN: {PRICES: PublishedFigure(Decimal(4))},
        }

        (cell,) = a_comparison(results=ranking, magnitudes=mixed).attributes[0].comparators

        assert cell.delta is None

    def test_each_row_carries_the_focuss_effective_weight(self) -> None:
        """What the attribute counted for in the focus's total, on the basis Rank prints it
        (PL-098, P1-43): a share of the whole level, after the focus's own redistribution.
        Spain counts tax at 10 after its own; the row belongs to the focus, so it reads 40."""
        ranking = (
            a_result(PORTUGAL, 60, a_score(TAX, 70, "40")),
            a_result(SPAIN, 50, a_score(TAX, 50, "10")),
        )

        (row,) = a_comparison(results=ranking).attributes

        assert row.focus_effective_weight == Decimal(40)

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

        assert synthesis.disadvantages[0].startswith("country.total_tax_rate_effective")
        assert "worth -8.0 points" in synthesis.disadvantages[0]
        # The coastline gap is 3,171 km and second, because it is worth 0.3 of a point.
        assert synthesis.disadvantages[1].startswith("country.coastline_access")

    def test_it_reads_in_words_the_reader_can_check_against_the_table(self) -> None:
        """The comparator's score first, because the pair is read from its side."""
        (synthesis,) = a_comparison(names={TAX: "Total tax rate"}).synthesis

        assert synthesis.disadvantages[0] == "Total tax rate: 50 against 70, worth -8.0 points"

    def test_advantages_are_the_gaps_the_other_way(self) -> None:
        """Spain trails on tax and coastline, and leads on prices."""
        (synthesis,) = a_comparison().synthesis

        assert synthesis.advantages == (
            "country.cost_of_living_index: 60 against 40, worth +2.0 points",
        )

    def test_each_pair_quotes_its_own_comparator(self) -> None:
        """With two comparators, the first version of this quoted Spain's numbers in Greece's
        sentences: the sentence looked up the first cell that had a contribution rather than
        the one belonging to the pair being described."""
        spain, greece = a_comparison(comparators=[SPAIN, GREECE]).synthesis

        assert (
            spain.disadvantages[0]
            == "country.total_tax_rate_effective: 50 against 70, worth -8.0 points"
        )
        assert greece.disadvantages[0] == (
            "country.total_tax_rate_effective: 30 against 70, worth -16.0 points"
        )

    def test_the_score_delta_heads_the_pair(self) -> None:
        """Spain's 50 against Portugal's 60: the comparator's total minus the focus's."""
        (synthesis,) = a_comparison().synthesis

        assert synthesis.score_delta == -10

    @pytest.mark.parametrize("top", [2, 3])
    def test_only_the_top_few_are_listed_and_the_caller_says_how_few(self, top: int) -> None:
        """Both ends of the synthesis are cut to the same number, so four gaps either way come
        back as `top` and `top`.

        **Two values, because one of them was the default.** This passed `top=3`, which is what
        `compare` already uses when nobody says otherwise -- so hardcoding the slice at three
        and never reading `top` passed it.
        """
        ahead = tuple(a_score(f"country.a{i}", 90, "10") for i in range(4))
        behind = tuple(a_score(f"country.b{i}", 10, "10") for i in range(4))
        theirs = tuple(a_score(f"country.a{i}", 10, "10") for i in range(4)) + tuple(
            a_score(f"country.b{i}", 90, "10") for i in range(4)
        )
        ranking = (a_result(PORTUGAL, 60, *ahead, *behind), a_result(SPAIN, 50, *theirs))

        (synthesis,) = a_comparison(results=ranking, magnitudes={}, top=top).synthesis

        assert (len(synthesis.advantages), len(synthesis.disadvantages)) == (top, top)

    def test_an_unscoreable_candidate_has_no_score_delta(self) -> None:
        ranking = (THE_RANKING[0], a_result(SPAIN, None, a_score(TAX, None, "40")))

        (synthesis,) = a_comparison(results=ranking).synthesis

        assert synthesis.score_delta is None


BY_PILLAR = (
    # Spain trails Portugal by 75 points on nature and by 20 on economics, and leads by 20 on
    # housing. Nature is the largest gap and the first pillar Portugal lists, and it counts for 2%
    # of the total, so it is worth 1.5 points; economics counts for 40% and is worth 8.
    a_result(
        PORTUGAL,
        60,
        pillars=(
            a_pillar("nature", 95, "2"),
            a_pillar("economics", 70, "40"),
            a_pillar("housing", 40, "10"),
        ),
    ),
    a_result(
        SPAIN,
        50,
        pillars=(
            a_pillar("nature", 20, "2"),
            a_pillar("economics", 50, "40"),
            a_pillar("housing", 60, "10"),
        ),
    ),
)


class TestTheSynthesisByPillar:
    """A pair's lines are pillars (PL-100, P1-55): each is worth the comparator's pillar
    contribution minus the focus's, the figure the matrix shows under "Weighted impact"."""

    def test_a_big_gap_on_a_light_pillar_does_not_lead(self) -> None:
        """`devplan.md` C5, restated at pillar level. Ordered by the score gap, or left in the
        focus's order, nature would lead Spain's "behind" list on a gap worth 1.5 points, above
        one worth 8."""
        (pair,) = a_comparison(results=BY_PILLAR).synthesis

        assert [str(line.pillar) for line in pair.behind] == ["economics", "nature"]

    def test_each_line_names_its_pillar_and_what_it_is_worth(self) -> None:
        """Spain's 50 on economics at 40% puts 20 into its total, against Portugal's 28: -8."""
        (pair,) = a_comparison(results=BY_PILLAR).synthesis

        assert _lines(pair.behind) == [("economics", Decimal(-8)), ("nature", Decimal("-1.5"))]
        assert _lines(pair.ahead) == [("housing", Decimal(2))]

    @pytest.mark.parametrize("unscored", [PORTUGAL, SPAIN], ids=["the focus", "the comparator"])
    def test_a_pillar_either_side_has_no_score_is_not_comparable_and_in_neither_list(
        self, unscored: str
    ) -> None:
        """PL-099. A pillar nobody scored contributes nothing, and reading that zero as a figure
        would list a six-point gap on family that no evidence stands behind."""

        def family(candidate: str) -> PillarScore:
            if candidate == unscored:
                return a_pillar("family", None, "0")
            return a_pillar("family", 60, "10")

        ranking = (
            a_result(PORTUGAL, 60, pillars=(a_pillar("economics", 70, "40"), family(PORTUGAL))),
            a_result(SPAIN, 50, pillars=(a_pillar("economics", 50, "40"), family(SPAIN))),
        )

        (pair,) = a_comparison(results=ranking).synthesis

        assert pair.not_comparable == ("family",)
        assert "family" not in {str(line.pillar) for line in (*pair.ahead, *pair.behind)}

    @pytest.mark.parametrize("without", [PORTUGAL, SPAIN], ids=["the focus", "the comparator"])
    def test_nothing_is_listed_against_a_missing_total(self, without: str) -> None:
        """C07-F, on either side. A line is a share of the gap between two totals, so a missing
        total leaves nothing to be a share of -- even where, as under a coverage floor, every
        pillar still has a score."""
        ranking = tuple(
            a_result(
                str(result.candidate),
                None if str(result.candidate) == without else result.score,
                pillars=result.pillar_scores,
            )
            for result in BY_PILLAR
        )

        (pair,) = a_comparison(results=ranking).synthesis

        assert (pair.ahead, pair.behind) == ((), ())

    def test_a_pillar_worth_nothing_either_way_is_no_line(self) -> None:
        """A line is never worth zero. Housing puts the same into both totals, so it is neither
        led nor trailed on -- and it was compared, so it is not "not comparable" either."""
        ranking = (
            a_result(
                PORTUGAL,
                60,
                pillars=(a_pillar("housing", 40, "10"), a_pillar("economics", 70, "40")),
            ),
            a_result(
                SPAIN, 50, pillars=(a_pillar("housing", 40, "10"), a_pillar("economics", 50, "40"))
            ),
        )

        (pair,) = a_comparison(results=ranking).synthesis

        assert (_lines(pair.ahead), _lines(pair.behind), pair.not_comparable) == (
            [],
            [("economics", Decimal(-8))],
            (),
        )

    def test_pillars_worth_the_same_keep_the_focuss_order(self) -> None:
        """Ties break on the focus's pillar order, the order the matrix lists them in, and never
        on a name: the same comparison reads identically every time it is drawn."""
        ranking = (
            a_result(
                PORTUGAL, 60, pillars=(a_pillar("safety", 50, "10"), a_pillar("culture", 50, "10"))
            ),
            a_result(
                SPAIN, 70, pillars=(a_pillar("safety", 70, "10"), a_pillar("culture", 70, "10"))
            ),
        )

        (pair,) = a_comparison(results=ranking).synthesis

        assert [str(line.pillar) for line in pair.ahead] == ["safety", "culture"]

    @pytest.mark.parametrize("top", [2, 3])
    def test_only_the_top_few_pillars_are_listed_and_the_caller_says_how_few(
        self, top: int
    ) -> None:
        """Four pillars either way come back as `top` and `top`. Two values, because one of them
        is the default."""
        leads = ("career", "health", "nature", "safety")
        trails = ("culture", "economics", "family", "housing")
        ranking = (
            a_result(
                PORTUGAL, 60, pillars=tuple(a_pillar(pillar, 50, "10") for pillar in leads + trails)
            ),
            a_result(
                SPAIN,
                50,
                pillars=tuple(a_pillar(pillar, 90, "10") for pillar in leads)
                + tuple(a_pillar(pillar, 10, "10") for pillar in trails),
            ),
        )

        (pair,) = a_comparison(results=ranking, top=top).synthesis

        assert (len(pair.ahead), len(pair.behind)) == (top, top)


def _lines(lines) -> list[tuple[str, Decimal]]:
    """Each line as its pillar and its worth, for an assertion that reads like the card."""
    return [(str(line.pillar), line.worth) for line in lines]


class TestWhatCannotBeCompared:
    def test_a_candidate_that_is_not_in_this_ranking(self) -> None:
        """Which is also how levels stay unmixed: a city is not in a country ranking."""
        with pytest.raises(ComparisonError, match="not in this ranking") as refused:
            a_comparison(comparators=["city.lisbon"])

        assert refused.value.details == {"candidates": ["city.lisbon"]}

    def test_more_comparators_than_the_configured_limit(self) -> None:
        """A refusal of its own, carrying the limit and the count, so a client can say which
        setting to change rather than calling the request malformed (PL-007)."""
        with pytest.raises(ComparatorLimitExceededError, match="limit of 1") as refused:
            a_comparison(comparators=[SPAIN, GREECE], comparator_limit=1)

        assert refused.value.details == {"limit": 1, "asked": 2}

    def test_the_limit_is_the_callers_and_has_no_default(self) -> None:
        """`reqs.md` 8.5: configurable, never hardcoded. A default here would be the bound."""
        with pytest.raises(TypeError):
            compare(  # type: ignore[call-arg]
                results=THE_RANKING, focus=PORTUGAL, comparators=[SPAIN], magnitudes=FIGURES
            )

    def test_a_focus_compared_with_itself(self) -> None:
        with pytest.raises(ComparisonError, match="itself") as refused:
            a_comparison(comparators=[PORTUGAL])

        assert refused.value.details == {"candidates": [PORTUGAL]}

    def test_the_same_comparator_twice(self) -> None:
        with pytest.raises(ComparisonError, match="twice") as refused:
            a_comparison(comparators=[SPAIN, GREECE, SPAIN])

        assert refused.value.details == {"candidates": [SPAIN]}

    def test_no_comparators_at_all(self) -> None:
        """It concerns the focus, the one candidate the request does name."""
        with pytest.raises(ComparisonError, match="at least one") as refused:
            a_comparison(comparators=[])

        assert refused.value.details == {"candidates": [PORTUGAL]}

    def test_only_the_limit_has_a_refusal_of_its_own(self) -> None:
        """The four other causes are a request built wrong, not a setting to change."""
        with pytest.raises(ComparisonError) as refused:
            a_comparison(comparators=[PORTUGAL])

        assert not isinstance(refused.value, ComparatorLimitExceededError)


SATISFACTION = "country.life_satisfaction"
BROADBAND = "country.broadband_coverage"


class TestTheGapIsWeighedBeforeItIsRounded:
    """`reqs.md` 5.1 forbids rounding a score before it is weighted. BE-02 stopped the ranking
    doing it, and the comparison went on weighing the rounded score it displays (NEW-17).

    Scored for real rather than written by hand, on a scale of 10 anchored 0 to 100, so the exact
    scores are fractions: satisfaction is 7.4 against 4.6, a gap of 2.8 that rounds to 7 against
    5; broadband is 7.6 against 5.4, a gap of 2.2 that rounds to 8 against 5.
    """

    def test_two_near_equal_gaps_are_ordered_by_what_they_are_worth(self) -> None:
        """Spain trails on both, by -1.4 and -1.1 points; the rounded scores said -1.0 and
        -1.5, the other way round."""
        (pair,) = a_scored_comparison().synthesis

        assert [sentence.split(":")[0] for sentence in pair.disadvantages] == [
            SATISFACTION,
            BROADBAND,
        ]

    def test_a_gap_is_worth_the_exact_difference_times_the_weight(self) -> None:
        """Spain's 4.6 against Portugal's 7.4 at an effective weight of 50 is -1.4 points; the
        rounded 5 against 7 said -1.0."""
        row = next(r for r in a_scored_comparison().attributes if str(r.attribute) == SATISFACTION)

        (cell,) = row.comparators
        assert cell.weighted_contribution == Decimal("-1.4")


def a_scored_comparison():
    anchors = (
        ScaleAnchor(input_value=Decimal(0), score=0),
        ScaleAnchor(input_value=Decimal(100), score=10),
    )
    criteria = a_set(
        [
            a_criterion(
                attribute=attribute,
                pillar=pillar,
                goal=Goal.MAXIMISE,
                normalisation_method=NormalisationMethod.FIXED,
                scale_anchors=anchors,
            )
            for attribute, pillar in ((SATISFACTION, "culture"), (BROADBAND, "connectivity"))
        ],
        [a_pillar_weight("culture", "50"), a_pillar_weight("connectivity", "50")],
    )
    figures = {
        PORTUGAL: {SATISFACTION: 74, BROADBAND: 76},
        SPAIN: {SATISFACTION: 46, BROADBAND: 54},
    }
    values = {
        candidate: tuple(
            a_value(candidate=candidate, attribute=attribute, payload=Count(count=figure))
            for attribute, figure in by_attribute.items()
        )
        for candidate, by_attribute in figures.items()
    }
    ranking = rank_candidates(
        criteria=criteria,
        level="country",
        values=values,
        score_scale_max=10,
        stale_values=frozenset(),
    )
    return compare(
        results=ranking, focus=PORTUGAL, comparators=[SPAIN], magnitudes={}, comparator_limit=5
    )


def test_comparison_imports_nothing_from_criteria() -> None:
    """`arch.md` 6.1 lets `comparison` import `candidates`, `data` and `evaluation`, and no more.
    The layers contract is coarser than that row, so this one edge is held here (BE-31)."""
    graph = grimp.build_graph("starnest")

    assert not graph.direct_import_exists(
        importer="starnest.comparison", imported="starnest.criteria", as_packages=True
    )
