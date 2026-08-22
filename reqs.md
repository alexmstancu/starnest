# Requirements — Starnest

Version 1. Refined from `relocation-app-master-spec-v1.md` (Part 2), extended by a
clarification pass. Supersedes the spec's functional requirements.

**This document contains no MVP / post-MVP judgements.** Everything here is a requirement.
Scoping is a separate pass, to be done once this document is agreed.

---

## 1. Purpose and scope

A local, single-user web application that helps a couple decide where to live. It evaluates
candidate locations against a weighted, user-configurable criteria set, ranks them, compares
them head to head, and explains every number it displays.

| | |
|---|---|
| **Geography** | EU/EEA + United Kingdom + Switzerland |
| **Horizon** | Open-ended. The chosen place may be home for life. Any requirement framed around a fixed number of years is wrong. |
| **Household** | Two adults, both working in tech (engineering and product). **Children are in scope** — see §6.7. |
| **Home country** | Romania. Both are Romanian (EU) citizens. |
| **Deployment** | Runs locally in a browser. Single user, no authentication, no multi-tenancy. |

### 1.1 What the app is for

Turning an unmanageable question — *where should we live?* — into an inspectable one. The
app's value is not the ranking; it is that every figure behind the ranking can be traced to a
source, a date, and a method.

### 1.2 Romania's dual role

Romania is **both a candidate and the baseline**. It is screened and scored like any other
country, so "stay put" remains a measurable option rather than an assumption. It is
additionally the default comparison anchor: any criterion may display a delta against
Romania alongside its raw value.

---

## 2. Roles

**User** (day-to-day). Selects and deselects criteria from the existing catalog, adjusts
weights at both levels, sets elimination thresholds, nominates and approves candidates,
triggers runs, overrides filter verdicts, enters values manually, and reads results.

**Developer / administrator.** Adds criteria to the catalog, connects data sources, and edits
the bootstrap configuration — by editing config files and code directly.

**There is deliberately no admin interface.** Adding a criterion or a data source is a
developer action performed in config, not a user action performed in a screen. Do not build
one.

---

## 3. Ontology

The data model is a first-class design concern, not an implementation detail. It must remain
changeable: adding or removing a field, changing a criterion's type, or swapping how a
criterion is evaluated must be a configuration change, not a rewrite. `arch.md` decides how
these entities are modelled and stored; `devplan.md` must keep them extensible.

### 3.1 Candidate

A place under evaluation. **`Candidate` is the entity name** — the spec's word "Target" is
retired, because it also named a role in comparisons. Comparison roles are **focus** and
**comparators** (§7.8).

| Field | Notes |
|---|---|
| `level` | `country` \| `city`. **Exactly two levels.** No third tier. |
| `parent` | For cities, the country Candidate. Null for countries. |
| `nomination_source` | Which mechanism proposed it — `config_seed` \| `llm_proposal` \| `manual` \| `population_rank` |
| `approval_state` | `proposed` \| `approved` \| `rejected`. LLM proposals begin as `proposed`. |
| `bypassed_phase_1` | True when a city was added despite its country not qualifying (§5.4) |
| `status` | Derived: `qualified` \| `eliminated` \| `insufficient_data` |
| `profile` | Factual attributes — §3.2 |

"City" means any locality regardless of size — a village of 4,000 is as valid a Candidate as
a capital.

### 3.2 CandidateProfile

Factual, descriptive attributes. **Never scored.** They exist to make a row legible and to
provide context when reading a score. They may, however, be referenced by a criterion as its
value source, so a fact is stored once rather than fetched twice (§3.3, `value_source`).

Each attribute carries provenance on the same terms as any other value (§3.6), but its
resolution is simpler: an attribute normally has one authoritative source rather than
competing ones.

**Country attributes:** official name; ISO 3166 alpha-2 and alpha-3; population; area;
capital; official language(s); currency; timezone(s); EU / EEA / Schengen / eurozone
membership; administrative subdivision scheme; climate zones present.

