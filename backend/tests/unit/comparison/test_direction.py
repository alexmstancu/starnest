"""Every number a comparison returns reads comparator minus focus (`reqs.md` 8.5, PL-091).

**The focus is the baseline.** Every other number reads "this comparator against the focus", as
the matrix draws it, so a positive gap, an advantage and the green all mean the comparator is
ahead. The server used to write from the focus's side, and the cards printed that under the
comparator's name: the one element on the screen that read backwards, with no test comparing it
with anything.

**Asserted as properties over rankings scored for real** (G2): ties, missing figures, a missing
pillar, weights redistributed on either side, and a total missing on either side. A ranking
written by hand gives every candidate the same weights, and that is where a subtraction the
wrong way round goes unnoticed.
"""

from collections.abc import Mapping
from decimal import Decimal

import pytest

from starnest.comparison import Comparison, compare
from starnest.criteria import Goal, NormalisationMethod, ScaleAnchor
from starnest.data import Count
from starnest.evaluation import AttributeScore, CandidateResult, contribution_of, rank_candidates

from ..evaluation.builders import A_SMALL_SCALE, a_criterion, a_pillar_weight, a_set, a_value

FOCUS = "country.portugal"
TAX = "country.total_tax_rate_effective"
PRICES = "country.cost_of_living_index"
SATISFACTION = "country.life_satisfaction"
BROADBAND = "country.broadband_coverage"

LESS_IS_BETTER = (
    ScaleAnchor(input_value=Decimal(0), score=A_SMALL_SCALE),
    ScaleAnchor(input_value=Decimal(100), score=0),
)
MORE_IS_BETTER = (
    ScaleAnchor(input_value=Decimal(0), score=0),
    ScaleAnchor(input_value=Decimal(100), score=A_SMALL_SCALE),
)


def _anchored(
    attribute: str, pillar: str, weight: str, goal: Goal, anchors: tuple[ScaleAnchor, ...]
):
    return a_criterion(
        attribute=attribute,
        pillar=pillar,
        weight=Decimal(weight),
        goal=goal,
        normalisation_method=NormalisationMethod.FIXED,
        scale_anchors=anchors,
    )


CRITERIA = a_set(
    [
        _anchored(TAX, "economics", "50", Goal.MINIMISE, LESS_IS_BETTER),
        _anchored(PRICES, "economics", "50", Goal.MINIMISE, LESS_IS_BETTER),
        _anchored(SATISFACTION, "culture", "100", Goal.MAXIMISE, MORE_IS_BETTER),
        _anchored(BROADBAND, "connectivity", "100", Goal.MAXIMISE, MORE_IS_BETTER),
    ],
    [
        a_pillar_weight("economics", "50"),
        a_pillar_weight("culture", "30"),
        a_pillar_weight("connectivity", "20"),
    ],
)
"""Two attributes where less is better, so a raw gap and its worth can run opposite ways."""

Figures = Mapping[str, Mapping[str, int]]

FOCUS_FIGURES = {TAX: 41, PRICES: 94, SATISFACTION: 71, BROADBAND: 76}
AHEAD = {TAX: 30, PRICES: 60, SATISFACTION: 64, BROADBAND: 81}
"""Ahead of `FOCUS_FIGURES` on the total and on three attributes, behind on the fourth."""
BEHIND = {TAX: 52, PRICES: 85, SATISFACTION: 40, BROADBAND: 50}
"""Behind `FOCUS_FIGURES` on the total and on three attributes, ahead on the fourth."""

SHAPES: dict[str, Figures] = {
    "every figure on both sides": {
        FOCUS: FOCUS_FIGURES,
        "country.spain": AHEAD,
        "country.greece": BEHIND,
    },
    "ties on figures and on the total": {
        FOCUS: {TAX: 40, PRICES: 60, SATISFACTION: 70, BROADBAND: 80},
        "country.spain": {TAX: 40, PRICES: 60, SATISFACTION: 70, BROADBAND: 80},
        "country.greece": {TAX: 40, PRICES: 100, SATISFACTION: 70, BROADBAND: 85},
    },
    "a comparator missing a figure": {
        FOCUS: FOCUS_FIGURES,
        "country.spain": {TAX: 30, SATISFACTION: 64, BROADBAND: 81},
    },
    "a comparator missing a pillar, so its weights are redistributed": {
        FOCUS: FOCUS_FIGURES,
        "country.greece": {TAX: 52, PRICES: 85, BROADBAND: 50},
    },
    "the focus missing a pillar, so its weights are redistributed": {
        FOCUS: {TAX: 41, PRICES: 94, SATISFACTION: 71},
        "country.spain": AHEAD,
    },
    "a comparator with no total": {
        FOCUS: FOCUS_FIGURES,
        "country.malta": {},
        "country.spain": AHEAD,
    },
    "a focus with no total": {
        FOCUS: {},
        "country.spain": AHEAD,
    },
}
"""No comparator leads or trails on more than three attributes, the number the synthesis keeps,
so each of its lists is the whole set rather than the top of it."""


