# Development plan — Starnest **v2.0 (the city level)** — DRAFT

> **Status: high-level draft, 2026-10-12. To be refined with Alex, then rewritten against a
> revised `arch.md`.** This is not yet a build plan. It is the first pass at *what* v2.0 is, *what
> is genuinely new* versus reused, and *which decisions must be made before* a real phase plan can
> be written. Numbers, phase boundaries and attribute counts here are provisional and will move.
>
> **v1.0 is the country-level MVP** (`docs/devplan.md`), functionally complete: four gates closed,
> 32 countries ranked from seventeen sources in a browser, coverage 95-98% per candidate. **v2.0 is
> the city level** — the bulk of what the MVP deliberately deferred (`reqs.md` 1.3, `devplan.md` 8).

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
| **The LLM + `web_search` acquisition path becomes the backbone** | **New as a load-bearing path.** The machinery exists (built at MVP P7-A for *one* country attribute, `international_employers`): `CostMeter`, spend cap, refusal-without-cap, priced estimation, stored read-pages, `low`-confidence ranking. v2.0 makes it the *primary* source for most city attributes instead of a single fallback. | The one place the MVP's design is genuinely stressed. The question is scale and cost, not mechanism. |
| **Candidate nomination and the `proposed → approved / rejected` lifecycle** | **New lifecycle.** v1 seeds candidates from configuration and needs none of it (`reqs.md` 1.3). Cities enter by nomination: LLM proposal, manual add, top-N by population. | A genuinely new state machine on `Candidate`, and a new screen. |
| **The two-level pipeline actually runs end to end** | **Exercised, not new.** `Candidate`/`Level` are already level-agnostic rows; `parent_not_matching` and "cities nominated only for countries whose `match_status` is `matching`" are already built and tested in v1. | This is the payoff of "nothing may assume there are exactly two levels" (`reqs.md` 3.1). If it needs code changes, the abstraction leaked. |
| City attribute catalog (~33 new attributes), city pillar weights, a city criteria set | **Rows.** Migrations, not logic. | The "nothing hardcoded" invariant paying out again. |
| Gradient maps, favourites, annotations, saved comparisons | **New UI** over existing data. | Deferred MVP features (`reqs.md` 1.3); none needs new backend machinery per the MVP notes. |

**The explicit invariant to re-check at every v2.0 review:** nothing may assume exactly two
levels (`reqs.md` 3.1). A `city`-only branch in scoring, matching, active-value selection or
comparison is a design failure, not a shortcut.

## 1. Sequence — arch revision comes first

Decided in `devplan.md` 8; restated so it is not skipped:

1. **Revise `arch.md`** for the one thing the MVP never exercised at load: the LLM-plus-search
   acquisition path as the primary source, with its cost meter, spend cap, stored read-pages,
   caching decision and `low`-confidence ranking — now carrying most of a level's coverage rather
   than one attribute. Also: the nomination/approval lifecycle, and city-level runtime flows.
2. **Rewrite this document against the revised architecture**, with real phases, fan-out, gates
   and a decomposition — the way `devplan.md` is written for the MVP. This draft becomes the input
   to that rewrite, not the build plan itself.

Until step 1 lands, phase boundaries below are illustrative.

## 2. Scope of v2.0

### 2.1 In scope — the city level, full feature set

Mirror of what the country level already has, applied to cities (`reqs.md` 1.3):

- **Cities as candidates**, nested under their country (`CANDIDATE.parent_candidate`), with the
  city attribute catalog and city pillar weights (weights sum to 100% *within* the city level,
  independently of the country level).
- **Nomination and approval**: how a city enters — LLM proposal, manual add, top-N by population —
  and the `proposed → approved / rejected` state that implies. Cities are nominated only for
  countries that are `matching` under the active set (already the rule; no score cutoff).
- **The LLM + `web_search` acquisition path** as the primary source for qualitative/city-sparse
  attributes, alongside any structured city sources that exist.
- **Scoring, coverage, confidence, matching, ranking with drill-down, comparison** — all reusing
  the v1 machinery, now at `level = 'city'`.
