# GPT-6 Astra findings verification

## Method and scope

- **Baseline:** `7182d376ebb1d59cfff984b9f3d2a646303d23c3`; independently confirmed with read-only Git. **Review date:** 2026-10-12.
- **Input:** all 91 findings in `docs/copilot-review.md`, read before tracing the implementation. That report is the claim being tested, not evidence of correctness. Its original severities are retained.
- **Strictly static:** source, SQL, tests, contracts and project decisions were read. No tests, builds, linters, generators, application imports, services, network requests, database connections, migrations or installs were executed. No secrets, backups or personal records were inspected. No other reviewer's artifact was consulted and no work was delegated.
- The country-level v1 is the baseline. `docs/reqs.md` §1.3 and `docs/devplan.md` §0.0 distinguish it from the draft city-level work in `docs/devplan-v2.md` §§1–2. Recent explicit decisions take precedence over obsolete comments: for example Q218's proposals, Q220's paid opt-in, Q226's second set and Q232's source switches.
- **REAL** includes accurately scoped accepted/deferred limitations and supported upgrade/direct-SQL integrity gaps; it does not mean every live installation has already encountered the trigger. A test citation below describes its assertions, **not an observed passing result**. Runtime incidence and the user's actual database contents remain unmeasured throughout.
- **Citation conventions:** backend module paths such as `evaluation/ranking.py` are relative to `backend/src/starnest/`; migration filenames are under `storage/migrations/`. Short test filenames refer to the uniquely named file under `backend/tests/` or `ui/src/` in the stated package/feature. Frontend feature-relative paths are under `ui/src/routes/`; shell/API paths are under `ui/src/`. All line references are to the current baseline, not the source report's excerpts.

## Verdict summary

**91 adjudications: 88 REAL, 2 UNREAL, 1 UNCERTAIN.** Original severity totals remain **14 High, 48 Medium, 29 Low**. The verdict is independent of severity; rejected claims retain their source severity as metadata, not an endorsement.

| finding_id | severity | verdict |
| --- | --- | --- |
| UI-01 | High | REAL |
| UI-02 | High | REAL |
| UI-03 | High | REAL |
| UI-04 | Medium | REAL |
| UI-05 | Medium | REAL |
| UI-06 | Medium | REAL |
| UI-07 | Medium | REAL |
| UI-08 | Medium | REAL |
| UI-09 | Medium | REAL |
| UI-10 | Medium | REAL |
| UI-11 | Medium | REAL |
| UI-12 | Medium | REAL |
| UI-13 | Low | REAL |
| UI-14 | Medium | REAL |
| UI-15 | Medium | REAL |
| UI-16 | Medium | REAL |
| UI-17 | Medium | REAL |
| UI-18 | Medium | REAL |
| UI-19 | Medium | REAL |
| UI-20 | Medium | REAL |
| UI-21 | Medium | REAL |
| UI-22 | Low | REAL |
| UI-23 | Medium | REAL |
| UI-24 | Medium | REAL |
| UI-25 | Low | REAL |
| UI-26 | Low | REAL |
| UI-27 | Medium | REAL |
| UI-28 | Low | REAL |
| UI-29 | Medium | REAL |
| UI-30 | Low | REAL |
| UI-31 | Low | REAL |
| UI-32 | Medium | REAL |
| UI-33 | Low | REAL |
| BE-01 | High | REAL |
| BE-02 | High | REAL |
| BE-03 | High | REAL |
| BE-04 | Medium | REAL |
| BE-05 | Medium | REAL |
| BE-06 | Medium | REAL |
| BE-07 | Medium | REAL |
| BE-08 | Medium | REAL |
| BE-09 | Low | REAL |
| BE-10 | High | REAL |
| BE-11 | Medium | UNREAL |
| BE-12 | High | REAL |
| BE-13 | Medium | UNREAL |
| BE-14 | Medium | REAL |
| BE-15 | High | REAL |
| BE-16 | Medium | REAL |
| BE-17 | High | REAL |
| BE-18 | Medium | REAL |
| BE-19 | High | REAL |
| BE-20 | Medium | REAL |
| BE-21 | Medium | REAL |
| BE-22 | High | REAL |
| BE-23 | Low | REAL |
| BE-24 | Medium | REAL |
| BE-25 | Medium | REAL |
| BE-26 | Medium | REAL |
| BE-27 | Low | REAL |
| BE-28 | Low | REAL |
| BE-29 | Low | REAL |
| BE-30 | Low | REAL |
| BE-31 | Low | REAL |
| BE-32 | Low | REAL |
| BE-33 | Low | REAL |
| BE-34 | Low | REAL |
| BE-36 | Medium | UNCERTAIN |
| BE-37 | Low | REAL |
| BE-38 | Medium | REAL |
| BE-39 | Medium | REAL |
| ST-01 | High | REAL |
| ST-02 | Medium | REAL |
| ST-03 | High | REAL |
| ST-04 | Medium | REAL |
| ST-05 | Medium | REAL |
| ST-06 | Medium | REAL |
| ST-07 | Medium | REAL |
| ST-08 | Medium | REAL |
| ST-09 | Medium | REAL |
| ST-10 | Low | REAL |
| ST-11 | Low | REAL |
| ST-12 | Low | REAL |
| ST-13 | Low | REAL |
| ST-14 | Low | REAL |
| ST-15 | Low | REAL |
| ST-16 | Low | REAL |
| ST-17 | Low | REAL |
| ST-18 | Low | REAL |
| ST-19 | Low | REAL |
| ST-20 | Medium | REAL |

The principal counterfindings are **BE-11** (the handwritten retry contract explicitly permits a covering rectangle) and **BE-13** (ask-again deliberately consults capable sources and requires new financial consent; the demonstrated unrelated-cap refusal belongs to BE-14). **BE-36** needs an explicit validity/override policy. Several REAL findings have narrower consequences than the source report suggests; those qualifications are part of their verdicts, notably BE-18's non-finite configuration subclaim, ST-07's existing effective snapshot tests, and BE-39's incorrect presenter citation.

## Detailed verification

### UI-01 - nginx times out synchronous paid gate research

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High for the timeout/reporting defect; Medium for post-disconnect continuation.

**Documented context.** `docs/reqs.md:1916-1920,2127-2155` permits paid country gate research with cost control and human confirmation. Q224 (`docs/reqs.md:3250`) defers a durable ledger, not delivery of the immediate result.

**Trace and proof.** `ui/nginx.conf:14-27` applies a 60-second upstream read timeout to every `/v1/` request. `ui/src/routes/configure/proposals/useProposals.ts:82-91` awaits the ordinary JSON research POST. `backend/src/starnest/api/rules.py:273-325` awaits `research_gates`; `backend/src/starnest/data_acquisition/research.py:127-178` loops over questions and writes proposals, but sends no response bytes until completion. Therefore a supported research pass silent for more than 60 seconds loses its HTTP result at nginx even if proposals were already persisted. This is not fixed by the asynchronous **acquisition-run** endpoint, which is a different route.

**Tests, scope and limits.** `ui/playwright.config.ts:39-66` normally uses Vite; `ProposalsPanel.test.tsx:231-255` supplies an immediate JSON outcome. Neither establishes proxy behavior. Whether a particular deployed ASGI stack cancels work after disconnect, and how much overlap a subsequent retry produces, needs runtime observation; neither is necessary to establish the timeout. “Hiding proposals” is temporary loss of the completion response, not deletion of already recorded proposals: a later GET can recover those.

### UI-02 - whole-bucket retry starts without an estimate or confirmation

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1916-1926,2797-2804` requires an estimate and confirmation before acquisition, including selective retry. Q220 (`docs/reqs.md:3246`) requires fresh explicit acceptance when uncapped. The later design-sync decision (`docs/todos.md:67-70`; `docs/design-brief.md:200-203`) also calls for confirmation before spending and an estimate inside each remedy's card; it does not waive whole-bucket confirmation.

**Trace and proof.** The failed and unanswered buttons call `run.again` directly (`ui/src/routes/run/RunScreen.tsx:144-153,184-193`). `useRunScreen.ts:232-235` immediately POSTs through `retryRun`; `ui/src/api/endpoints.ts:249-261` sends only `{items}`. It never enters `propose`, `armed`, or the confirmation strip. The backend retry reads the current cap and executes (`backend/src/starnest/api/runs.py:349-387`), so paid failed work under a configured cap starts on that first click.

**Counterevidence and tests.** Backend cap enforcement is real: without a cap this request refuses rather than spending silently, because the wrapper cannot send `accept_uncapped_spend`. Selected-item remediation does estimate/confirm (`useRunScreen.ts:179-216`); that does not guard the whole-bucket buttons. `RunScreen.test.tsx:143-165,262-281` actually asserts the direct request after one click, rather than a confirmation. Reachability requires a retryable paid item and configured LLM path, not a city feature. The actual bill remains runtime-dependent; the missing interaction is statically established.

### UI-03 - browser tests overwrite household-owned gate answers

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Gate results belong to a candidate and rule, not a criteria set (`docs/reqs.md:1486-1513`); provenance and overrides are meaningful household decisions. `docs/devplan.md:271-275` describes isolated test databases, but that promise is not implemented by this browser configuration.

**Trace and proof.** `ui/playwright.config.ts:39-66` reuses/starts the ordinary application against an already migrated database. Gate C duplicates a set (`ui/e2e/gate-c.spec.ts:30-54`) but its gate arrangement uses the global result URL. Before the gate example it writes Greece's `not_matching`; afterward it writes `matching` with null reason (`:155-163,483-493`). `backend/src/starnest/api/rules.py`'s PUT and `storage/queries/criteria.sql`'s result upsert replace the answer and its citations. If the original was a real exclusion, or no row existed, neither state is restored. The set's isolation cannot protect a global answer.

**Tests, scope and limits.** The affected spec is itself executable evidence of the write sequence; `docs/todos.md:146-156` records the stray Greece result without proving current contents. `ui/e2e/sanity.spec.ts:124-144` additionally restores the cap only after reload/assertions succeed, not in guaranteed cleanup. A dedicated disposable deployment would contain the damage, but is not required by the configuration. No browser test was run here; obsolete selectors elsewhere do not make this separately selectable gate test harmless.

### UI-04 - asynchronous completions can overwrite the current selection

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Criteria sets are independent full copies (`docs/reqs.md:1166-1190`), and the UI must show backend answers for the selected set (`docs/arch.md` §8.1).

**Trace and proof.** `ConfigureScreen.tsx:30-34` keeps `useCriteriaEditor` mounted across selection changes. In `useCriteriaEditor.ts:100-128,140-161,175-185`, an A request captures A's URL, but completion merges by **attribute alone** into whatever `criteria` state exists then. Interleaving: submit A, switch to B, finish B's GET, finish A's mutation → B's displayed rows receive A's returned weights. Within a set, `PillarWeightsPanel.tsx:64-91` similarly accepts responses in arrival order without a revision guard. Its keyed remount in `ConfigureScreen.tsx:81-91` protects a cross-set **pillar component**, not the still-mounted criterion hook or same-set ordering.

`useRunScreen.ts:133-157,219-238` also has unguarded `fetchRun` completions: delayed automatic opening or an earlier history click can replace a newer deliberate selection.

**Tests and limits.** `ConfigureScreen.test.tsx:225-277` tests sequential selection and completed writes. `RunScreen.test.tsx:346-382` tests one history opening. `useResource.test.ts` tests canceled/stale GETs, but these completions bypass that guard. No runtime latency premise beyond ordinary overlapping requests is required. Persisted lost updates are separately adjudicated under ST-02.

### UI-05 - a pillar-slider release can submit multiple commits

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** Medium.

**Documented context.** `docs/reqs.md:1205-1220` makes one weight adjustment a proportional rebalance; the control's own promise is one commit per gesture (`PillarWeightsPanel.tsx:227-267`).

**Trace and proof.** `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:245-267,310-329` binds pointer-up, mouse-up, key-up and blur independently to `commit`. The only duplicate guard compares with the old **server** `weight.weight`; there is no pending ref, last-submitted value or disabled slider. After a changed release but before the PUT resolves, moving focus away dispatches blur with the same changed DOM value. Both calls see the unchanged server weight and call `onMove`, producing two whole-level requests. Ordinary pointer compatibility mouse-up can provide the second event even without changing focus.

**Tests, counterevidence and limits.** `PillarWeightsPanel.test.tsx:157-186` asserts one request after **one synthetic `pointerUp`**; `:188-211` separately tests a key release. Neither drives a combined sequence while holding the response. The criterion slider's saving-disable behavior is not present on this pillar slider. A browser trace is still needed to determine the exact compatibility-event sequence for a particular native range implementation; the release-then-blur path already establishes the “can submit multiple” core. Duplicate identical requests need not change the final vector alone, but become consequential with overlapping edits.

### UI-06 - save completion discards edits entered while saving

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** The household and settings are user-owned configuration (`docs/reqs.md` §§3.9–3.10); displaying accepted state does not authorize discarding a later, unsent edit.

**Trace and proof.** `useHouseholdForm.ts:37-48` and `settings/useSettingsForm.ts:30-46` serialize draft D1, await PUT, then unconditionally replace the draft with D1's response. Their panels leave controls editable and expose no saving flag. Type D2 during the await → completion overwrites D2. `ui/src/routes/run/useManualEntry.ts:58-69` similarly clears the entire draft on success while `ManualEntryPanel.tsx:75-88,190-226` disables only submission. `criteria/useCriterionRule.ts:49-66` resets from stored JSON after a save; the rule fields remain editable during it. Household/settings also allow a second submit while the first is pending.

**Tests, counterevidence and limits.** `HouseholdPanel.test.tsx:59-107`, `SettingsPanel.test.tsx:59-98`, and `RunScreen.test.tsx:1554-1612` wait for the save before further edits. `CriterionRuleFields.test.tsx:299-328` protects an unsent rule from a **weight** save, a different case fixed by the separate saving flags. Returning a refused rule to stored state is deliberate; that does not solve revision loss for newly typed input. This is an ordinary v1 latency interleaving, not evidence of already lost user text.

### UI-07 - source reorders allow concurrent operations and stale partial-failure state

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Q232 (`docs/reqs.md:3052`) makes source trust order and enablement editable and consequential to active values.

**Trace and proof.** `sources/useDataSources.ts:24-45` PATCHes the first source and then neighbors sequentially, reloading only after all succeed. Each PATCH is its own backend transaction. If A's priority update commits and B's fails, `catch` shows an error but retains the pre-operation list: the displayed order is no longer storage's order. `DataSourcesPanel.tsx:33-34,68,126,149,161` uses global busy state only for dragging; switches/arrows on other rows remain enabled because their `busy` is false. A second arrow operation can calculate from the original list and interleave its PATCHes.

**Counterevidence and tests.** The drag guard is effective and tested by `DataSourcesPanel.test.tsx:495-537`, including a held response. That test never clicks another row's arrow/switch. The refusal test (`:153-175`) fails the **first** PATCH, leaving no partial persistence to expose. The current priority constraint permits intermediate ties; that avoids reorder failure but is not transactionality across the sequence. A user can reload manually after an error; the misleading state still exists until then. No speculative database corruption is needed for this finding.

### UI-08 - undo history omits criteria-set identity

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Sets are independent opinions (`docs/reqs.md` §3.4); the shipped history explicitly promises to reverse real requests, not merely alter local presentation (`docs/todos.md`'s second design-sync context).

**Trace and proof.** `ConfigureScreen.tsx:30-34` retains one `useChangeHistory` across set switches. Weight/lock history keys in `useCriteriaEditor.ts:105-123,145-157` contain only the attribute. `changeHistory.ts:52-62` collapses adjacent equal targets, keeping the older `before` but spreading the newer change, including its reverse closure. Example: A's attribute 50→40, switch to B, B's same attribute 20→30. History now has `before=50` and the reverse closure targeting **B**. Undo sends B weight 50 rather than restoring B to 20 and A to 50.

**Tests and limits.** `changeHistory.test.ts:35-48` intentionally asserts retention of the first `before`; `ConfigureScreen.test.tsx:694-720` checks one reverse request in one set. Neither incorporates set identity. The guard that prevents collapsing across a different **target** does not help, because a set switch creates no history entry. Reachable when two sets share the attribute, which full duplication guarantees; the actual user's history is not inspected. Locks have the same identity defect even where a coincidental boolean makes a particular undo appear harmless.

### UI-09 - scalar weight reversal is not always a true undo

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Proportional weight changes are required by `docs/reqs.md:1205-1220`; the UI's “Back to where I started” promises restoration rather than merely moving one scalar.

**Trace and proof.** `useCriteriaEditor.ts:98-123` records only the moved weight and reverses by PATCHing that weight. `useChangeHistory.ts:58-64` executes these reverse closures. `backend/src/starnest/criteria/rebalancing.py:62-76` distributes the remainder equally if all unlocked absorbers currently have zero weight. Thus unlocked `[50,20,30]` → first weight 100 → `[100,0,0]`; reversing the first scalar to 50 gives `[50,25,25]`, permanently losing the 2:3 sibling ratio. The three-criterion slider can reach 100 (`weights.ts:268-276`), so the example is not blocked by presentation bounds.

**Tests, counterevidence and limits.** Ordinary nonzero proportional edits are reversible, which explains why typical use looks correct. `ConfigureScreen.test.tsx:694-720` asserts `{weight:50}` and returns empty rebalanced criteria; it does not compare the original/restored vectors. The backend's equal-zero-absorber rule is reasonable for a **new** decision; it cannot recover information history never retained. This is current configuration functionality, not a request for deferred persistent history.

### UI-10 - invalid numeric settings silently serialize as null

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Unset and chosen settings are distinct (`docs/reqs.md:1657-1673`); an unset cap changes what consent is required (Q220).

**Trace and proof.** These are text inputs, **not** native number widgets: `settings/SettingsPanel.tsx:111-145` supplies `inputMode` but no numeric `type`. `numericInput.ts:20-34` accepts a lone decimal point and normalizes a lone comma to it. `settingsForm.ts:140-155` tests only blankness, then evaluates `Number(".")`, yielding NaN. `ui/src/api/client.ts:335-355` uses `JSON.stringify`, whose non-finite numeric members become null. SettingsBody and Settings both allow null (`backend/src/starnest/api/settings.py:24-35,63-72`). Consequently `"."` in coverage or cap saves as an intentional clearing rather than an invalid-entry refusal. A sufficiently long digits-only string also overflows Number.

**Tests, counterevidence and limits.** `numericInput.test.ts:26-39` covers valid decimal/comma handling; `SettingsPanel.test.tsx:72-96` distinguishes blank from zero, not nonblank NaN. Whole-number fields filter dots differently, so the direct `"."` example is specifically the decimal-capable fields. Clearing the cap does **not** itself authorize paid work: backend uncapped refusal survives. Clearing coverage does remove its floor, and a later explicitly accepted uncapped run is no longer bounded by the discarded cap.

### UI-11 - persistent sidebar facts are not invalidated after writes

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:2764-2770` requires persistent candidate counts and last-run summary; configuration changes recalculate from stored data (§5.6).

