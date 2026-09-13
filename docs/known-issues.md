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

**32 findings: 22 closed, 10 open.** Everything high or medium is closed. What remains is
documentation and test-quality — no open finding has a live effect today. **The dead table is
gone** (D9, `0472`).

| Closed | When | Where |
|---|---|---|
| **H1**-**H6** | 2026-09-02 | `criteria/`, `data/`, `storage/`, and the tests that missed them |
| **D23** | 2026-09-03 | `ui/eslint.config.js`, `make ui-check` wired into `check` |
| **D2**-**D6**, **D8**, **D12**, **D25**, **D26** | 2026-09-05 | migrations `0106`-`0110`, `criteria/`, the value seam, the contract |
| **D1**, **D7**, **D10**, **D11**, **D13** | 2026-09-05 | migrations `0111`-`0114`, `reqs.md` 7.1, the catalog guards |

| Open | Severity | Waiting on |
|---|---|---|
| ~~**D9**~~ | — | **Closed 2026-09-13 (Q229): dropped.** It was superseded before it was ever used, and its own COMMENT said so -- `attribute_allowed_label` arrived two migrations later and holds per-attribute vocabularies, while no two attributes share one. **The more useful half of the finding was the third table**: `attribute_allowed_label` was fully wired -- read by `catalog.sql`, carried on `Attribute.allowed_labels`, enforced in `refuse_unless_the_payload_suits` -- and completely empty, so `country.climate_zone` would have accepted any string. It now permits the 20 Köppen codes that occur in Europe |
| **D14**-**D16** | low | Test-quality. Three tests assert less than their names claim, and `LevelHierarchy` accepts a branching tree |
| **D17**-**D22** | low | Documentation and query drift between `reqs.md`, `openapi.yaml` and the SQL |
| **D24** | low | Nine `set-state-in-effect` warnings in `ui/`, up from five: the criterion editor's draft follows the stored rule the same way `CriterionRow`'s input follows the stored weight. Each has a derived-state formulation; none is a bug |

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

Sixteen findings from the adapter streams, all reproduced. **The first four are not defects in
running code**: each is a place where two documents, or a document and the code, say different
things -- the kind of fault that costs nothing today and misleads the next person to rely on
either. **P5 and P7 were defects**, and live ones.

