# Detailed plan: Backend API boundary, evaluation, comparison and tooling

> Written on 2026-10-14 by a read-only planning agent against `c943761`, before the scope rule of 2026-10-15. It is the step-by-step detail behind [copilot-remediation-plan.md](../copilot-remediation-plan.md). Where the two differ (scope, decisions, order), the main plan wins.

All seven findings are still at least partly open at HEAD (c943761). The plans below change no shipped ranking, with one exception: BE-07 moves the confidence split, but never a score or a rank. BE-07 and BE-23 each need a decision from you before they're built. Nothing was edited or run; every claim below comes from reading the code.

Paths: `src/` means `backend/src/starnest/`, `tests/` means `backend/tests/`.

### BE-01 [High] A threshold on an excluded criterion never rules anything out
- **Still present at HEAD?** Partly.
  - `src/evaluation/rules.py:197-221` `thresholds_that_rule_out` now judges all four threshold shapes.
  - But `src/evaluation/ranking.py:444` hands it `scored_criteria`, built at `:81` by `_criteria_to_score` (`:186-202`), which keeps only criteria where `counts_toward_coverage` (= `is_scored`) is true.
  - Every LabelSet criterion is `is_scored=false` by `0122`'s CHECK, so a label threshold can never fire.
  - Both `d6-scale-anchors.md:77-78` and `0122`'s header say an excluded criterion "still gates".
- **Root cause:** one list ("what is scored") answers two questions: what earns weight and coverage, and what is judged for eligibility.
- **Fix:**
  1. `ranking.py`: add `_criteria_at(criteria, level)`, which returns every criterion at the level, scored or not. `_criteria_to_score` filters that list on `counts_toward_coverage`.
  2. `ranking._result_for` calls `thresholds_that_rule_out(_criteria_at(criteria, level), candidate_values)`. It already receives `criteria` and `level`. Weights, readings, coverage, blocking and the breakdown keep using `scored_criteria`.
  3. `rules.py`: rename the parameter `scored_criteria` → `criteria`. The docstring should say that excluding a criterion takes it out of weights and coverage, never out of matching.
  4. Correct the stale docstrings that say thresholds and match rules are "deliberately not here": `ranking.py:12-17` and `src/evaluation/__init__.py:7-11`.
  - Callers checked:
    - The live ranking, the live drill-down, the comparison and `POST /evaluations` all go through `api/rankings.the_ranking` → `rank_candidates`; `scripts/rank.py` calls `rank_candidates` directly. All inherit the fix.
    - The saved snapshot freezes every criterion at the level (`storage/evaluation_store.py:97-101`), so the FK `non_match_reason_names_a_frozen_criterion` (`0482`) still holds when a reason names an excluded criterion.
    - The UI prints only `reason_detail` (`RankingTable.tsx:373`).
    - Comparison rows come from `attribute_scores`; it is correct that they list scored criteria only.
- **Tests first:**
  - Fails today: `tests/unit/evaluation/test_ranking.py::TestAMatchingThresholdRulesOut::test_an_excluded_criterions_threshold_still_rules_the_candidate_out`.
    - Set-up: RENT excluded, with `RangeThreshold(max_value=50)`.
    - Asserts Portugal (90) is not_matching, with `reason.criterion == RENT`, its score kept, coverage 100, and RENT absent from `attribute_scores`.
    - Asserts Spain (10) is matching.
  - Follow-up unit tests:
    - `test_a_label_threshold_on_an_unscored_label_set_criterion_rules_out` (must_not_contain).
    - `test_an_excluded_criterion_with_no_figure_rules_nothing_out`.
    - `test_an_excluded_threshold_moves_no_weight_and_no_coverage`: score, coverage and breakdown are identical with and without the threshold.
    - `test_a_criterion_at_another_level_is_not_judged`.
    - `tests/unit/evaluation/test_rules.py::test_an_unscored_criterion_is_judged_like_any_other`.
  - Storage guard (passes before too; it locks the FK the fix depends on): `tests/storage/test_evaluation_store.py::TestTheRulesTravelWithTheResult::test_a_reason_naming_an_excluded_criterion_is_kept`, saving `NonMatch(criterion=country.climate_zone)`.
  - Acceptance, in `tests/acceptance/test_endpoints.py::TestTheThresholdThatDecidesAMatch`:
    - `test_a_threshold_on_an_excluded_criterion_rules_a_candidate_out`: PATCH the scratch OVERBURDEN with `{"is_scored": false, "matching_threshold": {"max_value": 50}}`, seed figures, then GET `/rankings`. Greece is not_matching and names that criterion; Portugal is matching.
    - `test_a_saved_ranking_keeps_that_reason`: `POST /evaluations` returns 201 and the reason reads back.
