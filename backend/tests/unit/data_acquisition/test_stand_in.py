"""A neighbour's figure standing in, visibly: `reqs.md` Q195 and Q208.

Liechtenstein is covered by none of the pan-European sources for three blocking attributes, and
Switzerland's figure is the least-bad answer. What these tests hold is the word *visibly*: the
copy is never stored as a measurement of Liechtenstein, and a reader of the value can see whose
figure it is and why.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from starnest.candidates import Candidate
from starnest.data import (
    Attribute,
    ConfidenceLevel,
    MalformedStandInError,
    Quantity,
    QuantityParameters,
    ReferencePeriod,
    StandIn,
    Value,
    ValueType,
)
from starnest.data_acquisition import STAND_IN, figures_standing_in, stand_in

COUNTRY = {"id": "country", "depth_order": 1}
PRICES = "country.cost_of_living_index"
TAX = "country.total_tax_rate_effective"
LIECHTENSTEIN = Candidate(
    id="country.liechtenstein", name="Liechtenstein", level=COUNTRY, country_code="LI"
)
SWITZERLAND = Candidate(
    id="country.switzerland", name="Switzerland", level=COUNTRY, country_code="CH"
)
GERMANY = Candidate(id="country.germany", name="Germany", level=COUNTRY, country_code="DE")
NOW = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)
FETCHED_EARLIER = datetime(2026, 9, 10, 8, 0, tzinfo=UTC)
A_YEAR = ReferencePeriod(start=date(2024, 1, 1), end=date(2024, 12, 31))
BECAUSE = "Eurostat does not survey Liechtenstein's prices."


def a_declaration(attribute: str = PRICES, reason: str = BECAUSE) -> StandIn:
    return StandIn(
        candidate="country.liechtenstein",
        candidate_name="Liechtenstein",
        attribute=attribute,
        substitute="country.switzerland",
        substitute_name="Switzerland",
        reason=reason,
    )


def an_attribute(identifier: str = PRICES) -> Attribute:
    return Attribute(
        id=identifier,
        name=identifier,
        level="country",
        value_type=ValueType.QUANTITY,
        pillar="economics",
        quantity_parameters=QuantityParameters(unit="index_eu27_100"),
    )


def a_swiss_figure(
    *,
    attribute: str = PRICES,
    data_source: str = "eurostat",
    candidate: str = "country.switzerland",
    quote: str | None = "Eurostat 2024: 172.4",
    rejection_reason: str | None = None,
) -> Value:
    return Value(
        id=41,
        candidate=candidate,
        attribute=attribute,
        value_type=ValueType.QUANTITY,
        data_source=data_source,
        reference_period=A_YEAR,
        retrieval_date=FETCHED_EARLIER,
        confidence_level=ConfidenceLevel.HIGH,
        payload=Quantity(magnitude=Decimal("172.4"), unit="index_eu27_100"),
        quote=quote,
        citations=("https://ec.europa.eu/eurostat/databrowser/view/tec00120",),
        data_acquisition_run=7,
        rejection_reason=rejection_reason,
    )


def the_one_borrowed(**figure_overrides: object) -> Value:
    acquired = figures_standing_in(
        (a_declaration(),), (a_swiss_figure(**figure_overrides),), retrieved_at=NOW
    )
    (borrowed,) = acquired.values
    return borrowed


class TestWhatABorrowedFigureSays:
    def test_it_is_about_the_candidate_that_had_none(self) -> None:
        assert the_one_borrowed().candidate == "country.liechtenstein"

    def test_it_is_stored_under_the_stand_in_source_not_the_publisher(self) -> None:
        """Stored as Eurostat's it would rank as Eurostat and read as Eurostat having measured
        Liechtenstein -- fabrication with the paperwork filled in."""
        assert the_one_borrowed().data_source == STAND_IN

    def test_it_is_low_confidence_whatever_the_original_was(self) -> None:
        """The original is `high`. A different place's figure is inferred, not measured."""
        assert the_one_borrowed().confidence_level is ConfidenceLevel.LOW

    def test_the_figure_and_its_period_are_the_originals(self) -> None:
        borrowed = the_one_borrowed()

        assert borrowed.payload == Quantity(magnitude=Decimal("172.4"), unit="index_eu27_100")
        assert borrowed.reference_period == A_YEAR

    def test_the_retrieval_date_is_when_the_copy_was_made(self) -> None:
        assert the_one_borrowed().retrieval_date == NOW

    def test_the_quote_names_whose_figure_it_is_and_why(self) -> None:
        quote = the_one_borrowed().quote or ""

        assert quote.startswith("Switzerland's figure, standing in for Liechtenstein.")
        assert BECAUSE in quote

    def test_the_quote_keeps_the_original_as_its_publisher_issued_it(self) -> None:
        """The original quote names the series and the publisher, which is the "which Swiss
        series" half of the provenance."""
        quote = the_one_borrowed().quote or ""

        assert quote.endswith("As published for Switzerland: Eurostat 2024: 172.4")

    def test_an_original_with_no_quote_leaves_no_dangling_sentence(self) -> None:
        quote = the_one_borrowed(quote=None).quote or ""

        assert quote.endswith(BECAUSE)
        assert "As published" not in quote

    def test_the_pages_behind_the_original_travel_with_it(self) -> None:
        assert the_one_borrowed().citations == (
            "https://ec.europa.eu/eurostat/databrowser/view/tec00120",
        )

    def test_it_is_a_new_value_carrying_no_identifier_or_run_of_the_original(self) -> None:
        borrowed = the_one_borrowed()

        assert borrowed.id is None
        assert borrowed.data_acquisition_run is None


