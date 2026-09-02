"""Attribute, Value, the ten value types, sources, provenance, confidence, the active value.

**This is the objective half of the ontology** (`reqs.md` 3.0): what is knowable about a place,
and where each figure came from. It may import `candidates/` and nothing else -- never
`criteria/`, `household/` or `evaluation/`, which is the ontology's central invariant expressed
as imports and enforced by `import-linter` contract 3 (`arch.md` 6.2).

**Nothing here knows what "good" means.** There is no goal, no direction, no weight, no
threshold and no normalisation in this module, and their absence is the design rather than an
omission. An attribute says rent is 1,410 EUR a month for July 2026 according to Numbeo; that
this is expensive, that it matters 8%, and that above 2,000 you would not move there are three
separate opinions, and all three live in a criteria set.

Three ideas the rest of the module rests on:

- **An attribute is what is measured**; a **value** is what it was, for one candidate, from one
  source, over one period. Adding an attribute is a data change -- a row seeded by migration --
  and never a code change.
- **A value's type decides what it stores.** Ten semantic types, one class each, mirroring the
  ten payload tables. Rent and temperature are both numbers and behave nothing alike.
- **Nothing is discarded and nothing is overwritten.** A figure that fails validation is stored
  with the reason; a correction is a new value that supersedes the old one. Which value is
  *active* is computed by comparing them (`active_value.py`), never stored.

**How this module refuses things.** Every fault it can detect is a `ValueError` or a
`LookupError`, so `except (ValueError, LookupError)` catches all of them. Building a model goes
through Pydantic, which reports the domain error -- `MalformedPayloadError`,
`MalformedValueError`, `AttributeDeclarationError` -- wrapped in a `ValidationError` (itself a
`ValueError`); the original is recoverable from `error.errors()[0]["ctx"]["error"]` for a caller
that needs to branch on it.
"""

from starnest.data.active_value import (
    ActiveValueKey,
    MismatchedAttributeError,
    select_active_value,
    select_active_values,
)
from starnest.data.attribute import (
    AllowedRange,
    Attribute,
    AttributeDeclarationError,
    IndexParameters,
    LifecycleStatus,
    Pillar,
    QuantityParameters,
    RatioParameters,
    ValueTypeMismatchError,
)
from starnest.data.clock import Clock
from starnest.data.confidence import (
    MANUAL_ENTRY_DEFAULT_CONFIDENCE,
    ConfidenceLevel,
    UnknownReliabilityTierError,
    derive_confidence,
)
from starnest.data.external_score import ExternalScore, MalformedExternalScoreError
from starnest.data.fx import (
    EURO,
    CurrencyMismatchError,
    FxRate,
    FxRateProvider,
    FxRateUnavailableError,
)
from starnest.data.identifiers import (
    AttributeId,
    BreakdownOptionId,
    BreakdownSchemeId,
    CatalogId,
    CompoundRuleId,
    CurrencyCode,
    DataSourceId,
    MatchRuleId,
    PillarId,
    ReliabilityTierId,
    UnitId,
)
from starnest.data.payloads import (
    PAYLOAD_CLASSES,
    SHARE_SUM_TOLERANCE,
    AssignedScore,
    Assigner,
    Boolean,
    Count,
    Index,
    LabelSet,
    MalformedPayloadError,
    Monetary,
    Payload,
    Quantity,
    Ratio,
    Share,
    ShareComposition,
    Text,
    ValuePayload,
    ValueType,
    payload_class_for,
)
from starnest.data.reference_period import InvalidReferencePeriodError, ReferencePeriod
from starnest.data.rules import (
    CompoundRule,
    CompoundRuleCondition,
    CompoundRuleDeclarationError,
    CompoundRuleInput,
    CompoundRuleShape,
    MalformedMatchRuleResultError,
    MatchResult,
    MatchRule,
    MatchRuleResult,
    RuleOutcome,
)
from starnest.data.sources import (
    DataSource,
    InvalidSourcePriorityError,
    SourceKind,
    SourcePriority,
    SourcePriorityOverride,
    UnknownDataSourceError,
)
from starnest.data.store import CatalogStore, UnknownAttributeError, ValueStore
from starnest.data.value import MalformedValueError, Value

__all__ = [
    "EURO",
    "MANUAL_ENTRY_DEFAULT_CONFIDENCE",
    "PAYLOAD_CLASSES",
    "SHARE_SUM_TOLERANCE",
    "ActiveValueKey",
    "AllowedRange",
    "AssignedScore",
    "Assigner",
    "Attribute",
    "AttributeDeclarationError",
    "AttributeId",
    "Boolean",
    "BreakdownOptionId",
    "BreakdownSchemeId",
    "CatalogId",
    "CatalogStore",
    "Clock",
    "CompoundRule",
    "CompoundRuleCondition",
    "CompoundRuleDeclarationError",
    "CompoundRuleId",
    "CompoundRuleInput",
    "CompoundRuleShape",
    "ConfidenceLevel",
    "Count",
    "CurrencyCode",
    "CurrencyMismatchError",
    "DataSource",
    "DataSourceId",
    "ExternalScore",
    "FxRate",
    "FxRateProvider",
    "FxRateUnavailableError",
    "Index",
    "IndexParameters",
    "InvalidReferencePeriodError",
    "InvalidSourcePriorityError",
    "LabelSet",
    "LifecycleStatus",
    "MalformedExternalScoreError",
    "MalformedMatchRuleResultError",
    "MalformedPayloadError",
    "MalformedValueError",
    "MatchResult",
    "MatchRule",
    "MatchRuleId",
    "MatchRuleResult",
    "MismatchedAttributeError",
    "Monetary",
    "Payload",
    "Pillar",
    "PillarId",
    "Quantity",
    "QuantityParameters",
    "Ratio",
    "RatioParameters",
    "ReferencePeriod",
    "ReliabilityTierId",
    "RuleOutcome",
    "Share",
    "ShareComposition",
    "SourceKind",
    "SourcePriority",
    "SourcePriorityOverride",
    "Text",
    "UnitId",
    "UnknownAttributeError",
    "UnknownDataSourceError",
    "UnknownReliabilityTierError",
    "Value",
    "ValuePayload",
    "ValueStore",
    "ValueType",
    "ValueTypeMismatchError",
    "derive_confidence",
    "payload_class_for",
    "select_active_value",
    "select_active_values",
]
