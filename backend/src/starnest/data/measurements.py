"""Building a `Value` from what a source actually reported.

`reqs.md` 3.6. A value carries eleven fields and a source decides four of them: the payload,
the period it describes, how much to trust it, and the words it was read from. The other seven
are the same for every figure of one fetch -- which candidate is a parameter, and the attribute,
the source, the moment of retrieval and the value type do not change within a fetch at all.

**Why a builder rather than a constructor call per adapter.** Seven places built a `Value`
by hand and each restated `value_type=attribute.value_type`, the source id and the retrieval
moment. Restating a derivation is how two of them come to disagree: a value whose `value_type`
is not its attribute's is a payload the store cannot place, and the composite key in `value`
would refuse it -- at write time, after a run had reported success. Here the derivation happens
once and cannot be typed wrongly.

**It builds; it does not validate.** `Value` refuses what contradicts itself (`MalformedValueError`)
and that stays where it is. This only assembles.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from starnest.candidates import Candidate, CandidateId
from starnest.data.attribute import Attribute
from starnest.data.confidence import ConfidenceLevel
from starnest.data.identifiers import BreakdownOptionId, DataSourceId
from starnest.data.payloads import ValuePayload
from starnest.data.reference_period import ReferencePeriod
from starnest.data.value import Value


@dataclass(frozen=True)
class Measurements:
    """What one source is measuring, for one attribute, on one occasion.

    Frozen and reusable: one of these is made per fetch and asked for a figure per candidate,
    so the retrieval moment is the fetch's rather than each row's. That is deliberate -- 32
    figures from one request were retrieved at one instant, and stamping them a millisecond
    apart would invent a sequence that says something about nothing.
    """

    attribute: Attribute
    data_source: DataSourceId | str
    retrieved: datetime
    confidence_level: ConfidenceLevel = ConfidenceLevel.HIGH
    """What this source's figures are worth by default. A single figure may say otherwise --
    a stand-in borrowed from a neighbour is `low` however reliable the source is."""

    def figure(
        self,
        *,
        candidate: Candidate | CandidateId | str,
        payload: ValuePayload,
        period: ReferencePeriod,
        quote: str | None = None,
        citations: Sequence[str] = (),
        confidence_level: ConfidenceLevel | None = None,
        breakdown_option: BreakdownOptionId | str | None = None,
    ) -> Value:
        """One figure, as a `Value`.

        `candidate` takes a `Candidate` or its id, because an adapter usually holds the record
        and the stand-in holds only the identifier.
        """
        return Value(
            candidate=candidate.id if isinstance(candidate, Candidate) else candidate,
            attribute=self.attribute.id,
            # The one derivation this class exists to make unrepeatable.
            value_type=self.attribute.value_type,
            data_source=DataSourceId(str(self.data_source)),
            reference_period=period,
            retrieval_date=self.retrieved,
            confidence_level=confidence_level or self.confidence_level,
            payload=payload,
            quote=quote,
            citations=tuple(citations),
            breakdown_option=(
                None if breakdown_option is None else BreakdownOptionId(str(breakdown_option))
            ),
        )
