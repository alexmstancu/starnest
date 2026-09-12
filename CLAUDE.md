# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**A vertical slice runs end to end: four containers, a real database, 31 European countries
ranked from real Eurostat figures in a browser.** **`docs/reqs.md` is authoritative for
requirements and the ontology — read it first**, and `docs/devplan.md` 0 before doing
implementation work.

| Module | State |
|---|---|
| `candidates/`, `data/`, `household/`, `criteria/`, `storage/` | **Written and tested.** ~99.8% line and branch coverage |
| `evaluation/` | **Written.** Normalisation (`fixed`, `percentile`, `as_is`), redistribution, coverage and its split by confidence, matching, ranking. Pure functions, no I/O. `target_range` scores its band and falls linearly to its zero points (built 2026-09-11). The rules are applied: a compound rule warns or rules out, a gate answered `not_matching` makes a candidate not match while keeping its score, and **an undecided rule never fires** -- which both shipped compound rules are. **The two compound-rule shapes that read a household field belong to the city level.** Eight `fixed` criteria are anchored (Q206, Q209); the rest have no data yet, and would refuse truthfully if they had |
| `api/`, `data_acquisition/`, `data_sources/` | **Written.** 30 of the contract's 40 operations; seven source adapters (Eurostat, World Bank WGI, WHO GHO, IMF WEO, OECD, Open-Meteo, and an estimate from Eurostat's tax-benefit figures); values served with both dates, manual entry where the attribute permits it, and the gates' answers; runs are planned, persisted and pollable, fetch from every source, then let declared stand-ins borrow where nothing answered. **A failure names its source, and a retry asks only the sources that failed about only what they failed on**. **OECD's front door is intermittently Cloudflare-challenged** (`catalog-blockers.md` item 5) |
| `comparison/` | **Written.** Focus against comparators, deltas in the attribute's own unit, weighted contribution, and a synthesis templated from the numbers and ordered by what each gap is worth |
| `ui/` | The shell and **all four tabs**: Configure, Run, Rank with its drill-down, Compare. 130 tests. **It talks to the real backend**, and to a mock only in unit tests. No domain logic: every number on screen is the server's |

**GATE B closed 2026-09-12** — all 32 countries ranked from seven sources, every blocking
attribute answered for every country (proved live by `make live`), the four spot-checked figures
matching their publishers by routes the adapters never use, and selective retry built. **The
family pillar is the one known gap**: OECD blocks scripts, so it waits rather than being
unfinished. **GATE A closed 2026-09-05** — `backend/tests/acceptance/test_gate_a.py` is the gate written
down, seven steps in order against a real database plus two standing checks. 1,300 backend
tests, 98 interface tests. `docs/devplan.md` 0.0 has the step-by-step state and what the gate
deliberately does not cover.

**Figures reach 10 of 11 pillars.** P4 was **ordered by pillar coverage, not adapter
convenience** (`devplan.md` D7): World Bank WGI, then Eurostat extended (career, connectivity,
nature), then WHO (health), the IMF (economics), OECD (tax) and Open-Meteo (climate). Seven
adapters, no shared machinery beyond the `SourceAdapter` contract.

**Family is the one pillar left, and it is blocked on something real rather than on effort.**
It is OECD's, and OECD's API now serves scripts a Cloudflare browser challenge
(`docs/catalog-blockers.md` item 5). **Climate is answered** (D4, Q210): temperature is the
population-weighted mean over each country's five largest places, from GeoNames and Open-Meteo,
for the year and for a summer day and a winter day (Q213: daytime highs, never the night);
sunshine is deliberately not fetched, because Open-Meteo's runs 30% to 68% high, unevenly.