- The **UI**: city nomination screen + the four existing tabs operating at city level.

### 2.2 In scope — the deferred features that ride with v2.0

From `reqs.md` 1.3 and `devplan.md` 8 (each carries its own requirements; see those sources):

| Feature | Note |
|---|---|
| **Nomination & approval** | New lifecycle (see 2.1). The anchor feature of v2.0. |
| **`relocation_window`** | A match rule: can the move be *completed* within the window (visa queue, quota wait, notice period, school year), not how long you stay. Vacuous for 30/32 countries under free movement, which is why it waited; its value is capturing *your* constraints. |
| **Derived attributes — first real cases** | `country.house_price_to_income_ratio` (absolute price level over median income; no publisher offers it cross-country, so it is *derived* — defines what "derived" means in practice, `reqs.md` Q204) and the **household-salary tax rate** (store brackets + caps, apply to the salary entered, `reqs.md` Q205). Both are the household reaching evaluation (`reqs.md` Q84). |
| **Intercity connectivity** | Typical rail/road travel time between a country's largest places, replacing network-density-over-land-area (which punishes empty land). Uses `population_centre` (`0464`). Asked for by the household. |
| **Pillar expansions** | Health detail, seasonal climate, crime detail, rent outside the centre (`reqs.md` 7) — catalog rows. |
| **Gradient maps** | A map coloured by *any* chosen numeric attribute — the generality is the feature, never fixed to one. |
| **Favourites** | Marking a candidate; separate lists per level. |
| **Personal annotations** | Free notes on a candidate — impressions, whether you've visited. |
| **Saved comparisons** | Focus + comparators + a reference to settings, saved under a name, **frozen at the values held when saved**, with an explicit re-run action. The one deliberate exception to "comparisons are always live". |
| **Time-series reducers, derived attributes (general)** | Recorded as open in `arch.md` 11; neither needs a schema change. |
| **Caching — revisit on measurement** | The city level multiplies candidates ~10x, so it is the natural moment to *measure* the read path. Add caching only on a measured inefficiency, never an intuition (`devplan.md`, 2026-08-30). The `value` table remains the cache for fetches. |

### 2.3 Still out of scope

Never, in any version: **authentication/authorisation**, any **admin UI** (adding attributes and
sources stays a developer action in config). A **third level** is not planned — but no code may
assume there isn't one.

## 3. What genuinely new work looks like (high level)

Provisional workstreams, to become real phases after the arch revision. Ordered by dependency.

### W1 — City candidate model and nomination lifecycle
The `proposed → approved / rejected` state on `Candidate`; nomination by LLM proposal, manual add,
and top-N by population; the rule that cities are nominated only under `matching` countries.
Backend state machine + storage + API operations + a nomination/approval screen.
**Risk it tests:** does `Candidate` absorb a lifecycle it never had, without `country`/`city`
branching elsewhere?

### W2 — City attribute catalog (rows)
~33 city attributes as migrations, each with pillar, value type, sources, `max_age`; city pillar
weights; a city `CriteriaSet` (or sets). Includes `city.cost_of_living_monthly`,
`city.purchasing_power`, the city tech-jobs attributes, rent-outside-centre, etc.
**Risk it tests:** can a whole level's catalog arrive as pure data? (It should — the audits and
`test_catalog_arithmetic` already guard the shape.)

### W3 — The LLM + search path as the backbone
Harden the MVP's single-attribute path into the primary city source: batching/pacing against rate
and cost, estimation before spend at level scale, the spend cap and its halt under real volume,
stored read-pages for every figure, `low`-confidence ranking so a structured source always wins.
**This is where the architecture is actually stressed.** It is also the only thing here that spends
money, so it stays out of `make check` and behind an opt-in target (as `make live-llm` already is).

### W4 — The two-level pipeline, run for real
Country screen → nominate cities for matching countries → city acquisition → city scoring, ranking,
comparison, with `parent_not_matching` surfaced. Mostly integration + e2e, little new code if the
bet held.

### W5 — Derived attributes and household-reaching-evaluation
`house_price_to_income_ratio`, household-salary tax, intercity connectivity. First concrete derived
attributes — decides the "derived attribute" mechanism in practice.