**City attributes:** name and common alternates; administrative parent chain (region,
province, department); population, city proper and metropolitan; area; elevation minimum,
maximum and mean; coordinates; timezone; coastal or landlocked; **subdivisions** — count and
names, e.g. Paris's 20 arrondissements; nearest major airport and distance to it.

**Subdivisions are descriptive only.** They are listed as facts about a city and are never
scored, ranked, or evaluated separately. Where safety or cost varies sharply between
districts, that belongs in the notes on the relevant criterion, not in a third Candidate tier.

### 3.3 CriterionGroup and Criterion

**Criteria are exactly two levels deep.** Groups carry weights summing to 100% within a
phase; criteria carry sub-weights summing to 100% within their group. The user may adjust
both levels.

**CriterionGroup:** identifier, display name, phase, weight, description.

**Criterion:**

| Field | Notes |
|---|---|
| `group` | Its parent group |
| `phase` | `1` (country) or `2` (city) |
| `weight` | Sub-weight within its group |
| `type` | `numeric` \| `number_list` \| `label_list` \| `boolean` \| `text` |
| `direction` | `lower_is_better` \| `higher_is_better` \| `ideal_band` |
| `ideal` | For `ideal_band`: the target range and falloff shape |
| `scale` | `fixed` (default) \| `percentile` \| `passthrough` |
| `scale_params` | For `fixed`: the anchor values, e.g. 500 EUR → 10, 2500 EUR → 0 |
| `threshold` | Elimination threshold. Semantics depend on `type` — §5.2 |
| `required` | If true, a missing value makes the Candidate unscoreable — §5.3 |
| `max_age` | How quickly this criterion's data goes stale — §3.6 |
| `source_priority` | Optional override of the global source order |
| `value_source` | Optional: a `CandidateProfile` attribute this criterion reads instead of being fetched |
| `unit` | Where applicable |

Criteria that describe the same concept at different levels are **separate criteria** with
separate identifiers, sources and scales. `safety_national` and `safety_local` are unrelated
records; the spec treats them as different questions, not one question at two zoom levels.

### 3.4 WeightProfile

A named set of weights, selectable at any moment. One primitive serves two purposes:

- **Work-format scenarios** — `remote-only` versus `local-employment`. The difference decides
  whether a village is absurd or ideal, and it is not yet settled.
- **Per-person weights** — `alex`, `partner`. The two of you may value climate, career and
  family proximity differently, and seeing where the rankings diverge is itself informative.

Switching profiles **recalculates from stored data with no re-fetch** (§5.6). A profile
carries weights at both levels, plus its criterion selections and thresholds.

### 3.5 DataSource

Identifier, display name, `kind` (`structured` \| `llm` \| `manual`), and default priority
rank. Manual entry is a source like any other (§6.5).

### 3.6 Value

A single measurement of one criterion for one candidate from one source. **Values are never
overwritten and never discarded.**

| Field | Notes |
|---|---|
| `candidate`, `criterion`, `source` | What this measures and where it came from |
| `native_value` | Exactly as published, in the source's own unit and currency |
| `native_currency` | Where applicable |
| `converted_value` | EUR equivalent, used for scoring |
| `fx_rate`, `fx_rate_date` | The rate used and when it was quoted |
| `reference_date` | **What period the data describes** |
| `retrieval_date` | **When the app fetched it** |
| `confidence` | `absolute` \| `high` \| `medium` \| `low` — see §5.7. Derived, with a manual override retained alongside |
| `quote` | Supporting text or summary, where applicable |
| `citations` | Source URLs |
| `run` | The Run that produced it |

**The two dates are distinct and must never be merged, conflated, or displayed as one.**

**Resolution.** Where several sources hold a value for the same criterion and candidate, the
active one is chosen by the criterion's source priority, falling back to the global default.
If the highest-priority value is older than the criterion's `max_age`, the next source in
order is promoted automatically. **Every value from every source remains stored and
visible**; resolution only decides which is active.