**The shipped set ranks all 32 countries** (2026-09-11). `fixed` is built and the total tax
rate carries the first anchors the catalog has shipped — 35% → 100, 55% → 0, chosen against real
figures (Q206). **Romania, Bulgaria, Croatia, Cyprus and Malta are ranked on an estimated tax
rate** (Q207): OECD omits them, so their rate is estimated from Eurostat's own figures under a
separate `eurostat_estimate` source at `low` confidence, ranked below OECD so it never displaces
a published figure. **Liechtenstein is ranked on Switzerland's figures for three attributes**
(Q208, `0460`): the `stand_in` table declares, per attribute and with a reason, whose figure
stands in where no source covers a candidate, and the copy is stored under the `stand_in`
source at `low` confidence, never as the candidate's own measurement. **Every ranked candidate
now reports `coverage_by_confidence`** (`reqs.md` 5.7) — 51% of Liechtenstein's covered weight
is low-confidence, 8% for the five on the estimate. **Coverage is 57%** since the household
anchored the seven `fixed` criteria with data (Q209, `0462`); what remains uncovered has no data
at all, not merely no anchor.

**The total tax rate (Q205) counts every component, employee's and employer's, over the whole
cost of employment, at 167% of the average wage** — so Romania, which moved contributions onto
the employee in 2018, is not penalised for how it splits the same money. It replaced
`income_tax_effective`, which is retired. `house_price_to_income_ratio` stopped blocking (Q204).

**`cost_of_living_index` was the third and is resolved** (`0443`): typed `Index` with no bounds
declared, it could hold no value at all. A price level index has a *base* (EU27 = 100), not a
range — Romania 65.1, Germany 108.3, Iceland 173.5, and no maximum expensiveness — so it is a
`Quantity` whose unit names the base. `Ratio` could not hold it either, being capped at 100.
**This ontology reserves `Index` for figures whose bounds do the work**, and `life_satisfaction`
already set that precedent.

**`crime_safety_index` was the third and is resolved** (`0442`): it declared Numbeo's 0–100
scale while naming UNODC rank 1, two different quantities. It split into `country.homicide_rate`
— a standardised death rate from Eurostat `sdg_16_10`, answering all 32 — and Numbeo's composite
as an `ExternalScore`, which needs no attribute and no subscription until somebody wants it on
screen. The old attribute is `lifecycle_status = 'retired'`, not deleted.

**The schema was hardened before `evaluation/` was written** (2026-09-05, migrations `0106`-`0114`). Findings from `docs/known-issues.md` closed while every affected table still had zero rows: an evaluation freezes the score scale it used and nothing it stores may leave that scale, a result belongs to its evaluation's level, a non-match reason names the frozen criterion rather than the live one, and a criterion may only judge an attribute that has a pillar. **`evaluation/` must supply `score_scale_max` when it saves, and must refuse rather than substitute 100 when `settings.score_scale_max` is unset.** **Freshness has inputs** (`0111`): `reqs.md` 7.1 gives every attribute a `max_age`, derived from its source's publication interval rather than chosen one by one. **A monetary conversion must name a rate the ECB published** (`0112`). **A criterion may only score a figure with a magnitude** (`0122`, D6): three `LabelSet` criteria claimed to be scoreable and a CHECK now forbids it. Eleven findings remain open, all low; `known-issues.md` opens with what they are.

## Layout

```
storage/      ALL the SQL, and nothing else
  migrations/     yoyo, plain .sql — schema AND catalog
  queries/        aiosql, loaded at runtime by the storage module
backend/      Python. The API and every domain rule
  src/starnest/   the ten modules of arch.md 6.1
  tests/          unit, storage, acceptance
ui/           TypeScript. A client of the contract, over HTTP only
  src/  e2e/      React; Playwright specs owned by the master agent
docs/         reqs.md, arch.md, datasources.md, devplan.md, known-issues.md
                openapi.yaml (target) + openapi.implemented.yaml (generated)
tools/        the three structural audits
compose.yaml  four containers: database, backend, ui, schema diagram
Makefile      every command the project has
```

**`storage/` is a top-level peer because SQL is a system asset, not a Python implementation detail.** Someone applying the migrations from a shell script, or opening a query in `psql` to debug it, should not have to know where a Python package hides its internals. The `storage/` **module** under `backend/src/starnest/` holds only the Python that loads and runs what lives here — that is the adapter, this is the asset. Decided 2026-09-01 (`reqs.md` Q200).

