"""The World Health Organization, for the one attribute in the health pillar.

WHO publishes the Global Health Observatory as an unauthenticated OData service, keyed on
**ISO 3166-1 alpha-3** rather than the alpha-2 the rest of this system reads first. That
translation is not done here: alpha-3 is the same standard's other form, not a WHO dialect, so
it lives on the candidate as catalog data (migration `0440`) where FAO, UNODC and Protected
Planet will find it too. Contrast `data_sources/eurostat/geography`, which does translate,
because `EL` for Greece really is Eurostat's own spelling.
"""

from starnest.data_sources.who.adapter import WHO, WhoAdapter
from starnest.data_sources.who.manifest import BASE_URL, INDICATORS
from starnest.data_sources.who.response import Reading, WhoError, readings

__all__ = [
    "BASE_URL",
    "INDICATORS",
    "WHO",
    "Reading",
    "WhoAdapter",
    "WhoError",
    "readings",
]