### 3.7 EligibilityFilter

A named yes/no gate, distinct from a criterion threshold (§5.2).

Identifier, display name, phase, applicable candidates, `verdict` (`pass` \| `fail` \|
`unknown`), reason text, source and its two dates, and an optional override carrying its own
reason and date.

**Overrides are permitted and audited.** An overridden filter attaches a visible marker that
travels with the candidate everywhere it appears.

### 3.8 Run

A persisted record of one acquisition pass.

Timestamp, phase, scope (which candidates, which criteria), LLM call count, cost, and
per-candidate failures with their errors. Values link back to the Run that produced them,
which is what makes selective retry (§6.4) and score-over-time comparison possible.

---

## 4. Two-phase evaluation

**Phase 1 — country.** Cheap screening across all candidate countries using structured
sources. Countries below the qualification threshold do not have cities extracted.

**Phase 2 — city.** Detailed evaluation of cities within qualified countries, using
structured and LLM-assisted sources.

Both phases run on the same machinery. Scoring, filtering, resolution and comparison are
written once against `Candidate` and must not be duplicated per phase. What differs is the
**data**: each phase has its own criteria catalog and its own weights, each summing to 100%
independently of the other.

**A city's score never inherits arithmetic from its country's score.** The country score
appears alongside the city for context — so a strong city in a weak country is visible — but
is never added into the city total. National factors are already represented by Phase 2's own
criteria; adding the country score would count them twice.

---

## 5. Scoring

### 5.1 Normalisation

Criteria arrive in incompatible units — EUR per month, degrees, hours, indices, 1–10 scores.
Each criterion declares **its own** scaling method in configuration:

- **`fixed`** (default) — anchor values map to the score range, linearly between. A
  candidate's score for that criterion is **stable**: it does not change when another
  candidate is added or removed.
- **`percentile`** — rank within the current candidate set. For criteria where only relative
  standing is meaningful.
- **`passthrough`** — the value is already on the score scale.

Each criterion also declares **which way is good**: `lower_is_better`, `higher_is_better`, or
`ideal_band` with a target range and falloff, for cases like temperature where both extremes
are worse than the middle.

**Score scale: 0–10, one decimal, configurable.** Criterion scores and total scores share one
range.

### 5.2 Thresholds and filters — two mechanisms, one report

**Criterion thresholds** are a property of a criterion. Semantics follow the criterion's type:

| Type | Threshold semantics |
|---|---|
| `numeric` | An acceptable range `[X, Y]` |
| `number_list` | Applied to a declared aggregate of the series |
| `label_list` | Must contain / must not contain given values |
| `boolean` | Must equal |

**EligibilityFilters** (§3.7) are named gates that are not properties of any criterion — visa
pathways, quota availability, relocation timing. They carry judgement rather than
measurement, and are typically sourced manually or with LLM assistance.

Both mechanisms eliminate, and **both feed a single "why was this eliminated" surface**, so
the user never has to look in two places to learn why a candidate is out.

### 5.3 Missing data

**Never fabricate a score from missing data.**

When a criterion has no value, its weight is **redistributed proportionally** across the
criteria that do have values, and the candidate displays a **coverage percentage** — the
share of active weight actually backed by data. Small, sparsely-documented localities are not
penalised for being under-documented; the uncertainty is disclosed rather than converted into
a low score.

Two independent floors mark a candidate **insufficient data** rather than producing a total:

- **`min_coverage`** — a configurable percentage of active weight that must be backed by data.
- **`required` criteria** — any criterion may be flagged required; a missing value on one
  makes the candidate unscoreable regardless of overall coverage.

Redistribution is computed at scoring time from what data exists. **It must never be written
back into the stored weights.**

### 5.4 Elimination visibility

