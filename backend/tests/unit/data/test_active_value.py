"""The five ordering rules of `arch.md` 4, one test each, in the order the view applies them.

The point of this file is that the rule can be checked against the `active_value` view later:
same values in, same winner out. Every test below is therefore written as a comparison between
competing values rather than as an assertion about one.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from starnest.data import (
    Attribute,
    ConfidenceLevel,
    DataSource,
    MismatchedAttributeError,
    Monetary,
    ReferencePeriod,
    SourceKind,
    SourcePriority,
    SourcePriorityOverride,
    Value,
    ValueType,
    select_active_value,
    select_active_values,
)


def fresh_unless(*stale: Value):
    """The view's `is_fresh`, said outright: every value fresh but the ones named."""
    return lambda value: all(value is not each for each in stale)


EVERYTHING_FRESH = fresh_unless()

EUROSTAT = DataSource(
    id="eurostat",
    name="Eurostat",
    source_kind=SourceKind.STRUCTURED,
    default_priority=10,
    reliability_tier="official_international",
)
NUMBEO = DataSource(
    id="numbeo",
    name="Numbeo",
    source_kind=SourceKind.STRUCTURED,
    default_priority=60,
    reliability_tier="crowdsourced",
)
MANUAL = DataSource(
    id="manual",
    name="Manual entry",
    source_kind=SourceKind.MANUAL,
    default_priority=90,
    reliability_tier="manual",
)
CATALOG = (EUROSTAT, NUMBEO, MANUAL)
GLOBAL_ORDER = SourcePriority.global_order(CATALOG)

RENT = Attribute(
    id="country.rent_centre",
    name="Rent, city centre",
    level="country",
    value_type=ValueType.MONETARY,
    pillar="housing",
    max_age=timedelta(days=365),
)


def a_value(**overrides: object) -> Value:
    fields: dict[str, object] = {
        "candidate": "country.portugal",
        "attribute": "country.rent_centre",
        "value_type": ValueType.MONETARY,
        "data_source": "numbeo",
        "reference_period": ReferencePeriod.covering_year(2026),
        "retrieval_date": datetime(2026, 8, 1, tzinfo=UTC),
        "confidence_level": ConfidenceLevel.MEDIUM,
        "payload": Monetary.in_euro(Decimal("1410")),
    }
    return Value(**(fields | overrides))


def chosen(
    *values: Value, priority: SourcePriority = GLOBAL_ORDER, stale: tuple[Value, ...] = ()
) -> Value | None:
    return select_active_value(
        values, attribute=RENT, priority=priority, is_fresh=fresh_unless(*stale)
    )


class TestRuleOneAValueFromASwitchedOffSourceNeverCompetes:
    """The view's rule 1a, which the Python rule did not have (P87).

    `active_value` requires `source_is_enabled`; `select_active_value` kept every unrejected
    value. The module's stated contract with the SQL is "same inputs, same winner", and with a
    switched-off source holding the top-priority figure the two named different ones.
    """

    def test_the_top_source_switched_off_passes_to_the_next(self) -> None:
        switched_off = SourcePriority.global_order(
            (EUROSTAT.model_copy(update={"is_enabled": False}), NUMBEO, MANUAL)
        )
        from_eurostat = a_value(data_source="eurostat")
        from_numbeo = a_value(data_source="numbeo")

        assert chosen(from_eurostat, from_numbeo, priority=switched_off) is from_numbeo

    def test_it_is_the_last_one_standing_rather_than_a_fallback(self) -> None:
        """Nothing is substituted: with every source off there is no active value at all,
        which is the honest answer and the same one the view gives."""
        all_off = SourcePriority.global_order(
            tuple(source.model_copy(update={"is_enabled": False}) for source in CATALOG)
        )

        assert chosen(a_value(data_source="eurostat"), priority=all_off) is None

    def test_a_switched_on_source_is_unaffected(self) -> None:
        """The other half, so the rule cannot be "nothing ever wins"."""
        assert chosen(a_value(data_source="eurostat")) is not None

    def test_the_value_is_not_discarded_only_beaten(self) -> None:
        """A switched-off source keeps every figure it ever stored -- the switch decides what
        scores, never what is kept (`reqs.md` 6.6, Q232)."""
        switched_off = SourcePriority.global_order(
            (EUROSTAT.model_copy(update={"is_enabled": False}), NUMBEO, MANUAL)
        )
        from_eurostat = a_value(data_source="eurostat")

        assert from_eurostat.is_rejected is False
        assert chosen(from_eurostat, priority=switched_off) is None


