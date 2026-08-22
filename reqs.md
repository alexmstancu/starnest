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
| **Household** | Two adults, both working in tech (engineering and product). **Children are in scope** — see §6.8. |
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

### 1.3 Scope of v1

**v1 covers the country level only, with the full feature set applied to it.** Everything in
this document is a requirement; this section says only what arrives first.

**In v1:** pillar and criterion configuration with weights at both levels · thresholds and
eligibility filters · weight profiles · country nomination and the EU seed list · structured
acquisition with runs, cost control and selective retry · scoring with per-criterion
normalisation, weight redistribution, coverage and confidence · elimination reporting ·
the ranking dashboard with per-criterion drill-down and full provenance · comparison of a
focus country against comparators · external scores displayed alongside.

**After v1:** the whole of the **city level** — cities, the city criteria catalog, city nomination,
and the LLM-plus-search acquisition path that city criteria depend on · prose-bound criteria
(§9) · and the spec's own post-MVP list: personal annotations, gradient maps, favourites,
saved criteria profiles, saved comparisons.

> The country level is the right first slice: it exercises nearly every load-bearing abstraction —
> `Candidate`, pillars and criteria as data, normalisation, redistribution, coverage,
> confidence, filters, provenance, comparison — while needing no city nomination and almost no
> LLM. The city level then adds *sources and rows*, not new machinery, which is the test of whether
> the design was right.

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
**comparators** (§8.5).

| Field | Notes |
|---|---|
| `level` | `country` \| `city`. **Exactly two levels.** No third tier. |
| `parent` | For cities, the country Candidate. Null for countries. |
| `nomination_source` | Which mechanism proposed it — `config_seed` \| `llm_proposal` \| `manual` \| `population_rank` |
| `approval_state` | `proposed` \| `approved` \| `rejected`. LLM proposals begin as `proposed`. |
| `bypassed_screening` | True when a city was added despite its country not qualifying (§5.4) |
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

**Natural setting (country):** bordering seas; coastline length; highest peak with name and
elevation; principal mountain ranges; major rivers; largest lakes; national parks — count and
names; biomes or ecoregions present.

**Natural setting (city):** nearest coast — sea name and distance; nearest mountain range —
name, distance, highest peak; nearest significant lake or river — name and distance; nearest
protected area — name, designation and distance; terrain character.

> These are **facts, not judgements**. "Calanques National Park, 2 km" belongs here; "nature
> access 8.7" belongs in §7. Same split as population versus cost of living.

**Subdivisions are descriptive only.** They are listed as facts about a city and are never
scored, ranked, or evaluated separately. Where safety or cost varies sharply between
districts, that belongs in the notes on the relevant criterion, not in a third Candidate tier.

### 3.3 Pillar and Criterion

**Criteria are exactly two levels deep.** Groups carry weights summing to 100% within a
level; criteria carry sub-weights summing to 100% within their pillar. The user may adjust
both levels.

**Pillar:** identifier, display name, level, weight, description.

> **Pillar**, not "pillar", "group" or "dimension". These are not bins things get sorted
> into — they are the load-bearing verticals of a life, and the word should carry that.
> "Dimension" implies an axis in a space; "pillar" belongs on a retail shelf. The Legatum
> Prosperity Index uses pillars for the same construct.

**Criterion:**

| Field | Notes |
|---|---|
| `pillar` | Its parent pillar |
| `level` | `country` or `city` — the same axis as `Candidate.level` |
| `weight` | Sub-weight within its pillar |
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

### 3.5a ExternalScore

A score or rank published by an **outside index**, displayed beside the Starnest score and
**never fed into it**. The model is a film page showing its own rating with Rotten Tomatoes
and Metacritic alongside: several opinions, visibly separate, produced by different people
using different methods.

