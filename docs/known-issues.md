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

**63 findings: 58 closed, 5 open, and every one of the five is open by decision rather than by
neglect**: P36's spend record and P28's deferred ledger, P38's mitigated LLM editions, P6's
Cloudflare block, P10's unstored exchange rates, and P39's postponed geography. P4 is recorded
as out of scope rather than open. **P35 closed 2026-09-19** -- the last finding that was a
defect rather than a decision. **P63 was found by fixing one of the review's own low
items** -- wiring up a property that had no caller, which turned out to be wrong as well as
unused. See "Found while closing the review's low items". **Twenty-two arrived at once**, from the full review of
2026-09-16 (P41-P62, the last section of this file): six high, thirteen medium, the rest low.
**All six highs and all thirteen mediums are fixed**, each proved first by a test that failed
against the old code and passes against the new one. **Read that section's opening first** -- the
six highs were three distinct faults repeated across layers, and two of them spent money.

**Four of the fixes were wrong before they were right, and the suite caught every one**: P44 took
three attempts at the selection rule, P51 three at the run scope, and both P43's and P56's own
tests had to be rewritten because they asserted the defect. What remains open from this review is
the low-severity list at the end of that section.

The standing mediums from before it: `POST /v1/data-acquisition-runs` answers 202 and then
blocks, so a client timeout is indistinguishable from a failure and a retry starts a duplicate
run (P35, which cost 2.70 EUR to discover); the LLM fallback mislabels publishers' editions
(P38); and two spend-accounting gaps (P28, P36).

| Closed | When | Where |
|---|---|---|
| **H1**-**H6** | 2026-09-02 | `criteria/`, `data/`, `storage/`, and the tests that missed them |
| **D23** | 2026-09-03 | `ui/eslint.config.js`, `make ui-check` wired into `check` |
| **D2**-**D6**, **D8**, **D12**, **D25**, **D26** | 2026-09-05 | migrations `0106`-`0110`, `criteria/`, the value seam, the contract |
| **D1**, **D7**, **D10**, **D11**, **D13** | 2026-09-05 | migrations `0111`-`0114`, `reqs.md` 7.1, the catalog guards |

| Open | Severity | Waiting on |
|---|---|---|
| **P41**-**P62** | six high, thirteen medium, rest low | **The full review of 2026-09-16**, in the last section of this file. Two highs spend money on the retry path (P41, P42), one stores unvalidated figures (P59), one ignores a criteria set's own rule choices (P43), two break a screen with no way back (P44, P45) |
| ~~**D9**~~ | — | **Closed 2026-09-13 (Q229): dropped.** It was superseded before it was ever used, and its own COMMENT said so -- `attribute_allowed_label` arrived two migrations later and holds per-attribute vocabularies, while no two attributes share one. **The more useful half of the finding was the third table**: `attribute_allowed_label` was fully wired -- read by `catalog.sql`, carried on `Attribute.allowed_labels`, enforced in `refuse_unless_the_payload_suits` -- and completely empty, so `country.climate_zone` would have accepted any string. It now permits the 20 Köppen codes that occur in Europe. **Corrected 2026-09-16 (P59): the enforcement this row claims does not exist.** There is no `refuse_unless_the_payload_suits` anywhere in the repository; the method that would do the work, `rejection_reason_for`, has no production caller; and the 20 seeded codes therefore constrain nothing. The `DO` block in `0472` proved the rows had arrived, which is not the same as proving anything reads them |
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

- **TODO, decided 2026-09-19: no criteria set enforces a gate or applies a compound rule, and
  that stays true for now.** All four match rules (`eu_free_movement`, `uk_skilled_worker`,
  `ch_eu_efta_quota`, `not_manually_excluded`) and both compound rules exist in the catalog and
  **no set has opted into any of them**, so nothing can be ruled out and all 31 scoreable
  countries come back `matching`. That is a deliberate hold, not an oversight: the ranking
  speaks to scores and says nothing about eligibility until the gates are answered and enforced.
  Picked up when the household decides to research them -- the estimate comes first, and a
  proposal rules nothing out until somebody confirms it (`reqs.md` 6.10 use 3).
  **One stray row to clear when that happens**: `match_rule_result` holds a single manual answer
  for `not_manually_excluded` / `country.greece`, which looks like test data rather than a
  decision anybody made.
- **Decided 2026-09-19: Liechtenstein stays `insufficient_data`.** 48% of the scored weight
  against a floor of 60, with 40% of what it does have borrowed from Switzerland. No further
  stand-ins: pushing it past the floor that way would produce a score resting mostly on another
  country's figures, and the score would not say so -- only the coverage split would. Unscored
  and visible with the reason is what `reqs.md` 5.3 asks for.
- **D9** (low) **`label_vocabulary` is dead**: zero rows, zero query references, zero incoming
  foreign keys. Its own comment points at `attribute_allowed_label`, which does the real job.
  Drop it or wire it.

### Test-quality

- ~~**D14**~~ (low) `LevelHierarchy` **accepted a branching tree** while its own error type
  says it validates "a single, ordered containment chain". `country → {city, province}` passed
  every other rule -- distinct ordinals, one widest level, each parent wider than its child.
  **Fixed 2026-09-18**: each rung must nest directly under the one above it. It matters because
  the code that walks a candidate's parents upwards assumes the walk has one answer, and
  `reqs.md` 3.1 only ever describes inserting a rung into one chain.
- ~~**D15**~~ (low) The objective/subjective FK guard classified 18 tables of the 60-odd that
  exist, so a foreign key from an objective table into an unclassified subjective one -- every
  child of a criterion, every child of an evaluation -- was not a violation as far as the guard
  could tell. **Fixed 2026-09-18**: every table is on one side or the other, yoyo's own
  bookkeeping excepted, and **a new table on neither side now fails a test** -- so the question
  is asked in the migration that adds it. Proved by feeding the check a `value ->
  criterion_scale_anchor` edge, which the old lists could not see.
