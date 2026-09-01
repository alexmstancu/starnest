"""One measurement of one attribute for one candidate from one source.

`reqs.md` 3.6. **Values are never overwritten and never discarded.** A correction is a new
value that supersedes the old one through the active-value rule; a figure that fails validation
is stored carrying the reason it failed. Nothing in this module removes anything.

**Two dates, never merged.** The reference period is the span in the world the figure describes
and is a pair of plain dates; the retrieval date is the instant the application fetched it and
is a timezone-aware moment. They are different types precisely so that displaying one where the
other belongs is not something a caller can do by accident (`arch.md` 9.6).

**Being active is not here, and could not be.** Which value scoring reads is a comparison
between values rather than a fact about one, so it is computed on read (`active_value.py`). The
only lifecycle state a value stores is its rejection, which is decided once at insert and never
changes because another value appeared.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from starnest.candidates import CandidateId
from starnest.data.confidence import ConfidenceLevel
from starnest.data.identifiers import AttributeId, BreakdownOptionId, DataSourceId
from starnest.data.payloads import ValuePayload, ValueType
from starnest.data.reference_period import ReferencePeriod


class MalformedValueError(ValueError):
    """A value contradicts itself: its payload, its level, or what it says about its own state."""


class Value(BaseModel):
    """A figure with everything needed to say where it came from and what it is worth.

    Frozen. A stored value is never updated, so a mutable one in memory would only ever be a
    way to write down something other than what was stored.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    candidate: CandidateId
    attribute: AttributeId
    value_type: ValueType = Field(
        description=(
            "The attribute's declared type, restated. Redundant by design: it is what makes "
            "the link to the catalog a two-column key, so a value can never carry a payload "
            "of the wrong shape (`arch.md` 3.3b)."
        )
    )
    data_source: DataSourceId
    reference_period: ReferencePeriod = Field(description="What period the figure describes.")
    retrieval_date: datetime = Field(description="When the application fetched it.")
    confidence_level: ConfidenceLevel
    payload: ValuePayload | None = Field(
        default=None,
        description=(
            "The typed figure. Absent only on a value rejected for a fault that leaves "
            "nothing storable -- see the validator below."
        ),
    )
    breakdown_option: BreakdownOptionId | None = Field(
        default=None, description="Which case this figure describes. Null unless broken down."
    )
    rejection_reason: str | None = Field(
        default=None, description="Why the figure is not credible. Null when it is."
    )
    quote: str | None = None
    citations: tuple[str, ...] = Field(
        default=(),
        description=(
            "The pages behind the figure. Where an LLM-sourced value records what the model "
            "actually read (`reqs.md` 6.10)."
        ),
    )
    data_acquisition_run: int | None = Field(
        default=None, description="The run that produced it. Null for a value typed by hand."
    )
    id: int | None = Field(
        default=None,
        description="Assigned by the database on insert. Absent on a value not yet stored.",
    )

    @model_validator(mode="after")
    def _enforce_what_a_value_may_claim(self) -> "Value":
        self._reject_a_payload_of_another_type()
        self._reject_an_attribute_from_another_level()
        self._reject_a_figure_that_is_neither_stored_nor_explained()
        return self

    def _reject_a_payload_of_another_type(self) -> None:
        """The type-agreement chain of `arch.md` 3.3b, one link of it, in Python.

        The database enforces the same thing from the other side and would refuse the insert.
        Catching it here means the fault is reported where the value was built, rather than
        as a constraint name from a driver several layers away.
        """
        if self.payload is not None and self.payload.value_type is not self.value_type:
            raise MalformedValueError(
                f"a {self.value_type} value cannot carry a {self.payload.value_type} payload"
            )

    def _reject_an_attribute_from_another_level(self) -> None:
        """A country attribute measured for a city is a different question, not the same one.

        `reqs.md` 3.3: attributes describing the same concept at different levels are separate
        attributes with separate sources and scales. `country.safety` and `city.safety` are
        unrelated records, so a value pairing one with the other's candidate is meaningless.
        """
        if self.candidate.level_id != self.attribute.level_id:
            raise MalformedValueError(
                f"{self.attribute!r} is measured at level {self.attribute.level_id!r}, and "
                f"{self.candidate!r} is a candidate at level {self.candidate.level_id!r}"
            )

    def _reject_a_figure_that_is_neither_stored_nor_explained(self) -> None:
        """A value with no payload must say why, and that is the only way to have none.

        The two cases this admits are both real. A figure that breaks a type-implicit rule --
        a share composition that does not sum, an index outside its own scale -- has no
        payload that could be stored, because every payload table would refuse it; the parent
        row is written anyway, carrying the reason, so the failure is visible and a selective
        retry can pick it up. A figure that is merely outside the attribute's credible range
        keeps its payload and carries a reason too. What is forbidden is the third case: a
        value that holds nothing and does not say why.
        """
        if self.payload is None and self.rejection_reason is None:
            raise MalformedValueError(
                "a value with no payload must carry the reason it holds nothing"
            )

    @model_validator(mode="after")
    def _reject_a_retrieval_date_with_no_timezone(self) -> "Value":
        """`arch.md` 9.6: every moment the system records is a `timestamptz`.

        A naive datetime would be stored as whatever the connection's timezone happened to
        be, which is the standard PostgreSQL mistake and is more likely here than usual,
        because the value carries plain dates right beside this field.
        """
        if self.retrieval_date.tzinfo is None:
            raise MalformedValueError(
                "retrieval_date is a moment in time and must carry a timezone"
            )
        return self

    @property
    def is_rejected(self) -> bool:
        """Whether this figure failed validation. A rejected value never becomes active."""
        return self.rejection_reason is not None
