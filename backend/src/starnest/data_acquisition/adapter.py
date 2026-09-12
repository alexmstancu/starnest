"""The contract a data source implements, declared by the module that needs it.

`arch.md` 6.3. `data_acquisition/` owns what a fetch *is*; `data_sources/` owns how any
particular publisher answers one. The arrow of dependency therefore runs opposite to the arrow
of control, and no policy module ever names a concrete source -- which `import-linter` contract
1 enforces rather than trusting.

**An adapter returns values, not rows.** It knows Eurostat's cube or Numbeo's JSON; it does not
know that anything is stored, or in what. Whether the run that called it keeps the result is
the caller's decision.

**An adapter never invents a figure.** A country a source has nothing for is simply absent from
the result -- not a zero, not last year's number carried forward, not a neighbour's. Coverage
downstream is only honest if this is (`reqs.md` 5.3).
"""

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal

from starnest.candidates import Candidate
from starnest.data import Attribute, AttributeId, DataSourceId, Value


@dataclass(frozen=True)
class AcquisitionFailure:
    """One thing that did not work, kept rather than raised.

    A run completes for everything that works and records what did not (`reqs.md` 6.4): sparse
    coverage makes routine failure the norm, so aborting the whole run because one indicator was
    unreachable would mean never completing one.
    """

    attribute: AttributeId
    reason: str
    candidate: str | None = None
    # Which source failed. Stamped by the run, as a value's run is, so an adapter cannot forget
    # to say who it is.
    data_source: DataSourceId | None = None


@dataclass(frozen=True)
class Acquired:
    """What one fetch produced: the figures it found, what it could not do, and what it cost.

    **The cost is here because the adapter is the only thing that knows it.** Six of the seven
    shipped sources are free and leave it zero; the LLM path charges per call, and a run has to
    accumulate that as it happens or a spend cap cannot halt anything (`reqs.md` 6.3).
    """

    values: tuple[Value, ...] = ()
    failures: tuple[AcquisitionFailure, ...] = field(default=())
    cost_eur: Decimal = Decimal(0)
    calls: int = 0
    """How many paid calls it took. Zero for a free source, which is every structured one."""

    def __add__(self, other: "Acquired") -> "Acquired":
        return Acquired(
            self.values + other.values,
            self.failures + other.failures,
            self.cost_eur + other.cost_eur,
            self.calls + other.calls,
        )


class SourceAdapter(ABC):
    """One publisher, and the attributes it can answer for."""

    @property
    @abstractmethod
    def data_source(self) -> DataSourceId:
        """Which `data_source` row every value from this adapter names as its origin."""

    @property
    def costs_money(self) -> bool:
        """Whether asking this source can cost anything.

        False by default, because every structured source is free and a cap means nothing to
        them -- and because a source that charges should have to say so rather than be assumed
        harmless. What it changes: a run including such a source refuses to start with no spend
        cap set, unless the request accepts an uncapped run (`spend.py`).
        """
        return False

    @property
    @abstractmethod
    def attributes(self) -> tuple[AttributeId, ...]:
        """The catalog attributes this source can supply, and no others.

        Declared rather than discovered, so a run can be planned -- and so asking a source for
        something it does not publish is a question that cannot be posed rather than one that
        fails halfway through.
        """

    @abstractmethod
    async def fetch(self, attribute: Attribute, candidates: Sequence[Candidate]) -> Acquired:
        """Every figure this source has for one attribute, across the candidates given.

        One attribute at a time because that is how these APIs are shaped: a request returns a
        whole indicator across every country, and asking per candidate would be one round trip
        per country for the same bytes.

        **The whole `Attribute`, not just its identifier.** What shape a figure takes -- a Ratio
        of what, a Quantity in which unit -- is catalog data (`arch.md` 1.2), and an adapter
        told only the identifier would have to restate it. Adding an attribute would then stop
        being a pure data change, which is the invariant the catalog exists to protect.
        """
