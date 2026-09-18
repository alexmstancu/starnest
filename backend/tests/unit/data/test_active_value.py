"""The five ordering rules of `arch.md` 4, one test each, in the order the view applies them.

The point of this file is that the rule can be checked against the `active_value` view later:
same values in, same winner out. Every test below is therefore written as a comparison between
competing values rather than as an assertion about one.
"""

from datetime import UTC, date, datetime, timedelta
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

TODAY = date(2026, 8, 19)

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


def chosen(*values: Value, priority: SourcePriority = GLOBAL_ORDER) -> Value | None:
    return select_active_value(values, attribute=RENT, priority=priority, on=TODAY)


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
    def test_a_fresh_crowdsourced_figure_beats_a_stale_official_one(self) -> None:
        """Whatever the source's rank -- this is the rule that outranks source priority."""
        stale = a_value(
            data_source="eurostat", reference_period=ReferencePeriod.covering_year(2019)
        )
        fresh = a_value(data_source="numbeo")
        assert chosen(stale, fresh) is fresh

    def test_a_stale_value_still_wins_when_it_is_the_last_one_standing(self) -> None:
        stale = a_value(reference_period=ReferencePeriod.covering_year(2019))
        assert chosen(stale) is stale

    def test_an_attribute_with_no_max_age_has_no_stale_values(self) -> None:
        ageless = RENT.model_copy(update={"max_age": None})
        old = a_value(data_source="numbeo", reference_period=ReferencePeriod.covering_year(1900))
        recent = a_value(data_source="manual")
        assert (
            select_active_value([old, recent], attribute=ageless, priority=GLOBAL_ORDER, on=TODAY)
            is old
        )


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
            [lisbon, madrid], attribute=RENT, priority=GLOBAL_ORDER, on=TODAY
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
            [one_bed, two_bed, superseded], attribute=RENT, priority=GLOBAL_ORDER, on=TODAY
        )
        assert active == {
            ("country.portugal", "one_bedroom"): one_bed,
            ("country.portugal", "two_bedroom"): two_bed,
        }

    def test_a_candidate_whose_every_value_was_rejected_appears_nowhere(self) -> None:
        rejected = a_value(candidate="country.spain", rejection_reason="not credible")
        kept = a_value(candidate="country.portugal")
        active = select_active_values(
            [rejected, kept], attribute=RENT, priority=GLOBAL_ORDER, on=TODAY
        )
        assert list(active) == [("country.portugal", None)]

    def test_nothing_in_gives_nothing_out(self) -> None:
        assert select_active_values([], attribute=RENT, priority=GLOBAL_ORDER, on=TODAY) == {}


class TestTheGuard:
    def test_refuses_to_rank_another_attribute_by_this_attribute_s_rules(self) -> None:
        """Freshness and priority are both read from the attribute, so mixing them would
        silently apply the wrong `max_age` and the wrong override."""
        with pytest.raises(MismatchedAttributeError):
            chosen(a_value(attribute="country.cost_of_living_index"))