**Trace and proof.** `ui/src/app/App.tsx:42-77` keeps Sidebar outside the changing routes. `Sidebar.tsx:180-183` fetches household once. `useShellSummary.ts:24-48` refreshes counts on set/level identity and last-run data only on its own reload. Household save (`useHouseholdForm.ts:43-48`), criterion mutations and `useRunScreen.ts:117-128` update local state/resources, but dispatch no sidebar invalidation. Save a new household, or finish a run while retaining selection → the sidebar keeps its successful old resource while a newly opened route fetches current facts.

**Counterevidence and tests.** `SelectionContext.tsx:49-55` has an explicit notification for saved rankings, demonstrating a working cross-subtree pattern, but it is not used for these resources. `App.test.tsx:167-224` asserts initial sidebar facts; it makes no household/configuration mutation between reads. The independent acquiring strip polls a separate resource, not the summary. A full-page reload or selection change can refresh some facts, but does not make routine post-save presentation truthful. Exact stale numbers depend on user data, which was not inspected.

### UI-12 - rule-effect explanations make false eligibility claims

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Q218 (`docs/reqs.md:3244`) says proposals rule nothing out; compound warnings can apply without removing rank (§§3.7a,5.3).

**Trace and proof.** `rules/useRuleToggles.ts:50-56,106-107` passes all result rows through. `ruleEffect.ts:9-13,30-47` has no `is_proposal` test: an unconfirmed `not_matching` becomes “Removes …”. The backend's effective guard is the opposite (`evaluation/rules.py:168-179` excludes proposals), so this is a false explanation, not an actual unauthorized exclusion. Separately `RulesPanel.tsx:104-115` sets **every** compound effect to null; `:182-189` renders null as “Applies to no candidate right now.” An applied decided heat warning can coexist with that false statement.

**Tests and limits.** `ruleEffect.test.ts:39-51` verifies removal text without modeling proposals at all. `RulesPanel.test.tsx:130-154` checks compound labels/toggling, not agreement with ranked warnings. `0496` supplies a real applied country rule, although whether a live candidate currently fires requires its values. Both subclaims are supported; the accurate remedy could be an honest “effect not shown” rather than client-side reimplementation of eligibility.

### UI-13 - proposal confirmation drops its reference period

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High, with explicitly latent research scope.

**Documented context.** `docs/reqs.md:1493-1502` gives gates a validity period; `docs/openapi.yaml:1484-1501` accepts it. `docs/known-issues.md:420` explicitly records this latent omission.

