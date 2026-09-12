"""Reading a model's reply, and dating it. Shared by the three LLM uses and by nothing else.

**A model's reply is prose until proven otherwise.** Each use asks for one JSON object, and
each gets back an object wrapped in whatever the model felt like saying -- a code fence, a
preamble, a closing sentence. This finds the object or refuses; it never guesses at a number
that was not clearly given.
"""

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from starnest.data import ReferencePeriod


@dataclass(frozen=True)
class Dated:
    """When the answer was asked for, and what period it describes.

    **A model's answer describes now**, which is the honest reference period: it read pages
    today and summarised what they say today. Pretending it describes a calendar year would put
    a date on it that no publisher chose (`reqs.md` 3.6).
    """

    retrieved: datetime
    period: ReferencePeriod


def the_period_now() -> Dated:
    retrieved = datetime.now(tz=UTC)
    today: date = retrieved.date()
    return Dated(retrieved=retrieved, period=ReferencePeriod(start=today, end=today))


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
