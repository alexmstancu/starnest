# Development plan — Starnest **v2.0 (the city level)**

> **Status: build plan, 2026-10-25 — awaiting Alex's approval.** Written against the revised
> architecture (`arch.md` 12) and the decisions in `reqs.md` Appendix B, Q241–Q252. It replaces
> the high-level draft of 2026-10-12, whose research and decisions (section 0.0) are kept as
> written. **Nothing is built until this plan is approved**, and then the first thing built is
> the four gates, as failing tests (P0).
>
> **v1.0 is the country-level MVP** (`docs/devplan.md`), functionally complete: four gates closed,
> 32 countries ranked from eighteen sources in a browser, coverage 95-98% per candidate, and the
> review programme closed on 2026-10-25 with all 182 planned items done. **v2.0 is the city
> level** — the bulk of what the MVP deliberately deferred (`reqs.md` 1.3, `devplan.md` 8).

## 0.0 Research and decisions so far (2026-10-23/24)

**Data is the main focus, then functionality** (the household, 2026-10-23). The source research
is `docs/research/city-level-sources-2026-10-23.md`, every coverage figure fetched live. What it
changed:

- **Numbeo can no longer be scraped** (its terms), and three of its indices are composites barred
  by Q223. The city catalog's cost, rent, safety and transport plans are re-sourced.
- **The city catalog had no national factors**, though `reqs.md` 4 assumed it did. Decided: a
  city criterion may read its parent country's attribute (decision B below). This is the one
  new scoring mechanism v2.0 needs, and it is an `arch.md` revision item.
- **A city figure has a footprint** (point, city, region, nation) and the footprint belongs in its
  provenance. Regional (NUTS) statistics are the even-coverage middle tier; Urban Audit is patchy
  by whole countries.
- **All 32 countries currently match**, so the country screen filters nothing until the
  household prunes it.

| | Decided 2026-10-24 |
|---|---|
| Roster | Seed the 79 cities of the EU Quality of Life survey; manual adds enter `approved`; LLM proposals wait as `proposed` (Q241) |
| National factors | Read through the parent country, never copied (Q242) |
| Cost of living | Derived from city rent and national non-housing price levels; no Numbeo (Q243, Q251) |
| Country screen | Pruned by hand with `not_manually_excluded` (Q244) |
| Survey answers | **Scored**, labelled in the drill-down as a resident survey with its year and sample size (safety, local administration, public transport) (Q245) |
| Recorded crime | **Homicide scored** (NUTS 3); robbery, burglary and vehicle theft **displayed only**, with Eurostat's comparability caveat (Q245) |
| City criteria sets | **Mirror both** country sets: a set already spans levels, so `local_employment` and `remote_only` each gain a city level (Q246) |
| Deferred UI features | **Moved to v2.1**: gradient maps, favourites, annotations, saved comparisons, `relocation_window`. v2.0 is the city level (Q246) |

| | Decided 2026-10-25, with the architecture revision (`arch.md` 12) |
|---|---|
| Footprint | **A property of the attribute**; every figure records the region, station or grid cell it was measured for, and the distance where it is a proxy (Q247) |
| Derived figures | **Computed at scoring time, never stored**, whether or not they read the household (Q243) |
| A criterion's level | **Its own column, and part of its identity**, so one set judges a national attribute at country level and again at city level; checked against the level hierarchy, and normalised over the distinct ancestors (Q242) |
| The evaluated figure | **What evaluation read for a candidate and an attribute -- for any criterion or rule -- with its published bounds and evidence**; thresholds, rules, the snapshot and comparison read it instead of a stored value, and at the evaluation's own level it is the candidate's own value (Q252) |
| Nomination | **A history, kept once written**: proposals with their pages, decisions with their reasons (Q241) |
| `parent_not_matching` | **Not built in v1** (found 2026-10-25). The set being run judges the parent at country level first; the city records the parent's status in the one vocabulary (Q248) |
| Geography | **Vendored datasets, processed offline; no PostGIS** (Q249) |
| Delivery | **Vertical slices, each gated and reviewed alone; the four gates written first as failing tests** (Q250) |

