# Detailed plan: Storage: migrations, queries and the storage adapter

> Written on 2026-10-14 by a read-only planning agent against `c943761`, before the scope rule of 2026-10-15. It is the step-by-step detail behind [copilot-remediation-plan.md](../copilot-remediation-plan.md). Where the two differ (scope, decisions, order), the main plan wins.

I've planned all 13 storage findings. I changed no files: I only read the code and used read-only git. The main points:

- **Only ST-07 is partly fixed at HEAD.** `0500` froze each criterion's lock and threshold, but pillar locks, the figures a rule read and gate answers are still not frozen.
- **The production connection pool has exactly one connection** (`main.py:164`), because psycopg_pool sets max = min when no max is given. That does not hide ST-02. It does make ST-11 unreachable from a single process today. It also means ST-02's edit must be a synchronous callback (a pure function): if `api/` could await another store inside the transaction, it would deadlock.
- **ST-09 needs no `run.py` edit.** I record the re-read in the value store, in the same transaction as the insert attempt, instead of the builder's run.py approach. This keeps clear of BE-19, BE-10 and BE-08.
- **Pre-check tests.** Every migration that adds a constraint starts with a `DO $$ … RAISE` pre-check. A test removes the new constraint, inserts a bad row and runs the migration file again inside a transaction that is rolled back, the pattern 0499's test used. The live database is never touched.
- **Four decisions are needed, each with a recommendation:** ST-07 scope, ST-09 per-source display, ST-10 contract change, ST-20's adjacent `make rollback` backup. These are the "Needs a user decision?" lines below; ST-20's is item 1 of section (c).

---

### ST-02 [Medium] Two edits to one criteria set can silently undo each other
- **Still present at HEAD?** Yes. All five writers read the set in one transaction and write it back in another:
  - `api/criteria.py:272-274` (updateCriterion)
  - `:494-495` (renameCriteriaSet)
  - `:530-551` (updatePillarWeight)
  - `:611-614` (setMatchRuleEnforcement)
  - `:639-642` (setCompoundRuleApplication)

  `storage/criteria_store.py:90-112` clears the set and rewrites it from the caller's copy without taking a lock, and `select_criteria_set` (`criteria.sql:23-139`) takes none either. Nothing else in `src/` calls `replace_criteria_set`. The one-connection pool does not hide this, because the read and the write are separate checkouts.
- **Root cause:** the copy being edited is built outside the write transaction, so the second writer replaces the first writer's changes with its stale copy.
- **Fix:**
  1. `storage/queries/criteria.sql`: add `lock_criteria_set(criteria_set)^`, which runs `SELECT id FROM criteria_set WHERE id=:criteria_set FOR NO KEY UPDATE`. This serialises edits and deletes. It does not block the KEY SHARE lock an evaluation save takes for its foreign-key check.
  2. `criteria/store.py`: replace the abstract `replace_criteria_set` with `edit_criteria_set(criteria_set, edit: Callable[[CriteriaSet], CriteriaSet]) -> CriteriaSet`. The docstring says `edit` is pure and synchronous, runs while the set is locked, and if it raises nothing is written.
  3. `storage/criteria_store.py`: one `acquire` block that:
     - takes the lock (no row → `UnknownCriteriaSetError`);
     - runs `select_criteria_set`, a new statement, so it sees the edit that held the lock;
     - calls `edit(...)` and refuses if `changed.id != criteria_set`;
     - runs today's name update, clear and `_write_contents` as a private `_overwrite`.

     `_delete` takes the same lock first. Otherwise an edit committing mid-delete leaves new criterion rows behind, and the delete fails with a misleading 409.
  4. `api/criteria.py`: each endpoint passes its existing pure change as a closure (`_applied`, the pillar weight/lock change, the rule add/discard, the rename). Catalog lookups stay before the edit. Responses are built from the returned set; rename keeps its re-read so the output stays sorted.
- **Tests first:**
  - Failing test (API level): `tests/acceptance/test_configuration_api.py::TestTwoEditsToOneSet::test_a_weight_change_waiting_on_a_gate_toggle_keeps_the_gate`.
    - A raw connection opens a transaction, locks the scratch set row and enforces `uk_skilled_worker`.
    - A PATCH of a `minimal` weight is fired as a task.
    - A separate autocommit connection polls `pg_locks WHERE NOT granted`, with a 5 s limit so it fails rather than hangs.
    - The raw transaction commits, then the test awaits the PATCH and reads the set.
    - It asserts the gate is still enforced **and** the weight moved. Today the PATCH blocks at `update_criteria_set_name`, then clears the gate, so the test fails.
  - Store level: `tests/storage/test_criteria_store.py::TestEditingASet::`
    - `test_an_edit_waits_for_the_one_in_flight_and_applies_on_top_of_it`
    - `test_an_edit_the_domain_refuses_writes_nothing_and_frees_the_set` (`WeightsAllLockedError`)
    - `test_editing_a_set_that_does_not_exist_is_refused`
    - `test_an_edit_waiting_on_a_set_deleted_meanwhile_is_refused_and_creates_nothing`
    - `test_an_edit_may_not_change_the_identifier`
    - `test_two_edits_through_a_one_connection_pool_both_land` (pool with `max_size=1`: no deadlock, both changes present)
    - `test_a_delete_waits_for_an_edit_in_flight`
  - Rewrite the two `replace_*` tests (`:251,:269`) as `edit_*` tests.
- **Migration / contract / docs:** No migration, contract or UI change. Update the docstrings in `criteria/store.py` and `criteria_store.py`, and the `criteria.sql` comment on `delete_criteria_set_contents`, which says it is what `replace_criteria_set` is built on.
- **Files touched:**
  - Production: `backend/src/starnest/criteria/store.py`, `backend/src/starnest/storage/criteria_store.py`, `storage/queries/criteria.sql`, `backend/src/starnest/api/criteria.py`
  - Tests: `backend/tests/storage/test_criteria_store.py`, `backend/tests/acceptance/test_configuration_api.py`
