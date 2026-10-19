# Copilot remediation plan

**Status (2026-10-19):** round 2, Phase B and gate research are done. Round 2 fixed 37 findings and the 18 small defects found while planning, test-first (section 2). Phase B fixed the five in section 3, UI-11, UI-15 and UI-26 the small way and UI-32 and BE-23 in full, together with NEW-04, NEW-11, NEW-18 and ten of the defects recorded since round 2. Gate research (UI-01, NEW-01, BE-34), as you approved it on 2026-10-18, now asks 3 paid questions instead of 160, one per request, held to the spend cap, with every billed call ledgered (migrations `0502` and `0503`). Since round 2, 40 more defects were found (NEW-26 to NEW-65, section 7): 29 are fixed and 11 are recorded for later, NEW-48 among them, held for BE-11 by your choice. BE-31 stays partial, as planned. The other agent fixed ST-02, BE-19 and ST-09 on 2026-10-18, checked against the code. Per finding, the tracker reads **66 FIXED, 3 PARTIAL, 16 NOT_FIXED, 5 CLOSED, 1 N/A** ([findings-review-comparison.md](findings-review-comparison.md)).

This plan was written on 2026-10-15 against `c943761`, where `make check` was green: 2,863 backend tests, 96.92% coverage, 1,116 UI tests.

**Sources:**

- the 91 findings in [copilot-review.md](copilot-review.md);
- their verdicts and fix status in [findings-review-comparison.md](findings-review-comparison.md);
- six read-only planning reports, one per area, in [copilot-remediation-plan/](copilot-remediation-plan/), with the step-by-step detail for every finding: failing test first, exact files, risks;
- your decisions from 2026-10-12 to 2026-10-15 (section 6).

## 1. This round: small bug fixes only

**Your rule (2026-10-15):** fix only real bugs whose fix is small or small-to-medium, a few lines in a few files. Leave out:

- big implementations and significant refactoring;
- new tables, new API endpoints and new contract fields;
- new flows through the app.

Everything else stays planned here for later.

| Bucket | Count | Meaning |
|---|---|---|
| This round | 37 findings, plus a small part of UI-03 | A small fix for a real bug |
| Smaller fix possible | 5 | The planned fix is bigger, but a small one exists; it needs your OK |
| Later | 24 | Needs a migration, a contract change, a new flow or a refactor, or cannot happen today |
| Closed | 7 | Decided without code (end of section 6) |
| New defects found while planning | 25 | 18 small ones join this round; 7 wait (section 7) |

The 66 open findings split 37 / 5 / 24. The 6 open High findings split three and three: BE-01, BE-10 and BE-17 this round; UI-01, UI-03 and BE-19 later.

### Plan summary for this round

- **What I'm going to do:** fix 37 findings and 18 newly found defects with surgical, test-first changes, in four parallel lanes that never edit the same file. Each group of fixes is committed and pushed after a green `make check`.
- **Files changed:** listed per commit in section 2. Master-owned files touched, as you allowed when named:
  - `Makefile`, `compose.yaml`, `backend/pyproject.toml`;
  - `backend/Dockerfile` (one comment);
  - `ui/e2e/sanity.spec.ts`;
  - the API acceptance tests.
- **Files left unchanged:** `storage/migrations/` (no migration this round); `docs/openapi.yaml` (no contract change); `ui/playwright.config.ts` and `ui/nginx.conf`. No new tables, endpoints or screens.
- **Behaviour changes** (the full list is the "Change" column in section 2):
  - **Rankings:** none change today. BE-01 only affects a threshold on an excluded criterion, and none is set. BE-25 only matters once a refetch age is set, and `refetch_older_than_days` is empty.
  - **Research:** costs read higher because they become true (BE-17). A research proposal can no longer replace an answer a person recorded (NEW-02).
  - **Configure:** controls are briefly disabled while a save runs, and what you type during a save is kept.
- **Risks:**
  - **BE-29** changes how every source's numbers are decoded, from floats to exact decimals. The change is mechanical and covered by the adapter tests.
  - **BE-38** makes the coverage gate stricter, and the `api` package sits at 84.17% branch coverage today (101 of 120). The same commit adds the tests that lift it.
  - **BE-27** edits three published-table files, and the loader then refuses a malformed table at boot. The data fix is in the same commit, and the figures don't change.
  - **NEW-02** changes how a research proposal is written. A storage test proves that a person's answer still replaces anything.
  - **The browser suite can't run this round:** its own database is UI-03, which is later. The three small edits to `sanity.spec.ts` are checked by reading only. The suite already has 7 stale tests (UI-23, later).
  - **Generated files:** parallel lanes conflict on `docs/openapi.implemented.yaml`, so I regenerate it at each merge.
- **Alternatives considered:**
  - The whole plan in one go (sections 3 and 4): set aside by you as too much added complexity.
  - Deleting unused paths instead of fixing them, such as the `/retry` endpoint that the UI no longer calls: a product decision, kept for later.
- **How to verify:**
  1. Every fix starts with a test that fails before the fix and passes after it.
  2. Each lane runs its half of the gate.
  3. At each merge I run the full `make check` and confirm from the log that every stage ran and no `make: ***` line appears. Then I commit, push and update the tracker.
  4. After the round: the deployment step (section 5, step 0) and a smoke check.

## 2. This round, commit by commit

Four lanes (section 5):

- **BA:** backend acquisition and sources.
- **BB:** backend API, evaluation and tooling.
- **UC:** the UI Configure screen.
- **UR:** the UI Acquire, Rank and Compare screens.

