# Relocation App — Master Specification (draft v1)

Alex + Partner, Romanian (EU) citizens, 3-5 year relocation horizon. This document combines the three planning layers into one: what to evaluate (protocol), what the app does (functional requirements), and how it's built (technical specification).

**Contents**
1. Evaluation Protocol
2. Functional Requirements
3. Technical Specification

**Project-wide conventions**
- **Language:** all code, UI text, comments, and variable/function names must be in English — regardless of the language used in planning conversations.
- **Working name:** no final app name has been chosen yet (naming discussion ongoing). Use `relocation-app` as a placeholder for the repo/package name — trivially renameable later, not a blocker for starting development.

---
---

## Part 1 — Evaluation Protocol

**Context:** Alex + Partner, Romanian (EU) citizens, 3-5 year horizon, work format not yet decided.
**Geographic scope:** EU/EEA + UK + Switzerland.

**Note on granularity:** "city" in this document is used generically for any type of candidate locality — including modern towns/villages, small in population but wealthy and civilized, away from the hustle of major cities (e.g. Cassis, Saint-Tropez). It is not limited to large cities or capitals.

### 1. Hard filters (eligibility — yes/no, not weighted)

A candidate (country or city) that fails a hard filter is automatically eliminated, regardless of score.

| # | Filter | Phase | Threshold |
|---|--------|------|------|
| 1.1 | Legal residency & work status — EU/EEA | Country | Automatic pass (free movement) |
| 1.2 | Legal residency & work status — UK | Country | Requires a realistic path to a Skilled Worker visa (employer sponsorship available in the local market, or salary threshold met) |
| 1.3 | Legal residency & work status — Switzerland | Country | Check annual EU/EFTA quota availability for your profile |
| 1.4 | Feasibility for the couple | City | Local tech market large enough for 2 tech roles (engineering + product) — Partner works in the same field, so this isn't a separate domain filter |
| 1.5 | Time window | Both | Relocation feasible within ~12-18 months, no major blockers (contracts, long-lead visas) |

**Note:** filters 1.1-1.3 are evaluated in Phase 1 (eliminate entire countries from the start). Filter 1.4 is evaluated only in Phase 2, on cities within the remaining countries — a solid national tech market (Phase 1) doesn't guarantee that a specific small city has enough available roles.

### 2. Phase 1 — Country-level criteria

**Purpose:** fast, cheap screening (no LLM calls) across all ~30 candidate countries, to narrow the list before investing effort on individual cities. Data from structured sources (WhereNext, Eurostat, public indices).

Weights sum to 100% within this phase.

#### FA. General economics — 30%
- General cost of living index, at country level (comparative)
- Personal income tax, compared to Romania
- Remote work taxation / existence of a double-taxation treaty with Romania

#### FB. Tech market — 25%
- General size of the tech industry at country level (number of companies, known hubs, presence of international employers)

#### FC. Safety & stability — 20%
- National crime/safety index
- Political/economic stability over a 3-5 year horizon

#### FD. Healthcare & bureaucracy — 15%
- General quality of the healthcare system (public/private)
- General ease of obtaining residency, opening a bank account (national rules)

#### FE. General climate — 10%
- Climate zone, average annual temperature, approximate sunshine hours (relevant for photography)

**Phase 1 result:** a score + a minimum qualification threshold (to be set after the first test) — countries below the threshold don't get cities extracted in Phase 2.

### 3. Phase 2 — City-level criteria

**Purpose:** detailed evaluation, only on cities within countries that qualified in Phase 1 (~5 cities per remaining country). This is where the qualitative part (search + LLM) comes in.

Weights sum to 100% within this phase — independent of Phase 1 weights.

