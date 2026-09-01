"""What the objective half of the model calls things.

`arch.md` 3.2a. The catalog's identifiers follow the same convention `candidates/` already
defines: lowercase letters, digits and underscores, dot-separated, assigned once and never
regenerated from a display name.

**The alphabet is defined in exactly one place, and it is not here.** These types validate a
segment by constructing a `LevelId` -- the one-segment identifier `candidates/` already
guarantees. Restating the regular expression would give it a second definition that could
drift from the first.

Currency codes are the exception that proves the convention is about identity rather than
about lowercase: ISO 4217 is three uppercase letters, so `CurrencyCode` carries its own rule
while still being an `Identifier` -- a permanent, legible key.
"""

import re
from typing import Self

from starnest.candidates import (
    SEGMENT_SEPARATOR,
    Identifier,
    LevelId,
    MalformedIdentifierError,
)

_ISO_4217 = re.compile(r"^[A-Z]{3}$")


def _reject_a_malformed_segment(segment: str, *, within: str) -> None:
    """Hold one segment to the convention of `arch.md` 3.2.

    A `LevelId` *is* a single segment in that alphabet, so constructing one is the check.
    Its complaint is rewritten because it would otherwise talk about levels.
    """
    try:
        LevelId(segment)
    except MalformedIdentifierError:
        raise MalformedIdentifierError(
            f"{within!r} is not a valid identifier: the segment {segment!r} must be "
            "lowercase letters, digits and underscores, and must start with a letter"
        ) from None


class CatalogId(Identifier):
    """A single-segment identifier for a catalog row: `economics`, `numbeo`, `celsius`.

    Every catalog vocabulary uses the same shape, so they share one base and differ only in
    the type they present in a signature -- which is the point: a function asking for a
    `UnitId` cannot silently be handed a `PillarId`.
    """

    __slots__ = ()

    def __new__(cls, text: str) -> Self:
        _reject_a_malformed_segment(text, within=text)
        return super().__new__(cls, text)


class PillarId(CatalogId):
    """A load-bearing vertical of a life: `economics`, `housing` (`reqs.md` 3.2)."""

    __slots__ = ()


class DataSourceId(CatalogId):
    """Where a value came from: `eurostat`, `numbeo`, `llm`, `manual` (`reqs.md` 3.5)."""

    __slots__ = ()


class ReliabilityTierId(CatalogId):
    """The family a source belongs to: `official_international`, `crowdsourced` (`reqs.md` 5.7).

    A vocabulary rather than a closed enumeration, because the seeded catalog already carries
    two families the requirements do not name -- `research_index` and `derived` -- and a new
    adapter may need another.
    """

    __slots__ = ()


class BreakdownSchemeId(CatalogId):
    """What a multi-value attribute is broken down *by*: `bedroom_count` (`reqs.md` 3.3b)."""

    __slots__ = ()


class BreakdownOptionId(CatalogId):
    """One case within a scheme: `two_bedroom`, `three_people` (`reqs.md` 3.3b)."""

    __slots__ = ()


class UnitId(CatalogId):
    """A dimension a `Quantity` may carry: `celsius`, `km`, `mbps` (`arch.md` 3.2a)."""

    __slots__ = ()


class AttributeId(Identifier):
    """The identity of something knowable: `country.rent_centre`.

    `<level>.<name>`, exactly two segments (`reqs.md` 3.3). The level is part of the
    identity because cross-level concepts are separate attributes measuring different
    things, and the prefix is what keeps `country.tech_software_jobs` and
    `city.tech_software_jobs` apart.

    **The pillar is deliberately absent.** Pillar assignment may change; identity may not.
    """

    __slots__ = ()

    def __new__(cls, text: str) -> Self:
        segments = text.split(SEGMENT_SEPARATOR)
        if len(segments) != 2:
            raise MalformedIdentifierError(
                f"{text!r} is not an attribute identifier: it must be exactly "
                f"<level>{SEGMENT_SEPARATOR}<name>, and this has {len(segments)} segment(s)"
            )
        for segment in segments:
            _reject_a_malformed_segment(segment, within=text)
        return super().__new__(cls, text)

    @classmethod
    def build(cls, *, level: str, name: str) -> Self:
        """Compose an identifier from its two halves, validating both."""
        return cls(SEGMENT_SEPARATOR.join((level, name)))

    @property
    def level_id(self) -> LevelId:
        """The level this attribute applies at -- `country` for `country.rent_centre`."""
        return LevelId(self.split(SEGMENT_SEPARATOR)[0])

    @property
    def own_segment(self) -> str:
        """The half that names the measurement -- `rent_centre`."""
        return self.split(SEGMENT_SEPARATOR)[1]


class CurrencyCode(Identifier):
    """An ISO 4217 code: `EUR`, `CHF`, `SEK`.

    Uppercase, unlike every other identifier here, because ISO 4217 is uppercase and the
    published figure is retained exactly as issued (`reqs.md` 5.5).
    """

    __slots__ = ()

    def __new__(cls, text: str) -> Self:
        if not _ISO_4217.fullmatch(text):
            raise MalformedIdentifierError(
                f"{text!r} is not a currency: ISO 4217 is three uppercase letters"
            )
        return super().__new__(cls, text)