- **Behaviour change & risks:** a second edit now waits a few milliseconds and applies on top of the first. A delete waits for an edit in progress. There is no schema change, so no risk to the populated database.
- **Depends on / conflicts with:** `api/criteria.py` is also edited by BE-22 (`:387-417`) and BE-21/23 (`:176,:211,:213`), in different hunks. UI-04 (serialising rebalances in the client) complements this.
- **Effort:** M
- **Needs a user decision?** No.

### ST-07 [Medium, PARTIAL] A saved warning or non-match can't be traced back to the figures and gate answers it read
- **Still present at HEAD?** Partly. `0500` froze each criterion's lock, threshold, type and reducer. Still open:
  1. `evaluation/rules.py:48-63`: `RuleWarning` and `NonMatch` carry only text. `ranking.py:112,330-347` hands the rules magnitudes, not value ids. `evaluation_store.py:155-172` writes only the detail text into the text columns of `0010:143-164`.
  2. A gate's non-match keeps only its reason text (`rules.py:186-194`), while the answer row is upserted in place (`criteria.sql:631-653`), so later research overwrites it.
  3. Pillar locks come back unlocked (`evaluation_store.py:218-220`), because `_frozen` stores none.
  4. `read_criteria` (`:213-222`) returns no enforced gates and no applied compound rules, so a reopened snapshot claims none were on.