class TestRuleOneRejectedValuesNeverCompete:
    def test_a_rejected_value_loses_to_a_worse_but_credible_one(self) -> None:
        rejected = a_value(data_source="eurostat", rejection_reason="45000 is not a rent")
        accepted = a_value(data_source="manual")
        assert chosen(rejected, accepted) is accepted

    def test_when_every_value_was_rejected_there_is_no_active_value(self) -> None:
        """Which is what `insufficient_data` is made of. Nothing is substituted."""
        assert chosen(a_value(rejection_reason="not credible")) is None

    def test_no_values_at_all_is_the_same_answer(self) -> None:
        assert chosen() is None


class TestRuleTwoFreshBeatsStale:
    """Which values are fresh is the view's answer, given here as an input (PL-064, D20)."""

    def test_a_fresh_crowdsourced_figure_beats_a_stale_official_one(self) -> None:
        """Whatever the source's rank -- this is the rule that outranks source priority."""
        stale = a_value(data_source="eurostat")
        fresh = a_value(data_source="numbeo")
        assert chosen(stale, fresh, stale=(stale,)) is fresh

    def test_a_stale_value_still_wins_when_it_is_the_last_one_standing(self) -> None:
        stale = a_value()
        assert chosen(stale, stale=(stale,)) is stale

    def test_the_same_pair_goes_by_source_once_both_are_fresh(self) -> None:
        """The control the first test needs: freshness, not the order given, decided it."""
        official = a_value(data_source="eurostat")
        crowdsourced = a_value(data_source="numbeo")
        assert chosen(official, crowdsourced) is official

    def test_the_period_is_never_recounted(self) -> None:
        """A figure from 1900 that the caller calls fresh is fresh: no day count overrides the
        view, which is the disagreement a month-end used to expose."""
        ancient = a_value(reference_period=ReferencePeriod.covering_year(1900), id=2)
        current = a_value(id=1)
        assert chosen(ancient, current) is ancient


class TestRuleThreeSourcePriority:
    def test_the_higher_ranked_source_wins_among_fresh_values(self) -> None:
        official = a_value(data_source="eurostat")
        crowdsourced = a_value(data_source="numbeo")
        assert chosen(official, crowdsourced) is official

    def test_an_attribute_override_reverses_it(self) -> None:
        """Numbeo beats national statistics for rent, which no official source publishes."""
        promoted = RENT.model_copy(
            update={
                "source_priority_overrides": (SourcePriorityOverride(data_source="numbeo", rank=1),)
            }
        )
        official = a_value(data_source="eurostat")
        crowdsourced = a_value(data_source="numbeo")
        assert (
            chosen(official, crowdsourced, priority=promoted.effective_source_priority(CATALOG))
            is crowdsourced
        )

    def test_manual_entry_is_superseded_the_moment_a_real_source_arrives(self) -> None:
        typed = a_value(data_source="manual", confidence_level=ConfidenceLevel.HIGH)
        fetched = a_value(data_source="numbeo", confidence_level=ConfidenceLevel.LOW)
        assert chosen(typed, fetched) is fetched


class TestRuleFourConfidenceBreaksTiesWithinARank:
    def test_the_better_graded_figure_wins(self) -> None:
        weaker = a_value(confidence_level=ConfidenceLevel.LOW)
        stronger = a_value(confidence_level=ConfidenceLevel.HIGH)
        assert chosen(weaker, stronger) is stronger

    def test_confidence_never_outranks_source_priority(self) -> None:
        """Priority is a standing judgement; confidence grades one number. Neither subsumes
        the other, and the order between them is what says so."""
        crowdsourced = a_value(data_source="numbeo", confidence_level=ConfidenceLevel.ABSOLUTE)
        official = a_value(data_source="eurostat", confidence_level=ConfidenceLevel.LOW)
        assert chosen(crowdsourced, official) is official


