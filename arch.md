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
| Examples | `Candidate`, `Attribute`, `Value`, `Pillar`, `Criterion`, `CriteriaSet`, `Evaluation`, `Household`, the ten value types | `country`, `city`, `economics`, `rent_centre`, `population` |
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
attributes:
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

An attribute's **`id` and `value_type` are immutable together.** Changing an attribute's type
means creating a new attribute and retiring the old one.

This dissolves what looks like the hardest problem with a config-driven ontology — what happens
when an attribute changes from `Ratio` to `LabelSet`, and how do stored values convert?

They do not convert, and they should not:

- An attribute's type is part of its **identity**. "Forest cover as a `Ratio`" and "forest cover
  as a `LabelSet` of biome names" are not one attribute modelled two ways; they are different
  questions. Changing the type means you decided to measure something else.
- The stored values are **still true**. Forest cover really was 38% in 2024, whatever you now
  want to model. Discarding them would violate *no value is ever discarded*.

So the old attribute is marked **retired**: it drops out of active scoring, its values remain
as historical record, and the new attribute starts empty.

Attribute IDs are `<level>.<name>` — `city.rent_centre`. The level is in the ID because
cross-level concepts are separate attributes; the pillar is not, precisely so that pillar
assignment stays mobile.

**What may change freely**, because no stored value depends on it: name, description, pillar
assignment, sources, source priority, `max_age`. Everything subjective — weight, direction,
thresholds, anchors — was never on the attribute at all; it lives in `CriteriaSet`.

**One edge case:** tightening `allowed_range` must **re-validate stored values** and mark newly
implausible ones rejected, rather than silently changing which value is active.

---

## 3. Storage

### 3.1 Narrow, not wide

There is no `countries.population` column, and there must not be. If attributes were columns,
adding an attribute would be a schema migration — which contradicts *adding an attribute is a
data change*.

Storage is **narrow**: values are rows keyed by candidate, attribute and source. Adding a
attribute inserts rows and never alters a table.

### 3.2 Identifiers and keys

**Attributes and candidates are rows, not just config entries.** The attributes catalog is loaded
from config into a `attribute` table at boot (upsert by `id`), and candidates into a
`candidate` table. `value` then holds **real foreign keys**, not loose strings.

This is what makes retirement work. When an attribute is retired (§2), its stored values must
keep pointing at something. If attributes existed only in config, deleting an entry would orphan
every historical value. As a row with `lifecycle_status = retired`, the foreign key stays valid
permanently while the attribute drops out of active scoring.

**Identifier schemes**, one readable convention across both halves of the key:

| Entity | ID | Why |
|---|---|---|
| Attribute | `city.rent_centre` | `<level>.<name>` — level is identity, pillar is not (`reqs.md` §3.3) |
| Country | `country.portugal` | The name, lowercased, underscores for spaces — `country.united_kingdom` |
| City | `city.portugal.lisbon` | Country-qualified — city names are not globally unique |

**Identifiers are ours; adapters translate.** World Bank and Eurostat key on `PT`, Numbeo on
`Portugal` in a URL path, GeoNames on a numeric ID. Each adapter maps our identifier to
whatever its source expects — that translation is the adapter's whole job and must never leak
into how we name things internally. ISO 3166 alpha-2 and alpha-3 are stored in
the attribute catalog, where adapters read them.

> Country names do drift — Czechia, Türkiye, Eswatini — which is a genuine argument for codes.
> But that argues for keeping the code as a **fact**, not for making an unreadable string the
> identity. Where a name is contested, pick one canonical form for the ID and record the
> alternates as facts; the ID never changes afterwards, whatever the country later calls itself.

**`value` uses a surrogate primary key.** The natural key is six columns —
`(candidate, attribute, data_source, breakdown_option, reference_period_start, retrieval_date)` —
and propagating that into ten child tables would mean sixty columns of duplication and joins on
six conditions. Instead:

```
value          id            surrogate PK
               UNIQUE (candidate, attribute, data_source, breakdown_option,
                       reference_period_start, retrieval_date)

value_monetary value_id      PRIMARY KEY, FK → value.id
```

Exactly one payload row per value — see §3.3b for why, and for what enforces it.

