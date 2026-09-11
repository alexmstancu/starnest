"""Where no source covers a candidate, whose figure may stand in for it -- and why.

`reqs.md` Q195 and Q208. Liechtenstein is surveyed by none of the pan-European sources for three
of the six blocking attributes; it shares a customs and currency union with Switzerland, so
Switzerland's figure is the least-bad answer. **A stand-in is declared per attribute**, because
a neighbour's price level transfers and its homicide rate does not.

This is the declaration only, read from the catalog. Copying a figure under it is a step of a
run and lives in `data_acquisition/`; the copy is stored under its own source at `low`
confidence, never as the candidate's own measurement.
"""

from pydantic import BaseModel, ConfigDict, model_validator

from starnest.candidates import CandidateId
from starnest.data.identifiers import AttributeId


class MalformedStandInError(ValueError):
    """A stand-in that names its own candidate, or gives no reason."""


class StandIn(BaseModel):
    """One candidate borrowing one attribute's figure from another.

    The two names travel with the identifiers because the quote on every copied figure says, in
    words, whose figure it is -- and a run narrowed to Liechtenstein alone has no Switzerland in
    its roster to look the name up from.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    candidate: CandidateId
    candidate_name: str
    attribute: AttributeId
    substitute: CandidateId
    substitute_name: str
    reason: str

    @model_validator(mode="after")
    def _reject_what_would_explain_nothing(self) -> "StandIn":
        if self.substitute == self.candidate:
            raise MalformedStandInError(f"{self.candidate} cannot stand in for itself")
        if not self.reason.strip():
            raise MalformedStandInError(
                f"a stand-in for {self.candidate} on {self.attribute} must say why: the reason "
                "is what the screen shows beside the borrowed figure"
            )
        return self