Eliminated candidates **remain visible**, with the reason for elimination shown, and
**retain their computed score**, displayed greyed out. A candidate that would have ranked
first but failed a single visa gate is worth seeing as exactly that — it tells you what a
rule is costing you.

A city may be added and evaluated even though its country failed Phase 1 or was never
screened. Such a candidate is marked as having **bypassed** the country gate.

### 5.5 Currency

Values are stored **native and converted**. The published figure is retained exactly as
issued; a EUR equivalent is stored alongside it with the rate used and the rate's date.
Scoring uses the converted value. Both are displayed, and the original remains auditable
against its source.

### 5.6 Acquisition and scoring are separate

**Adjusting a weight, threshold, criterion selection or profile recalculates instantly from
stored data.** Score recalculation must never trigger a fetch. Re-fetching is always explicit
(§6).

---

### 5.7 Per-value confidence

Every stored value carries a **confidence** level, distinct from coverage. Coverage says *how
much* of the active weight is backed by data; confidence says *what that data is worth*. A
candidate can reach 100% coverage entirely on extrapolation, and coverage alone would not
show it.

| Level | Meaning | Typical origin |
|---|---|---|
| `absolute` | Definitionally true, not a measurement | ISO codes, coordinates, timezone, area |
| `high` | Official statistic, directly measured, within `max_age` | Eurostat, World Bank, OECD, WHO, UNODC, Open-Meteo |
| `medium` | A real measurement, degraded — stale, a proxy, coarser geography, or crowdsourced | Past-`max_age` official data; a regional average applied to a town; Numbeo |
| `low` | Inferred rather than measured | LLM extrapolation, derivation from a related figure, rough manual estimate |

Most `CandidateProfile` attributes are `absolute`; almost no `Value` ever is — the best a
measurement achieves is `high`.

**Confidence is derived, not typed.** It is computed from the source's reliability tier, then
downgraded for age beyond `max_age`, for geography coarser than the candidate, and for values
derived rather than directly reported. A manual override may be recorded and is **retained
alongside** the derived value, like every other competing value in the system.

**What confidence affects:**

- **Display.** Shown beside every figure, and summarised per candidate — "64% coverage, of
  which 20% high, 55% medium, 25% low".
- **Source priority.** Higher confidence wins ties in the resolution order (§6.6), extending
  the existing `max_age` promotion rule.

**What it must not affect:** the score arithmetic. Low-confidence values are **not** discounted
or shrunk toward the mean. Uncertainty is disclosed, never absorbed into the number — the same
principle as §5.3.

---

## 6. Data acquisition

### 6.1 Candidate nomination

Four mechanisms, all active simultaneously:

- **Config seed list** — candidates as data, per country. How deliberate picks such as Cassis
  or Annecy enter.
- **LLM proposal** — for a qualified country, propose localities matching the household
  profile. Proposals enter as `proposed` and require approval.
- **Manual add** — type a name; it enters immediately as `approved`.
- **Top N by population** — automatic from a population dataset.

The country list auto-seeds from the geographic scope (all EU/EEA + UK + CH) and is prunable;
exclusions are stored as configuration, not as deletions.

### 6.2 Triggering a fetch

Fetching is explicit and scoped — by phase, by candidate, by criterion, or any combination.
Nothing re-fetches automatically as a side effect of any other action.

### 6.3 Cost control

Before a run, display the **planned call count and an estimated cost**, and require
confirmation. During a run, halt at a **configurable budget cap**, retaining everything
completed so far.

### 6.4 Partial failure

A run **continues past failures**. Per-candidate errors attach to the Run record, and a
single action retries **only what failed**. Sparse coverage for small localities makes routine
failure normal; aborting a whole run on one bad response is not viable.

### 6.5 Manual entry

Manual entry is a **first-class source**. Any criterion value or filter verdict may be typed,
carrying source, reference date, retrieval date and a free-text note, and ranked in the
priority order like any other source — so an early estimate can later be superseded by a real
dataset without being deleted.