- **Migration / contract / docs:**
  - No migration and no contract change.
  - `docs/reqs.md` 5.3 (the "`included: false`" paragraph, around line 1792) and the glossary row (around 2959) gain "its matching threshold still applies".
- **Files touched:** `src/evaluation/ranking.py`, `src/evaluation/rules.py`, `src/evaluation/__init__.py`, `docs/reqs.md`, and the four test files above.
- **Behaviour change & risks:**
  - A threshold on an excluded criterion now makes a candidate not_matching; it keeps its score and gets no rank.
  - No shipped threshold exists (`0104:47`).
  - The UI can't set one either: it neither toggles `is_scored` nor edits non-range thresholds, and the shipped excluded criteria are LabelSet ones, which refuse a range threshold.
  - So shipped rankings are unchanged unless someone set such a threshold through the API. I couldn't check the database.
- **Depends on / conflicts with:** BE-31 (`ranking.py`, `evaluation/__init__.py`); BE-07 (`test_endpoints.py`, in a different class).
- **Effort:** S.
- **Needs a user decision?** No. `d6-scale-anchors.md:77-78` and `0122` already settle the meaning.

### BE-21 [Medium] A domain refusal raised while building an object from the request still answers 500
- **Still present at HEAD?** Partly.
  - What landed: the `RequestValidationError` handler (`src/api/errors.py:202-230`) and bounds on the settings and household bodies.
  - What remains: `errors.py:147-170` re-raises any pydantic `ValidationError`, because nothing in its class hierarchy is mapped. That leaves these 500s:
    - `api/household.py:66-77`: malformed candidate ids (`MalformedIdentifierError`), a home city outside the home country, and a citizenship at city level (`HouseholdPlaceError`).
    - `api/criteria.py:304`, via `the_scoring_rule`:
      - `ScaleAnchor(...)` at `:178`: a blank label is a wrapped `CriterionDeclarationError`; a negative score or non-finite input is a pydantic-native error.
      - `_the_threshold_in` at `:186-224`: an inverted or bound-less range, a share outside 0-100 or with a blank label, or an unknown containment rule (`ThresholdShapeError`).
    - `api/values.py:132-135`: an inverted period on a manual value.
    - `api/values.py:139`: a malformed breakdown option. This one is unwrapped but has no mapping.
    - Not in the tracker:
      - `api/rules.py:385-401`: an inverted period, a `retrieval_date` without a timezone, or `override_reason: ""` (`MalformedMatchRuleResultError`).
      - `api/catalog.py:330`: `DataSourceId("Eurostat")` from the path.
- **Root cause:** pydantic wraps domain errors raised in validators (the candidates, criteria and household `__init__` docstrings say so), and the error table maps by class only. Three domain classes have no row at all.
- **Fix:**
  1. `api/errors.py`: add a context manager, `built_from_the_request()`. It catches `pydantic.ValidationError`.
     - If every problem carries a `ctx["error"]` that `refusal_for` maps, it raises the first of them (`from` the wrapper).
     - Otherwise it re-raises unchanged. A native constraint the request body failed to mirror, or a bug, stays a loud 500.
  2. Add three rows to `STATUS_FOR`:
     - `MalformedIdentifierError → (422, "invalid_request")`, because `arch.md` 7.3 calls an unparseable id a malformed request.
     - `ThresholdShapeError → (422, "invalid_criterion")`, which is what a threshold of the wrong type already answers.
     - `InvalidReferencePeriodError → (422, "invalid_reference_period")`.
  3. Wrap only construction from request input: `household.replace_household`, `criteria._applied` (around `change.the_scoring_rule()`), `values.enter_value_manually` (around `ReferencePeriod`), and `rules.put_match_rule_result` (around `ReferencePeriod` and `MatchRuleResult`). Rebuilding stored rows stays unwrapped, so a corrupt snapshot (R-1) remains a 500 rather than a misleading 422.
  4. Mirror the two native constraints on the request bodies:
     - `ScaleAnchorBody.score = Field(ge=0)` and `input_value = Field(allow_inf_nan=False)`.
     - `MatchRuleResultInputBody.override_reason = Field(None, min_length=1)`.
