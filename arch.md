# Architecture — Starnest

Refined from `relocation-app-master-spec-v1.md` (Part 3), and from the ontology discussion that
followed `reqs.md`. Terms used here are defined in `reqs.md` Appendix A.

**Status: partial.** This document currently covers the ontology only. The stack — language,
UI framework, database engine — is deliberately still open (§6). The ontology is settled
independently because none of it changes based on that choice.

---

## 1. The ontology in two tiers

The data model splits into **archetypes** and **instantiations**, and they live in different
places for a reason that is not stylistic.

| | Archetypes | Instantiations |
|---|---|---|
| Examples | `Candidate`, `Value`, `Pillar`, `Criterion`, the ten value types | `country`, `city`, `economics`, `rent_2br`, `population` |
| Live in | **Code** | **Config** (files or DB rows), loaded at startup |
| Changed by | A developer, in a release | A config edit and a reload |
| They are | The vocabulary | The sentences |

**Why archetypes cannot be config.** An archetype like `Monetary` does not merely declare
fields — it declares *operations*. `Monetary` converts through an fx rate. `Quantity` converts
through unit factors. `Index` rescales from provider-declared bounds. Those are three different
algorithms. Expressing them in config would require either an expression language (a language,
with all that implies) or a declaration kept manually in sync with the code that implements it
(drift, silently). So behaviour stays in code.

**Config references archetypes by name; it never defines one.**

```yaml
criteria:
  - id: population
    level: country
    value_type: Count          # ← names an archetype implemented in code
    unit: people
    max_age: 24 months
    sources: [worldbank, eurostat]
```

At startup the app resolves `Count` against its registry of implemented types. **A config
naming a type that does not exist is a boot failure**, not a surprise at fetch time.

### 1.1 The guardrail

**Config declares data, never behaviour.** No expressions, no formulas, no conditionals in
YAML. The moment a config file needs an `if`, that is code trying to escape into a text file,
and the answer is a new archetype rather than a more expressive config format.

This is what keeps the ontology from becoming a programming language nobody wants to maintain.

---

## 2. Immutability, and why migration is not a problem

A criterion's **`id` and `value_type` are immutable together.** Changing a criterion's type
means creating a new criterion and retiring the old one.

This dissolves what looks like the hardest problem with a config-driven ontology — what happens
when a criterion changes from `Ratio` to `LabelSet`, and how do stored values convert?

They do not convert, and they should not:

- A criterion's type is part of its **identity**. "Forest cover as a `Ratio`" and "forest cover
  as a `LabelSet` of biome names" are not one criterion modelled two ways; they are different
  questions. Changing the type means you decided to measure something else.
- The stored values are **still true**. Forest cover really was 38% in 2024, whatever you now
  want to model. Discarding them would violate *no value is ever discarded*.

So the old criterion is marked **retired**: it drops out of active scoring, its values remain
as historical record, and the new criterion starts empty.

**What may change freely**, because no stored value depends on it: name, description, pillar
assignment, sources, source priority, `max_age`. Everything subjective — weight, direction,
thresholds, anchors — was never on the criterion at all; it lives in `CriteriaSettings`.

**One edge case:** tightening `valid_range` must **re-validate stored values** and mark newly
implausible ones rejected, rather than silently changing which value is active.

---

## 3. Storage

### 3.1 Narrow, not wide

There is no `countries.population` column, and there must not be. If criteria were columns,
adding a criterion would be a schema migration — which contradicts *adding a criterion is a
data change*.

Storage is **narrow**: values are rows keyed by candidate, criterion and source. Adding a
criterion inserts rows and never alters a table.

### 3.2 A shared parent with typed children

Values share seven fields and differ in the rest by type. Rather than one table with nullable
columns for every type's payload, or ten unrelated tables, the shape is a **parent table with
typed child tables**:

```
value              id · candidate · criterion · source · reference_period ·
                   retrieval_date · confidence · run · status

value_monetary     value_id · key · amount · currency · amount_eur ·
                   fx_rate · fx_rate_date
value_quantity     value_id · key · magnitude · unit
value_count        value_id · key · count · basis
value_ratio        value_id · key · value · basis
value_index        value_id · key · value · provider · scale_min · scale_max
value_labelset     value_id · key · label
value_composition  value_id · label · share
value_boolean      value_id · key · value
value_score        value_id · key · value · range_min · range_max · assigned_by · rationale
value_text         value_id · body
```