- ~~**D16**~~ (low) Three tests asserted less than their names claimed. **Fixed 2026-09-18**,
  the third being D14 above. The `max_age` test put a 1900 numbeo figure against a manual one
  and let *source priority* decide, so it would have passed with the freshness rule intact and
  failed if those two sources ever swapped rank; it now varies only the period, and a control
  test sends the same pair the other way once a `max_age` is declared. The breakdown-scheme test
  promised to say *what* an attribute is broken down by and asserted only *whether*. Both were
  checked by mutation: removing the freshness term fails the control and correctly leaves the
  no-`max_age` case passing.

### Documentation

- ~~**D17**~~ (low) `reqs.md` `Index` specified a `polarity` that appeared nowhere else — not in
  the schema, not in the contract, not in the code. `criterion.goal` covers the need.
  **Fixed 2026-09-18**: the word is gone.
- ~~**D18**~~ (low) `openapi.yaml` typed `Attribute.max_age_days` as an integer while the column
  is an `interval`, and `interval '1 mon'` added to 31 January is not 30 days added to it.
  **Verified fixed 2026-09-18, by someone who did not update this line**: the contract serves
  `max_age_months` and `api/catalog.py` converts through `_months_of`. Recorded because a
  finding that was quietly fixed is indistinguishable from one nobody looked at.
- ~~**D19**~~ (low) `RatioPayload.basis` was nullable and not required in the contract while the
  column is `NOT NULL` and `payloads.py` says "the basis is required". **Fixed 2026-09-18**: the
  contract was the outlier and now requires it. A bare "23.4%" is not a measurement -- 23.4% of
  the workforce and 23.4% of the land area are different facts.
- ~~**D20**~~ (low) `select_attribute_coverage` said "for each attribute" and grouped over
  `active_value`, so **an attribute with zero coverage produced no row at all** — and a
  never-fetched attribute is the one a run planner most needs to see. **Fixed 2026-09-18**: it
  is driven from the catalog with a left join, so every attribute gets a row and an unfetched
  one reports 0. Tested against the statement the file holds rather than a copy of it, which
  is the only way to test a query nothing calls yet.
- ~~**D21**~~ (low) `select_criteria_set` narrowed criteria and pillar weights by `:level` but
  **not the enforced match rules or applied compound rules**, so a set read for one level came
  back carrying gates declared at another -- and `gates_that_rule_out` consults exactly that
  list, so a city gate would have ruled out a country. **Fixed 2026-09-18**: both aggregates
  join their rule and narrow by level, a match rule with no level still applying everywhere as
  its nullable column means. Proved with a city-level gate, since every shipped rule is
  country-level and nothing else would have shown it.
