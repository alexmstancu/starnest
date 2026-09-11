"""Where a coordinate-bound source measures a country: its largest places, by population.

`devplan.md` D4, `reqs.md` Q210. Open-Meteo answers for a point on the map, and a national
figure is the population-weighted mean over the country's five largest places -- where people
live, which is where the household would. Reference geography from GeoNames, read from the
catalog like every other declaration, so the adapter restates none of it.
"""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from starnest.candidates import CandidateId


class PopulationCentre(BaseModel):
    """One place a country is measured at, and how much it counts."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    candidate: CandidateId
    name: str
    latitude: Decimal = Field(ge=-90, le=90)
    longitude: Decimal = Field(ge=-180, le=180)
    population: int = Field(gt=0, description="The place's weight in the country's mean.")