- **Tests first:**
  - Each of these fails today: the exception escapes through `ASGITransport`. They go in `tests/acceptance/test_error_contract.py::TestADomainRefusalIsNot500` and assert 422, the code, and that nothing was written:
    - `test_a_malformed_home_country_is_refused_not_500` (`invalid_request`).
    - `test_a_home_city_outside_the_home_country_is_refused_not_500` (`unknown_place`).
    - `test_an_inverted_range_threshold_is_refused_not_500` (`invalid_criterion`; the threshold is unchanged on reread).
    - `test_an_inverted_period_on_a_manual_value_is_refused_not_500` (`invalid_reference_period`; the `/values` total is unchanged).
    - `test_an_inverted_period_on_a_gate_answer_is_refused_not_500`.
    - `test_a_gate_answer_dated_without_a_timezone_is_refused_not_500` (`invalid_match_rule_result`).
    - `test_a_negative_anchor_score_is_refused_not_500`.
    - `test_a_malformed_source_id_is_refused_not_500`.
  - Follow-up acceptance cases: a citizenship at city level, a share threshold of 150, a bound-less range, an unknown containment rule, a blank anchor label, a malformed breakdown option, and an empty override reason.
  - Unit tests in a new `tests/unit/api/test_errors.py` (plus `__init__.py`):
    - `test_a_domain_refusal_comes_out_as_itself`.
    - `test_a_native_constraint_failure_stays_a_validation_error`.
    - `test_an_unmapped_refusal_is_left_alone`.
    - `test_a_non_validation_error_passes_through`.
    - `test_the_three_new_classes_have_a_refusal`.
- **Migration / contract / docs:**
  - No migration.
  - No `openapi.yaml` change: `Error.code` is an open string, and these operations already return 422s that the contract doesn't list.
  - Run `make openapi` to pick up the new body bounds.
- **Files touched:** `src/api/errors.py`, `src/api/household.py`, `src/api/criteria.py`, `src/api/values.py`, `src/api/rules.py`, `docs/openapi.implemented.yaml`, `tests/unit/api/__init__.py`, `tests/unit/api/test_errors.py`, `tests/acceptance/test_error_contract.py`.
- **Behaviour change & risks:**
  - These requests now get a 422 in the one error shape. No ranking changes.
  - Theoretical risk: a `MalformedIdentifierError` raised directly from a stored row would now render as 422. The database has no format CHECK on identifiers.
- **Depends on / conflicts with:** BE-23 (same API files and test file); land BE-21 first. Planners in other areas may also touch `api/rules.py` (BE-17, BE-36).
- **Effort:** M.
- **Needs a user decision?** No.

### BE-07 [Medium] A figure past its max_age stays HIGH in the confidence split
- **Still present at HEAD?** Yes.
  - `src/data/confidence.py:69-100` `derive_confidence` is only re-exported (`data/__init__.py:55,226`).
  - Adapters stamp the grade at fetch time (`data/measurements.py:49,83`).
  - `api/rankings.py:175-177` passes the active values on unchanged.
  - `evaluation/ranking.py:325` reads `value.confidence_level` straight into the split.
- **Root cause:** age is the one degradation that can't be stamped at fetch time, because it depends on the day the figure is read. Nothing applies it when the figure is read.
- **Fix (option 1):**
  1. `src/data/active_value.py`: add `graded_as_read(value, *, attribute, on) -> Value`. It returns the same row one grade lower once `attribute.has_gone_stale(value.reference_period, on=on)`, and the row unchanged otherwise (no max_age means it never ages). Export it from `data/__init__.py`.
  2. `api/rankings.the_ranking`: read `catalog.read_attributes(level=level, include_retired=True)` once and pass the as-read copies to `rank_candidates`, with `on = datetime.now(UTC).date()`. Keep `TheRanking.values` as fetched, so the per-value grades in the comparison keep the source's grade beside its dates.
  3. `backend/scripts/rank.py`: apply the same mapping, because it rebuilds the ranking by hand.
  4. Delete `derive_confidence`, `UnknownReliabilityTierError`, their tests and their exports, if you agree.
  5. `tests/acceptance/conftest.py::stored_figures`: make the period relative to today (`covering_year(today.year - 1)`). Otherwise `test_a_scored_candidate_says_how_its_covered_weight_splits` starts failing on 2028-01-01 (a 2025 period plus a 24-month max_age).