class TestWhatCannotBeBorrowed:
    def test_a_substitute_with_no_figure_is_a_failure_naming_both_places(self) -> None:
        acquired = figures_standing_in((a_declaration(),), (), retrieved_at=NOW)

        assert acquired.values == ()
        (failure,) = acquired.failures
        assert failure.candidate == "country.liechtenstein"
        assert failure.attribute == PRICES
        assert "Switzerland" in failure.reason
        assert "Liechtenstein" in failure.reason

    def test_a_figure_that_is_itself_a_stand_in_is_not_lent_on(self) -> None:
        """A chain would put a third country's number on screen under the second one's name."""
        acquired = figures_standing_in(
            (a_declaration(),), (a_swiss_figure(data_source=STAND_IN),), retrieved_at=NOW
        )

        assert acquired.values == ()
        assert len(acquired.failures) == 1

    def test_a_rejected_figure_is_not_lent(self) -> None:
        acquired = figures_standing_in(
            (a_declaration(),),
            (a_swiss_figure(rejection_reason="outside the attribute's range"),),
            retrieved_at=NOW,
        )

        assert acquired.values == ()

    def test_another_attributes_figure_is_not_lent(self) -> None:
        acquired = figures_standing_in(
            (a_declaration(attribute=TAX),), (a_swiss_figure(attribute=PRICES),), retrieved_at=NOW
        )

        assert acquired.values == ()

    def test_another_countrys_figure_is_not_lent(self) -> None:
        acquired = figures_standing_in(
            (a_declaration(),), (a_swiss_figure(candidate="country.germany"),), retrieved_at=NOW
        )

        assert acquired.values == ()


class TestADeclaration:
    def test_a_candidate_cannot_stand_in_for_itself(self) -> None:
        with pytest.raises(ValidationError, match="itself") as raised:
            StandIn(
                candidate="country.switzerland",
                candidate_name="Switzerland",
                attribute=PRICES,
                substitute="country.switzerland",
                substitute_name="Switzerland",
                reason=BECAUSE,
            )

        assert isinstance(raised.value.errors()[0]["ctx"]["error"], MalformedStandInError)

    @pytest.mark.parametrize("reason", ["", "   "])
    def test_a_stand_in_must_say_why(self, reason: str) -> None:
        with pytest.raises(ValidationError, match="must say why") as raised:
            a_declaration(reason=reason)

        assert isinstance(raised.value.errors()[0]["ctx"]["error"], MalformedStandInError)