| Field | Notes |
|---|---|
| `candidate`, `provider` | Who published it, about what |
| `value` | The published number |
| `scale` | What the number means — `0-100`, `0-10`, `rank`, `index` |
| `rank`, `rank_of` | Where the provider publishes a position rather than a score |
| `reference_date`, `retrieval_date` | Same two-date rule as any value (§3.6) |
| `methodology_url` | So the reader can see how it was built |
| `notes` | Caveats — paywalled, discontinued, known quirks |

**Hard rule: an `ExternalScore` must never enter the weighted calculation.** It is a second
opinion, not an input. Ingesting one would import that provider's weights and normalisation,
contradicting *nothing hardcoded* and the principle that the criteria are the user's.

It is a **separate entity, not a `Value` with a flag** — a flag gets forgotten in a join and
silently ends up inside a sum.

**The general rule this creates:** *raw indicators become criteria; composite scores become
ExternalScores.* Eurostat's life-satisfaction survey figure is a criterion; the World Happiness
Report's weighted composite of six factors is an ExternalScore. The test is whether someone
else has already applied weights to it.

**Providers to carry:** WhereNext composite (country) · OECD Better Life Index (country) ·
EIU Global Liveability (city) · Mercer Quality of Living rank (city) · Numbeo Quality of Life
(both) · World Happiness Report (country).

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

Identifier, display name, level, applicable candidates, `verdict` (`pass` \| `fail` \|
`unknown`), reason text, source and its two dates, and an optional override carrying its own
reason and date.

**Overrides are permitted and audited.** An overridden filter attaches a visible marker that
travels with the candidate everywhere it appears.

### 3.8 Run

A persisted record of one acquisition pass.

Timestamp, level, scope (which candidates, which criteria), LLM call count, cost, and
per-candidate failures with their errors. Values link back to the Run that produced them,
which is what makes selective retry (§6.4) and score-over-time comparison possible.

---

## 4. Two-level evaluation

**Country level.** Cheap screening across all candidate countries using structured
sources. Countries below the qualification threshold do not have cities extracted.

**City level.** Detailed evaluation of cities within qualified countries, using
structured and LLM-assisted sources.

Both levels run on the same machinery. Scoring, filtering, resolution and comparison are
written once against `Candidate` and must not be duplicated per level. What differs is the
**data**: each level has its own criteria catalog and its own weights, each summing to 100%
independently of the other.

**A city's score never inherits arithmetic from its country's score.** The country score
appears alongside the city for context — so a strong city in a weak country is visible — but
is never added into the city total. National factors are already represented by city-level
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

**Score scale: 0–100, integer, configurable.** Criterion scores and total scores share one
range. No decimals — 86, not 8.6.

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

A city may be added and evaluated even though its country failed the country screen or was never
screened at all. Such a candidate is marked as having **bypassed** the country gate.

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

The country list auto-seeds with the **EU member states** initially — not the full EU/EEA + UK
+ CH scope, which is the eventual target rather than the starting set. Exclusions are stored as
configuration, not as deletions.

**Adding a country must be first-class, reusable functionality**, not a one-off script: name
the country, and its profile attributes and criterion values are acquired through the normal
adapters. This shares its shape with adding a city — same nomination, approval, profile
population and acquisition sequence at a different level — and the two should share
implementation wherever the level abstraction allows.

### 6.2 Triggering a fetch

Fetching is explicit and scoped — by level, by candidate, by criterion, or any combination.
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

### 6.7 Sources are plug-ins

Every data source is a **plug-in behind a common interface**, not a branch inside a fetcher.
Adding a source must mean writing one new adapter and registering it in configuration — never
editing the acquisition core, the scoring engine, or any existing adapter.

An adapter declares which criteria it can answer, at which levels, its reliability tier
(§5.7), its rate limits, and whether it is a bulk download or a per-candidate query
(`datasources.md` §7). The same requirement applies to the criteria catalog itself: this
catalog will grow, and growth must stay a data-and-adapter change.

### 6.9 Administrative procedures are documented, not unknowable