- **Tests first:**
  - Fails today (the split is high 100): `tests/acceptance/test_endpoints.py::TestWhatARankingSaysItRestsOn::test_a_figure_past_its_max_age_counts_as_medium`. It seeds the minimal set's figures as HIGH with a 2015 period and asserts the split is `{high: 0, medium: 100}`.
  - Unit tests in `tests/unit/data/test_active_value.py`:
    - `test_a_figure_read_after_its_max_age_is_one_grade_lower`.
    - `test_a_figure_read_within_its_max_age_keeps_its_grade`.
    - `test_an_attribute_with_no_max_age_never_lowers_a_grade`.
    - `test_low_stays_low`.
    - `test_the_row_read_is_the_row_stored`: id, payload and dates are unchanged.
- **Migration / contract / docs:** none. `reqs.md` 5.7 already says confidence is derived.
- **Files touched:** `src/data/active_value.py`, `src/data/__init__.py`, `src/data/confidence.py` (only if deleting), `src/api/rankings.py`, `backend/scripts/rank.py`, `tests/unit/data/test_active_value.py`, `tests/unit/data/test_confidence.py` (only if deleting), `tests/acceptance/conftest.py`, `tests/acceptance/test_endpoints.py`.
- **Behaviour change & risks:**
  - Live confidence splits move down a grade wherever the active figure is past its max_age.
  - The visible case: the 1991-2020 sunshine normals, stamped medium with a 60-month max_age, will read **low for every country**.
  - Scores, ranks and match status don't move; confidence never enters the arithmetic.
  - Saved evaluations keep the split they froze (`0486`).
- **Depends on / conflicts with:** BE-01 (`test_endpoints.py`, different class). Other planners may touch `tests/acceptance/conftest.py`.
- **Effort:** M.
- **Needs a user decision?** Yes. How far should derived confidence reach?
  - **(1)** The split only, as above, with `derive_confidence` deleted. **Recommended.**
  - **(2)** Option 1, plus showing the as-read grade per value in `GET /values` and in the comparison. This changes what `Value.confidence_level` means, so it's a contract decision.
  - **(3)** Full tier-based derivation: a catalog tier→grade mapping (a migration), adapters stop stamping grades, and `derive_confidence` runs at fetch time. Effort L; it touches every adapter and storage.
  - Sub-questions:
    - Do typed (manual) values age too? I recommend yes.
    - Should climate normals be exempt? I recommend fixing that through their max_age in the catalog, not in this code.

### BE-38 [Medium] The coverage gate blends lines and branches into one number
- **Still present at HEAD?** Yes.
  - `tools/audit_coverage.py:76-88` adds covered lines and branches together.
  - `:49-61` applies a single 85% check, and `:106-109` reports a blended total.
  - `backend/pyproject.toml:88-89` has one `fail_under`.
- **Root cause:** the audit treats the two floors as one ratio, and coverage.py can only enforce a blended total.
- **Fix:**
  1. `tools/audit_coverage.py`:
     - `totals_by_package` keeps lines and branches as separate counts.
     - A new pure `failures_in(report) -> list[str]` holds each package, and `report["totals"]`, to 85% on lines and on branches separately. A metric with nothing measurable is skipped, not failed.
     - `check` prints both percentages, and `main` returns 1 when there are failures.
     - Replace the docstring line "Lines *and* branches together, which is what the bar means".
  2. `backend/pyproject.toml:66-70`: keep `fail_under = 85` and correct the comment. The separate floors are held by the audit, which `make check` runs after `make coverage`.
  3. `docs/devplan.md` 5.1 (around 818-821): the same correction.