This is how the UK Skilled Worker pathway, the Swiss EU/EFTA quota and the relocation-timing
judgement acquire their values; no fetcher exists for them.

### 6.6 Source priority

A **global default priority order** applies everywhere. **Any criterion may override it** — a
national statistics office should outrank Numbeo on income tax, while Numbeo should outrank
it on rent.

Each criterion declares a **`max_age`**. Past that age, the next source in priority order is
promoted automatically. Rent ages in months; a climate zone ages in decades.

### 6.7 Children in scope

The master spec never mentions children; this document does. Their presence adds the criteria
in group CG (§7.7) — paediatric healthcare, schooling options and language of instruction,
childcare cost and availability — and shifts the weight of several existing criteria.

---

## 7. Criteria catalog

Two independent catalogs. **All weights below are provisional**, to be revised after a first
real run, per the spec's own note. `scale_params` and `threshold` values are deliberately
left `TBD`: they can only be set sensibly once real data has been seen.

### 7.1 Phase 1 — country

Groups sum to 100%. Criterion weights sum to 100% within each group.

#### FA. General economics — 24%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `cost_of_living_index_country` | 40% | numeric, lower better | WhereNext, Numbeo |
| `income_tax_effective` | 35% | numeric %, lower better | National tax authority, OECD, Eurostat |
| `remote_work_tax_treaty` | 25% | label_list, must contain RO treaty | OECD treaty database, national, manual |

#### FB. Tech market — 19%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `tech_employment_share` | 50% | numeric, higher better | Eurostat, national statistics |
| `international_employer_presence` | 50% | numeric, higher better | LLM + search, company registries |

#### FC. Safety and stability — 19%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `crime_safety_index_national` | 50% | numeric, higher better | Numbeo, Eurostat crime statistics |
| `political_economic_stability` | 50% | numeric, higher better | World Bank Governance Indicators, EIU |

#### FD. Healthcare and bureaucracy — 14%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `healthcare_system_quality` | 60% | numeric, higher better | WHO Global Health Observatory, OECD Health Statistics, Numbeo |
| `residency_admin_ease` | 40% | numeric, higher better | LLM + search, manual |

#### FE. Climate and environment — 10%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `climate_zone` | 30% | label_list | Köppen classification |
| `avg_annual_temperature` | 25% | numeric, **ideal_band** | Copernicus, national meteorological services |
| `annual_sunshine_hours` | 25% | numeric, higher better | Copernicus, national meteorological services |
| `climate_trajectory_national` | 20% | numeric, lower risk better | Copernicus, IPCC regional projections |

#### FF. Long-term settlement — 9% *(new — open-ended horizon)*

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `naturalisation_pathway` | 50% | numeric years, lower better; plus dual-citizenship permitted | National law, LLM + search, manual |
| `pension_portability` | 50% | numeric, higher better | EU social-security coordination rules, manual |

#### FG. Social openness — 5% *(moved from Phase 2)*

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `openness_to_foreigners` | 100% | numeric, higher better | MIPEX, Eurobarometer immigration attitudes, InterNations Ease of Settling In |

> Moved here from Phase 2's CE group. Every source that measures attitudes to foreigners —
> MIPEX, Eurobarometer, InterNations — is **country-level only**. Keeping it as a city
> criterion would have meant a constant repeated across every city in a country, adding
> nothing to the city ranking while implying a granularity the data does not have.

### 7.2 Phase 2 — city

#### CA. Career and work — 20%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `local_tech_market` | 60% | numeric 1–10, higher better | LLM + search, LinkedIn, national statistics |
| `major_employer_presence` | 20% | boolean / numeric, higher better | LLM + search, company sites |
| `product_role_availability` | 20% | numeric, higher better | LLM + search, job boards |

> Under a `remote-only` weight profile this whole group is down-weighted and CD's internet
> criterion up-weighted. That is what profiles are for — no separate "remote suitability"
> criterion is needed.