**`backend/` and `ui/` are peers that share no code** — not even DTO definitions (`arch.md` 6.1). There is deliberately no top-level `src/` containing both. The only file they share is `docs/openapi.yaml`: the hand-written contract the backend is written against and the interface generates its typed client from. **The backend does not generate it** — see "Two contracts" below.

## Planning documents

| Document | Status |
|---|---|
| `docs/reqs.md` | **Written.** Requirements and ontology. v1 scope in section 1.3, glossary in Appendix A, decision log in Appendix B |
| `docs/datasources.md` | **Written.** Source analysis, market analysis, criterion→source mapping |
| `docs/arch.md` | **Written, MVP scope.** Ontology, storage, module architecture, runtime flows, the interface, operations. Stack decided (section 10.2). **Revised before post-MVP work** |
| `docs/openapi.yaml` | **Written.** The REST contract — 40 operations, of which 30 are served. The **target**, hand-written and deliberately ahead of the code. `docs/openapi.implemented.yaml` is the generated **truth**; see "Two contracts" below |
| `docs/devplan.md` | **Written, MVP scope only.** Delivery model, 8 phases, 4 e2e gates, agent decomposition. Blocking decisions in section 7; the MVP boundary and what follows it in section 8. **Post-MVP gets a revised `arch.md` and a second `devplan.md`, not an extension of this one** |

**Read `docs/devplan.md` 0 before doing implementation work** — the stop rule, the definition of done per task, and which files an agent may not edit.

## Commands

`make` on its own lists them all. The ones that matter:

| Command | Does |
|---|---|
| `make env` | Create `.env` from `.env.example` |
| `make up` / `make down` | PostgreSQL only, for running backend and UI from the command line |
| `make test` | Fast unit tests, no coverage |
| `make coverage` / `make coverage-open` | Full suite with coverage; **fails below 85%**. HTML at `backend/htmlcov/` |
| `make live` | The tests that call real third-party sources: whether the captured fixtures still match, and Gate B's all-32 coverage. **Never part of `make check`** |
| `make boundaries` | `import-linter` — `arch.md` 6.2 as something a build fails on |
| `make audit` | The three structural audits below |
| `make openapi` | Regenerate `docs/openapi.implemented.yaml`. **Run after changing any endpoint** — a test fails when it is stale |
| `make serve` / `make acquire` / `make rank` | Run the API; fetch real figures from every source, then the stand-ins; print the ranking from what is stored (`make rank SET=local_employment` for the shipped set) |
| **`make check`** | **Backend lint + boundaries + coverage + audits, then `ui-check`. Both sides. This is the gate** |
| `make migrate` | Backs up first, then applies migrations. **Never automatic** (`arch.md` 7.4) |
| `make ui-check` | The interface gate: `ui-lint` (eslint, type-aware) + `ui-typecheck` + `ui-coverage` (85% bar) |
| `make ui-coverage` / `make e2e` | Interface coverage (85% bar); Playwright |
| `make docker-build` / `docker-up` / `docker-migrate` / `docker-down` | The four containers: database, backend, the interface on `127.0.0.1:5173`, and the live schema diagram on `127.0.0.1:4174` (`docker compose restart schema-diagram` after a migration) |
| `make schema-diagram` / `schema-diagram-open` | Interactive ER diagram of the **live** schema, via Liam ERD. Output is generated and gitignored — run `make migrate` first, or the diagram shows the schema you have rather than the one you wrote |

**The three audits.** The first two predate the code:

```
uv run --no-project python tools/audit_ontology.py
uv run --no-project --with pyyaml python tools/audit_api.py
uv run --no-project python tools/audit_coverage.py
```

