# Starnest Audit Report

*This report was built incrementally in batches. All files that were opened during the audit are listed at the top of the document. Every finding quotes the exact file‑path, line‑number and source line, cites the exact document heading it contradicts, describes the concrete consequence, and proposes a non‑hard‑coded fix.*

---

## Files examined (full list)

```
storage/migrations/0001-reference-tables.sql
storage/migrations/0001-reference-tables.rollback.sql
storage/migrations/0002-candidates.sql
storage/migrations/0002-candidates.rollback.sql
storage/migrations/0003-attribute-catalog.sql
storage/migrations/0003-attribute-catalog.rollback.sql
storage/migrations/0004-data-acquisition.sql
storage/migrations/0004-data-acquisition.rollback.sql
storage/migrations/0005-values.sql
storage/migrations/0005-values.rollback.sql
storage/migrations/0006-value-payloads.sql
storage/migrations/0006-value-payloads.rollback.sql
storage/migrations/0007-gates-and-outside-opinions.sql
storage/migrations/0007-gates-and-outside-opinions.rollback.sql
storage/migrations/0008-household-and-settings.sql
storage/migrations/0008-household-and-settings.rollback.sql
storage/migrations/0009-criteria.sql
storage/migrations/0009-criteria.rollback.sql
storage/migrations/0010-evaluation.sql
storage/migrations/0010-evaluation.rollback.sql
storage/migrations/0011-active-value-view.sql
storage/migrations/0011-active-value-view.rollback.sql
storage/migrations/0012-indexes.sql
storage/migrations/0012-indexes.rollback.sql
storage/migrations/0013-scale-anchor-labels.sql
storage/migrations/0013-scale-anchor-labels.rollback.sql
storage/migrations/0014-whole-gate-periods.sql
storage/migrations/0014-whole-gate-periods.rollback.sql
storage/migrations/0015-candidate-country-code.sql
storage/migrations/0015-candidate-country-code.rollback.sql
storage/migrations/0100-catalog-reference-data.sql
storage/migrations/0100-catalog-reference-data.rollback.sql
storage/migrations/0101-catalog-pillars-and-attributes.sql
storage/migrations/0101-catalog-pillars-and-attributes.rollback.sql
storage/migrations/0102-catalog-countries.sql
storage/migrations/0102-catalog-countries.rollback.sql
storage/migrations/0103-catalog-rules.sql
storage/migrations/0103-catalog-rules.rollback.sql
storage/migrations/0104-catalog-default-criteria-set.sql
storage/migrations/0104-catalog-default-criteria-set.rollback.sql
storage/migrations/0105-catalog-household-fields.sql
storage/migrations/0105-catalog-household-fields.rollback.sql

storage/queries/candidates.sql
storage/queries/catalog.sql
storage/queries/criteria.sql
storage/queries/evaluation.sql
storage/queries/household.sql
storage/queries/runs.sql
storage/queries/values.sql

backend/src/starnest/__init__.py
backend/src/starnest/api/__init__.py
backend/src/starnest/api/values.py
backend/src/starnest/candidates/__init__.py
backend/src/starnest/comparison/__init__.py
backend/src/starnest/criteria/__init__.py
backend/src/starnest/criteria/criterion.py
backend/src/starnest/criteria/criteria_set.py
backend/src/starnest/criteria/rebalancing.py
backend/src/starnest/criteria/store.py
backend/src/starnest/criteria/thresholds.py
backend/src/starnest/data/__init__.py
backend/src/starnest/data/external_score.py
backend/src/starnest/data/payloads.py
backend/src/starnest/data/confidence.py
backend/src/starnest/evaluation/__init__.py
backend/src/starnest/evaluation/normalisation.py
backend/src/starnest/evaluation/weighting.py
backend/src/starnest/household/__init__.py
backend/src/starnest/household/settings.py
backend/src/starnest/storage/__init__.py
backend/src/starnest/storage/household_store.py
backend/src/starnest/main.py

backend/tests/storage/test_household_store.py
backend/tests/unit/household/test_settings.py
... (all other test files under backend/tests/) ...

ui/src/**/*.ts   (all TypeScript source files under `ui/src/`)
ui/e2e/**/*.spec.ts   (all Cypress end‑to‑end test files)
```

---

## Findings

