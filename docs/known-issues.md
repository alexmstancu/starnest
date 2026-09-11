# Known issues

Findings from the review of 2026-09-02, after `criteria/`, `data/`, `storage/`, `household/` and
`candidates/` were built. Two independent reviews — one of the Python, one of the SQL and the
contract. **Every finding here was reproduced**; nothing is speculative.

**D25 and D26 arrived later**, from an external review dated 2026-09-04 covering `storage/`,
`backend/` and `ui/`. They are recorded here on the same terms as the rest: both were checked
against the code, and the account below is the one the code supports rather than the one the
review wrote. The same review produced fifteen further findings that did not survive checking
— three contradicted by the line they cited, four naming files that do not exist, two that
would have introduced a defect if applied. Those fifteen are deliberately not filed, and the
count is recorded so that nobody re-imports them later on the strength of the two that were
real.

**How to read the split.** "Fixed" is what would have corrupted the first real numbers we ever
see, cost a line, or become expensive to fix once rows existed. "Deferred" is real but
survivable, and is picked up in a named later chunk. Nothing is here because it was too hard,
and nothing leaves this file by being forgotten -- a closed finding keeps its description, so
the account of a defect outlives the defect.

## Status

**32 findings: 21 closed, 11 open.** Everything high or medium is closed. What remains is
documentation, test-quality, and one dead table — no open finding has a live effect today.

| Closed | When | Where |
|---|---|---|
| **H1**-**H6** | 2026-09-02 | `criteria/`, `data/`, `storage/`, and the tests that missed them |
| **D23** | 2026-09-03 | `ui/eslint.config.js`, `make ui-check` wired into `check` |
| **D2**-**D6**, **D8**, **D12**, **D25**, **D26** | 2026-09-05 | migrations `0106`-`0110`, `criteria/`, the value seam, the contract |
| **D1**, **D7**, **D10**, **D11**, **D13** | 2026-09-05 | migrations `0111`-`0114`, `reqs.md` 7.1, the catalog guards |

| Open | Severity | Waiting on |
|---|---|---|
| **D9** | low | The catalog. `label_vocabulary` is dead — drop it or wire it |
| **D14**-**D16** | low | Test-quality. Three tests assert less than their names claim, and `LevelHierarchy` accepts a branching tree |
| **D17**-**D22** | low | Documentation and query drift between `reqs.md`, `openapi.yaml` and the SQL |
| **D24** | low | Five `set-state-in-effect` warnings in `ui/`. Each has a derived-state formulation; none is a bug |

## Fixed

### 2026-09-02 — the six that would have corrupted the first numbers

All six with a test written to fail against the old behaviour first. The
last column says what now holds; the description beside it is kept exactly as written, because
a defect nobody can still read the account of is one that comes back.

| # | Where | What | Fixed by |
|---|---|---|---|
| **H1** | `criteria/criterion.py` `band_label_for` | An **unlabelled anchor does not end the band below it**. With anchors `500 → affordable`, `1500 → (none)`, `3000 → unaffordable`, a rent of **2,999 displays as "affordable"**. The number beside it is right, which is what makes it dangerous | `band_label_for` takes the highest anchor at or below the figure and reads its label second, so an unlabelled anchor ends the band below it |
| **H2** | `storage/catalog_store.py` `_overrides_from`, `_conditions_from` | **The entire 956-test suite passes with both returning empty.** 39 of 41 attributes carry a source-priority override, and most *reverse* the global order — so the Python active-value path would silently read the wrong source's figure with correct-looking provenance, while the SQL view read the right one. Exactly the drift `data/active_value.py` exists to prevent | the override and condition assertions name the seeded sources and attributes, so an empty result fails; proven by mutating both mappers to `return ()` |
| **H3** | `data/payloads.py` `Monetary` | Records `fx_rate` but **never checks it produces the stored `amount_eur`**. `amount=910 RON, rate=0.201, amount_eur=910` is accepted. A CHF rent copied into `amount_eur` — the likeliest adapter mistake — compares directly against a EUR figure | `FX_CONVERSION_TOLERANCE`, a relative bound documented like `SHARE_SUM_TOLERANCE`: a stored rate must produce the stored `amount_eur`, and a EUR figure must equal its own equivalent |
| **H4** | `criteria/rebalancing.py` | **A locked weight can be moved without complaint.** `moved.locked` is never read. The lock is ignored for the one weight it was placed on | `rebalance` reads `moved.locked`; four situations, four accurate sentences, one exception type so `409 weights_all_locked` is unaffected |
| **H5** | `storage/queries/criteria.sql` `duplicate_criteria_set` | The copy **drops every band label** — `label` is missing from the insert. A criteria set is defined as a *full* copy (`reqs.md` Q191) | `label` added to both halves of the `copied_anchors` insert, with a storage test that duplicates a labelled anchor |
| **H6** | `tests/storage/test_active_value_behaviour.py` | **Three of the five ordering-rule tests still pass with the rule they name deleted from the view.** The expected winner is inserted *second*, so `id DESC` picks it for the wrong reason. The view itself is correct — the tests are the weak part | each expected winner is inserted FIRST so the view's tail tiebreaks against the rule under test; proven by deleting each ordering term from the view in a scratch database |