class TestRuleFiveRecency:
    def test_the_most_recently_retrieved_wins_anything_remaining(self) -> None:
        older = a_value(retrieval_date=datetime(2026, 7, 1, tzinfo=UTC))
        newer = a_value(retrieval_date=datetime(2026, 8, 1, tzinfo=UTC))
        assert chosen(older, newer) is newer

    def test_the_last_written_row_wins_a_dead_heat(self) -> None:
        """The view ends with `id DESC` for exactly this case: two identical retrievals."""
        first = a_value(id=9001)
        second = a_value(id=9002)
        assert chosen(first, second) is second

    def test_two_values_that_were_never_stored_are_settled_by_the_order_given(self) -> None:
        """**The one key the SQL view cannot express, and the only place the two can differ.**

        An unsaved value has no id, and this module maps that to 0, so two of them tie on every
        rule and `min` keeps whichever came first. In production the question never arises --
        the view ranks rows, and a row has an id -- but this module exists to be checked against
        the view, and an untested tie is where a silent disagreement would hide.
        """
        first = a_value(id=None)
        second = a_value(id=None)

        assert chosen(first, second) is first
        assert chosen(second, first) is second

    def test_a_stored_value_outranks_one_that_was_never_stored(self) -> None:
        """Between a row and something not yet written, the row is the figure that exists."""
        unsaved = a_value(id=None)
        stored = a_value(id=1)

        assert chosen(unsaved, stored) is stored


class TestSelectingForEveryCandidateAndOption:
    def test_each_candidate_gets_its_own_active_value(self) -> None:
        lisbon = a_value(candidate="country.portugal", data_source="eurostat")
        madrid = a_value(candidate="country.spain", data_source="numbeo")
        active = select_active_values(
            [lisbon, madrid], attribute=RENT, priority=GLOBAL_ORDER, is_fresh=EVERYTHING_FRESH
        )
        assert active == {
            ("country.portugal", None): lisbon,
            ("country.spain", None): madrid,
        }

    def test_a_broken_down_attribute_has_one_active_value_per_option(self) -> None:
        """The one-bedroom and two-bedroom rents are both current; neither supersedes the
        other, and which one a score uses is a criterion's choice made later."""
        one_bed = a_value(breakdown_option="one_bedroom", payload=Monetary.in_euro(Decimal("1100")))
        two_bed = a_value(breakdown_option="two_bedroom", payload=Monetary.in_euro(Decimal("1410")))
        superseded = a_value(
            breakdown_option="two_bedroom",
            data_source="manual",
            payload=Monetary.in_euro(Decimal("1200")),
        )
        active = select_active_values(
            [one_bed, two_bed, superseded],
            attribute=RENT,
            priority=GLOBAL_ORDER,
            is_fresh=EVERYTHING_FRESH,
        )
        assert active == {
            ("country.portugal", "one_bedroom"): one_bed,
            ("country.portugal", "two_bedroom"): two_bed,
        }

    def test_a_candidate_whose_every_value_was_rejected_appears_nowhere(self) -> None:
        rejected = a_value(candidate="country.spain", rejection_reason="not credible")
        kept = a_value(candidate="country.portugal")
        active = select_active_values(
            [rejected, kept], attribute=RENT, priority=GLOBAL_ORDER, is_fresh=EVERYTHING_FRESH
        )
        assert list(active) == [("country.portugal", None)]

    def test_nothing_in_gives_nothing_out(self) -> None:
        assert (
            select_active_values(
                [], attribute=RENT, priority=GLOBAL_ORDER, is_fresh=EVERYTHING_FRESH
            )
            == {}
        )


class TestTheGuard:
    def test_refuses_to_rank_another_attribute_by_this_attribute_s_rules(self) -> None:
        """Freshness and priority are both read from the attribute, so mixing them would
        silently apply the wrong `max_age` and the wrong override."""
        with pytest.raises(MismatchedAttributeError):
            chosen(a_value(attribute="country.cost_of_living_index"))