Within a lane, High fixes go first, then Medium, then Low. For each finding's detailed steps and full test list, see the appendix for its area. Paths are shortened: `S/` is `backend/src/starnest/`, `T/` is `backend/tests/`, and `ui/` paths are under `ui/src/`.

### Lane BA: backend acquisition and sources (appendix: [backend-acquisition](copilot-remediation-plan/backend-acquisition.md); ST-20 is in [storage](copilot-remediation-plan/storage.md))

| # | Commit | IDs | Change | Main files | First failing test |
|---|---|---|---|---|---|
| BA1 | `fix(data_acquisition): a narrowed retry hands its source the run's cost meter` | BE-10 (High) | The retry wrapper forwards `meter_with` to the source it wraps. A guard test checks that the wrapper overrides every member the base class defines. | `S/data_acquisition/execution.py` | `T/unit/data_acquisition/test_retry.py::TestTheNarrowedSource::test_it_hands_the_running_meter_to_the_source_it_wraps` |
| BA2 | `fix(llm): a billed empty research answer counts against the cap, and a refusal says why` | BE-17 (High), NEW-16 | The gate researcher passes on the bill the provider's exception carries. A refusal keeps the researcher's own reason instead of "the model cited nothing". | `S/data_sources/llm/gates.py`, `S/data_acquisition/research.py` | `T/unit/data_sources/llm/test_the_three_uses.py::TestResearchingAGate::test_an_answer_with_no_text_still_reports_what_it_billed` |
| BA3 | `fix(data_acquisition): a rejected figure is also a failure a retry can reach` | BE-08, NEW-14 | After storing, a figure rejected by its credible range also records a failure naming the reason. A source that hits the spend cap still logs its failures. | `S/data_acquisition/run.py`, `execution.py` | `T/unit/data_acquisition/test_run.py::TestWhatARunKeeps::test_a_rejected_figure_is_kept_and_recorded_as_a_failure` |
| BA4 | `fix(api): a run plan leaves out what the run would skip, and lists each source once` | BE-25, UI-33, NEW-13, NEW-15 | The plan and the run share one freshness check. Plan rows are summed per source. `listRuns` defaults to 100, as the contract says. `start_run`'s docstring says the run is sent to the background. | `S/data_acquisition/execution.py`, `__init__.py`, `S/api/runs.py` | `T/acceptance/test_runs_api.py::TestPlanningARun::test_an_attribute_fresh_for_every_candidate_is_not_planned` |
| BA5 | `fix(tooling): container migrations and rollbacks take a backup first` | ST-20, NEW-20, NEW-22 | In compose, `migrate` waits for a successful `backup`. `make rollback` backs up first. The stale `pg_dump` comment in the Dockerfile is corrected. | `compose.yaml`, `Makefile`, `backend/Dockerfile` | `T/unit/test_migration_tooling.py::test_the_container_migration_waits_for_a_successful_backup` |
| BA6 | `fix(data_sources): source answers are checked and exact` | BE-09, BE-28, BE-30, BE-29 | WHO figures pass through the credible range. The AI fallback never builds a score it can't store. An employer list holding something other than names is refused. Publisher and model numbers are decoded as exact decimals. | `S/data_sources/who/adapter.py`, `llm/fallback.py`, `llm/employers.py`, `transport.py`, `llm/reading.py` | one per finding: see the appendix |
| BA7 | `fix(published_tables): a row with a stray comma is refused; three tables quote their notes` | BE-27 | The loader requires exactly five fields per row. The 12 rows cut short at a comma are quoted, and the three files' `transcribed_on` is bumped. | `S/data_sources/published_tables/table.py`, three CSVs | `T/unit/data_sources/published_tables/test_table.py::TestWhatATableRefuses::test_a_row_with_more_fields_than_columns_is_refused` |

### Lane BB: backend API, evaluation and tooling (appendix: [backend-api-evaluation](copilot-remediation-plan/backend-api-evaluation.md))

