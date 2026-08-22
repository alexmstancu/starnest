# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**There is no code yet.** Apart from this file, the repository contains only `relocation-app-master-spec-v1.md`, the master specification. It is not a git repository yet.

That spec is the authoritative blueprint and should be read before any implementation work. This file summarizes the parts that constrain how code must be written; the spec holds the full criteria lists, weights, and rationale.

## Planning pipeline

Three documents get written, in order, before any code:

1. `reqs.md` — requirements; what is MVP vs. post-MVP
2. `arch.md` — architecture; stack, storage, system structure
3. `devplan.md` — implementation tasks, sequencing, testing strategy

The master spec is being refined into these and **will be deleted once its content has landed**:
Part 2 (Functional Requirements) → `reqs.md`; Part 3 (Technical Specification) → `arch.md`;
Part 1 (Evaluation Protocol — criteria, weights, hard filters) → **config data, not prose**,
per the "nothing hardcoded" invariant. Do not delete the spec before all three destinations exist.

Consequently there are **no build, lint, test, or run commands** — nothing is scaffolded. Do not invent them. When scaffolding begins, add the real commands to this file.

## What this project is

A local, single-user decision-support app for a personal relocation search (EU/EEA + UK + Switzerland, 3–5 year horizon — illustrative only; the move may be permanent). It scores and ranks candidate locations against a weighted, user-configurable criteria set, and explains every number it shows.

## Planned stack (from the spec — confirm before deviating)

Python 3.12+ · Streamlit (UI) · SQLite (storage) · Anthropic API with the `web_search` tool (qualitative criteria) · direct HTTP fetch for structured data sources.

Planned module layout:

| Path | Responsibility |
|---|---|
| `config/` | Criteria, weights, thresholds as data — split Phase 1 (country) / Phase 2 (city) |
| `acquisition/structured.py` | Deterministic fetch of quantifiable data (no LLM) |
| `acquisition/qualitative.py` | Claude API + `web_search`, structured JSON out (score + summary + sources) |
| `storage/db.py` | SQLite schema and access |
| `scoring/engine.py` | Hard filters + weighted score, per phase |
| `scoring/compare.py` | Target vs. N comparators: deltas, weighted contributions, narrative synthesis |
| `ui/app.py` | Streamlit app — 4 tabs: config, run, ranking dashboard, comparison |

## Architecture: the two-phase pipeline

The central structural idea. Evaluation is **not** uniform across all candidates:

1. **Phase 1 — country level.** Cheap screening across ~30 countries using structured sources only, **no LLM calls**. Countries below a qualification threshold are excluded.
2. **Phase 2 — city level.** Only for countries that survived Phase 1, ~5 cities each. Structured *and* qualitative (LLM + search) acquisition.

Both phases share the same machinery: a **Target** is either a Country or a City — same base structure, different level. Scoring, filtering, and comparison logic must be written once against `Target`, not duplicated per phase. What differs per phase is the *data*: each phase has its own criteria set and its own weights, and **weights sum to 100% within a phase, independently of the other phase**.

Hard filters are eligibility gates (yes/no), evaluated separately from the weighted score — a failed filter eliminates the candidate regardless of score.

## Design invariants

These are cross-cutting rules from the spec. Violating one silently breaks the product's purpose, so treat them as non-negotiable unless the user changes them explicitly.

- **Nothing hardcoded.** The criteria catalog, default weights, default thresholds, and inclusion/exclusion rules live in data (JSON or DB records) and are loaded at startup. Adding a criterion must be a data change, not a logic change. No literal criterion names or weights in application code.
- **Acquisition and scoring are separate operations.** Adjusting a weight or threshold recalculates the score instantly from already-stored data. Score recalculation must **never** trigger a re-fetch. Re-fetching is explicit, per target and/or per criterion.
- **Raw data is stored separately from computed scores**, with timestamps. This is what makes the previous invariant possible at ~100 cities.
- **Multi-source, non-destructive resolution.** The same property may have different values from different sources. A configurable **source priority** decides which value is *active* for the score, but every value from every source stays stored and visible. Resolution never discards data.
- **Two distinct dates per stored value**, never merged or conflated: the **reference date** (what period the data point describes) and the **retrieval date** (when the app fetched it). Both must be displayable together.
- **Full provenance on every displayed number**: source, reference date, retrieval date, and a quote/summary where applicable.
- **Never fabricate a score from missing data.** Sparse coverage (common for small towns on Numbeo/WhereNext) must be flagged as "insufficient data". LLM + `web_search` may serve as a fallback source for *quantifiable* criteria too, not only subjective ones — but as a labeled source, subject to the same priority and provenance rules.
- **Eliminated candidates stay visible**, with the reason for elimination shown. Do not filter them out of the results view.
- **The comparator limit is 5 by default but must not be hardcoded.** Design it as a configurable bound.
- **Comparisons never mix levels** — all countries or all cities, never both in one comparison. The narrative synthesis (top advantages/disadvantages) is derived from the *weighted contribution* of each delta, not the raw delta, so a large gap on a low-weight criterion doesn't dominate.

## Criterion types

Each criterion declares its type, and thresholds behave differently per type:

- **numeric** — threshold is an acceptable range `[X, Y]`
- **list of numbers** — e.g. a value series across years
- **list of enum/label values** — threshold is "must contain" / "must not contain"
- **free text with source** — qualitative criteria (e.g. "atmosphere")

## Roles

- **User** (day-to-day): selects/deselects criteria from the existing catalog, adjusts weights, sets elimination thresholds. Users do **not** add criteria or connect data sources.
- **Developer/Admin**: adds criteria and data sources by editing code/config directly. **There is deliberately no admin UI** — do not build one.

## Scope discipline

MVP is: criteria configuration, the two-phase run, the ranking dashboard with per-criterion drill-down, and the comparison view.

Explicitly **post-MVP — do not build without being asked**: personal annotations, color-gradient maps per property, favorites lists, saved criteria profiles, saved comparisons.

## Conventions

- **All code, UI text, comments, and identifiers must be in English**, regardless of the language used in planning conversations with the user.
- **The app is named Starnest — the code is not.** The name lives in a configuration file as a single display-name parameter, loaded at startup and used only for presentation (page title, UI headings, About text). It must never appear in package names, module names, class names, table names, config keys, or environment-variable prefixes. Renaming the app must be a one-line config change. This is the "nothing hardcoded" invariant applied to the product's own name. The project directory is now `starnest`, and the spec still says `relocation-app`. A directory name is presentation, not an identifier — do not let it pull package, module, or table names along with it.
- Provisional by design: weights, the Phase 1 qualification threshold, and the ~2000–3000 EUR/month budget guideline are all placeholders pending a manual test. Never bake them into logic (see "nothing hardcoded").

## Reference data sources

Starting points for `acquisition/structured.py`: **WhereNext Global Relocation Index** (95 countries + ~130 cities, downloadable CSV/JSON — best fit for Phase 1), **Numbeo** (cost of living, safety, healthcare, pollution; countries and cities), **Teleport Cities** (maintenance status unverified — check before relying on it), **Nomads.com** (subscription, city-level only). See the spec appendix for URLs and caveats.

## Setup note

The qualitative acquisition path requires a dedicated Anthropic API key from console.anthropic.com — billed per usage, separate from a Claude.ai subscription.