- **Root cause:** the domain's outcome types never carried their evidence, so storage had nothing to freeze.
- **Fix:**
  1. `evaluation/rules.py`:
     - add `RuleInput(attribute, used_value: int)`;
     - add `inputs: tuple[RuleInput, ...] = ()` to `RuleWarning` and `NonMatch`, and `gate_answer: MatchRuleResult | None = None` to `NonMatch`;
     - `judgements_of(..., value_ids)` fills the inputs from each condition, `thresholds_that_rule_out` names the value that crossed the line, and `gates_that_rule_out` attaches the answer.
  2. `ranking.py`: `_magnitudes_of` returns each figure together with its value id from the same loop (same last-wins choice), and passes the ids to `judgements_of`.
  3. Migration 0502 (below).
  4. `evaluation_store.py` and `evaluation.sql`:
     - `_frozen` adds `pillar_weight_locked`;
     - `save` writes the rule inputs, `gate_answer = answer.model_dump(mode="json")`, and the enforced/applied lists;
     - **both** `select_evaluation_results` and `select_candidate_result` aggregate the inputs and the gate answer (the file's own "keep every aggregation on both" rule);
     - `_result_from` and `read_criteria` map them back.
- **Tests first:**
  - Failing unit tests:
    - `tests/unit/evaluation/test_rules.py::test_a_fired_compound_rule_names_the_figures_it_read`
    - `::test_a_crossed_threshold_names_the_figure_that_crossed_it`
    - `::test_a_gate_that_rules_out_carries_the_answer_it_read`
    - `tests/unit/evaluation/test_ranking.py::test_a_warning_on_an_excluded_criterion_still_names_its_figure` (projected heat excluded from scoring, `mild_now_brutal_later` fires)
  - Failing storage tests, `tests/storage/test_evaluation_store.py::TestTheEvidenceIsFrozen::`
    - `test_a_saved_warning_names_the_figure_it_read_after_a_newer_one_arrives`: the saved warning's inputs still name the old id, and `read_values` finds that id's original source and dates.
    - `test_a_locked_pillar_reads_back_locked`
  - Follow-ups:
    - `test_a_gate_answer_researched_again_leaves_the_saved_reason_unchanged`
    - `test_the_snapshot_says_which_gates_and_rules_were_on`
    - live equals saved for warnings and non-match reasons
    - the test-evaluation sweep also removes the new rows
    - `test_evaluation_membership_behaviour.py`: an input that is another candidate's figure is refused
    - classify the three new tables as SUBJECTIVE in `test_schema_contract.py`
- **Migration / contract / docs:** `0502-a-saved-ranking-keeps-the-evidence-its-rules-read` (depends on 0501):
  - `candidate_result` gains `UNIQUE (id, candidate)`.
  - `evaluation_criterion` gains `pillar_weight_locked boolean NOT NULL`, backfilled `false` as 0500 did for `weight_locked`; there are 0 saved evaluations live.
  - `non_match_reason` gains `gate_answer jsonb`, with `CHECK (gate_answer IS NULL OR match_rule IS NOT NULL)`.
  - New table `candidate_rule_input (candidate_result, candidate, compound_rule NULL, attribute, used_value)`:
    - `UNIQUE NULLS NOT DISTINCT (candidate_result, compound_rule, attribute)`; a NULL compound rule means "judged by this attribute's own threshold";
    - FK `(candidate_result, candidate)` → `candidate_result` with `ON DELETE CASCADE`;
    - FK `(used_value, candidate, attribute)` → value, using 0501's key, with no cascade, like `used_value`.
  - New tables `evaluation_match_rule` and `evaluation_compound_rule`, cascading from the evaluation.

  All new structures, so no pre-check is needed. No contract change is required: `EvaluationPillarWeight.weight_locked` already exists.
- **Files touched:**
  - Production: `backend/src/starnest/evaluation/rules.py`, `backend/src/starnest/evaluation/ranking.py`, `backend/src/starnest/evaluation/__init__.py`, `backend/src/starnest/storage/evaluation_store.py`, `storage/queries/evaluation.sql`, migration 0502 and its rollback
  - Tests: `backend/tests/unit/evaluation/test_rules.py`, `test_ranking.py`; `backend/tests/storage/test_evaluation_store.py`, `test_evaluation_membership_behaviour.py`, `evaluation_rows.py`, `test_criteria_constraint_behaviour.py` (its direct inserts need the new column), `test_schema_contract.py`
- **Behaviour change & risks:** a reopened evaluation names the exact figures and answers behind each warning and non-match, and keeps its pillar locks and rule lists. A rollback that deletes figures cited as evidence is refused, as `used_value` already is. Rows saved before 0500/0502 stay incomplete; there are none live.
- **Depends on / conflicts with:**
  - Needs 0501's key (ST-09). If ST-07 lands first, move the key here.
  - `ranking.py:438-444` is shared with BE-01, and `rules.py` gates with BE-36.
  - The evaluation snapshot is shared with ST-13 and ST-14, which follow.
- **Effort:** L
- **Needs a user decision?** Two questions:
  1. Does "everything" include compound-rule **definitions**?
     - (a) No: the bounds are already in the detail text (recommended).
     - (b) Freeze them as jsonb, which needs a domain reader and a contract field.
  2. Should clients see the evidence?
     - (a) Storage and domain only for now (recommended).
     - (b) An additive `inputs` / `gate_answer` on `Warning` / `NonMatchReason`, which is a contract and UI change.

### ST-09 [Medium] A run that re-reads an unchanged published table reports those items as unanswered
- **Still present at HEAD?** Yes.
  - `published_tables/adapter.py:76` stamps every figure with the transcription day.
  - `values.sql:252,271` use `ON CONFLICT … DO NOTHING`.
  - `value_store.py:185-191` returns None and records nothing.
  - `runs.sql:117-127,172-202,217-239` derive the counts only from `value` rows carrying the run id.
- **Root cause:** a run's link to its evidence lives only on the value row. An idempotent re-read creates no row, so the run has no record that the source answered.
- **Fix:**
  1. Migration 0501 (below).
  2. `values.sql`: add `select_value_by_natural_key(...)^`, returning the id and run, and `insert_run_reconfirmation(...)` with `ON CONFLICT DO NOTHING`.
  3. `value_store.py::_append_one`: when the insert is a no-op and the value names a run, look up the stored row. Do nothing if the stored row belongs to the same run. Otherwise read its payload (`_read_payloads`) and record a reconfirmation **only if the payloads are equal**: a different figure under the same key is not a confirmation, and stays unanswered as today. This happens in the same transaction as the insert attempt, so a process dying mid-run loses nothing (arch 7.1). The return value is unchanged: only new rows.
  4. `runs.sql`: `select_runs`, `select_run`, `select_run_unanswered` and `select_run_values` read the new view `run_value` instead of `value`. `select_run_by_source` is unchanged (`items_stored` still means new rows); amend its comment.
  5. `data/store.py`: state the reconfirmation in the `ValueStore.append` docstring, so it is not a hidden side effect.

  **`run.py` is not edited.** I rejected the builder's alternative (subtract stored from fetched pairs in `run.py`, then `RunStore.record_reconfirmations` from `execution.py`):
  - it matches by (candidate, attribute) only and loses the breakdown/period identity;
  - it needs a second transaction and a new interface method, which means updating the unit-test fakes;
  - it touches `run.py` and `execution.py`, which BE-19, BE-10 and BE-08 also change.
- **Tests first:**
  - Failing: `tests/storage/test_run_store.py::TestARereadAnswersTheRunThatReadIt::test_an_unchanged_figure_reread_by_a_later_run_counts_as_answered`. Run 1 stores V with a fixed retrieval date; run 2 appends V unchanged; `read_run(run2)` must give completed 1, unanswered 0, and an empty list.
  - Failing (API): `tests/acceptance/test_runs_api.py::test_a_second_run_over_an_unchanged_table_leaves_nothing_unanswered` (stub with a fixed `retrieved_at`).
  - Follow-ups:
    - the existing duplicate test still returns `()` and stores one row
    - a re-read with no run links nothing
    - a re-read within its own run links nothing
    - a re-read whose figure differs stays unanswered
    - a failure beside a reconfirmation counts as completed, not failed
    - `read_runs` (the history list) counts the reconfirmed item
    - `by_source` shows nothing stored
    - `test_another_run_s_figure_does_not_fill_this_run_s_gap` stays green
- **Migration / contract / docs:** `0501-a-reread-figure-answers-the-run-that-reread-it` (depends on 0500):
  - `value` gains `value_candidate_attribute_key UNIQUE (id, candidate, attribute)`; ST-07 and ST-13 reuse it.
  - New table `data_acquisition_reconfirmation (data_acquisition_run, value, candidate, attribute)`:
    - primary key `(run, value)`;
    - FK `(value, candidate, attribute)` → value with `ON DELETE CASCADE`. The link means nothing without its value, and a non-cascading FK would block every future rollback that deletes figures.
    - FKs `(run, candidate)` and `(run, attribute)` → the run's planned-scope tables, so it is pinned from the start (see ST-12).
  - New view `run_value` = run-linked value rows `UNION ALL` reconfirmations.

  Safe on a populated database: the table is new and empty, and building the key scans `value` once. Classify the table as OBJECTIVE. Docs: the `runs.sql` comments, and a `reqs.md` decision-log line. Q233 is ambiguous; see section (c) item 5.
- **Files touched:**
  - Production: `storage/queries/values.sql`, `storage/queries/runs.sql`, `backend/src/starnest/storage/value_store.py`, `backend/src/starnest/data/store.py`, migration 0501 and its rollback
  - Tests: `backend/tests/storage/test_run_store.py`, `test_value_store.py`, `test_schema_contract.py`; `backend/tests/acceptance/conftest.py` (stub gains `retrieved_at`), `test_runs_api.py`
- **Behaviour change & risks:** published-table re-reads count as answered, so "Retry 32 unanswered" disappears and ask-again no longer re-asks them. Each re-read figure costs one extra small read.
- **Depends on / conflicts with:** `runs.sql` is shared with ST-11 and ST-12; `acceptance/conftest.py` is shared with backend agents. No conflict with `run.py`.
- **Effort:** M
- **Needs a user decision?** Should a source that only re-confirmed appear in the per-source breakdown?
  - (a) No, unchanged: the breakdown stays "what each source stored and failed on" (recommended).
  - (b) Add `items_reconfirmed` to `SourceReach`, an additive contract and UI change.

### ST-10 [Low] Re-fetched external scores are all served as current, with no newest edition chosen
- **Still present at HEAD?** Yes. `values.sql:339-356` returns every edition and orders only down to the period start. `value_store.py:220-230` and `api/values.py:243-274` pass them all through. The contract `ExternalScore` (`openapi.yaml:1887-1900`) has no current/history flag. Recorded as open in `known-issues.md:497-498`.
- **Root cause:** nothing derives the current edition, although `reqs.md` says one is derived.
- **Fix:**
  1. `select_external_scores` adds `is_current`, computed in SQL: `row_number() OVER (PARTITION BY candidate, data_source ORDER BY reference_period_end DESC, reference_period_start DESC, retrieval_date DESC, id DESC) = 1`. The same keys go in the `ORDER BY`, so the order is deterministic.
  2. `data/external_score.py`: add `ExternalScoreListing(score, is_current)`, mirroring `ValueListing.is_active` (derived, never stored on the record). `ValueStore.read_external_scores` returns these listings.
  3. `api/values.py`: add `is_current` to the response body.
  4. Add `is_current` to the contract, regenerate the implemented spec and the UI client, and have the UI label older editions as history (UI area).
- **Tests first:**
  - Failing: `tests/storage/test_value_store.py::test_only_the_newest_edition_is_current` and `::test_editions_sharing_a_start_are_ordered_by_their_end`.
  - Follow-ups: a re-retrieval of the same edition supersedes the earlier copy; each publisher keeps its own current edition; the candidate/level filters don't change which edition is current; acceptance `test_values_and_rules_api.py::test_an_older_edition_is_served_as_history`; update `InMemoryValueStore` in `unit/data/test_seams.py`.
- **Migration / contract / docs:** No migration. This is a change to a query only, not a constraint, so there is nothing to pre-check. Contract: add `ExternalScore.is_current`. Close the known-issues entry.
- **Files touched:**
  - Production: `storage/queries/values.sql`, `backend/src/starnest/storage/value_store.py`, `backend/src/starnest/data/external_score.py`, `backend/src/starnest/data/__init__.py`, `backend/src/starnest/data/store.py`, `backend/src/starnest/api/values.py`, `docs/openapi.yaml`, `docs/openapi.implemented.yaml`, `ui/src/api/schema.ts`
  - Tests: `test_value_store.py`, `test_seams.py`, `test_values_and_rules_api.py`
- **Behaviour change & risks:** "most recent" means latest period end, then start, then retrieval date. No data risk.
- **Depends on / conflicts with:** UI-20 (external-score dates shown in the UI), `api/values.py` with ST-18.
- **Effort:** M
- **Needs a user decision?** Yes:
  - (a) Additive `is_current` in the contract, with the UI labelling history (recommended).
  - (b) Serve only current editions, with no contract change; history is hidden, contrary to `reqs.md`.
  - (c) Deterministic order only; the UI would infer which is current, so rejected.

### ST-11 [Low] One poll of a run can mix counts and lists taken at different moments
- **Still present at HEAD?** Yes. `run_store.py:144-167` runs four statements in one READ COMMITTED transaction, and `connections.py:44-53` sets no isolation level. With the one-connection production pool (`main.py:164`), a single process cannot commit between those statements. A second process can, and so can any larger pool; the tests use 4.
- **Root cause:** under READ COMMITTED each statement takes its own snapshot.
- **Fix:**
  1. `runs.sql::select_run` returns failures, unanswered items and the per-source breakdown as jsonb aggregates in the same statement. That is one snapshot and one round trip, which is what `run_store`'s docstring already claims.
  2. Delete the three queries this leaves uncalled; the dead-SQL guard requires it.
  3. `read_run` and `_run_from` map the aggregates.

  Rejected: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`. It would be the only SQL in Python, and in a query file it cannot pass the PREPARE conformance test.
- **Tests first:** failing test `tests/storage/test_run_store.py::TestOnePollIsOneSnapshot::test_a_figure_landing_mid_read_cannot_split_the_count_from_its_list`. A proxy over the store's queries commits a figure from another connection right after `select_run` returns. The test asserts `items_unanswered == len(unanswered)` and that the three counts sum to the total. Today the header says 1 and the list is empty. Follow-up: the per-source breakdown agrees with the counts from the same read.
- **Migration / contract / docs:** No migration and no constraint, so nothing to pre-check.
- **Files touched:**
  - Production: `storage/queries/runs.sql`, `backend/src/starnest/storage/run_store.py`
  - Tests: `backend/tests/storage/test_run_store.py`
- **Behaviour change & risks:** none visible; one query per poll instead of four.
- **Depends on / conflicts with:** after ST-09 (uses the `run_value` view); same files as ST-12.
- **Effort:** S
- **Needs a user decision?** No.

### ST-12 [Low] A run's figures and failures can sit outside the run's own plan and level
- **Still present at HEAD?** Yes.
  - `0005-values.sql:7-18`: the run, candidate and attribute foreign keys are independent.
  - `0004:32-58`: planned-scope rows carry no level, and failures are not tied to the scope.
  - `runs.sql:117-127,172-182` count any row linked to the run.
- **Root cause:** no composite key ties a run-linked row to the run's planned scope, or the scope to the run's level.
- **Fix:**
  1. Migration 0503 (below).
  2. `runs.sql`: `insert_run_candidates` and `insert_run_attributes` write `level` from the run row.
  3. `run_store.start_run` turns a scope foreign-key violation into a `ValueError` naming the level.
  4. Acceptance fixture `values_from_a_run` (`conftest.py:263`) tags a Greece figure with a Portugal-only run today; add Greece to its scope.
- **Tests first:**
  - Failing, in a new `tests/storage/test_run_scope_behaviour.py` (constraint tests on a rolled-back connection):
    - `test_a_figure_for_a_candidate_the_run_never_planned_is_refused`
    - `..._for_an_attribute_...`
    - `test_a_run_cannot_plan_a_candidate_at_another_level`
  - Follow-ups:
    - a figure entered by hand still needs no run
    - a failure for an unplanned item is refused
    - the existing "counts sum to the total" tests stay green
  - Pre-check: new harness `tests/storage/migration_replay.py` (runs a migration's statements through yoyo's own parser) and `test_migration_prechecks.py::test_0503_refuses_a_database_holding_an_unplanned_figure`, which drops the new keys, inserts the bad row, runs 0503 again and expects `RaiseException`.
- **Migration / contract / docs:** `0503-a-run-answers-only-what-it-planned`.
  - **Safe on a populated database if the pre-check passes.** I found no writer that tags an unplanned pair: `acquire()` asks only for planned attributes for planned candidates, stand-ins and failures are filtered or itemised to the scope, and `make acquire` writes rows with no run.
  - Pre-check, as the first statement: count values and failures whose (run, candidate) or (run, attribute) has no planned-scope row, and scope rows whose candidate or attribute level differs from the run's. Raise an exception with the counts and one example.
  - Then:
    - `data_acquisition_run` gains `UNIQUE (id, level)`.
    - Both scope tables gain `level` (backfilled from the run, NOT NULL) with foreign keys to `(run, level)` and to `candidate_level_key` / `attribute_level_key`.
    - `value` and `data_acquisition_failure` gain foreign keys `(run, candidate)` and `(run, attribute)` → the scope tables. MATCH SIMPLE, so values entered by hand with no run stay valid.
  - Values with no run are deliberately not level-pinned: it would rewrite every value row, and the domain already validates it.
- **Files touched:**
  - Production: `storage/queries/runs.sql`, `backend/src/starnest/storage/run_store.py`, migration 0503 and its rollback
  - Tests: `test_run_scope_behaviour.py`, `migration_replay.py`, `test_migration_prechecks.py`, `backend/tests/acceptance/conftest.py`
- **Behaviour change & risks:** a writer bug now fails loudly instead of skewing counts. Before migrating the live database (122 runs), run the pre-check SELECTs read-only.
- **Depends on / conflicts with:** ST-09's table is already pinned this way; `runs.sql` and `run_store.py` are shared with ST-09 and ST-11.
- **Effort:** M
- **Needs a user decision?** No.

### ST-13 [Low] A saved contribution can cite another candidate's or another attribute's figure
- **Still present at HEAD?** Yes. `0010:125-138` holds independent foreign keys, and 0107/0482 add only scale and cascade. `evaluation.sql:359-362` uses LEFT JOINs, and `evaluation_store.py:387-395` builds `PillarId` from NULL when the attribute was never frozen.
- **Root cause:** `used_value`, `attribute` and the result are constrained separately.
- **Fix:** migration 0504. `insert_candidate_attribute_scores` supplies `parent.evaluation, parent.candidate`. `select_candidate_attribute_scores` changes its LEFT JOIN on `evaluation_criterion` to an inner JOIN.
- **Tests first:**
  - Failing: `test_evaluation_membership_behaviour.py::TestAContributionNamesItsOwnMeasurement::`
    - `test_a_contribution_cannot_cite_another_candidates_figure`
    - `..._a_figure_of_another_attribute`
    - `test_a_contribution_cannot_score_an_attribute_the_evaluation_did_not_freeze`
  - Follow-ups: a contribution with no figure used is still stored; the saved drill-down round trip is unchanged; a pre-check replay.
- **Migration / contract / docs:** `0504-a-saved-contribution-names-its-own-measurement`. Safe: 0 saved evaluations live, and the pre-check guards others.
  - Pre-check: count contributions whose `used_value` has a different candidate or attribute, and contributions whose attribute was not frozen; raise if any.
  - Add `evaluation` and `candidate` columns, backfilled from `candidate_result`, NOT NULL.
  - Foreign keys:
    - `(candidate_result, evaluation)` with CASCADE, using 0108's key;
    - `(evaluation, attribute)` → `evaluation_criterion` with CASCADE;
    - `(candidate_result, candidate)` with CASCADE, using 0502's key;
    - `(used_value, candidate, attribute)` → value, using 0501's key.

  Docs: close `known-issues.md:494-496` together with ST-14.
- **Files touched:**
  - Production: `storage/queries/evaluation.sql`, migration 0504 and its rollback
  - Tests: `evaluation_rows.py`, `test_evaluation_membership_behaviour.py`, `test_migration_prechecks.py`
- **Behaviour change & risks:** none on the normal path; a faulty writer is refused.
- **Depends on / conflicts with:** needs the keys from 0501 and 0502; shares files with ST-07 and ST-14.
- **Effort:** S
- **Needs a user decision?** No.

### ST-14 [Low] A saved evaluation can freeze criteria from a different level than it ran at
- **Still present at HEAD?** Yes. `0010:34-54` gives frozen criteria no level, and 0500 did not add one. `evaluation_store.py:96-101` freezes every criterion it is handed. `evaluation.sql:32-58` writes no level. Recorded in `known-issues.md:494-496`.
- **Root cause:** the 0108 level-pin pattern was never applied to `evaluation_criterion`.
- **Fix:**
  1. Migration 0505.
  2. `insert_evaluation_criteria` joins `evaluation` to supply the level.
  3. `PostgresEvaluationStore.save` refuses criteria whose `attribute.level_id != level`, with a sentence, before writing anything.
  4. Update the `evaluation/store.py` docstring.
- **Tests first:**
  - Failing: `test_evaluation_membership_behaviour.py::test_a_country_criterion_cannot_be_frozen_into_a_city_evaluation` and `test_evaluation_store.py::test_saving_criteria_from_another_level_is_refused`.
  - Follow-ups: the matching-level case is still stored; a pre-check replay.
- **Migration / contract / docs:** `0505-a-frozen-criterion-sits-at-its-evaluations-level`. Safe: 0 evaluations live.
  - Pre-check: frozen criteria whose attribute level differs from the evaluation's level.
  - Add `level` (backfilled, NOT NULL), FK `(evaluation, level)` → `evaluation_level_key` with CASCADE, and FK `(attribute, level)` → `attribute_level_key`.
- **Files touched:**
  - Production: `storage/queries/evaluation.sql`, `backend/src/starnest/storage/evaluation_store.py`, `backend/src/starnest/evaluation/store.py`, migration 0505 and its rollback
  - Tests: `evaluation_rows.py`, `test_criteria_constraint_behaviour.py` (direct insert at `:273`), `test_evaluation_membership_behaviour.py`, `test_evaluation_store.py`, `test_migration_prechecks.py`
- **Behaviour change & risks:** none on the API path, because `rankings.py:159` already narrows the set to one level.
- **Depends on / conflicts with:** after ST-07; shares files with ST-13.
- **Effort:** S
- **Needs a user decision?** No.

### ST-15 [Low] The database accepts a figure with no payload, or shares that don't add up to 100
- **Still present at HEAD?** Yes. `0005:33-36` and `0006:104-115` pin each payload to the right type family but never require one to exist. No migration defines any trigger. `value_store.py:407-430` reads a parent row with no payload back as None, and the domain then refuses it.
- **Root cause:** nothing checks completeness, or the share total, across tables.
- **Fix:** migration 0507:
  - `CREATE OR REPLACE FUNCTION value_carries_its_payload(id, type)`, with ten `EXISTS` branches;
  - the pre-check;
  - a deferred constraint trigger on `value` AFTER INSERT: an accepted figure must have its payload, and LabelSet / ShareComposition need at least one row;
  - a deferred constraint trigger on `value_sharecomp` AFTER INSERT/UPDATE/DELETE: an accepted figure's shares must sum to 100 ± 0.5.

  The store needs no change: it already writes the figure and its payload in one transaction.
- **Tests first:**
  - Failing, new file `tests/storage/test_payload_completeness_behaviour.py`, using `SET CONSTRAINTS … IMMEDIATE` instead of committing:
    - `test_an_accepted_figure_without_its_payload_is_refused`
    - `test_shares_summing_to_80_are_refused`
  - Follow-ups:
    - a rejected figure may still be the parent row alone
    - an empty label set is refused
    - shares at exactly `SHARE_SUM_TOLERANCE` are accepted and just outside it refused; the test imports the Python constant, so the SQL copy cannot drift
    - the existing store round trips stay green
    - a pre-check replay
- **Migration / contract / docs:** `0507-an-accepted-figure-carries-its-whole-payload`.
  - Pre-check: accepted figures missing their payload; accepted share compositions outside the tolerance.
  - Triggers don't check rows already stored, which is why the pre-check is required. Expect 0 live, since every write goes through the store.
  - Remaining gap: deleting a single payload row from one of the other nine tables is not caught. Nothing in the app deletes payloads, and rollbacks delete parent and children together.
- **Files touched:**
  - Migration 0507 and its rollback
  - Tests: `test_payload_completeness_behaviour.py`, `test_migration_prechecks.py`
- **Behaviour change & risks:** one indexed lookup per insert, checked at commit. A raw-SQL test that commits a figure without its payload would now fail; I found none.
- **Depends on / conflicts with:** none.
- **Effort:** M
- **Needs a user decision?** No.

### ST-16 [Low] The checks named "finite" still accept infinity
- **Still present at HEAD?** Yes. `0006:29-30,47` check only for NaN. `fx_rate > 0`, and the index and score bounds, also accept ±Infinity.
- **Root cause:** `<> 'NaN'` lets Infinity through.
- **Fix:** migration 0506:
  - replace the three NaN-only checks, keeping their names, with `NOT IN ('NaN','Infinity','-Infinity')`;
  - add `_is_finite` checks to `value_monetary.fx_rate`, `value_index.value/scale_min/scale_max`, `value_score.value/range_min/range_max`, `fx_rate.rate` and `external_score.published_value`.

  Ratio and share are already bounded, and count is a `bigint`. Criteria and household numbers are configuration that the domain already validates (BE-18), so they are out of scope.
- **Tests first:** failing, new file `tests/storage/test_finite_figures_behaviour.py::test_a_non_finite_figure_is_refused`, parametrised over each column and each of NaN, Infinity and -Infinity. Infinity is accepted today. Follow-ups: finite extreme values are accepted; a pre-check replay.
- **Migration / contract / docs:** `0506-a-finite-figure-is-finite`. Safe: CHECKs validate existing rows, and the domain has `allow_inf_nan=False`. The pre-check names the offending column if any row would fail.
- **Files touched:**
  - Migration 0506 and its rollback
  - Tests: `test_finite_figures_behaviour.py`, `test_migration_prechecks.py`
- **Behaviour change & risks:** none on the normal path.
- **Depends on / conflicts with:** ST-18 touches `value_monetary` later. Independent.
- **Effort:** S
- **Needs a user decision?** No.

### ST-17 [Low] A criterion's extra share bounds are silently dropped
- **Still present at HEAD?** Yes. `0009:175-197` keys share bounds on (criterion, label), so a criterion may hold several. `criteria_store.py:360-365` keeps only the first, and the next whole-set write deletes the rest.
- **Root cause:** the schema allows several bounds; the domain models one.
- **Fix:**
  1. Migration 0508 adds `UNIQUE (criterion)` to `criterion_threshold_share`.
  2. In `_threshold_from`, unpack exactly one bound, `(share,) = entry["threshold_shares"]`, so it fails loudly if the schema is ever bypassed.
  3. The label table stays as it is; its reader already refuses more than one.
- **Tests first:** failing `test_criteria_constraint_behaviour.py::test_a_criterion_carries_at_most_one_share_bound`. Follow-ups: one bound still round-trips; a pre-check replay.
- **Migration / contract / docs:** `0508-a-criterion-holds-one-share-bound`. Pre-check: any (set, attribute) with more than one share bound raises an exception naming it, saying "choose which to keep; this migration will not choose". Safe: no ShareComposition criterion ships, and the API writes one bound.
- **Files touched:**
  - Production: `backend/src/starnest/storage/criteria_store.py`, migration 0508 and its rollback
  - Tests: `test_criteria_constraint_behaviour.py`, `test_migration_prechecks.py`
- **Behaviour change & risks:** none.
- **Depends on / conflicts with:** `criteria_store.py` is also edited by ST-02, in a different function.
- **Effort:** S
- **Needs a user decision?** No.

### ST-18 [Low] A converted amount doesn't say who published the exchange rate
- **Still present at HEAD?** Yes.
  - The payload SQL has no publisher (`values.sql:52,157`).
  - The insert writes only the rate and its date (`value_store.py:299-310`).
  - The API drops the rate entirely (`api/values.py:204-205`).
  - `Monetary` has no publisher field (`payloads.py:107-111`).
  - Recorded as P10.
- **Root cause:** the publisher lives in `fx_rate.data_source`, and nothing carries it to the value or the client.
- **Fix:**
  1. Migration 0509 (below).
  2. `payloads.py`: `Monetary.fx_rate_source`, with the rule that rate, date and publisher are given together or not at all. `converted()` fills it from `FxRate.data_source`.
  3. `values.sql`: the monetary insert and both payload builders include it.
  4. `value_store._insert_payload` writes it.
  5. `api/values.py::_payload_body` serves the contract's nested `fx_rate {rate, rate_date, data_source}` instead of dropping it (this is BE-35's half).

  Rejected: deriving the publisher on read through a join. The write path would then silently ignore a publisher an adapter supplied.
- **Tests first:**
  - Failing: `test_value_store.py::test_a_converted_amount_names_who_published_its_rate` and `test_values_and_rules_api.py::test_a_converted_amount_is_served_with_its_rate_date_and_publisher`.
  - Follow-ups:
    - `unit/data/test_payloads.py::test_a_rate_without_its_publisher_is_refused`
    - a publisher that did not publish that rate is refused by the FK
    - a euro-native figure still needs no rate
    - a pre-check replay
- **Migration / contract / docs:** `0509-a-conversion-names-who-published-its-rate`. No contract change: `FxRate` is already in `openapi.yaml:1062-1068,1186`. Close P10.
  - Add `UNIQUE (base, quote, rate_date, rate, data_source)` to `fx_rate`.
  - Add `value_monetary.fx_rate_source`, backfilled from the published row.
  - Pre-check after the backfill: no stored rate may be left without a publisher.
  - Add a CHECK that the rate and the publisher are both present or both absent.
  - Replace 0112's foreign key with one that includes the publisher.

  Safe: P10 says no monetary figure is stored, and 0112's existing FK guarantees the backfill can't leave a gap.
- **Files touched:**
  - Production: `backend/src/starnest/data/payloads.py`, `storage/queries/values.sql`, `backend/src/starnest/storage/value_store.py`, `backend/src/starnest/api/values.py`, migration 0509 and its rollback
  - Tests: `test_payloads.py`, `test_value_store.py`, `test_values_and_rules_api.py`, `test_migration_prechecks.py`
- **Behaviour change & risks:** any adapter converting currency must name the publisher; `converted()` already does.
- **Depends on / conflicts with:** BE-35, which is folded into this finding; `api/values.py` is shared with ST-10; `payloads.py` possibly with BE-18.
- **Effort:** M
- **Needs a user decision?** No.

### ST-20 [Medium] `make docker-migrate` applies migrations without taking a backup first
- **Still present at HEAD?** Yes. `Makefile:180-181` runs the compose `migrate` service directly. In `compose.yaml:116-135` that service depends only on the database; `backup` (`:137-165`) is never a prerequisite. `make migrate` (`:72-73`) does back up first.
- **Root cause:** the backup prerequisite lives only on the host `make migrate` target.
- **Fix:**
  1. `compose.yaml`: give `migrate` the dependency `backup: {condition: service_completed_successfully}`. It reuses the one backup definition, a failed dump stops the migration, and it also covers a bare `docker compose run migrate`.
  2. `Makefile`: `docker-migrate` runs `@mkdir -p backups`, with help text "Back up, then apply…". Don't also list `backup` as a make prerequisite, or every container migration would dump twice.
  3. `docs/arch.md` 9.5: one sentence saying both migration paths enforce the backup.

  Rejected: running `pg_dump && yoyo` inline in the migrate command. It would be a second backup definition, needs uid 1000 to write to the bind mount, and risks the `sh -c` quoting problem `compose.yaml` warns about.
- **Tests first:** failing, new file `tests/unit/test_migration_tooling.py::test_the_container_migration_waits_for_a_successful_backup`. It parses `compose.yaml` and asserts the dependency condition and that both services share the `tools` profile. Follow-ups:
  - `test_every_make_target_that_runs_yoyo_apply_backs_up_first`
  - `test_the_backup_still_writes_a_custom_format_dump`

  Manual checks: run `make docker-migrate` twice and confirm two new dumps, each written before yoyo applied; then with `./backups` unwritable, confirm the migration never runs.
- **Migration / contract / docs:** none, apart from `arch.md`.
- **Files touched:** `compose.yaml`, `Makefile` (both master-owned and named here), `docs/arch.md`, `backend/tests/unit/test_migration_tooling.py`.
- **Behaviour change & risks:** every container migration now takes a dump. Compose re-starts an exited backup container on each run; the manual check above confirms this on the user's Docker.
- **Depends on / conflicts with:** none. Land it **first**, so every migration from 0501 on is backed up.
- **Effort:** S
- **Needs a user decision?** Only about the adjacent `rollback` gap; see (c) item 1.

---

### (a) Proposed commits, in priority order (each after a green `make check`)

1. `fix(storage): container migrations take a backup first (ST-20)`: `compose.yaml`, `Makefile`, `docs/arch.md`, the tooling unit test. No migration.
2. `fix(storage): an edit to a criteria set waits for the one in flight and applies on top of it (ST-02)`: `criteria/store.py`, `criteria_store.py`, `criteria.sql`, `api/criteria.py`, tests. No migration.
3. `fix(storage): a run that re-reads an unchanged figure counts it answered (ST-09)`: **0501**.
4. `fix(storage): a saved ranking keeps the figures, gate answers, locks and rule lists it was computed with (ST-07)`: **0502**.
5. `fix(storage): a run's figures and failures stay inside its plan, and one poll reads one snapshot (ST-12, ST-11)`: **0503**, plus the pre-check replay harness.
6. `fix(storage): a saved ranking's evidence and criteria belong to its own candidate, figure and level (ST-13, ST-14)`: **0504, 0505**.
7. `fix(storage): a stored figure is finite and carries its whole payload (ST-16, ST-15)`: **0506, 0507**.
8. `fix(storage): a criterion holds at most one share bound (ST-17)`: **0508**.
9. `fix(storage): a converted amount names who published its rate (ST-18)`: **0509**.
10. `fix(storage): an external score says which edition is current (ST-10)`: no migration; waits on the contract decision.

### (b) Files touched, with the IDs touching each (★ = shared with another area)

- **Migrations (new):** `storage/migrations/0501` (ST-09), `0502` (ST-07), `0503` (ST-12), `0504` (ST-13), `0505` (ST-14), `0506` (ST-16), `0507` (ST-15), `0508` (ST-17), `0509` (ST-18), each with its `.rollback.sql`.
- **SQL queries:**
  - `storage/queries/runs.sql`: ST-09, ST-11, ST-12
  - `storage/queries/values.sql`: ST-09, ST-10, ST-18
  - `storage/queries/evaluation.sql`: ST-07, ST-13, ST-14
  - `storage/queries/criteria.sql`: ST-02
- **Storage modules:**
  - `backend/src/starnest/storage/value_store.py`: ST-09, ST-10, ST-18
  - `storage/run_store.py`: ST-11, ST-12
  - `storage/evaluation_store.py`: ST-07, ST-14
  - `storage/criteria_store.py`: ST-02, ST-17
- **Domain:**
  - `criteria/store.py`: ST-02
  - `data/store.py`: ST-09, ST-10
  - `data/external_score.py`, `data/__init__.py`: ST-10
  - `data/payloads.py` ★: ST-18
  - `evaluation/rules.py` ★: ST-07 (BE-36)
  - `evaluation/ranking.py` ★: ST-07 (BE-01)
  - `evaluation/__init__.py`: ST-07
  - `evaluation/store.py`: ST-14
- **API:**
  - `api/criteria.py` ★: ST-02 (BE-21, BE-22, BE-23)
  - `api/values.py` ★: ST-10, ST-18 (BE-35, UI-20)
- **Not touched:** `data_acquisition/run.py` and `execution.py`.
- **Contract and UI:** `docs/openapi.yaml`, `docs/openapi.implemented.yaml`, `ui/src/api/schema.ts` and the external-score UI ★: ST-10 only, if approved.
- **Docs and tooling:**
  - `compose.yaml`, `Makefile` (master-owned): ST-20
  - `docs/arch.md`: ST-20
  - `docs/known-issues.md`: ST-10, ST-13, ST-14, ST-18
  - `docs/reqs.md` (decision log, master): ST-09
- **Unit tests:** `tests/unit/test_migration_tooling.py` (new): ST-20; `tests/unit/evaluation/test_rules.py`, `test_ranking.py`: ST-07; `tests/unit/data/test_payloads.py`: ST-18; `test_seams.py`: ST-10.
- **Storage tests:**
  - `test_criteria_store.py`: ST-02
  - `test_run_store.py`: ST-09, ST-11
  - `test_value_store.py`: ST-09, ST-10, ST-18
  - `test_schema_contract.py`: ST-07, ST-09
  - `test_evaluation_store.py`: ST-07, ST-14
  - `test_evaluation_membership_behaviour.py`: ST-07, ST-13, ST-14
  - `evaluation_rows.py`: ST-07, ST-13, ST-14
  - `test_criteria_constraint_behaviour.py`: ST-07, ST-14, ST-17
  - new: `test_run_scope_behaviour.py` (ST-12), `migration_replay.py` and `test_migration_prechecks.py` (ST-12 to ST-18), `test_finite_figures_behaviour.py` (ST-16), `test_payload_completeness_behaviour.py` (ST-15)
- **Acceptance tests:**
  - `conftest.py` ★: ST-09, ST-12
  - `test_runs_api.py`: ST-09
  - `test_configuration_api.py`: ST-02
  - `test_values_and_rules_api.py`: ST-10, ST-18

### (c) Real defects found nearby that are not in the review

1. **`make rollback` takes no backup** (`Makefile:75-76`). At least three rollbacks delete stored figures (the hygiene test's `rollbacks_that_delete_figures`), and `arch.md` 9.5 says to back up before every migration. The fix is one line, `rollback: backup`; it could go in the ST-20 commit if you approve.
2. **The production pool is one connection.** `main.py:164` gives `min_size=1` and no maximum, and psycopg_pool then caps it at one (`psycopg_pool/base.py:119-120`). Every request serialises on that connection, and one slow statement makes the others wait (pool timeout after 30 s). It also hides ST-01 and ST-11 in production. Please confirm whether this is intended; if it is, document it.
3. **The backend image installs postgresql-client "for pg_dump before every migration"** (`backend/Dockerfile:22-27`), but no container command runs `pg_dump`. The comment is stale; after ST-20 the backup runs in the postgres image.
4. **A corrected published table is silently ignored.** A published-table CSV can be edited without changing its hand-written `transcribed_on` header (`published_tables/table.py:110`). The re-read then collides on the natural key (`values.sql:252,271`) and is dropped, so the old figure keeps scoring. A changed validation verdict on an unchanged figure is dropped the same way. ST-09's payload check stops such a row being recorded as confirmed, but nothing reports it. A test pinning each CSV's content to its date would catch it.
5. **Decision log.** `reqs.md` has two different Q231 entries (`:3051`, `:3257`), and `execution.py:139` cites a Q233 that `reqs.md` does not contain. The next free decision number is therefore ambiguous.