`naturalisation_pathway`, `residency_admin_ease`, `pension_portability` and `local_admin_ease`
are not subjective. Each is a **published administrative procedure** — requirements, steps,
timeline, fees — on an official national or municipal website. They were previously grouped
with the prose-bound criteria; that was a mistake of framing, not of measurement.

They therefore share **one source adapter** (§6.7): fetch the official page, extract the
documented requirements and timeline, and derive a difficulty score from them. Four criteria,
one plug-in, and the extracted requirement list is retained as the supporting evidence behind
the number.

### 6.8 Children in scope

The master spec never mentions children; this document does. Their presence adds the criteria
in the `family` pillar at both levels (§7) — national school system quality, parental leave
and child benefits at country level; schooling options, paediatric access and childcare at city
level — and shifts the weight of several existing criteria.

---

## 7. Criteria catalog

**Pillars are parallel across the two levels** — the same named concerns at both levels,
each holding whichever criteria apply there. Weights remain fully independent per level, each
summing to 100%. Both levels are user-adjustable: unlike the OECD Better Life Index, which
locks indicator weights, the sole user here chose every criterion and understands what it means.

`connectivity` is city-only; `work-life balance` criteria are country-only, since working-hours
culture and statutory leave are national.

| Pillar | Country | City |
|---|---|---|
| `economics` | ✓ | ✓ |
| `housing` | ✓ | ✓ |
| `career` | ✓ | ✓ |
| `safety` | ✓ | ✓ |
| `health` | ✓ | ✓ |
| `climate` | ✓ | ✓ |
| `connectivity` | — | ✓ |
| `nature` | ✓ | ✓ |
| `culture` | ✓ | ✓ |
| `governance` | ✓ | ✓ |
| `family` | ✓ | ✓ |

**All weights are provisional.** `scale_params` and `threshold` are left `TBD` until real data
exists. **C** marks a coordinate-bound source that works at any settlement size, **R** a
registry-bound one with a population floor (`datasources.md` §3).

### 7.1 Country level

#### Economics — 15%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `cost_of_living_index_country` | 40% | numeric, lower better | Eurostat price level indices, World Bank ICP |
| `income_tax_effective` | 35% | numeric %, lower better | OECD Tax Database, national tax authorities |
| `remote_work_tax_treaty` | 25% | label_list, must contain RO treaty | OECD treaty database, manual |

#### Housing — 11%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `house_price_to_income_ratio` | 40% | numeric, lower better | Eurostat, OECD Affordable Housing Database |
| `housing_cost_overburden_rate` | 35% | numeric %, lower better | Eurostat `ilc_lvho07a` |
| `overcrowding_rate` | 25% | numeric %, lower better | Eurostat `ilc_lvho05a` |

#### Career & work — 15%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `tech_employment_share` | 30% | numeric, higher better | Eurostat ICT/high-tech employment, ILO |
| `international_employer_presence` | 25% | **label_list**, more/larger is better | LLM + search, company sites — a named list of major international tech employers operating in the country |
| `average_working_hours` | 25% | numeric, **ideal_band** | OECD Employment Database, Eurostat `lfsa_ewhun2` |
| `statutory_paid_leave` | 20% | numeric days, higher better | OECD, EU Working Time Directive, national law |

#### Safety & stability — 13%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `crime_safety_index_national` | 50% | numeric, higher better | UNODC homicide, Eurostat crime |
| `political_economic_stability` | 50% | numeric, higher better | World Bank Governance Indicators |

#### Health — 10%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `healthcare_system_quality` | 100% | numeric, higher better | WHO Global Health Observatory, OECD Health Statistics |

#### Climate & environment — 8%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `climate_zone` | 30% | label_list | Köppen classification |
| `avg_annual_temperature` | 25% | numeric, **ideal_band** | Open-Meteo archive **(C)** |
| `annual_sunshine_hours` | 25% | numeric, higher better | Open-Meteo, from radiation **(C)** |
| `climate_trajectory_national` | 20% | numeric, lower risk better | Copernicus CDS, IPCC |

