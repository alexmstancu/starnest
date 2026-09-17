"""The three permitted LLM uses, each against a model that answers what the test says.

`reqs.md` 6.10. What every one of them has in common is the rule worth testing: **an answer that
read nothing is refused, not stored at low confidence.** `low` is the floor for an LLM value, not
a substitute for evidence -- and a model will always produce a plausible answer from memory if
allowed to.
"""

from datetime import date
from decimal import Decimal

import pytest

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    MatchResult,
    MatchRule,
    QuantityParameters,
    RatioParameters,
    ValueType,
)
from starnest.data_sources.llm import (
    LlmEmployersAdapter,
    LlmFallbackAdapter,
    LlmGateResearcher,
)

from .conftest import A_PAGE, ANOTHER_PAGE, a_model, an_answer

COUNTRY = {"id": "country", "depth_order": 1}
PORTUGAL = Candidate(id="country.portugal", name="Portugal", level=COUNTRY, country_code="PT")
SPAIN = Candidate(id="country.spain", name="Spain", level=COUNTRY, country_code="ES")


def employers_attribute() -> Attribute:
    return Attribute(
        id="country.international_employers",
        name="International employers",
        level="country",
        value_type=ValueType.LABEL_SET,
        pillar="career",
    )


def a_count_attribute() -> Attribute:
    return Attribute(
        id="country.universities_ranked",
        name="Universities ranked",
        level="country",
        value_type=ValueType.COUNT,
        pillar="career",
    )


def a_quantity_attribute() -> Attribute:
    return Attribute(
        id="country.average_rent",
        name="Average rent",
        level="country",
        value_type=ValueType.QUANTITY,
        pillar="housing",
        quantity_parameters=QuantityParameters(unit="eur_per_month"),
    )


class TestNamingTheEmployers:
    async def test_the_names_are_stored_as_a_label_set_with_its_sources(self) -> None:
        acquired = await LlmEmployersAdapter(
            a_model(
                an_answer(
                    '{"employers": ["Siemens", "Critical TechWorks"], "note": "both hire in '
                    'English"}',
                    pages=(A_PAGE, ANOTHER_PAGE),
                )
            )
        ).fetch(employers_attribute(), [PORTUGAL])

        (value,) = acquired.values
        assert value.payload is not None
        assert value.payload.labels == ("Siemens", "Critical TechWorks")
        assert value.citations == (A_PAGE, ANOTHER_PAGE)
        assert value.confidence_level is ConfidenceLevel.LOW

    async def test_it_costs_what_the_calls_cost_and_says_how_many(self) -> None:
        """The run accumulates this against the cap, so an adapter that under-reported would make
        the cap ornamental."""
        acquired = await LlmEmployersAdapter(
            a_model(
                an_answer('{"employers": ["A"]}', input_tokens=1_000_000, output_tokens=0),
                an_answer('{"employers": ["B"]}', input_tokens=1_000_000, output_tokens=0),
            )
        ).fetch(employers_attribute(), [PORTUGAL, SPAIN])

        assert acquired.calls == 2
        assert acquired.cost_eur == Decimal("2.0200")

    async def test_an_answer_that_read_nothing_is_refused(self) -> None:
        acquired = await LlmEmployersAdapter(
            a_model(an_answer('{"employers": ["From memory Ltd"]}', pages=()))
        ).fetch(employers_attribute(), [PORTUGAL])

        assert acquired.values == ()
        (failure,) = acquired.failures
        assert "without reading anything" in failure.reason

    async def test_an_answer_naming_nobody_is_a_gap_with_a_reason(self) -> None:
        acquired = await LlmEmployersAdapter(
            a_model(an_answer('{"employers": [], "note": "found no international firm"}'))
        ).fetch(employers_attribute(), [PORTUGAL])

        assert acquired.values == ()
        assert "found no international firm" in acquired.failures[0].reason

    async def test_a_reply_that_is_not_json_is_a_failure_rather_than_a_crash(self) -> None:
        acquired = await LlmEmployersAdapter(
            a_model(an_answer("Sure! Here are some employers: Siemens, SAP."))
        ).fetch(employers_attribute(), [PORTUGAL])

        assert "not the JSON object" in acquired.failures[0].reason

    async def test_a_firm_named_twice_costs_the_duplicate_and_not_the_answer(self) -> None:
        """`LabelSet` refuses a repeat, and losing the whole answer to it would be worse."""
        acquired = await LlmEmployersAdapter(
            a_model(an_answer('{"employers": ["Siemens", "Siemens", "SAP"]}'))
        ).fetch(employers_attribute(), [PORTUGAL])

        assert acquired.values[0].payload.labels == ("Siemens", "SAP")  # type: ignore[union-attr]

    async def test_it_answers_only_its_own_attribute(self) -> None:
        acquired = await LlmEmployersAdapter(a_model()).fetch(a_quantity_attribute(), [PORTUGAL])

        assert "answers only" in acquired.failures[0].reason


