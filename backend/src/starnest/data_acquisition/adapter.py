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
from typing import Protocol

from starnest.candidates import Candidate
from starnest.data import Attribute, AttributeId, DataSourceId, Value
from starnest.data_acquisition.estimate import NOTHING, Estimate


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


class RunningSpend(Protocol):
    """What a paid source needs of the run's meter: record a call, and ask if that was the last.

    A protocol rather than `CostMeter` itself, so `data_sources/` depends on the shape it uses
    and not on the class that happens to implement it.
    """

    def spent(self, *, cost_eur: Decimal, calls: int = 1) -> None: ...

    @property
    def is_exhausted(self) -> bool: ...


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

    def meter_with(self, meter: "RunningSpend") -> None:  # noqa: B027
        """Give a paid source the run's meter, to record against and to ask (P91).

        **The cap is read between attributes, and one `fetch` is one attribute over every
        candidate.** For a free source that is the whole request and there is nothing to
        interrupt. For a source billing per candidate it is 32 calls, every one of them
        committed before anything looks at the meter -- so a 1.00 EUR cap could bill about 1.60
        on the first attribute alone, which is a receipt rather than a ceiling. P47 moved the
        check from between sources to between attributes and nothing claimed the residue.

        **Opt-in, and called only for an adapter whose `costs_money` is True**, so the eight
        free adapters keep a signature with nothing in it they cannot use. A source that
        charges and ignores this still cannot exceed the cap by more than one of its own
        attributes, because the check between attributes remains.

        **Recording and asking are one hook, because asking alone answers nothing.** The run
        adds a source's cost after `fetch` returns, so a meter the adapter only *reads* is a
        meter that still knows nothing about the sweep in progress. A source given this records
        each call as it makes it, and `acquire` then does not add that cost a second time.

        Does nothing by default: a source that cannot spend has nothing to record. The `noqa`
        says that deliberately -- this is a hook with a working default, not an abstract method
        every adapter must answer.
        """

    def estimate_for(self, items: int) -> Estimate:
        """What asking this source about `items` candidate-attribute pairs would cost.

        **Nothing by default, for the same reason `costs_money` is False by default**: every
        structured source is free, and a source that charges should have to say so rather than
        be assumed harmless. An adapter that overrides `costs_money` and not this one would
        report a run as free and still spend -- which the plan's own test asserts cannot happen.
        """
        return NOTHING

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