#### CA. Career & work — 25%
- Concrete local tech market, engineering + product (covers both your role and your partner's) — score 1-10
- Presence of a Microsoft/Azure office locally — bonus, not required
- Availability of Product Management roles specifically — sub-note, may be more limited in secondary hubs

**Note on small cities:** for modern towns/villages like Cassis, the local tech market is practically 0 — the remote work scenario (already legally verified in Phase 1) becomes near-mandatory, not just an option. For these candidates, this criterion effectively weighs as "is there infrastructure/quiet for remote work", not as an actual job market.

#### CB. Local economics — 20%
- Total local cost of living for 2 people vs. estimated net income — soft guideline threshold: **max. 2000-3000 EUR/month total household spend**
- Cost of a 2-bedroom apartment rental — maximum threshold: **under 2000 EUR/month**, treated as a warning signal (not just an isolated threshold) if it approaches the total budget

#### CC. Local quality of life — 20%
- Local safety (specific neighborhood/city, not just the Phase 1 national average)
- Access & quality of healthcare locally (distance to hospital, if the city is small)
- Micro-local climate — specific sunshine hours, not just the general climate zone
- Local air pollution

#### CD. Infrastructure & connectivity — 15%
- Internet — speed, reliability (relevant for remote work)
- Public transport — living without a car
- Flight connections to Romania — frequency, price, duration (from the nearest airport)
- Proximity to a larger hub — especially relevant for small cities

#### CE. Culture & lifestyle (subjective — search + LLM extraction) — 15%
- General atmosphere, city center/neighborhoods
- Access to photography-worthy landscapes
- Culture/film/history scene
- Ease of social integration for the couple, expat community

#### CF. Local bureaucracy — 5%
- Practical ease at the local level (not just the national rule from Phase 1) — queues, service availability, day-to-day local bureaucracy

### 4. Comparison function (target vs. up to 5 comparators)

Mechanism separate from the weighted ranking — useful for fine-grained decisions between finalists, not just sorting.

**Input:** 1 target candidate + up to 5 comparators, all from the same phase (either all countries, or all cities — levels are not mixed within a single comparison).

**Output, per criterion in the relevant phase:**
- Raw value of the target (e.g. 1850 EUR rent)
- Raw value of each comparator
- Delta (target − comparator), signed — explicitly shows what you gain and what you lose relative to each alternative
- Weighted contribution of the delta (delta × criterion weight) — separates criteria with a large difference but small weight from criteria with a small difference but large weight, so a visually large difference on an insignificant criterion doesn't mislead

**Automatic synthesis:** alongside the full table, a narrative summary per target-comparator pair — top 3 advantages and top 3 disadvantages, calculated from the weighted contribution, not the raw delta.

**Aggregate score:** total weighted score difference between the target and each comparator, displayed above the detailed table as a quick reference.

### 5. Open notes

- The weights above (both phases) are provisional — to be revised after the first manual test
- Filter 1.2/1.3 (UK/Switzerland) requires targeted research per country, can't be generic
- The minimum qualification threshold from Phase 1 (how many countries move forward) — to be set once we see the score distribution from the first tests
- The 2000-3000 EUR/month budget is a guideline, not fixed — will be adjusted after the first cities tested
- For small cities (modern towns/villages), structured sources (Numbeo, WhereNext) have weak or non-existent coverage — search+LLM becomes the *primary* source, not just a fallback, for most Phase 2 criteria for this type of candidate

### 6. Next steps (protocol)

1. Set the minimum qualification threshold for Phase 1
2. Refine weights on both phases, if needed
3. Pick 2-3 countries + 2-3 cities each for a complete manual test (both phases, no code yet)
4. Manually test the comparison function on the test results
5. Move into Claude Code for the actual pipeline

---
---

## Part 2 — Functional Requirements

Business/functionality — what the app does, not how it's built technically.

### 1. Criteria management

**Two distinct roles:**
- **User** (Alex/Partner, using the app day to day) — selects/deselects criteria from the already available set, adjusts weights, sets elimination thresholds. Does not add new criteria and does not connect new data sources — that's not a user action, at least in the MVP.
- **Developer/Admin** (us, from code) — adds new criteria to the catalog, connects new data sources, edits the default criteria/weights bootstrap. Done directly from code/config, **not** through a dedicated admin interface — no time is spent building a separate admin UI.

**Design principle — nothing hardcoded:** the set of available criteria, default weights, default thresholds, and inclusion/exclusion rules must be defined as **data** (e.g. JSON, or database records), not written directly in code. The initial criteria+weights bootstrap loads from data at startup; it does not exist as hardcoded values in code. Adding a new criterion thus becomes a data change (made by us, from code/config), not a change to the application's logic.

**What the user can do from the UI:**
- include/exclude individual criteria from the score calculation (from the already defined set)
- adjust the weight of each criterion
- set **elimination thresholds** (hard filters), differentiated by criterion type:
  - **numeric** criteria — acceptable range [X, Y]
  - **attribute list** criteria (e.g. spoken languages, accepted visa types) — must contain / must not contain certain values

**Default:** all criteria in the catalog participate in the score, with default weights (loaded from data, not hardcoded).

### 2. Running the analysis

- "Running" = applying the current configuration (criteria + weights + thresholds) to a set of selected targets (countries or cities)
- **Important distinction:** data acquisition (fetch per criterion per target) and score calculation (applying weights/thresholds to already-existing data) are separate operations
  - The score recalculates instantly from already-stored data, with no re-fetch, on any weight/threshold adjustment
  - Data re-fetching is triggered explicitly, per target and/or per criterion — not automatically on every run
- The same logic applies at both levels: running on countries (Phase 1) and running on cities (Phase 2, only within qualified countries)

### 3. Results view & drill-down

- Main view: all targets (generic term for country or city) × all active criteria, with the total score
- **Drill-down on a criterion:** from the general view, select a specific criterion and see all targets compared on just that criterion — raw value, source, date

### 4. Direct comparison

- 1 target + N comparators — default 5, but the limit must be extensible later, not hardcoded at 5
- Per criterion: raw value, delta vs. the target, weighted contribution of the delta
- Narrative synthesis: top advantages/disadvantages, calculated from the weighted contribution

### 5. Data model / ontology

The most important piece of the requirements — defines the structure everything else relies on.

#### Entities
- **Target** — Country or City (same base structure, different level)
- **Criterion** — a property/evaluation criterion
- **DataSource** — a data source (e.g. Eurostat, Numbeo, official national website, LLM+search call)

#### Data type per Criterion
Each criterion has a declared type, among:
- numeric (e.g. rent cost, average temperature)
- list of numbers (e.g. a series of values across multiple years)
- list of enum/label values (e.g. official languages, accepted visa types)
- other, as needed (free text with source, for qualitative criteria like "atmosphere")

#### Multi-source & conflict resolution
- The same property can exist in multiple sources at once, with different values (e.g. "average salary" from a national source + Eurostat + Numbeo)
- Resolution is based on a **source priority**, configurable by the user as the system administrator (e.g. national data > EU/Eurostat data > other sources like Numbeo)
- The score uses the value from the highest-priority source available for that criterion/target, but **all values from all sources remain stored and visible** — nothing is lost during resolution, only one becomes "active" for the score

#### Provenance — two distinct dates per stored value
- **Reference date of the information** — what point in time the data point itself refers to (e.g. "average salary for year 2025")
- **Retrieval date** — when it was extracted by the application (e.g. "retrieved from the EU website on August 16, 2026")
- These two dates must be clearly distinct and visible together, never combined/confused

### 6. Source transparency (confirmed)

For any score displayed on any target/criterion: the source, reference date, retrieval date, and a quote/summary where applicable.

### 7. Live weight adjustment (confirmed)

Changing a weight or a threshold recalculates the score and ranking instantly, from already-stored data — without a full re-run of data acquisition.

### 8. Post-MVP features

Don't block the MVP, but are noted for a later version:

- **Personal annotations** — your own notes on a target (personal impressions, whether you've already visited, etc.)
- **Color-gradient maps per property** — a map (e.g. Europe, or just the countries with available data) where each country/region is colored on a gradient based on the value of a chosen numeric criterion (e.g. average salary — more intense color = higher value, paler = lower value). Generatable for any numeric property in the catalog, not fixed to just one.
- **Favorites lists** — separate for countries and for cities; mark a target as a favorite
- **Criteria profiles** — save a named combination of chosen criteria + chosen weights (associated elimination thresholds too, presumably, to stay coherent — to confirm). A profile is a standalone, reusable object, usable in any ranking or comparison, not tied to a single target or a single comparison
- **Saved comparisons** — a target + up to 5 comparators + a reference to the criteria profile used, saved together under a name, so you can easily return to them

*(Favorites, profiles, and saved comparisons are assumed to also be post-MVP — confirm if you want them directly in the MVP.)*

### 9. Visibility on hard filters (confirmed)

Candidates eliminated by a hard filter remain explicitly visible, with the reason for elimination — not just the ones that made it through.

### Open / to clarify (functional requirements)

- The complete data source priority order — you define this, as the administrator; to be settled once we have concrete sources connected
- The extensible limit on comparators (beyond 5) — base mechanism at 5, extensibility to be designed, not necessarily implemented in the MVP
- Elimination thresholds within a criteria profile — assumed yes, part of the profile alongside criteria+weights, to confirm
- When you edit a criteria profile *after* it's been used in a saved comparison: the saved comparison stays "frozen" at the values from the time it was saved (it doesn't silently change if you modify the profile afterward), with an explicit option to re-run the comparison with the current version of the profile if you want fresh results — default recommendation, to confirm

---
---

## Part 3 — Technical Specification

### Goal
A local, self-contained application. Runs the entire pipeline (data acquisition, interpretation, scoring, sorting) with no manual intervention beyond configuring criteria and starting a run. Zero copy-paste between chat and the app.

### Proposed stack

| Component | Choice | Reason |
|---|---|---|
| Language | Python 3.12+ | Fast ecosystem for data + LLM SDK + UI, least effort for this type of tool |
| UI | Streamlit | Sliders for weights + sortable table, with minimal frontend code; runs locally, no deployment |
| Storage | SQLite | Local file, no server, sufficient at the scale of 15-40 cities |
| Subjective interpretation | Anthropic API + `web_search` tool | Removes the need for a custom scraper for qualitative criteria; structured JSON output with score + citations |
| Structured data | Direct fetch (WhereNext CSV, Numbeo, weather/flight APIs) | No LLM — cheaper, more reliable, deterministic |

**Why Python, not Go**: your background is Go (and now C#/.NET at Microsoft), but for this kind of tool — data scripting, LLM SDK integration, quick interactive UI — the Python ecosystem (Streamlit, pandas, requests) cuts effort significantly compared to Go, where a separate frontend would be needed for interactivity. Go or C#/.NET remains feasible if preferred, just with somewhat more code for the UI part.

### Modules

1. **`config/`** — criteria, weights, thresholds, split into Phase 1 (country) and Phase 2 (city); editable from the UI, persisted in SQLite
2. **`acquisition/structured.py`** — fetches quantifiable data (cost, climate, safety, connections) from direct sources, both at country and city level
3. **`acquisition/qualitative.py`** — calls the Claude API with `web_search`, prompting for structured JSON output (score 1-10 + summary + sources) for the subjective Phase 2 criteria
4. **`storage/db.py`** — SQLite schema: `countries`, `country_scores` (Phase 1), `cities`, `city_scores` (Phase 2, with source/evidence attached per score), `config`
5. **`scoring/engine.py`** — applies hard filters and calculates the weighted score, separately for Phase 1 (country) and Phase 2 (city)
6. **`scoring/compare.py`** — the target-vs-up-to-5-comparators comparison function: computes raw delta + weighted contribution per criterion, plus the narrative synthesis (top advantages/disadvantages)
7. **`ui/app.py`** — Streamlit with 4 tabs: criteria/weights configuration (both phases), pipeline run, ranking dashboard, direct comparison (select 1 target + up to 5 comparators)

### Data flow

**Phase 1:** configure country criteria in the UI → select the ~30 countries → run the screening (structured sources only, no LLM) → the scoring engine computes the country score → countries below the threshold are excluded from Phase 2

**Phase 2:** for qualified countries, extract ~5 cities each → run structured + qualitative acquisition (in parallel) → write to SQLite → scoring engine applies filters + computes the city score → dashboard updates with the ranking

**Comparison:** from the dashboard, select a target city (or country) + up to 5 comparators → `compare.py` generates the delta table + narrative synthesis, shown in a dedicated tab

### Setup requirement

The app needs its own Anthropic API key, generated from [console.anthropic.com](https://console.anthropic.com) — separate from the Claude.ai subscription, billed per usage (low cost at this scale: a few dozen calls per city, not millions).

### Scaling to ~100 cities

At 30 countries × 5 cities, three design decisions matter more than at 15-40 cities:

**1. Two-phase filtering, not uniform full evaluation.** Running the full criteria set (including the qualitative ones, with LLM calls) on all 100 cities directly wastes effort on cities that would fail a cheap hard filter anyway. Recommendation: a first fast pass at the *country* level (macro criteria only — general cost, safety, climate, tech market — no LLM, structured sources only) likely eliminates 15-20 clearly unsuitable countries from the start. Only for the remaining countries are the 5 cities each extracted and run through the full set, including the qualitative part. This realistically reduces the number of cities analyzed in depth from 100 to ~40-50, without losing any serious candidate.

**2. Uneven data coverage.** Small cities in less "documented" countries (the 3rd-5th largest by population in Slovakia, Latvia, Croatia, etc.) often have very sparse data on Numbeo or WhereNext. The pipeline needs to explicitly handle the "insufficient data" case — not compute a false score on missing data, but flag the city as such and, optionally, use the LLM call with `web_search` as a secondary fallback source, for quantifiable criteria too, not just the subjective ones.

**3. Caching and incremental runs.** At 100 cities, a full pipeline run takes longer and costs more — not something to re-run entirely every time a weight is adjusted. Raw data (scraping, API/LLM calls) must be stored separately from computed scores, with a timestamp; the scoring engine recalculates instantly from local cache, while data re-fetching is triggered explicitly, per city/criterion, not automatically on every run.

### Next steps (technical)

1. Confirm the stack (Python/Streamlit) or choose something else
2. Move into Claude Code with this document + the criteria protocol as the starting blueprint
3. Repo scaffolding + DB schema + first module (structured acquisition) as a sanity check before building the rest

---
---

## Appendix — Reference sources

External tools/datasets researched during planning, useful as starting points for `acquisition/structured.py`:

- **Numbeo** — https://www.numbeo.com/quality-of-life/comparison.jsp — crowdsourced cost of living, safety, healthcare, pollution; covers both countries and individual cities
- **WhereNext — Global Relocation Index** — https://getwherenext.com/data/global-relocation-index-2026 — 95 countries + ~130 cities, downloadable CSV/JSON, good fit for Phase 1 country-level screening
- **Teleport Cities** — https://teleport.org/top-cities/ — personalized weighted city scoring (conceptually closest to this app); status/maintenance level unverified, worth checking if still active before relying on it for data
- **Nomads.com** (formerly Nomad List) — https://nomads.com/digital-nomad-guide/split — community + data for digital nomads, filters on cost/safety/internet; subscription-based, city-level only

Not interactive tools, but useful as reference reports: Mercer Quality of Living, EIU Global Liveability (both largely paywalled/B2B), InterNations Expat Insider (annual survey, qualitative expat perspective).