- ~~**D22**~~ (low) `replace_criterion_scale_anchors` zipped three parallel arrays; the file's
  defence was that a length mismatch hits a `NOT NULL` — true for `scores`, and `label` is
  nullable, so a short array **silently blanked labels**. **Fixed 2026-09-18 by removing the
  alignment rather than checking it**: one JSON object per anchor, so the three fields cannot
  come apart. **A guard was tried first and could not work** -- `CAST('...' AS integer)` inside
  a `CASE` is a constant expression, so PostgreSQL folds it at plan time and raises whether the
  lengths agree or not, which failed every anchor round trip at once.

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
| **P3** | **The interface mock invents `country.net_median_salary`**, an attribute that does not exist in the catalog (`ui/src/mocks/fixtures.ts`). Mocks may be fictional; one naming a non-existent attribute id reads as documentation of what is available | **Fixed 2026-09-18.** It also weighed `country.income_tax_effective`, retired in `0445` when the total tax rate replaced it (Q205) -- and weighed it under *connectivity*, a pillar it never belonged to. Every attribute the fixtures name is now one the catalog holds. A mock may invent figures, which is what it is for; an attribute id it invents reads as a statement about what the product has |
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
| **P40** | **Both command-line scripts had drifted from the product, and one of them misreported results.** `scripts/acquire.py` kept its own copy of the adapter list -- "duplicated deliberately" to avoid importing `main`, while already importing `Environment` from it -- so the transcribed tables (Q230) joined only the real registry, and `make acquire` finished with exit 0 having stored nothing for three attributes. `scripts/rank.py` hardcoded a score scale of 100 and passed no coverage floor, compound rules or gate answers, so it printed **Liechtenstein as `matching` at 47% coverage**, below the household's 60% floor (Q214) -- and every "all 32 matching" reported from it overstated by that country. P5 was the same shape: a run asked one source while its plan counted six | **Fixed 2026-09-14.** `acquire.py` takes the registry from `_the_sources`, filtered to free sources so a sweep can never spend; `rank.py` makes the same `rank_candidates` call as `GET /v1/rankings`, from the same settings, and refuses when the score scale is unset rather than assuming 100. **Found only because the new figures failed to appear** -- nothing tests the scripts, and a copy of a list is a second place the list can be wrong |
| **P39** | **`elevation_range` and `coastline_access` have no reliable living source that publishes them per country.** Researched 2026-09-14 so it need not be redone. **The CIA World Factbook was discontinued on 4 February 2026** -- its pages now show only a farewell notice -- and the household ruled out its archived copies. Wikipedia's elevation and coastline lists cite that same Factbook. **Wikidata is structured but wrong for exactly this attribute**: it gives the Netherlands' highest point as Mount Scenery on Saba (870 m, Caribbean) rather than Vaalserberg (322 m), Finland's as Halti's Norwegian summit (1,361 m, not 1,324 m), Greece's lowest as the Calypso Deep (-5,269 m, an ocean trench), Germany's depression as +5 m, and has no elevation for 14 lowest points. Eurostat's coastal-regions report (KS-SF-09-047) shows coastline length only as a chart, from EEA / Corine Land Cover at 1:100,000. **The territory is decided** (the household, 2026-09-14): a country's European territory with its nearby islands (Azores, Madeira, Balearics, Canaries), excluding overseas regions elsewhere and Greenland, the Faroes and Svalbard -- which matters, because the Factbook's France coastline and land area included the overseas regions while Denmark's excluded Greenland, and coastline length itself varies threefold with measuring resolution (Norway 83,281 km in one source, 25,148 km in another) | **Postponed by the household 2026-09-14.** The two reliable, maintained routes found: **compute from datasets** -- the EEA's 1:100,000 coastline and the Copernicus DEM (already ranked first for `elevation_range`), masked to European territory, written into the transcribed-table format with the method as workings (one resolution for all 32; a DEM smooths summits, so Mont Blanc reads about 4,780 m rather than 4,806 m) -- or **surveyed heights from each national mapping agency** for elevation, with the EEA computation still needed for coastline |
| **P38** | **The LLM fallback reports a previous edition's figure while citing the current one.** Checked against deterministic reads of the publishers' tables, the first real run had read **RSF's 2025 column for 7 of 24 countries** -- Hungary 62.82 where the 2026 Index gives 59.85, Italy 68.01 for 65.16, Norway 92.31 for 92.72 -- while each quote said "RSF World Press Freedom Index 2026". For EF EPI it read Luxembourg as 576 **on all three runs**, and EF's 2025 edition does not rank Luxembourg at all: three agreeing answers, all the same older edition. **Agreement between independent searches is not evidence when they share a bias**, and "the newest figure a search surfaces" is systematically the wrong one for an index published once a year | **Open, medium.** Mitigated rather than fixed: where a publisher prints one table for every country, it is now transcribed and stored under that publisher (Q230), which gives all 32 one edition and one methodology and ranks above `llm`. The fallback remains the answer only where no such table exists -- and there, P37's fix means its figures at least carry the year the model *claims*, which is exactly the claim this finding shows cannot be taken on trust |
| **P37** | **Every figure the LLM fallback stored was dated as the day it was fetched.** The prompt asks the model for "the year or period the figure describes", and `fallback.py` threw the answer away and recorded `the_period_now()` -- a rationale written, correctly, for the *employers* use, where the question really is which firms operate there today, and applied to published figures, where it is wrong: RSF's 2019 index describes 2019 whenever it is read. **It breaks `reqs.md` 3.6 outright** -- reference period and retrieval date must never be the same fact -- **and inverts the source priority.** `is_fresh` is computed from the reference period and is the *first* term of the `active_value` order, ahead of source rank, so a figure dated today looked current forever and would outrank a published figure that had honestly aged: the opposite of 6.10's "any structured source that can answer supersedes it automatically". Not firing yet only because the fallback takes attributes nothing else answers. **Found by looking at the stored rows after the first real run**, not by a test: `the_period_now()` is called on purpose, so a test asserting "the value has a reference period" passes | **Fixed 2026-09-14.** The fallback reads the period the model reports -- four digits or a span of years, the two shapes the prompt now asks for -- and **refuses** a figure whose period is missing, in prose, reversed or in the future, because a figure with no known year cannot be judged for freshness. The 88 rows already stored are **rejected, not deleted** (`0473`), with the reason beside them: their quotes often name the year, but reading a year out of a sentence to repair a date field is the guess the fix refuses to make |
| **P36** | **A run killed mid-flight loses its own spend record.** `data_acquisition_run.cost_eur` and `llm_call_count` are written when the run ends, so runs 15 and 16 -- both swept to `failed` after their process was killed -- report **0 calls and 0 EUR having spent 2.70 EUR between them**. The only record is one log line per call from `client.py`. "What has this cost?" therefore understates by exactly the amount spent by runs that did not finish, which are the runs most likely to have spent it badly | **Open, low.** Related to P28 but distinct: P28 is spend that belongs to no run, this is spend that belongs to a run and is not written to it. The fix is to accumulate on the run row as the meter ticks rather than at the end, which is the same per-item-commit argument as P30. Worth doing with P28's ledger rather than separately |
| **P35** | **`POST /v1/data-acquisition-runs` answers `202 Accepted` and then blocks until the run finishes.** The contract's 202 means "started, poll for progress" (`openapi.yaml`), and `RunProgress` plus `getRun` exist precisely so a client can. The endpoint awaits `execute_run` inline, so a 160-item LLM run holds the connection for minutes: **a client timeout is indistinguishable from a failure, and retrying starts a second concurrent run.** There is no idempotency key. Found by doing exactly that -- a 40-second curl timeout, read as a failure, retried, and two paid runs ran at once until both were killed. **It cost 2.70 EUR of real money and stored nothing**, because values are appended per attribute and neither run finished one | **Fixed 2026-09-19, in two commits.** A start while a run is going is now refused with 409 `run_already_in_flight`, naming the run to poll instead -- which closes the harm without touching the blocking. **The rule was already written down and simply not enforced**: `sweep_abandoned_runs` turns whatever is still `running` at boot into `failed` precisely because "nothing else starts a run" (`reqs.md` 10). Chosen over an `Idempotency-Key` header, which is the general answer to a question this product does not have: one household on one machine runs one pass at a time. **Then the 202 was made true**: `execute_run` splits into `open_run`, which settles every refusal and writes the run row, and `continue_run`, which does the fetching. The endpoint answers with the opened run and hands the rest to a background task, so a sweep that takes minutes no longer holds a connection -- the interface never hit this because the Run screen's runs are small and free, and the LLM path is where a run takes minutes. `execute_run` remains as the two called in order, which is what every other caller still uses. **One acceptance test had to change, and it was the informative one**: Gate D read the spend from the start response, which now correctly reports a run that has just opened and spent nothing; it polls instead. The rest of the suite needed nothing, because Starlette runs a background task inside the same ASGI call that `httpx`'s in-process transport awaits -- which is exactly why the new behaviour needed a test of its own. The response body says `running` where it used to say `completed`, proved by putting the fetching back inline and watching that assertion fail |
| **P34** | **`make live-llm` could never run, and so the one test that proves the SDK's shape still works had never run.** The fixture read `os.environ` for the key and the prices; they live in `.env`, which only pydantic-settings reads. From any ordinary shell both tests **skipped silently** -- `2 skipped` reads like "nothing to do here" rather than "the check you just paid for did not happen" | **Fixed 2026-09-13.** Configured through `Environment` and `_the_model`, the same path the application uses, so the test exercises the configuration this machine would actually use rather than a second copy assembled in the test. Both tests pass, and the first real call measured `LLM_INPUT_TOKENS_PER_CALL` at **12,674** against the 12,000 that had been a placeholder |
| **P33** | **An assertion in SQL that weights sum to 100 is stricter than the rule it checks, and refuses data the application is happy with.** `local_employment`'s housing pillar is stored as `75 + 15.38461538461538461538461539 + 9.615384615384615384615384612`, written by a rebalance. PostgreSQL's `numeric` is arbitrary-precision and sums that to **100.000000000000000000000000002**; Python's `Decimal` works in a 28-significant-digit context where the residue falls off the end, so `CriteriaSet` reads exactly 100 and accepts the set. The two ends disagree about the same rows, and **SQL is the stricter one** | **Recorded 2026-09-13, and the trap avoided rather than the code changed.** Nothing in the running application is wrong: the domain is the authority on this invariant and it is satisfied. What is wrong is any *new* check written in SQL -- `0469`'s own assertion failed on its first run for exactly this reason, and rounds to ten decimal places now. **Worth reading before somebody adds a CHECK constraint**: one on `SUM(weight) = 100` would refuse the shipped criteria set, and the failure would look like corrupt data rather than like a precision mismatch |
| **P32** | **The interface's generated client was a contract change behind, and nothing noticed.** `ui/src/api/schema.ts` is generated from `docs/openapi.yaml`, and the committed copy predated `RunRequest` -- so `accept_uncapped_spend`, the whole bypass Q220 designed, **could not be sent from the interface at all**, and the 409 it exists to answer was a dead end on screen. The 409 was missing from the typed responses too. `test_contract_drift.py` holds the *backend* to the contract, and the interface is a separate client by design (`arch.md` 6.1), so nothing compared the generated file against its source | **Fixed 2026-09-12.** Regenerated, and `startRun` takes the flag with `false` as the explicit default, so the refusal is still what happens unless somebody says otherwise. **Found by regenerating for an unrelated reason**, which is the uncomfortable part: the drift was invisible until something else made the file move. A freshness check for the generated client, beside the one the backend already has, is the open half of this finding |
| **P31** | **The startup check refused to boot on its first real run, and it was right.** The Eurostat manifest still declared `country.income_tax_effective`, retired in `0445` (Q205) and replaced by the total tax rate. The entry had been left deliberately, documented as "inert -- acquisition reads active attributes only", against the day its components were rewired | **Fixed 2026-09-12.** The rewiring it was waiting for had already happened in `tax_wedge.py`, so the entry was dead weight -- and with it the whole `EurostatShare` mechanism, its branch in the adapter and five tests, all of which existed for that one retired attribute. 99 lines of tests deleted because what they tested no longer exists. **This is the check earning its place on day one**: a declaration nothing can answer is a declaration nobody should trust |