#### Nature & landscape — 8%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `natural_diversity` | 25% | numeric, higher better | Derived — count of coexisting feature types (coast, high mountain, major lake, major river, forest, distinct biomes) |
| `protected_land_share` | 25% | numeric %, higher better | WDPA / Protected Planet, Eurostat |
| `coastline_access` | 20% | numeric, higher better | Natural Earth, Eurostat — length relative to area |
| `forest_cover` | 15% | numeric %, higher better | FAO, Corine Land Cover |
| `elevation_range` | 15% | numeric m, higher better | Copernicus DEM — relief variety |

> A large country can host sea, high mountains, lakes and forest **simultaneously**, and that
> combination is the thing worth screening for. `natural_diversity` measures coexistence
> rather than presence, separating Austria and Spain from the Netherlands and Denmark.

#### Culture & community — 7%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `life_satisfaction` | 40% | numeric 0–10, higher better | Eurostat `ilc_pw01` *(survey figure, not the World Happiness composite — §3.5a)* |
| `openness_to_foreigners` | 35% | numeric, higher better | MIPEX, Eurobarometer, InterNations |
| `english_proficiency` | 25% | numeric, higher better | EF English Proficiency Index |

#### Governance & administration — 9%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `rule_of_law` | 25% | numeric, higher better | World Bank Governance Indicators, V-Dem |
| `naturalisation_pathway` | 25% | numeric, lower difficulty better | **Official administrative sources** — published requirements, steps, timeline and fees; difficulty derived. See §6.9 |
| `control_of_corruption` | 20% | numeric, higher better | World Bank WGI, Transparency International |
| `residency_admin_ease` | 15% | numeric, higher better | **Official administrative sources**; World Bank B-READY where covered. See §6.9 |
| `press_freedom` | 10% | numeric, higher better | Reporters Without Borders |
| `pension_portability` | 5% | numeric, higher better | **Official administrative sources** — EU social-security coordination rules. See §6.9 |

#### Family & education — 4%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `school_system_quality` | 45% | numeric, higher better | OECD PISA, UNESCO |
| `parental_leave_policy` | 30% | numeric, higher better | OECD Family Database |
| `child_benefit_policy` | 25% | numeric, higher better | OECD, national social-security bodies |

### 7.2 City level

#### Economics — 10%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `cost_of_living_2p_monthly` | 60% | numeric EUR/month, lower better | Numbeo **(R)**, LLM fallback |
| `local_purchasing_power` | 40% | numeric, higher better | Numbeo **(R)**, Eurostat Urban Audit **(R)** |

#### Housing — 15%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `rent_2br_city_centre` | 45% | numeric EUR/month, lower better | Numbeo **(R)**, national listings, LLM |
| `property_purchase_price_m2` | 35% | numeric EUR/m², lower better | National land registries, Eurostat **(R)** |
| `housing_quality` | 20% | numeric, higher better | Eurostat Urban Audit rooms-per-person, overcrowding **(R)** |

#### Career & work — 14%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `local_tech_market` | 45% | numeric count, higher better | Job-board and company-registry counts — **market breadth**, not a subjective rating |
| `major_employer_presence` | 30% | **label_list**, more/larger is better | LLM + search, company sites — named employers with an office in *this* city |
| `product_role_availability` | 25% | numeric count, higher better | Job boards — product-management roles specifically |

> **Anchors versus breadth.** `major_employer_presence` names the large, stable, often
> visa-sponsoring employers; `local_tech_market` counts how many employers exist at all. A city
> with one big office and nothing else is fragile; a city with two hundred small firms and no
> anchors is resilient but may never sponsor. Different risks, and one number would hide which
> you face.
>
> `product_role_availability` is deliberately separate: product roles are a small fraction of
> engineering roles in any market, and this criterion decides whether both people have options
> or one is dependent on remote work.

