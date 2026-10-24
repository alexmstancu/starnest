"""Every number a comparison returns reads comparator minus focus (`reqs.md` 8.5, PL-091).

**The focus is the baseline.** Every other number reads "this comparator against the focus", as
the matrix draws it, so a positive gap, an advantage and the green all mean the comparator is
ahead. The server used to write from the focus's side, and the cards printed that under the
comparator's name: the one element on the screen that read backwards, with no test comparing it
with anything.

**Asserted as properties over rankings scored for real** (G2): ties, missing figures, a missing
pillar, weights redistributed on either side, and a total missing on either side. A ranking
written by hand gives every candidate the same weights, and that is where a subtraction the
wrong way round goes unnoticed. The pillar lines (PL-100) are held the same way, because a
pillar's contribution carries its candidate's own redistribution.
"""

from collections.abc import Mapping
from decimal import Decimal

import pytest

from starnest.comparison import Comparison, compare
from starnest.criteria import Goal, NormalisationMethod, ScaleAnchor
from starnest.data import Count
from starnest.evaluation import AttributeScore, CandidateResult, contribution_of, rank_candidates
from starnest.evaluation.results import PillarScore

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
so each of its lists is the whole set rather than the top of it. There are three pillars, so the
same holds for the pillar lines."""


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


class TestThePillarLines:
    """G2's line cases (PL-100, PL-099, C07-F)."""

    def test_every_line_is_worth_the_comparators_pillar_contribution_minus_the_focuss(
        self, figures: Figures
    ) -> None:
        drawn = _drawn(figures)

        for comparator, pair in zip(drawn.comparators, drawn.synthesis, strict=True):
            focus, theirs = _pillars(drawn.focus), _pillars(comparator)
            for line in (*pair.ahead, *pair.behind):
                pillar = str(line.pillar)
                assert line.worth == theirs[pillar].contribution - focus[pillar].contribution
            assert all(line.worth > 0 for line in pair.ahead)
            assert all(line.worth < 0 for line in pair.behind)

    def test_what_the_comparator_leads_on_is_ahead_and_what_it_trails_on_behind(
        self, figures: Figures
    ) -> None:
        """Every comparable pillar with a gap, on the side the gap is on -- and nothing at all
        where either side has no total."""
        drawn = _drawn(figures)

        for comparator, pair in zip(drawn.comparators, drawn.synthesis, strict=True):
            listed = (
                {str(line.pillar) for line in pair.ahead},
                {str(line.pillar) for line in pair.behind},
            )
            if drawn.focus.score is None or comparator.score is None:
                assert listed == (set(), set())
                continue
            worth = _pillar_gaps(drawn.focus, comparator)
            assert listed == (
                {pillar for pillar, gap in worth.items() if gap > 0},
                {pillar for pillar, gap in worth.items() if gap < 0},
            )

    def test_a_pillar_either_side_has_no_score_is_not_comparable(self, figures: Figures) -> None:
        drawn = _drawn(figures)

        for comparator, pair in zip(drawn.comparators, drawn.synthesis, strict=True):
            theirs = _pillars(comparator)
            assert pair.not_comparable == tuple(
                ours.pillar
                for ours in drawn.focus.pillar_scores
                if ours.score is None or theirs[str(ours.pillar)].score is None
            )
            lines = {str(line.pillar) for line in (*pair.ahead, *pair.behind)}
            assert lines.isdisjoint(pair.not_comparable)

    @pytest.mark.parametrize("short", [FOCUS, "country.greece"], ids=["focus", "comparator"])
    def test_nothing_is_listed_against_a_total_under_the_coverage_floor(self, short: str) -> None:
        """C07-F where it is a decision rather than an accident: with no culture figure, one
        side falls short of a 100% floor and has no total, and still has two pillars scored."""
        figures = {FOCUS: FOCUS_FIGURES, "country.greece": BEHIND}
        figures[short] = {
            attribute: held
            for attribute, held in figures[short].items()
            if attribute != SATISFACTION
        }

        drawn = _drawn(figures, min_coverage=Decimal(100))

        (comparator,), (pair,) = drawn.comparators, drawn.synthesis
        (unscored,) = (side for side in (drawn.focus, comparator) if str(side.candidate) == short)
        assert unscored.score is None
        scored = [
            str(pillar.pillar) for pillar in unscored.pillar_scores if pillar.score is not None
        ]
        assert scored == ["economics", "connectivity"]
        assert (pair.ahead, pair.behind) == ((), ())


def _drawn(figures: Figures, *, min_coverage: Decimal | None = None) -> Comparison:
    values = {
        candidate: tuple(
            a_value(candidate=candidate, attribute=attribute, payload=Count(count=figure))
            for attribute, figure in held.items()
        )
        for candidate, held in figures.items()
    }
    ranking = rank_candidates(
        criteria=CRITERIA,
        level="country",
        values=values,
        score_scale_max=A_SMALL_SCALE,
        min_coverage=min_coverage,
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


def _pillars(result: CandidateResult) -> dict[str, PillarScore]:
    return {str(pillar.pillar): pillar for pillar in result.pillar_scores}


def _pillar_gaps(focus: CandidateResult, comparator: CandidateResult) -> dict[str, Decimal]:
    """Each pillar both sides have a score on, with the comparator's contribution minus the
    focus's."""
    theirs = _pillars(comparator)
    return {
        pillar: theirs[pillar].contribution - ours.contribution
        for pillar, ours in _pillars(focus).items()
        if ours.score is not None and theirs[pillar].score is not None
    }


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
