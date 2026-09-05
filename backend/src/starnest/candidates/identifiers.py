"""How places and levels are named, and why the name outlives the label.

`arch.md` 3.2 and 3.2a. An identifier is a **surrogate key that happens to be legible**:
assigned once, permanent, and never regenerated from a display name. Country names drift --
Czechia, Türkiye, Eswatini -- and when one does, the display name is updated and the
identifier is not, so every row that points at it survives.

The convention is one rule, not two:

    <level>.<qualifying path>.<own segment>

    country.portugal
    city.portugal.lisbon

A city repeats its country because city names are not globally unique. Nothing about the
rule is limited to two levels: a candidate at any level repeats its parent's qualifying
path and appends one segment of its own, so `neighbourhood.portugal.lisbon.alfama` needs no
new rule (`reqs.md` 3.1).
"""

import re
from typing import Any, Self

from pydantic import GetCoreSchemaHandler
from pydantic_core import CoreSchema, core_schema

SEGMENT_SEPARATOR = "."

# Lowercase ASCII, digits and underscores, starting with a letter. Deliberately narrow:
# an identifier reaches URLs, file names and adapter lookup tables, and the places it must
# survive intact are more numerous than the places a display name has to look right.
_SEGMENT = re.compile(r"^[a-z][a-z0-9_]*$")


class MalformedIdentifierError(ValueError):
    """A string does not follow the identifier convention of `arch.md` 3.2."""


def _validated_segments(text: str, *, at_least: int) -> tuple[str, ...]:
    segments = tuple(text.split(SEGMENT_SEPARATOR))
    if len(segments) < at_least:
        raise MalformedIdentifierError(
            f"{text!r} has {len(segments)} segment(s); this identifier needs at least "
            f"{at_least}, separated by {SEGMENT_SEPARATOR!r}"
        )
    for segment in segments:
        if not _SEGMENT.fullmatch(segment):
            raise MalformedIdentifierError(
                f"{text!r} is not a valid identifier: the segment {segment!r} must be "
                "lowercase letters, digits and underscores, and must start with a letter"
            )
    return segments


class Identifier(str):
    """A readable surrogate key.

    Behaves as the string it is -- it compares, hashes, serialises and reaches SQL exactly
    like `str` -- so no consumer has to unwrap it. What it adds is that a malformed one
    cannot be constructed, and that the parts of it can be asked for by name instead of
    being re-split by every caller.
    """

    __slots__ = ()

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        """Accept a plain string in any model field and validate it on the way in.

        This is what lets `Candidate(id="country.portugal", ...)` work while still
        refusing `Candidate(id="Portugal", ...)`.
        """
        return core_schema.no_info_after_validator_function(cls, core_schema.str_schema())


class LevelId(Identifier):
    """The identity of a level: `country`, `city`. Exactly one segment."""

    __slots__ = ()

    def __new__(cls, text: str) -> Self:
        segments = _validated_segments(text, at_least=1)
        if len(segments) > 1:
            raise MalformedIdentifierError(
                f"{text!r} is not a level identifier: a level is a single segment, "
                f"with no {SEGMENT_SEPARATOR!r}"
            )
        return super().__new__(cls, text)


class CandidateId(Identifier):
    """The identity of a place: `country.portugal`, `city.portugal.lisbon`.

    Permanent. A rename changes the display name and leaves this alone (`arch.md` 3.2a),
    which is why nothing here derives an identifier from a name.
    """

    __slots__ = ()

    def __new__(cls, text: str) -> Self:
        _validated_segments(text, at_least=2)
        return super().__new__(cls, text)

    @classmethod
    def build(
        cls,
        *,
        level: str,
        own_segment: str,
        parent: "CandidateId | None" = None,
    ) -> Self:
        """Compose an identifier from the level, the parent it sits in, and one new segment.

        `build(level="city", own_segment="lisbon", parent=CandidateId("country.portugal"))`
        gives `city.portugal.lisbon`. With no parent the result is a top-level identifier.
        """
        inherited = parent.qualifying_path if parent is not None else ()
        return cls(SEGMENT_SEPARATOR.join((LevelId(level), *inherited, own_segment)))

    @property
    def level_id(self) -> LevelId:
        """The level this identifier claims to sit at -- `country` for `country.portugal`."""
        return LevelId(self.split(SEGMENT_SEPARATOR)[0])

    @property
    def qualifying_path(self) -> tuple[str, ...]:
        """Everything after the level: `('portugal', 'lisbon')` for `city.portugal.lisbon`."""
        return tuple(self.split(SEGMENT_SEPARATOR)[1:])

    @property
    def own_segment(self) -> str:
        """The last segment -- the part that names this place rather than its containers."""
        return self.qualifying_path[-1]

    def parent_id(self, parent_level: str) -> "CandidateId":
        """The identifier the containing candidate must have, at the given level.

        `CandidateId("city.portugal.lisbon").parent_id("country")` is `country.portugal`.
        Raises `MalformedIdentifierError` when the identifier names no container at all.
        """
        inherited = self.qualifying_path[:-1]
        if not inherited:
            raise MalformedIdentifierError(f"{self!r} is top-level and names no parent")
        return CandidateId(SEGMENT_SEPARATOR.join((LevelId(parent_level), *inherited)))


def suggest_identifier_segment(display_name: str) -> str:
    """Propose a segment for a place being added for the first time.

    "United Kingdom" gives "united_kingdom". A convenience for whoever writes the seed
    migration, and nothing more.

    WARNING: never call this on a place that already has an identifier. Identifiers are not
    derived from display names and are never regenerated from them (`arch.md` 3.2a); doing
    so on a rename would break every reference to the place.

    Anything that will not spell in the identifier alphabet is refused rather than
    transliterated. "Türkiye" has more than one defensible answer, so a person picks it.
    """
    proposed = display_name.strip().lower().replace(" ", "_").replace("-", "_")
    if not _SEGMENT.fullmatch(proposed):
        raise MalformedIdentifierError(
            f"no identifier segment follows from {display_name!r} -- choose one by hand"
        )
    return proposed


_ALPHA_2 = re.compile(r"^[A-Z]{2}$")


class CountryCode(str):
    """An ISO 3166-1 alpha-2 code: `PT`, `GR`, `GB`.

    **Not an `Identifier`**, and the difference is the point. Every other name in this module is
    ours -- assigned once, permanent, and legible because we chose it that way. This one is
    ISO's, published and maintained by somebody else, and it is uppercase for the same reason
    `country.portugal` is lowercase: it is spelled the way its owner spells it.

    Two letters exactly, which is the whole of the alpha-2 grammar. That rules out the mistake
    worth ruling out -- an alpha-3 code, or a source's own spelling, in a column whose readers
    will treat it as the standard. `EL` for Greece and `UK` for the United Kingdom are Eurostat's
    conventions and are valid alpha-2 *shapes*, so this cannot catch them; the Eurostat adapter
    translates them, because whose spelling they are is a fact about Eurostat.

    The same rule as the database's `candidate_country_code_is_iso_3166_alpha_2` check, stated
    in both places for the reason `arch.md` 3.3b gives: the constraint fires with a violation,
    this fires with a sentence.
    """

    __slots__ = ()

    def __new__(cls, text: str) -> Self:
        if not _ALPHA_2.fullmatch(text):
            raise MalformedIdentifierError(
                f"{text!r} is not an ISO 3166-1 alpha-2 code: two uppercase letters, no more "
                "and no fewer"
            )
        return super().__new__(cls, text)

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        return core_schema.no_info_after_validator_function(cls, core_schema.str_schema())
