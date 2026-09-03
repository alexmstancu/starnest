# Known issues

Findings from the review of 2026-09-02, after `criteria/`, `data/`, `storage/`, `household/` and
`candidates/` were built. Two independent reviews — one of the Python, one of the SQL and the
contract. **Every finding here was reproduced**; nothing is speculative.

**How to read the split.** "Fixed" is what would have corrupted the first real numbers we ever
see, or cost a line. "Deferred" is real but survivable, and is picked up in a named later
chunk. Nothing is here because it was too hard.

---

## Fixed

All six on 2026-09-02, each with a test written to fail against the old behaviour first. The
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

---

## Deferred

Each is real, reproduced, and not fixed yet. Grouped by the chunk of work that should carry it.

### With the first monetary data — `fx_rate` is unreachable

- **D1** (high) `value_monetary` stores `fx_rate` and `fx_rate_date` as loose scalars with **no
  foreign key to the `fx_rate` table and no publishing source**. `reqs.md` 5.5 requires the rate
  to carry its source; `openapi.yaml`'s `FxRate` requires `data_source`; `data/fx.py` already
  models it and storage drops it. The `fx_rate` table has zero rows and **nothing reads it**. Two
  values can carry different rates for the same pair on the same day — the precise failure
  `reqs.md` 5.5 names.

### With `evaluation/`

- **D2** (medium) `candidate_result` may sit at a **different level than its own evaluation**.
  A city can be ranked inside a country evaluation. `candidate_level_key` was created for exactly
  this composite-FK trick and is unused here.
- **D3** (medium) `candidate_result.score`/`coverage` and `evaluation_criterion.weight` carry
  **only a floor, no ceiling** — `score=999, coverage=4200` inserts. The sibling tables were
  corrected; these were missed. The ceiling on `score` is `settings.score_scale_max`, not a
  literal 100.
- **D4** (medium) `openapi.yaml` accepts and returns an evaluation **`note` the schema cannot
  store**. Same shape as the band-label bug. Decide which document is right.
- **D5** (medium) `EvaluationCriterion.scale_anchors` in the contract **omits `label`** and adds a
  `maximum: 100` the live shape does not have. Migration 0013 added the frozen column precisely
  so an old evaluation shows the words it showed then.

### With `api/`

- **D6** (medium) `is_active` is computed by `select_values`, **required by `openapi.yaml`**,
  typed non-optional in the generated client — and **thrown away by the mapper**. `Value` has no
  field for it, so a caller of the seam cannot populate a required field.

### With the catalog

- **D7** (medium) **No attribute declares a `max_age`** — 0 of 41. So **rule 2 of the
  active-value view never fires against real data**, and the age downgrade in the confidence
  derivation has no input. `reqs.md` 7.1 has no column stating the intended values, so there was
  nothing to seed from: the document needs the column before the migration can exist.
- **D8** (medium) A **criterion may attach to a pillar-less attribute**. `reqs.md` 3.3 says
  descriptive attributes carry no criterion; nothing enforces it, and
  `evaluation_criterion.pillar` is `NOT NULL` — so it crashes at *save* time, after the ranking
  has been computed and shown.
- **D9** (low) **`label_vocabulary` is dead**: zero rows, zero query references, zero incoming
  foreign keys. Its own comment points at `attribute_allowed_label`, which does the real job.
  Drop it or wire it.

### With the next schema migration

- **D10** (medium) `external_score_natural_key` **omits `reference_period_end`** — an annual and
  a monthly figure sharing a start date collide. This is the exact argument `value_natural_key`
  makes for including both dates.
- **D11** (medium) **A candidate at a nested level can have no parent at all.** The FK is
  `MATCH SIMPLE`, so a NULL skips the check: `city.orphan` with no country inserts.
- **D12** (low) Both views use `SELECT *`, which PostgreSQL **expands and freezes at
  `CREATE VIEW`**. Every future column on `value` will be silently absent from the ranking read
  path. Any migration touching `value` must recreate both views.

### Test-quality

- **D13** (medium) `test_catalog_arithmetic.py` weight-sum guards **aggregate across criteria sets
  and levels**. With two sets split 40/60 the totals still read 100 and the checkpoint reports
  clean. Passes today only because exactly one set at one level is seeded — and duplicating a set
  is a shipped feature.
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
