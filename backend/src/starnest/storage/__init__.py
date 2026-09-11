"""PostgreSQL behind the seams that `data/` and `household/` declare.

**This is a plugin, not a layer** (`arch.md` 6.1). No policy module may import it, and
`import-linter` contract 1 fails the build if one does. The arrow of dependency runs opposite
to the arrow of control: the module that *needs* persistence declares the interface, and this
one implements it, so nothing on the policy side ever names psycopg, a table or a column.

**It leans on PostgreSQL deliberately, and does not abstract it** (`arch.md` 6.6). The design
depends on `DISTINCT ON` for the active-value view, composite foreign keys for type agreement,
`num_nonnulls` for the one-of constraint and `INTERVAL` for `max_age`. Storage is a plugin so
that policy stays clean, **not** so that the engine is swappable -- an abstraction preserving
engine choice would have to target the common subset and forfeit exactly those capabilities.

**Every statement lives in a `.sql` file** under the repository's top-level `storage/queries/`
(`queries.py`). There is no SQL in a Python string anywhere in this package.

This module translates and decides nothing. It has no HTTP, no clock, no domain rule, no
scoring and no interpretation of a row beyond turning it into the type the seam names.
"""

from starnest.storage.candidate_store import PostgresCandidateStore
from starnest.storage.catalog_store import PostgresCatalogStore
from starnest.storage.connections import acquire
from starnest.storage.criteria_store import PostgresCriteriaStore
from starnest.storage.household_store import PostgresHouseholdStore
from starnest.storage.match_rule_result_store import PostgresMatchRuleResultStore
from starnest.storage.queries import QUERY_DIRECTORY, load_queries
from starnest.storage.run_store import PostgresRunStore
from starnest.storage.value_store import PostgresValueStore

__all__ = [
    "QUERY_DIRECTORY",
    "PostgresCandidateStore",
    "PostgresCatalogStore",
    "PostgresCriteriaStore",
    "PostgresHouseholdStore",
    "PostgresMatchRuleResultStore",
    "PostgresRunStore",
    "PostgresValueStore",
    "acquire",
    "load_queries",
]
