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

ISO_FOR_EUROSTAT = MappingProxyType({"EL": "GR", "UK": "GB"})
"""Eurostat's code to ISO's, for the two that differ. Everything else is already ISO."""

EUROSTAT_FOR_ISO = MappingProxyType({iso: eurostat for eurostat, iso in ISO_FOR_EUROSTAT.items()})


def iso_code_for(eurostat_code: str) -> str:
    """The ISO alpha-2 code for one of Eurostat's geo codes."""
    return ISO_FOR_EUROSTAT.get(eurostat_code, eurostat_code)


def eurostat_code_for(iso_code: str) -> str:
    """The code to ask Eurostat for, given the one stored on the candidate."""
    return EUROSTAT_FOR_ISO.get(iso_code, iso_code)
