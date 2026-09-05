"""Reading the World Bank v2 envelope, which answers refusals with 200 OK.

A successful response is a two-element array: metadata, then the rows. A refusal is a
*one*-element array carrying a `message`, sent with status 200 -- so an unknown indicator code
looks like a perfectly good HTTP response and only the shape of the body gives it away. That is
the whole reason this module exists rather than the adapter indexing into the JSON directly.

**A row whose `value` is null is not a reading.** The World Bank says "we have no figure for this
country" by sending the row with a null in it, and a null is not a zero. It is dropped here, so
a caller cannot mistake one for a figure (`reqs.md` 5.3).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any


class WorldBankError(ValueError):
    """The response was not the answer this parser knows how to read.

    Covers a refusal carrying a `message`, a body that is not the two-element envelope, and a
    result the server had to split across pages -- see `readings` for why that last one is an
    error rather than something to page through.
    """


@dataclass(frozen=True)
class Reading:
    """One series' figure, for one country, for one period, as the World Bank published it.

    `country` is ISO 3166-1 alpha-2, which is what `candidate.country_code` holds -- so unlike
    Eurostat, nothing has to be translated between their vocabulary and ours.
    """

    series: str
    country: str
    period: str
    figure: Decimal


def readings(document: Any) -> tuple[Reading, ...]:
    """Every figure the response actually carries, in the order it carried them.

    **A paged result raises rather than returning its first page.** Every caller here asks for a
    known, small number of rows and sizes the request to fit; more pages than one therefore means
    the request was wrong, and silently returning page one would drop countries from a ranking
    while looking like a successful fetch. That is the failure mode this application exists to
    prevent, so it is loud.
    """
    metadata, rows = _envelope(document)
    _reject_a_split_result(metadata)
    return tuple(reading for row in rows if (reading := _reading_from(row)) is not None)


def _envelope(document: Any) -> tuple[dict[str, Any], Sequence[Any]]:
    if not isinstance(document, list) or not document:
        raise WorldBankError("the world bank answered with something other than its usual array")
    head = document[0]
    if isinstance(head, dict) and "message" in head:
        raise WorldBankError(f"the world bank refused the request: {_refusal(head)}")
    if len(document) < 2 or not isinstance(head, dict):
        raise WorldBankError(
            "the world bank answered without the metadata and rows it usually pairs"
        )
    rows = document[1]
    if rows is None:
        # The documented way of saying "nothing matched", and an ordinary answer rather than a
        # fault: an indicator no country in the request reported looks exactly like this.
        return head, ()
    if not isinstance(rows, list):
        raise WorldBankError("the world bank answered with rows that are not a list")
    return head, rows


def _refusal(head: dict[str, Any]) -> str:
    """What the server said, in its own words, so a wrong indicator code names itself."""
    messages = head.get("message")
    if not isinstance(messages, list):
        return "no reason given"
    return (
        "; ".join(
            str(message.get("value", message)) for message in messages if isinstance(message, dict)
        )
        or "no reason given"
    )


def _reject_a_split_result(metadata: dict[str, Any]) -> None:
    pages = metadata.get("pages")
    if isinstance(pages, int) and pages > 1:
        raise WorldBankError(
            f"the world bank split this answer across {pages} pages, so asking for one would "
            "have silently dropped countries"
        )


def _reading_from(row: Any) -> Reading | None:
    if not isinstance(row, dict):
        raise WorldBankError("the world bank answered with a row that is not an object")
    figure = row.get("value")
    if figure is None:
        return None
    return Reading(
        series=_named(row, "indicator"),
        country=_named(row, "country"),
        period=_text(row, "date"),
        figure=_decimal(figure),
    )


def _named(row: dict[str, Any], field: str) -> str:
    """The id out of one of the `{"id": ..., "value": ...}` pairs the rows are built from."""
    pair = row.get(field)
    if not isinstance(pair, dict) or not isinstance(pair.get("id"), str):
        raise WorldBankError(f"a row names no {field}")
    return pair["id"]


def _text(row: dict[str, Any], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value:
        raise WorldBankError(f"a row names no {field}")
    return value


def _decimal(figure: Any) -> Decimal:
    """Through `str`, because the JSON number is a float and `Decimal(float)` keeps its noise.

    `Decimal(0.3710995)` is 0.371099500000000019... which would travel into the database and
    onto the screen. `Decimal("0.3710995")` is the figure the World Bank published.
    """
    try:
        return Decimal(str(figure))
    except (InvalidOperation, ValueError) as unreadable:
        raise WorldBankError(f"{figure!r} is not a number the world bank could have meant") from (
            unreadable
        )
