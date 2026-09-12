"""The World Bank's second collection, against the real API. **Live, so never in `make check`.**

The adapter met the WGI first and was shaped by it: three series per attribute, in a databank
the request has to name, producing an `Index`. Forest cover is one series in the *default*
databank producing a `Ratio` -- so the generalisation is exactly the kind that passes every
stubbed test and fails against the publisher, because what it changed is the request.

**What only a live call can prove**: that `AG.LND.FRST.ZS` is the code the World Bank answers to,
that databank 2 is where it lives, and that it covers every candidate. A recorded fixture proves
the decoder reads a shape somebody already captured; it cannot prove the shape was asked for
correctly (`arch.md` 6.7).
"""

import httpx
import pytest

from starnest.candidates import Candidate
from starnest.data import Attribute, RatioParameters, ValueType
from starnest.data_sources.world_bank import WorldBankAdapter

pytestmark = pytest.mark.live

COUNTRY = {"id": "country", "depth_order": 1}

THE_THIRTY_TWO = (
    "AT",
    "BE",
    "BG",
    "HR",
    "CY",
    "CZ",
    "DK",
    "EE",
    "FI",
    "FR",
    "DE",
    "GR",
    "HU",
    "IS",
    "IE",
    "IT",
    "LV",
    "LI",
    "LT",
    "LU",
    "MT",
    "NL",
    "NO",
    "PL",
    "PT",
    "RO",
    "SK",
    "SI",
    "ES",
    "SE",
    "CH",
    "GB",
)
"""Every candidate's ISO code. Liechtenstein among them, which is where coverage usually thins."""


def a_forest_attribute() -> Attribute:
    """The catalog's own declaration, restated here because a live test has no database."""
    return Attribute(
        id="country.forest_cover",
        name="Forest cover",
        level="country",
        value_type=ValueType.RATIO,
        pillar="nature",
        ratio_parameters=RatioParameters(basis="land_area"),
    )


def the_candidates() -> list[Candidate]:
    return [
        Candidate(id=f"country.{code.lower()}", name=code, level=COUNTRY, country_code=code)
        for code in THE_THIRTY_TWO
    ]


async def test_forest_cover_answers_every_candidate_from_the_real_api() -> None:
    """All 32, as a share of land area, with no failures.

    **The figures are sanity-checked rather than pinned.** Finland is the most forested country
    in Europe and Malta among the least, and both hold across any year the World Bank might
    return -- where an exact percentage would fail the next time the series is revised, which
    says nothing about this code.
    """
    async with httpx.AsyncClient(timeout=40) as client:
        acquired = await WorldBankAdapter(client).fetch(a_forest_attribute(), the_candidates())

    assert acquired.failures == ()
    assert len(acquired.values) == len(THE_THIRTY_TWO)

    share = {str(value.candidate): value.payload.value for value in acquired.values}
    assert share["country.fi"] > 60, "Finland is the most forested country in Europe"
    assert share["country.mt"] < 5, "Malta is among the least forested"
    assert all(0 <= figure <= 100 for figure in share.values())


async def test_every_figure_names_what_it_is_a_share_of_and_which_publication() -> None:
    """A bare 32.7% is not a measurement, and a quote saying WGI about a WDI series would send a
    reader to the wrong publication to check it."""
    async with httpx.AsyncClient(timeout=40) as client:
        acquired = await WorldBankAdapter(client).fetch(a_forest_attribute(), the_candidates()[:3])

    for value in acquired.values:
        assert value.payload.basis == "land_area"
        assert value.quote is not None
        assert "World Bank WDI" in value.quote
        # The uncertainty series belong to the WGI and this indicator has none; claiming one
        # would be a statement about solidity that nobody published.
        assert "underlying source" not in value.quote