The first checks the ontology's structural invariants — the two diagrams against each other, the diagrams against the prose documenting them, and the catalog's weights. The second checks `docs/openapi.yaml`: that every `$ref` resolves, that **every ontology entity is reachable through the API** (with a named exemption for each covered under another name), and that no key has a null value — the fault that is valid YAML but crashes consumers. The third holds **each package of `arch.md` 6.1 to the 85% bar on its own**, reading `backend/coverage.json` that `make coverage` writes — so `make audit` after `make coverage`, which is the order `make check` already runs them in.

**Run the first two after any change to `reqs.md` 3, either diagram, the catalog, or the contract.** Exit code 0 means every invariant holds. All three read only and never edit.

## Test coverage

**85% of lines and 85% of branches, both sides**, configured in `backend/pyproject.toml` and `ui/vite.config.ts`. Below the bar the command fails.

**Raised from 75 on 2026-09-05, because 75 had stopped being a check.** Both sides sit near 98%, so a three-quarters floor left roughly a fifth of the suite deletable without the gate noticing. A floor only checks anything when it sits close enough to reality that a real regression trips it.

**Held per package, not just globally** (`tools/audit_coverage.py`). A global floor hides a bad neighbourhood: at 3,400 measurable points a new 100-point module at zero moves the total by three points and trips nothing. Each package of `arch.md` 6.1 clears 85% on its own, so a failure reads as "evaluation is under-tested" rather than "something, somewhere, is". The interface does the same with vitest's per-directory thresholds, holding `src/routes`, `src/api` and `src/shell` to 95% lines and 88% branches.

**Deliberately not per file.** Eighteen of the seventy-five backend files have fewer than ten measurable points, where one uncovered line costs more than ten percentage points. A per-file rule would spend its credibility on noise.

**`src/mocks/` and `src/testing/` are excluded from interface coverage** — they are the msw server and the render helper, and measuring them was the tests testing themselves. It also flattered the total: 308 of 1,287 measured lines were scaffolding, and product branch coverage is 95.9% rather than the 92.8% the mixed figure reported.

**It is a floor on the code, not a ceiling on the testing.** The target is full coverage of features and functionality; the percentage catches only one failure mode — a region of code nobody ran at all. "Coverage is green" is never the argument that a task is tested. Always cover the sad path: errors, edges, empty and missing input.

## Configuration and secrets

**Nothing is configured in code.** Two kinds, kept apart (`arch.md` 7.5):

| | Technical | Domain |
|---|---|---|
| What | Connection string, API key, ports, log level | Attributes, weights, thresholds, sources |
| Where | **`.env`**, read only by the composition root | **Database rows**, shipped as migrations |
| In git? | **Never** — `.env.example` documents the shape with placeholders | Yes, as migrations |

**`.gitignore` ignores every `.env*` and re-includes only `.env.example`**, so a new variant is ignored by default rather than by someone remembering. **Never commit an API key.** The Anthropic key is read once at startup, held by the LLM adapter, and reaches no log, no database row and no error message — `Environment.__repr__` redacts it, and a test asserts that.

**No environment variable is prefixed with the product name** — `DATABASE_URL`, `ANTHROPIC_API_KEY`, `LOG_LEVEL`. `APP_DISPLAY_NAME=Starnest` is the one place the name appears, as a value.

## Caching — deliberately none

**No caching layer in the MVP**, decided 2026-08-30. Not an oversight: the expensive thing is already cached by the design. Values are fetched once and stored, and score recalculation never re-fetches (`reqs.md` 5.6) — **the `value` table is the cache**. What remains is two queries and pure arithmetic over 32 candidates. Adding a cache would add an invalidation problem to something already fast, and a stale ranking that looks plausible is the exact failure this application exists to prevent. Revisit only on a measurement, not an intuition.

## What this project is

A local, single-user decision-support app for a personal relocation search (EU/EEA + UK + Switzerland, 3–5 year horizon — illustrative only; the move may be permanent). It scores and ranks candidate locations against a weighted, user-configurable criteria set, and explains every number it shows.

## The stack — decided, not proposed