## 0. The thesis v2.0 tests

The MVP was built to make this pass cheap, and to **test whether the architecture was right**
(`devplan.md` 8, `reqs.md` 1.3). The bet, stated so we can hold v2.0 to it:

> Adding the city level should be **sources and rows** — new adapters behind the same
> `SourceAdapter` contract, new attributes as catalog migrations, new weights in a `CriteriaSet` —
> **and not new machinery.** If it turns out to need new machinery, the boundary that failed will
> be visible in exactly which module had to change.

So the plan's structure is: **separate the genuinely-new from the reuse, and keep the new list
short.** Two things are honestly new and load-bearing; a third is new UI over old machinery.
Everything else is rows.

| | New? | Why |
|---|---|---|
| **The LLM + `web_search` acquisition path becomes the backbone** -- *superseded 2026-10-24: the research found structured sources for nearly every city attribute; the LLM keeps only employers and nomination proposals (W7)* | **New as a load-bearing path.** The machinery exists (built at MVP P7-A for *one* country attribute, `international_employers`): `CostMeter`, spend cap, refusal-without-cap, priced estimation, stored read-pages, `low`-confidence ranking. v2.0 makes it the *primary* source for most city attributes instead of a single fallback. | The one place the MVP's design is genuinely stressed. The question is scale and cost, not mechanism. |
| **Candidate nomination and the `proposed → approved / rejected` lifecycle** | **New lifecycle.** v1 seeds candidates from configuration and needs none of it (`reqs.md` 1.3). Cities enter by nomination: LLM proposal, manual add, top-N by population. | A genuinely new state machine on `Candidate`, and a new screen. |
| **The two-level pipeline actually runs end to end** | **Mostly exercised, partly new.** `Candidate`/`Level` are level-agnostic rows and the contract already takes a level. *Corrected 2026-10-25:* **`parent_not_matching` was specified and never built** (`evaluation/ranking.py` says so), and nothing nominates yet, so "only for matching countries" has nothing to apply to. | This is the payoff of "nothing may assume there are exactly two levels" (`reqs.md` 3.1). The revision found four leaks, each confined to one module (`arch.md` 12.1). |
| City attribute catalog (~33 new attributes), city pillar weights, a city criteria set | **Rows.** Migrations, not logic. | The "nothing hardcoded" invariant paying out again. |
| Gradient maps, favourites, annotations, saved comparisons | **Moved to v2.1** (Q246). | Deferred MVP features (`reqs.md` 1.3); none is needed by the city level. |

**The explicit invariant to re-check at every v2.0 review:** nothing may assume exactly two
levels (`reqs.md` 3.1). A `city`-only branch in scoring, matching, active-value selection or
comparison is a design failure, not a shortcut.

## 1. The delivery model

### 1.1 Sequence

1. ~~**Revise `arch.md`**~~ — done 2026-10-25: section 12, with the decisions logged as Q241–Q252,
   and checked by an independent review against the code before it was committed.
2. ~~**Rewrite this document against it**~~ — this document.
3. **Alex approves this plan.** A change to scope, phases or gates comes back here first.
4. **P0 writes the four gates as failing tests**; the slices then build until each one passes.

**Before P1 starts**, the five open v1 findings (`known-issues.md` P101-P103, P105, P106) are
closed or explicitly accepted by Alex. They are handled in their own pass, by decision. This is
what was W0 ("v1 works"): its other items, the saved-ranking snapshot gaps and the run
accounting, closed in round 3.

### 1.2 Vertical slices (Q250)

**Why.** The MVP's large parallel batches, reviewed after the fact, produced round after round of
findings. A slice small enough to review whole, landing with its gate passing, finds a defect in
the slice that made it.

- **A slice is the smallest change that moves a gate's tests from red to green end to end**:
  everything those tests touch, from migration to API, and the interface where the gate drives a
  browser. If its diff cannot be read in one sitting, it is two slices.
- **One slice at a time on master.** Within a slice, at most two lanes run in parallel, on
  disjoint folders (`backend/` with `storage/`, and `ui/src/`), so no two agents edit one file.