### 2026-09-03 — the gate covered half the codebase

- **D23** (medium) **The interface is never linted.** `ui/package.json` defines
  `"lint": "eslint ."`, but there is no `eslint.config.js`, so the script fails on any
  invocation — and `make check` does not call it, so nothing has ever reported this. `make
  check` is documented as "lint + boundaries + coverage + audits. This is the gate", and for
  half the codebase the lint half of that sentence is not true.
  **Closed by** `ui/eslint.config.js`, a `make ui-check` target, and `check` depending on it —
  the hole was bigger than reported, since `ui/` was never typechecked or tested by the gate
  either. The first run found a real defect: `availableCriteriaSets` was rebuilt by `?? []` on
  every render and used as an effect dependency, so that effect re-ran on every render until
  the fetch landed. **D24** below is the residue of that run, and is warnings only.

### 2026-09-05 — the schema, before `evaluation/` writes to it

Nine, in migrations `0106`-`0110` plus the Python and the contract. Done now rather than later
because every table involved was **empty**: a constraint added to a table with no rows is one
`ALTER`, and the same constraint added afterwards is an `ALTER` plus a decision about every row
that violates it — which in this application is unanswerable, since a score whose anchor was out
of range cannot be honestly repaired. That window closes the first time `evaluation/` runs.

Each constraint was removed in turn and the failing tests recorded. Two scale pins had no test
at all until that sweep said so.

| # | What | Closed by |
|---|---|---|
| **D2** | A **city could be ranked inside a country evaluation**: `candidate_result` named a candidate and an evaluation with nothing tying them together. `candidate_level_key` was created in `0002` for exactly this and went unused for six migrations | `0108`. Two keys: the row's level is the evaluation's, and the candidate is at the row's level |
| **D3**, **D25** | **Six columns across four tables carried a floor and no ceiling** — `score=999` and `coverage=4200` both inserted. The filed report named three; there were six. No ceiling could be written because there was nowhere to read one from | `0107`. The evaluation freezes `score_scale_max` — owed anyway under `reqs.md` Q193 — and each table carries it down pinned by a composite key. Percentages get a plain 0-100 bound. The live side has no evaluation to hang a ceiling on, so `Criterion.refuse_unless_its_anchors_fit` does it there |
| **D4** | The contract accepted and returned an evaluation **`note` the schema could not store** — the band-label defect again | `0110`. `evaluation.note`, refused when blank. `btrim(note) <> ''` was the first attempt and a parametrised test found that `btrim` strips spaces and nothing else; it is `note ~ '\S'` |
| **D5** | `EvaluationCriterion.scale_anchors` **omitted `label`** and carried a `maximum: 100` that is not the real ceiling | `openapi.yaml`. Label added, maximum dropped, and `EvaluationSummary` now carries `score_scale_max` — without it the freeze is invisible to every client |
| **D6** | `is_active` was computed by the view, **required by the contract, and dropped by the mapper**, so `api/` could not populate a required field | `ValueListing` at the seam. The mapper's reason for dropping it is right and is kept: being active is a comparison between values, and putting it on the value is how a stale flag comes to be written |
| **D8** | A criterion **could attach to a pillar-less attribute**, crashing at *save* time after a ranking had been computed and shown | `0106`. The criterion restates its pillar, as it already restates `value_type`, making the link a composite key |
| **D12** | Both views used `SELECT *`, which PostgreSQL **expands and freezes at `CREATE VIEW`** — every future column on `value` silently absent from the ranking read path | `0109`. The views name their columns, and a test compares the lists against the table so a build fails instead |
| **D26** | `non_match_reason` pointed at the **live** criterion. Nothing orphaned — the key restricts — so the failure ran the other way: `delete_criterion` would fail once any saved evaluation had recorded a non-match on it, and go on failing | `0108`. The reason names an attribute within the evaluation, reaching `evaluation_criterion` the way the frozen anchors already do |