**Decided** (`arch.md` 10.2). Backend: **Python 3.12+**, **FastAPI + Pydantic v2**, **asyncio + httpx**, **psycopg3** async with **aiosql** (queries live in `.sql` files, driver name `apsycopg`), **yoyo-migrations** (plain `.sql`, explicit `make migrate`), **ruff**, **pytest**, **import-linter** enforcing section 6.2. Interface: **React + TypeScript** under `ui/`, built with Vite, tested with Vitest and Playwright, client generated from `docs/openapi.yaml`. Storage: **PostgreSQL**. LLM: the official Anthropic Python SDK with the `web_search` tool.

**Everything is managed by `uv`** — `uv add`, `uv add --dev`, `uv run`. Never `pip`, never the system Python.

**Two contracts, with different jobs.** `docs/openapi.yaml` is **the target**: hand-written, 40 operations, deliberately ahead of the code, and the file the interface generates its typed client from. Nothing regenerates it and nothing should — doing so would delete every operation not yet built. `docs/openapi.implemented.yaml` is **the truth**: generated by `make openapi` from the routes FastAPI has, committed, so the gap between design and reality is countable rather than remembered. `tests/unit/test_contract_drift.py` holds them together — the generated file must be fresh, nothing may be served that was never designed, and every implemented operation keeps its designed id and path shape.

**The acceptance suite validates every response against the target**, not against our own models: an assertion written beside an endpoint restates what its author meant, while the design was written earlier for a different consumer. Only the second kind catches "I meant the wrong thing".

Module layout, all under `backend/src/starnest/` (`arch.md` 6.1) — **named after the domain, not technical roles**:

| Path | Responsibility |
|---|---|
| `candidates/` | Candidate, Level, the nesting rule. Imports nothing |
| `data/` | Attribute, Value, the ten value types, sources, provenance, confidence, the active-value rule |
| `household/` | The household record |
| `criteria/` | CriteriaSet, Criterion, thresholds, weight rebalancing |
| `data_acquisition/` | Runs, spend cap, retry, the `SourceAdapter` contract |
| `evaluation/` | Normalisation, redistribution, coverage, matching, ranking, snapshots |
| `comparison/` | Focus vs comparators, deltas, synthesis |
| `api/` | The REST surface. **This is the presenter** — use cases return DTOs, `api/` serialises them |
| `data_sources/`, `storage/` | **Plugins.** Implement interfaces the policy modules declare; no policy lives here |

**The interface is built for behaviour first, appearance later.** Until the application is code-complete, `ui/` work goes into what the screens *do* — state, data flow, error handling, accessibility semantics — and not into how they look. There is no visual design yet and inventing one costs twice: once to write and once to undo. Keep the visuals shallow and easy to swap: semantic HTML, roles and labels that a test can find, and styling confined to `styles.css` rather than spread through components. A considered design pass happens with Claude Design once the behaviour is settled.

**The interface is a separate client, not a layer.** It reaches the backend only over HTTP, shares no code with it — not even DTO definitions — and appears nowhere in its dependency graph. The acceptance suite is another client of the same contract, which is what makes the API a real boundary rather than an intention.

**The dependency rule is enforceable, not aspirational:** no policy module may import a plugin, the import table in `arch.md` 6.1 is exhaustive, and **`data/` may never import `criteria/`, `household/` or `evaluation/`** — that last one is the objective/subjective invariant expressed as imports.

## Architecture: the two-level pipeline

The central structural idea. Evaluation is **not** uniform across all candidates:

1. **Country level.** A cheap first pass across candidate countries using structured sources only, **no LLM calls**. Cities are nominated only for countries whose `match_status` is `matching` under the active criteria set — there is no separate score cutoff, and no field ever held one.
2. **City level.** Only for countries that survived the country screen, ~5 cities each. Structured *and* qualitative (LLM + search) data acquisition.

**"Phase" is retired** — it named the same axis as `Candidate.level`. There is one concept: **level**, either `country` or `city`.

