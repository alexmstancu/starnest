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
from datetime import date
from decimal import Decimal
from hashlib import sha256
from pathlib import Path

import pytest

from starnest.data_sources.published_tables import (
    TABLES,
    PublishedTable,
    every_published_table,
    read_table,
)

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


@pytest.mark.parametrize(
    "attribute,country,ending",
    [
        ("country.protected_land_share", "CH", "(5173 of 41291 km2), WDPA profile read Oct 2026"),
        ("country.protected_land_share", "GB", "(70181 of 245133 km2), WDPA profile read Oct 2026"),
        ("country.protected_land_share", "IS", "(21089 of 100974 km2), WDPA profile read Oct 2026"),
        (
            "country.protected_land_share",
            "NO",
            "mainland, excludes Svalbard/Jan Mayen), WDPA profile read Oct 2026",
        ),
        ("country.statutory_paid_leave", "GB", "capped at 28, which may absorb bank holidays"),
        *(
            ("country.coastline_access", landlocked, "landlocked, so no coast")
            for landlocked in ("AT", "CH", "CZ", "HU", "LI", "LU", "SK")
        ),
    ],
)
def test_no_workings_is_cut_short_at_a_comma(attribute: str, country: str, ending: str) -> None:
    """BE-27. Twelve rows wrote a comma into their workings unquoted, and the reader kept only
    the text before it -- so Norway's figure lost the note saying it excludes Svalbard, and every
    landlocked country lost "so no coast"."""
    by_code = {row.country_code: row for row in SHIPPED[attribute].rows}

    assert by_code[country].workings.endswith(ending)


@pytest.mark.parametrize(
    "attribute,read_on",
    [
        ("country.protected_land_share", date(2026, 10, 11)),
        ("country.statutory_paid_leave", date(2026, 9, 20)),
        ("country.coastline_access", date(2026, 10, 2)),
    ],
)
def test_a_table_keeps_the_day_its_publisher_was_read(attribute: str, read_on: date) -> None:
    """NEW-33. `transcribed_on` becomes every figure's retrieval date, which Q230 defines as the
    day the publisher's table was read. BE-27 re-quoted twelve workings in these three files and
    moved their date to the day of that edit -- but re-copying an unchanged table is not a read,
    so 67 figures would have claimed a retrieval nobody made. A new date belongs here only with
    a new read of the publisher: change this test in the same commit, and say which read."""
    assert SHIPPED[attribute].transcribed_on == read_on


MANIFEST = Path(__file__).parent / "transcriptions.manifest"
"""Append-only: one line per (file, `transcribed_on`), and the fingerprint of its figures."""


def _fingerprint(table: PublishedTable) -> str:
    """The country, figure and period columns -- what a run stores as the payload and period. The
    page and the workings are left out on purpose: re-quoting them is not a new read (NEW-33)."""
    rows = sorted(
        f"{row.country_code},{row.figure.normalize():f},{row.period_start},{row.period_end}"
        for row in table.rows
    )
    return sha256("\n".join(rows).encode()).hexdigest()


def _recorded() -> dict[tuple[str, str], str]:
    lines = MANIFEST.read_text().splitlines()
    entries = [line.split() for line in lines if line.strip() and not line.startswith("#")]
    recorded = {(name, read_on): fingerprint for name, read_on, fingerprint in entries}
    assert len(recorded) == len(entries), "a (file, transcribed_on) is recorded twice"
    return recorded


@pytest.mark.parametrize("path", sorted(TABLES.glob("*.csv")), ids=lambda path: path.name)
def test_a_tables_figures_are_the_ones_recorded_for_its_date(path: Path) -> None:
    """NEW-23. `transcribed_on` is every figure's retrieval date, and so part of the natural key:
    a figure edited under the old date is the same observation with another number, which a run
    can only report as a conflict and never store. A new reading of the publisher gets a new date
    and a new line appended to the manifest, in the same commit; an edited figure without one
    fails here."""
    table = read_table(path)

    assert _recorded().get((path.name, str(table.transcribed_on))) == _fingerprint(table)


class TestTheManifestGuard:
    """The guard above, run against a scratch copy of a shipped table rather than trusted."""

    @staticmethod
    def a_copy(tmp_path: Path, edit: tuple[str, str]) -> PublishedTable:
        original = TABLES / "oecd_parental_leave.csv"
        text = original.read_text(encoding="utf-8")
        assert edit[0] in text
        copy = tmp_path / original.name
        copy.write_text(text.replace(edit[0], edit[1], 1), encoding="utf-8")
        return read_table(copy)

    def test_a_figure_edited_under_the_old_date_is_caught(self, tmp_path: Path) -> None:
        """d2904cf: Czechia's raw-length 164 weeks swapped for 50.62, the date kept."""
        edited = self.a_copy(tmp_path, ("CZ,50.62,", "CZ,164,"))

        assert _recorded()[("oecd_parental_leave.csv", "2026-09-19")] != _fingerprint(edited)

    def test_a_page_re_quoted_under_the_old_date_is_not(self, tmp_path: Path) -> None:
        """NEW-33: re-quoting the words behind a figure is not a new reading of it."""
        edited = self.a_copy(
            tmp_path, ("AT,46.52,2025,https://webfs.", "AT,46.52,2025,https://www.")
        )

        assert _recorded()[("oecd_parental_leave.csv", "2026-09-19")] == _fingerprint(edited)


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
