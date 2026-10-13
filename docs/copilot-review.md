# Copilot implementation review

**Date:** 2026-10-12  
**Baseline:** `7182d376ebb1d59cfff984b9f3d2a646303d23c3`  
**Method:** Three specialized static reviewers for UI functionality, backend, and storage, plus a coordinator's operational/tooling review.

The review covered the complete implementation, not merely a commit diff. No application code, existing documentation, tests, configuration, or data was changed. This report is the only repository artifact created. No tests, builds, linters, generators, services, database operations, external requests, or paid calls were executed.

The baseline is the completed country-level v1.0. Missing city functionality, nomination, and other explicitly deferred v2.0 features are not classified as defects. UI review concerns functionality and behavior, not visual design. Existing tests were inspected, but their current passing/failing status was not established. Live database contents and publisher accuracy were not audited.

There are **91 findings/observations**, including known issues, conditional problems, migration upgrade hazards, and latent integrity gaps. No finding was assigned Critical or Nit.

| Area | High | Medium | Low | Total |
|---|---:|---:|---:|---:|
| UI | 3 | 22 | 8 | 33 |
| Backend | 9 | 18 | 11 | 38 |
| Storage | 2 | 8 | 10 | 20 |
| **Total** | **14** | **48** | **29** | **91** |

**Severity:** High means material incorrect results, damaged configuration, lost completed work, ineffective spending controls, or a broken major workflow. Medium means narrower functional/protocol errors or significant upgrade problems. Low generally means minor behavior, incomplete reporting, tooling gaps, or latent problems requiring an unusual writer/input.

**Evidence and uncertainty:** Unless qualified, findings are new and supported with high confidence by static inspection. This does not mean runtime reproduction. Trigger conditions are important: a latent SQL-ingestion issue is not a claim that normal HTTP requests currently create that state. Migration findings describe populated upgrade/rollback scenarios, not proof that the live database contains damaged rows. Suggested remedies are recommendations, not implemented or validated fixes.

Cross-layer duplicates were consolidated. Backend reviewer finding BE-35 is included in ST-18, with its API evidence preserved. BE-13's current symptom overlaps BE-14; its separate observation is loss of the original paid-source eligibility decision, with future/custom-registry billing risk explicitly qualified. Snapshot rule-evidence omissions are included in ST-07.

## UI

Inspected application/bootstrap, routing/sidebar, shared hooks, HTTP client and generated types, all four screens and Configure panels, manual entry, live/saved rankings, comparisons, mocks, relevant unit tests, all Playwright specifications, frontend tooling, and nginx. CSS was considered only where controls or keyboard access could break.

### UI-01 [High] - nginx times out synchronous paid gate research

**Evidence:** `ui/nginx.conf:14-27`; `ui/src/routes/configure/proposals/useProposals.ts:82-91`; `backend/src/starnest/api/rules.py:310-325`.

`proxy_read_timeout 60s` applies to gate research, which returns its completed result synchronously. A pass exceeding 60 seconds without response bytes becomes a gateway failure, hiding proposals, actual cost, and cap-halt status. Backend inspection found no research exclusivity or disconnect check; work can potentially continue or overlap after retries. Actual cancellation behavior was not runtime-verified.

**Gap/remedy:** Vite-based browser tests and immediate mocks miss this production proxy path. Use an appropriate research-specific timeout or a durable job/poll protocol. This affects paid-operation reporting, not a deferred research ledger.

### UI-02 [High] - whole-bucket retry starts without an estimate or confirmation

**Evidence:** `ui/src/routes/run/RunScreen.tsx:144-153,184-193`; `ui/src/routes/run/useRunScreen.ts:232-235`; `ui/src/api/endpoints.ts:249-261`.

The failed/unanswered bucket buttons immediately call `retryRun`. Unlike selected-item retries, they do not estimate or obtain confirmation. A retry containing financial work can start spending under an existing cap; without a cap, this wrapper cannot convey explicit uncapped acceptance.

**Gap/remedy:** Existing tests assert immediate requests. Route both bucket actions through estimate/confirmation while preserving selective retry semantics. `reqs.md` 6.3 requires confirmation before acquisition.

### UI-03 [High] - browser tests overwrite household-owned gate answers

**Evidence:** `ui/e2e/gate-c.spec.ts:155-163,483-493`; `ui/playwright.config.ts:39-66`; `ui/e2e/sanity.spec.ts:124-144`.

Gate C replaces Greece's global `not_manually_excluded` answer, then writes `matching` with no reason instead of restoring the previous complete answer or its absence. Duplicating a criteria set does not isolate global gate results. A successful test can erase a real exclusion and its provenance. Sanity also restores a persisted cap only after intervening assertions, without guaranteed cleanup.

**Status/remedy:** The stray Greece answer is a known symptom; this mechanism remains. Prefer an isolated e2e database, or complete state capture/restoration in guaranteed cleanup. These tests were not run during this review.

### UI-04 [Medium] - asynchronous completions can overwrite the current selection

**Evidence:** `ui/src/routes/configure/useCriteriaEditor.ts:100-128,140-161,175-185`; `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:64-91`; `ui/src/routes/run/useRunScreen.ts:133-157,219-238`.

A criterion response for set A can merge into displayed set B after a switch. Out-of-order rebalance responses can replace newer weights. Slow history reads or automatic opening can overwrite the deliberately selected run.

**Gap/remedy:** GET race tests cover `useResource`, not these mutation/opening paths. Guard completions by selection/request generation and serialize overlapping rebalance writes. Storage's separate persisted lost-update problem is ST-02.

### UI-05 [Medium] - a pillar-slider release can submit multiple commits

**Evidence:** `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:245-267,310-329`.

`pointerup`, compatibility `mouseup`, and blur all independently commit against the old server weight. A mouse release before the response can issue duplicate whole-level rebalances; further gestures interact with UI-04.

**Gap/remedy:** The unit test fires only `pointerUp`. Commit once per gesture with a synchronous pending/committed guard and one pointer-release path. The combined browser event sequence was not executed.

### UI-06 [Medium] - save completion discards edits entered while saving

**Evidence:** `ui/src/routes/configure/household/useHouseholdForm.ts:37-48`; `ui/src/routes/configure/settings/useSettingsForm.ts:30-46`; `ui/src/routes/run/useManualEntry.ts:58-69`; `ui/src/routes/configure/criteria/useCriterionRule.ts:59-66`.

Inputs remain editable while a request is pending. Its completion replaces or clears the current draft from the older submission, deleting subsequently typed edits. Household/settings also lack a single-submission guard.

**Gap/remedy:** Tests do not type a new draft during a held save. Disable the form while saving, or track draft revisions and avoid overwriting newer edits.

### UI-07 [Medium] - source reorders allow concurrent operations and stale partial-failure state

**Evidence:** `ui/src/routes/configure/sources/DataSourcesPanel.tsx:33-34,126,149,161`; `ui/src/routes/configure/sources/useDataSources.ts:24-45`.

Only the active row's arrow/switch controls are disabled. Other controls can start PATCH sequences from the old order and interleave them. If a later PATCH fails, earlier changes remain persisted but the list is not reloaded, so displayed trust order differs from storage.

**Gap/remedy:** Tests guard concurrent dragging and first-PATCH failure, not other controls or partial persistence. Serialize the whole operation, disable affected controls globally, and reload after partial failure.

### UI-08 [Medium] - undo history omits criteria-set identity

