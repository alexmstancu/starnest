"""Something knowable about a candidate, and the declarations that go with it.

`reqs.md` 3.3. An attribute says what is measured, in what unit, how fast it goes stale, and
what a credible value looks like. It says **nothing** about whether more is better, what would
be unacceptable, or how much it matters -- all three are a criterion, and a criterion lives in
the other half of the model.

**The catalog is data.** Nothing in this module names an attribute, a pillar or a weight: the
rows are seeded by migration (`arch.md` 1.2), and adding an attribute must be a data change
rather than a logic change. What lives here is only the shape a row has to have.
"""

from collections.abc import Iterable
from datetime import date, timedelta
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.candidates import LevelId
from starnest.data.identifiers import (
    AttributeId,
    BreakdownSchemeId,
    PillarId,
    UnitId,
)
from starnest.data.payloads import (
    AssignedScore,
    Count,
    Index,
    LabelSet,
    Monetary,
    Payload,
    Quantity,
    Ratio,
    ValueType,
)
from starnest.data.reference_period import ReferencePeriod
from starnest.data.sources import DataSource, SourcePriority, SourcePriorityOverride


class ValueTypeMismatchError(ValueError):
    """A payload was offered to an attribute that declares a different type.

    Not a rejection but an error, and the distinction matters. A rejected value is a real
    figure that is not credible; this is a figure of the wrong shape entirely, which the
    database refuses at insert through the composite foreign key of `arch.md` 3.3b. There is
    nothing to store and nothing to explain to a reader.
    """


class AttributeDeclarationError(ValueError):
    """A catalog row declares something its value type has no meaning for."""


class LifecycleStatus(StrEnum):
    """Whether an attribute is still scored.

    A retired attribute drops out of scoring while its values keep pointing at a row that
    still exists. Deleting it instead would break every value behind it, which is why nothing
    in this application deletes catalog rows (`arch.md` 2).
    """

    ACTIVE = "active"
    RETIRED = "retired"


class Pillar(BaseModel):
    """A load-bearing vertical of a life: economics, housing, safety, nature.

    Carries no level. The same eleven concerns apply at every level and only their weights
    differ -- and a weight belongs to a criteria set, not to the pillar (`reqs.md` 7).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: PillarId
    name: str = Field(min_length=1)
    description: str | None = None


class AllowedRange(BaseModel):
    """Per-attribute bounds on a credible figure -- rent above zero, temperature above -20.

    **This is validation, not a matching threshold**, and conflating the two lets a scraper bug
    silently rule out a country (`reqs.md` 3.3a). A value outside these bounds is not
    believable; a value outside a *matching threshold* is believable and unacceptable, which is
    an entirely different report.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    min_value: Decimal | None = Field(default=None, allow_inf_nan=False)
    max_value: Decimal | None = Field(default=None, allow_inf_nan=False)

    @model_validator(mode="after")
    def _reject_a_range_that_bounds_nothing(self) -> "AllowedRange":
        if self.min_value is None and self.max_value is None:
            raise AttributeDeclarationError("an allowed range declares at least one bound")
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value > self.max_value
        ):
            raise AttributeDeclarationError(
                f"an allowed range runs low to high, and this one runs "
                f"{self.min_value} to {self.max_value}"
            )
        return self

    def excludes(self, number: Decimal) -> bool:
        """Whether this figure falls outside the bounds, either end counting as inside."""
        if self.min_value is not None and number < self.min_value:
            return True
        return self.max_value is not None and number > self.max_value

    def __str__(self) -> str:
        low = "any" if self.min_value is None else str(self.min_value)
        high = "any" if self.max_value is None else str(self.max_value)
        return f"{low} to {high}"


