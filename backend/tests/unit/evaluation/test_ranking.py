"""One criteria set run against the candidates at one level (`reqs.md` 5).

Everything the arithmetic modules prove separately, assembled -- and the assembly is where the
rules that matter most to the product live: a sparse candidate is scored rather than punished, a
candidate that cannot be scored says so rather than showing a zero, and nothing is filtered out
of the result whatever its status.

**The scale here is 10, not 100**, so a hardcoded ceiling cannot pass unnoticed.

**Two criteria means two pillars.** `CriteriaSet` refuses a pillar whose criteria do not sum to
100, so a set that splits weight has to split it between pillars -- which is the two-level
weighting doing what it is for, rather than a shape invented for these tests.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from starnest.criteria import Goal, NormalisationMethod
from starnest.data import (
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleShape,
    ConfidenceLevel,
    Count,
    MatchResult,
    MatchRuleResult,
    RuleOutcome,
)
from starnest.evaluation import MatchStatus, RankingError, rank_candidates

from .builders import (
    A_CANDIDATE,
    A_SMALL_SCALE,
    AN_ATTRIBUTE,
    RENT,
    a_criterion,
    a_pillar_weight,
    a_set,
    a_value,
    two_pillars,
    values_for,
)

HOUSING = "housing"


def rank(criteria, values, *, scale: int = A_SMALL_SCALE, min_coverage=None, **rules):
    return rank_candidates(
        criteria=criteria,
        level="country",
        values=values,
        score_scale_max=scale,
        min_coverage=min_coverage,
        **rules,
    )


def by_candidate(results):
    return {str(result.candidate): result for result in results}


def three_countries_one_missing_its_rent():
    """Portugal and Italy answer both criteria; Spain answers only the first.

    Three rather than two because `percentile` needs at least two figures in a column to have a
    standing to report, and Spain's absence from the rent column must not empty it.
    """
    values = values_for(portugal=90, spain=10, italy=50)
    for candidate, rent in (("country.portugal", 5), ("country.italy", 9)):
        values[candidate] = (
            *values[candidate],
            a_value(candidate=candidate, attribute=RENT, payload=Count(count=rent)),
        )
    return values


class TestScoringAndOrdering:
    def test_the_better_candidate_scores_higher_and_ranks_first(self) -> None:
        results = rank(a_set([a_criterion()]), values_for(portugal=90, spain=10))

        found = by_candidate(results)
        assert found["country.portugal"].score == A_SMALL_SCALE
        assert found["country.spain"].score == 0
        assert found["country.portugal"].rank == 1
        assert found["country.spain"].rank == 2

    def test_minimising_puts_the_smaller_figure_first(self) -> None:
        """The same figures read as a cost rather than an opportunity."""
        results = rank(a_set([a_criterion(goal=Goal.MINIMISE)]), values_for(portugal=90, spain=10))

        assert by_candidate(results)["country.spain"].rank == 1

    def test_equal_scores_share_a_rank_and_the_next_one_skips(self) -> None:
        """Breaking a tie on the identifier would put one country above another for
        alphabetical reasons and present it as a finding."""
        results = rank(a_set([a_criterion()]), values_for(portugal=50, spain=50, italy=10))

        found = by_candidate(results)
        assert found["country.portugal"].rank == found["country.spain"].rank == 1
        assert found["country.italy"].rank == 3

    def test_scores_follow_the_configured_scale_rather_than_a_hundred(self) -> None:
        results = rank(a_set([a_criterion()]), values_for(portugal=90, spain=10), scale=100)

        assert by_candidate(results)["country.portugal"].score == 100

    def test_every_candidate_comes_back_whatever_its_status(self) -> None:
        """Unscoreable candidates stay visible (`reqs.md` 5.4). Filtering here would make the
        reason a candidate is out impossible to show downstream."""
        results = rank(a_set([a_criterion()]), {"country.portugal": (), "country.spain": ()})

        assert len(results) == 2
        assert all(result.match_status is MatchStatus.INSUFFICIENT_DATA for result in results)


class TestASparseCandidateIsScoredRatherThanPunished:
    def test_a_missing_criterion_redistributes_its_weight(self) -> None:
        """The heart of `reqs.md` 5.3. Spain answers one criterion of two and is still scored
        out of the same whole, with coverage carrying the difference."""
        found = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))

        assert found["country.spain"].coverage == Decimal(50)
        assert found["country.portugal"].coverage == Decimal(100)
        assert found["country.spain"].score is not None
        assert found["country.spain"].match_status is MatchStatus.MATCHING

    def test_the_breakdown_shows_the_weight_actually_used(self) -> None:
        """Showing the stored weight would make the arithmetic fail to add up on screen."""
        spain = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))[
            "country.spain"
        ]

        answered = [row for row in spain.attribute_scores if row.normalised_score is not None]
        unanswered = [row for row in spain.attribute_scores if row.normalised_score is None]
        assert [row.effective_weight for row in answered] == [Decimal(100)]
        assert [row.effective_weight for row in unanswered] == [Decimal(0)]

    def test_the_contributions_add_up_to_the_total(self) -> None:
        """A total nobody can take apart is a number this application may not show."""
        portugal = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))[
            "country.portugal"
        ]

        parts = sum((row.contribution for row in portugal.attribute_scores), Decimal(0))
        assert round(parts) == portugal.score

    def test_a_rejected_value_counts_as_no_value(self) -> None:
        """From the point of view of a score there is no difference between a figure nobody
        found and one that could not be read."""
        values = values_for(portugal=90, spain=10)
        values["country.spain"] = (
            a_value(candidate="country.spain", payload=None, rejection_reason="a negative count"),
        )

        found = by_candidate(rank(a_set([a_criterion()]), values))

        assert found["country.spain"].coverage == Decimal(0)
        assert found["country.spain"].score is None


class TestWhenACandidateCannotBeScored:
    def test_nothing_found_at_all_is_insufficient_data_and_never_a_zero(self) -> None:
        """A zero is a claim that everything measured badly.

        It is the fabrication `reqs.md` forbids and the one a reader is least likely to
        question, because it looks like a score.
        """
        spain = by_candidate(rank(a_set([a_criterion()]), {"country.spain": ()}))["country.spain"]

        assert spain.score is None
        assert spain.coverage == Decimal(0)
        assert spain.match_status is MatchStatus.INSUFFICIENT_DATA
        assert spain.rank is None
        assert "no figure" in (spain.insufficient_reason or "")

    def test_a_missing_blocking_criterion_makes_it_insufficient_data(self) -> None:
        """Even with everything else answered. The user declared it unscoreable without this."""
        criteria = two_pillars(blocks_if_missing=True)
        values = {
            candidate: (a_value(candidate=candidate, attribute=RENT, payload=Count(count=n)),)
            for candidate, n in (("country.portugal", 5), ("country.italy", 9))
        }

        found = by_candidate(rank(criteria, values))

        assert found["country.portugal"].match_status is MatchStatus.INSUFFICIENT_DATA
        assert found["country.portugal"].coverage == Decimal(50)

    def test_the_reason_names_the_criterion_that_was_missing(self) -> None:
        """A screen has to say why, and "insufficient data" on its own says nothing."""
        criteria = a_set([a_criterion(blocks_if_missing=True)])

        spain = by_candidate(rank(criteria, {"country.spain": ()}))["country.spain"]

        assert a_criterion().attribute in (spain.insufficient_reason or "")

    def test_a_figure_that_could_not_be_placed_is_not_reported_as_missing(self) -> None:
        """**Found 2026-09-11, before it could bite.** The reason sentence was built from which
        criteria *scored*, so a blocking criterion whose figures existed but could not be
        normalised read "no figure for" -- a false statement with real data in the database.

        It had stayed accidentally true: every blocking criterion using the unbuilt `fixed`
        method also had no figures. `income_tax_effective` was about to get 31 of them. One
        candidate under `percentile` reaches the same seam without needing `fixed`: a single
        figure has no standing to report, so the column refuses.
        """
        criteria = a_set([a_criterion(blocks_if_missing=True)])

        alone = by_candidate(rank(criteria, values_for(portugal=42)))["country.portugal"]

        reason = alone.insufficient_reason or ""
        assert alone.match_status is MatchStatus.INSUFFICIENT_DATA
        assert "no figure for" not in reason
        assert a_criterion().attribute in reason
        assert "could not be scored" in reason

    def test_a_criterion_using_a_method_not_yet_built_says_so(self) -> None:
        """The shipped set's real case: 26 of its criteria normalise `fixed`, which no scale
        anchor supports yet. The reason names the method, because the fix is choosing anchors
        rather than fetching anything."""
        criteria = a_set(
            [a_criterion(blocks_if_missing=True, normalisation_method=NormalisationMethod.FIXED)]
        )

        found = by_candidate(rank(criteria, values_for(portugal=42, spain=17)))

        reason = found["country.portugal"].insufficient_reason or ""
        assert "no figure for" not in reason
        assert "fixed" in reason

    def test_a_missing_figure_and_an_unplaceable_one_are_named_separately(self) -> None:
        """Two different problems with two different fixes -- fetch something, or choose
        anchors -- so one sentence may not blur them."""
        # `two_pillars` applies overrides to its first criterion only, so both are built here to
        # make each one blocking.
        criteria = a_set(
            [
                a_criterion(blocks_if_missing=True),
                a_criterion(attribute=RENT, pillar=HOUSING, blocks_if_missing=True),
            ],
            [a_pillar_weight(weight="50"), a_pillar_weight(pillar=HOUSING, weight="50")],
        )
        values = values_for(portugal=42)  # a jobs figure, alone, and no rent at all

        portugal = by_candidate(rank(criteria, values))["country.portugal"]

        reason = portugal.insufficient_reason or ""
        assert f"no figure for {RENT}" in reason
        assert "could not be scored" in reason

    def test_coverage_below_the_floor_makes_it_insufficient_data(self) -> None:
        found = by_candidate(
            rank(two_pillars(), three_countries_one_missing_its_rent(), min_coverage=Decimal(60))
        )

        assert found["country.spain"].match_status is MatchStatus.INSUFFICIENT_DATA
        assert "60%" in (found["country.spain"].insufficient_reason or "")
        assert found["country.portugal"].match_status is MatchStatus.MATCHING

    def test_coverage_exactly_on_the_floor_is_scored(self) -> None:
        """**The floor is a floor, not a threshold to clear.** `coverage < min_coverage` is
        right and nothing pinned it: flipping that to `<=` would make every at-floor candidate
        `insufficient_data` and the whole suite would still have passed.

        Spain answers one of two equally weighted criteria, so its coverage is exactly 50.
        """
        found = by_candidate(
            rank(two_pillars(), three_countries_one_missing_its_rent(), min_coverage=Decimal(50))
        )

        spain = found["country.spain"]
        assert spain.coverage == Decimal(50), "the case only bites at exactly the floor"
        assert spain.match_status is MatchStatus.MATCHING
        assert spain.insufficient_reason is None

    def test_no_floor_means_any_coverage_that_found_something_is_scored(self) -> None:
        """`settings.min_coverage` is nullable and unseeded, so this is the shipped state."""
        found = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))

        assert found["country.spain"].match_status is MatchStatus.MATCHING


class TestTheTwoLevelWeighting:
    def test_a_pillar_weight_changes_what_its_criteria_contribute(self) -> None:
        """A criterion's real share is its weight within its pillar times its pillar's within
        the level (`reqs.md` 7). A ranking that used only the inner weight would score two very
        differently-weighted pillars identically."""
        values = values_for(portugal=90, spain=10)
        # Portugal has the WORSE figure in the second pillar, so it wins the pillar worth 80
        # and loses the one worth 20. Winning both would prove nothing about the weighting.
        for candidate, rent in (("country.portugal", 1), ("country.spain", 9)):
            values[candidate] = (
                *values[candidate],
                a_value(candidate=candidate, attribute=RENT, payload=Count(count=rent)),
            )

        found = by_candidate(rank(two_pillars(first="80", second="20"), values))

        # Portugal wins the pillar worth 80 and loses the one worth 20.
        assert found["country.portugal"].score == 8
        assert found["country.spain"].score == 2

    def test_a_criterion_in_an_unweighted_pillar_never_reaches_the_ranking(self) -> None:
        """Refused a layer earlier, by `CriteriaSet` itself.

        Worth a test here anyway: it is why `_level_wide_weights` does not re-check, and if that
        guarantee ever moved, this is what would notice.
        """
        with pytest.raises(ValueError, match="carries no weight"):
            a_set(
                [a_criterion(), a_criterion(attribute=RENT, pillar=HOUSING)],
                [a_pillar_weight(weight="100")],
            )


class TestExcludingACriterionIsNotMissingOne:
    def test_an_excluded_criterion_takes_no_weight_and_leaves_no_gap(self) -> None:
        """`is_scored = false` is a decision that it does not apply, so coverage is unaffected
        (`reqs.md` 5.3). A candidate with no figure for it is still fully covered."""
        criteria = a_set(
            [
                a_criterion(weight=Decimal("100")),
                a_criterion(attribute=RENT, pillar=HOUSING, weight=Decimal("100"), is_scored=False),
            ],
            [a_pillar_weight(weight="50"), a_pillar_weight(pillar=HOUSING, weight="50")],
        )

        found = by_candidate(rank(criteria, values_for(portugal=90, spain=10)))

        assert found["country.spain"].coverage == Decimal(100)
        assert [row.attribute for row in found["country.spain"].attribute_scores] == [
            a_criterion().attribute
        ]


class TestWhenThereIsNoRankingToProduce:
    def test_a_set_that_scores_nothing_at_this_level_is_refused(self) -> None:
        criteria = a_set([a_criterion(is_scored=False)])

        with pytest.raises(RankingError, match="scores nothing at level"):
            rank(criteria, values_for(portugal=90, spain=10))

    def test_a_criterion_whose_column_cannot_be_normalised_costs_coverage(self) -> None:
        """One candidate under percentile has no standing to score. The criterion contributes
        nothing to anybody rather than failing the ranking, and coverage says so."""
        found = by_candidate(rank(a_set([a_criterion()]), values_for(portugal=90)))

        assert found["country.portugal"].coverage == Decimal(0)
        assert found["country.portugal"].score is None


def test_a_value_for_an_attribute_this_set_does_not_score_is_ignored() -> None:
    """Values are fetched per attribute, criteria sets are chosen per person.

    So a candidate routinely holds figures the active set has no opinion about -- a set built
    for remote work carries no view on schooling, and the schooling figures are still stored.
    They must contribute nothing and, above all, inflate nothing: counting one toward coverage
    would report evidence for a criterion nobody is scoring.
    """
    values = values_for(portugal=90, spain=10)
    values["country.spain"] = (
        *values["country.spain"],
        a_value(candidate="country.spain", attribute=RENT, payload=Count(count=5)),
    )

    found = by_candidate(rank(a_set([a_criterion()]), values))

    assert found["country.spain"].coverage == Decimal(100)
    assert [row.attribute for row in found["country.spain"].attribute_scores] == [
        a_criterion().attribute
    ]


class TestWhatTheScoreRestsOn:
    """`reqs.md` 5.7. A low-confidence figure is never discounted in the score, so the ranking
    has to say how much of each score rests on one -- otherwise an estimate and a measurement
    are indistinguishable wherever the two land."""

    def test_the_covered_weight_splits_by_the_confidence_of_what_scored(self) -> None:
        values = three_countries_one_missing_its_rent()
        values["country.portugal"] = (
            values["country.portugal"][0],
            a_value(
                candidate="country.portugal",
                attribute=RENT,
                payload=Count(count=5),
                confidence_level=ConfidenceLevel.LOW,
            ),
        )

        portugal = by_candidate(rank(two_pillars(), values))["country.portugal"]

        assert portugal.coverage_by_confidence[ConfidenceLevel.HIGH] == Decimal(50)
        assert portugal.coverage_by_confidence[ConfidenceLevel.LOW] == Decimal(50)

    def test_a_sparse_candidate_splits_only_what_it_answered(self) -> None:
        spain = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))[
            "country.spain"
        ]

        assert spain.coverage_by_confidence[ConfidenceLevel.HIGH] == Decimal(100)

    def test_a_candidate_with_nothing_scored_has_no_split(self) -> None:
        values = values_for(portugal=90, spain=10)
        values["country.greece"] = ()

        greece = by_candidate(rank(a_set([a_criterion()]), values))["country.greece"]

        assert greece.coverage_by_confidence == {}

    def test_a_figure_that_could_not_be_placed_does_not_count_as_evidence(self) -> None:
        """Found but unscored costs coverage, so it cannot count toward what coverage splits."""
        lonely = {"country.portugal": (a_value(confidence_level=ConfidenceLevel.LOW),)}

        portugal = by_candidate(rank(a_set([a_criterion()]), lonely))["country.portugal"]

        assert portugal.coverage == Decimal(0)
        assert portugal.coverage_by_confidence == {}


class TestATargetRangeCriterion:
    def test_it_scores_by_closeness_to_its_band(self) -> None:
        """Temperature: 14 is in the band, 8 is halfway to the lower zero point."""
        mild = a_criterion(
            goal=Goal.TARGET_RANGE,
            normalisation_method=NormalisationMethod.FIXED,
            target_range_min=Decimal(12),
            target_range_max=Decimal(16),
            zero_score_below=Decimal(4),
            zero_score_above=Decimal(24),
        )

        found = by_candidate(rank(a_set([mild]), values_for(portugal=14, sweden=8), scale=100))

        assert found["country.portugal"].score == 100
        assert found["country.sweden"].score == 50


class TestEachContributionNamesTheValueBehindIt:
    """What closes the provenance chain: a total, down through one contribution, to the stored
    row that produced it -- which a saved evaluation then freezes (`reqs.md` 3.4a)."""

    def test_a_scored_attribute_names_the_value_it_used(self) -> None:
        values = {
            "country.portugal": (a_value(id=41, payload=Count(count=90)),),
            "country.spain": (a_value(candidate="country.spain", id=42, payload=Count(count=10)),),
        }

        portugal = by_candidate(rank(a_set([a_criterion()]), values))["country.portugal"]

        (row,) = portugal.attribute_scores
        assert row.used_value == 41

    def test_an_attribute_with_no_figure_names_none(self) -> None:
        found = by_candidate(rank(two_pillars(), three_countries_one_missing_its_rent()))
        spain = found["country.spain"]

        unanswered = [row for row in spain.attribute_scores if row.normalised_score is None]
        assert [row.used_value for row in unanswered] == [None]

    def test_a_figure_that_could_not_be_placed_names_none(self) -> None:
        """It contributed nothing, so naming the row it came from would suggest otherwise."""
        lonely = {"country.portugal": (a_value(id=7),)}

        portugal = by_candidate(rank(a_set([a_criterion()]), lonely))["country.portugal"]

        (row,) = portugal.attribute_scores
        assert (row.normalised_score, row.used_value) == (None, None)


class TestWhatTheRulesDoToARanking:
    """`reqs.md` 5.4: a candidate that does not match keeps its score and stays visible, with
    the reason beside it. A warning changes nothing at all."""

    @staticmethod
    def a_warning_rule() -> CompoundRule:
        return CompoundRule(
            id="cheap_but_taxed",
            name="Cheap but taxed",
            level="country",
            shape=CompoundRuleShape.ALL_CONDITIONS_HOLD,
            outcome=RuleOutcome.WARNING,
            conditions=(
                CompoundRuleCondition(ordinal=1, attribute=AN_ATTRIBUTE, threshold_min=Decimal(50)),
            ),
        )

    @staticmethod
    def a_disqualifying_rule() -> CompoundRule:
        """The same rule with the outcome that costs something: a country leaves the ranking."""
        return CompoundRule(
            id="cheap_but_taxed",
            name="Cheap but taxed",
            level="country",
            shape=CompoundRuleShape.ALL_CONDITIONS_HOLD,
            outcome=RuleOutcome.NOT_MATCHING,
            conditions=(
                CompoundRuleCondition(ordinal=1, attribute=AN_ATTRIBUTE, threshold_min=Decimal(50)),
            ),
        )

    @staticmethod
    def a_failed_gate(candidate: str) -> MatchRuleResult:
        return MatchRuleResult(
            match_rule="uk_skilled_worker",
            candidate=candidate,
            match_result=MatchResult.NOT_MATCHING,
            data_source="manual",
            retrieval_date=datetime(2026, 9, 12, tzinfo=UTC),
            reason="no sponsor",
        )

    def test_a_warning_flags_without_changing_the_score_or_the_status(self) -> None:
        """**The set has to apply the rule for this to be the question** (P43). It used to pass
        with a set that applied nothing, which is what made the defect invisible: the test read
        as "a warning flags" while asserting "any rule at this level flags".
        """
        applying = a_set([a_criterion()]).model_copy(
            update={"applied_compound_rules": frozenset({"cheap_but_taxed"})}
        )

        found = by_candidate(
            rank(
                applying,
                values_for(portugal=90, spain=10),
                compound_rules=[self.a_warning_rule()],
            )
        )

        portugal = found["country.portugal"]
        assert [str(w.compound_rule) for w in portugal.warnings] == ["cheap_but_taxed"]
        assert portugal.match_status is MatchStatus.MATCHING
        assert portugal.score == found["country.portugal"].score
        assert found["country.spain"].warnings == ()

    def test_a_rule_the_set_does_not_apply_never_fires(self) -> None:
        """**Which compound rules a set applies is a preference** (`reqs.md` 3.7a, P43), on the
        same footing as which gates it enforces -- "whether rent-against-spend concerns you".

        The gate half of this function has always filtered on `enforced_match_rules`. The
        compound half applied whatever the catalog held at the level, so a rule one set opted
        out of still raised warnings in that set's ranking.
        """
        applies_nothing = a_set([a_criterion()])
        assert applies_nothing.applied_compound_rules == frozenset(), "the state under test"

        found = by_candidate(
            rank(
                applies_nothing,
                values_for(portugal=90, spain=10),
                compound_rules=[self.a_warning_rule()],
            )
        )

        assert found["country.portugal"].warnings == ()

    def test_a_rule_the_set_does_not_apply_cannot_rule_a_candidate_out(self) -> None:
        """The half that costs something. A warning nobody asked for is noise; a `not_matching`
        rule nobody asked for removes a country from the ranking."""
        applies_nothing = a_set([a_criterion()])

        found = by_candidate(
            rank(
                applies_nothing,
                values_for(portugal=90, spain=10),
                compound_rules=[self.a_disqualifying_rule()],
            )
        )

        portugal = found["country.portugal"]
        assert portugal.match_status is MatchStatus.MATCHING
        assert portugal.non_match_reasons == ()

    @staticmethod
    def a_rule_reading(attribute: str) -> CompoundRule:
        """A rule over whichever attribute the test names, applied by the set below."""
        return CompoundRule(
            id="cheap_but_taxed",
            name="Cheap but taxed",
            level="country",
            shape=CompoundRuleShape.ALL_CONDITIONS_HOLD,
            outcome=RuleOutcome.NOT_MATCHING,
            conditions=(
                CompoundRuleCondition(ordinal=1, attribute=attribute, threshold_min=Decimal(50)),
            ),
        )

    @staticmethod
    def applying(criteria: object) -> object:
        return criteria.model_copy(  # type: ignore[attr-defined]
            update={"applied_compound_rules": frozenset({"cheap_but_taxed"})}
        )

    @staticmethod
    def two_countries_with_rents(portugal_rent: int | None = 90) -> dict[str, tuple]:
        """Two candidates, because `percentile` needs two figures in a column to place either.
        Portugal alone carries the rent the rule reads, so Spain is the contrast."""
        portugal: tuple = (a_value(payload=Count(count=90)),)
        if portugal_rent is not None:
            portugal += (a_value(attribute=RENT, payload=Count(count=portugal_rent)),)
        return {
            A_CANDIDATE: portugal,
            "country.spain": (a_value(candidate="country.spain", payload=Count(count=10)),),
        }

    def test_a_rule_reads_a_descriptive_attribute(self) -> None:
        """**A rule may read an attribute no criterion judges** (P46).

        `reqs.md` 3.0 has a category for exactly this -- an attribute with no criterion attached
        is descriptive and never scored -- and `european_air_connectivity` is one (Q228). The
        figures a rule could see were built from the *scored* criteria alone, so a rule over a
        descriptive attribute read nothing, and a missing figure never satisfies a condition:
        the rule went silent, with no warning and no refusal to say it had.
        """
        scored_on_something_else = self.applying(a_set([a_criterion()]))

        found = by_candidate(
            rank(
                scored_on_something_else,
                self.two_countries_with_rents(),
                compound_rules=[self.a_rule_reading(RENT)],
            )
        )

        portugal = found[A_CANDIDATE]
        assert portugal.match_status is MatchStatus.NOT_MATCHING
        assert [str(r.compound_rule) for r in portugal.non_match_reasons] == ["cheap_but_taxed"]
        assert found["country.spain"].match_status is MatchStatus.MATCHING

    def test_a_rule_reads_an_attribute_whose_criterion_is_not_scored(self) -> None:
        """Unticking a criterion is a statement about scoring, not about the gates: it said this
        attribute should not count toward the total, not that a rule reading it should stop."""
        excluded = a_criterion(
            attribute=RENT, pillar=HOUSING, weight=Decimal("100"), is_scored=False
        )
        criteria = self.applying(
            a_set(
                [a_criterion(weight=Decimal("100")), excluded],
                [a_pillar_weight(weight="50"), a_pillar_weight(pillar=HOUSING, weight="50")],
            )
        )
        portugal = by_candidate(
            rank(
                criteria,
                self.two_countries_with_rents(),
                compound_rules=[self.a_rule_reading(RENT)],
            )
        )[A_CANDIDATE]

        assert portugal.match_status is MatchStatus.NOT_MATCHING

    def test_a_rule_still_needs_a_figure_to_fire(self) -> None:
        """The control. Reading more widely must not turn an absent figure into a satisfied
        condition -- an unmeasured condition is not a met one."""
        criteria = self.applying(a_set([a_criterion()]))

        portugal = by_candidate(
            rank(
                criteria,
                self.two_countries_with_rents(portugal_rent=None),
                compound_rules=[self.a_rule_reading(RENT)],
            )
        )[A_CANDIDATE]

        assert portugal.match_status is MatchStatus.MATCHING
        assert portugal.non_match_reasons == ()

    def test_a_rule_the_set_applies_fires_as_it_always_did(self) -> None:
        """The control: the filter must narrow what a set applies, not stop rules working."""
        applying = a_set([a_criterion()]).model_copy(
            update={"applied_compound_rules": frozenset({"cheap_but_taxed"})}
        )

        found = by_candidate(
            rank(
                applying,
                values_for(portugal=90, spain=10),
                compound_rules=[self.a_warning_rule()],
            )
        )

        assert [str(w.compound_rule) for w in found["country.portugal"].warnings] == [
            "cheap_but_taxed"
        ]

    def test_a_failed_gate_keeps_the_score_and_loses_the_rank(self) -> None:
        criteria = a_set([a_criterion()])
        enforced = criteria.model_copy(update={"enforced_match_rules": ("uk_skilled_worker",)})

        found = by_candidate(
            rank(
                enforced,
                values_for(portugal=90, spain=10),
                gate_answers={"country.portugal": [self.a_failed_gate("country.portugal")]},
            )
        )

        portugal = found["country.portugal"]
        assert portugal.match_status is MatchStatus.NOT_MATCHING
        assert portugal.score is not None, "a non-matching candidate keeps its score"
        assert portugal.rank is None
        assert portugal.non_match_reasons[0].reason_detail == "no sponsor"

    def test_the_candidate_below_it_takes_the_first_rank(self) -> None:
        """A rank is a position among the candidates still in the running."""
        criteria = a_set([a_criterion()])
        enforced = criteria.model_copy(update={"enforced_match_rules": ("uk_skilled_worker",)})

        found = by_candidate(
            rank(
                enforced,
                values_for(portugal=90, spain=10),
                gate_answers={"country.portugal": [self.a_failed_gate("country.portugal")]},
            )
        )

        assert found["country.spain"].rank == 1

    def test_a_gate_the_set_does_not_enforce_leaves_the_candidate_matching(self) -> None:
        found = by_candidate(
            rank(
                a_set([a_criterion()]),
                values_for(portugal=90, spain=10),
                gate_answers={"country.portugal": [self.a_failed_gate("country.portugal")]},
            )
        )

        assert found["country.portugal"].match_status is MatchStatus.MATCHING