> Under a `remote-only` weight profile this pillar is down-weighted and `connectivity` up-weighted.

#### Safety & stability — 7%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `safety_local` | 100% | numeric, higher better | Eurostat Urban Audit **(R)**, Numbeo **(R)**, regional police |

#### Health — 7%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `healthcare_access_local` | 60% | numeric, higher better | Overpass, distance to hospital **(C)** |
| `paediatric_healthcare_access` | 40% | numeric, higher better | Overpass **(C)**, national health registries |

#### Climate & environment — 9%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `local_climate` | 55% | numeric, **ideal_band** + sunshine | Open-Meteo **(C)** |
| `air_quality` | 45% | numeric PM2.5, lower better | OpenAQ, EEA nearest station **(C)** |

#### Connectivity — 10%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `internet_quality` | 30% | numeric Mbps, higher better | Ookla Open Data, ~610 m tiles **(C)** |
| `public_transport` | 25% | numeric, higher better | Overpass **(C)**, Urban Audit |
| `flights_to_romania` | 25% | numeric, higher better | Flight APIs, manual, via `profile.nearest_airport` |
| `proximity_to_hub` | 20% | numeric km, lower better | Computed from coordinates **(C)** |

#### Nature & landscape — 12%

All criteria are **coordinate-bound**: they compute for a village as readily as for a capital.
This is the pillar where a small town can genuinely outscore a city, and where the data
exists to demonstrate it. Distances use a **saturating** scale — steep near zero, flat past the
point where further distance stops mattering.

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `distance_to_sea` | 18% | numeric km, lower better, **saturating** | OSM / Natural Earth coastline **(C)** |
| `distance_to_mountains` | 15% | numeric km, lower better, **saturating** | Copernicus DEM, terrain above threshold **(C)** |
| `hiking_trail_density` | 15% | numeric km per radius, higher better | OSM Overpass marked hiking routes **(C)** |
| `distance_to_inland_water` | 12% | numeric km, lower better, **saturating** | OSM lakes and rivers, size-filtered **(C)** |
| `protected_area_access` | 12% | numeric, higher better | WDPA — distance and area within radius **(C)** |
| `bathing_water_quality` | 10% | numeric, higher better | EEA Bathing Water Directive dataset |
| `night_sky_brightness` | 10% | numeric, lower better | VIIRS, World Atlas of Artificial Night Sky Brightness **(C)** |
| `forest_cover_local` | 8% | numeric %, higher better | Corine Land Cover within radius **(C)** |

> `hiking_trail_density` measures whether you can actually walk; `distance_to_mountains` alone
> does not. `bathing_water_quality` separates 20 km from the sea from 20 km from water you
> would swim in.

#### Culture & community — 8%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `heritage_and_culture_density` | 60% | numeric, higher better | UNESCO, monument registers, Overpass museum/cinema counts **(C)** |
| `expat_community_size` | 40% | numeric, higher better | Eurostat Urban Audit foreign-born **(R)** |

#### Governance & administration — 2%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `local_admin_ease` | 100% | numeric, higher better | **Official administrative sources** — municipal service pages. See §6.9 |

#### Family & education — 6%

| Criterion | Weight | Type / direction | Sources |
|---|---|---|---|
| `schooling_options` | 60% | numeric, higher better | Overpass **(C)**, national education registries |
| `childcare_cost_availability` | 40% | numeric, lower cost better | Eurostat **(R)**, national statistics |

---

## 8. User interface

**Four tabs plus a persistent sidebar.** The sidebar carries controls that are relevant
everywhere; each tab owns one stage of the workflow and nests its detail views inside.

### 8.1 Sidebar — always visible

- Application display name, read from configuration (§10)
- **Active weight profile** selector
- **Level toggle** — country (1) or city (2)
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

