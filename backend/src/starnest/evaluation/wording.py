"""How a sentence the server writes about a candidate names what it judges (PL-067, M4).

Every reason a candidate does not match, every warning and every "why there is no score" is read
verbatim on screen and frozen into a saved ranking. So none holds an identifier, a vocabulary
token, a Python repr, "to any", or more than two decimals: attributes and gates are named as the
catalog names them, with units where the catalog has them.

**The names are passed in, never looked up.** Evaluation works on criteria and values and does
not read the catalog; the caller that does read it hands over a `Names`. A name the caller did
not supply falls back to the identifier made readable, never to the identifier itself.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

_READABLE_DECIMALS = Decimal("0.01")
_A_NOTE_TO_DEVELOPERS = re.compile(r"\s*\([a-z-]+\.md\b[^)]*\)")


@dataclass(frozen=True)
class Names:
    """What the catalog calls things, for the sentences evaluation writes."""

    attributes: Mapping[str, str] = field(default_factory=dict)
    """Attribute id -> the catalog's name."""
    units: Mapping[str, str] = field(default_factory=dict)
    """Attribute id -> the words a figure is followed by, where the catalog has them."""
    gates: Mapping[str, str] = field(default_factory=dict)
    """Match rule id -> the catalog's name."""


NO_NAMES = Names()


def readable_identifier(identifier: str) -> str:
    """An identifier as a reader would write it: `country.climate_zone` reads "Climate zone".

    The last resort for something the catalog did not name -- a saved ranking's candidate that
    has since left the roster, or a caller that passed no names. Never the raw id.
    """
    words = identifier.rsplit(".", 1)[-1].replace("_", " ").strip()
    return words[:1].upper() + words[1:] if words else identifier


def attribute_called(names: Names, attribute: str) -> str:
    return names.attributes.get(attribute) or readable_identifier(attribute)


def gate_called(names: Names, gate: str) -> str:
    return names.gates.get(gate) or readable_identifier(gate)


def readable_figure(figure: Decimal) -> str:
    """At most two decimals, trailing zeros trimmed, never an exponent: 43.328 reads "43.33",
    52.0 reads "52" and 60 never reads "6E+1"."""
    if figure.as_tuple().exponent < -2:  # type: ignore[operator]
        figure = figure.quantize(_READABLE_DECIMALS, rounding=ROUND_HALF_UP)
    text = f"{figure:f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in {"-0", ""} else text


def figure_in_words(names: Names, attribute: str, figure: Decimal) -> str:
    """A figure followed by its unit, where the catalog has one: "36.91 days per year", "5%"."""
    unit = names.units.get(attribute)
    if not unit:
        return readable_figure(figure)
    separator = "" if unit.startswith("%") else " "
    return f"{readable_figure(figure)}{separator}{unit}"


def band_words(minimum: Decimal | None, maximum: Decimal | None) -> str:
    """A band as a reader says it: "at least 25", "at most 40", "between 25 and 40"."""
    if minimum is not None and maximum is not None:
        return f"between {readable_figure(minimum)} and {readable_figure(maximum)}"
    if minimum is not None:
        return f"at least {readable_figure(minimum)}"
    if maximum is not None:
        return f"at most {readable_figure(maximum)}"
    return "with no bound set"


def quoted(label: str) -> str:
    """A label as printed text, in typographic quotes rather than a Python repr."""
    return f"\u2018{label}\u2019"


def yes_or_no(answer: bool) -> str:
    return "yes" if answer else "no"


def unit_words(unit_name: str) -> str:
    """A unit's catalog name as it reads after a figure: "Days per year" reads "days per year".

    Only the first letter is lowered, and only where the second is lower case too, so "Degrees
    Celsius" keeps its capital and an acronym such as "EU27" is left alone.
    """
    if len(unit_name) > 1 and unit_name[0].isupper() and unit_name[1].islower():
        return unit_name[0].lower() + unit_name[1:]
    return unit_name


def stored_text_in_words(text: str, attributes: Mapping[str, str]) -> str:
    """Stored prose with every attribute id it names replaced by the attribute's name, and any
    note to developers such as "(known-issues.md P37)" taken out, at read time.

    For text written before reasons were worded (PL-072, N3). Values are append-only, so a
    sentence stored with `country.english_proficiency` in it cannot be corrected in place.
    Ids are matched exactly from `attributes`, longest first, so one that is a prefix of
    another never takes a piece of it.
    """
    in_words = _A_NOTE_TO_DEVELOPERS.sub("", text)
    if not attributes:
        return in_words
    alternatives = "|".join(re.escape(each) for each in sorted(attributes, key=len, reverse=True))
    known = re.compile(f"(?:{alternatives})(?![a-z0-9_])")
    return known.sub(lambda found: attributes[found.group(0)], in_words)