**Evidence:** `ui/src/routes/configure/useCriteriaEditor.ts:105-123,145-157`; `ui/src/routes/configure/changeHistory.ts:52-62`.

Targets such as `criterion:${attribute}` collapse consecutive changes to the same attribute across different sets. The merged entry retains A's original value but B's reverse request. Undo can write A's weight into B rather than restore either change correctly.

**Gap/remedy:** Tests remain within one set. Include criteria-set identity, and level where applicable, in history keys and displayed context.

### UI-09 [Medium] - scalar weight reversal is not always a true undo

**Evidence:** `ui/src/routes/configure/useCriteriaEditor.ts:98-123`; `ui/src/routes/configure/useChangeHistory.ts:58-64`; `backend/src/starnest/criteria/rebalancing.py:62-76`.

Cross-layer inspection confirms `[50,20,30] -> [100,0,0] -> undo first weight to 50` produces `[50,25,25]`, not the original vector. History records only the edited scalar, losing sibling proportions, but announces restoration.

**Gap/remedy:** Tests assert the reverse request rather than full vector equality. Capture the affected vector and restore it through an appropriate backend operation, or explicitly limit undo semantics.

### UI-10 [Medium] - invalid numeric settings silently serialize as null

**Evidence:** `ui/src/routes/configure/numericInput.ts:20-34`; `ui/src/routes/configure/settings/settingsForm.ts:140-155`; `ui/src/api/client.ts:355-363`.

A nonempty `"."` or comma normalized to `"."` passes the input filter but parses as NaN. JSON converts NaN/infinity to null. Nullable settings can therefore accept the request and clear coverage/spending safeguards instead of refusing invalid input.

**Gap/remedy:** Tests cover blank and valid numbers, not nonempty non-finite inputs. Validate finiteness before serialization and show field-specific errors; invalid and unset are different states.

### UI-11 [Medium] - persistent sidebar facts are not invalidated after writes

**Evidence:** `ui/src/shell/Sidebar.tsx:180-183`; `ui/src/shell/useShellSummary.ts:39-48`; `ui/src/routes/configure/household/useHouseholdForm.ts:43-48`; `ui/src/routes/run/useRunScreen.ts:117-128`.

Saving household data, changing ranking-affecting configuration, or completing acquisition refreshes local panels but not mounted sidebar resources. It can retain old household context, match counts, and last-run summary while a fresh screen shows current facts.

**Gap/remedy:** Tests verify initial/selection-triggered reads only. Share mutation/freshness notifications with sidebar resources, as required by `reqs.md` 8.1.

### UI-12 [Medium] - rule-effect explanations make false eligibility claims

**Evidence:** `ui/src/routes/configure/rules/ruleEffect.ts:30-47`; `ui/src/routes/configure/rules/RulesPanel.tsx:87-89,104-115,182-189`.

Effect counting includes unconfirmed `not_matching` proposals, contradicting Q218's human-confirmation rule. Every compound rule has a null effect rendered as "Applies to no candidate right now," including applied rules producing warnings.

**Gap/remedy:** Tests do not reconcile explanations with proposals or actual warnings. Exclude proposals and consume server outcomes, or state that effects are not shown rather than inventing none.

### UI-13 [Low] - proposal confirmation drops its reference period

**Evidence:** `ui/src/routes/configure/proposals/useProposals.ts:95-103`; `ui/src/routes/configure/proposals/ProposalsPanel.tsx:170-177`; `docs/openapi.yaml:1484-1501`.

**Status:** Known P58; latent while research supplies no periods. Confirmation forwards answer/source/citations but omits `reference_period`, and the row does not show it. A future time-bounded proposal loses that validity information when confirmed.

**Gap/remedy:** Fixtures omit periods. Display and preserve the period, and explicitly decide retrieval-time handling.

### UI-14 [Medium] - research discards actual spend and cap-halt outcome

**Evidence:** `ui/src/routes/configure/proposals/useProposals.ts:82-91`; `ui/src/routes/configure/proposals/ProposalsPanel.tsx:72-111`; `ui/src/api/endpoints.ts:566-576`.

Only refusals are retained from the completed research response. Actual cost, call count, and `halted_on_spend_cap` disappear. A partially completed paid pass can look complete while the old estimate remains.

**Gap/remedy:** Tests return these fields without asserting display. Render the last actual outcome and explicit halt status. This is independent of the deferred durable ledger, BE-34.

### UI-15 [Medium] - alternative values display the active figure's contribution

**Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:308-309,372-405`; `ui/src/routes/rank/attributeScores.ts:35-55`; `ui/src/routes/rank/pillarFilter.ts:60-78`.

Contribution lookup is by attribute, so superseded/rejected rows receive the selected value's score and weight. `is_active` also labels descriptive or excluded values "Scored." Evidence can therefore appear to justify arithmetic performed on another measurement.

**Gap/remedy:** Tests inspect only active contribution cells. Match the evaluated value ID, distinguish Active from Scored, and respect criterion inclusion. This follows the Attribute/Value/Criterion distinction in `reqs.md` 3.0.

### UI-16 [Medium] - candidate provenance permanently stops at 500 values

**Evidence:** `ui/src/api/endpoints.ts:287-296`; `ui/src/routes/rank/CandidateDetail.tsx:74-78,174-191`.

One `limit: 500` page is fetched, and `total` is ignored. Normal append-only history eventually exceeds it, but the view claims "Every stored value." Folding afterward cannot recover omitted evidence.

**Gap/remedy:** Pagination tests cover run-value reads, not candidate reads. Page this history or provide explicit pagination and truthful partial-history labeling.

### UI-17 [Medium] - ten runs are presented as complete history and monthly spending

**Evidence:** `ui/src/routes/run/useRunScreen.ts:113-115`; `ui/src/routes/run/RunScreen.tsx:240-257`; `ui/src/routes/run/databaseHolds.ts:57-66`.

Only ten runs are fetched. Older runs cannot be opened/diffed here despite "Every acquisition so far." When more than ten occur this month, "Spent this month" understates even costs recorded perfectly by the backend.

**Gap/remedy:** Fixtures contain three runs. Paginate history and fetch all monthly pages before claiming a monthly total. This is separate from BE-33/BE-34's durable-accounting gaps.

### UI-18 [Medium] - configurable scores are clamped or interpreted as 0-100

**Evidence:** `ui/src/routes/rank/rankTable.ts:95-103,206-228`; `ui/src/routes/rank/CandidateDetail.tsx:290-292,480-485`; `ui/src/routes/compare/ComparisonMatrix.tsx:251-256`; `ui/src/routes/rank/SavedRankingView.tsx:35-45`.

A valid pillar score of 150 is clamped to 100 in chart text. Other labels/geometry assume a 100 maximum even for smaller scales. Saved views do not propagate their frozen scale. This changes displayed numbers, not merely appearance.

**Gap/remedy:** Fixtures assume 100. Preserve score text and pass the appropriate live/frozen maximum into presentation. Q193 freezes a saved evaluation's scale.

### UI-19 [Medium] - raw comparison mode reverses ahead/behind semantics

**Evidence:** `ui/src/routes/compare/attributeRows.ts:88-94,119-120`; `ui/src/routes/compare/ComparisonMatrix.tsx:72-77,267-280`; `ui/src/routes/compare/divergingBar.ts:99-104`.

Normalized delta uses comparator minus focus; raw delta is contractually focus minus comparator. A maximize attribute with focus 90/comparator 70 makes raw +20 label the comparator ahead. Raw sign cannot establish desirability for target ranges either.

**Gap/remedy:** Tests emphasize minimize examples/numbers. Label raw direction neutrally and explicitly, or use server score/contribution results for desirability.

### UI-20 [Medium] - external scores omit both provenance dates

**Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:558-596`.