---

## The full review — 2026-09-16

**Four reviews in parallel, one per area** — the domain modules, the API and adapters, the SQL
and schema, the interface — plus a cross-cutting pass over the gates. Every finding below was
reproduced or read in the code before being filed; the ones that could not be confirmed say so
in their own words. **Nothing here is a style opinion**, and the interface's appearance is
deliberately out of scope until the behaviour is settled.

**What the structural guards already prove.** The ontology audit, the API audit and all four
import contracts pass; the generated contract is fresh; every path in it is exercised by an
acceptance test; there is no `TODO` or `FIXME` anywhere in the source; no `.env` is tracked. The
paid-test guard holds: no arrangement of `-m` can put a billed test back into `make check`.

**The shape of what was found.** Twenty-two findings, and the six high ones fall into two
families.

**Code that exists and is never reached.** `rejection_reason_for` validates a figure against its
attribute's range and vocabulary, and nothing calls it (P59). A criteria set records which
compound rules it applies, and the ranking ignores the field (P43). A retry wrapper inherits two
members it was meant to forward, and hides a paid source from the spend cap (P41, P42). In each
case the mechanism is built, documented and unit-tested; what is missing is the one line that
reaches it, and no coverage percentage can see that line missing. **Three of them are also
documented as working** -- in a docstring, in a migration comment, in this file -- which is how
they survived.

**Error paths that vanish.** Opening a past run swallows its failure entirely (P45); discarding
the selected criteria set leaves every screen requesting a deleted id with no way back (P44); a
criterion naming an unknown attribute crashes mid-transaction instead of refusing (P61).

**Almost nothing here is live today**, because the catalog is still narrow: no criterion has a
threshold, both compound rules are undecided, the paid path is one adapter. That is the argument
for fixing them now rather than later -- each one activates the moment the catalog grows, and
activates as "the application quietly discarded what I configured" rather than as a test going
red.

### Spending money