- **Tests first:**
  - Fails today (the blend is 90%): `tests/unit/test_coverage_audit.py::test_full_lines_cannot_carry_branches_below_the_bar`, a new file that loads the script with `importlib`. It feeds a package with 1000/1000 lines and 800/1000 branches and asserts one failure naming branches.
  - Follow-ups:
    - `test_full_branches_cannot_carry_lines_below_the_bar`.
    - `test_a_package_with_no_branches_is_held_to_its_lines`.
    - `test_exactly_the_bar_on_both_passes`.
    - `test_the_total_is_held_to_both_floors`.
    - `test_nothing_measurable_is_reported_not_failed`.
- **Migration / contract / docs:** `pyproject.toml` comment; `devplan.md` 5.1.
- **Files touched:** `tools/audit_coverage.py`, `backend/pyproject.toml`, `docs/devplan.md`, `tests/unit/test_coverage_audit.py`.
- **Behaviour change & risks:**
  - `make check` now fails when any package, or the total, has branch coverage below 85%.
  - I don't know today's per-package branch numbers; the last blended total was 96.88%. Run `make coverage` and the new audit first. Any shortfall has to be closed with tests in the same commit.
- **Depends on / conflicts with:** BE-32 (`pyproject.toml`, different section).
- **Effort:** S.
- **Needs a user decision?** No.

### BE-23 [Low] Unknown fields, unknown query parameters and illegal nulls are still accepted
- **Still present at HEAD?** Partly.
  - Unknown body fields:
    - These bodies still ignore unknown fields: `api/runs.py:48,56,127`, `api/rules.py:57,62,86`, `api/values.py:35,63`, `api/evaluations.py:52`, `api/criteria.py:52,456,460`.
    - The harmful case: a misspelled `candidate` becomes null, which means the whole level. That run can be paid if attributes are named. A misspelled `match_rule` in research means every gate.
  - Unknown query parameters: nothing checks them (`app.py:79-92`).
  - Nulls:
    - `scale_anchors: null` clears the anchors (`criteria.py:176`), and `bool(None)` turns `required_value: null` into false (`:213`).
    - Explicit nulls are also silently ignored on `is_scored`, `weight` and `weight_locked` (`:298-303`), on the pillar weight body (`:537-549`), and on the data-source body (`catalog.py:330-332`).
    - The contract types all of these as non-nullable (`openapi.yaml:1352-1390`). Only `matching_threshold` is documented as "Null clears it".
- **Root cause:**
  - The remaining bodies keep pydantic's default of ignoring extra fields.
  - Optional fields that detect "left out" also swallow an explicit null.
  - FastAPI ignores undeclared query parameters.
- **Fix:**
  1. `api/bodies.py`: add a `PartialChangeBody` base class. It forbids extra fields, declares a ClassVar `not_nullable`, and runs one validator that refuses an explicit null for those fields, which renders as 422 `invalid_request`.
     - Bodies that extend it: `CriterionInput` (every field the contract types as non-nullable), `ThresholdBody` (`required_value`), `PillarWeightInput` and `DataSourceInput`.
     - `_the_threshold_in` drops the `bool(...)` coercion.
     - `reducer_mode` stays nullable, because null is the only way to clear it.
  2. Add `extra="forbid"` to the bodies listed above. Shared response models are unaffected.
  3. `api/errors.py`: add a dependency, `refuse_unknown_query_parameters`. It compares the request's keys with the declared aliases in `request.scope["route"].dependant.query_params` (recursing into sub-dependencies) and raises a `RequestValidationError` with location `("query", name)`. `app.py` passes it through the `include_router` loop. The generated schema doesn't change.
  4. Run `make openapi`.
- **Tests first:**
  - Each fails today. They go in `tests/acceptance/test_error_contract.py::TestBoundaryValidationAndTheErrorShape`:
    - `test_a_misspelled_scope_field_is_refused_rather_than_planning_every_candidate`: plan returns 422 (200 today).
    - `test_a_misspelled_retry_field_is_refused` (404 today).
    - `test_a_misspelled_research_field_is_refused` (501 today).
    - `test_a_misspelled_gate_answer_field_is_refused_and_nothing_is_recorded`.
    - `test_an_unknown_query_parameter_is_refused_rather_than_ignored`: details name `criteria_sett`.
    - `test_null_scale_anchors_are_refused_rather_than_clearing_them`.
    - `test_a_null_required_value_is_refused_as_a_null`: the code becomes `invalid_request` instead of `invalid_criterion`.
    - `test_a_null_is_scored_is_refused_rather_than_ignored`.
    - `test_a_null_pillar_weight_is_refused_rather_than_ignored`.
  - Controls:
    - `test_a_declared_query_parameter_is_still_accepted`.
    - `test_a_repeated_list_parameter_is_still_accepted` (comparators).
  - Guard: `tests/unit/test_contract_drift.py::test_every_request_body_refuses_a_field_it_does_not_declare`. It walks every served request-body schema (following `$ref`, `anyOf` and `items`) and asserts `additionalProperties: false`. It fails today on six bodies.
