# Development plan — Starnest **v2.0 (the city level)** — DRAFT

> **Status: high-level draft, 2026-10-12. To be refined with Alex, then rewritten against a
> revised `arch.md`.** This is not yet a build plan. It is the first pass at *what* v2.0 is, *what
> is genuinely new* versus reused, and *which decisions must be made before* a real phase plan can
> be written. Numbers, phase boundaries and attribute counts here are provisional and will move.
>
> **v1.0 is the country-level MVP** (`docs/devplan.md`), functionally complete: four gates closed,
> 32 countries ranked from seventeen sources in a browser, coverage 95-98% per candidate. **v2.0 is
> the city level** — the bulk of what the MVP deliberately deferred (`reqs.md` 1.3, `devplan.md` 8).

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
| Roster | Seed the 79 cities of the EU Quality of Life survey; manual adds enter `approved`; LLM proposals wait as `proposed` |
| National factors | Read through the parent country, never copied |
| Cost of living | Derived from city rent and national non-housing price levels; no Numbeo |
| Country screen | Pruned by hand with `not_manually_excluded` |
| Survey answers | **Scored**, labelled in the drill-down as a resident survey with its year and sample size (safety, local administration, public transport) |
| Recorded crime | **Homicide scored** (NUTS 3); robbery, burglary and vehicle theft **displayed only**, with Eurostat's comparability caveat |
| City criteria sets | **Mirror both** country sets: a city `local_employment` and a city `remote_only` |
| Deferred UI features | **Moved to v2.1**: gradient maps, favourites, annotations, saved comparisons, `relocation_window`. v2.0 is the city level |

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

From `reqs.md` 1.3 and `devplan.md` 8 (each carries its own requirements; see those sources).
**Revised 2026-10-24:** gradient maps, favourites, personal annotations, saved comparisons and
`relocation_window` move to **v2.1**; nomination and the derived attributes stay, because the
city level needs them.

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

Provisional workstreams, to become real phases after the arch revision. **Re-ordered 2026-10-24
data-first**: the research showed that most city coverage comes from structured sources by
coordinate and by region, not from the LLM, so the LLM path stops being the backbone and the
reference geography takes its place.

### W0 — Prerequisite: v1 works
The open defects close first, notably the saved-ranking snapshot gaps (FU-A3, FU-A4) and the run
accounting (FU-A1, FU-A2, FU-A6). v2.0 builds on rankings that can be saved and trusted;
starting it over known shipped bugs repeats the mistake the household called unacceptable.

### W1 — City reference geography (the data foundation)
For every city, once, sourced and regenerable like `population_centre` (`0464`): its GeoNames
identity and coordinates; its Urban Audit city code where it has one; its NUTS 2 and NUTS 3
regions (point-in-polygon against GISCO boundaries); its QoL-survey city; its nearest airports
and nearest WMO station, **each with the distance**. Every adapter reads this; none geocodes on
its own. **Risk it tests:** a city that straddles a boundary, and a GeoNames place whose
municipality is not the Urban Audit city of the same name.

### W2 — The three ontology changes (design first, `arch.md` revision)
1. **Footprint in provenance**: a figure says whether it was measured at a point, the city, its
   region or its nation.
2. **A criterion that reads the parent's attribute** (decision B): how a city set weights
   `country.total_tax_rate_effective`, how coverage counts it, how the drill-down labels it.
3. **Derived attributes** (decision C): `city.cost_of_living_monthly` is the first, and
   `house_price_to_income_ratio` and the household-salary tax follow the same mechanism.
**Risk it tests:** whether these stay level-agnostic. A `city` branch in scoring is a design
failure.

### W3 — Sources, one tier at a time, each verified by fetching
- **Regional**: Eurostat NUTS 2/3 (unemployment, tech employment, income, life expectancy,
  recorded crime) through the existing Eurostat adapter; Copernicus heat days at NUTS 3.
- **City**: the QoL survey and Deloitte as transcribed published tables; Urban Audit as a
  supplement; Eurostat `avia_par_*` for flights home; national rent offices for the gaps.
- **Point**: Open-Meteo (existing), WMO normals (vendored), Ookla (vendored quarterly), air
  quality (CAMS or EEA), OpenStreetMap, and the offline geometry set (coast, terrain, WDPA,
  bathing water, night sky, land cover) -- the largest engineering item, and free.
Each adapter lands with its live coverage measured against the roster, as `make live` does today.

### W4 — The city catalog (rows)
The verdict table of the research note turned into migrations: attributes with pillar, value
type, footprint, sources and `max_age`; city pillar weights; the city criteria set(s); anchors
chosen against real figures (as Q209 did); `blocks_if_missing` only where a source covers the
whole roster (`reqs.md` 7.5's two conditions).

### W5 — Nomination (the new functionality)
Seed the 79; manual add by name (geocode, build the W1 reference row, enter `approved`); LLM
proposal (names only, `proposed`, approved or rejected by the household, as gate proposals are
under Q218); nomination only under countries that match. Backend lifecycle, API operations, a
nomination screen.

### W6 — The two-level pipeline, run for real
Country screen, nominate, acquire at city level, rank, drill down (showing each figure's
footprint), compare -- with `parent_not_matching` surfaced. Mostly integration and e2e if the
bet held.

### W7 — The LLM where it is permitted
`city.international_employers` (a `LabelSet`) and nomination proposals: the only city spend.
Estimated before it runs, capped, opt-in like `make live-llm`.

### W8 — (moved to v2.1, 2026-10-24)
Gradient maps, favourites, annotations, saved comparisons and `relocation_window` are v2.1. The
derived attributes stay in v2.0 because cost of living needs them (W2).

### W9 — Scale
Measure the read path with the full roster; decide caching on that measurement.

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

These block a real phase plan and are the agenda for refinement with Alex. **Status
2026-10-24:** 1 and 5 are decided (section 0.0); 2 is answered by the research note except
safety; 3 shrinks to the employer lists and proposals; 7 is decided for cost of living, its
mechanism still to design (W2). 4, 6 and 8 remain open.

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

- **The LLM path may not scale cheaply.** *Smaller since 2026-10-24*: it now answers only the
  employer lists and nomination proposals (W7). The larger data risks are a source that covers the
  roster by whole countries (Urban Audit, Deloitte) being scored as if it were complete, and a
  regional or national figure being read as the city's own, which is why footprint is in W2.
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
