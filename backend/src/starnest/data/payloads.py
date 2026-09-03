"""The ten value types, and what each of them actually stores.

`reqs.md` 3.3a. The type is **semantic, not structural**: rent and temperature are both
numbers and behave nothing alike. It decides what a value carries, which normalisation methods
are legal, how it displays, and what a matching threshold means -- the last three are read
elsewhere, and only the first is settled here.

**One class per type, discriminated by the type itself.** The shape mirrors the schema exactly
(`arch.md` 3.3): a parent value with typed children, each child pinning its own `value_type` so
only the monetary payload can attach to a monetary value. Here the same pin is a `Literal`
field, so the union below cannot be mis-tagged and `Value` can check the payload against the
type the attribute declared -- the second link of the type-agreement chain, in Python.

**Why not one class with nullable fields**, which is the obvious alternative: a value must never
carry fields its type has no meaning for. Zurich's rent stored as a bare count is `2900` with no
currency, so the conversion to EUR never runs, and the ranking then compares 2900 against
Lisbon's 1410 and reports a gap that is simply wrong -- with every provenance field correctly
filled in and nothing looking broken. Ten classes make that unrepresentable rather than
unlikely.

Every rule enforced below is a **type-implicit** one, true of the type wherever it is used.
Rules that vary per attribute -- rent must be positive, temperature may be negative -- are
declared on the `Attribute` and applied there.
"""

from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.data.fx import EURO, CurrencyMismatchError, FxRate
from starnest.data.identifiers import CurrencyCode, UnitId


class ValueType(StrEnum):
    """The ten archetypes, spelled as the `value_type` reference table spells them.

    Adding one is a developer change -- it needs a class here and a payload table in a
    migration. Adding an attribute *of an existing type* stays a pure data change.
    """

    MONETARY = "Monetary"
    QUANTITY = "Quantity"
    COUNT = "Count"
    RATIO = "Ratio"
    INDEX = "Index"
    LABEL_SET = "LabelSet"
    SHARE_COMPOSITION = "ShareComposition"
    BOOLEAN = "Boolean"
    ASSIGNED_SCORE = "AssignedScore"
    TEXT = "Text"


class MalformedPayloadError(ValueError):
    """A payload breaks a rule that is true of its type wherever the type is used."""


SHARE_SUM_TOLERANCE = Decimal("0.5")
"""How far a `ShareComposition` may sum from 100 and still be accepted.

`reqs.md` 3.3a asks for a tolerance and does not name one. Half a percentage point is what
published compositions actually drift by: providers round each share to whole or single-decimal
percent, so a dozen categories accumulate a few tenths of rounding. Wide enough to accept an
honest table, narrow enough that a missing category -- the failure worth catching -- still
fails.
"""

FX_CONVERSION_TOLERANCE = Decimal("0.0001")
"""How far `amount * fx_rate` may sit from the stored `amount_eur`, as a fraction of it.

**Relative rather than absolute, because the drift scales with the figure.** A published rate
carries a fixed number of digits -- the ECB quotes five -- so converting a larger amount
through it accumulates proportionally more rounding, and the converted figure is usually stored
rounded to the cent besides. One hundredth of a percent absorbs both.

It is orders of magnitude narrower than the failure worth catching: a foreign amount copied
into `amount_eur` unconverted is out by the whole rate, not by a rounding of it.
"""