class TestTheFallbackFigure:
    async def test_a_figure_is_shaped_by_the_catalog_and_not_by_the_answer(self) -> None:
        """The unit comes from the attribute. A figure in the wrong unit is the one kind of wrong
        answer that looks entirely reasonable."""
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 1180.5, "period": "2025", "note": "INE, 2025"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        (value,) = acquired.values
        assert value.payload is not None
        assert value.payload.magnitude == Decimal("1180.5")
        assert value.payload.unit == "eur_per_month"
        assert value.confidence_level is ConfidenceLevel.LOW

    async def test_the_period_is_the_one_the_publisher_chose_not_the_day_it_was_asked(
        self,
    ) -> None:
        """`reqs.md` 3.6: the reference period is what the figure describes, and it is never the
        retrieval date. **This used to be today, whatever the model said** (`known-issues.md`
        P37) -- which made every LLM figure permanently fresh, and `is_fresh` is the first term
        of the active-value order, so a figure the model dated as today could outrank a
        published figure that had honestly aged. That is the reverse of 6.10's "any structured
        source that can answer supersedes it automatically"."""
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 61.4, "period": "2019", "note": "RSF 2019"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        (value,) = acquired.values
        assert value.reference_period.start == date(2019, 1, 1)
        assert value.reference_period.end == date(2019, 12, 31)
        assert value.reference_period.end < value.retrieval_date.date()

    async def test_a_range_of_years_is_kept_as_the_range(self) -> None:
        """A survey run over two years describes both, and collapsing it to either would move
        the date the freshness rule counts from."""
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 7.5, "period": "2023-2024"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        (value,) = acquired.values
        assert value.reference_period.start == date(2023, 1, 1)
        assert value.reference_period.end == date(2024, 12, 31)

    async def test_a_figure_with_no_period_is_refused_rather_than_dated_today(self) -> None:
        """A figure whose year is unknown cannot be judged for freshness, and stamping today on
        it is the fabrication P37 was. A gap with a reason is the honest answer."""
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 61.4, "note": "RSF"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        assert acquired.values == ()
        assert "period" in acquired.failures[0].reason

    async def test_a_period_in_prose_is_refused_rather_than_guessed(self) -> None:
        """The prompt asks for four digits or a range. Fishing a year out of a sentence is the
        guess this module exists not to make -- "the 2026 edition" may describe 2025."""
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 61.4, "period": "the 2026 edition"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        assert acquired.values == ()
        assert "the 2026 edition" in acquired.failures[0].reason

    async def test_a_period_that_has_not_happened_yet_is_refused(self) -> None:
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 61.4, "period": "2999"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        assert acquired.values == ()
        assert "period" in acquired.failures[0].reason

    async def test_the_unit_is_named_in_the_prompt(self) -> None:
        model = a_model(an_answer('{"value": 1}'))
        await LlmFallbackAdapter(model, answers=("country.average_rent",)).fetch(
            a_quantity_attribute(), [PORTUGAL]
        )

        assert "eur_per_month" in model._messages.asked[0]["messages"][0]["content"]

    async def test_a_null_value_is_a_gap_with_the_models_reason(self) -> None:
        """Asked for, in the prompt: report that you found nothing rather than estimating."""
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": null, "note": "nobody publishes this"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        assert acquired.values == ()
        assert "nobody publishes this" in acquired.failures[0].reason

    async def test_a_value_that_is_not_a_number_is_refused(self) -> None:
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": "about a thousand"}')),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        assert "not a number" in acquired.failures[0].reason

    async def test_an_ungrounded_figure_is_refused(self) -> None:
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 1200}', pages=())),
            answers=("country.average_rent",),
        ).fetch(a_quantity_attribute(), [PORTUGAL])

        assert "no source" in acquired.failures[0].reason

    async def test_a_type_that_carries_no_magnitude_is_never_asked_about(self) -> None:
        """A Köppen zone is not something to ask a model for a number about (`reqs.md` 3.3a)."""
        acquired = await LlmFallbackAdapter(
            a_model(), answers=("country.international_employers",)
        ).fetch(employers_attribute(), [PORTUGAL])

        assert acquired.values == ()
        assert "carries no magnitude" in acquired.failures[0].reason

    async def test_a_ratio_is_shaped_with_the_catalogs_basis(self) -> None:
        overburden = Attribute(
            id="country.housing_cost_overburden_rate",
            name="Housing cost overburden",
            level="country",
            value_type=ValueType.RATIO,
            pillar="housing",
            ratio_parameters=RatioParameters(basis="households"),
        )

        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 7.5, "period": "2024"}')), answers=(str(overburden.id),)
        ).fetch(overburden, [PORTUGAL])

        assert acquired.values[0].payload.basis == "households"  # type: ignore[union-attr]

    async def test_a_count_that_is_not_whole_is_refused_rather_than_truncated(self) -> None:
        """**A count is a whole number or it is a mistake** (P50).

        `int(figure)` truncated 12.7 to 12 and stored it at low confidence with a quote and
        citations, so a figure nobody could have published read exactly like one somebody had.
        The Eurostat adapter already refuses this for the same type, in the same words: quietly
        rounding hides the fault behind a plausible integer.
        """
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 12.7, "period": "2025"}')),
            answers=(str(a_count_attribute().id),),
        ).fetch(a_count_attribute(), [PORTUGAL])

        assert acquired.values == ()
        assert "12.7" in acquired.failures[0].reason
        assert "whole" in acquired.failures[0].reason

    async def test_a_whole_count_is_stored(self) -> None:
        """The control: the guard must refuse a fraction, not refuse counting."""
        acquired = await LlmFallbackAdapter(
            a_model(an_answer('{"value": 12, "period": "2025"}')),
            answers=(str(a_count_attribute().id),),
        ).fetch(a_count_attribute(), [PORTUGAL])

        assert acquired.values[0].payload.count == 12  # type: ignore[union-attr]