### W6 — The deferred UI features
Gradient maps (any numeric attribute), favourites, annotations, saved comparisons (frozen-at-save),
`relocation_window` as a match rule. New screens/panels over existing data.

### W7 — Scale and cost hardening
Measure the read path at ~10x candidates; decide caching on that measurement. Confirm run
estimation and spend cap behave under real city volume.

## 4. Gates (sketch — to be made executable like v1's)

v1's gates were acceptance tests made executable (`tests/acceptance/`, `ui/e2e/`). v2.0 should
mirror that. Provisional:

- **Gate A2 — the city level stands up.** A city candidate exists, is nominated under a matching
  country, carries attributes, and ranks — end to end against a real DB.
- **Gate B2 — city coverage is real and honest.** Cities for the matching countries covered to a
  stated floor, the LLM path's figures each carrying their read-pages, confidence split reported.
- **Gate C2 — the product, driven by a browser.** Nomination/approval, city rank with drill-down,
  city compare, gradient map, favourites — all exercised in Playwright against the real stack.
- **Gate D2 — cost and durability under volume.** The spend cap halts a city run and loses
  nothing; estimation matches actual within tolerance; a crash mid-run is recoverable; manual
  values survive a dump/restore (as v1 Gate D proved).

## 5. Decisions to resolve before the build plan (open questions)

These block a real phase plan and are the agenda for refinement with Alex:

1. **City seed vs. pure nomination.** Does v2.0 seed a starter city list per country (like v1
   seeded countries), or is every city nominated? How many cities per country (~5 was the MVP
   assumption)?
2. **Which city attributes, and which have a *structured* source at all** vs. LLM-only. This
   decides how much of a level's coverage rests on `low`-confidence LLM figures — and therefore the
   cost and the honesty story. (The MVP lesson: check what a source already covers before assuming
   the LLM must answer it.)
3. **Cost envelope.** A realistic per-run and total spend cap for city acquisition at ~N cities x M
   LLM-answered attributes; what the estimate must show before spending.
4. **Caching trigger.** What measured read-path latency at city scale would justify a cache, and
   what gets cached (never the ranking arithmetic — a stale plausible ranking is the failure the
   app exists to prevent).
5. **Nomination authority.** Who/what approves a proposed city, and whether LLM proposals are
   `proposed` until a human approves (parallel to gate-research proposals ruling nothing out until
   written, Q218).
6. **`relocation_window` inputs.** Which household constraints it reads and how they are configured.
7. **Derived-attribute mechanism.** How `house_price_to_income_ratio` and the household-salary tax
   are computed, stored and given provenance — the first derived attributes set the pattern.
8. **Do city criteria sets mirror the two country sets** (`local_employment`, `remote_only`), or
   does the city level get its own scenarios?

## 6. Risks this plan carries

- **The LLM path may not scale cheaply.** The biggest unknown; W3 and W7 exist to find out early.
  If per-city cost is unacceptable, scope (cities per country, LLM-answered attributes) is the
  lever, not new machinery.
- **A hidden two-level assumption.** If any v1 module branches on `country`/`city` once cities are
  real, the abstraction leaked and the fix is in that module — the plan should surface *which* one,
  loudly, rather than paper over it.
- **Coverage honesty under LLM-heavy sourcing.** More `low`-confidence figures means the
  coverage-by-confidence reporting (already built, `reqs.md` 5.7) carries more weight. The product
  promise is that a sparse or LLM-sourced city reads as such, never as a confident number.
- **Scope creep via the deferred-features list.** Six UI features (W6) are real work; each is small
  but together they can dominate. They should be sequenced behind the city level proper, not ahead
  of it.

## 7. What this draft deliberately does not do

It does not set phase durations, agent decomposition, or final attribute lists — those belong in
the post-arch rewrite. It does not revise `arch.md` (step 1 above). It does not touch v1 code or
the MVP's `devplan.md`. It is the **starting point for refinement**, and every number in it is
provisional by the same rule as every weight and threshold in this project.
