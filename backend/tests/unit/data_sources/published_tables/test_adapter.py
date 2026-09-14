"""A transcribed table becoming stored values, under the publisher that published it."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from starnest.candidates import Candidate
from starnest.data import Attribute, ConfidenceLevel, IndexParameters, QuantityParameters, ValueType
from starnest.data_sources.published_tables import PublishedTable, PublishedTableAdapter, Row

COUNTRY = {"id": "country", "depth_order": 1}
PRESS_FREEDOM = "country.press_freedom"
A_PAGE = "https://en.wikipedia.org/wiki/World_Press_Freedom_Index"
THE_PUBLISHER = "https://rsf.org/en/index"
READ_ON = date(2026, 9, 14)


def a_row(code: str, figure: str, *, year: int = 2025, workings: str = "") -> Row:
    return Row(
        country_code=code,
        figure=Decimal(figure),
        period_start=date(year, 1, 1),
        period_end=date(year, 12, 31),
        page=A_PAGE,
        workings=workings,
    )


def a_table(*rows: Row, attribute: str = PRESS_FREEDOM, confidence: str = "medium"):
    return PublishedTable(
        data_source="rsf",
        attribute=attribute,
        publication="RSF World Press Freedom Index 2026",
        publisher_url=THE_PUBLISHER,
        transcribed_on=READ_ON,
        confidence=confidence,
        rows=rows,
    )


def press_freedom() -> Attribute:
    return Attribute(
        id=PRESS_FREEDOM,
        name="Press freedom",
        level="country",
        value_type=ValueType.INDEX,
        pillar="governance",
        index_parameters=IndexParameters(
            provider="RSF", scale_min=Decimal(0), scale_max=Decimal(100)
        ),
    )


def elevation_range() -> Attribute:
    return Attribute(
        id="country.elevation_range",
        name="Elevation range",
        level="country",
        value_type=ValueType.QUANTITY,
        pillar="nature",
        quantity_parameters=QuantityParameters(unit="metre"),
    )


def a_country(name: str, code: str | None) -> Candidate:
    return Candidate(id=f"country.{name}", name=name.title(), level=COUNTRY, country_code=code)


class TestTheFiguresItStores:
    async def test_it_stores_the_figure_under_the_publisher_not_under_manual_or_llm(self) -> None:
        """An RSF score read off RSF's table is an RSF figure, whoever moved it into the file --
        and `rsf` is the source the catalog already ranks first for this attribute."""
        acquired = await PublishedTableAdapter(a_table(a_row("AT", "79.43"))).fetch(
            press_freedom(), [a_country("austria", "AT")]
        )

        (value,) = acquired.values
        assert value.data_source == "rsf"
        assert value.payload.value == Decimal("79.43")  # type: ignore[union-attr]
        assert value.payload.provider == "RSF"  # type: ignore[union-attr]

    async def test_the_period_is_the_rows_and_not_the_day_of_the_run(self) -> None:
        """P37 in the other direction: a table's figure describes the year it says."""
        acquired = await PublishedTableAdapter(a_table(a_row("AT", "79.43", year=2025))).fetch(
            press_freedom(), [a_country("austria", "AT")]
        )

        (value,) = acquired.values
        assert value.reference_period.start == date(2025, 1, 1)
        assert value.reference_period.end == date(2025, 12, 31)

    async def test_the_retrieval_date_is_the_day_the_table_was_read(self) -> None:
        """A run copying a file nobody has re-transcribed has not looked at the publisher
        again, and the retrieval date exists to answer when somebody last did."""
        acquired = await PublishedTableAdapter(a_table(a_row("AT", "79.43"))).fetch(
            press_freedom(), [a_country("austria", "AT")]
        )

        (value,) = acquired.values
        assert value.retrieval_date == datetime(2026, 9, 14, tzinfo=UTC)

    async def test_it_cites_the_page_read_and_the_publisher(self) -> None:
        acquired = await PublishedTableAdapter(a_table(a_row("AT", "79.43"))).fetch(
            press_freedom(), [a_country("austria", "AT")]
        )

        (value,) = acquired.values
        assert tuple(value.citations) == (A_PAGE, THE_PUBLISHER)

    async def test_the_confidence_is_the_tables(self) -> None:
        acquired = await PublishedTableAdapter(
            a_table(a_row("AT", "79.43"), confidence="high")
        ).fetch(press_freedom(), [a_country("austria", "AT")])

        assert acquired.values[0].confidence_level is ConfidenceLevel.HIGH

    async def test_workings_become_the_quote_when_a_figure_was_computed(self) -> None:
        """A computed figure shows its arithmetic, so a reader can redo it."""
        row = a_row("AT", "3683", workings="3,798 m (Grossglockner) - 115 m (Lake Neusiedl)")

        acquired = await PublishedTableAdapter(
            a_table(row, attribute="country.elevation_range")
        ).fetch(elevation_range(), [a_country("austria", "AT")])

        (value,) = acquired.values
        assert value.quote == "3,798 m (Grossglockner) - 115 m (Lake Neusiedl)"
        assert value.payload.unit == "metre"  # type: ignore[union-attr]