class Payload(BaseModel):
    """What one value holds, beyond the provenance every value carries.

    Frozen, like everything else on the objective side: a stored value is never updated, so a
    payload that could be edited in memory would only ever be a way to lie about what was
    stored.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    value_type: ValueType


class Monetary(Payload):
    """An amount of money, as issued, with its EUR equivalent and the rate that produced it.

    Non-negativity is deliberately **not** a rule here: a net income after tax or a budget
    balance may legitimately be negative (`reqs.md` 3.3a). Every monetary attribute in the
    catalog that is a cost declares `> 0` for itself, in its allowed range.
    """

    value_type: Literal[ValueType.MONETARY] = ValueType.MONETARY

    amount: Decimal = Field(allow_inf_nan=False, description="The published figure, as issued.")
    currency: CurrencyCode
    amount_eur: Decimal = Field(allow_inf_nan=False)
    fx_rate: Decimal | None = Field(default=None, gt=0, allow_inf_nan=False)
    fx_rate_date: date | None = None

    @model_validator(mode="after")
    def _reject_a_conversion_that_cannot_be_audited(self) -> "Monetary":
        """A converted figure must name the rate and the day, and a rate must be dated.

        Both halves matter: an undated rate cannot be checked against what was published, and
        a foreign amount with no rate is a EUR figure nobody can reproduce.
        """
        if (self.fx_rate is None) != (self.fx_rate_date is None):
            raise MalformedPayloadError(
                "an exchange rate and its date are stored together or not at all"
            )
        if self.currency != EURO and self.fx_rate is None:
            raise MalformedPayloadError(
                f"{self.currency} had to be converted to {EURO}, so the rate must be recorded"
            )
        self._reject_a_euro_figure_the_rate_does_not_produce()
        return self

    def _reject_a_euro_figure_the_rate_does_not_produce(self) -> None:
        """The recorded rate has to explain the recorded EUR figure, or it explains nothing.

        Storing a rate that was never applied is worse than storing none: the provenance reads
        as complete, so a CHF rent copied straight into `amount_eur` -- the likeliest adapter
        mistake -- compares directly against a EUR figure and nothing looks broken.

        The multiplication is restated here rather than borrowed from `converted()`, which
        builds an `FxRate`: that record requires the source that published the rate, and a
        `Monetary` does not carry one. One multiplication is cheaper than inventing a source
        to satisfy a constructor, and the direction it must run in is the one thing worth
        stating -- an inverted rate is off by the square of itself.
        """
        if self.currency == EURO and self.amount_eur != self.amount:
            raise MalformedPayloadError(
                f"{self.amount} is already in EUR, so its EUR equivalent is the same figure, "
                f"not {self.amount_eur}"
            )
        if self.fx_rate is None:
            return
        converted = self.amount * self.fx_rate
        if abs(converted - self.amount_eur) > abs(self.amount_eur) * FX_CONVERSION_TOLERANCE:
            raise MalformedPayloadError(
                f"{self.amount} {self.currency} at {self.fx_rate} does not produce "
                f"{self.amount_eur} {EURO} but {converted}; the stored rate has to be the one "
                "the conversion actually used"
            )

    @classmethod
    def in_euro(cls, amount: Decimal) -> Self:
        """A figure already published in EUR, which needs no rate and gets none."""
        return cls(amount=amount, currency=EURO, amount_eur=amount)

    @classmethod
    def converted(cls, amount: Decimal, *, rate: FxRate) -> Self:
        """A figure published in `rate.base_currency`, converted to EUR through `rate`.

        The currency comes from the rate rather than from a second argument, so an amount can
        never be converted by a rate that does not apply to it.
        """
        if rate.quote_currency != EURO:
            raise CurrencyMismatchError(
                f"a value is converted to {EURO}, and this rate quotes {rate.quote_currency}"
            )
        return cls(
            amount=amount,
            currency=rate.base_currency,
            amount_eur=rate.convert(amount),
            fx_rate=rate.rate,
            fx_rate_date=rate.rate_date,
        )

    @property
    def is_native_euro(self) -> bool:
        """Whether the published figure was already in EUR, so nothing was converted."""
        return self.currency == EURO


class Quantity(Payload):
    """A magnitude with a dimension: 12.4 celsius, 340 km, 68 mbps.

    The unit is an identifier from the `unit` vocabulary rather than free text, because a
    comparison between two quantities is meaningful only if the units agree, and "km" and
    "kilometres" would not.
    """

    value_type: Literal[ValueType.QUANTITY] = ValueType.QUANTITY

    magnitude: Decimal = Field(allow_inf_nan=False)
    unit: UnitId


class Count(Payload):
    """A whole number of things, optionally per something: 47 protected areas, per km2.

    Non-negative always -- there is no such thing as minus three national parks -- which is a
    property of counting rather than of any particular attribute, so it belongs here.
    """

    value_type: Literal[ValueType.COUNT] = ValueType.COUNT

    count: int = Field(ge=0)
    basis: str | None = Field(
        default=None, description="What it is counted per: `per_capita`, `per_km2`. Often none."
    )


class Ratio(Payload):
    """A share of something, on 0-100, that names what it is a share of.

    The basis is required. A bare "23.4%" is not a measurement -- 23.4% of the workforce and
    23.4% of the land area are different facts, and only the basis distinguishes them.
    """

    value_type: Literal[ValueType.RATIO] = ValueType.RATIO

    value: Decimal = Field(ge=0, le=100, allow_inf_nan=False)
    basis: str = Field(min_length=1, description="What the share is of: `total_employment`.")


class Index(Payload):
    """A published index, carrying the scale it is published on.

    The scale travels with the number because an index means nothing without it: 72 on Numbeo's
    0-100 safety index and 0.72 on the World Bank's -2.5 to 2.5 governance scale are not
    comparable, and only the declared bounds say so. They are also what lets the value be
    rescaled deterministically, with no anchors anyone has to invent.
    """

    value_type: Literal[ValueType.INDEX] = ValueType.INDEX

    value: Decimal = Field(allow_inf_nan=False)
    provider: str = Field(min_length=1, description="Who publishes the index.")
    scale_min: Decimal = Field(allow_inf_nan=False)
    scale_max: Decimal = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def _reject_a_value_outside_the_scale_it_declares(self) -> "Index":
        if self.scale_min >= self.scale_max:
            raise MalformedPayloadError(
                f"an index scale runs from low to high, and this one runs "
                f"{self.scale_min} to {self.scale_max}"
            )
        if not self.scale_min <= self.value <= self.scale_max:
            raise MalformedPayloadError(
                f"{self.value} is outside the {self.provider} scale "
                f"{self.scale_min}-{self.scale_max} it claims to sit on"
            )
        return self


class LabelSet(Payload):
    """A set of labels: the Koeppen zones present, the tax treaties in force.

    Non-empty, because an empty set is not a measurement -- it is the absence of one, and the
    absence of one is expressed by having no value at all rather than by an empty answer that
    coverage would count. Which labels are *permitted* is declared per attribute, not here.
    """

    value_type: Literal[ValueType.LABEL_SET] = ValueType.LABEL_SET

    labels: tuple[str, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _reject_blank_or_repeated_labels(self) -> "LabelSet":
        if any(not label.strip() for label in self.labels):
            raise MalformedPayloadError("a label set holds labels, and a blank string is not one")
        if len(set(self.labels)) != len(self.labels):
            raise MalformedPayloadError(f"the same label appears twice in {list(self.labels)}")
        return self


class Share(BaseModel):
    """One slice of a composition: a label and the percentage it accounts for."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    label: str = Field(min_length=1)
    share: Decimal = Field(ge=0, le=100, allow_inf_nan=False)