| # | Finding | State |
|---|---|---|
| **P1** | **`reqs.md` 7.1 drifted from the catalog and no guard noticed.** `0442` and `0443` changed three attributes; the document went on describing all three the old way. The existing check walks `reqs.md` and looks each row up, so an attribute only the database has is never visited, and value types were never compared | **Fixed 2026-09-11.** `reqs.md` corrected, Q202 and Q203 logged, and two guards in `test_catalog_arithmetic.py` compare both directions and every value type. Both were watched failing against the stale document before it was fixed |
| **P2** | **Section 3.5a's test cannot be applied by reading it.** "Has someone already applied weights?" classifies the WGI governance indices (a model over ~30 expert surveys) and WHO UHC (14 tracer indicators) as composites -- `ExternalScore`, never scored -- yet `reqs.md` 7.1 names both as scored sources. Q203 adopts a narrower reading for price indices ("does the formula encode a view of what matters?") but does not say whether it settles the other two | **Decided and fixed 2026-09-12 (Q223): the test narrows.** It now asks whether the formula **encodes a view of what matters** -- weights that trade one good against another bar a figure, weights within a single dimension do not -- which generalises the reading Q203 had already adopted for one attribute. WGI and WHO UHC stay scored, and section 3.5a names all four settled cases beside the rule, because a test that asks for judgement is only usable next to its worked examples. Applying the old test literally was the alternative, and it would have emptied two pillars with nothing raw to replace them |
| **P3** | **The interface mock invents `country.net_median_salary`**, an attribute that does not exist in the catalog (`ui/src/mocks/fixtures.ts`). Mocks may be fictional; one naming a non-existent attribute id reads as documentation of what is available | **Open**, low. Rename to a real attribute when the fixtures are next touched |
| **P4** | **The household's income is stored and never used.** `net_income`, `target_monthly_spend` and `max_rent` are persisted and served, and nothing in `evaluation/` reads them. Q84 says cost of living means something only against your own income; Q85 specifies rent-against-spend as a warning. Neither is built | **Open, by scope.** Confirmed out of MVP on 2026-09-11 along with rent by bedroom count, which is city-level. Recorded so the unused columns are not mistaken for dead ones |
| **P5** | **`POST /data-acquisition-runs` fetched from the first source only.** The endpoint passed `adapters[0]` to the run while its plan counted all six, so a run through the API fetched Eurostat and nothing else, and reported itself `completed`. Every acceptance test ran against one stub source, where "the first" and "all of them" cannot differ. `make acquire` loops over every adapter itself, which is why the stored figures never showed it. Found reading the endpoint for Gate B | **Fixed 2026-09-11.** A run fans out over every source. The plan also counted an attribute twice when two sources answer it (the tax rate: OECD and the estimate); an item is now one candidate and one attribute, the unit progress counts and retry addresses. Four acceptance tests run against two sources, and failed before the fix |
| **P6** | **OECD's API front door is intermittently closed to scripts.** `sdmx.oecd.org` answered on 2026-09-09 and served a Cloudflare browser challenge on 2026-09-11 to the identical request. The run recorded it as a bare "403 Forbidden", which reads as a fault in the request | **Open, watched.** The adapter now names the challenge (`cf-mitigated: challenge`), and OECD's stored figures are untouched. If the block persists past their `max_age`, the tax column falls to the low-confidence estimate, visibly. `catalog-blockers.md` item 5 has the options |
| **P7** | **A run's failures could not say who failed, and a whole source failing left no trace.** `data_acquisition_failure` was keyed on (run, candidate, attribute) with no source, so where two sources failed on one item the second message overwrote the first, and a retry could not know whom to ask again. A failure with no candidate -- a source unreachable as a whole -- was skipped, its docstring saying "the run's status carries it instead"; the status said `completed`. And the API counted `items_failed` as the length of the failure list, overlapping `items_completed` wherever a second source answered, while the query computed the right number and nobody read it. Found building the retry | **Fixed 2026-09-11.** `0461` puts the source on every failure and in its key (backfilled `eurostat`, truthfully: the API had asked no other source until P5). A whole-source failure is recorded against every candidate the run asked about. `items_failed` means asked and answered by no source, read from the query. Tests for each; the retry's narrowing test was rewritten after its first version let the narrowing mutant survive |
| **P8** | **The gate called Eurostat.** `make coverage` -- and so `make check` -- ran pytest with no marker filter, so the one `live` test fetched from the real API inside the gate, although the marker's own description says it never runs in the normal suite. The gate could fail because Eurostat was slow, which says nothing about this code (`arch.md` 6.7) | **Fixed 2026-09-11.** `make coverage` excludes `live`; `make live` runs them on purpose, and Gate B's all-32 check joined them |
| **P9** | **`reqs.md` 6.5 listed different manual-entry attributes from 7.1 and the catalog.** 6.5 named `tech_software_jobs`, `tech_product_jobs`, `remote_work_tax_treaty` and `international_employers`; the catalog, following 7.1's sources column, permits `international_employers`, `naturalisation_pathway`, `pension_portability`, `remote_work_tax_treaty` and `residency_admin_ease` | **Decided and fixed 2026-09-12 (Q215).** The catalog wins: manual entry is for a fact published on a citable page, not for a count whose meaning depends on how it was counted. Two hand-typed job counts are not comparable, and in a ranking they read like measured ones. 6.5 now lists the catalog's five, and says why the two counts are not among them |
| **P10** | **A monetary payload's exchange rate is not served.** The contract describes it as rate, date and publisher, and the payload carries the first two only | **Open, low.** No monetary value is stored yet; serving half the provenance would be worse than serving none |
| **P11** | **Cyprus, Malta and Iceland have no rail figure, because they have no railway.** Eurostat publishes nothing rather than zero, the adapter does not invent the zero, and `rail_network_density` does not permit manual entry, so all three show as missing and the criterion's weight is redistributed | **Decided 2026-09-12 (Q216): left as it is.** Redistribution is the mechanism `reqs.md` 5.3 designed for a missing figure, and both alternatives cost more than they pay -- a typed zero needs maintaining, and an adapter turning "absent" into "zero" would invent a figure its source never published. The measure itself is already down for a post-MVP rethink (Q212) |
| **P12** | **The evaluation header queries never returned the score scale they froze.** `0107` added `evaluation.score_scale_max` precisely so a saved score still means something after the setting changes, and `select_evaluation` and `select_evaluations` were not updated, though the contract marks `score_scale_max` required on `EvaluationSummary`. Nothing noticed because no code had read those queries until P5 | **Fixed 2026-09-12.** Both queries return it, and the store's round-trip test asserts the saved scale comes back |
| **P13** | **One interface test failed under load, twice.** A `ConfigureScreen` test hit its limit during `make check` with containers and other work in flight, and passed alone every time. Raising `testTimeout` to 15 seconds did not settle it -- because it was never slowness. The Configure screen mounts seven panels behind six requests, and `CriterionRow` follows the stored weight with an effect: a response landing between `clear()` and the click on Save refills the input, so the click saves 50 instead of nothing and the test waits for an alert that will never come | **Fixed 2026-09-12.** The tests that type wait for the screen to settle first -- the last panel present, no "Loading…" left -- which removes the race rather than giving it more time. The 15-second budget stays, as a deadlock detector rather than a performance budget |
| **P14** | **Two 409s from the same API had two shapes.** A domain fault was rendered as `arch.md` 7.6's one error shape -- `code`, `message`, optional `details` -- while a refusal an endpoint raised itself (`score_scale_not_set`) came back as FastAPI's `{"detail": {...}}`. A client branching on `code` would have found none. Nothing caught it because the conformance suite validates successes, and the error-contract suite only exercised domain faults | **Fixed 2026-09-12.** A handler renders any refusal carrying a `code` in the one shape; anything else keeps FastAPI's rendering. The comparison suite asserts `code` on both an endpoint refusal and a domain one |
| **P15** | **Editing a criteria set silently released every gate it enforced.** A set is written whole: `delete_criteria_set_contents` clears `criteria_set_match_rule` and `criteria_set_compound_rule` with everything else, and `_write_contents` never wrote them back. Reading a set returned its rule lists, so nothing looked wrong -- until the next read after any edit, by which time the rows were gone. Moving one weight on the shipped set would have done it | **Fixed 2026-09-12.** The store writes both lists, and the configuration suite enforces a gate, reads it back, releases it and reads it back again. Found by building the endpoints that set them (P6 W6-A) |
| **P16** | **Settings came back as strings.** `min_coverage` and `run_spend_cap_eur` were typed `Decimal`, which Pydantic renders as a JSON string; the contract types both `number`. The conformance suite validates the served shape and passed, because every setting was null until something wrote one | **Fixed 2026-09-12.** Both travel as numbers, converted to `Decimal` at the domain boundary where the precision matters |

