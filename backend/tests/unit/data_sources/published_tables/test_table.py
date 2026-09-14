"""Reading a transcribed table back, as strictly as an API response.

**A transcription is exactly where a slip happens.** A figure typed into the wrong row, a country
entered twice, a year where the edition should be -- none of those raises by itself, and each
would reach a ranking looking like a published figure. So every one is refused at load, naming
the file and the row.
"""

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from starnest.data_sources.published_tables import (
    TABLES,
    TranscriptionError,
    every_published_table,
    read_table,
)

HEADER = """# data_source: rsf
# attribute: country.press_freedom
# publication: RSF World Press Freedom Index 2026
# publisher_url: https://rsf.org/en/index
# transcribed_on: 2026-09-14
# confidence: medium
"""
COLUMNS = "country_code,figure,period,page,workings\n"
A_PAGE = "https://en.wikipedia.org/wiki/World_Press_Freedom_Index"


def a_table(tmp_path: Path, body: str, header: str = HEADER, columns: str = COLUMNS) -> Path:
    path = tmp_path / "a_table.csv"
    path.write_text(header + columns + body, encoding="utf-8")
    return path


class TestWhatATableSays:
    def test_the_header_and_the_rows_come_back(self, tmp_path: Path) -> None:
        table = read_table(a_table(tmp_path, f"AT,79.43,2025,{A_PAGE},\n"))

        assert table.data_source == "rsf"
        assert table.attribute == "country.press_freedom"
        assert table.transcribed_on == date(2026, 9, 14)
        assert table.confidence == "medium"
        (row,) = table.rows
        assert row.country_code == "AT"
        assert row.figure == Decimal("79.43")
        assert (row.period_start, row.period_end) == (date(2025, 1, 1), date(2025, 12, 31))
        assert row.page == A_PAGE

    def test_a_span_of_years_is_kept_as_the_span(self, tmp_path: Path) -> None:
        """MIPEX 2025 describes policy over 2020 to 2023, and collapsing that to either end
        would move the date freshness is counted from."""
        (row,) = read_table(a_table(tmp_path, f"LV,36,2020-2023,{A_PAGE},\n")).rows

        assert (row.period_start, row.period_end) == (date(2020, 1, 1), date(2023, 12, 31))

    def test_lower_case_country_codes_are_normalised(self, tmp_path: Path) -> None:
        (row,) = read_table(a_table(tmp_path, f"at,79.43,2025,{A_PAGE},\n")).rows

        assert row.country_code == "AT"

    def test_extra_header_lines_are_notes_and_do_not_break_the_read(self, tmp_path: Path) -> None:
        """A transcription explains itself -- which edition, what was left out and why -- and
        those notes live in the header beside the figures they explain."""
        header = HEADER + "# not ranked: IE and GB are absent from this edition\n"

        table = read_table(a_table(tmp_path, f"AT,79.43,2025,{A_PAGE},\n", header=header))

        assert len(table.rows) == 1


class TestWhatATableRefuses:
    def test_a_missing_header_field_names_itself(self, tmp_path: Path) -> None:
        header = HEADER.replace("# confidence: medium\n", "")

        with pytest.raises(TranscriptionError, match="confidence"):
            read_table(a_table(tmp_path, f"AT,79.43,2025,{A_PAGE},\n", header=header))

    def test_a_confidence_outside_the_vocabulary_is_refused(self, tmp_path: Path) -> None:
        header = HEADER.replace("medium", "certain")

        with pytest.raises(TranscriptionError, match="certain"):
            read_table(a_table(tmp_path, f"AT,79.43,2025,{A_PAGE},\n", header=header))

    def test_a_country_entered_twice_is_refused(self, tmp_path: Path) -> None:
        """Keeping either figure would be choosing silently between two things somebody wrote."""
        body = f"AT,79.43,2025,{A_PAGE},\nAT,97.43,2025,{A_PAGE},\n"

        with pytest.raises(TranscriptionError, match="AT appears twice"):
            read_table(a_table(tmp_path, body))

    def test_a_figure_that_is_not_a_number_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(TranscriptionError, match="about eighty"):
            read_table(a_table(tmp_path, f"AT,about eighty,2025,{A_PAGE},\n"))

    @pytest.mark.parametrize("period", ["", "May 2025", "2025/26", "25"])
    def test_a_period_that_is_not_a_year_or_a_span_is_refused(
        self, tmp_path: Path, period: str
    ) -> None:
        with pytest.raises(TranscriptionError, match="period"):
            read_table(a_table(tmp_path, f"AT,79.43,{period},{A_PAGE},\n"))

    def test_a_span_that_ends_before_it_starts_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(TranscriptionError, match="ends before it starts"):
            read_table(a_table(tmp_path, f"AT,79.43,2025-2020,{A_PAGE},\n"))

    def test_a_figure_with_no_page_is_refused(self, tmp_path: Path) -> None:
        """Provenance is not optional (`reqs.md` 3.6): a figure nobody can check is not one."""
        with pytest.raises(TranscriptionError, match="page"):
            read_table(a_table(tmp_path, "AT,79.43,2025,,\n"))

    def test_a_country_code_that_is_not_two_letters_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(TranscriptionError, match="AUT"):
            read_table(a_table(tmp_path, f"AUT,79.43,2025,{A_PAGE},\n"))

    def test_columns_in_another_order_are_refused(self, tmp_path: Path) -> None:
        """Reordered columns would put a year where a figure belongs, and every value would
        still parse. Exact columns are the only defence."""
        columns = "country_code,period,figure,page,workings\n"

        with pytest.raises(TranscriptionError, match="columns"):
            read_table(a_table(tmp_path, f"AT,2025,79.43,{A_PAGE},\n", columns=columns))

    def test_a_table_with_no_rows_is_refused(self, tmp_path: Path) -> None:
        with pytest.raises(TranscriptionError, match="no rows"):
            read_table(a_table(tmp_path, ""))


class TestTheShippedTranscriptions:
    def test_every_shipped_table_reads_cleanly(self) -> None:
        """The same read the application makes at boot. A slip in a shipped file fails here
        rather than stopping the next start-up."""
        tables = every_published_table()

        assert tables, f"no transcription found in {TABLES}"
        assert all(table.rows for table in tables)

    def test_no_two_shipped_tables_answer_the_same_attribute_for_the_same_publisher(
        self,
    ) -> None:
        """The startup check refuses that pairing, because a stored value could not say which
        file it came from. Asserted here so it fails at the desk rather than at boot."""
        pairs = [(table.data_source, table.attribute) for table in every_published_table()]

        assert len(pairs) == len(set(pairs))