A composite key therefore reads as `city.portugal.lisbon` × `city.rent_centre` — both
halves legible without a lookup.

The UNIQUE constraint still prevents the same fetch being stored twice, while legitimate
history — the same source re-fetched later — differs by `retrieval_date` and is preserved.
Because `breakdown_option` is one of the six columns, the three Lisbon rents are three distinct
rows rather than a collision.

### 3.2a Reference tables

The database is **normalised**. Anything that is a fixed, rarely-changing thing — a country, a
attribute, a source, a unit — lives in its own small table with a stable identifier, and
everything else stores that identifier rather than the name. These are commonly called
**lookup tables** or **reference data**.

The point is that a display name can be corrected, translated or re-styled without touching a
single row that refers to it.

| Table | Holds | Identifier |
|---|---|---|
| `candidate` | Countries and cities | `country.portugal`, `city.portugal.lisbon` |
| `pillar` | The eleven pillars | `housing`, `nature` |
| `level` | The ordered levels | `country` (1), `city` (2) |
| `attribute` | The attribute catalog, loaded from config | `city.rent_centre` |
| `data_source` | Sources, with kind and reliability tier | `eurostat`, `numbeo`, `manual` |
| `value_type` | The ten archetypes, so values can point at one | `Monetary`, `Index` |
| `unit` | Units a `Quantity` may carry | `celsius`, `km`, `mbps`, `hours_per_year` |
| `currency` | Currencies a `Monetary` may carry | `EUR`, `GBP`, `CHF` |
| `confidence_level` | The four grades | `absolute`, `high`, `medium`, `low` |
| `match_rule` | The named gates of `reqs.md` §7.3 | `uk_skilled_worker` |
| `label_vocabulary` | Controlled vocabularies for `LabelSet` attributes | Köppen zone codes |
| `criteria_set` | Named criteria sets | `alex`, `remote_only` |
| `evaluation` | One criteria set run against one level | surrogate |
| `data_acquisition_run` | Data acquisition runs | surrogate |

**The rule that makes this work: identifiers never change; names do.** An identifier is
assigned once and is permanent, even when the thing it names is renamed. Country names drift —
Czechia, Türkiye, Eswatini — and when one does, `candidate.name` is updated and `candidate.id`
is not. Every foreign key survives. The identifier may end up reading oddly; that is the correct
trade, because the alternative is rewriting every row that points at it.

> A readable identifier is a surrogate key that happens to be legible. It is not derived from
> the display name and is never regenerated from it.

### 3.3 A shared parent with typed children

Values share seven fields and differ in the rest by type. Rather than one table with nullable
columns for every type's payload, or ten unrelated tables, the shape is a **parent table with
typed child tables**:

```
value              id, candidate, attribute, value_type, data_source,
                   breakdown_option, reference_period_start,
                   reference_period_end, retrieval_date,
                   confidence_level, usage_status, data_acquisition_run

value_monetary     value_id, value_type, amount, currency, amount_eur,
                   fx_rate, fx_rate_date
value_quantity     value_id, value_type, magnitude, unit
value_count        value_id, value_type, count, basis
value_ratio        value_id, value_type, value, basis
value_index        value_id, value_type, value, provider, scale_min, scale_max
value_labelset     value_id, value_type, label
value_sharecomp    value_id, value_type, label, share
value_boolean      value_id, value_type, value
value_score        value_id, value_type, value, range_min, range_max,
                   assigned_by, rationale
value_text         value_id, value_type, body
```

This buys three things at once:

- **Real constraints.** `amount NUMERIC NOT NULL`, `currency CHAR(3) NOT NULL`,
  `CHECK (amount > 0)`. The database enforces the type-implicit validation rules from
  `reqs.md` §3.3a, rather than trusting application code to remember.
- **The common path stays cheap.** The four operations the app performs most — every value for
  a candidate, choosing the active value, computing coverage, the attribute drill-down — read
  `value` alone and never touch a child table.
- **Adding a type is one new child table**, which is consistent: adding a type is already a
  code change.

### 3.3a Several numbers for one attribute — two different cases

These look alike and are not.