- **A slice lands only when** its gate tests pass, `make check` and `make e2e` are green, and
  **one review of the whole slice diff** is done, with its findings fixed before the next slice
  starts. **A critical finding gets at most two review rounds**; anything still open after the
  second is decided by Alex, not reviewed a third time.
- **The master agent integrates**, owns the acceptance and browser tests, the migration numbers
  and the contract, as in v1 (`devplan.md` 0.2).

### 1.3 What carries over from the MVP unchanged

The stop rule (`devplan.md` 0.3) — including **seed `NULL` and never invent a number**, which
governs every city weight and anchor; the definition of done (0.4) with the 85% floors, held
per package; `openapi.yaml` written first and changed only as a decision; and the lessons in
`CLAUDE.md` — check what the code already does before researching what it should do, compare
two artifacts that ought to agree, and break the code to watch the test fail.

### 1.4 The gates are written first

- **P0 writes all four**, from `reqs.md`, `arch.md` 12 and the target contract, by the master
  agent rather than by whoever builds the slice: a builder testing their own slice tests what
  they built, not what was asked for.
- **Where v1's live:** `backend/tests/acceptance/test_gate_a2.py`, `test_gate_b2.py` and
  `test_gate_d2.py`, `ui/e2e/gate-c2.spec.ts`, and beside `backend/tests/live/test_gate_b.py` the
  parts that need a network or a bill.
- **Red, but out of the way.** Each is marked as a v2 gate and kept out of `make check` and
  `make e2e`; a new `make gates-v2` runs them and reports what is still red. **When a phase's gate
  passes, its mark comes off and it joins `make check` or `make e2e` for good.**
- **Never a network or a bill in `make check`.** A gate's live half -- coverage measured against
  real publishers -- joins `make live`, and its billed half -- an estimate against a real bill --
  joins `make live-llm`, exactly as Gate B's all-32 coverage and the LLM path's paid tests do
  today.
- **Each must fail for the right reason** — a missing operation, row or field — never a typo, so
  P0 ends by reading every failure.
- The e2e recipes are pinned as text by `ui/src/app/architecture.test.ts` and
  `backend/tests/unit/test_migration_tooling.py`: a new target leaves them alone, and an edited
  recipe updates both.

## 2. Scope of v2.0

### 2.1 In scope — the city level

- **Cities as candidates**, nested under their country, with the city attribute catalog and city
  pillar weights (100% within the city level, independently of the country level).
- **Nomination** (`arch.md` 12.2, Q241): the 79 survey cities seeded `approved`; manual add at any
  level, `approved`; LLM proposals `proposed` until approved or rejected; every step kept as a
  history. **Top N by population is not built.** Only an approved candidate is acquired, scored
  or compared.
- **Place and footprint** (12.3, 12.4): every city resolved once from vendored geography; every
  attribute declares its footprint and every figure names where it was measured.
- **National factors read through the parent** (12.5): a criterion's level is part of its
  identity, and an ancestor's figure is normalised over the ancestors.
- **Derived figures at scoring time** (12.6): city cost of living first, and the household-share
  rule shape for `rent_vs_spend`.
- **The evaluated figure** (12.7): what thresholds, rules, the snapshot and comparison read.
- **The parent's match status** and the country screen (12.8).
- **Acquisition from structured sources by tier**; the LLM only for employer lists and proposals
  (12.9, 12.10).
- **Scoring, coverage, confidence, matching, ranking with drill-down and comparison** at
  `level = city`, on the v1 machinery.
- **Both shipped criteria sets gain a city level** (Q246), with weights and anchors derived from
  real figures and reviewed, as Q209 did for the country level.
- **The interface** (12.11): a Candidates panel in Configure, and the four tabs at city level.

### 2.2 Riding with v2.0, or not

