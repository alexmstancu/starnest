"""A publisher's table, transcribed by hand into the repository, and read back strictly.

**Some publishers publish a table and no API.** RSF's World Press Freedom Index, EF's English
Proficiency Index and MIPEX are each one page listing every country, and RSF refuses scripts
outright. The honest route to those figures is the one a careful person takes: read the table
once, write down every figure with the page it came from, and keep the transcription where it can
be reviewed. `reqs.md` 6.10's test -- "if the answer could be obtained from a dataset, it must
be" -- is met here better than by the LLM fallback, because one table read gives every country
the same edition and the same methodology, where 32 separate searches can each land on a
different year.

**The file is the transcription, and it is read as strictly as an API response.** A malformed
header, a duplicated country or a figure that is not a number is an error at load, naming the
file and the line -- because a transcription is exactly where a slip happens, and a slip found at
boot costs nothing while one found in a ranking costs the ranking.

The format, one file per publisher and attribute::

    # data_source: rsf
    # attribute: country.press_freedom
    # publication: RSF World Press Freedom Index 2026
    # publisher_url: https://rsf.org/en/index
    # transcribed_on: 2026-09-14
    # confidence: medium
    country_code,figure,period,page,workings
    AT,79.43,2026,https://en.wikipedia.org/wiki/World_Press_Freedom_Index,

`period` is a year (`2026`) or a span (`2020-2023`). `workings` is optional prose for a figure
that was computed or needs a caveat, and when present it is the value's quote.
"""

import csv
import io
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

REQUIRED_HEADER = (
    "data_source",
    "attribute",
    "publication",
    "publisher_url",
    "transcribed_on",
    "confidence",
)
COLUMNS = ("country_code", "figure", "period", "page", "workings")
CONFIDENCES = ("high", "medium", "low")

_A_YEAR = re.compile(r"^(\d{4})$")
_A_SPAN = re.compile(r"^(\d{4})-(\d{4})$")


class TranscriptionError(ValueError):
    """A transcribed table that cannot be trusted as written, named with its file and line."""


@dataclass(frozen=True)
class Row:
    """One country's figure, as it was read, with the page it was read from."""

    country_code: str
    figure: Decimal
    period_start: date
    period_end: date
    page: str
    workings: str


@dataclass(frozen=True)
class PublishedTable:
    """Everything one transcription says: who published it, what it answers, and the rows."""

    data_source: str
    attribute: str
    publication: str
    publisher_url: str
    transcribed_on: date
    confidence: str
    rows: tuple[Row, ...]


def read_table(path: Path) -> PublishedTable:
    """The transcription at `path`, or `TranscriptionError` saying what is wrong and where."""
    header: dict[str, str] = {}
    body: list[str] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if line.startswith("#"):
            key, separator, value = line[1:].partition(":")
            if not separator:
                raise TranscriptionError(f"{path.name}:{number}: a header line needs `key: value`")
            header[key.strip()] = value.strip()
        elif line.strip():
            body.append(line)

    missing = [key for key in REQUIRED_HEADER if not header.get(key)]
    if missing:
        raise TranscriptionError(f"{path.name}: the header does not say {', '.join(missing)}")
    if header["confidence"] not in CONFIDENCES:
        raise TranscriptionError(
            f"{path.name}: confidence {header['confidence']!r} is not one of {CONFIDENCES}"
        )

    return PublishedTable(
        data_source=header["data_source"],
        attribute=header["attribute"],
        publication=header["publication"],
        publisher_url=header["publisher_url"],
        transcribed_on=_a_date(header["transcribed_on"], path.name),
        confidence=header["confidence"],
        rows=_rows_of(body, path.name),
    )


def _rows_of(body: list[str], name: str) -> tuple[Row, ...]:
    reader = csv.DictReader(io.StringIO("\n".join(body)))
    if tuple(reader.fieldnames or ()) != COLUMNS:
        raise TranscriptionError(f"{name}: the columns must be exactly {', '.join(COLUMNS)}")

    rows: list[Row] = []
    seen: set[str] = set()
    for record in reader:
        # +2: the column row, and counting from one. Header comment lines are not in `body`,
        # so this is the row's position within the table rather than within the file.
        where = f"{name}: table row {reader.line_num - 1}"
        code = (record["country_code"] or "").strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", code):
            raise TranscriptionError(f"{where}: {code!r} is not a two-letter country code")
        if code in seen:
            # A second figure for one country is a transcription slip, and keeping either would
            # be choosing silently between two things somebody wrote down.
            raise TranscriptionError(f"{where}: {code} appears twice")
        seen.add(code)
        start, end = _a_period((record["period"] or "").strip(), where)
        page = (record["page"] or "").strip()
        if not page.startswith("https://"):
            raise TranscriptionError(f"{where}: every figure names the page it was read from")
        rows.append(
            Row(
                country_code=code,
                figure=_a_figure((record["figure"] or "").strip(), where),
                period_start=start,
                period_end=end,
                page=page,
                workings=(record["workings"] or "").strip(),
            )
        )
    if not rows:
        raise TranscriptionError(f"{name}: the table has no rows")
    return tuple(rows)


def _a_figure(text: str, where: str) -> Decimal:
    try:
        return Decimal(text)
    except InvalidOperation as unreadable:
        raise TranscriptionError(f"{where}: {text!r} is not a number") from unreadable


def _a_period(text: str, where: str) -> tuple[date, date]:
    if single := _A_YEAR.match(text):
        first = last = int(single.group(1))
    elif span := _A_SPAN.match(text):
        first, last = int(span.group(1)), int(span.group(2))
    else:
        raise TranscriptionError(f"{where}: period {text!r} must be a year or a span of years")
    if last < first:
        raise TranscriptionError(f"{where}: period {text!r} ends before it starts")
    return date(first, 1, 1), date(last, 12, 31)


def _a_date(text: str, name: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as unreadable:
        raise TranscriptionError(f"{name}: transcribed_on {text!r} is not a date") from unreadable
