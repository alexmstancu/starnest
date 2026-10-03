"""The tables actually shipped, as opposed to the parser that reads them.

`test_table.py` proves the reader refuses a malformed table, driving it with files written in
`tmp_path`. Nothing read the real ones -- so a table could ship with a figure that disagrees
with its own workings, a country missing, or a page that is not a page, and every test would
stay green because none of them opens these files.

**The arithmetic is the point.** Two of these tables carry a figure this project computed rather
than copied: coastline is km per 1000 km2, elevation is a high point minus a low one. Both are
checkable against the `workings` that state them, and a transcription error is exactly the kind
of fault that looks like data rather than like a bug.
"""

import re
from decimal import Decimal

import pytest

from starnest.data_sources.published_tables import every_published_table

SHIPPED = {str(table.attribute): table for table in every_published_table()}
THE_ROSTER = 32
"""Candidate countries at the country level. A table need not cover them all, but it must say so."""


def test_there_are_tables_to_check() -> None:
    """Guards every test below: a glob that matched nothing would pass them all."""
    assert len(SHIPPED) >= 7


@pytest.mark.parametrize("attribute", sorted(SHIPPED))
def test_every_row_cites_a_page(attribute: str) -> None:
    """**A transcribed figure without a page is an unsourced figure** (`reqs.md` 6.10). The
    reader enforces this per row; this asserts it of the files we actually ship, which is the
    claim that matters."""
    pageless = [row.country_code for row in SHIPPED[attribute].rows if not row.page.strip()]

    assert pageless == []


@pytest.mark.parametrize("attribute", sorted(SHIPPED))
def test_every_page_is_a_url(attribute: str) -> None:
    pages = {row.page for row in SHIPPED[attribute].rows}

    assert all(page.startswith("http") for page in pages), sorted(pages)[:2]


@pytest.mark.parametrize("attribute", sorted(SHIPPED))
def test_no_country_appears_twice(attribute: str) -> None:
    codes = [row.country_code for row in SHIPPED[attribute].rows]

    assert len(codes) == len(set(codes))


@pytest.mark.parametrize("attribute", sorted(SHIPPED))
def test_the_publisher_is_named_and_is_not_a_placeholder(attribute: str) -> None:
    """**Never `manual`, never `llm`** (Q230). A transcribed figure is the publisher's, and
    storing it under a placeholder would lose the one thing transcription is for."""
    source = str(SHIPPED[attribute].data_source)

    assert source not in ("manual", "llm", "")


class TestTheComputedTables:
    """The two tables whose figure is arithmetic over the quantities in its own `workings`.

    A copying slip in either is invisible: the number looks like every other number. Reading the
    workings back and recomputing is the only thing that catches it.
    """

    def test_coastline_covers_every_candidate(self) -> None:
        assert len(SHIPPED["country.coastline_access"].rows) == THE_ROSTER

    def test_elevation_covers_every_candidate(self) -> None:
        assert len(SHIPPED["country.elevation_range"].rows) == THE_ROSTER

    def test_every_coastline_figure_is_its_workings(self) -> None:
        """km of coast per 1000 km2 of land, and the workings state both quantities."""
        wrong = []
        for row in SHIPPED["country.coastline_access"].rows:
            found = re.search(r"([\d.]+) km coast / ([\d.]+) km2 land", row.workings or "")
            assert found, f"{row.country_code} does not state its workings"
            coast, land = Decimal(found.group(1)), Decimal(found.group(2))
            expected = (coast / (land / 1000)).quantize(Decimal("0.01"))
            if abs(expected - Decimal(str(row.figure))) > Decimal("0.01"):
                wrong.append((row.country_code, str(row.figure), str(expected)))

        assert wrong == []

    def test_every_elevation_figure_is_its_workings(self) -> None:
        """The high point minus the low one, both named in the workings."""
        wrong = []
        for row in SHIPPED["country.elevation_range"].rows:
            found = re.search(r"([-\d.]+) m minus .*? ([-\d.]+) m", row.workings or "")
            assert found, f"{row.country_code} does not state its workings"
            high, low = Decimal(found.group(1)), Decimal(found.group(2))
            if abs((high - low) - Decimal(str(row.figure))) > Decimal("0.01"):
                wrong.append((row.country_code, str(row.figure), str(high - low)))

        assert wrong == []

    def test_a_landlocked_country_reads_zero_rather_than_absent(self) -> None:
        """**Zero is a measurement here, not a gap.** Austria has no coast; leaving it out would
        make it indistinguishable from a country nobody looked up, and redistribution would hand
        its weight to other criteria as though the question were unanswerable."""
        by_code = {row.country_code: row for row in SHIPPED["country.coastline_access"].rows}

        assert Decimal(str(by_code["AT"].figure)) == 0
        assert Decimal(str(by_code["CH"].figure)) == 0

    def test_a_country_with_a_coast_does_not_read_zero(self) -> None:
        """The other half, so the test above cannot be satisfied by a table of zeros."""
        by_code = {row.country_code: row for row in SHIPPED["country.coastline_access"].rows}

        assert Decimal(str(by_code["GR"].figure)) > 100
        assert Decimal(str(by_code["PT"].figure)) > 0

    def test_elevation_accounts_for_land_below_sea_level(self) -> None:
        """Seven of the 32 have a point below sea level, and the range has to include it: the
        Netherlands reads 322.4 to -6.76, which is 329.16 and not 322.4. A first pass assumed
        three such countries and the figure would have been short for four more."""
        by_code = {row.country_code: row for row in SHIPPED["country.elevation_range"].rows}

        assert Decimal(str(by_code["NL"].figure)) > Decimal("329")
        assert "-6.76" in (by_code["NL"].workings or "")
