# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**There is no code yet.** The repository holds planning documents only. **`reqs.md` is authoritative for requirements and the ontology — read it first.**

That spec is the authoritative blueprint and should be read before any implementation work. This file summarizes the parts that constrain how code must be written; the spec holds the full criteria lists, weights, and rationale.

## Planning documents

| Document | Status |
|---|---|
| `reqs.md` | **Written.** Requirements and ontology. v1 scope in §1.3, glossary in Appendix A, decision log in Appendix B |
| `datasources.md` | **Written.** Source analysis, market analysis, criterion→source mapping |
| `arch.md` | **Partial.** Ontology and storage settled; stack still open |
| `devplan.md` | Not started |

`relocation-app-master-spec-v1.md` has been **deleted**. Its content was audited against the
successors first: Part 2 → `reqs.md`, Part 3 → `arch.md` §6, Appendix → `datasources.md`. It
remains in git history at the initial commit.

Consequently there are **no build, lint, test, or run commands** — nothing is scaffolded. Do not invent them. When scaffolding begins, add the real commands to this file.

## What this project is

A local, single-user decision-support app for a personal relocation search (EU/EEA + UK + Switzerland, 3–5 year horizon — illustrative only; the move may be permanent). It scores and ranks candidate locations against a weighted, user-configurable criteria set, and explains every number it shows.

## Planned stack (from the spec — confirm before deviating)

Python 3.12+, Streamlit (UI), **PostgreSQL (storage — decided, see `arch.md` §6.2)**, Anthropic API with the `web_search` tool (qualitative criteria), direct HTTP fetch for structured data sources.

Planned module layout:

| Path | Responsibility |
|---|---|
| `config/` | Pillars, criteria, weights, thresholds as data — split by level (country / city) |
| `acquisition/structured.py` | Deterministic fetch of quantifiable data (no LLM) |
| `acquisition/qualitative.py` | Claude API + `web_search`, structured JSON out (score + summary + sources) |
| `storage/db.py` | PostgreSQL schema and access; schema and seed scripts versioned as migrations in git |
| `scoring/engine.py` | Hard filters + weighted score, per level |
| `scoring/compare.py` | Focus candidate vs. N comparators: deltas, weighted contributions, templated synthesis |
| `ui/app.py` | Streamlit app — 4 tabs: config, run, ranking dashboard, comparison |

## Architecture: the two-level pipeline

The central structural idea. Evaluation is **not** uniform across all candidates:

1. **Country level.** Cheap screening across candidate countries using structured sources only, **no LLM calls**. Countries below a qualification threshold are excluded.
2. **City level.** Only for countries that survived the country screen, ~5 cities each. Structured *and* qualitative (LLM + search) acquisition.

**"Phase" is retired** — it named the same axis as `Candidate.level`. There is one concept: **level**, either `country` or `city`.

Both levels share the same machinery: a **Candidate** is either a Country or a City. **Levels are ordered records, not a hardcoded pair** — no third level is in scope, but nothing in the code may assume there are exactly two (`reqs.md` §3.1). Scoring, matching, active-value selection and comparison logic must be written once against `Candidate`, not duplicated per level. *(Comparison roles are **focus** and **comparators**.)* What differs per level is the *data*: each level has its own attribute catalog and its own weights, and **weights sum to 100% within a level, independently of the other**.

## The three ideas the ontology rests on

Read `reqs.md` §3.0 before touching the model. The whole design turns on keeping these apart:

- **Attribute** — something knowable about a place (rent, population, homicide rate). **Objective.** Belongs to a Pillar, declares its value type, sources and `max_age`. An attribute with no criterion attached is descriptive and never scored — there is no separate facts entity.
- **Value** — what that attribute is, for one candidate, from one source, on one date.
- **Criterion** — the rule *you* impose on one attribute: direction, `matching_threshold`, weight. **Subjective.** Lives in a **CriteriaSet** (`alex`, `partner`, `remote-only`), never on the attribute.
- **Evaluation** — one CriteriaSet run against the candidates at one level. **Score, coverage, match status and rank belong here, not to the Candidate** — they change when the criteria set changes.
- **Household** — the single record describing the user: income, size, target spend, home country and city, citizenship. Configured first.

Attributes are grouped into **Pillars** — the load-bearing verticals of a life (economics, housing, career, safety, health, climate, connectivity, nature, culture, governance, family). Pillar weights sum to 100% within a level; criterion weights sum to 100% within a pillar. Scores are **0–100 integers**.

**One match vocabulary, no synonyms.** A candidate is `matching`, `not_matching`, or `insufficient_data`. Never "qualified", "eliminated", "screened", "passed", "failed" or "verdict". Two mechanisms produce a non-match: a criterion's `matching_threshold`, and a **MatchRule** (a named gate — visa, quota, timing — attached to no attribute). A city evaluated although its country does not match is flagged `parent_not_matching`.

## Design invariants

These are cross-cutting rules from the spec. Violating one silently breaks the product's purpose, so treat them as non-negotiable unless the user changes them explicitly.