class TestResearchingAGate:
    def a_gate(self) -> MatchRule:
        return MatchRule(id="uk_skilled_worker", name="UK Skilled Worker route", level="country")

    async def test_it_reports_what_the_official_page_said_and_the_page(self) -> None:
        found = await LlmGateResearcher(
            a_model(
                an_answer('{"answer": "matching", "reason": "The route is open to this passport."}')
            )
        ).research(rule=self.a_gate(), candidate=PORTUGAL, citizenships=["country.romania"])

        assert found.match_result is MatchResult.MATCHING
        assert "route is open" in found.reason
        assert found.citations == (A_PAGE,)

    async def test_the_citizenships_are_in_the_question_because_they_decide_it(self) -> None:
        model = a_model(an_answer('{"answer": "unknown", "reason": "x"}'))
        await LlmGateResearcher(model).research(
            rule=self.a_gate(), candidate=PORTUGAL, citizenships=["country.romania"]
        )

        assert "country.romania" in model._messages.asked[0]["messages"][0]["content"]

    @pytest.mark.parametrize(
        "said,expected",
        [
            ("matching", MatchResult.MATCHING),
            ("not_matching", MatchResult.NOT_MATCHING),
            ("unknown", MatchResult.UNKNOWN),
            ("probably", MatchResult.UNKNOWN),
            ("", MatchResult.UNKNOWN),
        ],
    )
    async def test_anything_outside_the_vocabulary_is_unknown(
        self, said: str, expected: MatchResult
    ) -> None:
        """The vocabulary has three members, and inventing a reading of a fourth word would be
        this module deciding what the model meant."""
        found = await LlmGateResearcher(
            a_model(an_answer(f'{{"answer": "{said}", "reason": "r"}}'))
        ).research(rule=self.a_gate(), candidate=PORTUGAL, citizenships=[])

        assert found.match_result is expected

    async def test_a_model_that_cannot_be_reached_answers_unknown_with_the_reason(self) -> None:
        """A gate nobody could research is exactly what `unknown` means (`reqs.md` 3.7)."""
        found = await LlmGateResearcher(a_model(RuntimeError("429 rate limited"))).research(
            rule=self.a_gate(), candidate=PORTUGAL, citizenships=[]
        )

        assert found.match_result is MatchResult.UNKNOWN
        assert "429" in found.reason
        assert found.citations == ()

    async def test_an_unreadable_reply_answers_unknown_and_still_reports_the_cost(self) -> None:
        """The provider charged for it whatever this application made of it."""
        found = await LlmGateResearcher(
            a_model(an_answer("I think it is open.", input_tokens=1_000_000, output_tokens=0))
        ).research(rule=self.a_gate(), candidate=PORTUGAL, citizenships=[])

        assert found.match_result is MatchResult.UNKNOWN
        assert found.cost_eur > Decimal(0)