Outside-opinion rows show publisher, value/rank, scale, and caveats, but not reference period or retrieval date. Those fields appear only in the React key, leaving edition age uninterpretable.

**Gap/remedy:** Tests assert numbers/links, not dates. Render both dates and the rank denominator where supplied; `reqs.md` 8.4 explicitly requires this provenance.

### UI-21 [Medium] - repeat folding hides distinct quotes and citations

**Evidence:** `ui/src/routes/rank/repeatedValues.ts:38-48,68-76`; `ui/src/routes/rank/CandidateDetail.tsx:308,335-368`.

Equality identity excludes quotes and citations. Observations with equal payload/source/period/confidence but different read pages collapse, exposing only the newest provenance. Numerically unchanged does not mean the evidence is identical.

**Gap/remedy:** Tests vary payload/period/grade but not citations. Include evidence in grouping identity or expose every differing citation/quote inside folded groups.

### UI-22 [Low] - acquisition diff classifies rounded text instead of measurements

**Evidence:** `ui/src/routes/run/acquisitionDiff.ts:90-99,142-157`; `ui/src/format/figure.ts:55-62`.

Values 1.071 and 1.074 both format to 1.07 and are classified unchanged. Stored figures moved; only their presentation agrees. This stems from an explicit implementation choice.

**Gap/remedy:** Tests omit sub-display-precision changes. Compare canonical payloads, then format Earlier/Later cells. Rounding should not decide factual equality.

### UI-23 [Medium] - browser gates target obsolete labels and comparison markup

**Evidence:** `ui/e2e/gate-c.spec.ts:327-329,391-392,442-454`; `ui/e2e/minimum-end-to-end.spec.ts:181-182,238-239,251-252`; `ui/e2e/sanity.spec.ts:348-349,371-372`; `ui/src/routes/configure/criteria/CriteriaPanel.tsx:329,361`.

Tests seek sliders labeled with attribute IDs, while production uses catalog display names. A comparison test looks for the former Attribute-headed table; the unopened matrix is Pillar-headed.

**Gap/remedy:** No execution occurred, but current selectors and markup disagree statically. Resolve display names or use stable nonvisual identity selectors, and address the current comparison matrix.

### UI-24 [Medium] - Acquire does not poll its displayed live progress

**Evidence:** `ui/src/routes/run/useRunScreen.ts:133-157,219-222`; `ui/src/routes/run/RunScreen.tsx:482-485,547-555`; `ui/src/shell/AcquiringBar.tsx:22-25`.

The Acquire report changes only after manual Refresh. Its shell poller is hidden on this route and does not update RunScreen, so progress or "stopping" can remain stale indefinitely.

**Status/remedy:** Intentional implementation commentary exists, but no approved scope exception was found. Tests manually press Refresh, which does not prove application polling. Poll running selections through terminal status as required by `reqs.md` 8.3/Q161.

### UI-25 [Low] - clearing comparison focus enables a silent no-op

**Evidence:** `ui/src/routes/compare/CompareScreen.tsx:147-158,251-258,286-294`.

The placeholder sets focus to `""`; button disabling checks only null, while submission checks truthiness. After clearing focus, Compare can remain enabled but do nothing, with the prior result still visible.

**Gap/remedy:** Tests cover initial null, not clearing a selected focus. Normalize empty selection to null and share the enabling/submission predicate.

### UI-26 [Low] - keyboard focus inside the household picker closes its options

**Evidence:** `ui/src/routes/configure/household/CandidateField.tsx:96-111,121-134`.

Tabbing from input into an option starts a 120 ms blur timer. Only mouse-down cancels it, so pausing to read removes the keyboard-focused option.

**Gap/remedy:** Tests treat Tab as leaving the control. Detect focus leaving the entire composite picker, or implement conventional active-option navigation. This is functional keyboard access, not visual polish.

### UI-27 [Medium] - roster failures become unexplained empty required pickers

**Evidence:** `ui/src/api/useCandidateNames.ts:77-86`; `ui/src/routes/configure/household/HouseholdPanel.tsx:70-72`; `ui/src/routes/run/ManualEntryPanel.tsx:35-42,75-88,167`.

Candidate-read errors are converted to an empty name/option collection without actionable errors. A fresh household or manual-entry workflow cannot choose its required candidates, although other form fields work.

**Gap/remedy:** Silent fallback tests concern optional labels, not required rosters. Expose status/error/reload for picker consumers and render retryable failures.

### UI-28 [Low] - a successful empty set refresh retains a deleted selection

**Evidence:** `ui/src/shell/SelectionContext.tsx:85-97`; `ui/src/routes/configure/sets/CriteriaSetsPanel.tsx:151-160`; `backend/src/starnest/storage/criteria_store.py:130-142`.

The selection effect returns whenever the collection is empty, confusing successful emptiness with loading. Concurrent deletions from a two-set list can leave no surviving set; storage confirms final unreferenced-set deletion is allowed. The UI retains the deleted ID and keeps requesting it.

**Gap/remedy:** Tests retain a survivor. Preserve selection during loading, but clear it after a successful empty response.

### UI-29 [Medium] - manual gate entry and independent overrides have no UI workflow

**Evidence:** `ui/src/routes/configure/proposals/useProposals.ts:93-104`; `ui/src/routes/configure/proposals/ProposalsPanel.tsx:120-149,190-199`; `ui/src/routes/configure/rules/RulesPanel.tsx:76-115`; `ui/src/api/endpoints.ts:594-605`.

The answer PUT is surfaced only to confirm a proposal unchanged. Users cannot independently exclude a country, disagree with a proposal, or correct a confirmed answer through the UI. RulesPanel edits enforcement, not answers.

**Gap/remedy:** Only same-answer confirmation is tested. No approved deferral was found for this v1 requirement (`reqs.md` 2, 3.7, 8.2/Q152). Add an existing-gate manual-answer/override editor with provenance.

### UI-30 [Low] - external-score row keys omit reference-period end

**Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:577-582`.

Two valid editions with the same publisher, January start, and retrieval timestamp but different period ends receive identical keys, allowing unreliable React reconciliation.

**Gap/remedy:** Fixtures do not vary period end alone. Include it or use a stable server row identifier. This is a latent identity issue, separate from ST-10's edition-selection query.

### UI-31 [Low] - unset comparator guidance promises unlimited comparisons

**Evidence:** `ui/src/routes/configure/settings/settingsForm.ts:74-80`; `ui/src/routes/compare/CompareScreen.tsx:220-223`; `ui/e2e/sanity.spec.ts:290-294`.

Configure says an unset limit permits as many comparators as selected. Backend actually refuses with `comparator_limit_not_set`; Compare describes that correctly.

**Gap/remedy:** Sanity asserts the incorrect help without saving and comparing. Explain that a limit must be configured before comparison, and update the assertion.

### UI-32 [Medium] - source-priority membership is mistaken for adapter capability

**Evidence:** `ui/src/routes/run/unsourced.ts:88-89`; `ui/src/routes/configure/criteria/criterionReading.ts:188-190`; `ui/src/routes/run/UnsourcedAttributes.tsx:108-117`; `docs/openapi.yaml:1128-1135`.

An empty priority list is interpreted as missing adapter/"Nobody would be asked"; nonempty means acquisition is available. Priority is a trust ordering, not capability. Currently it contains only overrides (BE-39), but fixing that response still would not make this inference valid.

**Gap/remedy:** Tests encode the assumption. Consume actual capability metadata, or describe only known priority state without claiming acquisition availability. No live misclassification was measured.

### UI-33 [Low] - multiple adapters sharing a publisher produce duplicate plan-row keys

**Evidence:** `ui/src/routes/run/RunScreen.tsx:391-410`; `backend/src/starnest/api/runs.py:190-194`.

RunPlan emits one row per adapter; multiple published-table adapters can share `national_statistics`. UI keys each row only by publisher, causing duplicate sibling keys and unreliable updates, and presents unlabeled adapter counts as "Per source."

**Gap/remedy:** Fixtures use distinct IDs. Aggregate genuine per-source totals or expose stable adapter identity. RunDetail's derived, distinct-source breakdown is not the affected surface.

## Backend

Inspected all policy/API modules, composition root, adapter families/manifests/parsers/transport/LLM paths, scripts, backend tooling configuration, and relevant unit/acceptance/live guards and fixtures. SQL/storage and frontend were separately reviewed. Large binary/network fixtures and the full vendored route graph were not independently data-audited.

### BE-01 [High] - criterion matching thresholds are never evaluated

**Evidence:** `backend/src/starnest/evaluation/ranking.py:412-455`; `backend/tests/acceptance/test_endpoints.py:423-523`.

Eligibility combines named gates and compound rules only. `Criterion.matching_threshold` is parsed and serialized, but never applied to ranking. A persisted tax, housing, or label threshold cannot make a violating candidate not match.

**Gap/remedy:** Acceptance tests verify threshold storage/clearing, not eligibility. Evaluate typed thresholds independently of scoring and retain criterion-specific reasons, as required by `reqs.md` 5.2.

### BE-02 [High] - normalisation rounds before weighting and can reverse rankings

**Evidence:** `backend/src/starnest/evaluation/normalisation.py:180-218,328-343`; `backend/src/starnest/evaluation/ranking.py:517-531`.

Normalised scores are quantized to integers before contributions. With 90/10 weights, A's precise scores `[49.49,50.51]` total 49.592, while B's `[49.51,49.00]` total 49.459. Correct displayed totals are A=50/B=49; intermediate rounding yields A=49/B=50.

**Gap/remedy:** Normalisation tests explicitly assert early integer conversion. Carry Decimal scores through weighting; round presentation/frozen display values only. `reqs.md` 5.1 expressly forbids the current arithmetic.

### BE-03 [High] - insufficient scoreability suppresses definite non-matches

**Evidence:** `backend/src/starnest/evaluation/ranking.py:412-439`; `docs/arch.md:878-887`.

The insufficient-data return precedes gate/compound evaluation. A failed visa gate disappears when coverage falls below its floor or a blocking value is missing; warnings disappear too.

**Gap/remedy:** Tests exercise rule failures on scoreable candidates. Evaluate eligibility/warnings independently, preserving a null score and its explanation where needed. The architecture gives definite non-match precedence.

### BE-04 [Medium] - valid zero-scoring-mass configurations cause unhandled errors

**Evidence:** `backend/src/starnest/evaluation/ranking.py:161-171,237-258`; `backend/src/starnest/evaluation/weighting.py:135-146`; `backend/src/starnest/api/errors.py:67-100`.

Exclude the 100-weight criterion from a `[100,0]` pillar while another pillar still scores: renormalising zero mass raises unmapped `WeightingError`. A related edge refuses an empty zero-weight pillar despite recommending zero weight as the remedy.

**Gap/remedy:** Tests separate zero weights and exclusions. Preserve zero contributions, ignore noncontributing groups appropriately, and map any genuine no-scoring-mass refusal.

### BE-05 [Medium] - normalisation legality is not checked against value type

**Evidence:** `backend/src/starnest/criteria/criterion.py:176-185`; `backend/src/starnest/api/criteria.py:304-306`; `backend/tests/unit/criteria/test_criterion.py:299-301`.

Temperature/Count can be changed to `as_is`, Monetary to percentile, or AssignedScore to fixed despite the legal-method table. Raw magnitudes can then become arbitrary scores or make a column unscoreable.

**Gap/remedy:** Existing validation/tests check method names and target-range combinations, not type legality. Enforce the authoritative table from `reqs.md` 3.3a during criterion construction/revalidation.

### BE-06 [Medium] - Quantity units are not validated against their declared dimension

**Evidence:** `backend/src/starnest/data/attribute.py:286-317`; `backend/src/starnest/data/manual.py:63-78`; `backend/src/starnest/evaluation/magnitudes.py:47-48`.

Manual naturalisation data can carry magnitude 5 with unit `celsius`. Both unit IDs exist; validation does not compare them. If competing evidence is unavailable/disabled, scoring treats degrees as years.

**Gap/remedy:** Manual tests use correct units only. Reject incompatible dimensions and convert permitted alternate units before magnitude interpretation; `reqs.md` 3.3a requires this safety.

### BE-07 [Medium] - confidence derivation is disconnected from production reads

**Evidence:** `backend/src/starnest/data/confidence.py:69-100`; `backend/src/starnest/data/measurements.py:49,83`.

The degradation helper has no production caller; adapters assign grades and storage returns them unchanged. An official HIGH measurement can age beyond `max_age` yet remain HIGH in the ranking confidence split. Freshness ordering still works; grade disclosure does not.

**Gap/remedy:** Isolated helper tests miss integration. Derive effective confidence from current tier/age/geography while preserving historical grades in saved evaluations, following `reqs.md` 5.7.

### BE-08 [Medium] - rejected measurements are absent from selective failure retry

**Evidence:** `backend/src/starnest/data/measurements.py:90-102`; `backend/src/starnest/data_acquisition/run.py:114-138`.

Attribute-range rejection creates and retains a rejected Value, but acquisition records only adapter-provided failures. It never converts rejected returned observations into source-stamped failures. Failure retry can therefore report nothing to retry.

**Gap/remedy:** Construction and retry tests are disconnected. Record a contextual failure while keeping the rejected evidence, as explicitly required by `reqs.md` 3.3a.

### BE-09 [Low] - WHO bypasses attribute-explicit validation

**Evidence:** `backend/src/starnest/data_sources/who/adapter.py:164-194`.

**Status:** Latent residual of P59. WHO constructs Value directly instead of using `Measurements.figure`. A credible attribute range narrower than its provider scale would not reject an out-of-range observation.

**Gap/remedy:** WHO tests cover provider-scale failures, not attribute limits. Use the common validation path. No current shipped WHO range violation is asserted.

### BE-10 [High] - retry wrappers do not forward the running cost meter

**Evidence:** `backend/src/starnest/data_acquisition/execution.py:532-564`; `backend/src/starnest/data_acquisition/run.py:84-85`.

The wrapper forwards cost/estimate declarations but inherits a no-op `meter_with`. A fresh paid adapter can bill its candidate batch before the outer cap check; a reused adapter may retain the prior exhausted meter and reject a newly capped retry.

**Gap/remedy:** Retry tests verify pricing declarations, not meter forwarding. Forward the hook and exercise a real metered candidate loop. This is a remaining decorator gap after P41.

### BE-11 [Medium] - selective retries expand exact items into Cartesian products

**Evidence:** `backend/src/starnest/data_acquisition/execution.py:495-505,601-606`.

Failures `(source A,X,attribute 1)` and `(source B,Y,attribute 2)` become global candidate/attribute sets. Wrappers narrow attributes, not candidate pairs, so successful/unrequested pairs are fetched too. Unanswered retries similarly expand diagonal pairs.

**Gap/remedy:** Single-pair tests cannot detect expansion. Preserve per-source/per-attribute candidate sets and exact unanswered pairs, as required by `reqs.md` 6.4.

### BE-12 [High] - retry blocks despite 202 and omits the in-flight guard

**Evidence:** `backend/src/starnest/api/runs.py:362-387`, contrasted with `250-287`.

Retry/ask-again await complete execution instead of opening a run and continuing in a background task. They omit start's exclusivity check. Long retries time out; repeated requests can start overlapping passes, including against a running original run.

**Gap/remedy:** Immediate-202 tests cover start only. Apply the same open/continue/refusal protocol to both retry variants. ST-01 is the separate atomicity problem even after a guard is used.

### BE-13 [Medium] - unanswered retry loses the original paid-source eligibility decision

**Evidence:** `backend/src/starnest/api/runs.py:360-365,182-184,259-260`; `backend/src/starnest/data_acquisition/execution.py:425-426`.

All enabled adapters are passed to ask-again without retaining the original free-sweep exclusion of paid sources. The current registry cannot bill LLM on a free sweep's unanswered attributes, because those attributes are excluded from fallback. Its demonstrated effect is erroneous cap eligibility/refusal, overlapping BE-14. Unexpected billing is conditional on future/custom overlapping registries, not a current-production claim.

**Gap/remedy:** Persist/reapply original financial eligibility; tests should distinguish original consent from expanded stored attribute scope. Severity was reduced after cross-layer verification.

### BE-14 [Medium] - unrelated paid adapters make free explicit work require a cap

**Evidence:** `backend/src/starnest/data_acquisition/execution.py:185-188,425-426`.

An explicit free Eurostat scope admits all adapters and tests whether any registered adapter charges, rather than whether financial work exists in the selected scope. A zero-cost plan can then refuse `spend_cap_not_set`.

**Gap/remedy:** Tests lack an unrelated paid adapter in a mixed registry. Compute spending eligibility from actual selected work, not registry membership. This also explains BE-13's current cap-refusal symptom.

### BE-15 [High] - disabled sources remain consultable through other paths

**Evidence:** `backend/src/starnest/api/rules.py:292-318`; `backend/scripts/acquire.py:46-47,65-72`; `backend/src/starnest/data_acquisition/execution.py:319-325`.

Gate research does not check `llm.is_enabled` and can spend after it is disabled. CLI acquisition filters charging, not enabled state. Stand-ins are applied regardless of their source toggle.

**Gap/remedy:** Disabled-source tests cover ordinary plan/start/retry only. Reuse source eligibility across research, CLI, and borrowing. The source-toggle contract says disabled sources stop being consulted.

### BE-16 [Medium] - a zero cap stops an entirely free sweep

**Evidence:** `backend/src/starnest/data_acquisition/spend.py:56-59`; `backend/src/starnest/data_acquisition/execution.py:288-296`.

Zero is an accepted cap; `spent >= cap` is already true at zero spend. The post-source check halts a free-only sweep after its first adapter, skipping remaining free sources.

**Gap/remedy:** Tests cover paid exhaustion, not zero-cap/free execution. Apply monetary exhaustion only to financial work while preserving zero-cap prevention of paid calls.

### BE-17 [High] - billed empty research responses are treated as free

**Evidence:** `backend/src/starnest/data_sources/llm/client.py:164-167`; `backend/src/starnest/data_sources/llm/gates.py:76-81`.

The client correctly attaches billed cost/calls to `LlmUnavailableError` for no-text answers. Gate research converts that exception into a result with default zero cost/calls. Repeated billed failures do not exhaust the research cap.

**Gap/remedy:** Client cost-preservation tests stop before gate integration. Propagate the exception's billing data into failed research results; unusable output is not an unbilled call.

### BE-18 [Medium] - invalid configured prices undermine the spending model

**Evidence:** `backend/src/starnest/data_sources/llm/pricing.py:65-90`; `backend/src/starnest/main.py:436-451`.

Presence/FX checks permit negative or non-finite component prices. A negative assumed input-token count passes truthiness validation. Estimates/meters can understate or decrease spend while the provider charges positive amounts.

**Gap/remedy:** Tests cover absent prices/FX, not these values. Require finite nonnegative prices, explicitly permitted legitimate zero rates, and positive token estimates before enabling financial work.

### BE-19 [High] - completed paid candidate answers still wait in memory before commit

**Evidence:** `backend/src/starnest/data_sources/llm/employers.py:126-176`; `backend/src/starnest/data_sources/llm/fallback.py:145-206`; `backend/src/starnest/data_acquisition/run.py:90,114-138`; `backend/src/starnest/data_acquisition/execution.py:227,342,348`.

An adapter buffers every candidate result for one attribute. Killing the process during candidate 2 loses candidate 1's completed paid answer before ValueStore ever receives it. Collected failures can also disappear on hard death. Storage's per-append transactions cannot protect unreturned data.

**Gap/remedy:** Gate D dies on a second attribute, after the first fetch returned, not inside a candidate sweep. Stream and commit candidate outcomes/failures before the next call; this is a remaining per-item durability window, not the already fixed P30 path.

### BE-20 [Medium] - source-protocol exceptions abort without contextual failure records

**Evidence:** `backend/src/starnest/data_sources/open_meteo/response.py:23-26`; `backend/src/starnest/data_sources/open_meteo/adapter.py:114-120`; `backend/src/starnest/data_acquisition/execution.py:327-345`.

Decimal conversion can escape as `InvalidOperation`, outside the adapter's recognized source-error catches. Execution aborts remaining sources and saves only previously collected failures, omitting the current failed weather item.

**Gap/remedy:** Tests cover recognized malformed shapes, not escaping conversion failures. Normalize expected protocol errors into contextual failures; unexpected aborts should still preserve current-item evidence.

### BE-21 [Medium] - invalid requests can produce 500s or the wrong error body

**Evidence:** `backend/src/starnest/api/settings.py:24-35,63-72`; `backend/src/starnest/api/household.py:29-39,56-66`; `backend/src/starnest/api/criteria.py:209-217`; `backend/src/starnest/api/values.py:132-135`; `backend/src/starnest/api/errors.py:118-128`; `backend/src/starnest/api/app.py:100-103`.

Loose request DTOs defer rejection to unmapped domain construction errors, e.g. zero score scale, negative income, invalid identifiers, inverted thresholds/periods. Ordinary FastAPI request refusals also retain `detail` instead of the agreed `code`/`message`.

**Gap/remedy:** Tests emphasize status at DTO boundaries, not these conversions/body conformance. Validate and deliberately translate all input refusals into the contract's stable error shape.

### BE-22 [High] - empty-name edits can persist an unreadable criteria set

**Evidence:** `backend/src/starnest/api/criteria.py:399-416,486-488`.

Rename/duplicate use unvalidated copy paths; request names admit `""`. Storage accepts it, but the next validated read rejects the domain's minimum name length. GET/ranking/rename can fail for a successfully persisted set. Deletion, where permitted, or direct repair may be necessary; saved references can prevent deletion.

**Gap/remedy:** Tests use valid names. Validate the changed domain object before committing and constrain names consistently at the request boundary.

### BE-23 [Low] - unknown fields and illegal nulls are inconsistently ignored or coerced

**Evidence:** Mutating DTOs in `backend/src/starnest/api/settings.py`, `household.py`, `runs.py`, and `rules.py`; `backend/src/starnest/api/criteria.py:175-180,209-217`.

Several bodies omit extra-field refusal, and unknown query parameters are accepted. Misspelled lock fields can succeed without action; misspelled fields in replacement settings can clear actual values. Illegal null anchors clear anchors, and null boolean thresholds become false.

**Gap/remedy:** Strictness tests concentrate on CriterionInput extras. Enforce consistent body/query validation and distinguish omission from unsupported null.

### BE-24 [Medium] - mixed unknown scope IDs silently disappear

**Evidence:** `backend/src/starnest/api/runs.py:451-469`; `backend/src/starnest/api/rules.py:247-255,298-306`.

Scopes are intersected with known rows without checking leftovers. A valid country plus misspelled country, or valid plus unknown attribute/gate, proceeds on the reduced list, potentially spending while concealing part of the request.

**Gap/remedy:** Tests cover valid narrowing only. Validate every supplied identifier and level before planning/execution, reporting all unknown/out-of-level inputs.

### BE-25 [Medium] - plans omit freshness suppression applied at execution

**Evidence:** `backend/src/starnest/api/runs.py:162-203`; `backend/src/starnest/data_acquisition/execution.py:142-155`.

Planning does not consult refetch settings/last retrieval, while opening removes fresh attributes. A plan advertises items/calls/cost that are skipped; an all-fresh plan can subsequently refuse nothing-to-fetch.

**Gap/remedy:** Planning and freshness are tested separately. Share work expansion and freshness filtering, distinguishing any intentionally conservative cost estimate from actual planned scope.

### BE-26 [Medium] - truncated weather data is labeled a complete period

**Evidence:** `backend/src/starnest/data_sources/open_meteo/response.py:11-27`; `backend/src/starnest/data_sources/open_meteo/adapter.py:166-170,189-194`.

The parser ignores `daily.time`/expected dates. Any nonempty series without None cells is treated as complete. One returned day per place can become an annual/seasonal mean carrying a full-period label.

**Gap/remedy:** Tests check missing cells, not truncated/misaligned dates. Validate count, date coverage, and alignment before aggregation. No current publisher truncation was observed.

### BE-27 [Low] - malformed WDPA CSV rows silently lose provenance

**Evidence:** `backend/src/starnest/data_sources/published_tables/table.py:117-146`; `backend/src/starnest/data_sources/published_tables/tables/protected_planet_protected_land.csv:12-15`.

Current workings fields contain unquoted commas. DictReader's extra-column entry is ignored, discarding trailing explanation, including Norway's territory-exclusion continuation, despite a supposedly strict boot loader.

**Gap/remedy:** Tests check headers/values, not complete row widths. Quote the workings fields and refuse extra/missing CSV columns.

### BE-28 [Low] - AssignedScore fallback always constructs an invalid payload

**Evidence:** `backend/src/starnest/data_sources/llm/fallback.py:322-325`; `backend/src/starnest/data/payloads.py:337-364`.

**Status:** Latent. Construction supplies `assigner` instead of `assigned_by`, and omits required range bounds. An eligible non-manual AssignedScore fallback would bill an answer then refuse it. Present manual AssignedScores are intentionally excluded.

**Gap/remedy:** Fallback tests omit this type. Remove unsupported capability or provide a valid, deliberately defined range/assigner mapping before billing. This is not a request to fill deferred city data.

### BE-29 [Low] - JSON float decoding loses precision before Decimal conversion

**Evidence:** `backend/src/starnest/data_sources/transport.py:85-87`; `backend/src/starnest/data_sources/eurostat/jsonstat.py:136-143`.

Default JSON decoding rounds floating tokens before parsers use `Decimal(str(...))`. A long-significand value such as `0.1234567890123456789` cannot be reconstructed, potentially affecting exact boundary decisions.

**Gap/remedy:** Fixtures have modest precision. Decode floating JSON tokens directly as Decimal. This is a latent precision issue, not a verified changed current ranking.

### BE-30 [Low] - malformed employer elements become company-name strings

**Evidence:** `backend/src/starnest/data_sources/llm/employers.py:212-235`.

The response must be a list, but its elements are stringified. `[null,123,{"name":"Acme"}]` becomes labels such as `"None"` and object representations rather than refused evidence.

**Gap/remedy:** Tests reject a scalar list container, not non-string elements. Require nonblank strings and retain malformed-output failures instead of inventing company labels.

### BE-31 [Low] - comparison imports a dependency forbidden by the exhaustive graph

**Evidence:** `backend/src/starnest/comparison/comparison.py:27`; `backend/pyproject.toml:185-198`.

Comparison directly imports `TOTAL` from criteria, although its allowed dependencies are candidates/data/evaluation. A broad layer ordering permits this concrete forbidden edge, so the claimed exhaustive boundary enforcement does not hold.

**Gap/remedy:** Guards check layer placement/cycles, not exact allowed edges. Move/reach the shared percentage constant through an allowed dependency and enforce the actual import table.

### BE-32 [Low] - bare pytest includes live publishers by default

**Evidence:** `backend/pyproject.toml:52-59`; `backend/tests/live/test_world_bank_collections.py:21,81-101`; `backend/tests/conftest.py:108-133`.

Default selection excludes paid `live_llm`, not ordinary `live`. Direct pytest can make real HTTP calls and become network-dependent despite fast/offline-suite expectations.

**Gap/remedy:** Default-exclude both live categories while retaining explicit selectors and the paid guard. This is not a claim that `make check` calls publishers or spends money.

### BE-33 [Low] - current-source spend is not durable per billed call

**Evidence:** `backend/src/starnest/data_acquisition/execution.py:258-285`; `backend/src/starnest/data_sources/llm/employers.py:154-166`; `backend/src/starnest/data_sources/llm/fallback.py:178-191`.

**Status:** Known/deferred P36. Spend is persisted after a source returns, not per call. Death before return loses that source's billed totals; earlier completed-source totals survive. This refines the older "only at run end" description.

**Gap/remedy:** Gate D does not establish real per-call cost durability. Persist billing outcomes incrementally, coordinated with ledger decisions.

### BE-34 [Low] - gate-research spending has no durable record

**Evidence:** `backend/src/starnest/data_acquisition/research.py:127-178`; `backend/src/starnest/api/rules.py:310-325`.

**Status:** Known/deferred P28/Q224. Research cost is request-local and returned/logged, not ledgered. Lost responses, death, or proxy timeout can leave proposals but no durable aggregate billing record.

**Gap/remedy:** Tests verify returned totals only. Keep the deferral explicit; a future ledger should record billed outcomes independently of successful final responses.

### BE-36 [Medium] - finite-period confirmed gates never expire or become researchable again

**Evidence:** `backend/src/starnest/evaluation/rules.py:168-179`; `backend/src/starnest/data_acquisition/research.py:198-208`.

**Status:** Potential semantic defect; confidence Medium pending validity/override policy. Evaluation ignores the gate period, and research skips every confirmed answer regardless of expiry, unknown outcome, or changed household citizenship. An old annual quota can keep determining eligibility while explicit research skips it.

**Gap/remedy:** Tests omit expired/context-changed confirmations. Define period/context validity and an explicit re-research path that does not silently overwrite human decisions.

### BE-37 [Low] - fallback eligibility is attribute-global rather than candidate-specific

**Evidence:** `backend/src/starnest/main.py:379-387`.

**Status:** Latent requirements gap; present need unverified. An attribute is excluded from fallback if any adapter declares it, regardless of candidates actually covered or sources failing. A genuinely citable country-specific gap cannot use the documented fallback.

**Gap/remedy:** Tests assert declaration-set subtraction. Schedule explicit paid fallback after actual structured outcomes if this requirement remains. This does not authorize invented EF-native-English values or filling deliberately uncitable gaps.

### BE-38 [Medium] - the backend coverage gate blends two required floors

**Evidence:** `tools/audit_coverage.py:53-54,85-87`; `backend/pyproject.toml` coverage configuration; `docs/devplan.md:818-845`.

**Origin:** Coordinator tooling review, confirmed by backend reviewer. Covered lines and branches are summed into one percentage. With equal counts, 100% lines and 80% branches passes at 90%, despite separately required 85% floors. Coverage.py's single `fail_under=85` does not compensate.

**Remedy:** Enforce line and branch percentages separately globally and per package. No coverage command was executed; this is a counterexample to the guard's arithmetic, not a claim that current coverage is below its floor.

### BE-39 [Medium] - effective source priority returns overrides, not the resolved order

**Evidence:** `backend/src/starnest/api/catalog.py:225-228`; `backend/src/starnest/api/bodies.py:37-43`; `docs/openapi.yaml:1128-1135`.

Both attribute presenters return `source_priority_overrides` only, with no later global merge. No overrides yields an empty list; partial overrides omit remaining globally ordered sources, violating the explicitly server-resolved response contract.

**Gap/remedy:** Add no-override, partial-override, and global-reorder cases. Use the existing `attribute.effective_source_priority(sources).ordered` resolver. UI-32's separate inference problem remains even with this fixed.

## Storage

Inspected all 86 forward migrations and 86 rollback scripts in final-state/dependency context, seven query files, 12 storage implementation files, and 28 storage-test files. No database was queried. Historical populated upgrade/rollback conditions are distinguished from fresh-schema behavior.

### ST-01 [High] - concurrent starts can create multiple running acquisitions

**Evidence:** `backend/src/starnest/storage/run_store.py:41-67`; `storage/queries/runs.sql:19-25,274-288`; `storage/migrations/0004-data-acquisition.sql:5-23`.

Checking for a running run and inserting the next one are separate, without serialization or a single-running constraint. Two requests can both pass, commit, and perform duplicated financial work. Backend inspection found no enclosing lock.

**Gap/remedy:** Tests even create two running runs sequentially. Enforce exclusivity atomically, e.g. a partial unique index with translated refusal and existing-state preflight. BE-12 is the distinct retry guard omission.

### ST-02 [Medium] - whole-set replacement loses concurrent decisions

**Evidence:** `backend/src/starnest/storage/criteria_store.py:90-112`; `storage/queries/criteria.sql:242-294`.

Two edits read the same set, then clear/rewrite all contents. A gate toggle can be silently restored by an unrelated weight edit based on the earlier object. The database remains structurally valid while a successful decision disappears.

**Gap/remedy:** Tests use sequential replacement. Add optimistic revisions or lock the entire read/change/write operation; locking only final replacement is insufficient.

### ST-03 [High] - career retirement invalidates user-created and edited profiles

**Evidence:** `storage/migrations/0487-career-is-measured-by-the-workforce-that-exists.sql:35-43`; `storage/migrations/0477-career-weights-sum-exactly.sql:23-27`.

**Status:** Populated upgrade hazard; live exposure unknown. The migration sets replacement weights only for two named defaults but removes posting criteria from every set. A duplicate of 0477's valid profile loses 24.45+24.44, leaving 14.44+20+16.67 = **51.11**. Domain validation then rejects that profile. Edited default weights can also break.

**Gap/remedy:** Fresh-seed arithmetic misses customized upgrades. Transfer each set's actual retired weights, preserve unrelated choices, handle absent replacements, and validate every affected set.

### ST-04 [Medium] - default normalisation migrations overwrite choices or block upgrade

**Evidence:** `storage/migrations/0489-coastline-is-measured-at-one-stated-scale.sql:59-60`; `storage/migrations/0490-elevation-comes-from-the-agencies-that-survey-it.sql:54-55`; `storage/migrations/0491-forest-cover-can-finally-be-scored.sql:22-23`; `storage/migrations/0495-projected-heat-is-scored-by-standing.sql:16-30`.

**Status:** Populated upgrade hazard. These update user sets to percentile. An existing valid fixed target range violates 0468's fixed-only CHECK after the update and blocks migration; ordinary custom anchors are silently superseded.

**Gap/remedy:** Tests check fresh defaults only. Apply default decisions to genuinely unconfigured interpretations and preserve explicitly configured ranges/scales.

### ST-05 [Medium] - type-correction upgrades cannot delete criteria with child interpretations

**Evidence:** `storage/migrations/0478-school-quality-is-a-quantity.sql:38-68`; `storage/migrations/0492-child-benefit-is-a-share-of-the-wage.sql:26-55`; `storage/migrations/0009-criteria.sql:117-197`.

**Status:** Populated upgrade hazard. Parent criteria are captured/deleted without handling restrictive anchor/threshold FKs. A configured child-benefit threshold or anchors can block 0492 even if no measurement exists. Blind deletion would instead erase preferences expressed in incompatible old units.

**Gap/remedy:** Hygiene tests do not populate upgrade interpretations. Prefer retire/recreate; explicitly preserve or refuse interpretations that cannot be translated.

### ST-06 [Medium] - housing replacement resets inclusion and lock choices

**Evidence:** `storage/migrations/0488-housing-is-priced-by-what-it-costs-to-live-in.sql:64-71`.

**Status:** Populated upgrade hazard. Replacement copies weight but hardcodes scored=true, locked=false, and nonblocking. An excluded, locked purchase criterion becomes included and unlocked, changing an independent profile without user action.

**Gap/remedy:** Fresh catalog tests do not seed previous flags. Preserve inclusion/lock decisions and document any deliberate changes to other subjective fields.

### ST-07 [Medium] - saved interpretation and rule evidence are incompletely frozen

**Evidence:** `backend/src/starnest/storage/evaluation_store.py:197-214,246-263,359-382`; `storage/migrations/0010-evaluation.sql:34-79,143-164`; `backend/src/starnest/evaluation/ranking.py:306-326,517-531`.

Locks and typed matching thresholds are not frozen; reducer/breakdown columns are written but omitted on read. Rules retain text/magnitudes rather than input Value IDs. Exclude projected heat from scoring while retaining its warning, save, then change evidence: the old warning's exact source/date chain cannot reliably be reopened.

**Gap/remedy:** Snapshot tests assert selected fields, not full interpretation equality; one supposed edit test edits a different duplicate. Freeze supported criterion fields, map existing reducers, and retain rule-input evidence and interpretation. Reducer impact is latent, not missing city implementation.

### ST-08 [Medium] - historical snapshots read live types after same-ID retyping

**Evidence:** `storage/queries/evaluation.sql:236-264`; `storage/migrations/0478-school-quality-is-a-quantity.sql:46-49`; `storage/migrations/0492-child-benefit-is-a-share-of-the-wage.sql:34-37`.

**Status:** Populated upgrade hazard. Evaluation criteria join today's `value_type`, assuming immutability, while these migrations mutate that identity. A saved unanswered monetary criterion can later be reported as Quantity alongside yesterday's interpretation. Stored totals are not claimed to be recomputed.

**Gap/remedy:** Tests use one schema version. Retire/recreate types or explicitly freeze required type metadata and migrate historical interpretations.

### ST-09 [Medium] - successful transcribed rereads are reported unanswered

**Evidence:** `backend/src/starnest/data_sources/published_tables/adapter.py:73-77,93-104`; `backend/src/starnest/data_acquisition/run.py:111-122,154-159`; `storage/queries/values.sql:245-253,264-272`; `storage/queries/runs.sql:172-203,217-239`.

The adapter always uses transcription-day midnight as retrieval time. A later run receives the same natural key; append skips it and records no reuse association. The new run reports unanswered and offers re-asking although the source returned known evidence.

**Qualification/remedy:** "Zero new rows" is accurate; "nobody answered" is not. Duplicate tests omit run accounting. Record successful evidence reuse or distinguish successful no-op responses from unanswered items.

### ST-10 [Low] - external-score reads do not select a current edition

**Evidence:** `storage/queries/values.sql:339-356`; `docs/known-issues.md:494-498`.

**Status:** Known issue; latent until multiple editions exist. Reads return all editions without current/history distinction. Reference-start-only ordering also fails to deterministically distinguish editions sharing that start.

**Gap/remedy:** Tests store one opinion or prove coexistence only. Derive a deterministic current edition and expose/mark history separately.

### ST-11 [Low] - one run poll combines different database snapshots

**Evidence:** `backend/src/starnest/storage/run_store.py:132-155`; `backend/src/starnest/storage/connections.py:44-53`.

Header/counts, failures, unanswered list, and source totals use separate SELECTs under default READ COMMITTED. An intervening commit can yield one unanswered count but an empty unanswered list in the same response.

**Gap/remedy:** Tests read settled runs. Assemble details from one snapshot or a suitable read-only repeatable-read transaction.

### ST-12 [Low] - run-linked evidence is not constrained to planned scope or level

**Evidence:** `storage/migrations/0005-values.sql:7-18`; `storage/migrations/0004-data-acquisition.sql:32-58`; `storage/queries/runs.sql:172-203`.

**Status:** Latent integrity gap. Independently valid candidate, attribute, and run IDs can be combined outside planned scope. One planned item can coexist with one out-of-scope completed row and still remain unanswered, exceeding total partition arithmetic.

**Gap/remedy:** Tests supply in-scope rows. Add scope-membership and candidate/attribute/run level pins, preserving nullable run links for manual observations.

### ST-13 [Low] - saved contribution evidence can name the wrong measurement

**Evidence:** `storage/migrations/0010-evaluation.sql:125-138`; `storage/queries/evaluation.sql:353-358`.

**Status:** Latent; snapshot-membership omission was already known, wrong-evidence identity is an extension. A Portugal tax contribution can reference Romania housing evidence because Value ID, score attribute, and result candidate are independently constrained. An absent frozen criterion can also cause reopening failure.

**Gap/remedy:** Tests cover result/non-match membership only. Pin score attributes to the frozen evaluation and evidence to the correct candidate/attribute through composite keys.

### ST-14 [Low] - frozen criteria are not pinned to evaluation level

**Evidence:** `storage/migrations/0010-evaluation.sql:34-54`; `backend/src/starnest/storage/evaluation_store.py:88-95`; `docs/known-issues.md:494-496`.

**Status:** Known latent integrity gap. Country criteria can be saved under a city evaluation header, or a multilevel set can be saved unrestricted, despite candidate-result level constraints.

**Gap/remedy:** Tests validate result membership, not snapshot attributes. Add evaluation/attribute level pins and reject mismatched save inputs. This is generic integrity, not a demand to implement cities.

### ST-15 [Low] - accepted payload completeness and composition totals are not enforced

**Evidence:** `storage/migrations/0005-values.sql:34-37`; `storage/migrations/0006-value-payloads.sql:104-115`; `backend/src/starnest/storage/value_store.py:401-430`; `backend/src/starnest/data/value.py:127-130`.

**Status:** Latent SQL-ingestion gap. Typed FKs prevent the wrong child family but allow accepted parents without payloads, empty labels, or shares totaling 80. Domain reconstruction then fails before ranking computes coverage; this is not a claim of dishonest displayed scoring coverage. SQL completeness/run counts can still count parents.

**Gap/remedy:** Fixtures intentionally use parent-only rows. Add appropriate deferred accepted-payload completeness and share-sum checks, while allowing explained rejected observations.

### ST-16 [Low] - SQL finite checks permit numeric infinity

**Evidence:** `storage/migrations/0006-value-payloads.sql:29-30,47`.

**Status:** Latent SQL-ingestion gap. `amount <> 'NaN'` and equivalent magnitude checks reject NaN, not positive/negative infinity. Constraints named finite accept unusable quantitative evidence.

**Gap/remedy:** No infinity case exists in storage tests. Explicitly reject every non-finite numeric value; ordinary domain validation remains a separate boundary.

### ST-17 [Low] - multiple share thresholds collapse silently to the first

**Evidence:** `storage/migrations/0009-criteria.sql:175-197`; `storage/queries/criteria.sql:94-102`; `backend/src/starnest/storage/criteria_store.py:360-365`.

**Status:** Latent generic-threshold gap. SQL permits multiple labels, but the mapper returns only index zero. Whole-set replacement can then delete the other valid bounds permanently.

**Gap/remedy:** Tests omit multiple share bounds. Refuse unsupported multiplicity, as the neighboring label mapper does, or align schema/contract/domain on complete multi-bound support.

### ST-18 [Low] - conversion provenance is omitted by storage and API

**Evidence:** `storage/queries/values.sql:49-53,153-157`; `backend/src/starnest/storage/value_store.py:307-318`; `backend/src/starnest/api/values.py:204-207`; `docs/openapi.yaml:1062-1068`.

**Status:** Known/deferred P10; includes backend BE-35. SQL payload assembly lacks the FX publisher, and the API explicitly removes scalar rate/date fields without serving the required nested FxRate. The internal published-rate FK is present, but clients cannot display its provenance.

**Gap/remedy:** Round trips check amounts/rate membership, not publisher presentation. Serve the referenced published rate with rate/date/source. No active country Monetary-source exposure is asserted.

### ST-19 [Low] - attribute-removing rollbacks ignore persistent run references

**Evidence:** `storage/migrations/0488-housing-is-priced-by-what-it-costs-to-live-in.rollback.sql:40-47`; `storage/migrations/0470-european-air-connectivity.rollback.sql:26-35`; `storage/migrations/0004-data-acquisition.sql:40-45`.

**Status:** Populated historical rollback hazard. At the relevant schema version, a normal acquisition leaves scope references. Rollback clears values but attribute deletion still violates the run-scope FK. Transaction rollback is safe; the recovery operation is unusable for that populated state.

**Gap/remedy:** Hygiene tests miss durable run references. Preserve/retire the row or explicitly preflight/refuse with a supported recovery path; do not erase run history silently.

### ST-20 [Medium] - container migrations bypass the required backup

**Evidence:** `Makefile:72-80,180-181`; `compose.yaml:132-135`; `docs/arch.md:1093-1101`.

**Origin:** Coordinator operational review. `migrate` depends on backup; `docker-migrate` calls the profile-gated migrate service directly, which runs yoyo without pg_dump. The normal container migration path does not enforce the documented backup-before-every-migration protection for irreplaceable manual data.

**Remedy:** Make container migration depend on successful backup before applying schema/catalog changes, and document the same safe path for direct Compose usage. No migration or backup was run.