**Time series — the same measurement at different times.** GDP per person for 2020, 2021, 2022.
Only one is current; the rest are history. They differ by `reference_period_start`, which is
already part of the uniqueness constraint, so they are **separate `value` rows** and need no
schema change. What is missing is only a *reducer*: a rule for using more than the freshest one,
such as a three-year mean or a trend. **Not in v1.**

**Multi-value — different measurements at the same time, all current.** Rent in Lisbon is about
€1,100 for a one-bedroom, €1,410 for two, €1,900 for three. None is history; they coexist and
together describe the attribute (`reqs.md` §3.3b).

**These are also separate `value` rows**, distinguished by `breakdown_option`:

```
value  9001 | city.portugal.lisbon | city.rent_centre | one_bedroom   | numbeo | 2026-07
value  9002 | city.portugal.lisbon | city.rent_centre | two_bedroom   | numbeo | 2026-07
value  9003 | city.portugal.lisbon | city.rent_centre | three_bedroom | numbeo | 2026-07

value_monetary  9001 | 1100 EUR
value_monetary  9002 | 1410 EUR
value_monetary  9003 | 1900 EUR
```

> **An earlier draft of this section put all three in one `value` row** with a `key` column on
> the child table. That was written before `breakdown_option` joined the uniqueness constraint,
> when three separate rows would have collided. It is superseded, and separate rows are better
> for a reason beyond avoiding the collision: **confidence, freshness and supersession are
> properties of one figure, not of three.** Numbeo may hold two hundred submissions for a
> two-bedroom and five for a four-bedroom — genuinely different confidence. Sharing one row
> would force one `confidence_level`, one `reference_period` and one `usage_status` across all
> of them, and would stop a fresher two-bedroom figure superseding on its own.
>
> It also makes **exactly one payload row per value** true, which §3.3b depends on.

The reducer runs **at scoring time, never at fetch**. An adapter that fetched all three rents
and stored only the selected one would make changing household size require re-fetching every
city, and would make simulation impossible. Every option is written; the choice happens when the
score is computed.

### 3.3b The database enforces that a payload matches its attribute's type

Nothing so far stops a value for `city.rent_centre` — declared `Monetary` — from carrying a
`value_count` payload instead. Both rows would be individually valid, and no constraint would
connect them.

**The damage would be a plausible wrong answer rather than a crash.** Zurich's rent stored as a
count is the bare number 2900, with no currency, so the EUR conversion never runs. The ranking
then compares 2900 against Lisbon's 1410 and reports a gap that is simply wrong — with every
provenance field correctly filled in and nothing looking broken.

Three constraints close it, and they need no triggers:

```sql
-- 1. the catalog's declaration becomes referenceable
ALTER TABLE attribute      ADD UNIQUE (id, value_type);

-- 2. a value must agree with its attribute
ALTER TABLE value          ADD FOREIGN KEY (attribute, value_type)
                               REFERENCES attribute (id, value_type);
ALTER TABLE value          ADD UNIQUE (id, value_type);

-- 3. a payload may only attach to a value of its own type
ALTER TABLE value_monetary ADD CONSTRAINT is_monetary
                               CHECK (value_type = 'Monetary');
ALTER TABLE value_monetary ADD FOREIGN KEY (value_id, value_type)
                               REFERENCES value (id, value_type);
```

The chain reads: **the catalog says `Monetary` → the value must say `Monetary` → only the
monetary payload can attach → and its primary key on `value_id` makes it the only one.** A bad
insert fails at insertion, naming the constraint, rather than surfacing as a wrong number weeks
later.

`value.value_type` is **denormalised on purpose**. It duplicates what the attribute already
declares, and that duplication is the whole mechanism: a two-column foreign key needs both
columns present on the referring row. Since attribute type is immutable (§2), the copy can never
drift.

**The same pattern applies to criteria.** A `CRITERION` carries the attribute's `value_type` the
same way, and each threshold child table pins its own — so a `LabelSet` attribute cannot be
given a numeric range, and exactly one threshold kind can exist.

### 3.4 `usage_status`, and never discarding

`value.usage_status` is `active`, `superseded` or `rejected`. Nothing is deleted. A value that fails
validation is stored with `rejected` and its reason; a value outranked by source priority is
`superseded`. Exactly one value per (candidate, attribute) is `active`.

### 3.5 Scale