| # | Finding | State |
|---|---|---|
| **P41** | **A retry hides a paid source from every spend check.** `_AskedOnlyAbout` (`execution.py:301`) narrows an adapter to the attributes a retry should re-ask, and forwards exactly three members -- `data_source`, `attributes`, `fetch`. It inherits `SourceAdapter`'s deliberately safe defaults for the two it does not forward, so a wrapped LLM adapter reports `costs_money = False` and an estimate of `NOTHING`. `refuse_unless_capped` then refuses nothing and `CostMeter(cap_eur=None)` can never be exhausted: **a retry of a failed paid run bills every call with no ceiling and no estimate.** The defaults are right for a new adapter and wrong for a wrapper -- a delegating subclass must forward everything or nothing | **Fixed 2026-09-16.** The wrapper forwards `costs_money` and `estimate_for`, and its docstring now says why a decorator forwards all of its subject or none of it. `tests/unit/data_acquisition/test_retry.py` is the first unit test the retry path has ever had: it pins both forwarded members, and its control -- a free source staying free through the wrapper -- is what a fix that forwarded nothing would fail |
| **P42** | **Neither retry nor ask-again is ever given the spend cap, and the uncapped path has no way past the refusal.** `retry_run` and `ask_again` take no `spend_cap_eur`, so `execute_run` falls back to its `None` default, and the `retry` endpoint never reads settings -- unlike `start`, which does. It also skips `asked_this_run`, so "a paid source is asked only when a run names its attributes" is not applied on this path. Two opposite failures from one omission: with a cap unset (its shipped state) `POST .../retry {"items":"unanswered"}` dies with 409 `spend_cap_not_set` and `RetryBody` carries no `accept_uncapped_spend` to get past it -- **the feature is unreachable** -- while a cap that *is* set is ignored on the failure path, because P41 hides the paid source from the check | **Fixed 2026-09-16.** `retry_run` and `ask_again` take `spend_cap_eur` and `uncapped_is_accepted`; the endpoint reads the cap from settings exactly as `start` does, so a cap set after a refusal takes effect on the next request; and `RetryBody` carries `accept_uncapped_spend`, which the contract now documents. **Fixing P41 first made the refusal appear**: with the wrapper honest about charging, the acceptance test expecting a 409 passed before the endpoint was touched, and the two expecting a 202 failed -- which is exactly the half that was still missing |
| **P47** | **The cap is tested between sources, so one source's entire sweep commits before it bites.** `execute_run` calls `acquire` once per adapter and reads the meter only afterwards; `acquire` loops every attribute inside that call and is never handed the meter. With a 1.00 EUR cap and the LLM fallback answering three uncovered attributes over 32 countries at about 0.05 EUR a call, **all 96 calls are made and billed -- roughly 4.80 EUR -- and only then is the run marked `halted_on_spend_cap`** | **Fixed 2026-09-16.** `acquire` takes the meter, records what each answer cost, and asks nothing further once the cap is reached -- after storing the answer already paid for, so the cap stops the *next* call rather than discarding the last one. `execute_run` passes the meter in and no longer accumulates into it, which keeps one place metering; it still writes the durable per-source total, and P36 is the finding about closing that gap. Five tests, including both controls that matter: an uncapped run asks everything, and a run under its cap asks everything -- a fix that shortened every sweep would pass the first test and fail these |
| **P51** | **A run whose only failures came from the stand-in step cannot be retried, and the refusal names the wrong thing.** A stand-in failure carries `data_source = stand_in`, which no adapter declares, so the retry's adapter list comes out empty and `execute_run` raises `NothingToFetchError`. Liechtenstein's substitute having no figure to lend produces a 409 reading "nothing in this run's scope can be answered by the sources it may ask" -- pointing at the sources when the stand-in is what failed | **Fixed 2026-09-16.** `retry_run` tells `execute_run` that borrowing may be the only work (`may_borrow_alone`), set when the failed run's failures name the `stand_in` source, and a borrow-only run takes the borrowable attributes as its scope. Retrying is not futile: the second test stores Switzerland's figure first and asserts Liechtenstein gets its copy. **Three wider fixes were tried and the suite caught each one.** Putting borrowable attributes into every run's scope inflated `items_total` by candidates x attributes for work no source was asked to do, breaking the Q217 arithmetic. Handing them to the borrow step alone was worse: every unrelated run then attempted Liechtenstein's three declared borrows and recorded each as a failure. Treating "no adapters" as borrow-only overturned P27 -- an unscoped sweep whose only source charges must still refuse rather than record a run for nothing. The flag is the narrowest version that leaves ordinary runs byte-identical |

### Rules, scoring and the criteria set

| # | Finding | State |
|---|---|---|
| **P43** | **A criteria set's choice of compound rules is stored, served and toggleable -- and ignored when ranking.** `GET /v1/rankings` hands `rank_candidates` every rule at the level (`rankings.py:154`) and never intersects it with `applied_compound_rules`, while the gate half of the same function *does* filter on `enforced_match_rules` and argues at length for why. `reqs.md` puts the two on the same footing: "whether rent-against-spend concerns you is a preference, exactly as with match rules". Reproduced: a set applying nothing, plus one decided rule with `outcome = not_matching`, returns Portugal `not_matching` -- **a rule one set opted out of rules countries out of another's ranking** | **Fixed 2026-09-16.** `rank_candidates` narrows the rules to what the set applies, once, before the per-candidate loop -- it is a property of the set and the answer is the same for all 32. **The existing test did assert the wrong behaviour** and had to be rewritten: it read as "a warning flags" while asserting "any rule at this level flags", which is what kept the defect invisible. Three tests now separate the two: a rule the set does not apply raises no warning, the same rule with `not_matching` cannot remove a country, and a rule the set *does* apply fires as before |
| **P46** | **A compound rule can only read an attribute that carries a scored criterion, and goes silent otherwise.** The `figures` map is built from `readings`, which is keyed on scored criteria alone, and a missing figure never satisfies a condition -- so the rule simply does not fire: no warning, no refusal, nothing on screen. Reproduced: a stored, active figure of 90 against a `threshold_min` of 50 leaves the candidate `matching` with no reasons, because that attribute's criterion has `is_scored = false`. **Unticking a criterion in Configure quietly disables an unrelated rule**, and two documented cases are unimplementable: a rule over a descriptive attribute, which by definition has no criterion, and `reqs.md` 3.7a's "inputs may cross levels" | **Fixed 2026-09-16.** `_magnitudes_of` gives the rules every figure the candidate has, by attribute, whatever any criterion makes of it -- deliberately wider than what scoring reads, and named so the next reader sees that the difference is the point. Absence still means a condition does not hold, which the third test pins: reading more widely must not turn an unmeasured condition into a satisfied one. **The first version of these tests proved nothing** -- one candidate under `percentile` cannot be placed at all, so the candidate came back `insufficient_data` before any rule was consulted, and the test failed for the wrong reason |
| **P48** | **A weighted pillar holding no criteria makes the level score out of less than 100, and nothing reports it.** `_level_wide_weights` flattens `criterion.weight * pillar_weight / 100`, so a pillar with weight but no criteria at that level contributes nothing and the flattened weights sum to under 100 -- which `_total_of` then reads as the whole. Pillar weights of 90/10 with an empty 10-pillar give a candidate answering *every* criterion perfectly **coverage 100% and a score of 90**, with nothing explaining the missing ten points. `criteria_set.py:154` names this exact hazard and says `pillars_with_no_criteria` "reports it instead" -- that function has no production caller | **Fixed 2026-09-18.** `rank_candidates` refuses, naming the pillar and both ways out: give it a criterion or give it no weight. **Refused rather than warned**, because the alternative is a score that is wrong in a way no reader can see -- 90 out of 100 with coverage reporting 100%, since coverage is a share of the weights that exist. `pillars_with_no_criteria` named the hazard and had no caller, which is the third finding of exactly that shape after P59 and P63 |
| **P49** | **`percentile` compares raw magnitudes and drops each figure's published bounds.** `_by_standing` receives magnitudes only; `as_is` rescales and `percentile` does not. Two docstrings in `magnitudes.py` contradict each other about whether bounds can be dropped, and the code takes the unsafe side. A WHO figure of 72 on 0-100 and an OECD figure of 0.72 on -2.5..2.5 mean the same thing, and the second would rank dead last | **Fixed 2026-09-18.** Where every figure in a column declares its bounds, each is ranked as a fraction of its own scale; where none does, the magnitudes are the figures; a column mixing the two is refused, because a fraction and a bare magnitude are not comparable. **Monotonic, so a column sharing one scale keeps exactly the order it had** -- which is every shipped `percentile` criterion, and why this was safe to apply everywhere rather than only where it bites. The docstring that asserted the unsafe half is corrected |