| Feature | In v2.0? | Note |
|---|---|---|
| **Derived attributes — the first real cases** | **Yes** | City cost of living (Q243); `country.house_price_to_income_ratio`, an absolute house price level over median income (Q204); the household-salary tax (Q205). One mechanism (`arch.md` 12.6) |
| **Caching — revisit on measurement** | **Yes, as a measurement** (P7) | The `value` table remains the cache for fetches; a read-path cache only on a measured need |
| **Intercity connectivity** | **Open** (section 5) | Country-level rail and road travel time between the largest places, from `population_centre` (`0464`). No v2.0 gate needs it |
| **Pillar expansions** | **Open** (section 5) | Health detail, seasonal climate, crime detail, rent outside the centre — catalog rows. No v2.0 gate needs them |
| **Time-series reducers** | **Open** (section 5) | `arch.md` 11; needs no schema change |
| `relocation_window`, gradient maps, favourites, personal annotations, saved comparisons | **No — v2.1** (Q246) | v2.0 is the city level and nothing else |

### 2.3 Still out of scope

Never, in any version: **authentication/authorisation**, any **admin UI** (adding attributes and
sources stays a developer action in config). A **third level** is not planned — but no code may
assume there isn't one.

## 3. The phases

| Phase | Delivers | Moves |
|---|---|---|
| **P0** | The target contract for v2.0, the four gates as failing tests, the diagrams | Nothing green; every gate red for the right reason |
| **P1** | Cities exist: nomination history, place, footprint, two sources at city level | Gate A2, nomination and figures |
| **P2a** | The evaluated figure, at the country level only — a refactor that moves no number | Nothing new green; every v1 gate and suite still green |
| **P2b** | Cities rank: a criterion's level, figures read through the parent, the parent's status | Gate A2, ranking |
| **P3** | Derived figures and the household-share rule | **Gate A2 green** |
| **P4a–d** | Sources by tier, then the city catalog and both sets' city levels | **Gate B2 green** |
| **P5** | Nomination in the interface, LLM proposals, city compare | **Gate C2 green** |
| **P6** | Employer lists at the city level | Gate D2, the spend half |
| **P7** | Durability, scale and the caching measurement | **Gate D2 green** — v2.0 done |

### P0 — Gates first, and the contract (no feature code)

- **The target contract** (`docs/openapi.yaml`): candidates listed with their nomination state
  and history; resolve a name to the places it could mean; add a candidate; propose candidates
  (estimated, then run); approve or reject a proposal; a candidate's place. Criterion operations
  keyed by level and attribute; footprint and `measured_for` in a figure's provenance; the
  evaluated figure's evidence and the parent's match status in the ranking detail and the
  comparison. `audit_api.py` holds it.
- **The ontology diagrams** of `reqs.md` 3 gain the nomination history, place, footprint, a
  criterion's level, the evaluated figure's evidence and derivation inputs; `audit_ontology.py`
  holds them.
- **The four gates written as failing tests** (1.4), and `make gates-v2`.
- **Exit:** Alex approves the contract additions, and every gate fails for the right reason.

### P1 — Slice 1: cities exist

- **Migrations:** the nomination history and the state read from it; the `place` table; the
  `footprint` reference table, `attribute.footprint`, and a figure's `measured_for` and
  `measured_distance`, refused when missing for a point or region attribute; a handful of the 79
  seed cities with their places.
- **Geography:** the geometry library chosen and added (`uv add`); the place resolver over
  vendored GeoNames and GISCO files, so a seed's place and a manual add's are resolved the same
  way.
- **Nomination, through the API:** add by name; propose, with a stub model in the acceptance
  suite as gate research is tested today (`test_llm_path_api.py`); approve and reject. The real
  model and the panel come in P5.
- **Sources:** two existing adapters at the city level, each recording where it measured --
  Open-Meteo (a point) and Eurostat NUTS 2 unemployment (a region).
- **Exit:** Gate A2's nomination and figure assertions are green.

### P2a — Slice 2a: the evaluated figure, at the country level only

- Evaluation produces an evaluated figure per candidate for every attribute a criterion judges
  or a rule reads, carrying the published figure and its bounds; matching thresholds, compound
  rules, the snapshot (its evidence rows, cascading with the evaluation as `0482` requires) and
  comparison read it.
- **A refactor: no number moves.** Every v1 suite and Gates A to D stay green unchanged, and the
  review checks exactly that.