class TestWhatItDoesNotInvent:
    async def test_a_country_the_table_does_not_list_gets_no_figure_and_no_failure(
        self,
    ) -> None:
        """EF does not rank the United Kingdom. That is coverage, not a fault to triage."""
        acquired = await PublishedTableAdapter(a_table(a_row("AT", "79.43"))).fetch(
            press_freedom(), [a_country("austria", "AT"), a_country("united_kingdom", "GB")]
        )

        assert [str(value.candidate) for value in acquired.values] == ["country.austria"]
        assert acquired.failures == ()

    async def test_a_candidate_with_no_country_code_is_a_failure(self) -> None:
        acquired = await PublishedTableAdapter(a_table(a_row("AT", "79.43"))).fetch(
            press_freedom(), [a_country("atlantis", None)]
        )

        assert acquired.values == ()
        assert "country code" in acquired.failures[0].reason

    async def test_a_figure_outside_the_catalogs_scale_fails_that_country_only(self) -> None:
        """A transcription slip -- 794.3 for 79.43 -- is one country's problem, not the run's."""
        acquired = await PublishedTableAdapter(
            a_table(a_row("AT", "794.3"), a_row("BE", "81.17"))
        ).fetch(press_freedom(), [a_country("austria", "AT"), a_country("belgium", "BE")])

        assert [str(value.candidate) for value in acquired.values] == ["country.belgium"]
        assert acquired.failures[0].candidate == "country.austria"


class TestWhatItAnswers:
    def test_it_declares_its_publisher_and_its_one_attribute(self) -> None:
        adapter = PublishedTableAdapter(a_table(a_row("AT", "79.43")))

        assert adapter.data_source == "rsf"
        assert adapter.attributes == (PRESS_FREEDOM,)
        assert adapter.costs_money is False

    async def test_it_refuses_an_attribute_that_is_not_its_own(self) -> None:
        acquired = await PublishedTableAdapter(a_table(a_row("AT", "79.43"))).fetch(
            elevation_range(), [a_country("austria", "AT")]
        )

        assert acquired.values == ()
        assert "answers only country.press_freedom" in acquired.failures[0].reason

    async def test_a_type_a_table_cannot_carry_is_a_catalog_fault_raised_once(self) -> None:
        employers = Attribute(
            id=PRESS_FREEDOM,
            name="Press freedom",
            level="country",
            value_type=ValueType.LABEL_SET,
            pillar="career",
        )

        with pytest.raises(ValueError, match="index, quantity and ratio"):
            await PublishedTableAdapter(a_table(a_row("AT", "79.43"))).fetch(
                employers, [a_country("austria", "AT")]
            )