For v1 — 32 countries × ~44 country attributes × ~2 sources ≈ **2,800 rows**. With cities and
accumulated history, perhaps 50,000. Small enough that no storage decision here is driven by
performance.

---

### 3.6 Two families of table, and the line between them

The schema divides exactly as `reqs.md` §3.0 does, and the division is worth enforcing in the
database rather than only in prose:

| Objective — what is true | Subjective — what you make of it |
|---|---|
| `level`, `candidate`, `pillar`, `attribute` | `criteria_set`, `criterion` |
| `value` and its typed children | `evaluation`, `candidate_result` |
| `data_source`, `run`, `external_score` | `household` |
| `match_rule`, `match_rule_result` | |

**No table on the left ever carries a foreign key to one on the right.** Values do not know
which criteria set is active; candidates do not store a score. That is what makes a
re-evaluation pure arithmetic over stored rows, and it is why switching from `alex` to
`partner` cannot trigger a fetch (`reqs.md` §5.6).

`evaluation` and `candidate_result` are the tables that did not exist in the earlier draft,
where score and match status sat on the candidate. Keeping several evaluations is a matter of
retaining rows — they are cheap, and comparing two criteria sets over the same data becomes a
query rather than a re-run.

`household` is a single-row table. It is on the subjective side because it describes the asker,
not any candidate, and because changing it changes criterion defaults and warnings without
touching a single measured value.

---

## 4. Choosing the active value

Implemented once, in one place, against `Candidate` — never per level. In order:

1. Discard values with `usage_status = rejected`.
2. **Fresh beats stale** — older than the attribute's `max_age` drops below every fresh value.
3. **Source priority** — the attribute's ordering, falling back to the global default.
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
  - attribute: country.population
    level: country
    indicator: SP.POP.TOTL
    produces: Count