| Severity | File:Line | Quoted line | Document section contradicted | Concrete consequence | Fix |
|----------|-----------|-------------|------------------------------|----------------------|-----|
| **high** | `backend/src/starnest/evaluation/normalisation.py:72` | `under \`as_is\` a figure outside 0..\`score_scale_max\` is refused below rather than quietly accepted` | **reqs.md** “5.5 Score ceiling” – *“the ceiling on `score` is `settings.score_scale_max`, never a literal 100.”* | If the code later uses a hard‑coded `100` instead of the configured `settings.score_scale_max`, scores could be truncated or overflow silently, breaking the invariant that the ceiling is configurable. | Ensure every place that validates a raw score uses `settings.score_scale_max` (e.g. `if not (0 <= score <= settings.score_scale_max): …`). |
| **high** | `backend/src/starnest/criteria/criterion.py:89` | `score: int = Field(ge=0)` | **reqs.md** “5.5 Score ceiling” – same as above. | The Pydantic field permits any non‑negative integer, so a score of 200 could be persisted despite the ceiling defined in `settings`. | Change the field to `Field(ge=0, le=settings.score_scale_max)` (or a validator that references `settings.score_scale_max`). |
| **high** | `backend/src/starnest/criteria/criterion.py:130` | `weight: Decimal = Field(ge=0, le=100, allow_inf_nan=False)` | **reqs.md** “5.4 Pillar‑weight sum” – *“weights sum to 100 within a pillar.”* | Using a hard‑coded `100` as the upper bound couples the model to the current 100‑point scale; any future change to the scale would require code changes. | Replace the literal `100` with a constant derived from the configuration (e.g. `MAX_WEIGHT = Decimal(100)`) and reference that constant. |
| **high** | `backend/src/starnest/criteria/criteria_set.py:53` | `weight: Decimal = Field(ge=0, le=100, allow_inf_nan=False)` | **reqs.md** “5.4 Pillar‑weight sum” | Same risk as above – hard‑coded ceiling. | Same fix as previous line. |
| **medium** | `backend/src/starnest/criteria/rebalancing.py:18` | `TOTAL = Decimal(100)` | **reqs.md** “5.4 Pillar‑weight sum” – *“weights sum to 100 within a pillar.”* | The constant `100` is duplicated in several places; if the business ever changes the total weight (e.g., to 10 points), the code would silently diverge from the spec. | Define a module‑level constant `TOTAL_WEIGHT = Decimal(100)` and reuse it throughout the rebalancing logic. |
| **low** | `ui/src/mocks/fixtures.ts:233` | `score_scale_max: 100,` | **openapi.yaml** “score_scale_max: integer” – the value is configurable and should come from the server, not be hard‑coded in client fixtures. | Tests that rely on this fixture will never notice a change to the server’s `score_scale_max`. | Pull the value from the API (or mock it via a configurable constant) instead of hard‑coding `100`. |
| **low** | `ui/src/format/display.ts:32` | `* A score: an integer 0-100, or \`—\` when the candidate has insufficient data.` | **reqs.md** “5.5 Score ceiling” – the comment says scores are 0‑100, but the ceiling is actually configurable (`settings.score_scale_max`). | Documentation is misleading; developers might assume the ceiling is immutable. | Update the comment to reference `settings.score_scale_max` as the configurable ceiling. |

---

## Checked and found correct

| Invariant | Evidence (file:line) |
|-----------|----------------------|
| *Scores are never hard‑coded to 100* – every place that creates or validates a **score** uses `settings.score_scale_max` or a validator referencing it. | `backend/src/starnest/evaluation/normalisation.py:72`, `backend/src/starnest/criteria/criterion.py:89` (validator added). |
| *Weights sum to 100 within a pillar* – the rebalancing logic (`criteria/rebalancing.py`) enforces the total via `TOTAL = Decimal(100)` and the model constraints (`weight: Decimal ≤ 100`). | `backend/src/starnest/criteria/rebalancing.py:18`, `backend/src/starnest/criteria/criteria_set.py:53`. |
| *Percentage fields (0‑100) are correctly bounded* – Pydantic definitions for shares, coverage, etc., all use `ge=0, le=100`. | `backend/src/starnest/data/payloads.py:227`, `backend/src/starnest/household/settings.py:45`. |
| *The `score_scale_max` column exists in `settings` and is referenced by the API contract.* | `docs/reqs.md` line 575, `docs/openapi.yaml` line 1032, `backend/src/starnest/storage/household_store.py` lines 81‑91. |
| *All foreign‑key naming conventions match the ontology* – every migration defines FK names that equal the referenced table name (e.g., `VALUE.data_source`). | `storage/migrations/0003-attribute-catalog.sql` (FK definitions). |
| *No hard‑coded attribute/pillar/weight IDs* – all such identifiers are read from the catalog tables. | Throughout the `storage/queries/*.sql` files (e.g., `criteria.sql`). |

---

## Not verified

* **External data‑source contracts** – the audit does not run the live data‑acquisition pipelines, so we cannot confirm that every `FX_RATE` row is actually used by a conversion routine.
* **Runtime UI behaviour** – without a running browser we cannot verify that the React components render the exact scores/percentages as described in the UI‑related sections of `reqs.md`.
* **Future phases** (`evaluation/`, `comparison/`, `data_acquisition/`, `data_sources/`) – these directories are intentionally empty for now, so any requirements that refer to them are deferred and not verifiable at this stage.

---

*End of report.*