This buys three things at once:

- **Real constraints.** `amount NUMERIC NOT NULL`, `currency CHAR(3) NOT NULL`,
  `CHECK (amount > 0)`. The database enforces the type-implicit validation rules from
  `reqs.md` §3.3a, rather than trusting application code to remember.
- **The common path stays cheap.** The four operations the app performs most — every value for
  a candidate, choosing the active value, computing coverage, the criterion drill-down — read
  `value` alone and never touch a child table.
- **Adding a type is one new child table**, which is consistent: adding a type is already a
  code change.

### 3.3 `status`, and never discarding

`value.status` is `active`, `superseded` or `rejected`. Nothing is deleted. A value that fails
validation is stored with `rejected` and its reason; a value outranked by source priority is
`superseded`. Exactly one value per (candidate, criterion) is `active`.

### 3.4 Scale

For v1 — 32 countries × ~44 country criteria × ~2 sources ≈ **2,800 rows**. With cities and
accumulated history, perhaps 50,000. Small enough that no storage decision here is driven by
performance.

---

## 4. Choosing the active value

Implemented once, in one place, against `Candidate` — never per level. In order:

1. Discard values with `status = rejected`.
2. **Fresh beats stale** — older than the criterion's `max_age` drops below every fresh value.
3. **Source priority** — the criterion's ordering, falling back to the global default.
4. **Confidence** breaks ties within a priority rank.
5. Most recently retrieved wins anything remaining.

Steps 1, 2, 4 and 5 depend on the individual value and are evaluated at runtime. Only step 3 is
declared in config. This is why source priority and confidence are both needed and neither
subsumes the other: priority encodes standing domain knowledge (*Numbeo beats national
statistics for city rent*), confidence grades one particular number.

---

## 5. Adapters and the binding to data

Each source is a plug-in behind one interface. An adapter declares what it can answer:

```yaml
adapter: worldbank
kind: structured
reliability_tier: official
rate_limit: none
mode: per_candidate
provides:
  - criterion: population
    level: country
    indicator: SP.POP.TOTL
    produces: Count
```

**Both configs are cross-validated at boot.** Does criterion `population` exist? Does its
declared `value_type` match what the adapter claims to produce? A mismatch is a **startup
error**, not a corrupted value discovered months later. This is the highest-value property of
the whole design and it costs almost nothing.

A criterion gets its value by one of three bindings:

| Binding | Declared where | Example |
|---|---|---|
| **Adapter fetch** | The adapter's `provides` block | World Bank `SP.POP.TOTL` → `population` |
| **CandidateFacts** | `value_source` on the criterion | `value_source: facts.population` |
| **Manual entry** | Typed by the user, ranked like any source | The UK visa verdict |

### 5.1 Two fetch modes

Adapters declare `mode`, because the two behave nothing alike:

- **`bulk`** — one download refreshes many candidates. UNODC, Ookla tiles, Köppen zones, WDPA.
  Scheduled, infrequent, cheap per candidate.
- **`per_candidate`** — one call per candidate or criterion. Eurostat, World Bank, Open-Meteo,
  the LLM path. Subject to rate limits and the budget cap.

The acquisition layer must support both. A run mixes them.

---

## 6. Open

- **The stack.** Language, UI framework, and database engine are undecided. On the database:
  SQLite's FTS5 and R-Tree are built in, so the full-text case needs no extension; the real
  deciding question is whether geometry lives in the database (favouring PostGIS) or is
  computed in Python at acquisition time and stored as plain numbers (favouring SQLite).
  Everything above holds either way.
- **Cardinality.** Whether a criterion may be `scalar`, `keyed` (rent by room count) or
  `series` (a value per year), as a second axis orthogonal to value type. The `key` column in
  the child tables above anticipates it. Discussed, not decided.
- **Where the reducer lives** if cardinality is adopted — likely `CriteriaSettings`, since
  *which* key you care about depends on your household.
