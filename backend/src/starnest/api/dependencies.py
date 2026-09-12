"""What the endpoints are given, and who decides what it is.

The stores are held on the application state and handed to endpoints by these functions, so no
endpoint constructs one. That is what makes the composition root the only place that knows which
implementation is in use (`arch.md` 6.3) -- and what lets the acceptance suite run the same
endpoints against a different one without touching them.
"""

from typing import Annotated

from fastapi import Depends, Request

from starnest.candidates import CandidateStore
from starnest.criteria import CriteriaStore, MatchRuleResultStore
from starnest.data import CatalogStore, ValueStore
from starnest.data_acquisition import GateResearcher, RunStore, SourceAdapter
from starnest.evaluation import EvaluationStore
from starnest.household import HouseholdStore


def _household(request: Request) -> HouseholdStore:
    return request.app.state.household


def _criteria(request: Request) -> CriteriaStore:
    return request.app.state.criteria


def _match_rule_results(request: Request) -> MatchRuleResultStore:
    return request.app.state.match_rule_results


def _evaluations(request: Request) -> EvaluationStore:
    return request.app.state.evaluations


def _candidates(request: Request) -> CandidateStore:
    return request.app.state.candidates


def _values(request: Request) -> ValueStore:
    return request.app.state.values


def _catalog(request: Request) -> CatalogStore:
    return request.app.state.catalog


def _runs(request: Request) -> RunStore:
    return request.app.state.runs


def _researcher(request: Request) -> GateResearcher | None:
    """Whatever can research a gate, or nothing at all.

    `None` is an ordinary state and the endpoint says so with a 501: the MVP's figures come from
    structured sources, and the LLM path is off until a key and its prices are configured.
    """
    return getattr(request.app.state, "researcher", None)


def _adapters(request: Request) -> tuple[SourceAdapter, ...]:
    """Every source this application can fetch from.

    A tuple rather than one, because a run plan reports work per source and there will be more
    than one. The API knows only the interface; which concrete adapters exist is the composition
    root's business (`arch.md` 6.3).
    """
    return request.app.state.adapters


Households = Annotated[HouseholdStore, Depends(_household)]
Criteria = Annotated[CriteriaStore, Depends(_criteria)]
MatchRuleResults = Annotated[MatchRuleResultStore, Depends(_match_rule_results)]
Evaluations = Annotated[EvaluationStore, Depends(_evaluations)]
Candidates = Annotated[CandidateStore, Depends(_candidates)]
Values = Annotated[ValueStore, Depends(_values)]
Catalog = Annotated[CatalogStore, Depends(_catalog)]
Runs = Annotated[RunStore, Depends(_runs)]
Adapters = Annotated[tuple[SourceAdapter, ...], Depends(_adapters)]
Researcher = Annotated["GateResearcher | None", Depends(_researcher)]