- **Migration / contract / docs:**
  - `openapi.implemented.yaml` is regenerated.
  - `arch.md` 7.3 and `openapi.yaml` change only according to the decision below.
- **Files touched:** `src/api/bodies.py`, `src/api/errors.py`, `src/api/app.py`, `src/api/criteria.py`, `src/api/runs.py`, `src/api/rules.py`, `src/api/values.py`, `src/api/evaluations.py`, `src/api/catalog.py`, `docs/openapi.implemented.yaml`, `tests/unit/test_contract_drift.py`, `tests/acceptance/test_error_contract.py`.
- **Behaviour change & risks:**
  - These requests now return 422.
  - The UI (`api/endpoints.ts`) and the e2e specs send only declared fields and parameters; I checked both.
  - Ad-hoc scripts that send extra parameters will break. Run `make e2e` to confirm.
- **Depends on / conflicts with:** BE-21; land it first.
- **Effort:** M.
- **Needs a user decision?** Yes. Which status for a malformed request?
  - Today, `arch.md` 7.3 and `openapi.yaml:58,74` (`"400": BadRequest` on replaceHousehold and replaceSettings) say 400. The code has always answered 422, and the acceptance tests assert 422.
  - **(a)** Keep 422 `invalid_request` everywhere; fix the row in `arch.md` 7.3 and change those two refs in `openapi.yaml` to 422 (a contract edit). **Recommended.**
  - **(b)** Switch every boundary refusal to 400. That means about 15 assertions change; the UI branches on the code, not the status.
  - **(c)** Leave the drift in place.

### BE-31 [Low] comparison imports criteria, which the import table forbids
- **Still present at HEAD?** Yes.
  - `src/comparison/comparison.py:26` does `from starnest.criteria import TOTAL`, used at `:200`.
  - The layers contract (`pyproject.toml:185-198`) permits it.
  - `tests/unit/test_architecture.py` checks layering and cycles only.
- **Root cause:** a layer ordering is coarser than the per-module allow-lists in `arch.md` 6.1.
- **Fix:**
  1. `src/evaluation/weighting.py`: add `contribution_of(score, effective_weight)`, which is score × weight / `TOTAL`. Export it from `evaluation/__init__.py`.
  2. `ranking._attribute_score` uses it, with the same arithmetic. `comparison._cell` uses `contribution_of(Decimal(focus_score) - Decimal(their_score), effective_weight)` and drops the criteria import.
  3. `tests/unit/test_architecture.py`: parse the "May import" column of `arch.md` 6.1's policy table, and use grimp's `direct_import_exists(..., as_packages=True)` to assert that no policy package imports another outside its row. Update the module docstring.
- **Tests first:**
  - Fails today with `[("comparison", "criteria")]`: `test_every_import_between_policy_modules_is_in_arch_md_6_1`.
  - Then:
    - `test_an_import_the_table_does_not_list_would_be_found`: a graph copy with an added `evaluation.ranking → data_acquisition` edge.
    - `test_the_import_table_names_every_policy_module`.
    - In `tests/unit/evaluation/test_weighting.py`: `test_a_contribution_is_the_score_times_its_weight_out_of_one_hundred`, `test_a_score_gap_contributes_with_its_sign`, `test_a_zero_weight_contributes_nothing`.
  - The existing comparison tests stay unchanged and green.
- **Migration / contract / docs:** none, apart from the docstring.
- **Files touched:** `src/comparison/comparison.py`, `src/evaluation/weighting.py`, `src/evaluation/ranking.py`, `src/evaluation/__init__.py`, `tests/unit/test_architecture.py`, `tests/unit/evaluation/test_weighting.py`.
- **Behaviour change & risks:** none at runtime. Any future import outside the table fails `make check`.
- **Depends on / conflicts with:** BE-01 (`ranking.py`, `evaluation/__init__.py`).
- **Effort:** S.
- **Needs a user decision?** No. The alternative is four `forbidden` import-linter contracts with `allow_indirect_imports = true` in `pyproject.toml`. I'd reject it because it restates `arch.md` 6.1 and can drift from it.