---

## Found at Gate C — 2026-09-12

The browser suite driving the real stack. Two were fixed on the spot; the third is a
reporting gap in something already shipped, and it is the one worth reading.

| # | Finding | State |
|---|---|---|
| **P17** | **`SettingsInput` typed the four tuning values as plain numbers while the API has always answered null for an unset one** -- which is the shipped state by design (`reqs.md` 3.10). Every `GET /v1/settings` on a fresh database was therefore invalid against the contract it is validated by; the acceptance suite did not catch it because it validates responses whose settings happen to be set | **Fixed 2026-09-12.** The four are `[number, "null"]`, and the generated client says so. Found while building the Configure screen's settings panel |
| **P18** | **A run accounts for fewer items than it has.** A one-item run for Liechtenstein reports `items_total 1, items_completed 0, items_failed 0`: Eurostat answered, the dataset simply has no row for that country, and the adapter records neither a figure nor a failure. The screen then says "Nothing failed in this run" about a run that learned nothing. Run 2 of the real database shows 96 items and 93 completed; run 1 shows 160 and none. **There is no third category** | **Decided and built 2026-09-12 (Q217).** Both halves: `items_unanswered` on `RunProgress` so the arithmetic closes, and the items listed so a retry can ask about them -- "failed" keeps meaning something went wrong, and nothing stays invisible. Two actions on the Run screen where there was one. **Nothing stores them**: `runs.sql` derives them as the scope's candidate-attribute pairs minus those with a value and minus those with a failure, so the three counts cannot drift from each other and a successful retry needs no row deleted. This entry said "not yet built" for a day after it was, which is why a finding's state is worth re-reading before it is quoted |
| **P19** | **An unranked candidate showed an empty cell where its rank would be.** A gate that rules a candidate out costs it its rank while it keeps its score (`reqs.md` 5.5), and the blank read as a table that had failed to render rather than as "no rank". The unit test that should have caught it asserted `toHaveTextContent("")`, which matches any content at all | **Fixed 2026-09-12.** The dash this screen already prints wherever a number is absent, and the test asserts it exactly |