class ShareComposition(Payload):
    """A distribution over labels summing to 100: religious composition, ethnic composition.

    **It cannot be scored as it stands**, and nothing here reduces it. A criterion judging a
    composition must first reduce it to a number -- largest-group share, a diversity index --
    and having no reducer in this module is what forces that choice to be made explicitly
    rather than to happen by accident.
    """

    value_type: Literal[ValueType.SHARE_COMPOSITION] = ValueType.SHARE_COMPOSITION

    shares: tuple[Share, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def _reject_a_distribution_that_does_not_add_up(self) -> "ShareComposition":
        labels = [slice_.label for slice_ in self.shares]
        if len(set(labels)) != len(labels):
            raise MalformedPayloadError(f"the same label appears twice in {labels}")
        total = sum((slice_.share for slice_ in self.shares), start=Decimal(0))
        if abs(total - 100) > SHARE_SUM_TOLERANCE:
            raise MalformedPayloadError(
                f"the shares sum to {total}, not 100 -- a category is missing or double-counted"
            )
        return self


class Boolean(Payload):
    """A yes or a no: dual citizenship permitted, coastal.

    Nothing here says which answer is the good one. That is a criterion's mapping, and this
    module is the half of the model that does not know.
    """

    value_type: Literal[ValueType.BOOLEAN] = ValueType.BOOLEAN

    value: bool


class Assigner(StrEnum):
    """Who put a number on something that has no measurement: the model, or a person."""

    LLM = "llm"
    HUMAN = "human"


class AssignedScore(Payload):
    """A judgement rather than a measurement, recording who made it and why.

    The only value type that is not a fact about the world, which is why the assigner and the
    rationale travel with it: a number nobody can attribute is exactly what
    "never fabricate a score from missing data" forbids.
    """

    value_type: Literal[ValueType.ASSIGNED_SCORE] = ValueType.ASSIGNED_SCORE

    value: Decimal = Field(allow_inf_nan=False)
    range_min: Decimal = Field(allow_inf_nan=False)
    range_max: Decimal = Field(allow_inf_nan=False)
    assigned_by: Assigner
    rationale: str | None = None

    @model_validator(mode="after")
    def _reject_a_score_outside_the_range_it_declares(self) -> "AssignedScore":
        if self.range_min >= self.range_max:
            raise MalformedPayloadError(
                f"a score range runs from low to high, and this one runs "
                f"{self.range_min} to {self.range_max}"
            )
        if not self.range_min <= self.value <= self.range_max:
            raise MalformedPayloadError(
                f"{self.value} is outside the range {self.range_min}-{self.range_max} "
                "it was assigned on"
            )
        return self


class Text(Payload):
    """Prose: an administrative procedure, a supporting summary. Never scored directly."""

    value_type: Literal[ValueType.TEXT] = ValueType.TEXT

    body: str = Field(min_length=1)

    @model_validator(mode="after")
    def _reject_a_body_that_is_only_whitespace(self) -> "Text":
        if not self.body.strip():
            raise MalformedPayloadError("a text value with nothing in it says nothing")
        return self


ValuePayload = Annotated[
    Monetary
    | Quantity
    | Count
    | Ratio
    | Index
    | LabelSet
    | ShareComposition
    | Boolean
    | AssignedScore
    | Text,
    Field(discriminator="value_type"),
]
"""Any one payload, tagged by its own `value_type`.

The tag is what makes a payload parseable from storage or from the API without the reader
knowing which shape to expect, and what makes the wrong shape unrepresentable rather than
merely discouraged.
"""

PAYLOAD_CLASSES: Mapping[ValueType, type[Payload]] = {
    ValueType.MONETARY: Monetary,
    ValueType.QUANTITY: Quantity,
    ValueType.COUNT: Count,
    ValueType.RATIO: Ratio,
    ValueType.INDEX: Index,
    ValueType.LABEL_SET: LabelSet,
    ValueType.SHARE_COMPOSITION: ShareComposition,
    ValueType.BOOLEAN: Boolean,
    ValueType.ASSIGNED_SCORE: AssignedScore,
    ValueType.TEXT: Text,
}
"""Every type to the class that holds it. A test asserts the ten are all here."""


def payload_class_for(value_type: ValueType | str) -> type[Payload]:
    """The class that holds a value of this type.

    For a reader assembling a payload from a database row or a request body, where the type
    arrives as a string and the shape follows from it.
    """
    try:
        return PAYLOAD_CLASSES[ValueType(value_type)]
    except ValueError:
        raise MalformedPayloadError(
            f"{value_type!r} is not a value type; the ten are {[t.value for t in ValueType]}"
        ) from None