---

### 2026-09-05 — the last high, and the four mediums

Five, in migrations `0111`-`0114` plus `reqs.md` 7.1 and the catalog guards. **D7 was a
decision rather than a defect**, and is the reason this group is worth reading: `reqs.md` 6.6
has always said every attribute declares a `max_age` and 7.1 gave none, so all 41 were seeded
NULL and rule 2 of the active-value view had never fired against real data. A mechanism fully
built, fully tested, and never once run.

| # | What | Closed by |
|---|---|---|
| **D1** | A conversion could name **a rate nobody published**. H3 made the rate explain the EUR figure, which catches an unconverted amount and cannot catch a rate that is internally consistent and simply wrong — 0.18 for RON/EUR on a day the ECB published 0.201 | `0112`. The ECB is seeded as a source and `(currency, EUR, date, rate)` is pinned to `fx_rate`, so the rate must be a published row. The quote currency is generated, so no insert path or model changed |
| **D7** | **0 of 41 attributes declared a `max_age`**, so freshness was inert and the confidence age-downgrade had no input | `reqs.md` 7.1 gains the column and the **rule** that produces it — stale once twice the source's publication interval has passed. `0111` is generated from that table and a test parses it back, comparing intervals in the database. Four attributes stay NULL and the document says why |
| **D10** | `external_score_natural_key` **omitted `reference_period_end`**, so a publisher's annual and monthly editions sharing a January start collided | `0113`. Widening a unique key cannot conflict with rows already stored |
| **D11** | **A candidate at a nested level could have no parent at all.** Three constraints guarded the hierarchy and all three keyed on the nullable `parent_level` | `0114`. **`MATCH FULL` is not the fix and this file was wrong to suggest it** — `candidate.level` is `NOT NULL`, so `MATCH FULL` would reject every country, whose `parent_level` is legitimately absent. The level's `requires_parent` is generated and pinned to the candidate, so a `CHECK` can require a parent without naming a level |
| **D13** | The weight guards **totalled instead of grouping** — the same question only while one criteria set at one level is seeded, against a product where duplicating a set is a shipped feature | Grouped by `(criteria_set, level)` and `(criteria_set, pillar, level)`, plus two tests that seed a second set split 40/60 — the case that used to read clean — and assert the guards catch it |

---

## Deferred

Each is real, reproduced, and not fixed yet. Grouped by the chunk of work that should carry it.

### With the catalog

- **D9** (low) **`label_vocabulary` is dead**: zero rows, zero query references, zero incoming
  foreign keys. Its own comment points at `attribute_allowed_label`, which does the real job.
  Drop it or wire it.

### Test-quality

- **D14** (low) `LevelHierarchy` **accepts a branching tree** while three docstrings claim it
  validates "a single ordered containment chain". `country → {city, province}` is accepted.
- **D15** (low) The objective/subjective FK guard in `test_schema_contract.py` classifies only 5
  subjective tables; ~13 are unclassified, so a violating FK into them would not be flagged. No
  violation exists today.
- **D16** (low) Three tests assert less than their names claim: an active-value `max_age` test
  with no discriminating power, a breakdown-scheme assertion that is vacuously true over `{}`,
  and the above.

### Documentation

- **D17** (low) `reqs.md` `Index` specifies a `polarity` that **appears nowhere else** — not in
  the schema, not in the contract. `criterion.goal` covers the need; stale word.
- **D18** (low) `openapi.yaml` types `Attribute.max_age_days` as an integer; the column is an
  `interval`. `interval '1 mon'` added to 31 January is not 30 days added to it.
- **D19** (low) `RatioPayload.basis` is nullable and not required in the contract; the column is
  `NOT NULL` and `payloads.py` says "the basis is required".
- **D20** (low) `select_attribute_coverage` says "for each attribute" but groups over
  `active_value`, so **an attribute with zero coverage produces no row** — and a never-fetched
  attribute is the one the run planner most needs to see.
- **D21** (low) `select_criteria_set` narrows criteria and pillar weights by `:level` but **not
  the enforced match rules or applied compound rules**, so a city-level gate would reach a country
  ranking. No live effect yet.