---

## Found reviewing the scoring for design patterns — 2026-09-12

Alex asked whether a design pattern would pay anywhere in the attributes and the formulas.
Reading for that found two defects instead, which is the more useful answer: **both were
dispatch that looked total and was not.**

| # | Finding | State |
|---|---|---|
| **P20** | **A `target_range` goal scored something else under two of the three methods.** `scores_for` chooses its branch in an order -- `percentile` first, `as_is` second, the band only under what remains -- so a band with `percentile` was silently ignored and ranked by standing, and a band with `as_is` was **inverted**: `_already_a_score` inverts unless the goal is `maximise`, so 26 °C in an 18-26 band scored 74 rather than 100. A plausible number meaning the opposite of what was asked for is the exact failure `reqs.md` 10 exists to prevent. Nothing refused the combination: not the schema, not the domain, not the scoring. Unreachable through the API by accident rather than by design -- `updateCriterion` ignored `goal` (P21) -- and reachable by any migration, script or `psql` session | **Fixed 2026-09-12 (`0468`).** Refused in three places, deliberately: a CHECK on `criterion` and on the frozen `evaluation_criterion`, a validator on `Criterion`, and a refusal in `scores_for` itself -- because the branch order is not a rule anybody can see. Nine tests: two unit refusals, three DB (including the control row and the frozen copy), and the combination is now unreachable from every direction |
| **P21** | **`updateCriterion` accepted two fields it declared and dropped them.** `is_scored` and `weight_locked` were on the request body; `_applied` read `weight` and nothing else, so excluding a criterion from scoring or locking its weight answered **200 and changed nothing**. Every further field of the contract's `CriterionInput` -- `goal`, `normalisation_method`, `scale_anchors`, the thresholds -- was dropped as an unknown extra, because Pydantic ignores them by default. The body's own docstring said "an endpoint that silently ignored a field a client sent would be worse than one that refuses it" | **Fixed 2026-09-12.** Both flags are applied, through a new `CriteriaSet.with_criterion_flags` that revalidates the criterion and rebalances nothing -- `is_scored` is redistributed at scoring time, and `weight_locked` only decides who absorbs the next change. `extra="forbid"` turns the rest into a 422 rather than silence; the contract stays deliberately ahead of the code, and the code stops pretending to have caught up. **Closed 2026-09-12: the editor is built.** Every field the contract designs is applied, and the criterion is revalidated through the domain rather than written field by field -- so `0468`'s refusal of a band under a method that cannot draw one is reachable from a screen for the first time, which is what those four guards were for. **`matching_threshold` was never *served* either**: the contract has always described it on `Criterion`, which inherits every field of `CriterionInput`, and the response never carried it. Nothing noticed because it is optional, so the response stayed valid while the rule was invisible to every client -- and an editor that cannot read the rule it edits overwrites it on the first save |

---

## The test audit — 2026-09-12

Asked for after the refactoring: run everything, check coverage, and find tests that assert
nothing. **1,287 backend tests and 173 interface tests were scanned with the AST rather than
with a grep** -- the first attempt used a regex, reported 321 tests with no assertion, and was
wrong about every one of them because it stopped at the docstring.