#### CB. Local economics — 20%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `cost_of_living_2p_monthly` | 40% | numeric EUR/month, lower better | Numbeo, LLM + search |
| `rent_2br_city_centre` | 35% | numeric EUR/month, lower better | Numbeo, local listings, LLM |
| `property_purchase_price_m2` | 25% | numeric EUR/m², lower better *(new)* | Numbeo, national land registries |

#### CC. Local quality of life — 18%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `safety_local` | 28% | numeric, higher better | Numbeo city index, local police statistics |
| `healthcare_access_local` | 24% | numeric, higher better | Distance to hospital, national health registries |
| `air_quality` | 24% | numeric PM2.5, lower better | European Environment Agency, WAQI |
| `local_climate` | 24% | numeric, **ideal_band** + sunshine | Copernicus, meteorological services |

#### CD. Infrastructure and connectivity — 14%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `internet_quality` | 30% | numeric Mbps, higher better | Ookla, M-Lab |
| `public_transport` | 25% | numeric, higher better | Numbeo, local transit authorities |
| `flights_to_romania` | 25% | numeric, higher better | Flight APIs, manual |
| `proximity_to_hub` | 20% | numeric km, lower better | `profile.nearest_airport`, geodata |

#### CE. Culture, community and lifestyle — 15%

Decomposed by **which source type answers the criterion**, not by whether the topic feels
subjective. Most of this group is countable.

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `heritage_and_culture_density` | 33% | numeric, higher better | UNESCO World Heritage list, national monument registers, OpenStreetMap museum and cinema counts |
| `landscape_access` | 27% | numeric, higher better | Protected-area registries (WDPA), coastline and elevation from `profile` |
| `english_proficiency` | 20% | numeric, higher better | EF English Proficiency Index *(country value applied to city)* |
| `expat_community_size` | 20% | numeric, higher better | Eurostat Urban Audit foreign-born population, national statistics |

> **`local_openness_to_foreigners` has moved to Phase 1 as `openness_to_foreigners`** (§7.1,
> group FG) — all of its sources are country-level. It remains distinct from
> `expat_community_size`: a large expat bubble can coexist with a closed local population. The
> first measures the locals, the second the incomers.
>
> **`general_atmosphere`** — irreducibly prose, no countable proxy. Deferred: see §9.

#### CF. Local bureaucracy — 5%

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `local_admin_ease` | 100% | numeric, higher better | LLM + search, manual |

#### CG. Family and schooling — 8% *(new — children in scope)*

| Criterion | Weight | Type / direction | Likely sources |
|---|---|---|---|
| `schooling_options` | 40% | numeric, higher better | National education registries, international-school directories |
| `paediatric_healthcare_access` | 30% | numeric, higher better | National health registries, LLM + search |
| `childcare_cost_availability` | 30% | numeric, lower cost better | Numbeo, national statistics |

---

## 8. User interface

**Four tabs plus a persistent sidebar.** The sidebar carries controls that are relevant
everywhere; each tab owns one stage of the workflow and nests its detail views inside.

### 8.1 Sidebar — always visible

- Application display name, read from configuration (§10)
- **Active weight profile** selector
- **Phase toggle** — country (1) or city (2)
- Candidate counts: total, qualified, eliminated, insufficient data
- Last run summary and a link to run history

### 8.2 Tab 1 — Configure

- **Criteria and weights.** The two-level tree, with sliders at both levels and a live
  indicator that each level sums to 100%. Criteria can be included or excluded from scoring.
- **Weight profiles.** Create, duplicate, rename, switch. Compare two profiles' rankings side
  by side, highlighting where they diverge most.
- **Thresholds and eligibility filters.** Per-criterion thresholds, typed by criterion type;
  named filters with their verdicts, sources and overrides.