- **Nothing hardcoded.** The attribute catalog, pillars, default weights, default matching thresholds, and inclusion/exclusion rules live in data (config files or DB rows) and are loaded at startup. Adding an attribute must be a data change, not a logic change. No literal attribute names or weights in application code.
- **Acquisition and scoring are separate operations.** Adjusting a weight or threshold recalculates the score instantly from already-stored data. Score recalculation must **never** trigger a re-fetch. Re-fetching is explicit, per candidate and/or per attribute.
- **Raw data is stored separately from computed scores**, with timestamps. This is what makes the previous invariant possible at ~100 cities.
- **Multi-source, non-destructive active-value selection.** The same attribute may have different values from different sources. A configurable **source priority** decides which value is *active* for the score, but every value from every source stays stored and visible. Selecting an active value never discards data.
- **Two distinct dates per stored value**, never merged or conflated: the **reference date** (what period the data point describes) and the **retrieval date** (when the app fetched it). Both must be displayable together.
- **Full provenance on every displayed number**: source, reference date, retrieval date, and a quote/summary where applicable.
- **Never fabricate a score from missing data.** Sparse coverage (common for small towns on Numbeo/WhereNext) must be flagged as "insufficient data".
- **Data quality is the product.** Raw indicators only. Published composite scores are displayed alongside as `ExternalScore` and **never ingested as inputs** — we do not recycle another product's interpretation. Where no credible measurement exists, the honest answer is "insufficient data", never a plausible-looking number.
- **The LLM inventory in `reqs.md` §6.10 is exhaustive.** Four permitted uses, all `low` confidence, all ranked last in source priority, all required to store and display the pages the model actually read. If a use is not listed there, it is not permitted — adding one is a decision recorded in that section, not a convenience adopted mid-implementation. The LLM is never used for scoring arithmetic or comparison synthesis, and never where a structured source already answers.
- **No authentication or authorisation, ever.** One household, running locally. No accounts, no permissions, no multi-tenancy.
- **Non-matching candidates stay visible**, keeping their computed score, with the reason shown. Do not filter them out of the results view.
- **The comparator limit is 5 by default but must not be hardcoded.** Design it as a configurable bound.
- **Comparisons never mix levels** — all countries or all cities, never both in one comparison. The narrative synthesis (top advantages/disadvantages) is derived from the *weighted contribution* of each delta, not the raw delta, so a large gap on a low-weight criterion doesn't dominate.

## Value types

Each **attribute** declares one of ten semantic value types, and matching thresholds behave differently per type. See `reqs.md` §3.3a for the full table and the validation rules.

`Monetary`, `Quantity`, `Count`, `Ratio`, `Index`, `LabelSet`, `ShareComposition`, `Boolean`, `AssignedScore`, `Text`.

The type determines what a `Value` stores, which normalisation methods are legal (`fixed`, `percentile`, `as_is`), how it displays, and what a `matching_threshold` means. Adding a type is a code change; adding an attribute of an existing type is a pure data change.

## Roles

- **User** (day-to-day): includes/excludes attributes from scoring, adjusts weights, sets directions and matching thresholds — all of which live in a CriteriaSet. Users do **not** add attributes or connect data sources.
- **Developer/Admin**: adds attributes and data sources by editing code/config directly. **There is deliberately no admin UI** — do not build one.

## Scope discipline

**v1 covers the country level only**, with the full feature set applied to it: pillar and criterion configuration, weight profiles, country nomination, acquisition runs, scoring with coverage and confidence, elimination reporting, the ranking dashboard with drill-down and provenance, and comparison. See `reqs.md` §1.3.

**After v1:** the entire city level — city criteria, city nomination, and the LLM + `web_search` acquisition path.

Explicitly **post-MVP — do not build without being asked**: personal annotations, color-gradient maps per property, favorites lists, saved criteria profiles, saved comparisons.

## Conventions

- **All code, UI text, comments, and identifiers must be in English**, regardless of the language used in planning conversations with the user.
- **The app is named Starnest — the code is not.** The name lives in a configuration file as a single display-name parameter, loaded at startup and used only for presentation (page title, UI headings, About text). It must never appear in package names, module names, class names, table names, config keys, or environment-variable prefixes. Renaming the app must be a one-line config change. This is the "nothing hardcoded" invariant applied to the product's own name. The project directory is now `starnest`, and the spec still says `relocation-app`. A directory name is presentation, not an identifier — do not let it pull package, module, or table names along with it.
- Provisional by design: weights, the country-level qualification threshold, and the ~2000–3000 EUR/month budget guideline are all placeholders pending a manual test. Never bake them into logic (see "nothing hardcoded").

## Reference data sources

Starting points for `acquisition/structured.py`: **WhereNext Global Relocation Index** (95 countries + ~130 cities, downloadable CSV/JSON — best fit for country-level screening), **Numbeo** (cost of living, safety, healthcare, pollution; countries and cities), **Teleport Cities** (maintenance status unverified — check before relying on it), **Nomads.com** (subscription, city-level only). See the spec appendix for URLs and caveats.

## Setup note

The qualitative acquisition path requires a dedicated Anthropic API key from console.anthropic.com — billed per usage, separate from a Claude.ai subscription.