**No dummy tests were found.** Nine backend candidates survived the scan and all nine are
sound: four are *controls* whose refusing counterpart sits beside them (a scale that fits is one
the call survives, and the call that refuses an unfitting one is the test above it), three
compare two calls rather than a thing to itself, and one reports through `pytest.fail`, which
the scanner did not know about. The interface's single hit was a comment quoting a pattern it
had removed.

**Three real gaps were found and closed, plus one test that passed for the wrong reason.**

| # | Finding | State |
|---|---|---|
| **P22** | **A test named for the shape guard never reached it.** `test_a_shape_that_is_not_built_stays_silent` built a `ShareOfHouseholdField` rule with no inputs -- which makes it *undecided*, so `judgements_of` filtered it out before the shape was looked at. The test passed, the branch it names stayed uncovered, and a change to the shape guard would not have failed it | **Fixed 2026-09-12.** The rule is fully decided now and asserts so before the act, so silence can only come from the shape. `evaluation/rules.py` is at 100% |
| **P23** | **Three of the four threshold shapes were written and read by untested code.** `storage/criteria_store.py` sat at 81.3%, the lowest in the codebase, and the gap was the label, boolean and share threshold branches: the shipped catalog uses range thresholds only. This is the shape of P15, where the store silently failed to write the rule lists nobody read back | **Partly fixed 2026-09-12.** The label round trip is tested with a control, and the store is at 89.6%. **The boolean and share branches stay uncovered, on purpose**: no attribute in the catalog is a `Boolean` or a `ShareComposition` at any level, so a criterion carrying one cannot be built without inventing an attribute -- and an attribute invented by a test is a catalog this application does not ship. The reason is written beside the test rather than papered over |
| **P24** | **`transport.py` carried a `base_url` property nobody read**, whose docstring claimed adapters read it. The coverage gap was the only thing that noticed | **Fixed 2026-09-12.** Deleted rather than tested |

**Every one of the 40 implemented operations is exercised by an acceptance test** (checked by
walking `openapi.implemented.yaml` against the suite), and the conformance suite already fails
when a served read has no case. Coverage after the audit: **98.0% of statements** backend-wide,
every package above its 85% floor, and 177 interface tests with `src/routes`, `src/api` and
`src/shell` above 95%.

---

## Found building P7 — 2026-09-12