class QuantityParameters(BaseModel):
    """The dimension a `Quantity` attribute is measured in."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    unit: UnitId


class IndexParameters(BaseModel):
    """The provider and bounds an `Index` attribute is published on.

    Declaring them on the attribute is what lets an index rescale deterministically, with no
    anchors anyone has to invent (`reqs.md` 3.3a).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: str = Field(min_length=1)
    scale_min: Decimal = Field(allow_inf_nan=False)
    scale_max: Decimal = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def _reject_a_scale_that_does_not_run_upwards(self) -> "IndexParameters":
        if self.scale_min >= self.scale_max:
            raise AttributeDeclarationError(
                f"an index scale runs low to high, and this one runs "
                f"{self.scale_min} to {self.scale_max}"
            )
        return self


class RatioParameters(BaseModel):
    """What a `Ratio` attribute is a share of."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    basis: str = Field(min_length=1)


class Attribute(BaseModel):
    """One row of the catalog: what is measured, how it is typed, how fast it ages.

    Immutable, and its `value_type` doubly so: changing the type of an attribute means
    creating a new attribute and retiring the old one, because every stored value restates the
    type and a change would strand them (`arch.md` 2).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: AttributeId
    name: str = Field(min_length=1)
    level: LevelId
    value_type: ValueType
    pillar: PillarId | None = Field(
        default=None,
        description=(
            "Null for a descriptive attribute -- population, timezone, coastline -- which "
            "ships with no criterion and is displayed but never scored (`reqs.md` 3.3)."
        ),
    )
    description: str | None = None
    max_age: timedelta | None = Field(
        default=None,
        gt=timedelta(0),
        description=(
            "How quickly this kind of data goes stale. Objective: rent ages in months "
            "whoever is asking. None means it never goes stale -- a coastline does not."
        ),
    )
    manual_entry: bool = Field(
        default=False, description="Whether a value may be typed by hand. Forbidden by default."
    )
    lifecycle_status: LifecycleStatus = LifecycleStatus.ACTIVE
    breakdown_scheme: BreakdownSchemeId | None = Field(
        default=None,
        description=(
            "What this attribute is broken down by, when one figure is not enough: rent by "
            "bedroom count, cost of living by occupancy (`reqs.md` 3.3b)."
        ),
    )
    quantity_parameters: QuantityParameters | None = None
    index_parameters: IndexParameters | None = None
    ratio_parameters: RatioParameters | None = None
    allowed_range: AllowedRange | None = None
    allowed_labels: tuple[str, ...] = ()
    source_priority_overrides: tuple[SourcePriorityOverride, ...] = ()

    @model_validator(mode="after")
    def _enforce_what_the_declaration_may_contain(self) -> "Attribute":
        """Refuse a row that declares something its type cannot mean.

        Catalog rows arrive from seed migrations, where index bounds on a ratio or a label
        vocabulary on a boolean is an easy and silent mistake. The parameters are *optional*
        -- the seeded catalog has index attributes that declare no bounds -- so what is
        checked is that nothing of the wrong kind is attached, never that something is
        present.
        """
        if self.id.level_id != self.level:
            raise AttributeDeclarationError(
                f"{self.id!r} names an attribute at level {self.id.level_id!r} "
                f"but is recorded at level {self.level!r}"
            )
        self._reject_parameters_of_another_type()
        if self.allowed_labels and self.value_type is not ValueType.LABEL_SET:
            raise AttributeDeclarationError(
                f"{self.id!r} is {self.value_type} and declares allowed labels, which only a "
                f"{ValueType.LABEL_SET} draws from"
            )
        if self.allowed_range is not None and self.value_type not in _TYPES_WITH_A_NUMBER:
            raise AttributeDeclarationError(
                f"{self.id!r} is {self.value_type}, which has no number for an allowed range "
                "to bound"
            )
        return self

    def _reject_parameters_of_another_type(self) -> None:
        declared = {
            ValueType.QUANTITY: self.quantity_parameters,
            ValueType.INDEX: self.index_parameters,
            ValueType.RATIO: self.ratio_parameters,
        }
        for value_type, parameters in declared.items():
            if parameters is not None and self.value_type is not value_type:
                raise AttributeDeclarationError(
                    f"{self.id!r} is {self.value_type} and cannot declare {value_type} parameters"
                )

    @property
    def is_scored(self) -> bool:
        """Whether any criterion could judge this attribute.

        A descriptive attribute -- one with no pillar -- is displayed and never scored. This
        says only that it belongs to a vertical; whether a criterion *does* judge it is a
        question for the criteria set, and this module does not get to ask it.
        """
        return self.pillar is not None

    @property
    def is_retired(self) -> bool:
        """Whether the attribute has been withdrawn from scoring, its values still standing."""
        return self.lifecycle_status is LifecycleStatus.RETIRED

    @property
    def is_broken_down(self) -> bool:
        """Whether one figure is not enough and values arrive per breakdown option."""
        return self.breakdown_scheme is not None

    def has_gone_stale(self, period: ReferencePeriod, *, on: date) -> bool:
        """Whether a figure describing `period` has aged past `max_age` by `on`."""
        return period.has_aged_past(self.max_age, on=on)

    def effective_source_priority(self, sources: Iterable[DataSource]) -> SourcePriority:
        """The order sources are consulted for this attribute, overrides applied.

        The whole resolved order, not just the promoted part: this is what the interface
        displays and what the active-value rule ranks on.
        """
        return SourcePriority(sources=sources, overrides=self.source_priority_overrides)

    def rejection_reason_for(self, payload: Payload) -> str | None:
        """Why this figure is not credible for this attribute, or `None` when it is.

        The **attribute-explicit** layer of validation (`reqs.md` 3.3a): the type-implicit
        rules are already enforced by the payload itself, which cannot be constructed in
        violation of them.

        Returns a reason rather than raising, because a rejected value is not an accident to
        be handled -- it is stored, with this sentence in `rejection_reason`, and stays
        visible beside the values that were accepted. Nothing is ever discarded.
        """
        if payload.value_type is not self.value_type:
            raise ValueTypeMismatchError(
                f"{self.id!r} is declared {self.value_type} and was offered a "
                f"{payload.value_type} payload"
            )
        if self.allowed_range is not None:
            number = _number_carried_by(payload)
            if number is not None and self.allowed_range.excludes(number):
                return (
                    f"{number} is outside the credible range {self.allowed_range} "
                    f"declared for {self.id}"
                )
        if self.allowed_labels and isinstance(payload, LabelSet):
            unknown = [label for label in payload.labels if label not in self.allowed_labels]
            if unknown:
                return (
                    f"{unknown} is not in the vocabulary {self.id} draws from"
                    if len(unknown) == 1
                    else f"{unknown} are not in the vocabulary {self.id} draws from"
                )
        return None


_TYPES_WITH_A_NUMBER = frozenset(
    {
        ValueType.MONETARY,
        ValueType.QUANTITY,
        ValueType.COUNT,
        ValueType.RATIO,
        ValueType.INDEX,
        ValueType.ASSIGNED_SCORE,
    }
)


def _number_carried_by(payload: Payload) -> Decimal | None:
    """The one figure an allowed range can bound, or `None` for a type that carries none.

    A monetary value is bounded on its **EUR equivalent** rather than on the published
    amount. The range is declared once for the attribute and values arrive in whatever
    currency the source publishes, so a bound written against forint would reject euro and a
    bound written against euro would reject forint.

    The final case is unreachable today -- an allowed range may only be declared on a type
    that carries a number -- and is kept for the eleventh value type, so adding one means a
    range that quietly does not apply rather than a crash in the middle of a run.
    """
    match payload:
        case Monetary():
            return payload.amount_eur
        case Quantity():
            return payload.magnitude
        case Count():
            return Decimal(payload.count)
        case Ratio() | Index() | AssignedScore():
            return payload.value
        case _:
            return None