- **Scope selector** — level, which candidates, which criteria.
- **Dry-run estimate** — planned call count and cost range, with explicit confirmation.
- **Budget cap** for this run.
- **Live progress**, per candidate and per criterion.
- **Failures** with their errors and a one-click retry of only the failed items.
- **Run history** — every persisted Run with its cost, scope and outcome.

### 8.4 Tab 3 — Rank

The main results view.

- **Ranking table** — candidates by total score, with coverage percentage and status. When
  viewing cities, the country's country score appears as a context column. A Δ-vs-Romania
  column is available on any criterion.
- **Eliminated section** — always present, never hidden. Greyed rows showing the retained
  score, the elimination reason, and any override marker.
- **Criterion drill-down** — select one criterion and see every candidate on it alone: raw
  value, active source, reference date, retrieval date.
- **Candidate detail** — the factual profile (§3.2), then every criterion with its full
  provenance, showing **all** stored source values rather than only the active one, plus
  filter verdicts and any overrides.
- **External scores** (§3.5a) — published scores and ranks from outside indices, shown in a
  visually distinct panel that makes clear they are *other people's opinions*, not inputs.
  Each displays the provider, the number, its scale, both dates, and a link to the
  methodology. Never summed, never averaged with the Starnest score.

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

- **Prose-bound criteria — largely resolved.** `general_atmosphere` is **dropped**: too vague
  to define, let alone measure. `local_tech_market` was redefined as a count rather than a
  rating. The administrative criteria moved to documented official sources (§6.9). What remains
  is `international_employer_presence`, `major_employer_presence` and `product_role_availability`,
  all of which use **LLM proposal with user override, both values retained**. These are city-level
  or LLM-dependent, and therefore land after v1 (§1.3).