Both levels share the same machinery: a **Candidate** is either a Country or a City. **Levels are ordered records, not a hardcoded pair** — no third level is in scope, but nothing in the code may assume there are exactly two (`reqs.md` 3.1). Scoring, matching, active-value selection and comparison logic must be written once against `Candidate`, not duplicated per level. *(Comparison roles are **focus** and **comparators**.)* What differs per level is the *data*: each level has its own attribute catalog and its own weights, and **weights sum to 100% within a level, independently of the other**.

## The three ideas the ontology rests on

Read `reqs.md` 3.0 before touching the model. The whole design turns on keeping these apart:

- **Attribute** — something knowable about a place (rent, population, homicide rate). **Objective.** Belongs to a Pillar, declares its value type, sources and `max_age`. An attribute with no criterion attached is descriptive and never scored — there is no separate facts entity.
- **Value** — what that attribute is, for one candidate, from one source, on one date.
- **Criterion** — the rule *you* impose on one attribute: `goal` (`minimise`/`maximise`/`target_range`), matching threshold, weight. **Subjective.** Lives in a **CriteriaSet** (`alex`, `partner`, `remote-only`), never on the attribute. `is_scored` says whether it counts; `blocks_if_missing` says whether its absence makes the candidate unscoreable.
- **Evaluation** — one CriteriaSet run against the candidates at one level. **Score, coverage, match status, rank and `parent_not_matching` belong here, not to the Candidate** — they change when the criteria set changes.
- **Household** — the single record describing the user: income, size, target spend, home country and city, citizenship. Configured first.

Attributes are grouped into **Pillars** — the load-bearing verticals of a life (economics, housing, career, safety, health, climate, connectivity, nature, culture, governance, family). Pillar weights sum to 100% within a level; criterion weights sum to 100% within a pillar. Scores are **0–100 integers**.

**One match vocabulary, no synonyms.** A candidate is `matching`, `not_matching`, or `insufficient_data`. Never "qualified", "eliminated", "screened", "passed", "failed" or "verdict". Two mechanisms produce a non-match: a criterion's `matching_threshold`, and a **MatchRule** (a named gate — visa, quota, timing — attached to no attribute). A city evaluated although its country does not match is flagged `parent_not_matching`.

## Design invariants

These are cross-cutting rules from `docs/reqs.md`. Violating one silently breaks the product's purpose, so treat them as non-negotiable unless the user changes them explicitly.

- **Nothing hardcoded.** The attribute catalog, pillars, default weights, default matching thresholds, and inclusion/exclusion rules are **rows in database tables**, seeded and changed by migrations versioned in git — never config files (`arch.md` 1.2). One store, so nothing can drift; catalog changes get referential integrity, the same audit trail as every other table, and transactions. Adding an attribute must be a data change, not a logic change. No literal attribute names or weights in application code.
- **Data acquisition and scoring are separate operations.** Adjusting a weight or threshold recalculates the score instantly from already-stored data. Score recalculation must **never** trigger a re-fetch. Re-fetching is explicit, per candidate and/or per attribute.
- **Raw data is stored separately from computed scores**, with timestamps. This is what makes the previous invariant possible at ~100 cities.
- **Multi-source, non-destructive active-value selection.** The same attribute may have different values from different sources. A configurable **source priority** decides which value is *active* for the score, but every value from every source stays stored and visible. Selecting an active value never discards data.
- **Two distinct dates per stored value**, never merged or conflated: the **reference date** (what period the data point describes) and the **retrieval date** (when the app fetched it). Both must be displayable together.
- **Full provenance on every displayed number**: source, reference date, retrieval date, and a quote/summary where applicable.
- **Never fabricate a score from missing data.** Sparse coverage (common for small towns on Numbeo/WhereNext) must be flagged as "insufficient data".
- **Data quality is the product.** Raw indicators only. Published composite scores are displayed alongside as `ExternalScore` and **never ingested as inputs** — we do not recycle another product's interpretation. Where no credible measurement exists, the honest answer is "insufficient data", never a plausible-looking number.
- **The LLM inventory in `reqs.md` 6.10 is exhaustive.** Four permitted uses, all `low` confidence, all ranked last in source priority, all required to store and display the pages the model actually read. If a use is not listed there, it is not permitted — adding one is a decision recorded in that section, not a convenience adopted mid-implementation. The LLM is never used for scoring arithmetic or comparison synthesis, and never where a structured source already answers.
- **No authentication or authorisation, ever.** One household, running locally. No accounts, no permissions, no multi-tenancy.
- **Non-matching candidates stay visible**, keeping their computed score, with the reason shown. Do not filter them out of the results view.
- **The comparator limit is 5 by default but must not be hardcoded.** Design it as a configurable bound.
- **Comparisons never mix levels** — all countries or all cities, never both in one comparison. The narrative synthesis (top advantages/disadvantages) is derived from the *weighted contribution* of each delta, not the raw delta, so a large gap on a low-weight criterion doesn't dominate.

