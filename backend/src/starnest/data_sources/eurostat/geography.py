"""Eurostat's spelling of a country code, and where the difference belongs.

Two of Eurostat's geo codes are not ISO 3166-1 alpha-2: it writes **EL** for Greece, whose ISO
code is GR, and **UK** for the United Kingdom, whose ISO code is GB. Both are longstanding EU
statistical conventions rather than mistakes.

**The deviation lives here and the standard lives on the candidate.** `candidate.country_code`
holds ISO, because alpha-2 is a fact about the place that every future source will want; which
letters Eurostat happens to use is a fact about Eurostat. Putting EL in the database would make
that column a Eurostat column, and the next adapter would have to know whose standard the
"standard" code was.
"""

from types import MappingProxyType

EUROSTAT_FOR_ISO = MappingProxyType({"GR": "EL", "GB": "UK"})
"""ISO's code to Eurostat's, for the two that differ. Everything else is already the same.

One direction only. Candidates store ISO and we ask Eurostat for their figures, so that is the
translation this application makes; the inverse would be a function written to be exported
rather than called.
"""


def eurostat_code_for(iso_code: str) -> str:
    """The code to ask Eurostat for, given the one stored on the candidate."""
    return EUROSTAT_FOR_ISO.get(iso_code, iso_code)