```

**Both configs are cross-validated at boot.** Does attribute `country.population` exist? Does its
declared `value_type` match what the adapter claims to produce? A mismatch is a **startup
error**, not a corrupted value discovered months later. This is the highest-value property of
the whole design and it costs almost nothing.

An attribute gets its value by one of two bindings:

| Binding | Declared where | Example |
|---|---|---|
| **Adapter fetch** | The adapter's `provides` block | World Bank `SP.POP.TOTL` → `country.population` |
| **Manual entry** | Typed by the user, ranked like any source | The UK visa match-rule result |

> **There used to be a third**, letting an attribute borrow a value from a separate facts
> entity. `reqs.md` §3.3 dissolved that entity: descriptive facts *are* attributes, so
> `country.population` is fetched once by an adapter and read directly by whatever judges it.
> One binding fewer, and one indirection that can no longer go stale.

### 5.1 Two fetch modes

Adapters declare `mode`, because the two behave nothing alike:

- **`bulk`** — one download refreshes many candidates. UNODC, Ookla tiles, Köppen zones, WDPA.
  Scheduled, infrequent, cheap per candidate.
- **`per_candidate`** — one call per candidate or attribute. Eurostat, World Bank, Open-Meteo,
  the LLM path. Subject to rate limits and the budget cap.

The acquisition layer must support both. A run mixes them.

---

## 6. Carried from the master spec

Preserved before the spec's deletion. These are its proposals, not settled decisions.

### 6.1 Goal

A **local, self-contained application** that runs the whole pipeline — acquisition,
interpretation, scoring, ranking — with no manual intervention beyond configuring attributes and
starting a run. The spec's phrase for the bar it must clear: **"zero copy-paste between chat
and the app."**

### 6.2 Proposed stack, and the alternative it rejected

| Component | Proposed | Reason given |
|---|---|---|
| Language | Python 3.12+ | Fastest ecosystem for data + LLM SDK + UI |
| UI | Streamlit | Weight sliders and a sortable table with minimal frontend code; runs locally, no deployment |
| Storage | **PostgreSQL** | **Decided.** See below — supersedes the spec's SQLite proposal |
| Qualitative | Anthropic API + `web_search` | Removes the need for a custom scraper; structured JSON with score and citations |
| Structured | Direct fetch | Cheaper, more reliable, deterministic |

**The rejected alternative, recorded because the reasoning still applies:** Alex's background is
Go, and now C#/.NET. The spec chose Python for ecosystem reasons — pandas, requests, the LLM
SDK, and Streamlit's interactivity for free. Go or C# remain feasible at the cost of building a
separate frontend for the interactive parts.

**Storage is PostgreSQL.** The spec proposed SQLite on a "15–40 cities" premise that no longer
holds — v1 alone seeds 32 countries with ~44 attributes, before the city level exists at all. The
choice is made on optionality rather than on present need. Data volume is not the argument —
32 countries is trivial for any engine. The argument is **operational**: Postgres has native
streaming replication, so read replicas and failover are available later without changing
engines, and nothing in this document depends on running locally from a single file. That
capability is unused today, and on a single-user local app it stays unused for some time; it
is bought now because acquiring it later would mean a migration. Decided 2026-08-23.

**The schema is versioned in git**, as migrations rather than as a hand-managed database.
Seed and data-insertion scripts are versioned the same way. This matters more than the engine
choice: it is what makes the database reproducible from the repository, so a dropped database
is an inconvenience rather than a loss. Every schema change ships as a migration — no
out-of-band edits to a live database.

### 6.3 Proposed module layout

`config/`, `acquisition/structured.py`, `acquisition/qualitative.py`, `storage/db.py`,
`scoring/engine.py`, `scoring/compare.py`, `ui/app.py`

The spec's SQLite schema sketch — tables `countries`, `country_scores`, `cities`,
`city_scores`, `config` — **predates the `Candidate` unification and must be re-derived, not
copied.** Separate country and city tables would reintroduce exactly the duplication that
`Candidate` exists to prevent.

### 6.4 Data flow

**Country level:** configure attributes → select countries → screen using structured sources only
→ score → those below the qualification threshold do not have cities extracted.

**City level:** for qualified countries, nominate cities → structured *and* qualitative
acquisition, **run in parallel** → store → filter and score → ranking updates.

**Comparison:** pick a focus candidate and comparators → delta table plus templated synthesis.

### 6.5 Sizing, and why the levels exist

The figures that justify the architecture:

- ~30 countries screened cheaply is expected to **eliminate 15–20 clearly unsuitable ones**
  before any city work begins.
- That takes deep city evaluation from ~100 candidates down to **~40–50**, without losing a
  serious contender.
- Running the full attributes set including LLM calls on all 100 directly would waste most of the
  effort on cities that fail a cheap gate anyway.

This is the whole argument for evaluating in levels rather than one uniform pass, and it is the reason the
country level is v1.

### 6.6 Setup

The qualitative path needs a **dedicated Anthropic API key** from console.anthropic.com,
separate from a Claude.ai subscription and billed per use. The spec's cost framing: a few dozen
calls per city, not millions.

---

> **Decisions with their rationale live in `reqs.md` Appendix B**, which is the project's single
> decision log — architecture entries included, most recently Q140–Q142. This document explains
> the design; the log records why each call was made and what it superseded.

---

## 7. Open

- **Language and UI framework** are still undecided; §6.2 records what the spec proposed and
  why, as a starting point rather than a conclusion. **The database is settled: PostgreSQL**
  (§6.2). Whether geometry lives in the database via PostGIS, or is computed at acquisition
  time and stored as plain numbers, stays open — but it is now an extension question inside a
  chosen engine, not an engine question.
- **Time-series reducers.** Which rows scoring uses when an attribute has several reference
  periods — latest, a three-year mean, a trend. A preference rather than a fact, so it belongs
  in `CriteriaSet`. **Not in v1**, and it needs no schema change: the rows are already separate
  (§3.3a).

  *(The multi-value reducer is **not** open — it is in v1. `CRITERION.reducer_mode` plus
  `CRITERION.breakdown_option` select which rent applies, `reqs.md` §3.4.)*
- **Derived attributes**, deferred to post-MVP. `two_role_feasibility` and
  `country.natural_diversity` both want one. When built, a derivation is an **adapter that reads
  other attributes** rather than a formula in config — which keeps §1.1's guardrail intact and
  gives a derived value provenance, confidence and a reference period like any other.

- **First implementation order.** The spec's suggestion, still sound: repo scaffolding, then the
  database schema, then structured acquisition as the first end-to-end sanity check. Sequencing
  belongs in `devplan.md`.