| # | Commit | IDs | Change | Main files | First failing test |
|---|---|---|---|---|---|
| BB1 | `fix(evaluation): an excluded criterion's matching threshold still rules a candidate out` | BE-01 (High) | Thresholds are judged over every criterion at the level. Weights and coverage still use only the scored ones. Stale docstrings are corrected. | `S/evaluation/ranking.py`, `rules.py`, `__init__.py` | `T/unit/evaluation/test_ranking.py::TestAMatchingThresholdRulesOut::test_an_excluded_criterions_threshold_still_rules_the_candidate_out` |
| BB2 | `fix(api): a refusal raised while reading a request answers 422, not 500` | BE-21, NEW-19 | Domain errors that pydantic wraps are unwrapped when they have a mapping. Three error classes get rows. Two request bodies mirror their domain bounds. A false comment about `ValidationError` is corrected. | `S/api/errors.py`, `household.py`, `criteria.py`, `values.py`, `rules.py` | `T/acceptance/test_error_contract.py::TestADomainRefusalIsNot500::test_a_malformed_home_country_is_refused_not_500` |
| BB3 | `fix(api): research never overwrites a person's answer, and its estimate honours the AI switch` | NEW-02, NEW-03 | The proposal upsert leaves a row a person wrote untouched. The research estimate refuses when the `llm` source is switched off, as research itself already does. | `storage/queries/criteria.sql`, `S/storage/match_rule_result_store.py`, `S/api/rules.py` | a storage test: a proposal written after a manual answer leaves the manual answer intact |
| BB4 | `fix(tooling): hold lines and branches to 85% each; a bare pytest leaves live publishers out` | BE-38, BE-32 | The audit checks lines and branches separately, per package and in total. Tests lift `api` above 85% on branches. `addopts` deselects `live`. | `tools/audit_coverage.py`, `backend/pyproject.toml`, `T/conftest.py` | `T/unit/test_coverage_audit.py::test_full_lines_cannot_carry_branches_below_the_bar` |
| BB5 | `fix(comparison): weigh exact score gaps through evaluation` | BE-31, NEW-17 | A `contribution_of` helper in `evaluation/weighting.py`. Comparison uses the unrounded score and stops importing `criteria`. (The optional guard that parses arch.md's import table is left out.) | `S/comparison/comparison.py`, `S/evaluation/weighting.py`, `ranking.py` | `T/unit/evaluation/test_weighting.py`, plus a comparison test with two near-equal gaps |
| BB6 | `test: restore the TestSwitchingASourceOff class the BE-39 commit removed` | NEW-12 | Test structure only. | `T/acceptance/test_catalog_api.py` | n/a |

### Lane UC: UI Configure (appendix: [ui-configure](copilot-remediation-plan/ui-configure.md); UI-03's part is in [ui-rank-compare-e2e](copilot-remediation-plan/ui-rank-compare-e2e.md))

| # | Commit | IDs | Change | Main files | First failing test |
|---|---|---|---|---|---|
| UC1 | `fix(ui): weight saves wait for each other and stay in their own set` | UI-04 (Configure part), UI-05, UI-08, UI-09, NEW-07 | A save's answer is applied only to the set it was sent for, and one write runs at a time. One slider release sends once. Undo history is keyed by set. Undo says when it cannot put the other weights back. Recent changes shows names, not ids. | `routes/configure/useCriteriaEditor.ts`, `changeHistory.ts`, `useChangeHistory.ts`, `RecentChanges.tsx`, `ConfigureScreen.tsx`, `criteria/CriteriaPanel.tsx`, `criteria/CriterionRuleFields.tsx`, `pillars/PillarWeightsPanel.tsx` | `ConfigureScreen.test.tsx`: "a weight saved in one set never lands in another set chosen meanwhile" |
| UC2 | `fix(ui): forms keep what was typed during a save and refuse numbers they cannot send` | UI-06, UI-10 | A save adopts the server's answer only if nothing was typed since. One save at a time. A lone "." is invalid. The API client refuses to send NaN instead of sending null. | `household/`, `settings/`, `numericInput.ts`, `routes/run/useManualEntry.ts`, `api/client.ts`, `api/ApiError.ts`, `api/errorPresentation.ts` | `HouseholdPanel.test.tsx`: "keeps what was typed while the save was in flight" |
| UC3 | `fix(ui): one source reorder at a time, re-read after a partial failure` | UI-07 | Every source control is disabled while a reorder is written, and the order is re-read even after a failure. | `sources/useDataSources.ts`, `DataSourcesPanel.tsx` | `DataSourcesPanel.test.tsx`: "re-reads the order after a move that failed half way" |
| UC4 | `fix(ui): a candidate list that fails to load says so and can be read again` | UI-27 | The roster's status and error are exposed, with an error notice and Try again in both pickers. | `api/useCandidateNames.ts`, `api/useCandidateRoster.ts`, `household/HouseholdPanel.tsx`, `routes/run/ManualEntryPanel.tsx` | `HouseholdPanel.test.tsx`: "says the list of places could not be read, and reads it again when asked" |
| UC5 | `fix(ui): rule explanations count only confirmed answers; research shows what it spent` | UI-12, UI-14, UI-13, NEW-06 | A proposal is no longer counted as an exclusion. Compound rows point to Rank. Candidates are named. A research response's cost, calls and cap stop are shown. Confirming a proposal keeps its period. | `rules/ruleEffect.ts`, `rules/useRuleToggles.ts`, `rules/RulesPanel.tsx`, `proposals/useProposals.ts`, `proposals/ProposalsPanel.tsx` | `RulesPanel.test.tsx`: "does not say a proposed answer removes a candidate" |
| UC6 | `fix(ui): an emptied set list clears the selection, and the comparator guidance is true` | UI-28, UI-31, UI-03 (part) | The selection is cleared when the set list is ready and empty. The settings sentence matches what Compare does. The sanity test restores the spend cap in `afterEach`, which runs even when the test fails. | `shell/SelectionContext.tsx`, `settings/settingsForm.ts`, `ui/e2e/sanity.spec.ts` | `CriteriaSetsPanel.test.tsx`: "leaves nothing selected when the last sets are gone" |

These UC fixes are adapted to standalone versions because the bigger fixes they were planned around come later:

- **UI-12** reads answers as it does today, without the shared answers resource UI-01 would add.
- **UI-14** shows the outcome of today's single research request.
- **UI-13** shows the period with a small pure helper, not BE-36's panel.

### Lane UR: UI Acquire, Rank and Compare (appendices: [ui-run-shell](copilot-remediation-plan/ui-run-shell.md), [ui-rank-compare-e2e](copilot-remediation-plan/ui-rank-compare-e2e.md))

| # | Commit | IDs | Change | Main files | First failing test |
|---|---|---|---|---|---|
| UR1 | `fix(ui): Acquire keeps the run you chose` | UI-04 (Acquire part), NEW-10 | Each action takes a ticket, and a late read never replaces a newer choice. The busy label lasts as long as the work. | `routes/run/useRunScreen.ts` | `RunScreen.test.tsx`: "keeps the run you opened when the opening view arrives late" |
| UR2 | `fix(ui): Acquire reads every run, and the drill-down reads every stored value` | UI-17, UI-16 | One paging reader, de-duplicated by id, replaces the single first page. "Spent this month" adds up every run, as you chose. | `api/endpoints.ts`, `mocks/handlers.ts`, `routes/run/useRunScreen.ts` | `RunScreen.test.tsx`: "lists every acquisition, not only the newest ten" |
| UR3 | `fix(ui): raw comparison reads ahead and behind from the scores; clearing the focus disables Compare` | UI-19, UI-25 | The bar's direction comes from the server's scores. The number stays the server's and is labelled "focus minus comparator". | `routes/compare/attributeRows.ts`, `ComparisonMatrix.tsx`, `CompareScreen.tsx`, `comparisonRequest.ts` (new, pure) | `attributeRows.test.ts`: "draws a comparator that scored lower as behind in raw figures, whichever way its figure moved" |
| UR4 | `fix(ui): outside opinions show both dates; repeated values with different pages stay apart` | UI-20, UI-30, UI-21, NEW-08, NEW-09 | Each outside opinion shows the period it describes and when it was fetched. Row keys include the period end. The fold fingerprint includes quote and citations. Pillar names replace ids in prose. | `routes/rank/CandidateDetail.tsx`, `repeatedValues.ts`, `pillarCompleteness.ts`, `routes/run/OpenToHandEntry.tsx` | `RankScreen.test.tsx`: "dates each outside opinion: the period it describes and when it was fetched" |
| UR5 | `fix(ui): the acquisition diff compares stored figures, not rounded text` | UI-22 | Payloads are compared for equality. Exact digits are shown when rounding hides a change. | `routes/run/acquisitionDiff.ts`, `format/figure.ts` | `acquisitionDiff.test.ts`: "calls a pair refreshed when the figure moved by less than the displayed precision" |
| UR6 | `test(ui): the mock server answers like the real one` | NEW-05 | The mock PUT for gate answers keeps period, pages and override. The mock `/comparisons` refuses an unset limit with `comparator_limit_not_set`. | `mocks/handlers.ts` | the existing tests that depend on it |

### Docs (me, at merges)

| # | Commit | IDs | Change |
|---|---|---|---|
| D1 | `docs: tracker, closures and the decision log` | closures, NEW-24 | The fix_status column and closures in [findings-review-comparison.md](findings-review-comparison.md). BE-36's decision changes to REAL under your policy of 2026-10-12. In `reqs.md`: resolve the duplicate Q231, record the missing Q233, and add the wording for BE-01. Single-sentence updates in `arch.md` (BE-08, ST-20) and `devplan.md` (BE-38). |

## 3. Smaller fix possible: needs your OK

| Finding | Planned fix (size) | Smaller fix (size) | What you would give up |
|---|---|---|---|
| UI-11: the sidebar keeps old facts after a save | Every write marks what it made stale, and the sidebar re-reads (M) | The sidebar re-reads when you change screens or a run ends (S) | It's stale until you navigate |
| UI-15: a contribution shows beside superseded and rejected figures | The server names the exact value each contribution used (M, backend and UI) | Show the score and contribution only on the active row (S, UI only) | Exactness if a fetch lands between two reads (rare with one user) |
| UI-26: tabbing into the household picker makes its options vanish | An arrow-key combobox (M) | Options stay tabbable, and the list closes only when focus leaves the picker (S) | Up to 32 tab stops |
| UI-32: the "no data source" card is always empty | A new `answerable_by` contract field (M) | Remove the card and the Configure chip (S) | A designed feature, until it's done properly |
| BE-23: unknown fields and illegal nulls are accepted | A base class plus a check for unknown query parameters (M) | Refuse unknown fields on the remaining bodies, and fix the two null coercions (S) | Unknown query parameters are still ignored |

**Your choices (2026-10-18):** the small fix for UI-11, UI-15 and UI-26; the full fix for UI-32 (`answerable_by`) and for BE-23, which also takes NEW-36 and the contract's 422s (NEW-41, NEW-18).

**Done (2026-10-19, Phase B):** UI-11 (`48e14e8`), UI-15 (`a8d2b71`, and `9be5ac6` after review), UI-26 (`c53af61`), UI-32 (`d217dd9` for the server's `answerable_by`, decided as Q235; `7c6cb9e` for the screens) and BE-23 (`d8d5636`).

## 4. Later: kept planned, not in this round

Each finding's full plan is in its appendix. Choices you already made for these are in section 6.

| Finding | Why later | Planned fix |
|---|---|---|
| UI-01 (High): gate research can exceed the proxy timeout | Done (2026-10-19): `34f9b30`, `36bad8c`, `634fb1e`, with NEW-01 (`567faf4`) | Research asks only the gates and countries that apply, one gate per request the page sends, the pass held to the spend cap |
| UI-03 (High): the browser tests use your live data | New Makefile flows that create a database | Their own throwaway database, copied from your newest backup, and their own servers |
| BE-19 and BE-33 (High, Low): paid answers wait in memory until a whole sweep ends | BE-19 done by the other agent (`d7a1263`): each paid answer is stored as it lands. BE-33 is still open: its cost is saved only when the whole source ends | Save each answer's cost with it |
| UI-18: scores assume a 0–100 scale | Cannot happen at your setting (100) | Read the configured or frozen scale everywhere |
| UI-23: browser tests use stale control names | Done: NEW-51 (`6865e27`) was this finding, found again by running the suite, which now passes 32 of 32 | — |
| UI-24: Acquire doesn't follow a live run | A new polling flow | Poll the shown run until it ends |
| UI-29: no way to answer a gate by hand | A new feature | A gate-answer form |
| BE-36 stage 1: confirmed gate answers are invisible | A new panel | Recorded answers with their period and age |
| BE-07: an old figure keeps its grade | Behaviour plus a catalog migration | Lower the grade in the ranking's confidence split; lengthen climate normals' max_age. The other agent's next item: you chose the age-only downgrade at read, with saved rankings keeping their frozen split |
| BE-11: a retry asks a cross product | A new table and view | Record and ask exactly the failed pairs. NEW-48 adds a trigger; a tested start that asks each source only about what it failed on is on the local branch `copilot/fx-retry` (`468645b`), not merged, because without the item rows the run's recorded scope would show the pairs nobody needed to ask as unanswered. Since BE-19 a run asks through `fetch_in_batches`, so that commit must filter there too |
| ST-02: two edits to one set can undo each other | Done by the other agent (`5358c3c`) | One locked transaction per edit |
| ST-07 (rest): a saved ranking doesn't keep its evidence | New tables | Freeze the figures and answers behind each warning. The other agent's next item (you chose to build it) |
| ST-09: re-read figures show as unanswered | Done by the other agent (`608919f`), with the source added by `b673fde` (NEW-54) | Record re-confirmations |
| BE-34: research spending has no durable record | Done (2026-10-19): `c99e4a1`, migration `0503` | A write-only ledger |
| ST-10: no current edition for outside scores | A contract field | `is_current` |
| ST-11: one poll can mix two moments | Cannot happen with one connection | A single-statement poll |
| ST-12 to ST-18: integrity gaps that nothing triggers today | Migrations | Constraints, each with a pre-check that stops the migration before changing anything |

## 5. How the work runs

**Step 0, once, at your go:**

1. Commit and push this plan and the tracker.
2. Run `make migrate`, which backs up and then applies 0498 to 0500. I checked read-only that all three apply cleanly: no run is in progress, every pillar sums to 100, and there are no saved rankings.
3. Run `make docker-build` and `make docker-up`, then `docker compose restart schema-diagram`.
4. Check that `/v1/settings` and the UI answer.

The deployment must include the rebuild: once 0500 is applied, the Oct 12 container can no longer save a ranking.

**Lanes:** four helper agents work in parallel, as you allowed, and no two edit the same file.

- Each lane has its own git worktree under `.claude/worktrees/copilot-<lane>`; that folder is already git-ignored.
- Each worktree has `.env` linked (not copied) and its own test database (`WORKSTREAM=<lane>`).
- The docs and the generated `openapi.implemented.yaml` are mine; I update them at each merge.
- Backend lanes run `make lint boundaries coverage audit`. UI lanes run `npm ci` once, then `make ui-check`.

**Per commit:**

1. Write the failing test, then the fix, then run the lane gate.
2. A code-review agent reads the diff.
3. I merge into `master`, run the full `make check` (read from the log), then commit and push.

No migration, contract change or browser run happens this round.

## 6. Decisions

**Given to the builder:**

- **2026-10-12:** verify everything first, then fix by severity. BE-36 policy: a confirmed gate answer never auto-expires and is never silently overwritten. Re-research is explicit and only proposes, and each answer's period and age are shown.
- **2026-10-13:**
  - A failing test before each fix, then complete tests.
  - `make check` after each group; commit and push.
  - BE-15 refuses research with the existing 501.
  - UI-02 runs whole-bucket retries through the scoped estimate, confirm and start path.
- **2026-10-14:** ST-07 freezes everything, including the threshold. ST-02 uses a server-side transactional lock.

**Given to me, 2026-10-14:**

- **Part 1:**
  - Commit and push per group.
  - Migrate and rebuild at go.
  - The browser tests get their own database.
  - Master-owned files may be edited when named in the plan.
  - The tracker is [findings-review-comparison.md](findings-review-comparison.md).
  - Helper agents: as many as useful, never two on one file.
- **Part 2:**
  - The plan lives in docs.
  - High findings first.
  - UI-01 sends small batches. BE-11 asks exact pairs. ST-09 gets a table. BE-36 is staged.
  - Close BE-37, ST-04 to ST-06, ST-19, and R-1 with the rest of ST-08.
- **Part 3:**
  - Gate applicability lives in the catalog (NEW-01).
  - UI-32 gets `answerable_by`.
  - BE-11 records retry item rows only.
  - BE-23 keeps 422 and corrects the docs.
  - ST-10 gets `is_current`.
  - UI-17's monthly total is summed in the browser.
  - BE-07 changes the confidence split only.
  - BE-34 gets a write-only ledger.
  - The rest stays out of the contract.

**Given to me, 2026-10-15:** this round is small bug fixes only, and the full plan stays written down.

**Defaults I used for small choices** (tell me if you want any changed):

- UI-09: undo states when it cannot restore the other weights.
- UI-12: applied compound rules say "who it flags is shown on Rank".
- UI-13: a confirmed AI answer is dated from your confirmation.
- UI-19: the raw number stays the server's, labelled, with the bar coloured by scores.
- BE-08: a pair whose only figure was rejected still counts as completed, and its failure is listed.
- BE-27: bump `transcribed_on`. Reversed: you chose to restore the dates (NEW-33).
- `make rollback` backs up first.
- UI-33: no contract text change.

**Given to me, 2026-10-18:**

- Restore the three tables' dates (NEW-33). Keep keyboard focus on a control while it saves (NEW-34).
- Fix NEW-49 and NEW-50, update the stale browser specs (NEW-51) and restore the deleted styles (NEW-47); hold NEW-48 for BE-11.
- Section 3: small fixes for UI-11, UI-15 and UI-26; full fixes for UI-32 and BE-23, with NEW-36, NEW-41 and NEW-18 folded into BE-23.
- AI calls get explicit limits (NEW-04): 240 s per call and no automatic retry, set in `.env`.
- Keep one database connection (NEW-21) until a slowdown is measured. ST-02 is fixed now, so the remaining reason is ST-11.
- Keep the Greece answer until the browser suite has its own database (UI-03); every browser run writes it back anyway.
- Gate research (UI-01, NEW-01): a plan before any code. **Plan approved, with every recommended option:**
  - The catalog marks which gates research can answer (the UK, Swiss and Liechtenstein gates) and the candidates each concerns. The estimate and the pass ask only those: 3 calls rather than 160.
  - The page asks one gate per request, in turn. It stops at the spend cap, a refusal, a failure, a Stop the reader presses, or when the reader leaves Configure, and reads the answers back once at the end.
  - Each billed call is written to a research spend ledger before the next is asked (BE-34).
  - Built after Phase B, as migrations `0502` and `0503`. NEW-60 and NEW-63 touch the same two endpoints, so I propose to fix them with it.
- Next small batch: NEW-11, NEW-37, NEW-38, NEW-39, NEW-40, NEW-42, NEW-44, NEW-52 and NEW-53.
- NEW-54 is mine to fix (done, `b673fde`). Deploy once it is settled. The other agent and I take turns in the shared working tree.

**Given to me, 2026-10-19:**

- Fix NEW-57 at once, with NEW-52's pattern (done, `8bad828`).
- Fix NEW-60 and NEW-63 with the research build, which changes the same endpoints.
- Start the approved gate-research build.

**Closed without code:**

| Finding | Why |
|---|---|
| BE-13 | Not a defect (third review) |
| BE-37 | By design under reqs.md 6.10, use 1. The gaps it would fill have no honest figure: Liechtenstein has no airport, and EF doesn't score native-English countries. Known problem P38 is what happened when a model filled them. |
| ST-04, ST-05, ST-06 | Already applied, and your backups from 2026-10-02 to 2026-10-08 show no choice was overwritten. The foreign keys onto `criterion` block deletion (NO ACTION), so 0478 and 0492 succeeding proves no anchors or thresholds were lost. |
| ST-19 | Rollback scripts for old migrations; a failed rollback leaves data intact |
| ST-08 (rest), R-1 | Only affect rankings saved before 0500, and you have none |

## 7. New defects found while planning

| ID | Defect | Round | Evidence |
|---|---|---|---|
| NEW-01 | Research asks all 5 gates about all 32 countries (160 paid calls), though only the UK, Swiss and Liechtenstein gates are researchable and each concerns one country | Fixed (567faf4): 3 paid calls, not 160 (`0502`, Q236) | `S/api/rules.py:95-125`, `research.py:182-208`, reqs.md 7.3 |
| NEW-02 | A research proposal can overwrite an answer a person recorded while the pass runs | This round (BB3) | `S/api/rules.py:341`, `research.py:164`, `criteria.sql:631-653` |
| NEW-03 | The research estimate ignores the `llm` switch, so it prices a pass that is then refused | This round (BB3) | `S/api/rules.py:272` |
| NEW-04 | The AI client uses SDK defaults (600 s, two retries), which outlast the proxy's 300 s | Fixed (d883af3): 240 s per call and no automatic retry, set in `.env` (`LLM_TIMEOUT_SECONDS`, `LLM_MAX_RETRIES`) | `S/main.py:453` |
| NEW-05 | Two mock endpoints answer differently from the server | This round (UR6) | `ui/src/mocks/handlers.ts:319-343, 583` |
| NEW-06 | Rule explanations print candidate ids | This round (UC5) | `RulesPanel.tsx`, `ruleEffect.ts` |
| NEW-07 | Recent changes prints attribute ids | This round (UC1) | `useCriteriaEditor.ts:111, 148` |
| NEW-08 | Pillar ids appear in prose | This round (UR4) | `pillarCompleteness.ts:65`, `CandidateDetail.tsx:275` |
| NEW-09 | The hand-entry card prints a raw pillar id | This round (UR4) | `OpenToHandEntry.tsx:102` |
| NEW-10 | Acquire's busy label clears early when two actions overlap | This round (UR1) | `useRunScreen.ts:108-120` |
| NEW-11 | Every Acquire action resets the diff's chosen pair | Fixed (876d75c) | `useRunScreen.ts:114`, `useResource.ts:54` |
| NEW-12 | The BE-39 commit removed a test class header | This round (BB6) | `T/acceptance/test_catalog_api.py:~152` |
| NEW-13 | `listRuns` defaults to 20 while the contract says 100 | This round (BA4) | `openapi.yaml:1019`, `S/api/runs.py:421` |
| NEW-14 | A source that hits the spend cap skips logging its failures | This round (BA3) | `execution.py:288-298` |
| NEW-15 | `start_run`'s published docstring says the run is inline | This round (BA4) | `S/api/runs.py:233-241` |
| NEW-16 | A research refusal hides the real reason | This round (BA2) | `research.py:148-151` |
| NEW-17 | The comparison weighs rounded scores | This round (BB5) | `S/comparison/comparison.py:156-200` |
| NEW-18 | The generated contract still describes every 422 as `{detail}` | Fixed with BE-23 (27f6d6c) | `openapi.implemented.yaml:1124-1131` |
| NEW-19 | A comment says pydantic's `ValidationError` is not a `ValueError` | This round (BB2) | `S/criteria/criteria_set.py:359-362` |
| NEW-20 | `make rollback` takes no backup | This round (BA5) | `Makefile:75-76` |
| NEW-21 | The backend uses one database connection for everything | Decided: keep one until a slowdown is measured | `S/main.py:164` |
| NEW-22 | A Dockerfile comment describes a `pg_dump` that no container runs | This round (BA5) | `backend/Dockerfile:22-27` |
| NEW-23 | A corrected published table without a new date is silently ignored | Later (a new guard) | `published_tables/table.py:110` |
| NEW-24 | reqs.md has two Q231 entries and no Q233, which `execution.py:139` cites | This round (D1) | `reqs.md:3051, 3257` |
| NEW-25 | Breakdown reduction (arch.md 7.2 step 3) doesn't exist yet | Later (city level) | `S/evaluation/ranking.py:303-326` |
| NEW-26 | The Compare refusal for an unset comparator limit offers no way to Configure | Fixed after the round (9dc38a1) | `ui/src/shell/refusalRemedy.ts` |
| NEW-27 | With a refetch age set, a rejected figure makes its pair fresh, so neither the plan nor a scoped run asks again | Fixed after the round (a02dfb3) | `runs.sql` `select_last_retrieval_dates` |
| NEW-28 | A billed research answer with no text is described as "could not be reached" | Fixed after the round (75b2435) | `S/data_sources/llm/gates.py` |
| NEW-29 | Two quick submits of a hand-typed figure send two POSTs | Fixed after the round (347c800) | `ui/src/routes/run/useManualEntry.ts` |
| NEW-30 | A figure rejected without a failure row (runs before BE-08; runs 15 to 17 after `0473`) counts as neither stored nor failed, so Acquire drops its source | Fixed by the review (64e0872) | `runs.sql` `select_run_by_source` |
| NEW-31 | A research pass refused with 501 says its cost is unknown and re-reads | Fixed by the review (769b5e8) | `ui/src/routes/configure/proposals/proposalReading.ts` |
| NEW-32 | When their read fails, the browser suite's restores can clear the live spend cap or coverage floor, or overwrite a gate answer | Fixed by the review (ffdcaef, f673460) | `ui/e2e/sanity.spec.ts`, `gate-c.spec.ts` |
| NEW-33 | BE-27 moved three tables' read date to a day nobody read the publishers | Fixed by the review (b092c2c); you chose to restore the dates | `published_tables/tables/*.csv` |
| NEW-34 | Controls disabled while a save runs drop keyboard focus | Fixed by the review (7bf3184, 73ebfc4, 947ec2b, 2c8e0f1, bf05144, 17c5bdc); you chose to keep focus on the control | 7 places in Configure |
| NEW-35 | Freshness counts a switched-off source's figures, which cannot score | Fixed by the review (cfb0547) | `runs.sql` `select_last_retrieval_dates` |
| NEW-36 | A PUT of a gate answer marked `llm` over a person's answer stores nothing and still answers 200 | Fixed with BE-23 (c96d40a): a 409 `answer_recorded_by_a_person` | `S/api/rules.py:395-416` |
| NEW-37 | The `nothing_to_fetch` refusal prints the age as "30 days, 0:00:00" | Fixed (3464c9d) | `S/data_acquisition/execution.py:171-173` |
| NEW-38 | `useManualEntry`'s `onStored` is never passed | Fixed (9eabba5) | `ui/src/routes/run/useManualEntry.ts:40` |
| NEW-39 | The diff's exact view leaves out an assigned score's rationale, so two scores differing only there read alike | Fixed (eebf7fc) | `ui/src/format/figure.ts` |
| NEW-40 | Planning a run for an unknown level answers 200 with nothing to do; starting one is refused | Fixed (041008f): plan and start refuse it as 422 `unknown_scope` | `S/api/runs.py:500-520` |
| NEW-41 | The target contract declares no 422 on any operation, so no 422 body can be checked against it | Fixed with BE-23 (27f6d6c): a 422 on all 45 operations | `docs/openapi.yaml` |
| NEW-42 | "Saved." after a settings or household save is not announced to a screen reader | Fixed (b4d3e5f) | `SettingsPanel.tsx:59`, `HouseholdPanel.tsx:113` |
| NEW-43 | Tabbing onto a weight slider, or clicking its thumb without dragging, sends the stored weight snapped to the 0.5 step (6.8 becomes 7) and rebalances | Fixed (f230c3a) | `CriteriaPanel.tsx`, `PillarWeightsPanel.tsx` |
| NEW-44 | Older controls still disable themselves during a write and drop keyboard focus, as NEW-34 did | Fixed (45f2c25 on Proposals; 46d84d1 on Acquire, through a shared `HeldButton`) | `ProposalsPanel.tsx`, `ManualEntryPanel.tsx`, `RunScreen.tsx`, `ItemGroups.tsx` |
| NEW-45 | Focus is still lost when a source is moved down or dragged (the row is re-mounted), when a successful undo or reset removes the button pressed, when confirming a proposal removes its button, and when the re-read at the end of a research pass blanks the list | Later (low) | `DataSourcesPanel.tsx`, `RecentChanges.tsx`, `ProposalsPanel.tsx` |
| NEW-46 | A held slider, lock or "blocks scoring" box looks unchanged, because no `:disabled` style ever covered them | Later (looks) | `styles.css` |
| NEW-47 | The builder's `2c04381` (2026-10-02) deleted 929 lines of `styles.css` unannounced; 60 classes still used on screen had no styles, including the criterion rows, confirmation strip, tiles, status pills and danger button | Fixed (54ef14f), restored from `2c04381^` and checked with before-and-after screenshots | `ui/src/styles.css` |
| NEW-48 | A retry can bill a paid source again for a country it answered: since BE-08 a free source's rejected figure puts that country in the retry, and every retried source is asked about every retried country (BE-11) | Held, Low: only a direct call to `/retry` reaches it, since the app's Retry button starts a scoped run (UI-02). Fixed with BE-11 (your choice) | `S/data_acquisition/execution.py:566-574` |
| NEW-49 | A Refresh, or a start the server refuses, while a Stop is being sent outranks the stop's own read, so the card can show no stop and offer Stop again | Fixed (8e5ece9, f9e432c) | `ui/src/routes/run/useRunScreen.ts:250-266` |
| NEW-50 | Two UI-06 tests decide on a fixed one-second wait; one assertion has checked nothing since NEW-34 | Fixed (d3182d4) | `HouseholdPanel.test.tsx:366-373`, `SettingsPanel.test.tsx:357-367` |
| NEW-51 | Four browser specs are stale since 2026-10-04: they look for sliders by attribute id and a Compare column called "Attribute" | Fixed (6865e27) | `ui/e2e/gate-c.spec.ts`, `minimum-end-to-end.spec.ts`, `sanity.spec.ts` |
| NEW-52 | While a Refresh overlaps a Stop, the Stop button is offered again until the read returns; a second stop is accepted harmlessly | Fixed (6d72d97, d7b6bfb): Stop stays held from the click until the stop is refused; the review found a start pressed during the stop could still let it go | `ui/src/routes/run/RunScreen.tsx` |
| NEW-53 | The browser specs' `openPillarOf` can read pillar names before their display names load, then wait out the test timeout | Fixed (5b44462) | `ui/e2e/gate-c.spec.ts`, `minimum-end-to-end.spec.ts` |
| NEW-54 | ST-09's reuse table recorded no source, so the source-by-source bars could not show a re-read figure | Fixed (b673fde), amending `0501` before it was applied anywhere | `storage/migrations/0501-…sql`, `runs.sql` `select_run_by_source` |
| NEW-55 | After a settings save, "Saved." stays on screen while the form is edited again, so it vouches for figures that are no longer the saved ones | Later (low) | `ui/src/routes/configure/settings/SettingsPanel.tsx`, `useSettingsForm.ts` |
| NEW-56 | Rank's save control still disables itself natively during a save, so keyboard focus drops to the page (NEW-34's kind) | Later (low) | `ui/src/routes/rank/SaveControl.tsx` |
| NEW-57 | Start, "Yes, start it" and "Not yet" are let go during a start once Refresh is pressed, because `busy` names only the newest act. A second start is refused by the database guard (`0498`), but its ticket outranks the first, so the run that did start leaves the card and the old one returns under a `run_already_in_flight` banner. Predates this review; NEW-52's kind | Fixed (8bad828): you chose to fix it at once, with NEW-52's pattern | `ui/src/routes/run/RunScreen.tsx:358-390`, `useRunScreen.ts` |
| NEW-58 | An excluded criterion that blocks if missing still shows "Required" on Rank's drill-down, though the ranking only ever blocks on criteria that count | Later (low) | `ui/src/routes/rank/pillarFilter.ts:85`, `CandidateDetail.tsx` |
| NEW-59 | The diff's exact view joins a label set with ", ", so a label containing a comma reads as two | Later (nit) | `ui/src/format/figure.ts:150-155` |
| NEW-60 | The research estimate and the research pass answer 200 for an unknown level, as runs did before NEW-40 | Fixed with the research build (d6ef9a9) | `S/api/rules.py:280-340` |
| NEW-61 | Four optional request fields the design types as non-nullable still accept `null`, meaning what leaving them out means (`note`, `retrieval_date`, `target_monthly_spend`, `max_rent`); the UI never sends one | Later (nit) | `S/api/household.py:47-48`, `S/api/values.py` |
| NEW-62 | The generated contract says `ErrorBody.details` may be `null`; the design says an object, and the server leaves it out when there are none | Later (nit) | `S/api/errors.py:68`, `openapi.implemented.yaml:956-961` |
| NEW-63 | A research response lists a proposal the store declined to write, because a person's answer stood (NEW-02) | Fixed with the research build (5e7787f, 89307fc) | `S/api/rules.py:326-370`, `research.py` |
| NEW-64 | `match_rule_candidate` does not check that a listed candidate sits at its gate's level; research checks the level anyway, so nothing goes wrong today | Later (nit) | `storage/migrations/0502-research-asks-only-the-gates-it-can-answer.sql` |
| NEW-65 | The research panel does not say which level a pass is researching, and switching level mid-pass keeps the pass on the old one (v1 has one level) | Later (low) | `ui/src/routes/configure/proposals/useResearchPass.ts`, `ProposalsPanel.tsx` |

Two more were folded into existing findings: BE-27 affects two more tables than reported, and a mixed retry drops a stand-in failure (part of BE-11).

## Appendices

The planners' step-by-step reports, written before the scope rule; where they differ from this plan, this plan wins.

- [UI Configure screen and gate research](copilot-remediation-plan/ui-configure.md)
- [UI Acquire screen and app shell](copilot-remediation-plan/ui-run-shell.md)
- [UI Rank and Compare screens, and the browser test suite](copilot-remediation-plan/ui-rank-compare-e2e.md)
- [Backend data acquisition, sources and the paid AI path](copilot-remediation-plan/backend-acquisition.md)
- [Backend API boundary, evaluation, comparison and tooling](copilot-remediation-plan/backend-api-evaluation.md)
- [Storage](copilot-remediation-plan/storage.md)
