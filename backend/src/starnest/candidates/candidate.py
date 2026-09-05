"""A place under evaluation, and the rule about what may contain what.

`reqs.md` 3.1. "City" means any locality regardless of size -- a village of 4,000 is as
valid a candidate as a capital.

**Almost nothing a place has ends up here, deliberately.** What is *known* about it is a set
of values against attributes. What it *scores*, whether it matches, and whether its parent
matched belong to an evaluation, because every one of those depends on which criteria set
was used -- storing them here would mean one set's answer silently overwriting another's.
There is no status field and no `parent_not_matching` flag for the same reason.
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from starnest.candidates.identifiers import CandidateId, CountryCode, LevelId
from starnest.candidates.levels import Level


class NestingError(ValueError):
    """A candidate is not placed where the levels say it may be placed.

    Covers the whole triple `(id, level, parent_candidate)`, because the identifier
    convention *is* the hierarchy written down: `city.portugal.lisbon` says the same thing
    about containment that `parent_candidate = country.portugal` says, and the two
    disagreeing is the same fault as a city parented to a city.
    """


class Candidate(BaseModel):
    """A country or a city: somewhere that could be moved to.

    Immutable, because the identifier is. Renaming produces a new object through
    `renamed_to`, which keeps the identifier and cannot be talked out of it.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: CandidateId
    name: str
    level: Level
    parent_candidate: CandidateId | None = None
    country_code: CountryCode | None = Field(
        default=None,
        description="ISO 3166-1 alpha-2, for a country. None for a city, whose country is its "
        "parent, and None for a country nobody has recorded one for yet.",
    )

    @field_validator("name")
    @classmethod
    def _reject_a_blank_name(cls, name: str) -> str:
        """A place needs a label to appear under. Surrounding whitespace is not one."""
        labelled = name.strip()
        if not labelled:
            raise ValueError("a candidate needs a display name")
        return labelled

    @model_validator(mode="after")
    def _enforce_the_nesting_rule(self) -> "Candidate":
        """The hierarchy is enforced, not assumed (`reqs.md` 3.1).

        Candidates arrive from seed migrations, where a city recorded as the parent of
        another city is an easy and silent mistake. It is refused here rather than
        discovered later, inside a ranking that quietly makes no sense.
        """
        self._reject_an_identifier_from_another_level()
        if self.level.is_top_level:
            self._reject_a_parent_the_widest_level_cannot_have()
        else:
            self._reject_a_parent_at_the_wrong_level()
        return self

    def _reject_an_identifier_from_another_level(self) -> None:
        if self.id.level_id != self.level.id:
            raise NestingError(
                f"{self.id!r} names a candidate at level {self.id.level_id!r} "
                f"but is recorded at level {self.level.id!r}"
            )

    def _reject_a_parent_the_widest_level_cannot_have(self) -> None:
        if self.parent_candidate is not None:
            raise NestingError(
                f"{self.id!r} is at the widest level {self.level.id!r}, so it cannot be "
                f"contained by {self.parent_candidate!r}"
            )
        if len(self.id.qualifying_path) != 1:
            raise NestingError(
                f"{self.id!r} is qualified by a container, but level {self.level.id!r} "
                "is contained by nothing"
            )

    def _reject_a_parent_at_the_wrong_level(self) -> None:
        required_level = self.level.parent_level
        parent = self.parent_candidate
        if parent is None:
            raise NestingError(
                f"{self.id!r} is at level {self.level.id!r}, which is contained by "
                f"{required_level!r}, so it must name a parent"
            )
        if parent.level_id != required_level:
            raise NestingError(
                f"{self.id!r} must be contained by a candidate at level {required_level!r}, "
                f"but {parent!r} is at level {parent.level_id!r}"
            )
        qualified = CandidateId.build(
            level=self.level.id, own_segment=self.id.own_segment, parent=parent
        )
        if qualified != self.id:
            raise NestingError(
                f"{self.id!r} does not repeat the path of its parent {parent!r}; "
                f"the identifier for this place is {qualified!r}"
            )

    @property
    def parent_level(self) -> LevelId | None:
        """The level the parent must be at, taken from the level record (`reqs.md` 3.1).

        Derived rather than stored. The database keeps a column for it so that a single
        composite foreign key can check the pair `(level, parent_level)`; a second copy
        held in memory would be a thing that can disagree with the level record, and a
        derived one cannot.
        """
        return self.level.parent_level

    @property
    def is_top_level(self) -> bool:
        """Whether this candidate is contained by nothing -- true of every country."""
        return self.level.is_top_level

    def contains(self, other: "Candidate") -> bool:
        """Whether `other` sits directly inside this candidate."""
        return other.parent_candidate == self.id

    def renamed_to(self, name: str) -> "Candidate":
        """The same place under a new label.

        Czechia, Türkiye, Eswatini. The identifier is deliberately not a parameter: it is
        assigned once and permanent, so a rename cannot reach it even by accident
        (`arch.md` 3.2a).
        """
        return Candidate(
            id=self.id,
            name=name,
            level=self.level,
            parent_candidate=self.parent_candidate,
            country_code=self.country_code,
        )
