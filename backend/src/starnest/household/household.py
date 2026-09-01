"""Who is asking. The record everything else is measured against.

`reqs.md` 1.4 and 3.9. Several attributes mean nothing in the abstract and only relative to
this household: `city.cost_of_living_monthly` is an absolute figure that says nothing about
whether *you* can afford to live there, and the number of adults and children decides which
rent figure is even the right one to look at.

**It sits on the subjective side of the ontology** (`arch.md` 3.6) because it describes the
asker, not any candidate. Changing it changes criterion defaults, cross-attribute warnings and
match rules without touching a single measured value.

**Every place it names is a parameter, never a constant.** The home country is currently
Romania and is written down nowhere in this file (`reqs.md` 3.9). A different household with
different citizenship must need no code change -- which is also why nothing here mentions the
level names `country` or `city`: the checks are expressed against the identifier convention of
`arch.md` 3.2, so a hierarchy with different rungs would still be checked correctly
(`reqs.md` 3.1).
"""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.candidates import CandidateId

# The identifier convention says a candidate at the widest level is `<level>.<own segment>`
# and nothing else, so one qualifying segment is exactly what "not contained by anything"
# looks like. Naming the level here instead would be the constant this record must not have.
_SEGMENTS_QUALIFYING_A_TOP_LEVEL_CANDIDATE = 1


class HouseholdNotConfiguredError(LookupError):
    """Nothing has been recorded about the household yet.

    The household is the first thing configured when the application is opened
    (`reqs.md` 3.9), and its required fields -- income, size, home country -- cannot be
    invented on its behalf. So this is raised rather than an empty record returned: a
    fabricated household would silently make every affordability figure wrong.
    """


class HouseholdPlaceError(ValueError):
    """A place the household names is not where it could possibly be.

    A home city that is not inside the home country, a citizenship recorded at the level of
    cities, a home country that names a container it should not have. Every one of these
    reaches a match rule or a comparison baseline, where the mistake would show up as a
    plausible wrong answer rather than as an error.
    """


class Household(BaseModel):
    """The single record describing you: income, size, spending ceilings, home, citizenship.

    **There is one household and there is no way to say which one.** The record carries no
    identifier, and `HouseholdStore` takes none -- so a second household is not merely
    discouraged, there is nowhere to put it and nothing that could tell two apart. An `id`
    field is precisely the thing that would make a second one meaningful, and the database
    agrees from the other side with `CHECK (id = 1)`.

    Immutable, because a change to it must reach criterion defaults, warnings and match rules
    at once (`reqs.md` 3.9); replacing the whole record is what makes that a single event.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    net_income: Decimal = Field(
        ge=0, description="Estimated monthly net income for the whole household, in EUR."
    )
    number_adults: int = Field(ge=1, description="A household with no adult is not one.")
    number_children: int = Field(ge=0, description="Children under 18.")

    # Guideline ceilings, provisional in `reqs.md` 3.9 and therefore optional and never
    # defaulted. The ~2000-3000 EUR/month figure in the document is an illustration of the
    # user's current thinking, not a value this code may adopt (devplan.md 0.3).
    target_monthly_spend: Decimal | None = Field(
        default=None, ge=0, description="Guideline ceiling on total household spend, in EUR."
    )
    max_rent: Decimal | None = Field(default=None, ge=0, description="Rent ceiling, in EUR.")

    home_country_candidate: CandidateId = Field(
        description="Where you live now. The comparison baseline, scored like any other."
    )
    home_city_candidate: CandidateId | None = Field(
        default=None, description="The reference city for travel connections."
    )
    citizenships: frozenset[CandidateId] = Field(
        min_length=1,
        description=(
            "Which citizenships the household holds. At least one: free movement and visa "
            "rules are decided by this, and an empty set would let every such gate pass or "
            "fail silently."
        ),
    )

    @model_validator(mode="after")
    def _enforce_that_the_places_it_names_could_be_a_home(self) -> "Household":
        """Refuse a set of places that cannot describe a real home.

        Checked here rather than trusted from the database because two of the three faults
        -- a home city in the wrong country, a citizenship at the wrong level -- are foreign
        keys the schema accepts perfectly happily: `candidate` is one table for every level.

        Like the rest of the domain, the error raised is a `ValueError`, so Pydantic reports
        it wrapped in a `ValidationError` and `except ValueError` still catches it.
        """
        self._reject_a_home_country_that_is_contained_by_something()
        self._reject_a_citizenship_from_another_level()
        self._reject_a_home_city_outside_the_home_country()
        return self

    def _reject_a_home_country_that_is_contained_by_something(self) -> None:
        home = self.home_country_candidate
        if len(home.qualifying_path) != _SEGMENTS_QUALIFYING_A_TOP_LEVEL_CANDIDATE:
            raise HouseholdPlaceError(
                f"{home!r} is qualified by a container, so it names somewhere inside a "
                "country rather than a country; the home country sits at the widest level"
            )

    def _reject_a_citizenship_from_another_level(self) -> None:
        home_level = self.home_country_candidate.level_id
        for citizenship in sorted(self.citizenships):
            if citizenship.level_id != home_level:
                raise HouseholdPlaceError(
                    f"citizenship {citizenship!r} is at level {citizenship.level_id!r}, but "
                    f"citizenship is held of a place at level {home_level!r}"
                )
            if len(citizenship.qualifying_path) != _SEGMENTS_QUALIFYING_A_TOP_LEVEL_CANDIDATE:
                raise HouseholdPlaceError(
                    f"citizenship {citizenship!r} is qualified by a container, so it does "
                    "not name a country"
                )

    def _reject_a_home_city_outside_the_home_country(self) -> None:
        home_city = self.home_city_candidate
        if home_city is None:
            return
        home_country = self.home_country_candidate
        if home_city.level_id == home_country.level_id:
            raise HouseholdPlaceError(
                f"{home_city!r} is at the same level as the home country {home_country!r}, "
                "so it cannot be a place within it"
            )
        contained = CandidateId.build(
            level=home_city.level_id,
            own_segment=home_city.own_segment,
            parent=home_country,
        )
        if contained != home_city:
            raise HouseholdPlaceError(
                f"the home city {home_city!r} does not sit inside the home country "
                f"{home_country!r}; a city of that name there would be {contained!r}"
            )

    @property
    def size(self) -> int:
        """How many people the money has to cover. Sets the dwelling size and cost basket."""
        return self.number_adults + self.number_children

    @property
    def has_children(self) -> bool:
        """Whether the `family` pillar is scored against a real need (`reqs.md` 3.9)."""
        return self.number_children > 0

    def is_home_country(self, candidate_id: CandidateId) -> bool:
        """Whether this candidate is where you live now -- the baseline "stay put" answer.

        The home country is nominated and scored like any other candidate *and* used as the
        anchor a comparison is read against, which is what makes staying measurable.
        """
        return candidate_id == self.home_country_candidate

    def holds_citizenship_of(self, candidate_id: CandidateId) -> bool:
        """Whether the household holds this citizenship -- what free movement turns on."""
        return candidate_id in self.citizenships