### Data and provenance

| # | Finding | State |
|---|---|---|
| **P50** | **The LLM fallback silently truncates a non-whole `Count`.** `Count(count=int(figure))` where the Eurostat adapter, for the same type, refuses: "quietly rounding it would hide that behind a plausible integer". A model replying `12.7` is stored as `12`, at low confidence, with a quote and citations that make it read like a figure somebody published, and nothing records that a fraction was discarded | **Fixed 2026-09-16.** `_payload_for` raises rather than truncating, in the same words Eurostat uses for the same type, and the caller turns that into an ordinary refusal -- kept distinct from the `None` it already returned, which means the catalog does not say enough to shape the figure at all. Two tests: 12.7 is refused with the figure in the reason, and 12 is stored |
| **P58** | **Confirming a gate proposal drops its reference period.** The interface sends four fields and omits `reference_period`, which the contract defines as the period the answer holds for -- so a time-boxed answer would become one that never expires. The panel's test uses `toMatchObject` over three fields, so an omitted fourth cannot fail it | **Open, low, latent.** Verified: `Researched` carries no period today, so no proposal has one to lose. It activates the moment research records one |

### The interface

| # | Finding | State |
|---|---|---|
| **P44** | **Discarding the selected criteria set leaves every screen fetching the deleted id.** `discard` deletes and reloads the list but never clears `criteriaSetId`, and the default-adoption effect fires only when it is `null` -- so the selection keeps pointing at a set that no longer exists. The sidebar's `select` renders blank while Configure, Rank and Compare all keep requesting it; Configure shows "No such criteria set." and, because a 404 is not retryable, offers **no Try again** -- recovery means guessing that re-picking a set fixes it | **Fixed 2026-09-16.** The rule lives in `SelectionContext`, where the selection does: **a set that was in the list and has left it takes the selection with it**, and the first survivor is chosen -- which also covers a set deleted from anywhere else, not only from the panel. **Two wrong versions came first, and both were caught by tests rather than by reading.** Clearing the selection at the point of discard let the adoption effect re-adopt from the *pre-delete* list, selecting the very set just deleted. Correcting on mere absence then broke creating a set: a new one is selected a beat before the refreshed list arrives, so absence-as-the-rule snapped the selection straight back off it. The third version keys on disappearance and ignores the empty list a reload shows while in flight -- recording that had erased the memory the correction depends on. **The old test was part of the problem**: it asserted the option had gone from the `<select>`, and a select whose value matches no option falls back to the first in jsdom, so it passed against the bug. The new one asserts through the panel's own "Discard *name*" button, which is labelled from the selection itself |
| **P45** | **Opening a past run swallows its failure entirely.** `open: (run) => void watch(run)` runs outside the `act` wrapper and has no `catch`, unlike `start` and `again`. A 500 or an unreachable backend produces no error notice, no busy state and no message -- **the click looks ignored**, and the browser logs an unhandled rejection | **Fixed 2026-09-16.** `open` goes through the same `act` wrapper as every other action, so a failure surfaces as the `ErrorNotice` the estimate already gets. The test that proves it also caught the rejection escaping: vitest reported the unhandled `ApiError` from `useRunScreen.ts:70` before the fix, and reports nothing after. **One low item went with it**: `refresh` claimed to be `planning`, which relabelled the *Estimate* button "Estimating…"; both reading actions now name themselves `opening` |
| **P52** | **The rule editor destroys a matching threshold it cannot display.** `draftFrom` casts `matching_threshold` to `{min_value, max_value}` unconditionally and `ruleFrom` always re-sends that shape or `null`, while the contract defines four shapes and the backend implements all four, with a storage table each. A criterion whose threshold is a label rule shows **both fields empty, with no sign a threshold exists**; changing only the goal and saving sends `matching_threshold: null`, which the contract documents as "Null clears it" | **Fixed 2026-09-16.** `draftFrom` keeps a threshold it cannot edit on the draft instead of reading past it, `ruleFrom` **omits** `matching_threshold` rather than sending null -- absent says nothing about the threshold, null clears it, and the two are different statements to a PATCH -- and the fieldset says a threshold is there that it cannot show. `Rule` makes that one field optional for exactly this reason. Still latent, so nothing was at risk: no migration writes a row into any of the four threshold tables. Fixed while it costs nothing, because the three live `LabelSet` criteria are exactly the rows a label threshold belongs on |
| **P53** | **The Rank drill-down is not closed when the selection changes.** `chosen` is component state that nothing clears when the criteria set or level changes, while the table beneath it re-fetches. Open Portugal's figures at country level, switch to `city`, and the provenance panel stays open under a table of cities -- with no row matching it, no button reads "Hide figures", so there is **no visible way to close it** | **Fixed 2026-09-16.** The ranking body is a component keyed by the selection, the way `ConfigureScreen` already keys its panels: React resets state on identity, so no effect and no extra render. Two tests -- the level changing under it, and the criteria set |
| **P54** | **Compare keeps the previous level's focus and comparators across a level switch.** `focus`, `comparators` and `asked` survive the change and the fetcher depends on `levelId`, so it immediately re-requests with candidate ids from the old level -- `level=city&focus=country.portugal`, which the contract answers 409 "Levels mixed" -- while the picker shows the new roster with a stale focus selected and the button still enabled | **Fixed 2026-09-16.** The same key, for the same reason and a sharper one: **a comparison never mixes levels**, so a focus and comparators from one level are meaningless at another rather than merely stale |
| **P55** | **A refused rule save leaves the rejected rule on screen, against the file's own promise.** `useCriterionRule`'s header says "a refused change leaves the criterion exactly as it was, so the draft goes back to it", and the effect clears the problems without restoring the draft. The sibling weight input twelve lines away does exactly that restore, and explains why: "the number in the input is the one a reader takes for the weight being scored". After a 422 the Goal select reads `target_range` while the rule being scored is still `minimise` | **Fixed 2026-09-16.** The effect restores the stored draft as well as clearing the problems, which is what the file's header already promised. One line, and the test that catches it asserts the Goal select reads the stored goal again after a 422 |
| **P56** | **A non-numeric pillar weight is dropped in silence.** `if (asked === null) return;` with no message: typing `abc` and clicking Set does nothing, with no way to tell the value was rejected. The criteria panel reports this same case | **Fixed 2026-09-16.** The row reports it, in the words the criterion rows beside it already use. **The old test had to be rewritten, because it asserted the silence**: it checked that no alert was present, so it passed *because* of the defect it should have caught -- the same shape as P43's ranking test |
| **P57** | **An `Index` is rendered as a bare number, dropping the bounds that give it meaning.** `describeFigure` prints `String(payload.value)` for `Index` and `AssignedScore`, so a World Bank figure of `1.07` on a -2.5..2.5 scale shows as "1.07", indistinguishable from a percentage -- against `reqs.md`, which reserves `Index` for figures whose bounds do the work, and against full provenance on every displayed number | **Fixed 2026-09-16.** An `Index` prints as `1.07 on -2.5-2.5 (World Bank)` and an `AssignedScore` as `7 on 0-10 (assigned by human)`. The two branches were duplicates, so both types lost everything but the number; they are now separate and each says what its own type carries. The old assertion expected the bare `"1.07"` and had to be replaced |