**Trace and proof.** `proposals/useProposals.ts:93-104` copies answer, reason, citations and `data_source=manual`, but not `reference_period`. `ProposalsPanel.tsx:170-177` does not display the period. The PUT defaults an omitted period to null (`backend/src/starnest/api/rules.py`'s input and result construction); it is a full result replacement, not a merge. Therefore a period-bearing proposal becomes a confirmation without that validity metadata.

**Counterevidence, tests and limits.** Current `Researched` has no period (`data_acquisition/research.py:57-65`) and `research_gates` constructs proposals without one (`:155-165`). Hence the normal researcher currently cannot generate the trigger; the report correctly labels it latent. The contract and stored-result model can represent a period-bearing proposal. `ProposalsPanel.test.tsx:258-297` uses `toMatchObject` for only answer/source/citations and a fixture without a period, so it cannot detect the omission. Omitting retrieval time means the server stamps confirmation time; whether the original check time should instead survive requires a separate policy choice. No automatic expiry consequence is assumed here.

### UI-14 - research discards actual spend and cap-halt outcome

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Q224 and Q225 (`docs/reqs.md:3250-3251`) distinguish returned actual spending from estimates and deliberately defer only durable ledgering.

**Trace and proof.** The backend returns `cost_eur`, `calls`, `halted_on_spend_cap` and proposals (`api/rules.py:319-325`). The typed client retains these fields (`ui/src/api/endpoints.ts:566-576`), but `useProposals.ts:82-91` stores only refusals and reloads answers. `ProposalsPanel.tsx:72-111` keeps presenting the old estimate, with no last-outcome state. A capped partial pass that returned usable proposals but no refusals has no visible signal that it stopped early and no actual cost/call total.

**Tests, counterevidence and limits.** `ProposalsPanel.test.tsx:231-255` returns billing/status fields and asserts only refusal text. The backend cap can still work; this finding is about disclosure of its outcome. A returned response containing the evidence disproves “the backend never reports it,” but does not help a user whose screen discards it. This is current paid country research, independent of the accepted ledger limitation under BE-34. Runtime calls/cost need not be measured to prove the missing display path.

### UI-15 - alternative values display the active figure's contribution

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:172-196,1384-1473` distinguishes objective values from the criterion reading and demands visible competing evidence; a saved contribution names its exact used value (§3.4a).

**Trace and proof.** `CandidateDetail.tsx:74-78` fetches all values, while `:120-125` obtains current attribute scores. `attributeScores.ts:14-20,35-55` discards `used_value` and keys solely by attribute. `CandidateDetail.tsx:372-395` prints that same score/used weight/contribution for every competing row. Two different tax values therefore each appear to have generated the one active tax contribution; rejection does not suppress these cells. `:400-405` additionally equates `is_active` with “Scored”, although an active descriptive/excluded value need not participate. `pillarFilter.ts:60-78` likewise does not filter `is_scored`.

**Tests and limits.** `RankScreen.test.tsx:1001-1012` explicitly selects only the active row for contribution assertions. More decisively, `:396-415` describes a descriptive air value and nevertheless expects three “Scored” labels: it encodes that semantic mistake. The backend arithmetic and the inactive/rejected marker can still be correct; the defect falsely associates explanatory numbers with other measurements. Multiple sources and excluded criteria are already supported country workflows.

### UI-16 - candidate provenance permanently stops at 500 values

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** All stored source values must remain visible (`docs/reqs.md:1472-1473,2815-2820`); growing value lists are paginated (`docs/arch.md:968-970`).

**Trace and proof.** `ui/src/api/endpoints.ts:287-296` makes one `/values` request with `limit:500` and no offset. `CandidateDetail.tsx:174-191` uses only `items`, ignoring `total`, under “Every stored value.” If the server reports 501 or more observations, nothing follows the next page or offers navigation. `foldRepeats` runs only on the received subset; it cannot recover omitted history. The SQL natural key includes retrieval time (`0005-values.sql:38-57`), so routine repeated acquisition legitimately grows one country's history past the limit.

**Tests, counterevidence and limits.** `RankScreen.test.tsx:396-415` covers four rows. `api/endpoints.test.ts:104-144` tests pagination for **fetchValuesFromRun**, whose loop exists at `endpoints.ts:327ff`, not for candidate reads. API pagination therefore is not the missing guard; this consumer fails to use it. Which omitted rows include a currently active value depends on query ordering/history, so no specific active-value omission is presumed. The false claim of complete provenance is established once the page is exceeded.

### UI-17 - ten runs are presented as complete history and monthly spending

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:2804` calls for every persisted run with cost/scope/outcome. Q224 separately acknowledges spending outside that run ledger.

**Trace and proof.** `useRunScreen.ts:113-115` calls `fetchRuns(10)` once per reload. `RunScreen.tsx:240-257` supplies those items to the diff/history beneath “Every acquisition so far”; it never reads `total` to paginate. `databaseHolds.ts:57-66` computes monthly spending only from the provided array. Eleven €1 runs this month therefore show ten runs and €10, even if the server correctly stored €11. Older runs have no choice in this view's history/diff controls.

**Tests, counterevidence and limits.** `RunScreen.test.tsx:332-358` checks a small recent history; `databaseHolds.test.ts:58-104` verifies addition and calendar boundaries on supplied lists, not completeness of acquisition. The reducer is correct for its inputs. Q224's non-run research omission and BE-33's crash window cannot justify omitting **durably recorded** run costs. A latest-ten widget would be an intentional limitation if labeled as such; the current unqualified history/monthly claims are not. Runtime evidence is needed only to determine whether a particular installation has exceeded ten.

### UI-18 - configurable scores are clamped or interpreted as 0-100

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1657-1667,1728-1734` makes the score maximum configurable; Q193 (`:3219`) freezes saved interpretation/scale.

**Trace and proof.** `rankTable.ts:95-103,206-228` passes a **score** through the percentage clamp, then formats the clamped value as label and tooltip. At maximum 200, valid pillar score 150 becomes displayed 100. This is a number error, not just a compressed chart. `CandidateDetail.tsx:290-292,480-485` hardcodes “Score 0–100” and treats score directly as percent width. `ComparisonMatrix.tsx:251-256` similarly labels other scales “normalised 0–100”. `SavedRankingView.tsx:35-45` renders the generic table without a frozen maximum, so reopening does not fix those assumptions.

**Counterevidence and tests.** Clamping **coverage** percentages is correct; reusing that clamp for a configurable score is not. `rankTable.test.ts:89-176` exercises scores within 0–100. The backend has explicit alternative-scale assertions (`evaluation/test_ranking.py:106-109`), establishing that the input is supported, not malformed. Smaller scales also receive misleading labels/geometry. The total-score cell uses `formatScore`, not this percentage clamp (`RankingTable.tsx`'s ScoreCell), so this is not a claim that stored totals are rewritten. The saved view omits the frozen maximum; its missing scale context is real, but the current saved list read need not even include pillar data. The strongest concrete number-corruption example is the live pillar label, not every saved total.

### UI-19 - raw comparison mode reverses ahead/behind semantics

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Comparisons retain raw-unit deltas but assess advantages by weighted contributions (`docs/reqs.md:2826-2840`); a goal is subjective (§3.4).

**Trace and proof.** `attributeRows.ts:88-94,119-120` computes normalized `comparator-focus` but passes raw `focus-comparator` unchanged. That raw convention is also explicitly documented in `backend/src/starnest/comparison/comparison.py:43-49`. `ComparisonMatrix.tsx:267-280` sends either delta into the same `divergingBar`; `divergingBar.ts:99-104` interprets positive as comparator “ahead”. For a maximize criterion, focus 90/comparator 70 has raw +20 but comparator score delta −20: switching modes reverses the semantic color/direction. A target-range raw sign cannot establish desirability at all.

**Tests, qualifications and limits.** `CompareScreen.test.tsx:299-324` verifies a minimize cost example and the raw −13.4 number, not direction across goals. The raw numeric subtraction is correct; the faulty claim is its ahead/behind **presentation**. There is no literal “ahead” sentence in each cell (`ComparisonMatrix.tsx:344-370` uses direction classes), so the report's “label” wording overstates the textual symptom. The classes and directional geometry still encode the incorrect interpretation. No change to backend synthesis is implied.

### UI-20 - external scores omit both provenance dates

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1335-1347,2821-2824` expressly requires the provider, scale, **both dates**, methodology and rank context for outside opinions.

**Trace and proof.** `CandidateDetail.tsx:558-608` renders Publisher/Published/Scale/Caveats only. Reference start and retrieval time occur in the React key (`:577-582`), which is not visible content; reference end is unused. The backend/client carry these fields, so no unavailable-data limitation explains their absence. Two otherwise similar publisher scores from different periods display without the dates needed to distinguish their currency. `published_rank_of` is also omitted while rank itself is shown.

**Tests and limits.** `RankScreen.test.tsx:558-575` checks the methodology link; `:672-692` checks separation from scored figures. Those are meaningful safeguards against feeding composites into scoring, not assertions of dated provenance. The finding concerns the supported external-score display when rows exist; it does not claim any current country score was ingested or that a publisher fetch is missing. The omission is statically decisive without accessing real editions.

### UI-21 - repeat folding hides distinct quotes and citations

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1402-1406,1472-1473,2146-2149` makes supporting text/pages part of evidence and requires retained sources to remain visible.

**Trace and proof.** `repeatedValues.ts:38-48` fingerprints payload, candidate, attribute, source, period, breakdown, rejection and confidence, but not quote or citations. `:68-76` chooses one newest representative. `CandidateDetail.tsx:308,335-368` shows only that representative's pages/quote plus a repeat count. Hold payload/source/period constant, change the cited page or explanation and retrieve again → the earlier distinct evidence is folded away without an expander to recover it.

**Counterevidence and tests.** Folding genuinely identical evidence is deliberate and need not be removed. `repeatedValues.test.ts:59-147` verifies separation by magnitude, attribute, breakdown, grade, candidate, source, period and rejection; it does not vary provenance text/pages. Its 26-copy test (`:32-41`) therefore proves only a narrower identity than the comment's “byte-identical” promise. Values are still stored, so this is loss from the evidence view rather than deletion. A provenance-changing reread is a supported append-only scenario; current incidence is unknown.

### UI-22 - acquisition diff classifies rounded text instead of measurements

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Runs link their produced observations so changes can be compared (`docs/reqs.md:1590-1622`); formatting is not the underlying evidence (§3.6). The second-sync notes in `docs/todos.md:104-109` distinguish “figure moved” from “same figure came back.”

**Trace and proof.** `acquisitionDiff.ts:90-99,142-157` calls `describeFigure` before `isUnchanged`, which compares strings. `format/figure.ts:55-62` rounds to two decimals. Same-pair quantities 1.071 and 1.074, same unit, both become “1.07 …”, so the diff calls the observation unchanged although its stored magnitude changed. This can hide a meaningful boundary-adjacent movement without altering any score directly.

**Tests, counterevidence and limits.** `acquisitionDiff.test.ts:142-176` tests 780→780 and 780→812; it does not test unequal values with equal formatting. The code explicitly chooses display-string equality; that is evidence the behavior is intentional **in implementation**, not a documented exception making “unchanged” a measurement claim accurate. A rounded-display comparison would be legitimate if labeled accordingly. Runtime prevalence is not established, and no changed current ranking is asserted.

### UI-23 - browser gates target obsolete labels and comparison markup

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Gate C is intended to verify the actual product (`docs/devplan.md` §0.2); display names, rather than programmatic IDs, are an explicit design rule (`docs/design-brief.md`).

**Trace and proof.** `CriteriaPanel.tsx:329-361` forms `title` from the catalog display name and uses `Weight for ${title}`. Gate C's helpers search `Weight for country.…` (`gate-c.spec.ts:391-392,442-454`); the minimum e2e helpers (`:182,239,252`) and sanity rule-of-law selectors (`sanity.spec.ts:348-349,371-372`) do likewise. Neither a catalog-loaded title nor the humanized fallback equals the dotted ID. Gate C also filters the comparison table by “Attribute” (`:327-329`), while `ComparisonMatrix.tsx:86-107` initially heads its closed rows with “Pillar”; attributes require expansion.

**Tests, counterevidence and limits.** Unit tests often supply ID-shaped mock names, allowing those test helpers to work without proving real-stack selectors. The current component naming is intentional, so reverting accessible names to IDs would not be the right correction. No test was executed and no exact failure transcript is claimed; the selector/markup mismatch is static. Other examples that never use these selectors can still run, including the harmful global setup described under UI-03.

### UI-24 - Acquire does not poll its displayed live progress

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:2802` requires live progress; Q161 (`:3187`) and `docs/arch.md:1033-1038` explicitly select polling while a run is live.

**Trace and proof.** `useRunScreen.ts:133-157,219-222` reads a run once on open/start and again only on manual Refresh; it installs no interval for `current`. `RunScreen.tsx:482-485,547-555` acknowledges this. `AcquiringBar.tsx:22-25` hides the independent shell strip on Acquire; its hook's state is not RunScreen's state. Therefore a run that transitions after the initial GET leaves this screen saying “running” or “stopping” until a person rereads it.

**Tests, counterevidence and limits.** `RunScreen.test.tsx:412-444` proves one additional read after clicking Refresh. Gate C's “poll” loop (`gate-c.spec.ts:291-309`) repeatedly **clicks that button itself**; it is not application polling. Stopping polling after terminal state is sensible and avoids needless work; it does not justify never polling a running selection. No authoritative v1 scope exception was found. The backend's pollable resource and asynchronous start remain valid; the defect is this consumer's missing refresh lifecycle.

### UI-25 - clearing comparison focus enables a silent no-op

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** A comparison needs one focus and comparators (`docs/reqs.md:2826-2831`); an enabled action must not silently do nothing.

**Trace and proof.** `CompareScreen.tsx:251-258` offers an empty-string placeholder and forwards `event.target.value`. `:147-158` stores that string unchanged; `:286-294` disables only for `focus === null` or no comparators. With a selected comparator, clearing focus therefore leaves Compare enabled. Submission tests truthiness (`:158`), so `""` sends no request and leaves the previous `asked` comparison unchanged.

**Tests and limits.** `CompareScreen.test.tsx:81-89` checks initial null/no selection; its level-change reset test (`:91-108`) is a different path. Selecting an existing focus works correctly, as does removing all comparators. The finding is the explicit supported “Choose a candidate…” option **after** a valid selection, not malformed state injected by a test. No runtime premise beyond normal select-change handling remains.

### UI-26 - keyboard focus inside the household picker closes its options

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Household configuration is v1's first workflow (`docs/reqs.md:114-130,2789-2792`). This is functionality of a shipped focusable control, not a demand for a deferred city picker.

**Trace and proof.** `household/CandidateField.tsx:96-111` schedules closure 120 ms after the input blurs. Options are native focusable buttons (`:121-134`); only mouse-down clears the timer. Tab from the open input into one of those buttons causes blur without mouse-down. After 120 ms the list unmounts, taking the focused option away before a reader who pauses can activate it. No containment/`relatedTarget` check distinguishes leaving the composite from moving within it.

**Tests, counterevidence and limits.** `CandidateField.test.tsx:103-113` tabs and asserts the input text was restored; it does not assert that focus left the entire picker or that the new option remains usable. Enter on a unique match (`:115-133`) is a functioning alternative, not a fix for ambiguous matches navigated by Tab. Mouse selection and blur-timer cleanup on unmount address different issues. Exact focus fallback after the option disappears is browser-specific; removal of the keyboard target follows directly from state/timer logic.

### UI-27 - roster failures become unexplained empty required pickers

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** The household must choose a real home country and citizenship; manual entry must choose a candidate (`docs/reqs.md` §§3.9,6.5,8.2).

**Trace and proof.** `api/useCandidateNames.ts:77-86` exposes only a roster or `NOBODY`, collapsing error/loading/empty into one array. `HouseholdPanel.tsx:70-72` builds required choices from that result without error/reload access. Independently, `ManualEntryPanel.tsx:35-42,75-88` has its own resource but shows options only when ready, never rendering its read error. `:167` renders only **save** errors. A failed candidate GET therefore produces an empty required selector while the rest of the form continues working.

**Counterevidence, tests and limits.** The shared promise resets after failure, so a **newly mounted** consumer can recover; `useCandidateNames.test.ts:76-88` proves precisely that by mounting another hook. It does not give the mounted household form a retry action. Household and manual-entry success tests (`HouseholdPanel.test.tsx:181ff`; `RunScreen.test.tsx:1554-1612`) supply successful rosters. Silent fallback is appropriate for optional names beside existing facts, not these required inputs. A full navigation/reload can recover; the current workflow nevertheless provides no actionable explanation.

### UI-28 - a successful empty set refresh retains a deleted selection

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High, latent concurrent/deletion scope.

**Documented context.** The selected set governs every evaluation (`docs/reqs.md` §§3.4,8.1); absent and loading are distinct client states.

**Trace and proof.** `SelectionContext.tsx:85-97` returns for **any** empty `available` list without consulting resource status. Thus even a completed empty response preserves the previous selected ID. `CriteriaSetsPanel.tsx:151-160` prevents deleting the only visible set, but two deletions started from a stale two-set list, or a supported independent API deletion, can remove both. `sets/useCriteriaSets.ts:53-61,108-110` just deletes/reloads and explicitly leaves selection correction to SelectionContext; it supplies no hidden clearing guard. `backend/src/starnest/storage/criteria_store.py:130-142` allows deleting a final set if no saved evaluation references it. Subsequent screens still request the vanished ID.

**Counterevidence, tests and limits.** The UI's ordinary sequential last-set guard reduces reachability; referenced sets also refuse deletion. Neither is a universal prevention. `CriteriaSetsPanel.test.tsx:130-171` meaningfully checks the selected surviving set, but always leaves one survivor. `SelectionContext` deliberately protects just-created selections from a lagging list; that behavior can be preserved while distinguishing successful emptiness. This is not a claim the shipped default sets can necessarily both be deleted in the user's present database.

### UI-29 - manual gate entry and independent overrides have no UI workflow

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:134-140,1490-1502,1587-1588,1895-1899,2784-2785` assigns manual gate answers, overrides and manual country exclusion to the user. Nomination is deferred; editing an existing country's gate is not.

**Trace and proof.** The actual client write is `api/endpoints.ts:594-605`. Its only product caller is `proposals/useProposals.ts:93-104`, which writes the proposed answer unchanged as manual. `ProposalsPanel.tsx:120-149,190-199` lists only proposals and offers Confirm. `RulesPanel.tsx:76-115` changes enforcement/application membership, not a candidate's result. Consequently there is no path to create an exclusion without a proposal, disagree with one, or correct a confirmed answer.

**Tests, counterevidence and limits.** `ProposalsPanel.test.tsx:258-320` verifies same-answer confirmation and disappearance from the proposal list. The backend PUT supports an override and sources; having that HTTP capability is counterevidence against a **backend** omission, not a screen workflow. No subsequent decision in the v2 scope or current todo/design exceptions defers this existing-country operation. This verdict does not demand a nomination interface or arbitrary new rule creation.

### UI-30 - external-score row keys omit reference-period end

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High for identity collision; Medium for its visible manifestation.

**Documented context.** An edition's two reference dates are distinct (`docs/reqs.md:1335-1347`). Migration `0113-external-scores-span-a-period.sql` explicitly permits editions with the same start but different ends.

**Trace and proof.** `CandidateDetail.tsx:577-582` keys a publisher row by source, reference **start**, and retrieval time only. A valid January edition and full-year edition from the same source, ingested at the same time for this candidate, differ in reference end but produce the same key. The SQL natural key deliberately distinguishes those rows, so this is not invalid backend input. No stable row ID replaces the incomplete key.

**Tests and limits.** `RankScreen.test.tsx:558-575,672-692` checks one publisher row/link and separation from raw values. It does not render same-start/different-end editions or update their order. Duplicate React keys establish an identity violation; exact dropped/reused DOM behavior depends on reconciliation and should not be stated as inevitable for the first render. This is a latent supported edition case, separate from selecting a current edition under ST-10.

### UI-31 - unset comparator guidance promises unlimited comparisons

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** The comparator bound is configurable (`docs/reqs.md:2826-2840`); provisional unset settings are not permission to invent a bound.

**Trace and proof.** `settings/settingsForm.ts:74-80` tells the user an unset comparator limit accepts as many as picked. The actual comparison endpoint (`backend/src/starnest/api/comparisons.py:97-109`) checks the setting and refuses `comparator_limit_not_set`; `CompareScreen.tsx:220-223` correctly explains that refusal. Therefore the same supported configuration has contradictory instructions: Configure invites unlimited use and Compare cannot execute it.

**Tests and limits.** `ui/e2e/sanity.spec.ts:290-294` clears the field and asserts the incorrect explanatory text without saving/performing a comparison. `CompareScreen.test.tsx:372-386` checks the actual refusal guidance. The backend limit enforcement is intact, so this is a misleading help statement, not unbounded comparison resource use. No runtime test is needed to settle the contradictory strings and endpoint guard.

### UI-32 - source-priority membership is mistaken for adapter capability

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1969-1995` defines priority as evidence ordering. `docs/openapi.yaml:1128-1135` explicitly resolves overrides followed by the global order, not an adapter capability set.

**Trace and proof.** `run/unsourced.ts:88-89` and `criteria/criterionReading.ts:188-190` infer “nobody would be asked” solely from an empty priority list. Capability actually comes from adapter declarations (`backend/src/starnest/data_acquisition/adapter.py:134-147` and `main.py:320-340`). A globally ordered source can be capable with no override; conversely a declared priority can exist before an adapter is implemented. The current manual treaty/administrative attributes have declared priorities without a structured fetcher. Fixing the API to return the complete global fallback order would make virtually every attribute nonempty, not make this inference correct.

**Tests, scope and limits.** `unsourced.test.ts:16-31,115-118` explicitly equates a list's presence with source coverage. Those assertions certify the assumption rather than falsify it. BE-39 currently makes the response only overrides, worsening the problem but not causing the conceptual mismatch. No live misclassification count is asserted. This finding asks for truthful capability labeling, not permission to fill deliberately uncitable or deferred gaps.

### UI-33 - multiple adapters sharing a publisher produce duplicate plan-row keys

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High for duplicate rows/keys; Medium for visible update effects.

**Documented context.** `docs/reqs.md` §§3.5,6.3 distinguishes publisher identity from planned work; the plan must explain its source breakdown.

**Trace and proof.** `backend/src/starnest/api/runs.py:190-194` appends one plan entry per **adapter**, with only `data_source` and item count. `main.py:320-340` registers one adapter per published table. Both `national_elevation_range.csv:1` and `national_met_office_sunshine.csv:1` identify `national_statistics`. A normal country sweep therefore has two entries with that same publisher. `RunScreen.tsx:391-410` maps them into siblings keyed only by `source.data_source`, producing duplicate keys and indistinguishable per-publisher labels.

**Tests, counterevidence and limits.** `RunScreen.test.tsx:30-47` checks existence of a per-source table, not uniqueness when publishers repeat. The composition-root test's uniqueness guard is for **(source, attribute)**, so these distinct attributes correctly pass that guard. RunDetail's derived publisher grouping is a separate, correctly aggregated surface. Duplicate keys can affect subsequent reconciliation; exact visible duplication/loss was not observed here. Per-adapter item counts themselves are not arithmetically wrong, only insufficiently identified as presented.

### BE-01 - criterion matching thresholds are never evaluated

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1736-1754` requires typed threshold matching; `docs/arch.md:878-887` explicitly separates eligibility from scoring. Initial TBD thresholds are not a deferral of the editor's supported non-null thresholds.

**Trace and proof.** The PATCH constructs a typed threshold (`backend/src/starnest/api/criteria.py:181-224`), domain revalidation retains it, and `storage/criteria_store.py:252-279,321` writes/reads it. `api/rankings.py:160-196` passes the loaded set to `rank_candidates`. That function filters scoring criteria and builds contributions, then `_result_for` combines only `gates_that_rule_out` and compound-rule judgements (`evaluation/ranking.py:412-455`). No production evaluator reads `matching_threshold`; its production references stop at construction, storage and presentation. Set a supported Ratio threshold `max_value=12`, give a scoreable country raw value 20, enforce no failing gates: it remains matching. An excluded label criterion's membership threshold is likewise not consulted.

**Tests and limits.** `backend/tests/acceptance/test_endpoints.py:423-523`, despite naming “TheThresholdThatDecidesAMatch”, checks persistence, clearing and shape rejection, never ranking status. `evaluation/test_ranking.py:805-848` checks named gates, not typed thresholds. The absence of seeded thresholds explains why the baseline ranking need not already be wrong, but cannot protect a user-entered threshold. Historical saved reasons cannot fix live eligibility that was never evaluated.

### BE-02 - normalisation rounds before weighting and can reverse rankings

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1728-1734` unambiguously requires full-precision intermediate arithmetic and integer **display** only.

**Trace and proof.** `evaluation/normalisation.py:170-218,328-343` quantizes slopes, anchored scores, `as_is`, and percentile outputs to integers. `ranking.py:327-366,517-531` then computes contributions from those integers. At weights 90/10, precise A `[49.49,50.51]` totals 49.592 and B `[49.51,49.00]` totals 49.459. Display-only rounding yields A=50, B=49. The implemented early conversion gives A `[49,51]` →49.2→49 and B `[50,49]` →49.9→50. `_ranked` orders those totals, reversing the comparison. These numbers are representable with legal fixed Quantity anchors 0→0,100→100, so no forbidden-method premise is needed.

**Tests, counterevidence and limits.** `test_normalisation.py:125-128` expressly expects 7.4/7.5 to become 7/8. `test_ranking.py:142-149` checks contributions sum to the rounded total, which does not independently verify pre-normalisation precision. Decimal weight redistribution correctly preserves its own precision; it cannot recover already rounded scores. This establishes a supported numerical counterexample, not a claim that today's stored country ordering changed by this exact example.

### BE-03 - insufficient scoreability suppresses definite non-matches

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/arch.md:878-887` expressly gives definite `not_matching` precedence over insufficient **scoreability**, with warnings independent; `docs/reqs.md` §§5.3–5.4 distinguishes these meanings.

**Trace and proof.** `evaluation/ranking.py:412-428` returns an `INSUFFICIENT_DATA` result as soon as a blocking/coverage refusal exists. The named gates and compound rules are not evaluated until `:430-439`. State: one manually confirmed enforced visa gate says `not_matching`; a separate blocking attribute is absent. `_why_it_cannot_be_scored` returns a reason, and `_result_for` exits without non-match reasons or warnings. The missing figure therefore suppresses a known independent reason that the country cannot match.

**Counterevidence and tests.** Confirmed gates correctly retain scores on **scoreable** candidates (`test_ranking.py:805-821`), and missing data correctly produces null scores alone (`:168-264`). Those tests never combine the states. The correct outcome need not invent a total: it can carry null score, its insufficiency explanation, and decisive non-match status. An unanswered/proposed gate is intentionally ignored; the counterexample uses a confirmed negative answer, so Q218 does not prevent it. Coverage can drop through ordinary source disablement or a raised floor in country v1.

### BE-04 - valid zero-scoring-mass configurations cause unhandled errors

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1149-1165,1791-1796` distinguishes exclusion from missing evidence and allows zero weights; nothing requires every remaining scored criterion to have positive mass.

**Trace and proof.** CriteriaSet validation sums **all stored** weights, including excluded criteria (`criteria/criteria_set.py:165-185`). A pillar `[100 excluded,0 included]` is therefore valid, as is another pillar with positive scoring mass. `ranking.py:237-258` renormalizes each remaining pillar separately; its `{remaining:0}` reaches `weighting.py:135-146` and raises `WeightingError`. That error is absent from `api/errors.py:67-100`, so the request has no stable domain refusal. Separately `pillars_with_no_criteria` (`criteria_set.py:217-232`) includes zero-weight empty pillars, and `ranking.py:161-171` refuses them despite recommending “give it no weight.”

**Tests and limits.** `test_weighting.py:217-220` correctly refuses an isolated zero-total normalization; it does not prove ranking should send a noncontributing group there. `test_ranking.py:338ff` exercises exclusions with surviving positive weights, and `:850-884` exercises an empty **10-weight** pillar. The whole-empty-set `RankingError` is correctly mapped and is not this defect. No malformed sum, unsupported third level or direct SQL is necessary for the first case.

### BE-05 - normalisation legality is not checked against value type

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** The legal-method table is authoritative (`docs/reqs.md:1009-1034`): Quantity/Count cannot use `as_is`, Monetary is fixed-only, AssignedScore is `as_is`-only.

**Trace and proof.** `Criterion._reject_a_criterion_that_is_not_a_rule` (`criteria/criterion.py:169-185`) checks target bands, reducers, anchors and threshold shape, but never matches method against value type. `api/criteria.py:304-306` routes a method edit through `with_criterion_scoring`; `_with_revalidated` (`criteria_set.py:352-378`) reruns that same incomplete validation. SQL checks known method names and fixed target bands (`0009-criteria.sql:75-83`; `0468:21-25`), not the type/method matrix. A non-target-range Quantity changed to `as_is` with raw magnitude 20 is thus accepted and read as 20 score points rather than evaluated against a chosen scale.

**Tests, qualifications and limits.** `test_criterion.py:299-305` asserts anchor-free readability for both relative methods without enforcing type legality. The catalog-arithmetic suite verifies **seeded rows**, not arbitrary supported PATCHes. Temperature with an existing target-range goal would be blocked by the fixed-band guard; changing only its method is not the right counterexample. A Count/ordinary Quantity, or a jointly changed legal goal plus method, reaches the missing type check. Some bad methods produce coverage loss instead of arbitrary scores; both are unintended accepted configurations.

### BE-06 - Quantity units are not validated against their declared dimension

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1031-1038,1053-1063` requires compatible dimensions and explicit conversions.

**Trace and proof.** `data/manual.py:63-78` selects the payload **type** but accepts its supplied unit. `data/attribute.py:286-317` validates type, credible range and allowed labels, not `quantity_parameters.unit`. `data/value.py:92-114` checks type and candidate/attribute level only. SQL's `value_quantity.unit` FK (`0006-value-payloads.sql:38-47`) verifies a known unit, not this attribute's unit/dimension. For manual-enabled `country.naturalisation_pathway`, magnitude 5 with known unit `celsius` can persist. `evaluation/magnitudes.py:47-48` extracts 5 without conversion, so if that manual observation becomes active, a years-based criterion interprets degrees as years.

**Tests, counterevidence and limits.** `data/test_manual.py:22-54` always supplies “years”; it meaningfully checks type substitution but not unit mismatch (`:76-80`). Ordinary adapters generally copy the catalog unit, reducing accidental current-source exposure. Manual priority/competing values may prevent this bad entry becoming active until stronger sources are absent or disabled; that conditional consequence is essential. Payload-type FKs and correctly wired range rejection are not dimension guards.

### BE-07 - confidence derivation is disconnected from production reads

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1842-1869` defines high as current official measurement and requires degradation for age/geography/derivation, without score discounting.

**Trace and proof.** `data/confidence.py:69-100` implements degradation, but production references only export it; acquisition construction sets an explicit/default grade (`data/measurements.py:49,83`). `storage/value_store.py:375-393` reconstructs the stored grade unchanged, and `ranking.py:296-301,398-402` puts it into the confidence split. The final active-value view (`0480:43-64,91-104`) computes freshness separately but leaves `confidence_level` unchanged. A formerly high official value aged beyond `max_age`, still the sole acceptable observation, remains active and high in that split.

**Tests, counterevidence and limits.** `data/test_confidence.py:88-121` proves the isolated helper's arithmetic. Some adapters deliberately mark derived observations medium/low at construction, so “no confidence handling anywhere” would be false. Fresh-beats-stale selection is also effective; the report correctly does not dispute it. No integration step applies age-based grades on read. Runtime data is needed to count currently overstated grades, not to establish the aging path; saved confidence should remain historically frozen rather than be retroactively recomputed.

### BE-08 - rejected measurements are absent from selective failure retry

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1077-1084` explicitly requires both retained rejected evidence and a contextual acquisition failure so retry can reach it.

**Trace and proof.** `Measurements.figure` attaches `rejection_reason` without raising (`data/measurements.py:74-102`). `data_acquisition/run.py:111-138` appends all returned values and stamps only `acquired.failures`; it never turns a rejected returned value into a failure. `storage/queries/runs.sql:140-150,172-203` counts a retained rejected observation as completed, not unanswered. With one rejected value and no adapter failure, `retry_run` (`execution.py:490-493`) refuses “nothing to retry,” and ask-again also has no unanswered pair. The active-value guard correctly prevents scoring the bad value but cannot make it retryable.

**Tests and limits.** `data/test_measurements.py:203-223` checks rejection/payload retention; `data_acquisition/test_run.py:143-182` checks independently supplied failures. `storage/test_value_store.py:387-428` proves rejected values are not active. None links attribute rejection to failure rows. Provider-scale exceptions that adapters already translate into failures are a different path and do not disprove this returned-rejected-value case. A normal adapter returning a credible-type value outside a declared range is sufficient.

### BE-09 - WHO bypasses attribute-explicit validation

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High, latent catalog-range scope.

**Documented context.** `docs/reqs.md:1049-1084` separates provider/type validation from the attribute's stricter credible range. The P59 fix described in `docs/known-issues.md:439` applies through Measurements.

**Trace and proof.** WHO's `fetch` calls `_a_value` (`data_sources/who/adapter.py:107-123`), which directly constructs `Value` and `Index` (`:164-194`) rather than `Measurements.figure`. Index validates its declared provider scale; Value has no loaded Attribute on which to check `allowed_range`. Supply a supported catalog range 0–80 while provider bounds remain 0–100 and WHO returns 90 → construction succeeds without rejection. The normal storage path persists that accepted value.

**Tests, counterevidence and limits.** `who/test_adapter.py:214-222` checks 140 against a 0–100 provider scale, correctly recording a per-country failure. It does not exercise a value inside that scale but outside an attribute range. WHO's shipped UHC configuration need not currently contain such a narrower range; the report accurately labels the residue latent. This is a generic attribute-validation invariant, not a claim the published UHC values are presently wrong or a request to add a new source.

### BE-10 - retry wrappers do not forward the running cost meter

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1916-1920` and `docs/arch.md:830-837` require bounded new paid work with completed work retained. Recent per-candidate metering is implemented, but must survive decoration.

**Trace and proof.** `run.py:84-85` calls `adapter.meter_with(new_meter)`. `_AskedOnlyAbout` (`execution.py:532-564`) forwards identity, prices, attributes and fetch, but inherits the no-op hook from `adapter.py:104-130`. Real LLM adapters retain `_meter` on their instances (`llm/employers.py:65-69,102-106`; `fallback.py:86-122`). The registry lives in application state across requests (`main.py:166-202`; `api/dependencies.py:63-71`). After a capped first run exhausts M1, a failed retry creates M2 but never gives it to the underlying adapter; its candidate loop still sees M1 exhausted and refuses all candidates. After restart/fresh wrapping, no meter exists and an entire candidate batch can bill before the outer check.

**Tests and qualifications.** `test_retry.py:253-288` checks `costs_money`/estimate forwarding, not the hook. `test_run.py:341-396` tests an unwrapped candidate-metered adapter. Even an old nonexhausted M1 can account against the wrong run; acquired totals later updating M2 does not restore per-call stopping. The report's two different lifetime scenarios are both necessary; it would be wrong to assume the underlying meter is always absent.

### BE-11 - selective retries expand exact items into Cartesian products

**Original severity:** Medium  
**Verdict:** UNREAL  
**Confidence:** High for failed-retry contract compliance; Medium for the broader unanswered interpretation.

**Documented context and counterevidence.** The general requirement says “only what failed” (`docs/reqs.md:1922-1926`), but the **handwritten target** deliberately defines the supported approximation: `docs/openapi.yaml:789-792` says the failed retry covers “every failed candidate against every failed attribute,” with source-specific attribute narrowing. This is not a generated restatement of accidental code. The claim treats that explicitly designed rectangle as an implementation violation.

**Actual trace.** `execution.py:495-505,522-564` preserves each failed source's attribute set and uses the failed candidates' union. For A/X/a and B/Y/b it indeed asks A/a for X,Y and B/b for X,Y. That is precisely the target's stated rectangle, not an unnoticed loss of the source stamp. `ask_again:601-606` also expands its candidate/attribute lists, consistent with the two-list scope model, though the target is less explicit about that subcase (`openapi.yaml:794-797`).

**Tests, scope and limits.** `test_retry.py:280-288` checks source attribute narrowing; `test_ask_again.py:238-267` checks single-pair narrowing and all capable sources. They do not prove exact-pair execution, but the failed-retry target does not promise it. The “free bulk source” rationale in `retry_run:479-487` is outdated for paid candidate loops; exact-pair paid retries may be desirable and the unanswered contract could be clarified. That is a design revision, not proof this implementation violates its explicit supported failed-retry protocol. No paid-overrun claim follows merely from the cross product when caps operate correctly.

### BE-12 - retry blocks despite 202 and omits the in-flight guard

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Asynchronous accepted-run/polling behavior is explicit in `docs/arch.md:795-802,1033-1038`; the later one-run-at-a-time P35 decision supersedes the old permissive double-click remark at §7.6.

**Trace and proof.** Start checks `run_in_flight`, calls `open_run`, and attaches `continue_run` as a background task (`api/runs.py:250-287`). Retry has no corresponding check/background parameter and awaits `ask_again` or `retry_run` (`:362-387`); both call `execute_run`, which awaits `continue_run` (`execution.py:363-369,497-520,603-623`). Thus no 202 bytes can be sent until the retry finishes. A long paid retry traverses nginx's timeout, and a second retry can enter while it is still running. Even the original run can still be running: only failure/unanswered presence and scope are checked.

**Tests and limits.** `acceptance/test_runs_api.py:879-939,943-989` meaningfully verifies exclusivity/asynchronous status for **start**. Retry tests (`:387-429`) check new IDs/scoping using quick stubs; `test_llm_path_api.py:214-247` verifies consent, not lifecycle. Single atomic-start races are separately ST-01. Disconnect cancellation is runtime-dependent, but synchronous awaiting and absence of a retry guard are static and affect current country paid work.

### BE-13 - unanswered retry loses the original paid-source eligibility decision

**Original severity:** Medium  
**Verdict:** UNREAL  
**Confidence:** Medium.

**Documented context and disproof.** `docs/openapi.yaml:794-797` explicitly defines ask-again as asking **every source that can answer** the unanswered attributes, not the original registry subset. `:811-817` expressly requires new uncapped agreement, rather than inheriting the original. Q220 (`docs/reqs.md:3246`) similarly forbids remembering uncapped permission. The report's proposed preservation of an original eligibility decision is not an established requirement for this deliberately new request.

**Actual trace and material qualification.** `api/runs.py:349-365` passes enabled adapters; `execution.py:601-623` narrows to the earlier unanswered attributes and rechecks the current cap/new acceptance. The current registry's fallback attributes exclude every structured declaration (`main.py:379-387`), and the employers-only adapter does not overlap a free sweep's answerable scope. Consequently the asserted current unexpected billing path does not exist. An unrelated paid adapter can still cause an erroneous cap refusal because `open_run:185-188` tests registry membership: that is a **real** current defect adjudicated in BE-14, not proof of lost authorization.

**Tests and remaining decision.** `test_llm_path_api.py:204-247` proves the request must reaccept uncapped work; `test_ask_again.py:249-267` deliberately asks all capable sources. A future overlapping paid fallback registry would need an explicit policy on whether an ask-again click/estimate authorizes newly capable paid work. That future design premise cannot establish this distinct current defect, especially when the source report itself excludes current billing reachability.

### BE-14 - unrelated paid adapters make free explicit work require a cap

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Q220 (`docs/reqs.md:3246`) refuses a run **that can spend**, not all explicit scopes whenever an LLM is configured. `docs/reqs.md` §6.3 separates estimating selected work from bounding it.

**Trace and proof.** `asked_this_run` (`execution.py:412-428`) includes all enabled adapters for an explicit attribute list. The plan prices only overlapping attributes (`api/runs.py:190-203`), so an explicit Eurostat-only attribute correctly estimates zero LLM calls/cost. `open_run:185-188`, however, asks `any(adapter.costs_money for adapter in adapters)` without the overlap filter. With an enabled employers LLM elsewhere in the registry and no cap, the same free scope refuses `spend_cap_not_set` before fetching. `acquire` would never call that paid adapter for this attribute.

**Tests, counterevidence and limits.** `test_llm_path_api.py:138-190` covers all-paid and all-free plans; `test_retry.py:291-340` similarly separates registries. None supplies a free explicit scope plus an unrelated paid adapter. Disabled paid sources are filtered correctly, and an entirely unscoped initial free sweep excludes them, so those paths are not counterexamples. Reachability requires the paid path configured/enabled, not actual paid work in this scope. No key or live configuration was inspected.

### BE-15 - disabled sources remain consultable through other paths

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Q232 (`docs/reqs.md:3052`) and `0480-a-source-can-be-switched-off.sql:29-30` promise that a disabled source is neither scored nor asked, while its evidence remains stored.

**Trace and proof.** Ordinary plan/start/retry use `switched_on`. Gate research instead gets the application-held researcher and checks only whether it is configured (`api/rules.py:292-318`; `api/dependencies.py:54-62`), never the `llm` source toggle. With unconfirmed gates and financial consent it can therefore bill after disablement. CLI acquisition (`backend/scripts/acquire.py:46-47,65-85`) excludes charging adapters, not disabled ones. Stand-in execution is unconditional after adapters (`execution.py:319-325`); `catalog_store.py:204-218`/`queries/catalog.sql:164-177` load declarations without source enablement.

**Tests and qualifications.** `acceptance/test_runs_api.py:433-505` checks disabled ordinary adapters by counting failures, an effective assertion for those paths. It does not cover researcher, CLI or stand-ins. The final active-value view **does** exclude disabled sources (`0480:91-104`), so values from those extra fetches will not score; the defect is unwanted consultation/work and, for research, spending. A zero cap still stops paid research, and no configured researcher gives 501. Those guards narrow the trigger but do not honor the toggle.

### BE-16 - a zero cap stops an entirely free sweep

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** A cap limits money (§6.3); free acquisition should not require financial consent (Q220). Zero is supported by `household/settings.py:65-74`, not an invalid input.

**Trace and proof.** `CostMeter.is_exhausted` (`data_acquisition/spend.py:56-59`) is true at `spent=0,cap=0`. `open_run` creates that meter even for free-only work. `acquire` fetches its first attribute then checks exhaustion (`run.py:143-150`), and `continue_run:288-296` halts after the first adapter outcome. Thus a free registry with multiple attributes/sources loses remaining free work and reports a monetary halt without spending a cent.

**Tests, counterevidence and limits.** `test_spend.py:87ff` proves a free run is not refused at **startup**. `test_run.py:367-384` proves free adapters receive no per-candidate meter hook, but uses a positive cap; the outer unconditional exhaustion checks remain. Paid adapters correctly check zero before a paid call; removing that protection would be wrong. This finding requires handling free work separately, not allowing zero-capped paid work. It is reachable through ordinary Settings/API, without hypothetical publishers.

### BE-17 - billed empty research responses are treated as free

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md` §6.3 and Q219 require accurate metering; unusable output is not evidence that no call was billed.

**Trace and proof.** `llm/client.py:154-167` computes provider usage before rejecting empty text and raises `LlmUnavailableError(cost_eur=…,calls=1)`. `llm/gates.py:76-81` catches it but constructs `Researched` without cost/calls, whose defaults are zero (`research.py:57-65`). `research_gates:141-151` meters those zeros and continues through the remaining gates. For a cap of €1 and repeated €0.6 empty answers, the request can bill multiple euros while its meter stays zero. Other LLM adapters explicitly preserve the same exception's billing (`employers.py:149-157`, `fallback.py:176-184`), which confirms the researcher is the missing propagation path.

**Tests and limits.** `test_client_and_pricing.py:243-257` asserts billing survives the exception; `test_the_three_uses.py:369-387` tests an unbilled network failure and malformed nonempty JSON with cost, not the billed empty-text integration. No proposal is stored without citations, correctly, but that says nothing about spending. Actual provider frequency/cost is not measured; the conditional billed-answer path is explicit and current.

### BE-18 - invalid configured prices undermine the spending model

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High for negative inputs; the report overstates non-finite reachability.

**Documented context.** Q219/Q222/Q225 (`docs/reqs.md:3245,3248,3251`) require a priced, estimable paid path; no default price is invented.

**Trace and proof.** `LlmPricing.configured` (`llm/pricing.py:65-90`) checks absence and positive FX, not nonnegative component prices. `main.py:85-109,436-451` puts no lower bound on those prices and uses only truthiness for assumed input tokens. Negative finite prices/tokens therefore configure successfully. A negative token price can make a billed answer's computed cost negative; LLM `_record` decreases the in-memory meter and `is_exhausted` cannot bound real provider charges. A negative assumed token count independently understates the plan. The database's nonnegative run-cost CHECK fires only when the source total is finally persisted, after candidate calls have already happened.

**Counterevidence and tests.** The report's **Environment non-finite** claim is not established: installed `pydantic_core/core_schema.py:757-759` documents Decimal's default non-finite refusal; schema generation uses that default and Environment does not override it (`pydantic/_internal/_generate_schema.py:1081`, `_config.py:163-207`). Direct `LlmPricing.configured` lacks its own such check, but that is not proof NaN/Infinity traverse normal configuration. `test_client_and_pricing.py:81-122` covers missing values/FX, not negative components. The finite-negative counterexample is enough for the real core; zero promotional prices require policy, not blanket rejection.

### BE-19 - completed paid candidate answers still wait in memory before commit

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/arch.md:818-829` promises per-work-item transactions and no completed item accumulating in memory; `docs/reqs.md:1916-1926` promises retention across halt/failure.

**Trace and proof.** `llm/employers.py:126-176` and `fallback.py:145-206` collect values/failures across candidates and return only after the complete attribute sweep. The caller `run.py:90,111-138` cannot append any returned value until that await finishes. Kill during candidate 2 after candidate 1's paid answer was parsed → candidate 1 exists only in the adapter's list, not in ValueStore. Per-value transactions (`storage/value_store.py:184-198`) protect data **after** append, not these unreturned outcomes. Hard death also loses failures buffered in the adapter or caller list.

**Tests, counterevidence and limits.** Gate D's dying source (`acceptance/test_gate_d.py:47-72,78-94`) returns a first **attribute**, then raises on a second; it proves the earlier per-source append defect was fixed, not per-candidate durability. New per-candidate metering correctly bounds calls and a graceful cap lets the adapter return its completed answers; neither covers process death. This is current employers acquisition at country level, not city-scale speculation. Only the in-flight provider call is unavoidably uncertain; already completed prior candidates need not be.

### BE-20 - source-protocol exceptions abort without contextual failure records

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:1922-1926` requires continuing past routine source failures with retryable candidate/attribute errors; `docs/arch.md` §5.3 distinguishes protocol failures from missing observations.

**Trace and proof.** `open_meteo/response.py:23-26` converts each non-null reading with `Decimal(str(r))`. A syntactically valid JSON series containing `"unavailable"` raises `decimal.InvalidOperation`, not `OpenMeteoError` or `SourceUnavailableError`. `open_meteo/adapter.py:114-120` catches only those two recognized classes, so the exception escapes the current candidate. `execution.py:327-345` preserves earlier collected failures and marks the whole run failed, but invents no source/item failure for the escaping exception and aborts later sources. The failed weather item is absent from the failed-item retry list, though it can remain unanswered.

**Tests, counterevidence and limits.** `open_meteo/test_adapter.py:204-245` checks null cells, missing places, HTTP refusal and absent-series shape; none includes an invalid decimal cell inside a present series. The shared HTTP decoder catches JSON parsing errors, but this error occurs afterward in the source decoder. Prior persisted values/failures are protected on a caught process exception, so this is not wholesale rollback or the old P66 bug. No live publisher malformed response was observed; this is a supported adverse-input handling gap.

### BE-21 - invalid requests can produce 500s or the wrong error body

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/arch.md:898-914,960-966` assigns malformed inputs to API refusals and specifies one stable `code/message/details` error shape.

**Trace and proof.** `api/settings.py:24-35` accepts integer zero for the score maximum, then constructs `Settings` (`:63-72`), whose `gt=0` field (`household/settings.py:53-55`) raises an internal Pydantic validation error. `api/errors.py:67-128` has no general mapping for that error and rethrows unmapped exceptions. The same split exists for negative income (`api/household.py:29-39,56-66`) and inverted ReferencePeriod construction before manual validation (`api/values.py:132-135`). Threshold objects are constructed in `api/criteria.py:209-217` **before** the criterion-specific revalidation catch, so inverted thresholds can escape it. Separately `api/app.py:100-103` does not replace FastAPI's RequestValidationError handler: ordinary DTO failures retain `detail`.

**Tests, counterevidence and limits.** `acceptance/test_error_contract.py:97-123` asserts status only for missing queries/invalid weights; `test_household_api.py:80-94` exercises DTO-constrained counts rather than domain-only money bounds. Many specific domain errors and HTTPException dictionaries are correctly translated; the claim is not that every invalid request fails incorrectly. The internal conversions above establish reachable unmapped errors, while generated validation schemas in `docs/openapi.implemented.yaml` corroborate the separate framework response shape. No error response was executed here.

### BE-22 - empty-name edits can persist an unreadable criteria set

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** A CriteriaSet is a named, reusable opinion (`docs/reqs.md` §3.4); a successful edit must remain readable. `CriteriaSet.name` explicitly requires at least one character (`criteria/criteria_set.py:98-102`).

**Trace and proof.** `DuplicateRequest`/`RenameBody` impose no length constraint (`api/criteria.py:386-393,423-431`). Duplicate uses `duplicated_as`, whose `model_copy(update=…)` skips validation (`criteria_set.py:248-265`); rename uses the same unvalidated copy (`api/criteria.py:486-488`). Storage writes `name` directly in its own committed transaction (`storage/criteria_store.py:78-112`), and `0009-criteria.sql:13-16` only checks NOT NULL. Empty string therefore persists. `_criteria_set_from:286-296` subsequently rebuilds a validated domain object and rejects it.

**Consequences, tests and limits.** Duplicate can return 201 with the invalid name; rename commits first and can fail during its own reread, so a successful HTTP rename is **not** required for persistent damage. GET/ranking/another rename reads the invalid model. Raw-store deletion remains possible if no evaluation references the set; an already referenced renamed set can be held by its FK. `test_configuration_api.py:56-63` and `test_duplicate_api.py:25-72` use valid names. The UI's nonblank form guard reduces its own exposure but cannot protect the public HTTP write paths.

### BE-23 - unknown fields and illegal nulls are inconsistently ignored or coerced

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/arch.md:898-900` explicitly lists unknown query parameters as malformed input. The target CriterionInput distinguishes omitted, nullable and non-null fields; whole replacement settings must not silently reinterpret a misspelling.

**Trace and proof.** `SettingsBody`, `HouseholdBody`, `RunScopeBody`, research/result inputs and `PillarWeightInput` lack `extra="forbid"` (`api/settings.py:24-35`; `household.py:29-39`; `runs.py:45-62`; `criteria.py:434-449`; `rules.py:61-92`). A misspelled optional pillar lock therefore yields no requested mutation, while a misspelled field in a settings replacement disappears and the real field defaults null. Ordinary declared FastAPI query arguments ignore unrelated keys. Although `CriterionInput` forbids extras, `the_scoring_rule:175-180` converts `scale_anchors:null` into an empty tuple; `_the_threshold_in:209-213` converts `required_value:null` to False.

**Tests and qualifications.** `test_endpoints.py:598ff` meaningfully refuses CriterionInput extras only. `test_error_contract.py:125-142` even permits 200 for a misspelled weight and checks no change. Some nulls are **deliberately** legal—clearing thresholds/ranges/settings—and are not defects. The finding concerns fields whose contract does not allow that null or unknown spelling. Boolean-threshold input is generic/latent in the current country catalog; ignored settings/lock fields are immediately reachable v1 requests.

### BE-24 - mixed unknown scope IDs silently disappear

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Acquisition is explicitly scoped (`docs/reqs.md:1911-1920`); errors must identify malformed requests (`docs/arch.md` §7.3), especially before spending.

**Trace and proof.** `_candidates_in`/`_attributes_in` (`api/runs.py:451-469`) intersect requested strings with the selected-level roster/catalog, without comparing requested IDs to those retained. Research planning/execution repeats that pattern (`api/rules.py:247-255,298-306`). Request `[country.portugal,country.portugla]` for a valid attribute → Portugal is estimated/executed while the typo is neither retained in scope nor refused. The valid remainder prevents the empty-scope guard from exposing the error; a funded paid request can proceed on that remainder.

**Counterevidence and tests.** A single unknown entity in manual gate PUT is explicitly checked (`api/rules.py:344-358`; `test_values_and_rules_api.py:258-280`); those guards are not used by bulk research filters. `test_runs_api.py:51-62` tests valid narrowing only. All-unknown acquisition usually gets a generic nothing-to-fetch refusal, which is not protection for the mixed case; an empty research list can simply return no work. Out-of-level IDs behave the same way. No claim of fetching a wrong unknown candidate is made: the problem is silently omitting requested work.

### BE-25 - plans omit freshness suppression applied at execution

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/arch.md:814-817` requires planning the same work without execution. `docs/todos.md:110-120` confirms refetch-age capability exists and distinguishes it from evidence freshness, even though its UI-control deferral prose is stale.

**Trace and proof.** `api/runs.py:162-203` plans from selected candidates, attributes and adapters; it receives neither settings nor RunStore and never consults retrieval dates. Start reads `refetch_older_than_days` and passes it to `open_run` (`:263-281`). `execution.py:142-174` removes attributes fresh for every scoped candidate and can refuse an all-fresh request. With one recently fetched explicit attribute and age threshold one day, plan reports its item/call count and possible paid cost; start does no such work and returns nothing-to-fetch.

**Tests, qualifications and limits.** `data_acquisition/test_freshness.py:63-130` validates conservative whole-attribute filtering, including exact-age boundaries; `acceptance/test_runs_api.py:51-77` checks planning independently. A conservative money ceiling may intentionally overestimate usage, but promising items that are already known to be suppressed, including a wholly unstartable plan, is a separate mismatch. Null age currently skips nothing, so installations leaving it unset do not trigger this. A new retrieval occurring **after** planning is an unavoidable race; the counterexample needs no intervening write.

### BE-26 - truncated weather data is labeled a complete period

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High, conditional publisher-response scope.

**Documented context.** Q210/Q213 (`docs/reqs.md:3236,3239`) choose annual/seasonal population-weighted temperatures; the two-date rule (§3.6) requires the stored span to describe what was actually measured.

**Trace and proof.** `open_meteo/response.py:11-27` checks number of locations and presence of a sequence, but ignores `daily.time`, requested dates and sequence length. `adapter.py:155-170` calls a place complete whenever readings are nonempty and none is null. It averages those values and labels the output with the entire requested `window` (`:189-194`). One valid in-range daily number per requested place therefore becomes an apparent annual/seasonal mean. Different dates or unequal lengths likewise need not be detected.

**Tests, counterevidence and limits.** `open_meteo/test_adapter.py:113-146` independently checks a full captured fixture's arithmetic/date label; `:205-224` checks inserted None cells. Those tests do not truncate a series or shift its date axis. Attribute range validation cannot reject a plausible temperature derived from incomplete days. This is not evidence Open-Meteo currently truncates successful responses; a captured/live malformed-response check would establish incidence, not the missing validation. Legitimately incomplete places with explicit None are correctly omitted.

### BE-27 - malformed WDPA CSV rows silently lose provenance

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md` §§3.6,6.10 require retraceable evidence; the transcribed-table decision in Q230 demands faithful publisher/method context, not merely parseable magnitudes.

**Trace and proof.** `published_tables/tables/protected_planet_protected_land.csv:12-15` contains unquoted commas inside workings. `csv.DictReader` assigns overflow columns under its extra-key entry; `_rows_of` (`published_tables/table.py:117-146`) reads only the named fields and never checks overflow/missing widths. For Norway, the kept workings stops at “mainland” before the comma; “excludes Svalbard/Jan Mayen)” and the read-date suffix are discarded. `adapter.py:108-118` uses that truncated workings as the stored quote. Figures/periods/page URLs remain correctly positioned.

**Tests and limits.** `published_tables/test_table.py:119-125` checks the **header** order, not each row width. `:133-149` calls the same permissive loader, so “reads cleanly” cannot catch this loss. `test_adapter.py:111-123` proves complete workings reach quotes when given an already constructed Row, not when parsed from malformed CSV. This is a currently shipped file defect; no external verification of WDPA accuracy is needed or attempted. The lost text affects methodology provenance, not the numeric 17.8 itself.

### BE-28 - AssignedScore fallback always constructs an invalid payload

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High, explicitly latent.

**Documented context.** `docs/reqs.md:1026,1063` requires range and assigner on an AssignedScore. The fallback is permitted only where a measurable, citable gap exists (§6.10); manual administrative judgments are deliberately excluded.

**Trace and proof.** `llm/fallback.py:322-325` constructs `AssignedScore(value=figure,assigner=Assigner.LLM)`. The actual class (`data/payloads.py:337-364`) requires `range_min`, `range_max`, `assigned_by`, and forbids unknown fields through its base. A paid, otherwise usable reply reaching this advertised ANSWERABLE type therefore raises validation, which `_the_figure_given` converts into a failure rather than a stored score. Changing only the misspelled keyword would still leave missing bounds.

**Tests, counterevidence and limits.** `test_the_three_uses.py:162-324` covers Quantity/Ratio/Count and rejected nonnumeric types, but no valid AssignedScore fallback. `main.py:379-387` excludes current manual-entry AssignedScores, so the shipped administrative gaps do **not** presently get billed through this code. That is an effective production guard and prevents treating this as an active v1 billing incident. The report accurately scopes a latent declared capability: before enabling an eligible non-manual attribute, a range policy and valid constructor are needed; no invented city data is authorized.

### BE-29 - JSON float decoding loses precision before Decimal conversion

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High, latent precision consequence.

**Documented context.** `docs/arch.md` §9.6 and `docs/reqs.md` §§3.6,5.1 preserve numeric evidence/precision rather than round during decoding.

**Trace and proof.** `data_sources/transport.py:82-87` calls `response.json()` with no `parse_float`. Installed `backend/.venv/lib/python3.12/site-packages/httpx/_models.py:831-832` delegates to `json.loads`. `eurostat/jsonstat.py:136-143` later applies `Decimal(str(figure))`. A token `0.1234567890123456789` is therefore first rounded to a binary float; the subsequent shortest decimal string cannot recover its original significant digits. An allowed-range or anchor boundary between the two representations can change the result.

**Counterevidence and tests.** This is not the more common `Decimal(float)` binary-tail bug: using `str` correctly preserves ordinary short publisher decimals. `storage/connections.py:24-30,48-52` already uses `parse_float=Decimal` for **database** JSON, but that is a separate read path. `data_sources/test_transport.py:26-30` checks integer JSON; publisher fixtures mostly have modest precision. No current ranking change is established and none is needed for the accurately labeled latent data-loss claim. The test required to demonstrate practical impact would preserve an original long numeric token, not construct an already rounded Python float.

### BE-30 - malformed employer elements become company-name strings

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** LLM use 2 is a LabelSet of **named firms**, with the names serving as evidence (`docs/reqs.md:2129-2132`, Q221).

**Trace and proof.** `_the_employers_named` checks grounding and JSON object/list structure (`llm/employers.py:193-223`), then applies `str(name).strip()` to each element (`:225-235`). With a cited reply `{"employers":[null,123,{"name":"Acme"}]}`, it creates nonblank labels `"None"`, `"123"` and a Python mapping representation. `LabelSet` (`data/payloads.py:255-277`) rejects blanks/duplicates, not these coerced strings; no employer vocabulary guards them. They persist as plausible sourced labels rather than an output-shape failure.

**Tests, counterevidence and limits.** `test_the_three_uses.py:68-84` checks valid named firms and pages; `:99-110` meaningfully rejects `"employers":"Google"` to avoid character iteration. That container guard does not validate elements. The list cap and deduplication likewise cannot establish that elements are strings naming firms. Employers are excluded from numeric scoring by the catalog, so this is evidence corruption/disclosure, not a demonstrated numeric rank reversal. Actual malformed provider output was not generated or observed.

### BE-31 - comparison imports a dependency forbidden by the exhaustive graph

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/arch.md:542-551` allows comparison imports only from candidates/data/evaluation; `:651-654` says that table is exhaustive.

**Trace and proof.** `backend/src/starnest/comparison/comparison.py:27` directly imports `TOTAL` from criteria. `backend/pyproject.toml:185-198` places comparison above evaluation and criteria in a broad layers contract, so the edge is downward and allowed by that machinery. No separate forbidden-edge rule disallows comparison→criteria. Thus the direct source edge contradicts the stated import table even though it need not create a cycle or produce incorrect arithmetic.

**Tests and limits.** `tests/unit/test_architecture.py:150-168` compares the **set of module names** with layer membership; `:99-120` checks cycles. Neither compares actual permitted edges to the exhaustive table. The constant's value is not itself wrong or hardcoded in comparison; moving/re-exporting it through an approved abstraction or revising the graph deliberately is the architectural choice. This is a low-severity boundary-enforcement gap, not a runtime country workflow failure, and no linter result is claimed.

### BE-32 - bare pytest includes live publishers by default

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `backend/pyproject.toml:55-63` itself describes bare pytest as fast and `live` as never part of the normal suite; `docs/arch.md` §6.7 separates captured source tests from live calls.

**Trace and proof.** Default `addopts` is `-m 'not live_llm'` (`pyproject.toml:58`), not exclusion of ordinary `live`. `tests/live/test_world_bank_collections.py:21,81-111` has only the live marker and opens a real HTTP client. Bare pytest with its default testpaths therefore selects that network test. `tests/conftest.py:108-133` guards paid markers only and cannot prevent it.

**Counterevidence and tests.** `Makefile:84-105` explicitly excludes ordinary live tests from `make test`/coverage, so this is **not** a claim that `make check` phones publishers. The paid path is separately excluded by default and guarded for explicit selection; ordinary live calls are free, not monetary leakage. The concrete live test contains no mandatory external fixture that would skip it before its HTTP call. Static collection configuration suffices to establish the default-selection problem; no collection or test command was run.

### BE-33 - current-source spend is not durable per billed call

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; accepted known durability limitation.

**Documented context.** `docs/known-issues.md:353` records P36 and deliberately coordinates its fix with the ledger decision. `docs/arch.md:818-837` states the stronger eventual per-item durability goal.

**Trace and proof.** Paid adapters immediately update only an in-memory RunningSpend (`llm/employers.py:94-106,154-166`; `fallback.py:110-122,178-191`). `acquire` accumulates its returned totals. `continue_run` calls `runs.add_spend` only after the complete **source** returns (`execution.py:258-285`); RunStore writes that increment in a transaction (`storage/run_store.py:122-130`). Die after a billed candidate but before this source returns → the source's increment was never persisted. Earlier completed-source increments survive.

**Tests and qualifications.** Gate D (`acceptance/test_gate_d.py:214ff`) checks returned-source totals and a simulated death between attributes, not hard death after a real billed call. The report correctly refines old P36 prose that says “at run end”: durability is now per source, not solely final-run. Current metering can enforce caps while the process lives, so this is not itself an unbounded-spending claim. REAL records a known accepted limitation, not a newly unapproved country feature omission; no existing bill was inspected.

### BE-34 - gate-research spending has no durable record

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; explicitly deferred by decision.

**Documented context.** Q224 (`docs/reqs.md:3250`) and P28 (`docs/known-issues.md:346`) deliberately defer a research ledger; a value-producing run is a different entity (§3.8).

**Trace and proof.** `research_gates` creates request-local CostMeter and proposal/refusal lists (`data_acquisition/research.py:127-178`). It records each sourced proposal through ProposalStore but has no run/ledger store or aggregate spending write. `api/rules.py:310-325` returns the final totals. Therefore losing the response or process can leave proposals without a durable research-cost aggregate. Acquisition run totals cannot recover spending belonging to no acquisition run.

**Tests, qualifications and limits.** `test_research.py:185-224` asserts returned totals and cap stopping with stub answers; `acceptance/test_llm_path_api.py:282-304` checks proposals and response cost. They do not assert durable accounting, which is intentionally absent. Normal successful research still reports/logs costs and has a per-request cap; BE-17 separately finds a bad-response metering defect. Under the requested verdict definitions an accurately labeled accepted limitation is REAL, not a newly broken v1 promise. No ledger implementation is recommended as an unapproved scope expansion here.

### BE-36 - finite-period confirmed gates never expire or become researchable again

**Original severity:** Medium  
**Verdict:** UNCERTAIN  
**Confidence:** High about code behavior; Medium about the claimed eligibility defect.

**Documented context.** `docs/reqs.md:1493-1503` says the period is when a judgement holds and specifically calls for the interface to **mark expired findings and prompt a re-check**. It does not explicitly decide automatic invalidation versus a continuing human override. Q218 preserves human confirmation; `docs/todos.md:89-94` additionally notes country gates are stored per candidate, not dynamically derived from household inputs.

**Established trace.** `evaluation/rules.py:168-179` consults confirmed negative results without period/clock/context tests. `research.py:198-208` skips **all** non-proposals, including expired or unknown confirmations. The result store faithfully reads periods (`storage/match_rule_result_store.py:40-61`); the field is not lost before evaluation. An expired confirmed negative can thus still rule out a scoreable country, and research will skip it.

**Why uncertain rather than merely confirmed.** `test_research.py:150-170` deliberately asserts confirmed answers are not re-asked; manual PUT can explicitly replace/override an answer (`api/rules.py:333-376`). No authoritative policy specifies when a manual decision expires automatically, how unknown confirmations should be treated, or which citizenship changes invalidate which gates. The missing re-research path is a real limitation, but the compound finding's assertion of wrongful continuing eligibility cannot be settled from these partly competing intentions. An explicit validity/override decision, followed by expired/context-changed tests, would settle it. No live gate period was inspected.

### BE-37 - fallback eligibility is attribute-global rather than candidate-specific

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High for the limitation; Medium for present useful applicability.

**Documented context.** `docs/reqs.md:2127-2140` permits fallback when no dataset covers **this candidate**; `docs/arch.md:809-813` additionally describes fallback after all structured sources failed.

**Trace and proof.** `_the_fallback` (`main.py:379-387`) forms the union of every adapter's declared attributes and excludes that union for **all** candidates at startup. It reads no candidate coverage, fetch outcome or source-failure state. An attribute declared by one structured adapter can therefore never be assigned to LLM fallback, even for a distinct candidate that adapter cannot answer or after every declared source fails. Ordinary execution consults that fixed registry and contains no later candidate-level fallback scheduler.

**Tests, counterevidence and limits.** `test_composition_root.py:352-386` expressly tests declaration-set subtraction and manual-judgment exclusion. Those tests protect against inappropriate paid replacement of structured sources, but do not satisfy per-candidate fallback. `docs/catalog-blockers.md:14-30` makes the current English/native-country and administrative gaps deliberate, so they are **not** valid examples to fill; manual-entry exclusions are intentional. The source report labels this latent and present need unverified, which is accurate. A real citable candidate-specific gap would be needed to prioritize it, not to establish the algorithm's present limitation.

### BE-38 - the backend coverage gate blends two required floors

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/devplan.md:818-837` requires 85% **lines and separately branches**, globally and per package; the backend manifest repeats that wording.

**Trace and proof.** `tools/audit_coverage.py:76-87` sums covered lines+branches and total statements+branches; `Audit.check:49-61` applies a single 85% comparison. With 100 line opportunities all covered and 100 branch opportunities of which 80 covered, it computes 180/200=90% and accepts while branch coverage is 80%. `pyproject.toml:88-93` supplies only Coverage.py's combined `fail_under`. Installed `coverage/results.py:340-342,377-381` confirms `pc_covered` uses that same combined numerator/denominator, not the minimum of separate percentages.

**Tests and limits.** Architecture tests check modules/cycles, and the audit has no independent per-metric check that would reject this counterexample. No actual coverage file or command was used to claim present undercoverage; the defect is that the advertised gate would accept a violating future report. UI's separately configured Vitest thresholds do not repair the backend gate. The original Medium severity is retained because this undermines a validation guarantee, not because any quantified current regression was found.

### BE-39 - effective source priority returns overrides, not the resolved order

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/openapi.yaml:1128-1135` expressly requires overrides followed by **every other global source**, resolved by the server; `docs/reqs.md:1983-1989` defines that partial-override rule.

**Trace and proof.** Both list and single-attribute endpoints call the **same** `_attribute_body` (`api/catalog.py:189,197-228,338-340`). It emits only `attribute.source_priority_overrides`. No overrides → `[]`; one promoted source → only that source, omitting all global fallbacks. `Attribute.effective_source_priority` (`data/attribute.py:278-284`) and `SourcePriority.ordered` (`data/sources.py:106-173`) already implement the required resolution but are not called by this presenter. ContractBody only omits absent fields; it does not merge sources.

**Tests, corrections and limits.** `acceptance/test_catalog_api.py:34-122` checks type/unit/age/pillar, not resolved priority; source-order tests check source listings and storage overrides separately. The report's `api/bodies.py:37-43` citation and “both presenters” characterization are inaccurate: there is one shared attribute presenter, reached by two endpoints. That citation error does not falsify the output defect. Active-value SQL independently implements the proper ordering, so scores need not be wrong; the response and UI explanation are incomplete. UI-32's capability inference remains separately invalid even after this is corrected.

### ST-01 - concurrent starts can create multiple running acquisitions

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `api/runs.py:250-257` and P35's later decision in `docs/known-issues.md` enforce one running pass. The older `docs/arch.md:971-972` acceptance of double-clicked runs is superseded by that explicit safety change and its acceptance tests.

**Trace and proof.** `PostgresRunStore.run_in_flight` reads in one transaction (`storage/run_store.py:190-193`), while `start_run` opens another (`:41-67`). `queries/runs.sql:274-288` is an ordinary unlocked SELECT; `:19-25` is an unconditional INSERT. Interleaving: A reads none; B reads none; A inserts run A; B inserts run B. Scope keys contain each distinct run ID, so they do not conflict. The full forward migration constraint/index search found no running-status partial unique constraint or serialization trigger; `0483` adds stop/status checks only. Both requests can then execute and spend independently.

**Tests, counterevidence and limits.** `acceptance/test_runs_api.py:879-939` rejects a second start only after a running row exists. `storage/test_run_store.py:159-178` actually creates a second running row while another fixture run is open, consistent with the missing DB restriction. PostgreSQL transactions prevent partial run headers/scopes, but do not serialize this check-and-create. This is ordinary concurrent HTTP reachability even with one process/event loop; actual overlap/billing incidence was not observed. BE-12 is a separate retry path that omits even the non-atomic check.

### ST-02 - whole-set replacement loses concurrent decisions

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md` §3.4 makes every set its user's complete opinion; a one-field edit should preserve unrelated choices. Sparse rule membership is confirmed by the recent `docs/todos.md:169-181` upsert incident, not a dense false-row model.

**Trace and proof.** API mutations first read a set, calculate a changed object, then call `replace_criteria_set` (`api/criteria.py:269-275`, and enforcement/application routes). Replacement's new transaction checks only existence and clears/reinserts all contents (`storage/criteria_store.py:90-112`; `queries/criteria.sql:249-289`). A and B both read S; A enables a gate and commits S+A; B then writes S with a changed weight. Its clear removes A's association, and `_write_contents:153-166` reinserts only the stale object's on-rules, so the gate silently turns off. Both edits can return success.

**Counterevidence and tests.** Updating the set's name obtains a row lock **inside** replacement, so writes are not interleaved arbitrarily. It still does not invalidate the already-read stale object: the example can use sequential replacements after concurrent reads. `test_criteria_store.py:251-267` checks one sequential whole replacement, not preservation against a stale snapshot. Structural atomicity therefore does not prevent the logical lost update. The exact live membership may differ from seeded defaults; no current membership was assumed.

### ST-03 - career retirement invalidates user-created and edited profiles

**Original severity:** High  
**Verdict:** REAL  
**Confidence:** High, populated-upgrade scope.

**Documented context.** `docs/reqs.md:1183-1196` guarantees full independent copies and explicitly obliges catalog migrations to account for existing sets. Retiring the unmeasurable posting attributes is an approved decision; corrupting unrelated profile arithmetic is not.

**Trace and proof.** `0477-career-weights-sum-exactly.sql:23-27` establishes valid career weights 24.45,24.44,20,16.67,14.44. Copy that set before `0487` without adding children to the retiring criteria. `0487-career-is-measured-by-the-workforce-that-exists.sql:35-43` sets replacement weights only for `local_employment`/`remote_only`, then deletes the posting criteria from **every** set. The copy retains 20+16.67+14.44=51.11. `CriteriaSet._reject_weights_that_do_not_sum` (`criteria_set.py:165-185`) rejects that stored copy on the next read. No later forward migration repairs career weights. Customized named defaults can also end incorrectly because their replacement is overwritten with a seed literal rather than their actual retiring mass.

**Tests and qualifications.** `test_catalog_arithmetic.py:79-135` checks final seeded sums; the fixture applies migrations before tests create duplicates. It does not arrange a pre-upgrade customized database. `0488` later uses per-set transferred weights for housing, demonstrating the missing pattern without repairing career. If an old posting criterion has a restrictive threshold/anchor, deletion can instead block safely; the demonstrated no-child copy commits the damaged sum. No claim is made about which live profiles existed at upgrade.

### ST-04 - default normalisation migrations overwrite choices or block upgrade

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High, populated-upgrade scope.

**Documented context.** Scale/goal/anchors are subjective set-owned data (`docs/reqs.md:1131-1160`); `docs/arch.md:122-126` keeps those choices separate from objective catalog corrections.

**Trace and proof.** `0489-coastline-is-measured-at-one-stated-scale.sql:59-60`, `0490-elevation-comes-from-the-agencies-that-survey-it.sql:54-55`, and `0491-forest-cover-can-finally-be-scored.sql:22-23` change every criterion for the named attribute to percentile. `0495-projected-heat-is-scored-by-standing.sql:16-30` changes every fixed one and insists all are percentile. None filters to an unconfigured default. A user's legal fixed target-range Quantity/Ratio criterion passes `0468-a-band-needs-the-method-that-can-draw-it.sql:21-25` before upgrade; changing its method alone violates that same CHECK and aborts migration. A normal monotonic fixed criterion with user anchors instead silently switches interpretation while retaining now-unused anchors.

**Tests, counterevidence and limits.** Catalog arithmetic guards correctly ensure seeded answerable attributes can score; they operate on fresh defaults, not edited predecessor states. The later sunshine/air anchoring migration targets different attributes and does not undo these changes. Atomic migration rollback prevents partial corruption in the target-range case, which is a blocked upgrade rather than data loss. Recent approval of percentile **defaults** does not establish permission to overwrite every independent user's configured scale. No populated migration was executed.

### ST-05 - type-correction upgrades cannot delete criteria with child interpretations

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High, safe-but-blocked upgrade scope.

**Documented context.** Criteria thresholds/anchors are valid user choices (§3.4); `docs/arch.md:99-116` normally requires new identity for retyping, and `docs/devplan.md:222-238` requires an explicit decision before incompatible catalog changes.

**Trace and proof.** `0478-school-quality-is-a-quantity.sql:38-68` and `0492-child-benefit-is-a-share-of-the-wage.sql:26-55` capture parent criterion fields, DELETE the parents, retype the attribute and recreate parents. `0009-criteria.sql:117-197` gives anchors and typed thresholds restrictive FKs to those parents. Final `0482` cascades **evaluation** children, not live criterion children. With a valid pre-0492 child-benefit maximum or two fixed anchors—even with no stored measurements—the parent DELETE fails before conversion.

**Counterevidence, tests and limits.** `0492`'s claim “no stored values” eliminates one value-type FK barrier, not this preference-child barrier. Type-correction rollbacks now explicitly refuse once incompatible figures exist; those safe guards do not handle forward children. `test_criteria_store.py:493-540` proves anchors/thresholds can be stored; `test_migration_hygiene.py:49-143` checks dependency/rollback structure, not a populated predecessor upgrade. The observed logical outcome is refusal and transaction rollback, **not erased preferences**. An intentional, clear preflight/refusal or retire/recreate migration could be acceptable; the current raw-FK obstacle is real.

### ST-06 - housing replacement resets inclusion and lock choices

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High, populated-upgrade scope.

**Documented context.** Inclusion and weight locks belong to the CriteriaSet (`docs/reqs.md:1140-1147,1161-1165,1205-1214`). The housing measurement replacement is explicitly approved in `docs/catalog-blockers.md:11`.

**Trace and proof.** `0488-housing-is-priced-by-what-it-costs-to-live-in.sql:59-71` transfers each retiring row's actual weight, but inserts `is_scored=true`, `weight_locked=false`, `blocks_if_missing=false` for every replacement. Consider a valid custom set whose old purchase criterion is excluded/locked and has no restrictive child rows: migration succeeds and the new monthly-housing measure takes that weight as included/unlocked. Scoring mass and future rebalancing behavior change without preserving those independent decisions.

**Tests, qualifications and limits.** `test_catalog_arithmetic.py:122-161` checks sums/retirement, which this migration correctly preserves; it does not compare pre/post user flags. The rollback (`0488…rollback.sql:17-21`) copies current flags, so it cannot reconstruct flags already discarded by the forward change. A new measurement reasonably needs new goal/method and might deliberately stop blocking; those are different choices from inclusion/lock and should not be conflated. No documented approval was found for resetting all user profiles. The finding is conditional on pre-upgrade customization, not a broken fresh seed.

### ST-07 - saved interpretation and rule evidence are incompletely frozen

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High, with separate current and latent subclaims.

**Documented context.** `docs/reqs.md:1235-1247` and Q193 require frozen interpretation/evidence; `docs/openapi.yaml:1414-1439,1451-1461` includes criterion fields and frozen weight locks.

**Trace and proof.** `_frozen` (`storage/evaluation_store.py:246-263`) omits criterion locks and typed thresholds; `read_criteria:197-214` recreates pillar weights with default unlocked flags. `_criterion_from:359-382` also omits threshold, lock, reducer and breakdown option, although SQL stores/selects the last two (`queries/evaluation.sql:32-58,236-264`). Rule results freeze detail text only (`evaluation_store.py:142-168`; `0010-evaluation.sql:143-164`). Exclude projected heat from scoring but keep the applied heat warning: `ranking.py:306-326` still reads its magnitude for the warning, while no scored contribution pins its Value ID. Later competing evidence or priority changes leave no frozen reference identifying the exact source/date/pages behind that old warning.

**Tests and counterevidence.** `test_evaluation_store.py:99-151` checks selected weights/anchors/band fields; its supposed edit test merely creates a different duplicate and asserts count. However `acceptance/test_evaluations_api.py:99-114` **does** edit the same set it saved, and `:125-149` compares whole live/saved detail bodies. Those are meaningful counterevidence to any claim all snapshot tests are superficial, but they do not populate thresholds/locks/reducers or independent unscored rule evidence. Recent `0486` and result-query fixes preserve confidence, reasons and rollups; they do not freeze missing interpretation fields. Reducer impact is latent generic machinery, not demanded city functionality.

### ST-08 - historical snapshots read live types after same-ID retyping

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High, populated-upgrade/snapshot-only scope.

**Documented context.** `docs/arch.md:99-116` makes attribute ID/type immutable together precisely so historical evidence remains interpretable; `docs/reqs.md` §3.4a freezes saved interpretation.

**Trace and proof.** `queries/evaluation.sql:236-264` joins `attribute.value_type` **today**, justified by an immutability comment. `0478-school-quality-is-a-quantity.sql:46-49` and `0492-child-benefit-is-a-share-of-the-wage.sql:34-37` change that type under the same ID. Save a pre-0492 evaluation containing an unanswered Monetary child-benefit criterion, with no live threshold/anchor children blocking migration and no Value rows for it. The type FK on Value has nothing to protect; the frozen criterion references only attribute ID. After upgrade `evaluation_store.py:359-367` reconstructs it as Quantity alongside its old method/interpretation.

**Counterevidence, tests and limits.** Existing old-type **values**, including rejected ones, do block such retyping through their composite FK; no corruption of those rows is claimed. The explicit rollback guards also protect acquired incompatible figures, not a snapshot containing only an unanswered criterion. `test_evaluation_store.py:99-127` uses one schema version. The HTTP criterion presenter does not directly include `value_type`, so “reported as Quantity” is most precisely a domain-read/live-catalog interpretation issue, not a new JSON field. Saved totals are not recomputed. This is an upgrade identity violation, not a present fresh-database scoring error.

### ST-09 - successful transcribed rereads are reported unanswered

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** Q217 (`docs/reqs.md:3243`) defines unanswered as no source having a row for the item, not “no newly inserted observation.” Retaining one immutable observation on a repeated static read is a legitimate separate idempotency decision.

**Trace and proof.** `published_tables/adapter.py:73-77,93-104` returns the same value at transcription-day midnight on every reread. `run.py:111-122` stamps the new run ID, but `queries/values.sql:245-253` conflicts on a natural key that excludes run ID and does nothing. `value_store.py:184-190` returns no newly added value and creates no reuse relationship. The new run's scope still includes the pair, while its value/failure predicates (`queries/runs.sql:172-203,217-239`) find neither. A successful known-table answer is therefore listed as unanswered and can be re-asked indefinitely.

**Tests, counterevidence and limits.** `test_value_store.py:195-206` correctly asserts zero second inserts; `test_run_store.py:159-178` correctly says an **unconsulted earlier run's** value must not fill a later run's gap. Neither tests a later source **successfully returning** the reused observation. `published_tables/test_adapter.py:92-102` confirms the fixed retrieval date is intentional. Zero new rows and per-source `items_stored=0` are truthful; saying nobody answered is not. No duplication or fabricated new retrieval date is required to repair that semantic distinction.

### ST-10 - external-score reads do not select a current edition

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; known latent multi-edition limitation.

**Documented context.** `docs/reqs.md:1343-1347` requires deriving the most recent edition per candidate/publisher and labeling older editions as history. `docs/known-issues.md:497-498` records that this derivation is absent.

**Trace and proof.** `queries/values.sql:339-356` selects all external rows with no partition/rank/current predicate and orders only by candidate, publisher and reference start. `storage/value_store.py:220-231` maps them all; `api/values.py:245-272` serves all with no current/history distinction. Two editions appear as peer opinions. Two editions sharing the same start also tie under the query's order despite distinct end/retrieval dates.

**Tests, counterevidence and limits.** `test_value_store.py:593-613` round-trips one edition/filter. `test_rule_constraint_behaviour.py:195-231` correctly proves same-start annual/monthly editions coexist after `0113`, but does not choose/order current versus history. Keeping both is required, so deleting older editions would be wrong; the missing selection/label is the defect. Determining “current” between distinct temporal granularities may require a more precise policy, but a later retrieval of the same full-year edition is already an unambiguous example. No live multi-edition contents were assumed.

### ST-11 - one run poll combines different database snapshots

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/reqs.md:2802-2804` and Q217 require coherent progress and its listed items; `docs/arch.md` §8.4 polls that persisted resource.

**Trace and proof.** `storage/run_store.py:132-155` issues separate SELECTs for header/counts, failures, unanswered rows and source totals. `storage/connections.py:44-53` supplies one ordinary transaction but sets no repeatable-read isolation. Under PostgreSQL's default READ COMMITTED each statement gets its own snapshot. Interleaving: header SELECT sees one unanswered item; acquisition commits that item's value; unanswered SELECT sees none. The returned Run contains `items_unanswered=1` with `unanswered=()`, and possibly a newer by-source total.

**Counterevidence, tests and limits.** Counts within the **single header statement** are mutually coherent; transaction scope does not extend that snapshot to later statements under READ COMMITTED. `test_run_store.py:94-155` checks count/list agreement only after all arrangements have completed. A deployment explicitly setting repeatable read on every pooled connection could prevent this, but no repository configuration does so; external database defaults were not inspected. The ordinary acquisition path commits incrementally, so concurrent polling is the intended trigger, not unsupported multiwriter ingestion.

### ST-12 - run-linked evidence is not constrained to planned scope or level

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; latent storage-writer integrity gap.

**Documented context.** A run addresses one level and its planned candidate/attribute scope (`docs/reqs.md:1606-1622`); structural invariants are the database's responsibility (`docs/arch.md:898-907`).

**Trace and proof.** `0004-data-acquisition.sql:32-58` independently references valid run, candidate and attribute IDs. `0005-values.sql:7-18,33-36` pins attribute type but not candidate/attribute/run level or membership in the run's scope junctions. Later stand-in level pins and result-level pins apply to other tables. For a run planning only Portugal/tax, a valid Romania/housing observation linked to that run can insert. Header SQL counts the out-of-scope pair completed and the planned pair unanswered (`queries/runs.sql:172-203`): 1 completed+1 unanswered exceeds total 1.

**Tests, counterevidence and limits.** `test_run_store.py:94-118` asserts partition arithmetic using only in-scope values. `test_attribute_coverage.py:78-104` even inserts a city candidate with a country attribute to exercise a downstream SQL filter, demonstrating the schema accepts the cross-level relation. Normal API acquisition selects coherent rosters/attributes and Value validates its own level, so this is **not** an ordinary HTTP injection claim. A same-level out-of-scope Value can nevertheless pass domain validation through the supported store seam; direct SQL also bypasses the domain's level guard. Nullable manual run links should remain valid.

### ST-13 - saved contribution evidence can name the wrong measurement

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; latent structural gap.

**Documented context.** `docs/reqs.md:1235-1247` makes `used_value` the exact evidence behind each saved contribution; `docs/arch.md` §§3.3b,7.3 requires structural agreement rather than independently valid foreign keys.

**Trace and proof.** `0010-evaluation.sql:125-138` references candidate_result, attribute and Value ID independently. `0107` subsequently pins score scale, and `0482` changes result-delete cascades; neither links the evidence candidate/attribute or the frozen criterion. With a valid Portugal result and tax attribute, a Romania housing Value ID satisfies every FK while explaining the wrong observation. `queries/evaluation.sql:353-358` joins that Value by ID alone. If the score attribute was never frozen, the LEFT JOIN yields a null pillar; `_attribute_score_from` (`evaluation_store.py:348-356`) cannot reconstruct a valid PillarId.

**Tests, counterevidence and limits.** `test_evaluation_membership_behaviour.py:43-160` correctly enforces result level and **non-match reason** membership, not contribution evidence membership. `test_evaluation_store.py:129-137` reads a matching tax row and no adversarial used_value. The normal ranking builds used IDs from each candidate's readings, so the current HTTP save path is well behaved. The report accurately scopes an invariant exposed by direct SQL or a faulty/new writer, not proof of corrupted live saved scores.

### ST-14 - frozen criteria are not pinned to evaluation level

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; known latent generic-storage gap.

**Documented context.** Each evaluation runs at one level (`docs/reqs.md:1231-1255`); `docs/known-issues.md:494-496` explicitly records that evaluation_criterion lacks this pin. Cities being deferred does not remove the generic schema guarantee.

**Trace and proof.** `0010-evaluation.sql:34-54` freezes attribute/pillar without a level column or composite level key. `0108-results-belong-to-their-evaluation.sql:35-47` pins **candidate results**, not frozen criteria; `0482` preserves that distinction. `evaluation_store.save:88-95` loops every supplied criterion, not just the requested level. A valid country CriteriaSet can therefore be saved under a city evaluation header with no results (or independently valid city results); the DB accepts the foreign-level snapshot. `_frozen:246-263` can assign missing selected-level pillar weights zero, making later read reconstruction inconsistent.

**Tests and limits.** `test_evaluation_membership_behaviour.py:43-94` has good positive/negative result-level assertions but never inserts a wrong-level evaluation criterion. `api/rankings.py:160` already narrows the set for ordinary save, preventing the current country HTTP path from producing this state. The claimed defect is in the storage invariant/save seam, not a request to implement cities or nominate them. A multilevel set passed unrestricted is another latent trigger; no current user's set was read.

### ST-15 - accepted payload completeness and composition totals are not enforced

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; direct-SQL integrity scope.

**Documented context.** `docs/reqs.md:1053-1084,1418-1426` requires valid complete accepted payloads and shares totaling 100; explained rejected observations are the deliberate exception.

**Trace and proof.** The type chain (`0005-values.sql:33-36`; `0006-value-payloads.sql`) prevents a wrong **family** attaching but never requires a child to exist. Label/share children permit zero rows, and the share table (`0006:104-115`) bounds each share independently without a total check. No later forward migration adds a completeness or deferred sum trigger. Insert an accepted parent without children, or shares 40+40: the SQL state is permitted. On read, `value_store.py:401-430` turns absent/empty payload into None or validates the composition; `data/value.py:116-130` rejects an unexplained missing payload and ShareComposition rejects total 80.

**Tests, counterevidence and limits.** `test_value_store.py:161-190` passes complete validated payloads through the transactional writer. `test_active_value_behaviour.py:37-58` deliberately uses parent-only rows to test ordering; schema-contract tests verify type-family keys, not completeness. Normal application constructors prevent these bad writes, and ranking then **fails to reconstruct**, rather than quietly scoring missing data at 100% coverage. SQL run/completeness counters may still count the parent. This precise consequence is the valid core; no dishonest displayed score is presumed.

### ST-16 - SQL finite checks permit numeric infinity

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; direct-SQL scope.

**Documented context.** `docs/reqs.md:1053-1063` requires finite monetary evidence; `docs/arch.md` §7.3 makes DB constraints authoritative for structural validation.

**Trace and proof.** `0006-value-payloads.sql:29-30,47` names “finite” constraints but checks only `<> 'NaN'::numeric`. The Compose-pinned PostgreSQL 17 supports infinities in unconstrained numeric. `+Infinity`/`-Infinity` are not NaN and satisfy these predicates. A Quantity with known unit and infinite magnitude therefore survives all these SQL checks; an EUR monetary row with infinite amount/equivalent and no conversion avoids the published-FX FK as well. No later migration tightens these columns' finite predicate.

**Tests, counterevidence and limits.** Domain payload fields explicitly set `allow_inf_nan=False`, and `tests/unit/data/test_payloads.py:164-171` includes NaN rejection. `storage/test_value_store.py:161-190` exercises those already validated objects; it contains no direct numeric infinity insert. Thus the API/domain guard is effective, but it does not prove the constraint named finite does what it says for other writers. Subsequent domain reads refuse unusable evidence rather than honestly scoring infinity. This remains a low-severity latent SQL-ingestion issue, not a current publisher-value claim.

### ST-17 - multiple share thresholds collapse silently to the first

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; latent generic threshold scope.

**Documented context.** `docs/reqs.md:1149-1160,1743-1748` models typed label-share bounds; preserving a stored interpretation or refusing unsupported multiplicity is required by the full-copy contract.

**Trace and proof.** `0009-criteria.sql:175-197` permits one threshold row **per (criterion,label)**, so two different labels coexist. `queries/criteria.sql:94-102` aggregates all in label order. `storage/criteria_store.py:360-365` selects only `[0]`, constructing the single-label ShareThreshold. Any unrelated whole-set edit then clears all threshold rows (`queries/criteria.sql:272-274`) and `_write_threshold:276-283` writes only the one reconstructed bound. The second valid SQL row disappears permanently.

**Counterevidence and tests.** The neighboring label mapper (`criteria_store.py:347-357`) explicitly refuses multiple labels; no equivalent guard exists for shares. `unit/criteria/test_thresholds.py:110-137` checks one share's range/type, and `storage/test_criteria_store.py:371-423` exercises label thresholds without multiple share rows. The current catalog has no scored ShareComposition and API writes only one bound, so this is not normal v1 HTTP creation. An unscored generic ShareComposition criterion is allowed, and a SQL-loaded multi-bound state should not be silently rewritten. Choosing single-bound support is legitimate if storage refuses the extra state explicitly.

### ST-18 - conversion provenance is omitted by storage and API

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High; known/deferred converted-value presentation gap.

**Documented context.** `docs/reqs.md:1808-1821` requires the rate's publisher/date alongside a conversion. `docs/openapi.yaml:1062-1068,1179-1187` defines an optional FxRate object which, when present, requires rate, date and source. P10 is explicitly deferred in `docs/known-issues.md:24-26`.

**Trace and proof.** `queries/values.sql:49-53,153-157` assembles scalar fx rate/date, not its publisher. `storage/value_store.py:307-318` writes the scalar fields; `api/values.py:197-207` deliberately removes both instead of constructing the nested object. A stored converted amount therefore reaches the client without the rate used or its provenance. **Counterevidence:** `0112-a-conversion-names-a-published-rate.sql:34-52` really does pin the scalar tuple to a published `fx_rate` row. The publisher is not nonexistent in the database, and conversions cannot freely invent an unrecorded rate.

**Tests and limits.** `test_value_store.py:277-326` checks amount/rate/date round trips and refuses unpublished/misdated rates; none checks API publisher disclosure. MonetaryPayload's optional fx_rate means schema validation alone need not fail, despite the stronger provenance requirement. No active country monetary source exposure is asserted; the finding correctly describes an accepted generic capability gap. There is no separate BE-35 result because that duplicate was folded into this source ID.

### ST-19 - attribute-removing rollbacks ignore persistent run references

**Original severity:** Low  
**Verdict:** REAL  
**Confidence:** High, historical populated-rollback scope.

**Documented context.** `docs/devplan.md` §0.4 requires a complete change with its documented recovery path; `docs/arch.md` §§7.4,9.5 keeps migration explicit and protects irreplaceable history. Refusal to destroy saved evidence can be deliberate.

**Trace and proof.** At schema version 0488, perform a normal acquisition involving `housing_price_level`, leaving a `data_acquisition_run_attribute` row. `0488…rollback.sql:40-47` deletes citations/payloads/values then the attribute, but never handles the scope reference. That FK is restrictive (`0004-data-acquisition.sql:40-45`), so rollback fails even with no saved evaluation. `0470-european-air-connectivity.rollback.sql:26-35` has the same independent barrier at its historical version. A run with no successful values can trigger it too: planned scope alone is enough.

**Tests, qualifications and limits.** `test_migration_hygiene.py:160-211` checks value-child cleanup and intentionally exempts saved-evaluation references; it never covers the run-scope relation. The newer `0478`/`0492` rollback preflights explicitly refuse incompatible stored values with a backup remedy, a sound pattern that does not guard these two earlier deletions. Database rollback prevents partial data loss; this is an unusable recovery operation for an ordinary populated predecessor, **not** proof a destructive rollback currently succeeds. Unwinding all modern dependencies may encounter other intentional refusals first; the stated historical scenario isolates this one.

### ST-20 - container migrations bypass the required backup

**Original severity:** Medium  
**Verdict:** REAL  
**Confidence:** High.

**Documented context.** `docs/arch.md:1093-1101` says backup **before every migration**, specifically because manually entered evidence cannot be re-fetched.

**Trace and proof.** `Makefile:72-80` makes the local `migrate` target depend on `backup`. The supported `docker-migrate` target (`:180-181`) instead calls `docker compose --profile tools run --rm migrate` directly. `compose.yaml:116-135` gives that service only a healthy-database dependency and a yoyo command. Backup is a separate profile-gated sibling (`:136-165`), never a successful-completion prerequisite of migration. Therefore this standard container path can mutate schema/catalog without creating the promised prior dump.

**Tests, counterevidence and limits.** Gate D's backup test (`acceptance/test_gate_d.py:281-370`) invokes pg_dump/pg_restore directly and verifies a manual value survives; it establishes restore mechanics, not that **docker-migrate** invokes backup first. The backend refuses an old schema at boot, and migrations are manual; neither is a backup guard. A user may run backup separately, but the command does not enforce it. No migration, dump, restore or database connection was performed for this review.

## Limitations and follow-up evidence

- The 91 verdicts establish static paths or counterevidence, not reproduction frequency. No source report's historical “passed”, coverage percentage or live-data claim was adopted as a fresh measurement.
- Runtime checks, if later authorized, should target the specific gaps described above: held-response UI interleavings and real pointer sequences, nginx/ASGI disconnect behavior, overlapping start transactions, populated predecessor migrations, per-candidate process death, and multi-edition/history pagination. None was executed.
- BE-36 requires a product decision before a test can establish the desired result: expiry notification versus automatic invalidation, protection of manual overrides, and deliberate re-research after household changes.
- DB-integrity findings identify what a valid SQL/store writer can persist beyond normal HTTP guards. Upgrade findings state explicit predecessor data assumptions. They do not assert that today's database is corrupt, demand city implementation, or justify erasing historical/manual data.
- This artifact preserves all original severities. Accepted/deferred observations remain observations, not a claim that every REAL item deserves immediate v1 work. No independent severity reranking has been performed.
- The final read-only text comparison found **91 unique source IDs, 91 summary rows and 91 detail sections**, in matching source order, with **zero title, severity or verdict mismatches**. There is no separate BE-35 adjudication. The only file created/edited by this review is this report.