- **Source priority.** The global default order, plus per-criterion overrides and `max_age`.
- **Candidates.** The seed list, the LLM proposal approval queue, manual add, and pruning of
  auto-seeded countries.
- **Settings.** Score scale, `min_coverage`, comparator limit, budget cap.

### 8.3 Tab 2 — Run

- **Scope selector** — phase, which candidates, which criteria.
- **Dry-run estimate** — planned call count and cost range, with explicit confirmation.
- **Budget cap** for this run.
- **Live progress**, per candidate and per criterion.
- **Failures** with their errors and a one-click retry of only the failed items.
- **Run history** — every persisted Run with its cost, scope and outcome.

### 8.4 Tab 3 — Rank

The main results view.

- **Ranking table** — candidates by total score, with coverage percentage and status. When
  viewing cities, the country's Phase 1 score appears as a context column. A Δ-vs-Romania
  column is available on any criterion.
- **Eliminated section** — always present, never hidden. Greyed rows showing the retained
  score, the elimination reason, and any override marker.
- **Criterion drill-down** — select one criterion and see every candidate on it alone: raw
  value, active source, reference date, retrieval date.
- **Candidate detail** — the factual profile (§3.2), then every criterion with its full
  provenance, showing **all** stored source values rather than only the active one, plus
  filter verdicts and any overrides.

### 8.5 Tab 4 — Compare

- One **focus** candidate plus up to N **comparators**, all at the same level. Levels are
  never mixed within a comparison.
- **Aggregate score delta** against each comparator, shown above the detail.
- **Per-criterion table** — raw value of focus, raw value of each comparator, signed delta,
  and the **weighted contribution** of that delta.
- **Synthesis** — top three advantages and disadvantages per pair, derived from weighted
  contribution rather than raw delta, and **templated from the numbers** rather than
  LLM-written: deterministic, instant, and identical on every reopen.
- Comparisons are **always live** — changing a weight updates them immediately.

**The comparator limit is 5 by default and must be configurable**, never hardcoded.

---

## 9. Open items

- **How prose-bound qualitative criteria become numbers.** Deferred by decision, to be
  discussed separately. Applies to `general_atmosphere` and any other criterion with no
  countable proxy. The options are: an LLM-emitted 1–10 score; an LLM proposal the user may
  override, retaining both; or prose with a manually assigned score. Related: whether such
  criteria are worth carrying at all.
- **Provisional values**, all to be revised after a first real run: every weight in §7, the
  Phase 1 qualification threshold, the ~2000–3000 EUR/month household budget guideline, the
  2000 EUR rent ceiling, `min_coverage`, and every `scale_params` and `threshold` marked TBD.
- **Which criteria are `required`** (§5.3) — not yet assigned.
- **MVP scope.** Not addressed anywhere in this document, by design.

---

## 10. Cross-cutting constraints

- **Nothing hardcoded.** The criteria catalog, groups, weights, thresholds, scale parameters,
  source priorities, candidate seed lists and inclusion rules all live in data loaded at
  startup. Adding a criterion is a data change, not a logic change. No literal criterion name
  or weight appears in application code.
- **Acquisition and scoring are separate operations** (§5.6).
- **Raw values are stored separately from computed scores**, with timestamps.
- **Resolution never discards data** (§3.6).
- **Two distinct dates per value**, never conflated (§3.6).
- **Full provenance on every displayed number** — source, reference date, retrieval date, and
  a quote or summary where applicable.
- **All code, identifiers, comments and UI text are in English.**
- **The application name lives in configuration** as a single display parameter used only for
  presentation. It must never appear in package, module, class, table or config-key names.

---

## Appendix — decision log

Answers from the clarification pass, with rationale. Recorded so future readers see *why*,
not only *what*.