### The schema and the SQL

| # | Finding | State |
|---|---|---|
| **P59** | **The attribute-explicit half of validation is written, tested, and never called.** `rejection_reason_for` applies an attribute's `allowed_range` and `allowed_labels` -- the layer `reqs.md` 3.3a specifies -- and its only caller is its own unit test. Every adapter and manual entry builds through `Measurements.figure`, which says outright "It builds; it does not validate"; `Value`'s validators check payload-type agreement, level, provenance and timezone, none of them range or vocabulary; and `value_labelset` has a foreign key to `value` but **none to `attribute_allowed_label`**, so the database does not catch it either. Open-Meteo returning 62 °C for `country.summer_daytime_temperature` -- a **scored** attribute, target band 20-26 with a declared range in `0466` -- would be stored, made active and scored. `country.climate_zone` would accept `banana`, which is the exact case `0472` seeded 20 Köppen codes to prevent. **`known-issues.md` D9 and `CLAUDE.md` both say the vocabulary is "enforced in `refuse_unless_the_payload_suits`", and no method of that name exists in the repository** | **Open, high. The most consequential finding of this review, and the closing note on D9 was mine and wrong.** `0472` proved with a `DO` block that 20 codes had arrived, and nothing proved anything reads them -- a count assertion tests the data, never the wiring. Missing: a test that drives an out-of-range payload and an out-of-vocabulary label through `append` and asserts each comes back rejected. **Fourteen assertions already cover `rejection_reason_for` directly**, which is why an unwired validator looks well tested. **Fixed 2026-09-16.** `Measurements.figure` asks the attribute whether the figure is credible and carries the answer into `rejection_reason`, so 62 °C is stored, kept, and passed over by the active-value rule rather than scored. A payload of another type is left to `Value`'s own refusal, where it already was. Five tests in `test_measurements.py` cover it, including both bounds being inclusive and an attribute that declares no limits rejecting nothing |
| **P60** | **Deleting a criteria set a saved evaluation used answers 500.** `evaluation.criteria_set` is `NOT NULL REFERENCES criteria_set (id)` with no `ON DELETE`; `delete_criteria_set` checks only that the set exists, catches no integrity error, and nothing in `api/errors.py` maps a driver exception -- so the `ForeignKeyViolation` propagates uncaught. Whether the delete should be refused or the history kept is a design call; a 500 is neither. `household_store.py:59` already does exactly this translation for the same exception | **Fixed 2026-09-16.** A new domain error, `CriteriaSetInUseError`, mapped to 409 `criteria_set_in_use`; the store catches `ForeignKeyViolation` and translates it, exactly as `household_store` already did for the same exception. **Refused rather than cascaded**: deleting somebody's kept rankings as a side effect of tidying a criteria set is not a tidy-up. Proved by setting the store change aside and watching `psycopg.errors.ForeignKeyViolation` escape the storage layer. The test's own cleanup has to empty `evaluation` with CASCADE before the set will go, which is the entanglement argument for the refusal in miniature |
| **P61** | **A criterion naming an attribute the catalog does not hold crashes instead of refusing.** `insert_criterion` is an `INSERT … SELECT … FROM attribute WHERE a.id = :attribute RETURNING id`, so an unknown attribute matches nothing, **zero rows insert and no constraint fires**; aiosql returns `None` and the next line reads `written.id`. `POST /v1/criteria-sets` with a criterion on an invented attribute -- which the interface's own fixtures already contain -- raises `AttributeError` and answers 500, **after the set row and its pillar weights have been written in the same transaction**. The docstring anticipates the neighbouring case, a pillar-less attribute failing on `NOT NULL`, but not this one: one fails loudly, the other silently and then crashes | **Fixed 2026-09-16.** `_write_contents` refuses with `UnknownAttributeError` -- already mapped to 404 -- when the insert returns no row, and says which attribute and which set. The transaction rolls back, which the test asserts: the set is not left behind. **Not reachable through the API today**, and that is by design rather than luck: a new set starts empty and users never add attributes (`reqs.md` roles), so the storage seam is where this can be provoked and where it is now tested |
| **P62** | **19 of 101 query blocks have no caller, and one of them is the whole weight-edit path.** `update_criterion_weight`, `update_criterion_weights`, `update_pillar_weights`, `delete_criterion`, `select_criterion`, `select_attribute_coverage`, `delete_evaluation` and twelve more are called from neither `src` nor `tests`. `update_criterion_weight` is commented "a slider drag writes this"; the store rewrites the whole set instead, so **the atomicity argument written in the SQL describes a mechanism nothing uses** **Fixed 2026-09-18 -- the file says which now.** A second guard beside the `PREPARE` sweep asserts every query is either called from `src/` or listed in `QUERIES_NOTHING_CALLS_YET` with the reason it is still here, and fails both ways: a query nothing calls and nothing explains is a loose end, and an entry something now calls is an entry to delete. Nineteen are listed, in four groups -- superseded by writing a criteria set whole, waiting for an operation the contract does not name, waiting for a planned feature, and reference data nothing serves. **Which of them to delete is a roadmap decision and stays open**; what is closed is not being able to tell. The reviewer's count was two off: `insert_candidate` and `select_level` do have callers, and `select_household_fields` does not. Both halves of the guard were proved by breaking them |