### BE-32 [Low] A bare `pytest` run calls live publishers
- **Still present at HEAD?** Yes.
  - `backend/pyproject.toml:58` sets `-m 'not live_llm'`, which doesn't exclude `live`.
  - Tests marked `live` only: `tests/live/test_world_bank_collections.py:21`, `test_gate_b.py:36`, and `tests/unit/data_sources/eurostat/test_adapter.py:469`.
  - The guard in `tests/conftest.py:109-133` covers `live_llm` only.
- **Root cause:** the default marker expression leaves out the free live tier.
- **Fix:**
  1. Set `addopts = "-q --strict-markers -m 'not live and not live_llm'"` and update the comment at `:55-57`. An explicit `-m live` (as `make live` uses) still wins, and the paid-test guard (P35) is untouched.
  2. Update the docstring in `tests/conftest.py:113`, which quotes the old value.
- **Tests first:**
  - Fails today: `tests/unit/test_pytest_defaults.py::test_a_bare_run_deselects_the_live_publishers`. It parses `addopts`, compiles the `-m` expression with pytest's expression parser (`_pytest.mark.expression`, a private API), and asserts it is False for `{live}`.
  - Then `test_a_bare_run_deselects_the_paid_tests`, and `test_a_bare_run_keeps_unit_storage_and_acceptance_tests` (True for the empty set, `{storage}` and `{acceptance}`).
- **Migration / contract / docs:** comments only.
- **Files touched:** `backend/pyproject.toml`, `tests/conftest.py`, `tests/unit/test_pytest_defaults.py`.
- **Behaviour change & risks:** running a single live file now needs `-m live`. The `make` targets are unaffected.
- **Depends on / conflicts with:** BE-38 (`pyproject.toml`).
- **Effort:** S.
- **Needs a user decision?** No.

### (a) Commits, in priority order (each after a green `make check`)
1. `fix(evaluation): an excluded criterion's matching threshold still rules a candidate out (BE-01)`. Files: `evaluation/ranking.py`, `evaluation/rules.py`, `evaluation/__init__.py`, `docs/reqs.md`, and the four test files.
2. `fix(api): a refusal raised while building the request's domain object answers 422, not 500 (BE-21)`. Files: `api/errors.py`, `api/household.py`, `api/criteria.py`, `api/values.py`, `api/rules.py`, `openapi.implemented.yaml`, and its tests.
3. `fix(data): a figure past its max_age counts one grade lower in the confidence split (BE-07)`. Files: `data/active_value.py`, `data/__init__.py`, (`data/confidence.py`), `api/rankings.py`, `scripts/rank.py`, and its tests plus `tests/acceptance/conftest.py`.
4. `fix(tooling): hold lines and branches to 85% each, in total and per package (BE-38)`. Files: `tools/audit_coverage.py`, `backend/pyproject.toml`, `docs/devplan.md`, `tests/unit/test_coverage_audit.py`.
5. `fix(api): refuse unknown fields, unknown query parameters and nulls the contract does not allow (BE-23)`. Files: `api/bodies.py`, `api/errors.py`, `api/app.py`, `api/criteria.py`, `api/runs.py`, `api/rules.py`, `api/values.py`, `api/evaluations.py`, `api/catalog.py`, `openapi.implemented.yaml`, its tests, and the decision-dependent edits to `arch.md` / `openapi.yaml`.
6. `fix(comparison): weigh a score gap through evaluation, and check the import table edge by edge (BE-31)`. Files: `comparison/comparison.py`, `evaluation/weighting.py`, `evaluation/ranking.py`, `evaluation/__init__.py`, `tests/unit/test_architecture.py`, `tests/unit/evaluation/test_weighting.py`.
7. `fix(tooling): a bare pytest run leaves the live publishers out (BE-32)`. Files: `backend/pyproject.toml`, `tests/conftest.py`, `tests/unit/test_pytest_defaults.py`.

