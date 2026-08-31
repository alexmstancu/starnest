"""What the schema must be, asserted independently of whoever wrote it.

These are the C0 checkpoint checks (devplan.md P0). They are deliberately written against
`arch.md` rather than against the migrations: a test derived from the implementation agrees
with the implementation by construction and proves nothing.

Everything here reads the PostgreSQL catalogs. Nothing inserts, so these stay valid as the
column list grows.
"""

import psycopg
import pytest

pytestmark = pytest.mark.storage


# arch.md 3.2a — the reference tables, by name.
REFERENCE_TABLES = [
    "candidate",
    "pillar",
    "level",
    "attribute",
    "data_source",
    "value_type",
    "unit",
    "currency",
    "confidence_level",
    "match_rule",
    "label_vocabulary",
    "criteria_set",
    "evaluation",
    "data_acquisition_run",
]

# arch.md 3.3 — the parent and its ten typed children. Adding a value type is a code
# change, so this list is closed and a schema growing an eleventh should fail here first.
PAYLOAD_TABLES = [
    "value_monetary",
    "value_quantity",
    "value_count",
    "value_ratio",
    "value_index",
    "value_labelset",
    "value_sharecomp",
    "value_boolean",
    "value_score",
    "value_text",
]

# arch.md 3.6 — the split the whole ontology rests on.
OBJECTIVE = {
    "level",
    "candidate",
    "pillar",
    "attribute",
    "value",
    *PAYLOAD_TABLES,
    "data_source",
    "data_acquisition_run",
    "external_score",
    "match_rule",
    "match_rule_result",
}
SUBJECTIVE = {"criteria_set", "criterion", "evaluation", "candidate_result", "household"}


def _tables(connection: psycopg.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    ).fetchall()
    return {row[0] for row in rows}


def _columns(connection: psycopg.Connection, table: str) -> dict[str, str]:
    return dict(
        connection.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s",
            (table,),
        ).fetchall()
    )


@pytest.mark.parametrize("table", REFERENCE_TABLES)
def test_every_reference_table_exists(connection: psycopg.Connection, table: str) -> None:
    assert table in _tables(connection)


@pytest.mark.parametrize("table", PAYLOAD_TABLES)
def test_every_value_payload_table_exists(connection: psycopg.Connection, table: str) -> None:
    assert table in _tables(connection)


def test_the_active_value_is_a_view(connection: psycopg.Connection) -> None:
    """arch.md 4. Being active is a comparison BETWEEN values, so it is computed on read.

    A stored flag would be a cache of that comparison with no owner responsible for
    refreshing it — and a stale one does not fail loudly, it scores the wrong number with
    correct-looking provenance.
    """
    views = connection.execute(
        "SELECT table_name FROM information_schema.views WHERE table_schema = 'public'"
    ).fetchall()
    assert "active_value" in {row[0] for row in views}


def test_no_table_stores_whether_a_value_is_active(connection: psycopg.Connection) -> None:
    """The other half of the same rule: the view must not be shadowed by a column."""
    offenders = connection.execute(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' "
        "  AND column_name IN ('is_active', 'active', 'is_current', 'current')"
    ).fetchall()
    assert offenders == [], f"active-ness must be derived, not stored: {offenders}"


def test_rejection_is_stored_because_it_is_a_fact_about_one_value(
    connection: psycopg.Connection,
) -> None:
    """arch.md 3.4. Rejection is decided once at insert and never changes because another
    value appeared, which is exactly why it is a column while active-ness is not."""
    assert "rejection_reason" in _columns(connection, "value")


