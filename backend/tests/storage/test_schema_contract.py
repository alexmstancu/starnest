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
#
# **Every table is on one side or the other, and a new one that is on neither fails the test
# below** (D15). These two sets named 18 tables of the 60-odd that exist, so a foreign key from
# an objective table into an unclassified subjective one -- `criterion_scale_anchor`,
# `pillar_weight`, `non_match_reason` -- was not a violation as far as the guard was concerned.
# A guard that covers a third of the schema reports on a third of the schema.
OBJECTIVE = {
    # What is true about a place, and the records of finding it out.
    "level",
    "candidate",
    "pillar",
    "attribute",
    "attribute_allowed_label",
    "attribute_allowed_range",
    "attribute_index_parameter",
    "attribute_quantity_parameter",
    "attribute_ratio_parameter",
    "attribute_source_priority",
    "breakdown_option",
    "breakdown_scheme",
    "population_centre",
    "stand_in",
    "value",
    *PAYLOAD_TABLES,
    "value_citation",
    "data_source",
    "data_acquisition_run",
    "data_acquisition_failure",
    "data_acquisition_run_attribute",
    "data_acquisition_run_candidate",
    "external_score",
    "fx_rate",
    # A gate's ANSWER is objective -- whether a visa route exists is a fact. Whether the gate
    # is enforced is a preference, and that lives on the subjective side below.
    "match_rule",
    "match_rule_result",
    "match_rule_result_citation",
    "compound_rule",
    "compound_rule_condition",
    "compound_rule_input",
    # Controlled vocabularies: what a figure may be, not what anyone wants it to be.
    "confidence_level",
    "currency",
    "unit",
    "value_type",
    "reliability_tier",
    "household_field",
}
SUBJECTIVE = {
    # What the household wants, and what was computed from wanting it.
    "criteria_set",
    "criteria_set_compound_rule",
    "criteria_set_match_rule",
    "criterion",
    "criterion_scale_anchor",
    "criterion_threshold_boolean",
    "criterion_threshold_label",
    "criterion_threshold_range",
    "criterion_threshold_share",
    "pillar_weight",
    "evaluation",
    "evaluation_criterion",
    "evaluation_scale_anchor",
    "candidate_result",
    "candidate_attribute_score",
    "candidate_warning",
    "non_match_reason",
    "household",
    "household_citizenship",
    "settings",
}

UNCLASSIFIED = {"_yoyo_log", "_yoyo_migration", "_yoyo_version", "yoyo_lock"}
"""yoyo's own bookkeeping, which belongs to neither side and to no part of the ontology."""


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


VALUE_COLUMNS = """
    candidate, attribute, value_type, data_source,
    reference_period_start, reference_period_end, retrieval_date, confidence_level
"""
A_VALUE = """
    ('country.portugal', %s, %s, %s, date '2025-01-01', date '2025-12-31',
     timestamptz '2026-08-31 10:00:00+00', 'high')
"""


def _a_seeded_attribute(connection: psycopg.Connection) -> tuple[str, str, str]:
    attribute, value_type = connection.execute(
        "SELECT id, value_type FROM attribute WHERE id = 'country.rule_of_law'"
    ).fetchone()
    source = connection.execute("SELECT id FROM data_source LIMIT 1").fetchone()[0]
    return attribute, value_type, source


def test_the_same_fetch_cannot_be_stored_twice(connection: psycopg.Connection) -> None:
    """arch.md 3.2, and this test asserts the constraint BITES rather than merely exists.

    An earlier version of this test checked only that a UNIQUE constraint was declared over
    the right columns. It passed against a schema that permitted byte-identical duplicates:
    `breakdown_option` is NULL for most values, and PostgreSQL's default treats every NULL as
    distinct from every other, so the constraint guaranteed nothing for the common case.
    `NULLS NOT DISTINCT` closes it. A test that a constraint is declared is not a test that it
    works, which is the whole reason this one inserts.
    """
    parameters = _a_seeded_attribute(connection)
    insert = f"INSERT INTO value ({VALUE_COLUMNS}) VALUES {A_VALUE}"

    connection.execute(insert, parameters)

    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(insert, parameters)


def test_a_later_re_fetch_of_the_same_period_is_still_stored(
    connection: psycopg.Connection,
) -> None:
    """The other half, and the reason `retrieval_date` stays in the key.

    reqs.md 3.6 never discards: asking the same source again next month is a second
    observation, not a duplicate. A key that rejected it would force the application to
    overwrite, which is the one thing values must never do.
    """
    parameters = _a_seeded_attribute(connection)
    connection.execute(f"INSERT INTO value ({VALUE_COLUMNS}) VALUES {A_VALUE}", parameters)
    connection.execute(
        f"INSERT INTO value ({VALUE_COLUMNS}) VALUES {A_VALUE.replace('10:00:00', '11:00:00')}",
        parameters,
    )

    assert connection.execute("SELECT count(*) FROM value").fetchone()[0] == 2


def test_every_table_is_on_one_side_of_the_split_or_the_other(
    connection: psycopg.Connection,
) -> None:
    """The guard on the guard above (D15).

    **A classification that covers part of the schema checks part of the schema.** `OBJECTIVE`
    and `SUBJECTIVE` named 18 tables between them, so a foreign key from an objective table into
    an unclassified subjective one was not a violation as far as the check could tell -- and the
    unclassified ones include every child of a criterion and every child of an evaluation, which
    is exactly where such an edge would appear.

    Failing here means a migration added a table and did not say which side it is on. That is a
    question worth being asked once, in the commit that adds it, rather than discovered when
    somebody wonders why the guard never fires.
    """
    unaccounted = _tables(connection) - OBJECTIVE - SUBJECTIVE - UNCLASSIFIED

    assert unaccounted == set(), (
        f"{sorted(unaccounted)} belong to neither side of the objective/subjective split. "
        "Add each to OBJECTIVE (what is true about a place) or SUBJECTIVE (what the household "
        "wants, and what was computed from wanting it) -- arch.md 3.6."
    )


def test_the_two_sides_do_not_overlap() -> None:
    """A table on both sides would make the violation check above vacuous for it."""
    assert not OBJECTIVE & SUBJECTIVE