## Value types

Each **attribute** declares one of ten semantic value types, and matching thresholds behave differently per type. See `reqs.md` 3.3a for the full table and the validation rules.

`Monetary`, `Quantity`, `Count`, `Ratio`, `Index`, `LabelSet`, `ShareComposition`, `Boolean`, `AssignedScore`, `Text`.

The type determines what a `Value` stores, which normalisation methods are legal (`fixed`, `percentile`, `as_is`), how it displays, and what a `matching_threshold` means. Adding a type is a code change; adding an attribute of an existing type is a pure data change.

## Roles

- **User** (day-to-day): includes/excludes attributes from scoring, adjusts weights, sets directions and matching thresholds — all of which live in a CriteriaSet. Users do **not** add attributes or connect data sources.
- **Developer/Admin**: adds attributes and data sources by editing code/config directly. **There is deliberately no admin UI** — do not build one.

## Scope discipline

**v1 covers the country level only**, with the full feature set applied to it: pillar and criterion configuration, weight profiles, country nomination, data acquisition runs, scoring with coverage and confidence, non-match reporting, the ranking dashboard with drill-down and provenance, and comparison. See `reqs.md` 1.3.

**After v1:** the entire city level — city criteria, city nomination, and the LLM + `web_search` data acquisition path.

Explicitly **post-MVP — do not build without being asked**: personal annotations, color-gradient maps per property, favorites lists, saved criteria profiles, saved comparisons.

## Conventions

- **All code, UI text, comments, and identifiers must be in English**, regardless of the language used in planning conversations with the user.
- **The app is named Starnest, and the code borrows the name exactly once.** The **top-level Python package is `starnest`** (`src/starnest/`) — decided 2026-08-30. That is the only place the product name is an identifier. It must never appear in **class names, table names, config keys, environment-variable prefixes, or comments**: `StarnestNormaliser` and a `starnest_value` table are the actual failure this rule exists to prevent, because those are the occurrences a rename cannot mechanically find. A rename means one `git mv` plus a find-and-replace over import lines, and nothing else. The display name itself stays a single config parameter, loaded at startup and used only for presentation (page title, UI headings, About text). This is the "nothing hardcoded" invariant applied to the product's own name.
- Provisional by design: weights, matching thresholds, scale anchors and the ~2000–3000 EUR/month budget guideline are all placeholders pending a manual test. Never bake them into logic (see "nothing hardcoded").

## Reference data sources

Starting points for the structured adapters in `data_sources/`: **WhereNext Global Relocation Index** (95 countries + ~130 cities, downloadable CSV/JSON — best fit for the country level), **Numbeo** (cost of living, safety, healthcare, pollution; countries and cities), **Teleport Cities** (maintenance status unverified — check before relying on it), **Nomads.com** (subscription, city-level only). See `docs/datasources.md` for URLs and caveats.

## Setup note

The qualitative data acquisition path requires a dedicated Anthropic API key from console.anthropic.com — billed per usage, separate from a Claude.ai subscription.