def test_the_type_agreement_chain_is_declared(connection: psycopg.Connection) -> None:
    """arch.md 3.3b, the subtlest constraint in the schema.

    Without it, a value for an attribute declared `Monetary` could carry a count payload.
    Both rows would be individually valid and no constraint would connect them — and the
    damage is a plausible wrong answer rather than a crash: a rent stored as a bare 2900
    with no currency, so the EUR conversion never runs and the ranking reports a gap that is
    simply wrong, with every provenance field correctly filled in.
    """
    constraints = connection.execute(
        """
        SELECT conrelid::regclass::text AS table_name,
               contype,
               pg_get_constraintdef(oid) AS definition
        FROM   pg_constraint
        WHERE  connamespace = 'public'::regnamespace
        """
    ).fetchall()

    def declared(table: str, kind: str, *needles: str) -> bool:
        return any(
            row[0] == table and row[1] == kind and all(n in row[2] for n in needles)
            for row in constraints
        )

    assert declared("attribute", "u", "id", "value_type"), (
        "attribute needs UNIQUE (id, value_type) so the catalog's declaration is referenceable"
    )
    assert declared("value", "f", "attribute", "value_type"), (
        "value needs a composite FK to attribute (id, value_type)"
    )
    assert declared("value", "u", "id", "value_type"), (
        "value needs UNIQUE (id, value_type) so payloads can reference the pair"
    )


@pytest.mark.parametrize("table", PAYLOAD_TABLES)
def test_each_payload_pins_its_own_type(connection: psycopg.Connection, table: str) -> None:
    """The last link of the section 3.3b chain: only the monetary payload may attach to a monetary
    value, and its primary key on value_id makes it the only payload of any kind."""
    constraints = connection.execute(
        "SELECT contype, pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conrelid = %s::regclass",
        (table,),
    ).fetchall()

    kinds = {row[0] for row in constraints}
    definitions = " ".join(row[1] for row in constraints)

    assert "c" in kinds and "value_type" in definitions, (
        f"{table} needs CHECK (value_type = '...') pinning its own type"
    )
    assert "f" in kinds and "value_id" in definitions and "value_type" in definitions, (
        f"{table} needs a composite FK on (value_id, value_type)"
    )
    assert "p" in kinds, f"{table} needs a primary key on value_id — one payload per value"


def test_the_objective_side_never_references_the_subjective_side(
    connection: psycopg.Connection,
) -> None:
    """arch.md 3.6 and reqs.md 3.0, expressed as foreign keys.

    No value knows which criteria set is active; no candidate stores a score. That is what
    makes re-evaluation pure arithmetic over stored rows, and why switching criteria sets
    cannot trigger a fetch. `import-linter` enforces the same invariant in the code; this
    enforces it in the schema, which is where it would actually be violated.
    """
    edges = connection.execute(
        """
        SELECT conrelid::regclass::text AS referencing,
               confrelid::regclass::text AS referenced
        FROM   pg_constraint
        WHERE  contype = 'f' AND connamespace = 'public'::regnamespace
        """
    ).fetchall()

    violations = [
        (referencing, referenced)
        for referencing, referenced in edges
        if referencing in OBJECTIVE and referenced in SUBJECTIVE
    ]
    assert violations == [], f"objective tables must not reference subjective ones: {violations}"


def test_instants_and_reference_periods_are_different_types(
    connection: psycopg.Connection,
) -> None:
    """arch.md 9.6. A retrieval date is an instant; a reference period describes a span in
    the world. Confusing the two is the standard PostgreSQL mistake, and the two-date rule
    (reqs.md 3.6) makes it more likely here than usual."""
    columns = _columns(connection, "value")

    assert columns.get("retrieval_date") == "timestamp with time zone"
    assert columns.get("reference_period_start") == "date"
    assert columns.get("reference_period_end") == "date"


def test_the_same_fetch_cannot_be_stored_twice(connection: psycopg.Connection) -> None:
    """arch.md 3.2. The natural key is six columns, and `breakdown_option` is one of them —
    which is what makes the three Lisbon rents three rows rather than a collision."""
    uniques = connection.execute(
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conrelid = 'value'::regclass AND contype = 'u'"
    ).fetchall()

    natural_key = [
        "candidate",
        "attribute",
        "data_source",
        "breakdown_option",
        "reference_period_start",
        "retrieval_date",
    ]
    assert any(all(column in row[0] for column in natural_key) for row in uniques), (
        f"value needs UNIQUE on the six-column natural key; found {uniques}"
    )