| # | Finding | State |
|---|---|---|
| **P25** | **`reqs.md` 6.10 and 7.1 disagreed about what `international_employers` is.** 6.10's inventory line called it "an `AssignedScore` plus the employer list behind it"; 7.1's catalog table and the database both say `LabelSet` -- named firms | **Fixed 2026-09-12 (Q221).** The catalog wins, as it did for Q215, and 6.10 is corrected. Named firms are checkable and a score is not: a list can be looked up, "7 out of 10" cannot, and the household can strike a name it disagrees with |
| **P26** | **The seeded LLM source is `llm`, and three new modules wrote `llm_search`.** Caught by a foreign key on the first stored proposal -- the catalog refused a source that does not exist | **Fixed 2026-09-12.** An honest catch: the constraint did exactly what it is for, at the first write rather than in a report |
| **P27** | **A run whose sources can answer nothing crashed instead of refusing.** With a paid source as the only one, an unscoped run asks nobody (`asked_this_run`), leaving an empty scope -- and `start_run` refuses an unresolved scope with a `ValueError` that reached the client as a 500 | **Fixed 2026-09-12.** `NothingToFetchError`, a 409 `nothing_to_fetch`: a run over an empty scope is a no-op recorded as though it were work, and the run list is a record of what was actually asked |
| **P28** | **Gate research spends money that no run record carries.** A run row is a pass that writes *values* (`reqs.md` 3.8), and research writes gate answers, so its cost is reported in the response and logged but not accumulated anywhere durable. The cap still applies per request, so nothing is unbounded -- but "what has this month cost?" cannot be answered from the database | **Deferred by decision 2026-09-12 (Q224).** The per-request cap bounds every spend and there is exactly one paid source, so either answer -- a ledger beside runs, or widening a run to cover a pass that writes gate answers -- would be designed against a single caller. Revisited when a second paid source exists, which is when the choice stops being a coin toss |
| **P29** | **The interface has no surface for a proposal.** `POST /v1/match-rule-research` stores proposals and `GET /v1/match-rule-results` returns them with `is_proposal`, and nothing renders them: confirming one means calling the API by hand. P6 closed before the LLM path existed, so no screen was ever asked for | **Closed 2026-09-12.** A `Gate proposals` panel beside the gates it answers, in Configure -- where a gate is already enforced and released. It lists each proposal with the pages behind it, and confirming one writes the same answer as `manual`, which replaces it. **The estimate is a separate act from the pass**: this is the only screen in the application that can spend money, so the research button appears only once a cost has been seen, and the uncapped-spend acceptance only beside that figure -- agreeing to an uncapped spend before seeing what it would cost is the decision the panel exists to prevent |
| **P30** | **A source's figures were written once at the end, not as they arrived.** `acquire` fetched every attribute an adapter could answer and appended the lot afterwards, so an exception partway through lost every figure that source had already fetched -- against `arch.md` 7.1's per-item commits, which is what Gate D's first failure mode exists to check | **Fixed 2026-09-12.** One append per attribute, so a process that dies keeps everything already answered and loses only the answer in flight. Found by writing the gate test, which is the whole argument for writing it |
| **P33** | **An assertion in SQL that weights sum to 100 is stricter than the rule it checks, and refuses data the application is happy with.** `local_employment`'s housing pillar is stored as `75 + 15.38461538461538461538461539 + 9.615384615384615384615384612`, written by a rebalance. PostgreSQL's `numeric` is arbitrary-precision and sums that to **100.000000000000000000000000002**; Python's `Decimal` works in a 28-significant-digit context where the residue falls off the end, so `CriteriaSet` reads exactly 100 and accepts the set. The two ends disagree about the same rows, and **SQL is the stricter one** | **Recorded 2026-09-13, and the trap avoided rather than the code changed.** Nothing in the running application is wrong: the domain is the authority on this invariant and it is satisfied. What is wrong is any *new* check written in SQL -- `0469`'s own assertion failed on its first run for exactly this reason, and rounds to ten decimal places now. **Worth reading before somebody adds a CHECK constraint**: one on `SUM(weight) = 100` would refuse the shipped criteria set, and the failure would look like corrupt data rather than like a precision mismatch |
| **P32** | **The interface's generated client was a contract change behind, and nothing noticed.** `ui/src/api/schema.ts` is generated from `docs/openapi.yaml`, and the committed copy predated `RunRequest` -- so `accept_uncapped_spend`, the whole bypass Q220 designed, **could not be sent from the interface at all**, and the 409 it exists to answer was a dead end on screen. The 409 was missing from the typed responses too. `test_contract_drift.py` holds the *backend* to the contract, and the interface is a separate client by design (`arch.md` 6.1), so nothing compared the generated file against its source | **Fixed 2026-09-12.** Regenerated, and `startRun` takes the flag with `false` as the explicit default, so the refusal is still what happens unless somebody says otherwise. **Found by regenerating for an unrelated reason**, which is the uncomfortable part: the drift was invisible until something else made the file move. A freshness check for the generated client, beside the one the backend already has, is the open half of this finding |
| **P31** | **The startup check refused to boot on its first real run, and it was right.** The Eurostat manifest still declared `country.income_tax_effective`, retired in `0445` (Q205) and replaced by the total tax rate. The entry had been left deliberately, documented as "inert -- acquisition reads active attributes only", against the day its components were rewired | **Fixed 2026-09-12.** The rewiring it was waiting for had already happened in `tax_wedge.py`, so the entry was dead weight -- and with it the whole `EurostatShare` mechanism, its branch in the adapter and five tests, all of which existed for that one retired attribute. 99 lines of tests deleted because what they tested no longer exists. **This is the check earning its place on day one**: a declaration nothing can answer is a declaration nobody should trust |