class ActiveFiguresOnly:
    """Just enough `ValueStore`: the active figures it holds, and what was appended."""

    def __init__(self, active: tuple[Value, ...]) -> None:
        self._active = active
        self.asked: dict[str, list[str]] = {}
        self.appended: list[Value] = []

    async def read_active_values(self, *, level=None, candidates=(), attributes=()):
        self.asked = {"candidates": list(candidates), "attributes": list(attributes)}
        return tuple(
            figure
            for figure in self._active
            if figure.candidate in candidates and figure.attribute in attributes
        )

    async def append(self, values):
        self.appended.extend(values)
        return tuple(values)


class TestTheRunStep:
    async def test_it_asks_for_the_substitutes_figures_not_the_candidates(self) -> None:
        store = ActiveFiguresOnly((a_swiss_figure(),))

        await stand_in(
            stand_ins=(a_declaration(),),
            attributes=(an_attribute(),),
            candidates=(LIECHTENSTEIN,),
            values=store,  # type: ignore[arg-type]
        )

        assert store.asked == {"candidates": ["country.switzerland"], "attributes": [PRICES]}

    async def test_the_copies_are_appended_carrying_the_run(self) -> None:
        store = ActiveFiguresOnly((a_swiss_figure(),))

        outcome = await stand_in(
            stand_ins=(a_declaration(),),
            attributes=(an_attribute(),),
            candidates=(LIECHTENSTEIN,),
            values=store,  # type: ignore[arg-type]
            run=12,
            retrieved_at=NOW,
        )

        (appended,) = store.appended
        assert appended.data_acquisition_run == 12
        assert appended.candidate == "country.liechtenstein"
        assert outcome.stored == (appended,)

    async def test_the_substitute_need_not_be_in_the_runs_scope(self) -> None:
        """A run narrowed to Liechtenstein still borrows Switzerland's stored figure."""
        store = ActiveFiguresOnly((a_swiss_figure(),))

        outcome = await stand_in(
            stand_ins=(a_declaration(),),
            attributes=(an_attribute(),),
            candidates=(LIECHTENSTEIN,),
            values=store,  # type: ignore[arg-type]
        )

        assert len(outcome.stored) == 1

    async def test_a_run_that_does_not_include_the_candidate_borrows_nothing(self) -> None:
        """A run narrowed to Germany has no business writing anything for Liechtenstein."""
        store = ActiveFiguresOnly((a_swiss_figure(),))

        outcome = await stand_in(
            stand_ins=(a_declaration(),),
            attributes=(an_attribute(),),
            candidates=(GERMANY, SWITZERLAND),
            values=store,  # type: ignore[arg-type]
        )

        assert outcome.stored == ()
        assert store.appended == []
        assert store.asked == {}

    async def test_a_run_that_does_not_include_the_attribute_borrows_nothing(self) -> None:
        store = ActiveFiguresOnly((a_swiss_figure(),))

        outcome = await stand_in(
            stand_ins=(a_declaration(),),
            attributes=(an_attribute(TAX),),
            candidates=(LIECHTENSTEIN,),
            values=store,  # type: ignore[arg-type]
        )

        assert outcome.stored == ()

    async def test_a_missing_substitute_figure_is_reported_and_nothing_is_appended(self) -> None:
        store = ActiveFiguresOnly(())

        outcome = await stand_in(
            stand_ins=(a_declaration(),),
            attributes=(an_attribute(),),
            candidates=(LIECHTENSTEIN,),
            values=store,  # type: ignore[arg-type]
        )

        assert store.appended == []
        assert len(outcome.failures) == 1