@pytest.fixture(params=list(SHAPES.values()), ids=list(SHAPES))
def figures(request: pytest.FixtureRequest) -> Figures:
    return request.param


class TestTheDirection:
    def test_a_card_reads_the_comparator_minus_the_focus(self, figures: Figures) -> None:
        drawn = _drawn(figures)

        for comparator, pair in zip(drawn.comparators, drawn.synthesis, strict=True):
            assert pair.comparator == comparator.candidate
            assert pair.score_delta == _gap(drawn.focus.score, comparator.score)

    def test_every_raw_gap_reads_the_comparator_minus_the_focus(self, figures: Figures) -> None:
        """The plain difference of the two figures, whichever way is better: where less is
        better, a comparator ahead on the score has the smaller figure and a negative gap."""
        for row in _drawn(figures).attributes:
            for cell in row.comparators:
                assert cell.delta == _gap(
                    _figure(figures, FOCUS, str(row.attribute)),
                    _figure(figures, str(cell.candidate), str(row.attribute)),
                )

    def test_every_worth_reads_the_comparator_minus_the_focus(self, figures: Figures) -> None:
        """The exact score gap, weighed on the focus's effective weight."""
        drawn = _drawn(figures)
        comparators = {str(result.candidate): result for result in drawn.comparators}

        for row in drawn.attributes:
            focus = _scores(drawn.focus)[str(row.attribute)]
            for cell in row.comparators:
                theirs = _scores(comparators[str(cell.candidate)])[str(row.attribute)]
                gap = _gap(focus.exact_score, theirs.exact_score)
                assert cell.weighted_contribution == (
                    None if gap is None else contribution_of(gap, focus.effective_weight)
                )

    def test_what_the_comparator_leads_on_is_its_advantage(self, figures: Figures) -> None:
        drawn = _drawn(figures)

        for comparator, pair in zip(drawn.comparators, drawn.synthesis, strict=True):
            gaps = _exact_gaps(drawn.focus, comparator)
            assert {_attribute_of(line) for line in pair.advantages} == {
                attribute for attribute, gap in gaps.items() if gap > 0
            }
            assert {_attribute_of(line) for line in pair.disadvantages} == {
                attribute for attribute, gap in gaps.items() if gap < 0
            }
            assert all(_worth_of(line) > 0 for line in pair.advantages)
            assert all(_worth_of(line) < 0 for line in pair.disadvantages)

    def test_every_line_quotes_the_comparator_before_the_focus(self, figures: Figures) -> None:
        drawn = _drawn(figures)

        for comparator, pair in zip(drawn.comparators, drawn.synthesis, strict=True):
            focus, theirs = _scores(drawn.focus), _scores(comparator)
            for line in (*pair.advantages, *pair.disadvantages):
                attribute = _attribute_of(line)
                assert line.partition(", worth ")[0] == (
                    f"{attribute}: {theirs[attribute].normalised_score} against "
                    f"{focus[attribute].normalised_score}"
                )


def _drawn(figures: Figures) -> Comparison:
    values = {
        candidate: tuple(
            a_value(candidate=candidate, attribute=attribute, payload=Count(count=figure))
            for attribute, figure in held.items()
        )
        for candidate, held in figures.items()
    }
    ranking = rank_candidates(
        criteria=CRITERIA, level="country", values=values, score_scale_max=A_SMALL_SCALE
    )
    comparators = [candidate for candidate in figures if candidate != FOCUS]
    return compare(
        results=ranking,
        focus=FOCUS,
        comparators=comparators,
        magnitudes={
            candidate: {attribute: Decimal(figure) for attribute, figure in held.items()}
            for candidate, held in figures.items()
        },
        comparator_limit=len(comparators),
    )


def _gap[Number: (int, Decimal)](focus: Number | None, theirs: Number | None) -> Number | None:
    """The rule under test, written out once: the comparator's number minus the focus's."""
    return None if focus is None or theirs is None else theirs - focus


def _figure(figures: Figures, candidate: str, attribute: str) -> Decimal | None:
    held = figures[candidate].get(attribute)
    return None if held is None else Decimal(held)


def _scores(result: CandidateResult) -> dict[str, AttributeScore]:
    return {str(row.attribute): row for row in result.attribute_scores}


def _exact_gaps(focus: CandidateResult, comparator: CandidateResult) -> dict[str, Decimal]:
    """Each attribute both sides were scored on, with the comparator's exact score minus the
    focus's."""
    theirs = _scores(comparator)
    return {
        attribute: gap
        for attribute, row in _scores(focus).items()
        if (gap := _gap(row.exact_score, theirs[attribute].exact_score)) is not None
    }


def _attribute_of(line: str) -> str:
    return line.split(":")[0]


def _worth_of(line: str) -> Decimal:
    return Decimal(line.rsplit("worth ", 1)[1].split(" ")[0])
