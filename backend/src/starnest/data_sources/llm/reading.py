"""Reading a model's reply, and dating it. Shared by the three LLM uses and by nothing else.

**A model's reply is prose until proven otherwise.** Each use asks for one JSON object, and
each gets back an object wrapped in whatever the model felt like saying -- a code fence, a
preamble, a closing sentence. This finds the object or refuses; it never guesses at a number
that was not clearly given.
"""

import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from starnest.data import ReferencePeriod


@dataclass(frozen=True)
class Dated:
    """When the answer was asked for, and what period it describes.

    **For named employers, the answer describes now**, which is the honest reference period:
    the question is which firms operate there today, the model read pages today, and pretending
    the list describes a calendar year would put a date on it that no publisher chose
    (`reqs.md` 3.6).

    **A published figure is the opposite case, and must not use this.** Its publisher chose the
    year it describes -- RSF's 2019 index describes 2019 whenever it is read -- so the fallback
    reads that year with `the_period_reported`. Stamping today on it made every such figure
    permanently fresh, and freshness is the first term of the active-value order
    (`known-issues.md` P37).
    """

    retrieved: datetime
    period: ReferencePeriod


def the_period_now() -> Dated:
    retrieved = datetime.now(tz=UTC)
    today: date = retrieved.date()
    return Dated(retrieved=retrieved, period=ReferencePeriod(start=today, end=today))


_A_YEAR = re.compile(r"^\s*(\d{4})\s*$")
# A hyphen or a slash, the two the prompt's example uses. A typographic dash is refused like any
# other unexpected shape: the prompt asks for `2023-2024`, and a reply that cannot follow the
# example is not one whose year is worth trusting.
_A_SPAN_OF_YEARS = re.compile(r"^\s*(\d{4})\s*[-/]\s*(\d{2}|\d{4})\s*$")


def the_period_reported(said: object, *, today: date) -> ReferencePeriod | None:
    """The period a published figure describes, as the model reported it -- or `None`.

    **Only the two shapes the prompt asks for are read**: four digits (`2025`), or a span of
    years (`2023-2024`, `2023/24`). A whole calendar year each, because a published annual
    figure describes the year and not the day it was printed.

    **Everything else is `None` rather than a guess**, and the caller refuses the figure with
    what was said: "the 2026 edition" may describe 2025, and fishing a year out of a sentence
    is the fabrication this module exists not to make. So is a period that has not happened yet,
    a span that ends before it starts, and a year too early to be a published statistic anyone
    is still ranking on.
    """
    text = str(said) if isinstance(said, int | str) and not isinstance(said, bool) else ""
    if single := _A_YEAR.match(text):
        first = last = int(single.group(1))
    elif span := _A_SPAN_OF_YEARS.match(text):
        first = int(span.group(1))
        tail = span.group(2)
        # `2023/24` names its century by the first year.
        last = int(tail) if len(tail) == 4 else first // 100 * 100 + int(tail)
    else:
        return None
    if first < 1900 or last < first or last > today.year:
        return None
    return ReferencePeriod(start=date(first, 1, 1), end=date(last, 12, 31))


def a_json_object(text: str) -> dict[str, Any]:
    """The one JSON object in a reply, whatever surrounds it.

    Raises `ValueError` when there is none, which the callers turn into a failure naming the
    attribute and the candidate -- so an unparseable answer is a gap with a reason rather than a
    crash.
    """
    stripped = text.strip()
    opened = stripped.find("{")
    closed = stripped.rfind("}")
    if opened == -1 or closed <= opened:
        raise ValueError("the reply contains no JSON object")
    parsed = json.loads(stripped[opened : closed + 1])
    if not isinstance(parsed, dict):
        raise ValueError(f"the reply's JSON is a {type(parsed).__name__}, not an object")
    return parsed