### Found while closing the review's low items — 2026-09-17

| # | Finding | State |
|---|---|---|
| **P63** | **`declares_a_readable_scale` was wrong, not merely uncalled.** It answered "has this criterion a scale a `fixed` method could read?" by counting anchors, and **a `target_range` criterion is scored from its band and its two zero points, never from anchors** -- 12-16 °C scoring 100 and falling to 0 at 4 and at 24 is a complete scale with no anchor in it. So the property said `False` about every target-range criterion, which includes both shipped temperature criteria (`0467`). Harmless only because nothing read it: the ranking reached the same answer by catching a `ValueError` out of `scores_for` instead | **Fixed 2026-09-17.** The property asks for a band when the goal is `target_range` and for two anchors otherwise, and `_scores_by_criterion` now reads it rather than discovering the gap inside the arithmetic. **Found by wiring up a property the review had filed as harmless drift**: the first thing the wiring did was stop every target-range criterion scoring, and the existing ranking test caught it immediately. A property nothing calls is not merely in the wrong place -- nothing has ever checked whether it is right |

### Low

- ~~**`_AskedOnlyAbout`'s siblings.**~~ `counts_toward_coverage` and `declares_a_readable_scale`
  were documented as the guards and had no production caller: `ranking.py` filtered on
  `is_scored` directly. **Fixed 2026-09-17, and wiring the second one uncovered P63 below** --
  which is the argument for closing this kind of drift rather than filing it as harmless.
- ~~**No test pins coverage exactly at the floor.**~~ **Fixed 2026-09-18.** A candidate at
  exactly 50% against a floor of 50 is scored, because a floor is a floor and not a bar to
  clear. Proved by mutation: flipping `<` to `<=` now fails that test and nothing else.
- ~~**An unsaved value's tiebreak collapses to 0**~~, so two otherwise-identical unsaved values
  tie on the one key the SQL view cannot express. **Fixed 2026-09-18**: two tests pin it -- the
  order given decides between two unsaved values, and a stored row outranks an unstored one.
  The question cannot arise in production, where the view ranks rows and a row has an id, but
  this module exists to be checked against that view and an untested tie is where a silent
  disagreement between them would hide.
- ~~**WHO hardcodes one publication name into every value's quote**~~, so a second WHO indicator
  -- a manifest-and-catalog change elsewhere -- would mislabel every figure of it. **Fixed
  2026-09-17**: the quote names the GHO indicator code actually fetched, which is what identifies
  a series. Proved by adding a second indicator in the test and watching an air-quality figure
  come back labelled "WHO UHC Service Coverage Index".
- ~~**`limit` exceeds the contract's own bound**~~: the contract declared `maximum: 1000` and the
  code took a bare `int`, accepting `?limit=100000`. **Fixed 2026-09-17**: both listings take the
  contract's bounds, and the contract gains the minimums it was missing. **The negative case was
  filed as unverified and is confirmed** -- `?limit=-1` reached PostgreSQL and raised
  `InvalidRowCountInLimitClause`, a 500 for a request that was merely wrong.
- ~~**Interface small change**~~ **-- fixed 2026-09-18, except one.** Refresh no longer relabels
  the *Estimate* button (with P45); two outside opinions from one publisher are keyed the way
  `external_score`'s natural key is, so a second Numbeo index no longer renders the first twice;
  outside opinions say "Loading…" instead of showing blank space; the uncapped-spend acceptance
  is cleared as the pass is asked for, which is what "per request, never remembered" meant and
  what a new test now holds; the Run-history link finds its route by name rather than at
  `ROUTES[1]`; comparison keys carry the position, so a comparator-less pair and a repeated
  sentence no longer collide. **`useResource` has eight tests of its own** -- idle versus
  loading, the error it keeps, the abort on unmount, the out-of-order guard, and reload -- and
  writing them proved the hook's documented requirement: the first draft passed an inline
  fetcher and re-ran the request 137,316 times before the assertion gave up.
  **Still open**: the proposals panel fetches every level's results, which cannot be narrowed --
  `listMatchRuleResults` takes `candidate` and `match_rule` and no level. Over-fetching a
  handful of rows for one household is not worth a contract change.
- **The run's own spend totals are computed and thrown away.** `add_run_spend` returns the
  authoritative running totals "so the caller can halt without a second read -- the cap is a
  stop, and a stop decided from a stale number is not a cap"; `add_spend` is typed `-> None` and
  drops them, so the cap is decided from a per-process meter that starts at zero. This is what
  makes P35's duplicate run able to spend twice the cap.
- **`evaluation_criterion` is the one evaluation child `0108` did not pin to its level**, and
  `candidate_attribute_score` has no foreign key to it -- so a drill-down over a frozen set that
  does not cover a scored criterion would raise on a NULL pillar. Both unreachable today.
- **Re-fetching an external score stores a second row and both are served**, while
  `append_external_score` claims a current edition is derived. Nothing derives it.
- **Documentation drift**: `CLAUDE.md` says the contract has 40 operations where both files now
  hold 42, and `pyproject.toml` still explains a 75% coverage bar that was raised to 85 on
  2026-09-05.