### (b) Every file the plans touch
**Production code**
- `src/evaluation/ranking.py`: BE-01, BE-31
- `src/evaluation/rules.py`: BE-01
- `src/evaluation/__init__.py`: BE-01, BE-31
- `src/evaluation/weighting.py`: BE-31
- `src/comparison/comparison.py`: BE-31
- `src/data/active_value.py`: BE-07
- `src/data/__init__.py`: BE-07
- `src/data/confidence.py`: BE-07 (only if deleting)
- `src/api/errors.py`: BE-21, BE-23
- `src/api/app.py`: BE-23
- `src/api/bodies.py`: BE-23
- `src/api/household.py`: BE-21
- `src/api/criteria.py`: BE-21, BE-23
- `src/api/values.py`: BE-21, BE-23
- `src/api/rules.py`: BE-21, BE-23
- `src/api/runs.py`: BE-23
- `src/api/evaluations.py`: BE-23
- `src/api/catalog.py`: BE-23
- `src/api/rankings.py`: BE-07
- `backend/scripts/rank.py`: BE-07

**Tooling and docs**
- `backend/pyproject.toml`: BE-32, BE-38
- `tools/audit_coverage.py`: BE-38
- `docs/reqs.md`: BE-01
- `docs/devplan.md`: BE-38
- `docs/arch.md`: BE-23 (by decision)
- `docs/openapi.yaml`: BE-23 (by decision)
- `docs/openapi.implemented.yaml`: BE-21, BE-23

**Tests**
- `tests/conftest.py`: BE-32
- `tests/unit/evaluation/test_ranking.py`: BE-01
- `tests/unit/evaluation/test_rules.py`: BE-01
- `tests/unit/evaluation/test_weighting.py`: BE-31
- `tests/unit/data/test_active_value.py`: BE-07
- `tests/unit/data/test_confidence.py`: BE-07 (only if deleting)
- `tests/unit/api/__init__.py` and `tests/unit/api/test_errors.py`: BE-21
- `tests/unit/test_architecture.py`: BE-31
- `tests/unit/test_contract_drift.py`: BE-23
- `tests/unit/test_coverage_audit.py`: BE-38
- `tests/unit/test_pytest_defaults.py`: BE-32
- `tests/storage/test_evaluation_store.py`: BE-01
- `tests/acceptance/conftest.py`: BE-07
- `tests/acceptance/test_endpoints.py`: BE-01, BE-07
- `tests/acceptance/test_error_contract.py`: BE-21, BE-23

**Likely overlap with other areas:** `api/rules.py` and `api/runs.py` (data_acquisition and LLM fixes), `tests/acceptance/conftest.py`, and `openapi.implemented.yaml`.

### (c) Real defects next to these findings, not in the review
1. **The comparison weighs rounded scores.** `comparison/comparison.py:156,162,192,200` builds `weighted_contribution` from `AttributeScore.normalised_score`, which is the display-rounded integer (`ranking.py:557-558`). `reqs.md` 5.1 forbids rounding before weighting, and BE-02 removed it from the ranking but not here. Two near-equal gaps can be ordered wrongly in the summary.
2. **The generated contract misdescribes every 422.** `openapi.implemented.yaml:1124-1131`, and each `'422'` entry (for example `:2489-2493`), still documents `HTTPValidationError {detail:[...]}`. Since 72c0a3b the API actually answers `ErrorBody {code, message, details}`.
3. **A comment states the opposite of the truth.** `criteria/criteria_set.py:359-362` says pydantic's `ValidationError` "is neither a ValueError nor ..."; in fact `pydantic_core.ValidationError` subclasses `ValueError`. This is the exact mechanism BE-21 relies on; the fix could ride with BE-21.
4. **Breakdown reduction (`arch.md` 7.2 step 3) doesn't exist.** `ranking.py:324` and `rules.py:212` keep whichever value comes last for an attribute, and `breakdown_option` / `reducer_mode` are never read in `evaluation/`. This is latent: no breakdown option is seeded today.
5. **The clock seam is unused, and the ranking is assembled twice.** `data/clock.py`'s `Clock` has no implementation and no caller, so staleness reads the system date. Separately, `scripts/rank.py` re-assembles `the_ranking` by hand (it also omits the home country), so every ranking-input change must be made twice; BE-07 is one.