### P2b — Slice 2b: cities rank

- **Migrations:** `criterion.level` in the criterion's identity, with the ancestor check; a city
  level for the `minimal` set.
- **Policy:** the set's checks grouped by the criterion's level; a figure read through the
  ancestor, normalised over the distinct ancestors; the parent's match status and its reasons; a
  city run's default scope (12.8).
- **Interface:** City in the level toggle once approved cities exist; Rank at city level, with the
  country's score beside each city and the parent's status with its reason; criterion keys that
  include the level.
- **Why `minimal`:** it scores by percentile, so the slice needs no invented anchor; the shipped
  sets wait for P4d.
- **Exit:** Gate A2's ranking assertions are green.

### P3 — Slice 3: derived figures

- The derivation shape and its input rows; the household's dwelling size and non-housing spend
  (provisional, from real figures); the city cost of living from a first rent source (Deloitte,
  transcribed) and Eurostat's price level excluding housing; the household-share rule shape for
  `rent_vs_spend`.
- **Interface:** the drill-down shows a figure's footprint and `measured_for`, whose national
  figure a city reads, and a derived figure's inputs and the household figures it used.
- **Exit:** **Gate A2 green.**

### P4 — Slices 4a–4d: sources by tier, then the catalog

Each tier is its own slice, and each adapter lands with its live coverage measured against the
roster, as `make live` does today. The research's "still to verify" items are settled here, by
fetching.