| # | Decision | Rationale |
|---|---|---|
| Q1 | Two-level criteria | Preserves the spec's group weights exactly while keeping each bullet independently sourced and provenance-tracked |
| Q2 | Exactly two levels | Implied by Q1; no deeper nesting in the model |
| Q3 | Cross-phase concepts are separate criteria | The spec frames local safety as a different question from national safety, not the same one zoomed in |
| Q4 | Direction per criterion, either mode | A single direction cannot express "warm but not too hot" |
| Q5 | Normalisation per criterion, in config | Fixed bands keep a score stable over time; percentile suits criteria where only relative standing matters |
| Q6 | Redistribute weight, show coverage | Zero-filling would bury exactly the small, under-documented towns that are wanted candidates |
| Q7 | Coverage floor *and* `required` flags | They catch different failures: general sparsity versus a specific essential unknown |
| Q8 | Scale 0–10, one decimal | Criterion inputs and totals share one range |
| Q9 | Country score displayed, never added | National factors already appear in Phase 2 criteria; adding them again double-counts |
| Q10 | Filters and thresholds are two mechanisms, one report | Filters carry judgement, verdicts, sources and overrides that a threshold does not |
| Q11+Q19 | Manual entry is a first-class source | Visa pathways and quotas have no fetcher; an early estimate must be supersedable, not deleted |
| Q12 | Overrides permitted, audited | A manual judgement may later be revised; layering a decision beats rewriting the record |
| Q13 | Eliminated candidates keep their score | Shows what a gate is costing you |
| Q14 | Country list auto-seeded, prunable | Exclusions are configuration, not deletion |
| Q15 | All four nomination mechanisms | Population ranking alone cannot reach a village of 7,000 |
| Q16 | Phase 1 can be bypassed | Supports investigating somewhere you just heard about |
| Q17 | Source priority per criterion | Different sources are authoritative for different kinds of data |
| Q18 | Per-criterion `max_age` | Rent ages in months, climate zones in decades |
| Q20 | **Deferred** | See §9 |
| Q21 | Runs are persisted objects | Gives cost, failures and retry somewhere to live, and enables score-over-time |
| Q22 | Dry-run estimate plus budget cap | The estimate catches mistakes before they cost; the cap catches what the estimate got wrong |
| Q23 | Continue, record, retry selectively | Sparse coverage makes routine failure normal |
| Q24 | Templated synthesis | Content is fully determined by the arithmetic; an LLM would only rephrase it, at cost and non-deterministically |
| Q25 | Comparisons always live | Matches the confirmed live-recalculation requirement |
| Q26+Q27 | Named weight profiles, one primitive for both uses | Work-format scenarios and per-person weights are the same object |
| Q28 | Six long-horizon criteria added | The horizon is open-ended; children are in scope |
| Q29 | Native and converted values stored | The published figure must stay auditable against its source |
| Q30 | Romania is baseline and candidate | Staying put is a real option and deserves measuring |
| Q31 | Factual attributes on the Candidate, referenceable | Stored once; scoring city size later needs no second fetch |
| Q32 | Subdivisions descriptive only | A third tier would break the two-phase architecture |
| Q33 | Catalog at name/type/direction/source/weight detail | Scale bands and thresholds can only be set sensibly after real data |
| Q34 | Four tabs plus sidebar | Preserves the spec's shape; newer surfaces nest inside |
| Q35 | Per-value confidence: display and source priority only | Coverage says how much data exists; confidence says what it is worth. Discounting the score would absorb uncertainty rather than disclose it |
| Q36 | Confidence derived from source, age and geography, with override | Reuses `max_age` and `DataSource.kind`; no field anyone must remember to fill |
| Q37 | `openness_to_foreigners` moved to Phase 1 | MIPEX, Eurobarometer and InterNations are country-level only |
| Q38 | Numbeo scraped first, API later if warranted | Personal, non-commercial use; `robots.txt` restricts only `/heavy_crawling.any`. Its coverage floor is ~150k population either way, so paying buys the same gap |
| — | `Candidate` replaces `Target` | "Target" also named a role in comparisons; the entity and the role needed separating |
