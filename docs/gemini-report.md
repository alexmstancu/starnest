# Starnest Architecture, Requirements, & Delivery Plan Review Report

**Date:** 2026-08-30  
**Target Documents Reviewed:**
- [`CLAUDE.md`](file:///Users/alex/Code/Projects/starnest/CLAUDE.md)
- [`docs/reqs.md`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md)
- [`docs/arch.md`](file:///Users/alex/Code/Projects/starnest/docs/arch.md)
- [`docs/devplan.md`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md)
- [`docs/datasources.md`](file:///Users/alex/Code/Projects/starnest/docs/datasources.md)
- [`docs/openapi.yaml`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml)

---

## Executive Summary

The project documentation across Starnest is exceptionally well-structured, rigorous, and clear in intent. The core separation between objective measurements (Attributes, Values, MatchRuleResults) and subjective preferences (Criteria, CriteriaSets, Evaluations), the clean-architecture dependency boundaries enforced by `import-linter`, and the commitment to provenance and data quality are architecturally sound and deeply thought out.

However, a thorough cross-document audit comparing ontology models, database schemas, mathematical equations, API contracts, and milestone gate criteria revealed several **critical logical contradictions, mathematical impossibilities, schema disconnects, and milestone sequence deadlocks**. If left unresolved before implementation begins, these issues will cause test failures at Gate A/B, invalid database constraints, inaccurate scoring, or runtime crashes.

This report documents all identified issues categorized by severity, analyzes their root causes, and provides concrete recommendations for resolution.

---

## Findings Summary Matrix

| ID | Category | Severity | Summary | Primary Documents |
|---|---|---|---|---|
| **CRIT-1** | Milestone Logic | **Critical** | Gate A deadlock: Eurostat run yields 0 scoreable countries due to 5 missing `blocks_if_missing` attributes | `devplan.md` §3, `reqs.md` §5.3/§7.5 |
| **CRIT-2** | Mathematical / Modeling | **Critical** | `RatioBetweenAttributes` shape breaks on Celsius temperature and arbitrary ratio scales | `reqs.md` §3.7a/§7.4, `arch.md` §1 |
| **CRIT-3** | Domain / Math | **Critical** | CriteriaSet sparse inheritance contradicts the 100% pillar weight sum invariant | `reqs.md` §3.4, `arch.md` §8.3 |
| **HIGH-1** | Milestone Sequence | **High** | Gate A proposes deriving 26 fixed scale anchors when only Eurostat data (7 attributes) exists | `devplan.md` §3 (Gate A), `reqs.md` §7.1 |
| **HIGH-2** | Schema & Invariants | **High** | `timestamptz` vs. `date` / `timestamp` column type mismatch across ERD, schema, and API | `reqs.md` §3, `arch.md` §9.6, `openapi.yaml` |
| **HIGH-3** | Storage / Unique Keys | **High** | `VALUE` unique constraint includes timestamp retrieval date and omits reference period end | `arch.md` §3.2, `reqs.md` §3.6 |
| **HIGH-4** | API / Domain Invariant | **High** | `openapi.yaml` defines `Pillar.level` in direct contradiction to `reqs.md` Q187 / §3.2 | `openapi.yaml` line 805, `reqs.md` §3.2 |
| **HIGH-5** | Schema Completeness | **High** | `EVALUATION_CRITERION` snapshot fails to freeze anchors, ranges, reducers, and thresholds | `reqs.md` §3.4a, `arch.md` §3.4a |
| **MED-1** | Domain Seams | **Medium** | Missing seam store interfaces for `MatchRule`, `CompoundRule`, and `MatchRuleResult` | `arch.md` §6.3, `devplan.md` T1.3 |
| **MED-2** | Schema Disconnect | **Medium** | `MATCH_RULE_RESULT` lacks citation storage for researched URLs | `reqs.md` §3.7/§6.10, `openapi.yaml` |
| **MED-3** | Domain Taxonomy | **Medium** | Dual identity of `two_role_feasibility` as both `MatchRule` and `CompoundRule` | `reqs.md` §7.3 vs §7.4 |
| **MED-4** | Concept Ambiguity | **Medium** | Undefined "country qualification threshold" / "country match threshold" | `CLAUDE.md`, `arch.md` §10.4, `reqs.md` §4 |
| **MED-5** | Data Integrity / Scope | **Medium** | Liechtenstein & post-Brexit UK coverage gaps on Eurostat will fail Gate B | `devplan.md` Gate B, `datasources.md` §2.1 |
| **MED-6** | Contract Ambiguity | **Medium** | Coverage defined as ratio `0–1` in conventions but `0–100` percentage in schemas | `openapi.yaml` line 21 vs 1237 |
| **LOW-1** | Terminology Drift | **Low** | Retired words (*screening, elimination, qualified*) used in active text | `CLAUDE.md`, `arch.md` §10.4 |
| **LOW-2** | Tooling Inconsistency | **Low** | `just check` reference in `devplan.md` instead of `make check` | `devplan.md` §6, `Makefile` |
| **LOW-3** | Concurrency Ambiguity | **Low** | "Background thread" phrasing vs `asyncio` event loop architecture | `arch.md` §7.1 vs §10.2 |
| **LOW-4** | Attribute Count | **Low** | `arch.md` §3.5 cites "~44 country attributes" instead of exact 41 | `arch.md` §3.5 vs `reqs.md` §7.1 |

---

## Detailed Findings and Analysis

### 1. Critical Logical & Pipeline Contradictions

#### CRIT-1: Gate A Deadlock — `blocks_if_missing` vs. Eurostat-Only Slice vs. Ranking Assertions
- **Location:** [`docs/devplan.md:308-329, 358`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md#L308-L329); [`docs/reqs.md:2303-2332`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L2303-L2332).
- **The Problem:**
  In Phase P3, only the Eurostat adapter is implemented (serving 7 country attributes, including `cost_of_living_index` and `house_price_to_income_ratio`).
  In `reqs.md` §7.5, the shipped default criteria set defines **seven `blocks_if_missing` attributes**:
  1. `country.cost_of_living_index` *(Eurostat)*
  2. `country.income_tax_effective` *(OECD — built in P4 W4-B)*
  3. `country.house_price_to_income_ratio` *(Eurostat)*
  4. `country.crime_safety_index` *(UNODC — built in P4 W4-D)*
  5. `country.political_economic_stability` *(World Bank — built in P4 W4-A)*
  6. `country.healthcare_system_quality` *(WHO GHO — built in P4 W4-D)*
  7. `country.rule_of_law` *(World Bank — built in P4 W4-A)*

  At Gate A, because W4-A, W4-B, and W4-D have not been built yet, attributes 2, 4, 5, 6, and 7 have **zero data** for all 32 countries.
  According to `reqs.md` §5.3 and §7.5:
  > *"a missing value on one makes the candidate unscoreable regardless of overall coverage... reported as insufficient data... No total is produced"*.
  
  Consequently, under the default criteria set, **every single country will be marked `match_status = insufficient_data` with `score = null`**.
  However, Gate A explicitly requires:
  > *"6. `GET /rankings`. Assert 32 countries come back ranked, with honest coverage."*
  > *"Coverage will be roughly 20%... The first ranking being honestly sparse is the strongest evidence available that redistribution and coverage work."*
- **Why this breaks:**
  You cannot have 32 countries come back scored and ranked while 5 required `blocks_if_missing` attributes are missing unless `blocks_if_missing` is violated or disabled in the test criteria set.
- **Recommendation:**
  Explicitly specify in `devplan.md` Gate A that the acceptance test suite duplicates the default criteria set and creates a test criteria set (e.g. `gate-a-eval`) where `blocks_if_missing` is temporarily disabled or limited to the 2 Eurostat required attributes, OR clarify that the default criteria set seeds `blocks_if_missing: false` until Gate B when full adapter coverage arrives.

---

#### CRIT-2: Mathematical and Physical Flaws in `RatioBetweenAttributes` Compound Rule Shape
- **Location:** [`docs/reqs.md:1406-1411, 2287-2295`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L1406-L1411); [`docs/arch.md:25-33`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L25-L33).
- **The Problem:**
  `reqs.md` §3.7a defines the archetype `RatioBetweenAttributes`:
  > *"Reads two attributes, in order. Fires when their ratio falls outside `threshold_min`–`threshold_max`."*
  
  In §7.4, this shape is used for:
  1. `mild_now_brutal_later`: Reads `country.avg_annual_temperature` and `country.projected_summer_heat_days`.
  2. `cheap_but_taxed`: Reads `country.cost_of_living_index` and `country.income_tax_effective`.
  3. `expat_bubble`: Reads `city.expat_community_size` and `country.openness_to_foreigners`.

  This produces severe mathematical failures:
  - **Division by Zero & Temperature Inversion:** `country.avg_annual_temperature` is in °C (Quantity). In Iceland, Norway, or Sweden, average annual temperatures can be −1 °C, 0 °C, or +2 °C. Dividing temperature by days of heat (or vice-versa) yields division by zero (`0 °C / 10 days`), negative ratios (`-2 °C / 5 days`), or massive ratio swings for 0.1 °C vs 1.0 °C. Celsius is an interval scale, not a ratio scale.
  - **Logic Mismatch:** The intent of `mild_now_brutal_later` is: *"A comfortable annual mean hides a projected summer that is not."* This is a logical conjunction: $T_{\text{annual}} \in [15, 25]\ ^\circ\text{C} \land \text{HeatDays} \ge 25$. A single ratio $\frac{T_{\text{annual}}}{\text{HeatDays}}$ cannot express this condition.
  - **Incompatible Units:** `cheap_but_taxed` divides an index ($100 = \text{EU average}$) by a percentage tax rate ($0.40$ or $40$). The resulting ratio has no physical or economic meaning.
- **Recommendation:**
  Replace the simplistic `RatioBetweenAttributes` archetype with:
  1. `ThresholdPair`: Fires when Attribute A is within a specified range AND Attribute B exceeds a threshold.
  2. Or refine `RatioBetweenAttributes` strictly for attributes with non-zero, dimensionless, true ratio scales (e.g. `Ratio` to `Ratio`), and create `ConditionPairWarning` for cross-attribute thresholds.

---

#### CRIT-3: CriteriaSet Sparse Inheritance vs. 100% Weight Sum Invariant
- **Location:** [`docs/reqs.md:1100-1114`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L1100-L1114); [`docs/arch.md:995-1004`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L995-L1004).
- **The Problem:**
  `reqs.md` §3.4 states:
  > *"The application ships one default criteria set... Any other criteria set **inherits from the default for anything it does not override**, so a set need only carry what it changes, and adding an attribute to the catalog does not break existing sets."*
  
  Yet in the same section and in `arch.md` §8.3:
  > *"Weights must always sum to 100 — within a level across pillars, and within a pillar across criteria. Moving one weight auto-rebalances the others proportionally..."*
  
  These two rules are mathematically irreconcilable:
  - If criteria set `partner` overrides the weight of 1 criterion in `career` from 22% to 40%, the weights in that pillar can only sum to 100% if the remaining 5 criteria in that pillar have their weights reduced.
  - If `partner` only stores the single override (40%), the sum of the inherited weights (78%) + the override (40%) = 118%, violating the database constraint that criteria weights in a pillar must sum to 100%.
  - Furthermore, `POST /criteria-sets/{id}/duplicate` and the schema `CRITERIA_SET ||--o{ CRITERION` duplicate all criteria rows upon creation.
- **Recommendation:**
  Clarify that a `CriteriaSet` does **not** use sparse inheritance at runtime. A new `CriteriaSet` is created by duplicating the full default set (cloning all criterion rows). Updates rebalance the full set of rows in the database. When a new attribute is added to the catalog via migration, a catalog migration updates all existing criteria sets with a default weight (e.g. 0% or rebalancing unlocked siblings).

---

### 2. High-Severity Storage, Schema & Milestone Inconsistencies

#### HIGH-1: Gate A Scale Anchors Derivation Sequence Defect
- **Location:** [`docs/devplan.md:340-355`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md#L340-L355).
- **The Problem:**
  `devplan.md` section *"Deriving the scale anchors — a step that belongs to Gate A"* states:
  > *"26 of the 41 country criteria normalise fixed, and no anchors ship... After the Eurostat run lands, and before the ranking is declared meaningful: 1. Compute each fixed attribute's observed range across the 32 countries... 2. Propose anchor pairs... 3. Seed the approved anchors as a catalog migration..."*
  
  However, at Gate A, **only Eurostat has run**. Eurostat supplies data for only ~4 `fixed` attributes.
  The remaining 22 `fixed` attributes (from World Bank, OECD, Open-Meteo, WHO, UNODC) have **zero stored values** at Gate A.
  It is impossible to observe the distribution across 32 countries for attributes whose adapters won't be written until Phase P4.
- **Recommendation:**
  Update `devplan.md` to split anchor derivation:
  - At **Gate A**: Propose and seed scale anchors for the **Eurostat fixed attributes**.
  - At **Gate B**: Propose and seed scale anchors for the remaining fixed attributes once all 6 adapters in P4 have populated real data.

---

#### HIGH-2: `timestamptz` vs. `date` / `timestamp` Type Inconsistencies
- **Location:** [`docs/arch.md:1088-1093`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L1088-L1093); [`docs/reqs.md:330-405, 480`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L330-L405); [`docs/openapi.yaml:965, 1125, 1350`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml#L965).
- **The Problem:**
  `arch.md` §9.6 states a strict architectural rule:
  > *"`timestamptz` for every moment the system records — run timestamps, retrieval dates, evaluation timestamps. Plain `date` for reference periods, which describe a span in the world rather than an instant in a timezone."*
  
  However, there are multiple direct contradictions across the specifications:
  1. In `reqs.md` ERD:
     - `VALUE.retrieval_date` is declared as `date` (line 339).
     - `MATCH_RULE_RESULT.retrieval_date` is declared as `date` (line 385).
     - `MATCH_RULE_RESULT.override_date` is declared as `date` (line 388).
     - `EXTERNAL_SCORE.retrieval_date` is declared as `date` (line 399).
     - `DATA_ACQUISITION_RUN.started_at` / `finished_at` are declared as `timestamp` (without timezone, line 350-351).
     - `EVALUATION.computed_at` is declared as `timestamp` (line 481).
  2. In `docs/openapi.yaml`:
     - `retrieval_date` is typed as `{ type: string, format: date }` (lines 965, 995, 1125, 1350) instead of `date-time`.
     - `override_date` is typed as `{ type: string, format: date }` (line 1136).
- **Recommendation:**
  Standardize all system execution and retrieval moments to `timestamptz` in PostgreSQL and `format: date-time` in OpenAPI:
  - `retrieval_date` $\rightarrow$ `retrieval_timestamp` (or keep name, but use `timestamptz` / `format: date-time`).
  - `override_date` $\rightarrow$ `override_timestamp` (`timestamptz`).
  - Reserve plain `date` / `format: date` exclusively for `reference_period_start` and `reference_period_end`.

---

#### HIGH-3: `VALUE` Unique Index / Natural Key Definition Flaw
- **Location:** [`docs/arch.md:171-193`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L171-L193); [`docs/reqs.md:670-673`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L670-L673).
- **The Problem:**
  In `arch.md` §3.2, the UNIQUE constraint on `VALUE` is given as:
  ```sql
  UNIQUE (candidate, attribute, data_source, breakdown_option,
          reference_period_start, retrieval_date)
  ```
  This definition has two major flaws:
  1. **Including `retrieval_date` (as a timestamp) defeats idempotency:** If `retrieval_date` is recorded as a `timestamptz`, running the same adapter fetch twice 10 seconds apart yields two different retrieval timestamps, resulting in duplicate active value candidates instead of preventing redundant writes.
  2. **Omitting `reference_period_end` causes false collisions:** A monthly measurement (2026-01-01 to 2026-01-31) and an annual measurement (2026-01-01 to 2026-12-31) share the same `reference_period_start` and would trigger a unique constraint violation.
- **Recommendation:**
  Define the natural unique constraint over the domain measurement coordinates:
  ```sql
  UNIQUE (candidate, attribute, data_source, breakdown_option,
          reference_period_start, reference_period_end)
  ```
  If historical re-fetches are preserved, ensure retrieval date truncation or a dedicated run-based versioning key is used.

---

#### HIGH-4: OpenAPI Contract Level Violation on `Pillar`
- **Location:** [`docs/openapi.yaml:804-811`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml#L804-L811); [`docs/reqs.md:828-835`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L828-L835).
- **The Problem:**
  In `reqs.md` §3.2 (and Decision Q187):
  > *"**A pillar carries no level, and that is the point.** `housing` is one concern... So the level sits on `PILLAR_WEIGHT` — one row for housing at country level, another for housing at city level, against the same single pillar row. Making the pillar itself level-scoped would mean eleven duplicated names and descriptions per level... Decided 2026-08-30 (Appendix B, Q187)."*
  
  Yet in `docs/openapi.yaml`:
  ```yaml
  Pillar:
    type: object
    required: [id, name, level]
    properties:
      id: { type: string }
      name: { type: string }
      description: { type: string }
      level: { type: string }
  ```
  And `/pillars` declares a query parameter `LevelFilter`.
- **Why this breaks:**
  If `PILLAR` in PostgreSQL does not have a `level` column (as defined in `reqs.md` ERD line 278), `GET /v1/pillars` cannot populate `Pillar.level` or filter by level without joining `PILLAR_WEIGHT`.
- **Recommendation:**
  Remove `level` from `#/components/schemas/Pillar` in `docs/openapi.yaml`. `PILLAR` is a top-level catalog entity (`id, name, description`). Level-scoped pillar weights are returned via `PillarWeight` in `/criteria-sets/{id}` or `GET /evaluations/{id}/criteria`.

---

#### HIGH-5: Incomplete Evaluation Criteria Snapshot (`EVALUATION_CRITERION`)
- **Location:** [`docs/reqs.md:492-502, 1192-1202`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L492-L502); [`docs/openapi.yaml:670-691`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml#L670-L691).
- **The Problem:**
  `reqs.md` §3.4a states:
  > *"An evaluation freezes the criteria it used... The criteria snapshot freezes the weights and the anchors..."*
  
  However, in `reqs.md` ERD and relational model:
  ```
  EVALUATION_CRITERION {
      bigint evaluation FK
      text attribute FK
      text pillar FK
      bool is_scored
      numeric weight
      numeric pillar_weight
      text goal
      text normalisation_method
      bool blocks_if_missing
  }
  ```
  `EVALUATION_CRITERION` has **no link** to frozen scale anchors (`CRITERION_SCALE_ANCHOR`), no target range fields (`target_range_min`, `target_range_max`, `zero_score_below`, `zero_score_above`), no reducer settings (`reducer_mode`, `breakdown_option`), and no threshold children.
  The threshold tables and scale anchor tables link exclusively to `CRITERION` (which is mutable in `CRITERIA_SET`).
  If a user alters scale anchors in `alex`, an old `Evaluation`'s criteria snapshot cannot reconstruct what the scale anchors were when that evaluation ran.
- **Recommendation:**
  Either:
  1. Add `target_range_min/max`, `zero_score_below/above`, `breakdown_option`, `reducer_mode`, and snapshot child tables for scale anchors to `EVALUATION_CRITERION`, OR
  2. Explicitly document in `arch.md` and `reqs.md` that `EVALUATION_CRITERION` freezes weights, goals, and scopes, while historical score integrity is guaranteed by immutable `CANDIDATE_ATTRIBUTE_SCORE` rows rather than criteria re-evaluation.

---

### 3. Medium-Severity Domain, Contract & Seams Disconnects

#### MED-1: Missing Store Seam Interfaces for Match Rules and Compound Rules
- **Location:** [`docs/arch.md:673-685`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L673-L685); [`docs/devplan.md:263-264`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md#L263-L264).
- **The Problem:**
  `arch.md` §6.3 and `devplan.md` T1.3 enumerate "All nine seam interfaces":
  1. `SourceAdapter`
  2. `CostMeter`
  3. `ValueStore`
  4. `CatalogStore`
  5. `FxRateProvider`
  6. `Clock`
  7. `CriteriaStore`
  8. `HouseholdStore`
  9. `EvaluationStore`

  Noticeably absent:
  - Where do `MatchRule`, `MatchRuleResult`, and `CompoundRule` live?
  - In `arch.md` §6.1, `criteria/` owns "which match rules a set enforces", and `evaluation/` owns "the compound rule shapes and their evaluation".
  - In `devplan.md` W5-C, an agent is assigned to build `/match-rules`, `/match-rule-results`, and `/compound-rules`.
  - But no repository/store interface exists for querying `MatchRuleResult` (e.g. `MatchRuleStore` or operations on `CatalogStore` / `ValueStore`).
- **Recommendation:**
  Explicitly allocate `MatchRule` and `CompoundRule` catalog reads to `CatalogStore`, and allocate `MatchRuleResult` persistence/overrides to `MatchRuleResultStore` (or document their exact placement inside `ValueStore` / `CriteriaStore`).

---

#### MED-2: Missing Citation URLs on `MATCH_RULE_RESULT`
- **Location:** [`docs/reqs.md:377-388, 1371, 1896`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L377-L388); [`docs/openapi.yaml:1117-1137`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml#L1117-L1137).
- **The Problem:**
  `reqs.md` §3.7 and §6.10 emphasize that Match Rule research (such as UK Skilled Worker visa requirements or Swiss quota availability) performed by humans or LLMs must cite official government pages.
  In the schema, citations are stored in `VALUE_CITATION` with `bigint value FK`.
  `MATCH_RULE_RESULT` has no relationship to `VALUE_CITATION` or any `url` column.
  In `docs/openapi.yaml`, `MatchRuleResult` has a free-text `reason` but no `citations` array.
- **Recommendation:**
  Add a `citations` child table or column to `MATCH_RULE_RESULT` (mirroring `VALUE_CITATION`) in both `reqs.md` ERD and `docs/openapi.yaml`.

---

#### MED-3: Dual Identity of `two_role_feasibility`
- **Location:** [`docs/reqs.md:2270, 2294`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L2270); [`docs/reqs.md:511-517`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L511-L517).
- **The Problem:**
  `two_role_feasibility` is defined in two separate catalogs with different types:
  - In `reqs.md` §7.3 (Match Rule Catalog): Listed as a `MatchRule` (`level: city`, manual gate).
  - In `reqs.md` §7.4 (Compound Rule Catalog): Listed as a `CompoundRule` (`level: city`, shape: `SumBelowFloor`, outcome: `not_matching`).
  
  In the database, `MATCH_RULE` and `COMPOUND_RULE` are distinct tables with different relations.
  In `NON_MATCH_REASON`, the foreign keys `match_rule FK` and `compound_rule FK` are mutually exclusive.
- **Recommendation:**
  Clarify that in MVP/v1, `two_role_feasibility` exists exclusively as a `MatchRule` (manual gate). Document that when job counts acquire structured sources post-MVP, it transitions to a `CompoundRule` (with a migration), rather than listing it simultaneously in both catalog tables in v1.

---

#### MED-4: Undefined "Country Qualification Threshold" / "Country Match Threshold"
- **Location:** [`CLAUDE.md:124, 188`](file:///Users/alex/Code/Projects/starnest/CLAUDE.md#L124); [`docs/arch.md:1198-1210`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L1198-L1210); [`docs/reqs.md:1528, 2437`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L1528).
- **The Problem:**
  `CLAUDE.md` and `arch.md` frequently state:
  > *"Countries below a qualification threshold are excluded... those below the qualification threshold do not have cities extracted."*
  
  `reqs.md` §4 and §9 cite a "country match threshold".
  However:
  1. `reqs.md` Appendix A explicitly retired the words "qualified, eliminated, screened, verdict" in favor of `matching` / `not_matching`.
  2. Nowhere in `SETTINGS`, `CRITERIA_SET`, or `HOUSEHOLD` is there a field for a score threshold (e.g. `country_min_score` or `qualification_threshold`).
  3. It is ambiguous whether city extraction requires a country to have `match_status == 'matching'` (clearing all gates/thresholds) or if there is an unmodeled minimum score cutoff (e.g. Total Score $\ge 70$).
- **Recommendation:**
  Remove references to "qualification threshold" and replace with standard match vocabulary:
  *"Cities are nominated only for countries with `match_status == matching` under the active CriteriaSet."*

---

#### MED-5: Liechtenstein & Post-Brexit UK Coverage Trap at Gate B
- **Location:** [`docs/devplan.md:400-402`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md#L400-L402); [`docs/datasources.md:34, 253`](file:///Users/alex/Code/Projects/starnest/docs/datasources.md#L34).
- **The Problem:**
  `devplan.md` Gate B requires:
  > *"All seven `blocks_if_missing` attributes have values for all 32 countries. A gap here means a broken fetch, not an undocumented country..."*
  
  However, `datasources.md` documents:
  - WhereNext is missing Liechtenstein (`datasources.md` §2.1).
  - Eurostat price level indices (`country.cost_of_living_index`) and housing databases do not survey Liechtenstein independently (Liechtenstein is in a customs/currency union with Switzerland and often omitted in Eurostat price baskets).
  - Post-Brexit UK is omitted in several recent Eurostat series.
  If Eurostat returns no data for Liechtenstein on `country.cost_of_living_index` or `country.house_price_to_income_ratio`, Liechtenstein will remain `insufficient_data` and Gate B will fail.
- **Recommendation:**
  In `datasources.md` / `arch.md`, explicitly document Swiss fallback proxies for Liechtenstein or configure manual/World Bank secondary source priority for Liechtenstein/UK where Eurostat is unpopulated.

---

#### MED-6: Coverage Scale Inconsistency in OpenAPI Specification
- **Location:** [`docs/openapi.yaml:21-22, 1022, 1237`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml#L21-L22).
- **The Problem:**
  In `docs/openapi.yaml` header conventions (lines 21–22):
  > *"Scores are integers 0–100. **Coverage is a ratio 0–1.**"*
  
  However, in `docs/openapi.yaml` schemas:
  - Line 1022 (`SettingsInput.min_coverage`): `minimum: 0, maximum: 100, description: "Percentage, 0-100."`
  - Line 1237 (`CandidateResult.coverage`): `minimum: 0, maximum: 100, description: "Percentage, 0-100. The share of active weight actually backed by data."`
  - Line 1281 (`AttributeScore.effective_weight`): `minimum: 0, maximum: 100, description: "Percentage, 0-100."`
- **Recommendation:**
  Correct line 21 in `docs/openapi.yaml` to match the schemas and `reqs.md`:
  *"Scores and coverage are percentages 0–100 (scores displayed as integers, coverage as a float/percentage)."*

---

### 4. Low-Severity & Maintenance Disconnects

#### LOW-1: Retired Vocabulary Leakage in Active Documentation
- **Location:** [`CLAUDE.md:124, 178, 188`](file:///Users/alex/Code/Projects/starnest/CLAUDE.md#L124); [`docs/arch.md:1198-1210`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L1198-L1210).
- **The Problem:**
  `reqs.md` Appendix A lists retired words that should not be used:
  - *Target $\rightarrow$ Candidate*
  - *Qualified / Eliminated / Screened / Verdict $\rightarrow$ Matching / Not matching*
  - *Eligibility filter $\rightarrow$ MatchRule*
  
  Active occurrences of retired terms remain in:
  - `CLAUDE.md` line 124 ("screening", "qualification threshold"), line 178 ("elimination reporting"), line 188 ("qualification threshold").
  - `arch.md` line 1198 ("screen"), line 1210 ("screened cheaply is expected to eliminate 15–20 clearly unsuitable ones").
- **Recommendation:**
  Replace these instances with the approved vocabulary (`matching`, `not_matching`, `MatchRule`).

---

#### LOW-2: Tooling Command Drift (`just check` vs `make check`)
- **Location:** [`docs/devplan.md:585`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md#L585); [`Makefile`](file:///Users/alex/Code/Projects/starnest/Makefile).
- **The Problem:**
  `devplan.md` Risk table (line 585) states:
  > *"The drift test at Gate A, run in `just check` from then on."*
  The project toolchain uses `make` exclusively (`Makefile`).
- **Recommendation:**
  Update `devplan.md` line 585 from `just check` to `make check`.

---

#### LOW-3: Background Threading vs. `asyncio` Concurrency Model
- **Location:** [`docs/arch.md:797, 850, 1117`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L797).
- **The Problem:**
  `arch.md` §7.1 states that `POST /v1/data-acquisition-runs` *"hands the work to a background thread"*.
  `arch.md` §10.2 specifies `asyncio + httpx` with `asyncio.Semaphore` bounds.
  In Python, running an `asyncio` pipeline in a background thread requires spawning a dedicated event loop or using `asyncio.create_task` on the main FastAPI event loop.
- **Recommendation:**
  Clarify in `arch.md` §7.1 that acquisition runs execute as background asynchronous tasks (`asyncio.Task`) managed by the application event loop.

---

#### LOW-4: Country Attribute Count Approximation in Architecture
- **Location:** [`docs/arch.md:368, 653, 755`](file:///Users/alex/Code/Projects/starnest/docs/arch.md#L368); [`docs/reqs.md:1968-2104`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md#L1968-L2104).
- **The Problem:**
  `arch.md` §3.5 mentions *"32 countries × ~44 country attributes"*.
  `reqs.md` §7.1 and `devplan.md` define exactly **41 country attributes** (and 33 city attributes, summing to 74 total).
- **Recommendation:**
  Update `arch.md` §3.5 to cite "41 country attributes" for consistency.

---

## Actionable Recommendations & Remediation Plan

The following table summarizes the recommended textual and schematic adjustments across the documentation:

| Document | Section / Line | Recommended Change |
|---|---|---|
| [`docs/devplan.md`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md) | Gate A (§3, lines 328, 340) | 1. Clarify that Gate A uses a criteria set without missing `blocks_if_missing` constraints to verify ranking and redistribution arithmetic on Eurostat data.<br/>2. Limit Gate A scale anchor derivation to Eurostat attributes; defer remaining anchors to Gate B. |
| [`docs/devplan.md`](file:///Users/alex/Code/Projects/starnest/docs/devplan.md) | Risk Table (line 585) | Change `just check` $\rightarrow$ `make check`. |
| [`docs/reqs.md`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md) | §3.7a, §7.4 | Replace `RatioBetweenAttributes` archetype with `ThresholdPair` / `ConditionPairWarning` for temperature vs heat days and tax vs cost of living. |
| [`docs/reqs.md`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md) | §3.4 (line 1101) | Clarify that custom criteria sets duplicate all criteria on creation (full copies) and maintain 100% weight sums rather than sparse runtime inheritance. |
| [`docs/reqs.md`](file:///Users/alex/Code/Projects/starnest/docs/reqs.md) | ERD & §3.6 | Update `retrieval_date` and system timestamps to `timestamptz`. Add `citations` relationship to `MATCH_RULE_RESULT`. |
| [`docs/arch.md`](file:///Users/alex/Code/Projects/starnest/docs/arch.md) | §3.2 (line 178) | Adjust `VALUE` natural key / UNIQUE constraint to exclude `timestamptz` retrieval date and include `reference_period_end`. |
| [`docs/arch.md`](file:///Users/alex/Code/Projects/starnest/docs/arch.md) | §6.3, §7.1 | 1. Add `MatchRuleResult` operations to store seams.<br/>2. Clarify `asyncio.Task` background execution. |
| [`docs/openapi.yaml`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml) | `Pillar` schema (line 805) | Remove `level` from `Pillar` schema to conform with `reqs.md` Q187. |
| [`docs/openapi.yaml`](file:///Users/alex/Code/Projects/starnest/docs/openapi.yaml) | Conventions (line 21) | Correct coverage convention from ratio `0–1` to percentage `0–100`. |
| [`CLAUDE.md`](file:///Users/alex/Code/Projects/starnest/CLAUDE.md) | Lines 124, 178, 188 | Replace "screening", "elimination", "qualification threshold" with matching vocabulary. |

---
*Report generated successfully by Antigravity Review Agent.*