- **P4a — Region:** Eurostat NUTS 2 and 3 (high-tech employment, life expectancy, homicide, the
  census's foreign-born share); Copernicus heat days at NUTS 3.
- **P4b — City:** the Quality of Life survey as a transcribed table (scored and labelled as a
  resident survey, Q245); Deloitte's remaining figures; Urban Audit for display; Eurostat
  `avia_par_*` for flights home; national rent sources for the countries both miss.
- **P4c — Point:** WMO 1991-2020 normals for sunshine, Ookla, air quality (CAMS or EEA), and the
  geometry attributes from vendored files — the largest engineering item.
- **P4d — The catalog and the sets:** the research's verdict table as catalog migrations; every
  seeded city's place; the city levels of `local_employment` and `remote_only`, with weights and
  anchors derived from real figures and reviewed by Alex (as Q209).
- **Exit:** **Gate B2 green**, its live half in `make live`.

### P5 — Slice 5: nomination in the interface, and city compare

- **The Candidates panel:** the roster per country with each candidate's nomination state and
  history; add by name, choosing among the resolver's places; the proposal queue with the pages
  read, approve or reject.
- **LLM proposals** (`reqs.md` 6.10 use 4) with the real model: names only, estimated before
  spending, refused without a cap, opt-in.
- **Compare at city level**, never mixing levels.
- **Exit:** **Gate C2 green.**

### P6 — Slice 6: employer lists at the city level

- `city.international_employers` (use 2): estimated per city before a run, capped, opt-in like
  `make live-llm`, and kept out of `make check`.
- **Exit:** Gate D2's spend assertions green, the billed one in `make live-llm`.

### P7 — Hardening, scale and the caching decision

- Gate D2's failure modes at city scale; the read path measured with the full roster, and the
  caching decision recorded on that measurement (`arch.md` 11).
- `CLAUDE.md`, `reqs.md` 7.2 (rewritten from the catalog that shipped) and `known-issues.md`
  brought up to date.
- **Exit:** **Gate D2 green — v2.0 is done.**

## 4. Gates

v1's gates were acceptance tests made executable (`tests/acceptance/`, `tests/live/`, `ui/e2e/`),
and v2.0's are too: written first (1.4), run against a real database, and validated against the
target contract.

- **Gate A2 — the city level stands up** (P1–P3), in `make check` once green. A seeded city is
  `approved` and ranks; a manual add resolves to a place and enters `approved`; a proposal waits
  as `proposed`, is not ranked until approved, and keeps its pages after a decision; a city
  carries a point and a region figure, each with its footprint and the place it was measured for;
  a criterion judging the country's attribute reads it through the parent, labelled, and scores
  the same for every city in that country whatever the number of cities; a city records its
  parent's status, is flagged when that is not `matching`, and keeps its score and reason; a saved
  city ranking freezes national and derived figures with their evidence; and the derived cost of
  living moves when the household's dwelling size changes, with nothing fetched.
- **Gate B2 — city coverage is real and honest** (P4). In `make check`: every scored city
  attribute declares a footprint and every point or region figure names its place; no stand-in is
  declared at a point or region footprint; coverage by confidence is reported; and where a source
  does not reach a city -- Liechtenstein is absent from the survey -- the gap reads as missing,
  never as a number. In `make live`: every scored city criterion answered for the seeded roster
  to a floor stated per attribute, and four figures spot-checked against their publishers by a
  route the adapters never use, as Gate B did.
- **Gate C2 — the product, driven by a browser** (P5), in `make e2e` once green. Nominating,
  approving and rejecting in the Candidates panel; City in the level toggle; city Rank with the
  drill-down showing footprint, national and derived provenance; city Compare; the parent's status
  visible with its reason. Playwright against the real stack.
- **Gate D2 — cost and durability at city scale** (P6, P7). In `make check`: LLM spend estimated
  before it is spent and halted at the cap with nothing lost, against a stub model; a city run that
  dies mid-way is recoverable; nominations, places and manual adds survive a real `pg_dump` and
  `pg_restore`. In `make live-llm`: the estimate within a stated tolerance of what a real run
  billed. And the read path measured with the full roster, with the caching decision recorded.

## 5. Decisions

**Decided:** Q241–Q252 in `reqs.md` Appendix B — the roster and its history, national factors, the
cost of living, the country screen, survey and crime, both sets' city levels, footprint, the
parent's status, geography, delivery, Numbeo and the evaluated figure.

**Open, none blocking P0:**

1. **Ride-alongs** — intercity connectivity, pillar expansions, time-series reducers: v2.0 or
   v2.1? No v2.0 gate needs any of them, so **the default is v2.1**.
2. **LLM use 1 at the city level** — a fallback figure where no dataset answers is permitted at
   both levels by `reqs.md` 6.10, but not planned for cities: the research found structured
   sources, and a gap reads as missing. **The default is not to build it in v2.0.**
3. **The household's dwelling size and non-housing spend** — provisional values, set from real
   figures in P3.
4. **The shipped sets' city weights and anchors** — derived from real figures in P4d and reviewed
   by Alex, as Q209.
5. **The contract additions** — approved at P0's exit.
6. **Caching** — decided on the P7 measurement, never before.

## 6. Risks this plan carries

- **The evaluated figure touches what every ranking reads.** P2a lands it alone, at the country
  level, as a refactor that must move no number, so a regression shows against suites and gates
  that already pass.
- **A source that covers the roster by whole countries scored as if complete** (Urban Audit,
  Deloitte). Footprint per attribute (Q247) and Gate B2's per-attribute floor are the guards.
- **A regional or national figure read as the city's own.** Every figure names where it was
  measured, and the drill-down shows it (12.4).
- **A hidden two-level assumption.** The revision found the leaks listed in `arch.md` 12.1. Any
  further one surfaces as a `city` branch, and is fixed in the module where it appears, loudly.
- **The geometry attributes are the largest engineering item**: vendored datasets (coastline,
  terrain, land cover, night sky, protected areas, bathing water, Ookla tiles, air quality) cost
  disk and processing time. P4c slices them per attribute, each dataset kept with its edition.
- **LLM spend** is small now — employer lists and proposals only — and is estimated and capped.
- **Review churn.** Slices, one review per slice and the two-round cap (1.2) are the guard.
- **Scope creep.** v2.1 holds the deferred interface features, and the ride-alongs default to it.

## 7. What this plan deliberately does not do

It does not write the city catalog's rows (P4d does, from the research's verdict table), choose a
city weight or anchor (derived from real figures and reviewed), or set durations. It does not
touch v1 code: every change is made by a phase and lands through its gate. And it does not
revise `devplan.md`, which stays the record of the MVP.