- **D22** (low) `replace_criterion_scale_anchors` zips three parallel arrays; the file's defence
  is that a length mismatch hits a `NOT NULL` — true for `scores`, but `label` is nullable, so a
  short array **silently blanks labels**.

### Tooling

- **D24** (low) Five call sites set state from an effect to follow something that arrived
  asynchronously — the default level and criteria set once their lists load
  (`SelectionContext`), the criteria list and the weight input following what the server
  returned (`useCriteriaEditor`, `ConfigureScreen`), and the idle reset in `useResource`. Each
  has a derived-state formulation that would not need the effect. `react-hooks/set-state-in-
  effect` reports all five as warnings; none is a bug today.

---

## Verified sound

Recorded because these are the invariants most worth knowing hold:

- **`active_value` matches `arch.md` 4 rule for rule** — including the two-column override trick,
  freshness measured from `reference_period_end`, and `NULLS`-safe `DISTINCT ON`. The Python
  freshness predicate is the exact negation of the SQL one.
- **Append-only holds.** No `UPDATE` or `DELETE` on `value` anywhere; rejection is a separate
  insert; `ValueStore` has neither to implement; no `ON DELETE` clause cascades into a value.
- **The two dates stay two dates** — different Python types, different SQL types, separate
  parameters, asserted from both ends.
- **Money never becomes a float** — `parse_float=Decimal` registered per connection.
- **Nothing hardcoded** — no attribute id, pillar id, weight, threshold, or the string `Romania`
  in any of the five modules.

---

## Found during P4 — 2026-09-09 to 2026-09-11

Five findings from the adapter streams, all reproduced. **The first four are not defects in
running code**: each is a place where two documents, or a document and the code, say different
things -- the kind of fault that costs nothing today and misleads the next person to rely on
either. **P5 was a defect**, and a live one.

| # | Finding | State |
|---|---|---|
| **P1** | **`reqs.md` 7.1 drifted from the catalog and no guard noticed.** `0442` and `0443` changed three attributes; the document went on describing all three the old way. The existing check walks `reqs.md` and looks each row up, so an attribute only the database has is never visited, and value types were never compared | **Fixed 2026-09-11.** `reqs.md` corrected, Q202 and Q203 logged, and two guards in `test_catalog_arithmetic.py` compare both directions and every value type. Both were watched failing against the stale document before it was fixed |
| **P2** | **Section 3.5a's test cannot be applied by reading it.** "Has someone already applied weights?" classifies the WGI governance indices (a model over ~30 expert surveys) and WHO UHC (14 tracer indicators) as composites -- `ExternalScore`, never scored -- yet `reqs.md` 7.1 names both as scored sources. Q203 adopts a narrower reading for price indices ("does the formula encode a view of what matters?") but does not say whether it settles the other two | **Open.** A decision, not a fix: either the named sources override the test or the test narrows. See `docs/catalog-blockers.md` |
| **P3** | **The interface mock invents `country.net_median_salary`**, an attribute that does not exist in the catalog (`ui/src/mocks/fixtures.ts`). Mocks may be fictional; one naming a non-existent attribute id reads as documentation of what is available | **Open**, low. Rename to a real attribute when the fixtures are next touched |
| **P4** | **The household's income is stored and never used.** `net_income`, `target_monthly_spend` and `max_rent` are persisted and served, and nothing in `evaluation/` reads them. Q84 says cost of living means something only against your own income; Q85 specifies rent-against-spend as a warning. Neither is built | **Open, by scope.** Confirmed out of MVP on 2026-09-11 along with rent by bedroom count, which is city-level. Recorded so the unused columns are not mistaken for dead ones |
| **P5** | **`POST /data-acquisition-runs` fetched from the first source only.** The endpoint passed `adapters[0]` to the run while its plan counted all six, so a run through the API fetched Eurostat and nothing else, and reported itself `completed`. Every acceptance test ran against one stub source, where "the first" and "all of them" cannot differ. `make acquire` loops over every adapter itself, which is why the stored figures never showed it. Found reading the endpoint for Gate B | **Fixed 2026-09-11.** A run fans out over every source. The plan also counted an attribute twice when two sources answer it (the tax rate: OECD and the estimate); an item is now one candidate and one attribute, the unit progress counts and retry addresses. Four acceptance tests run against two sources, and failed before the fix |
