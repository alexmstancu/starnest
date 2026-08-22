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
  - id: country.population
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

Criterion IDs are `<level>.<name>` — `city.rent_2br_centre`. The level is in the ID because
cross-level concepts are separate criteria; the pillar is not, precisely so that pillar
assignment stays mobile.

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

### 3.2 Identifiers and keys

**Criteria and candidates are rows, not just config entries.** The criteria catalog is loaded
from config into a `criterion` table at boot (upsert by `id`), and candidates into a
`candidate` table. `value` then holds **real foreign keys**, not loose strings.

This is what makes retirement work. When a criterion is retired (§2), its stored values must
keep pointing at something. If criteria existed only in config, deleting an entry would orphan
every historical value. As a row with `status = retired`, the foreign key stays valid
permanently while the criterion drops out of active scoring.

**Identifier schemes**, one readable convention across both halves of the key:

| Entity | ID | Why |
|---|---|---|
| Criterion | `city.rent_2br_centre` | `<level>.<name>` — level is identity, pillar is not (`reqs.md` §3.3) |
| Country | `country.pt` | ISO 3166 alpha-2, already a fact and already unique |
| City | `city.pt.lisbon` | Country-qualified — city names are not globally unique |

**`value` uses a surrogate primary key.** The natural key is five columns —
`(candidate_id, criterion_id, source_id, reference_period_start, retrieval_date)` — and
propagating that into ten child tables would mean fifty columns of duplication and joins on
five conditions. Instead:

```
value          id            surrogate PK
               UNIQUE (candidate_id, criterion_id, source_id,
                       reference_period_start, retrieval_date)

value_monetary value_id      FK → value.id
               PRIMARY KEY (value_id, key)
```

The UNIQUE constraint still prevents the same fetch being stored twice, while legitimate
history — the same source re-fetched later — differs by `retrieval_date` and is preserved. The
child tables key on `(value_id, key)`, which is what admits keyed and series cardinality (§7)
without further change.

### 3.3 A shared parent with typed children

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

### 3.4 `status`, and never discarding

`value.status` is `active`, `superseded` or `rejected`. Nothing is deleted. A value that fails
validation is stored with `rejected` and its reason; a value outranked by source priority is
`superseded`. Exactly one value per (candidate, criterion) is `active`.

### 3.5 Scale

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
  - criterion: country.population
    level: country
    indicator: SP.POP.TOTL
    produces: Count
```

**Both configs are cross-validated at boot.** Does criterion `country.population` exist? Does its
declared `value_type` match what the adapter claims to produce? A mismatch is a **startup
error**, not a corrupted value discovered months later. This is the highest-value property of
the whole design and it costs almost nothing.

A criterion gets its value by one of three bindings:

| Binding | Declared where | Example |
|---|---|---|
| **Adapter fetch** | The adapter's `provides` block | World Bank `SP.POP.TOTL` → `country.population` |
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

## 6. Carried from the master spec

Preserved before the spec's deletion. These are its proposals, not settled decisions.

### 6.1 Goal

A **local, self-contained application** that runs the whole pipeline — acquisition,
interpretation, scoring, ranking — with no manual intervention beyond configuring criteria and
starting a run. The spec's phrase for the bar it must clear: **"zero copy-paste between chat
and the app."**

### 6.2 Proposed stack, and the alternative it rejected

| Component | Proposed | Reason given |
|---|---|---|
| Language | Python 3.12+ | Fastest ecosystem for data + LLM SDK + UI |
| UI | Streamlit | Weight sliders and a sortable table with minimal frontend code; runs locally, no deployment |
| Storage | SQLite | Local file, no server, "sufficient at the scale of 15–40 cities" |
| Qualitative | Anthropic API + `web_search` | Removes the need for a custom scraper; structured JSON with score and citations |
| Structured | Direct fetch | Cheaper, more reliable, deterministic |

**The rejected alternative, recorded because the reasoning still applies:** Alex's background is
Go, and now C#/.NET. The spec chose Python for ecosystem reasons — pandas, requests, the LLM
SDK, and Streamlit's interactivity for free. Go or C# remain feasible at the cost of building a
separate frontend for the interactive parts.

Both the SQLite choice and the "15–40 cities" premise predate the current design: v1 alone
seeds 32 countries with ~44 criteria, and the database question is now genuinely open (§7).

### 6.3 Proposed module layout

`config/` · `acquisition/structured.py` · `acquisition/qualitative.py` · `storage/db.py` ·
`scoring/engine.py` · `scoring/compare.py` · `ui/app.py`

The spec's SQLite schema sketch — tables `countries`, `country_scores`, `cities`,
`city_scores`, `config` — **predates the `Candidate` unification and must be re-derived, not
copied.** Separate country and city tables would reintroduce exactly the duplication that
`Candidate` exists to prevent.

### 6.4 Data flow

**Country level:** configure criteria → select countries → screen using structured sources only
→ score → those below the qualification threshold do not have cities extracted.

**City level:** for qualified countries, nominate cities → structured *and* qualitative
acquisition, **run in parallel** → store → filter and score → ranking updates.

**Comparison:** pick a focus candidate and comparators → delta table plus templated synthesis.

### 6.5 Sizing, and why the two levels exist

The figures that justify the architecture:

- ~30 countries screened cheaply is expected to **eliminate 15–20 clearly unsuitable ones**
  before any city work begins.
- That takes deep city evaluation from ~100 candidates down to **~40–50**, without losing a
  serious contender.
- Running the full criteria set including LLM calls on all 100 directly would waste most of the
  effort on cities that fail a cheap gate anyway.

This is the whole argument for two levels rather than one uniform pass, and it is the reason the
country level is v1.

### 6.6 Setup

The qualitative path needs a **dedicated Anthropic API key** from console.anthropic.com,
separate from a Claude.ai subscription and billed per use. The spec's cost framing: a few dozen
calls per city, not millions.

---

## 7. Open

- **The stack.** Language, UI framework, and database engine are undecided; §6.2 records what
  the spec proposed and why, as a starting point rather than a conclusion. On the database:
  SQLite's FTS5 and R-Tree are built in, so the full-text case needs no extension; the real
  deciding question is whether geometry lives in the database (favouring PostGIS) or is
  computed in Python at acquisition time and stored as plain numbers (favouring SQLite).
  Everything above holds either way.
- **Cardinality.** Whether a criterion may be `scalar`, `keyed` (rent by room count) or
  `series` (a value per year), as a second axis orthogonal to value type. The `key` column in
  the child tables above anticipates it. Discussed, not decided.
- **Where the reducer lives** if cardinality is adopted — likely `CriteriaSettings`, since
  *which* key you care about depends on your household.

- **First implementation order.** The spec's suggestion, still sound: repo scaffolding, then the
  database schema, then structured acquisition as the first end-to-end sanity check. Sequencing
  belongs in `devplan.md`.