- **Provisional values**, all to be revised after a first real run: every weight in §7, the
  country-level qualification threshold, the ~2000–3000 EUR/month household budget guideline, the
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
| Q1 | Two-level criteria | Preserves the spec's pillar weights exactly while keeping each bullet independently sourced and provenance-tracked |
| Q2 | Exactly two levels | Implied by Q1; no deeper nesting in the model |
| Q3 | Cross-level concepts are separate criteria | The spec frames local safety as a different question from national safety, not the same one zoomed in |
| Q4 | Direction per criterion, either mode | A single direction cannot express "warm but not too hot" |
| Q5 | Normalisation per criterion, in config | Fixed bands keep a score stable over time; percentile suits criteria where only relative standing matters |
| Q6 | Redistribute weight, show coverage | Zero-filling would bury exactly the small, under-documented towns that are wanted candidates |
| Q7 | Coverage floor *and* `required` flags | They catch different failures: general sparsity versus a specific essential unknown |
| Q8 | Scale 0–100, integer | Criterion inputs and totals share one range; whole numbers read faster than one-decimal fractions |
| Q9 | Country score displayed, never added | National factors already appear in city-level criteria; adding them again double-counts |
| Q10 | Filters and thresholds are two mechanisms, one report | Filters carry judgement, verdicts, sources and overrides that a threshold does not |
| Q11+Q19 | Manual entry is a first-class source | Visa pathways and quotas have no fetcher; an early estimate must be supersedable, not deleted |
| Q12 | Overrides permitted, audited | A manual judgement may later be revised; layering a decision beats rewriting the record |
| Q13 | Eliminated candidates keep their score | Shows what a gate is costing you |
| Q14 | Country list auto-seeded, prunable | Exclusions are configuration, not deletion |
| Q15 | All four nomination mechanisms | Population ranking alone cannot reach a village of 7,000 |
| Q16 | The country screen can be bypassed | Supports investigating somewhere you just heard about |
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
| Q32 | Subdivisions descriptive only | A third tier would break the two-level architecture |
| Q33 | Catalog at name/type/direction/source/weight detail | Scale bands and thresholds can only be set sensibly after real data |
| Q34 | Four tabs plus sidebar | Preserves the spec's shape; newer surfaces nest inside |
| Q35 | Per-value confidence: display and source priority only | Coverage says how much data exists; confidence says what it is worth. Discounting the score would absorb uncertainty rather than disclose it |
| Q36 | Confidence derived from source, age and geography, with override | Reuses `max_age` and `DataSource.kind`; no field anyone must remember to fill |
| Q37 | `openness_to_foreigners` moved to country level | MIPEX, Eurobarometer and InterNations are country-level only |
| Q38 | Numbeo scraped first, API later if warranted | Personal, non-commercial use; `robots.txt` restricts only `/heavy_crawling.any`. Its coverage floor is ~150k population either way, so paying buys the same gap |
| Q39 | Pillars are parallel across levels | One structure to learn; weight profiles stay legible across levels; fixes a pillar that bundled healthcare with bureaucracy |
| Q40 | Country-level education and family policy added | Children are in scope and national school system quality is not substitutable by local school counts |
| Q41 | `english_proficiency` moved to country level | Same reasoning as `openness_to_foreigners` — EF EPI is country-level |
| Q42 | External scores displayed, never computed with | The IMDb model — show other indices as second opinions. Ingesting them would import their weights |
| Q43 | Raw indicators become criteria; composites become ExternalScores | A general rule: the test is whether someone else already applied weights |
| Q44 | Four benchmark gaps added | Work–life balance, subjective wellbeing, governance/rights, housing quality — each present in at least two of OECD, EIU, Mercer, Eurostat |
| Q45 | Housing split from economics | OECD and Mercer both treat it separately; price and quality are different questions |
| Q46 | Governance folded into `admin`, renamed | Both concern how the state treats you; keeps the pillar count down |
| Q47 | Both weight levels stay user-adjustable | OECD locks indicators because it serves the anonymous public; here the sole user chose every criterion |
| Q48 | `nature` promoted to its own pillar, both levels | It was buried in culture at a 3.5% effective weight; nature is not culture, and it is the one pillar where small towns win on computable data |
| Q49 | Distance criteria use a saturating scale | 5 km vs 15 km to the sea matters; 200 km vs 250 km does not |
| Q50 | Country nature measures *diversity*, not presence | A large country can hold sea, mountains, lakes and forest at once; coexistence is what is worth screening |
| Q51 | `CandidateProfile` gains a natural-setting section | Facts describe, criteria judge — "Calanques, 2 km" is context, "nature 8.7" is a score |
| Q52 | Data sources are plug-ins behind a common interface | Adding a source must be one adapter plus config, never an edit to the acquisition core |
| Q54 | `general_atmosphere` dropped | Too vague to define or measure; no countable proxy and no clear meaning |
| Q55 | `local_tech_market` redefined as a count | Market *breadth* is countable from job boards and registries; the 1–10 rating was a vibe |
| Q56 | Anchors and breadth kept as separate criteria | One large employer and two hundred small ones are different risks; a single number hides which |
| Q57 | Administrative criteria use official sources, one shared adapter | Naturalisation, residency, pensions and local admin are published procedures, not unknowables |
| Q58 | v1 covers the country level only, full features | Exercises every load-bearing abstraction; the city level then adds sources and rows, not machinery |
| Q59 | Country seed is EU member states initially | The full EU/EEA + UK + CH scope is the target, not the starting set |
| Q60 | Adding a country is first-class, reusable, shared with adding a city | Same nomination → approval → profile → acquisition sequence at a different level |
| Q53 | **Pillar**, not pillar, group or dimension | These are load-bearing verticals of a life, not retail bins. Precedent: Legatum Prosperity Index. "Dimension" implies an axis; "domain" collides with the domain model; "chapter" implies sequence where these coexist |
| — | `Candidate` replaces `Target` | "Target" also named a role in comparisons; the entity and the role needed separating |
