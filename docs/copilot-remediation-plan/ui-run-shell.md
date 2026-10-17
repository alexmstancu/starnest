# Detailed plan: UI Acquire screen and app shell

> Written on 2026-10-14 by a read-only planning agent against `c943761`, before the scope rule of 2026-10-15. It is the step-by-step detail behind [copilot-remediation-plan.md](../copilot-remediation-plan.md). Where the two differ (scope, decisions, order), the main plan wins.

## Plan for the Acquire screen and the app shell: UI-04 (Acquire part), UI-11, UI-17, UI-22, UI-24, UI-32 and UI-33

All seven findings are still present at HEAD `c943761`. UI-32 has changed shape since the review. After the BE-39 fix (`f30c661`), every attribute lists every source in its priority. So the Acquire screen now always says every attribute has a source, and it never flags one that has none. The UI tests still pass because the mock data still has the old, shorter lists.

Three findings need a decision from you: UI-11, UI-17 and UI-32. Nothing was run, and no file was changed.

---

### UI-04 [Medium] Acquire: a late read of a run replaces the run you chose (Acquire part only)
- **Still present at HEAD?** Yes.
  - `useRunScreen.ts:124-126`: `watch` sets `current` from whichever read arrives.
  - `:139-148`: the one-time automatic opening fires on the first ready history, even after you have acted.
  - `:210-213`: Refresh writes back a read of the run captured at click time.
  - `:214`: Dismiss cancels nothing that is in flight.
  - `:215-222`: Stop re-reads the run after its POST.
  - History rows and Dismiss stay clickable while an action is running (`RunScreen.tsx` `RunHistory`, `RunReport`), so overlaps are ordinary.
- **Root cause:** Every read ends in an unconditional `setCurrent`. Nothing records which action you took last, and the automatic opening does not give way to it.
- **Fix:**
  1. New `ui/src/routes/run/useWatchedRun.ts`, split out so `useRunScreen` stays small. It owns `current`, a `claimed` ref, `claim()` (returns a ticket), `show(ticket, detail)` (applies only if the ticket is still the latest) and `clear()` (claims, then sets null).
  2. In `useRunScreen.ts`, open, refresh, stop, start and commit claim at click time, before their first await. Stop claims before `stopRun`; start and commit claim before `startRun`. Dismiss calls `clear()`.
  3. The automatic opening never claims. It is skipped if anything was already claimed, and its result is applied only if nothing has been claimed by the time it arrives.
  4. `RunScreenState` does not change, so `RunScreen.tsx` needs no edit.
- **Tests first:** in `RunScreen.test.tsx`, a new describe "which run the card shows". The mock server holds a response on a promise that the test releases.
  - "keeps the run you opened when the opening view arrives late": hold `GET /runs/7`, click history row 6, release. Region "Acquisition 6" is present and "Acquisition 7" is absent. This fails today.
  - "keeps a run just started when the first history read is slow": hold the history list, Estimate, Start, release. The card stays on "Acquisition 8". This fails today: the automatic opening shows run 7.
  - "keeps a dismissed card dismissed when a refresh lands after it".
  - "does not let a stop's answer replace a run opened meanwhile".
  - The existing opening and stopping tests stay unchanged and must stay green.
- **Migration / contract / docs:** None. Update the hook's header comment.
- **Files touched:** `ui/src/routes/run/useWatchedRun.ts` (new), `ui/src/routes/run/useRunScreen.ts`, `ui/src/routes/run/RunScreen.test.tsx`.
- **Behaviour change & risks:** The card always shows the last run you chose. Late answers are ignored rather than cancelled, so one GET is wasted. The busy label can still clear early when two actions overlap (see (c)).
- **Depends on / conflicts with:** Same hook and same commit as UI-24. Keep UI-02's estimate → confirm → start path intact. The Configure half of UI-04 is in other files.
- **Effort:** S.
- **Needs a user decision?** No.

### UI-11 [Medium] The sidebar keeps the old household, counts and last run after a write
- **Still present at HEAD?** Yes.
  - `Sidebar.tsx:181-182` reads the household once.
  - `useShellSummary.ts:47-48` re-reads the counts only when the selection changes, and never re-reads the last run.
  - The only signal between the screens and the sidebar is `noteSavedRanking` (`SelectionContext.tsx:51-54`).
- **Root cause:** Nothing tells the sidebar that a write, or the end of a run, changed something. `useResource` already accepts a `freshness` number for exactly this, but nothing supplies one.
- **Fix:**
  1. New `ui/src/api/freshness.ts`, a small store at module level. It defines `type StaleFact = "household" | "ranking" | "runs"`, `markStale(...facts)`, and `useFreshness(fact)` via `useSyncExternalStore`.
     - There is precedent for module-level state in `api/`: the shared roster promise in `useCandidateNames.ts`.
     - It needs no provider, so `App.tsx` does not change.
  2. Sidebar wiring:
     - `HouseholdCard` passes `useFreshness("household")` to `useResource`.
     - In `useShellSummary`, the counts follow `"ranking"` and the last run follows `"runs"`.
  3. When a run starts or ends:
     - `useAcquiring.ts` polls on every route (`AcquiringBar.tsx:20` calls it before the route check at `:23`). It marks `"runs","ranking"` when the running run it sees changes, never on the first look. That rule is a pure `acquisitionChanged(seen, newest)` in `acquiringProgress.ts`.
     - The `onEnded` from UI-24 marks the same facts.
  4. In `useRunScreen.ts`, the history follows `"runs"`. Remove the blanket `history.reload()` inside `act` (`:114`): start is marked where it is written, and open, refresh and estimate change no run.
  5. Where each write marks staleness (decision below). Under option A, each endpoint wraps its request in `thenStale(request, ...facts)`, which marks only on success:
     - `replaceHousehold` → household + ranking.
     - `replaceSettings`, `updateCriterionWeight`/`Lock`/`Rule`, `updatePillarWeight`/`Lock`, `updateDataSource`, `setMatchRuleEnforcement`, `setCompoundRuleApplication`, `putMatchRuleResult`, `enterValueManually` → ranking.
     - `startRun` → runs.
     - Deliberately not marked, and listed in a test allowlist: the plan and research calls, criteria-set create/duplicate/rename/delete (the selection reload already covers them), `stopRun` and `saveEvaluation`.
- **Tests first:** in `App.test.tsx`, under "the sidebar counts and last run":
  - "shows the household a save has just stored": on `/configure`, change Target monthly spend from 2800 to 3100 and save. The sidebar shows `formatMoney(3100,"EUR")`. This fails today.
  - "recounts the candidates once a gate is enforced": swap the `/rankings` mock, then toggle "Enforce Free movement applies". The Matching count changes.
  - "names a run just started as the last acquisition".
  - "reports a run's end without a reload": fake timers; the run list goes from running to completed.
  - Sad path: "leaves the sidebar alone when a save is refused": a 422 on PUT causes no extra `GET /household`.
  - `freshness.test.ts`: marks only the named facts; one call can mark several; subscribers re-render; they unsubscribe on unmount.
  - Under option A, a structural test reads `endpoints.ts` and fails if any function calling `putJson`/`patchJson`/`postJson`/`deleteResource` neither uses `thenStale` nor appears in the allowlist.
  - `endpoints.test.ts`: a successful write marks; a 409 does not.
  - `acquiringProgress.test.ts`: the transition rule.
- **Migration / contract / docs:** None. Optionally add one sentence to `arch.md` 8.1.
- **Files touched:** `ui/src/api/freshness.ts` and its test (new), `ui/src/api/endpoints.ts` and its test, `ui/src/shell/Sidebar.tsx`, `ui/src/shell/useShellSummary.ts`, `ui/src/shell/useAcquiring.ts`, `ui/src/shell/acquiringProgress.ts` and its test, `ui/src/routes/run/useRunScreen.ts`, `ui/src/routes/run/useWatchedRun.ts`, `ui/src/app/App.test.tsx`.
- **Behaviour change & risks:** The sidebar updates after every relevant save and whenever a run starts or ends. Each write costs one to three sidebar GETs, and the card briefly shows "Loading…" (the saved-rankings card already does this). The Rank screen's own table does not follow; that is out of scope.
- **Depends on / conflicts with:** Depends on UI-24 for `onEnded`. Under option A, `endpoints.ts` is shared with UI-17 and UI-16. Under option B, it touches files owned by the agents fixing UI-04, 05, 06, 07, 08, 09, 13 and 14.
- **Effort:** M.
- **Needs a user decision?** Yes: where does a write declare what it made stale?
  - **A (recommended): in `endpoints.ts`.** One file, no edits in other folders, and a guard test catches any future write that forgets. The cost is an explicit side effect inside the endpoint wrappers.
  - **B: at each call site.** One `markStale(...)` line plus an import in each of these:
    - `configure/household/useHouseholdForm.ts:47` (household + ranking)
    - `configure/settings/useSettingsForm.ts:35`
    - `configure/useCriteriaEditor.ts:103, 123, 143, 157, 179` (weight, its undo, lock, its undo, rule)
    - `configure/pillars/PillarWeightsPanel.tsx:69, 89`
    - `configure/rules/useRuleToggles.ts:88`
    - `configure/sources/useDataSources.ts:34`, after the first PATCH, so a later partial failure still marks (UI-07)
    - `configure/proposals/useProposals.ts:104` (confirm only)
    - `run/useManualEntry.ts:66`
    - `run/useRunScreen.ts`, start and commit
    - None in `sets/useCriteriaSets.ts` or `rank/useSavedRankings.ts`.

### UI-17 [Medium] Acquire reads only the ten newest runs
- **Still present at HEAD?** Yes.
  - `useRunScreen.ts:105` calls `fetchRuns(10, …)`.
  - That list feeds "Every acquisition so far" (`RunScreen.tsx:255`), the diff dropdowns (`AcquisitionDiffPanel.tsx:73,91`) and `spentThisMonth(runs, new Date())` (`DatabaseHoldsPanel.tsx:130`, `databaseHolds.ts:57-67`).
- **Root cause:** One fixed page is fetched and `total` is ignored. The API already supports paging (`listRuns` accepts limit ≤1000, offset, and returns total; `openapi.yaml:679-693`, `runs.py:415-428`), so no contract change is needed for the history.
- **Fix:**
  1. In `api/endpoints.ts`, add `fetchEveryRun(options)`, mirroring `fetchValuesFromRun`. It:
     - fetches pages of 100;
     - stops on a short page or when it has `total`;
     - removes duplicates by id (a run started during paging pushes rows down by one);
     - rejects if any page fails, so it never returns a partial list.
  2. Use it at `useRunScreen.ts:105`.
  3. Make the mock `GET /data-acquisition-runs` in `mocks/handlers.ts` honour `offset`, as the server does.
- **Tests first:**
  - `RunScreen.test.tsx`, "the run history":
    - "lists every acquisition, not only the newest ten": with 12 runs, row "1" appears. Fails today.
    - "adds every run this month into Spent this month": 12 runs of €1 dated this month (day 1 of the current month plus i minutes, so the test does not depend on the clock) shows `formatMoney(12,"EUR")`. Today it shows €10.
    - "offers an older run in the diff dropdowns".
  - `endpoints.test.ts`, "reading every run":
    - follows the pages (250 runs → 3 requests);
    - asks once when one page holds everything;
    - stops when the server reports a larger total than it serves;
    - keeps one copy of a run that moves between pages;
    - returns nothing when there are no runs;
    - rejects when page 2 fails.
- **Migration / contract / docs:** None under option (a) below.
- **Files touched:** `ui/src/api/endpoints.ts`, `ui/src/api/endpoints.test.ts`, `ui/src/mocks/handlers.ts`, `ui/src/routes/run/useRunScreen.ts`, `ui/src/routes/run/RunScreen.test.tsx`.
- **Behaviour change & risks:** The history, the diff choices and the monthly spend cover every run. Each history reload now reads every page; the runs query does a count per row but is indexed (`0012`), which is fine at hundreds of runs, though the table gets long. Gate-research spending is still outside this figure (known BE-34 / Q224).
- **Depends on / conflicts with:** Shares `useRunScreen.ts` with UI-04, UI-24 and UI-11. Shares `endpoints.ts` with UI-11 and UI-16 (Rank agent). Shares `handlers.ts` with everyone.
- **Effort:** S.
- **Needs a user decision?** Yes: "Spent this month" stays a total computed in the browser from the server's per-run costs.
  - **(a) Recommended:** keep the browser total, now over the complete list. No contract change, and the sidebar's candidate counts already set this precedent.
  - **(b)** Have the server serve the total, for example `listRuns?started_from=<local first of month>` returning a cost total. That is a contract change plus a store and SQL change. It satisfies "every number on screen is the server's" strictly.
  - **(c)** Drop the figure and keep only the cap note.

### UI-22 [Low] The acquisition diff decides "unchanged" from rounded text
- **Still present at HEAD?** Yes. `acquisitionDiff.ts:91-99` classifies with `isUnchanged(earlierFigure, laterFigure)`, comparing strings from `figureOf` (`:154-158`). Those strings come from `describeFigure`, which rounds to two decimals (`figure.ts:55-61`).
- **Root cause:** Equality is decided after formatting, not on the stored values.
- **Fix:**
  1. In `acquisitionDiff.ts`, add `samePayload(a, b)`: structural equality that ignores key order, keeps array order, and compares primitives with `===`. A pair is "unchanged" only if both payloads exist and are equal. Formatting only fills the Earlier and Later cells.
  2. Keep the result checkable: when a pair changed but both rounded strings read the same, fill both cells with full precision via `describeFigure(value, {exact: true})`. This is a new optional parameter in `format/figure.ts`; other callers keep today's default.
  3. Correct the module comment that says it compares "the string a reader sees".
- **Tests first:**
  - `acquisitionDiff.test.ts`:
    - "calls a pair refreshed when the figure moved by less than the displayed precision": 1.071 to 1.074, same unit. Fails today.
    - "shows the exact figures when the rounded ones would read the same".
    - "calls the same payload unchanged whatever the key order".
    - "a changed unit with the same magnitude is a move".
    - "never calls a one-sided missing payload unchanged".
    - "label sets in a different order count as moved" (documents that order matters).
  - `figure.test.ts`: exact mode keeps every digit; the default still rounds.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/run/acquisitionDiff.ts`, `ui/src/routes/run/acquisitionDiff.test.ts`, `ui/src/format/figure.ts`, `ui/src/format/figure.test.ts`.
- **Behaviour change & risks:** Moves smaller than the displayed precision now read "Refreshed" and show the exact digits. Floating-point noise in a recomputed series now reads as a move, which is true of the stored value.
- **Depends on / conflicts with:** None. `figure.ts` is shared with Rank; the change only adds an optional parameter.
- **Effort:** S.
- **Needs a user decision?** No.

### UI-24 [Medium] Acquire does not follow a live run
- **Still present at HEAD?** Yes.
  - Nothing in `useRunScreen.ts` sets a timer.
  - `RunScreen.tsx:493-497` says "nothing here polls", and `:558-566` is the manual Refresh.
  - The shell poller `useAcquiring` does run on Acquire, but it only feeds the hidden progress strip under the tabs.
- **Root cause:** The card reads its run once per action. The polling required by Q161 and `arch.md` 8.4 was built only for the progress strip.
- **Fix:**
  1. In `shell/useAcquiring.ts`, export the 2-second interval as `POLL_EVERY_MS` so both pollers share one rhythm.
  2. In `run/sourceReach.ts`, add `isLive(run)` = `inFlight(runState(status, stop_requested_at))`.
  3. In `useWatchedRun.ts`, add an effect keyed on the shown run's id. While `isLive(current)`, it:
     - runs a `setTimeout` loop that calls `fetchRun(id, {signal})`;
     - takes the claim ticket at each request and applies the result through `show`;
     - stays silent on a failed read but keeps polling;
     - cancels its request and timer when the run ends, when another run is shown, or on unmount.
  4. On a transition from live to ended (seen by the poll or by Refresh), call `onEnded`. In this commit that reloads the history; UI-11 changes it to `markStale`.
  5. In `RunScreen.tsx`, change comments only. Refresh stays.
- **Tests first:** in `RunScreen.test.tsx`, a new describe "following a live acquisition". It uses `vi.useFakeTimers({shouldAdvanceTime: true})`, `userEvent.setup({advanceTimers: vi.advanceTimersByTime})`, and restores real timers after each test.
  - "follows a running acquisition to its end without a click": the run reads as running, then completed. After `advanceTimersByTimeAsync(POLL_EVERY_MS)` the heading reads "Acquisition finished" and the outcome sentence appears. Fails today.
  - "says Stopped early once a requested stop takes effect".
  - "stops asking once the run has ended": the request count stays flat over three more intervals.
  - "does not poll a run that had already finished".
  - "keeps following after a failed read, with no alert".
  - "brings the history row up to date when the run ends".
  - "drops a poll that lands after another run was opened" (where UI-04 and UI-24 meet).
  - "stops asking when the screen is left".
  - `sourceReach.test.ts`: `isLive` for running, stopping, planned, finished and missing.
- **Migration / contract / docs:** None. This implements `reqs.md` 8.3, Q161 and `arch.md` 8.4.
- **Files touched:** `ui/src/routes/run/useWatchedRun.ts`, `ui/src/routes/run/useRunScreen.ts`, `ui/src/routes/run/sourceReach.ts` and its test, `ui/src/routes/run/RunScreen.tsx` (comments only), `ui/src/routes/run/RunScreen.test.tsx`, `ui/src/shell/useAcquiring.ts`.
- **Behaviour change & risks:**
  - The card updates every 2 seconds and settles when the run ends. Stop disappears, and the history updates once at the end.
  - On Acquire, two pollers read the same run, about three cheap GETs every 2 seconds.
  - These are the first fake-timer tests in the suite. If the mock server misbehaves under fake timers, the fallback is to mock the module holding the interval.
  - The Gate C e2e loop that clicks Refresh still works but becomes redundant (e2e owner's call).
  - `reqs.md` 8.3 asks for progress per candidate and per criterion; the card stays aggregate-only, which is out of scope here.
- **Depends on / conflicts with:** UI-04 (same hook and commit). UI-11 then hooks into `onEnded`.
- **Effort:** M.
- **Needs a user decision?** No.

### UI-32 [Medium] "No source" is inferred from priority order, and BE-39 reversed the symptom
- **Still present at HEAD?** Yes, in a new form.
  - `unsourced.ts:89` and `criterionReading.ts:188-191` still treat an empty `effective_source_priority` as "no source".
  - Since `f30c661` (`catalog.py:201,234`), every attribute's list contains every source, including `llm` and `manual`.
  - So the card always says "Every attribute at this level has at least one source" (`UnsourcedAttributes.tsx:109`), and Configure's "No source yet →" chip never appears.
  - `handEnterable` (`unsourced.ts:135-144`) prints "Otherwise: …, llm, manual". That offers `manual` as the alternative to typing by hand, and `llm` even though the LLM fallback skips hand-entry attributes (`main.py:356-393`).
  - The UI tests stay green because `mocks/fixtures.ts:610-683` still has the old, shorter lists.
- **Root cause:** Which sources can actually fetch an attribute is not in the contract. That is known on the server: each adapter's `attributes`, held in the `app.state.adapters` registry. The UI uses the priority order as a stand-in for it.
- **Fix (option A):**
  1. In `docs/openapi.yaml`, add `Attribute.answerable_by: string[]` (required): the sources whose registered adapter can fetch this attribute, in priority order. Empty means no run can fill it. It ignores the on/off switch. Record the decision as a row in `reqs.md` Appendix B.
  2. In `api/catalog.py`, `_attribute_body` takes the adapters (via the `Adapters` dependency) and keeps only the resolved sources whose adapter declares the attribute. Run `make openapi`.
  3. Run `npm run generate:client` to regenerate `ui/src/api/schema.ts`.
  4. In `unsourced.ts`:
     - `unsourcedAttributes` lists an attribute only when `answerable_by` is present and empty. An absent field means "not known", not "no source".
     - `handEnterable` lists `answerable_by`, not the priority order.
  5. Make the same change in `configure/criteria/criterionReading.ts` `hasNoSource` (Configure folder; flag it to that owner).
  6. In `fixtures.ts`, use full priority lists and add `answerable_by` to every attribute.
  7. Correct the "the two lists never overlap" comments in `UnsourcedAttributes.tsx`, `OpenToHandEntry.tsx` and `unsourced.ts`. An attribute that can only be typed by hand now honestly appears in both lists.
- **Tests first:**
  - `test_catalog_api.py`, "an attribute says which sources can fetch it": with the test's stub source, the overburden attribute returns `["eurostat"]`; an attribute nothing fetches returns `[]`. Fails today (field missing).
  - `unsourced.test.ts`:
    - "lists an attribute nothing can fetch even though every source is in its priority". Fails today.
    - "leaves out an attribute a source can fetch without an override".
    - "claims nothing when the catalog does not say".
    - `handEnterable`: "names what can fetch it, not the whole priority order" and "Nothing else would answer it".
  - `criterionReading.test.ts`: the same pair.
  - The `RunScreen.test.tsx` "attributes with no data source at all" tests run against the new fixtures; rename the "never overlap" test.
- **Migration / contract / docs:** Contract change as above, plus the regenerated `openapi.implemented.yaml` and `schema.ts`, plus the `reqs.md` row. No database migration.
- **Files touched:** `docs/openapi.yaml`, `docs/openapi.implemented.yaml`, `docs/reqs.md`, `backend/src/starnest/api/catalog.py`, `backend/tests/acceptance/test_catalog_api.py`, `ui/src/api/schema.ts`, `ui/src/mocks/fixtures.ts`, `ui/src/routes/run/unsourced.ts` and its test, `ui/src/routes/run/UnsourcedAttributes.tsx`, `ui/src/routes/run/OpenToHandEntry.tsx`, `ui/src/routes/run/RunScreen.test.tsx`, and in the Configure folder `ui/src/routes/configure/criteria/criterionReading.ts` and its test.
- **Behaviour change & risks:** The card lists the attributes no adapter can fetch, and the chip comes back. That list depends on whether an LLM key is configured, because the LLM fallback only exists with one. A capable source that is switched off still counts as able. `sanity.spec.ts:403` accepts either sentence, so it keeps passing.
- **Depends on / conflicts with:** Builds on BE-39, which is done. Shares `criterionReading.ts` with the Configure agent and `fixtures.ts` with everyone.
- **Effort:** M.
- **Needs a user decision?** Yes, because it is a contract change.
  - **A (recommended):** serve `answerable_by` as above.
  - **B:** no contract change. Remove the claims instead: drop the "no data source at all" card and the chip, and relabel "What else would answer it" as "Priority order". This loses the design's item H.
  - **C:** work it out with one `POST /plan` request per attribute. Rejected: about 45 requests every time the screen opens.

### UI-33 [Low] The run estimate repeats a source once per adapter
- **Still present at HEAD?** Yes.
  - `runs.py:191-194` adds one estimate row per adapter.
  - Several published tables share a source: oecd has three tables plus the OECD API adapter, and national_statistics and national_law have two tables each.
  - `RunScreen.tsx:418-419` keys the rows of the "Per source" table by `data_source`, so the keys repeat.
- **Root cause:** The plan is built per adapter, but its `{data_source, items}` shape, and the per-source breakdown of a finished run (grouped by source in SQL), are per source.
- **Fix:**
  1. In `runs.py` `plan_run`, sum the items per `data_source`, in the order each first appears; the cost estimate stays per adapter.
  2. In `docs/openapi.yaml`, add a description to `RunPlan.by_source`: one entry per source. Regenerate `schema.ts`; `generatedClient.test.ts` checks it is fresh.
  3. No UI change, and no summing in the browser.
- **Tests first:** in `test_runs_api.py` `TestPlanningARun`, "a source with two adapters is one row": two stub eurostat adapters (the second answering `A_SECOND_SOURCE_ANSWERS`) give `by_source == [{"data_source": "eurostat", "items": 96}]` and `items_total == 96`. Fails today. The existing two-source test keeps its order.
- **Migration / contract / docs:** A description only; the shape does not change.
- **Files touched:** `backend/src/starnest/api/runs.py`, `backend/tests/acceptance/test_runs_api.py`, `docs/openapi.yaml`, `ui/src/api/schema.ts`.
- **Behaviour change & risks:** "Per source" shows each source once, with its total. No known risk.
- **Depends on / conflicts with:** `runs.py` is also touched by the backend agents' retry fixes.
- **Effort:** S.
- **Needs a user decision?** No.

---

**(a) Commits, in priority order**
1. `fix(ui): Acquire keeps the run you chose and follows a live run to its end (UI-04, UI-24)` — `useWatchedRun.ts` (new), `useRunScreen.ts`, `sourceReach.ts` and its test, `RunScreen.tsx`, `RunScreen.test.tsx`, `shell/useAcquiring.ts`.
2. `fix(ui): Acquire lists every acquisition and adds up the whole month (UI-17)` — `api/endpoints.ts` and its test, `mocks/handlers.ts`, `useRunScreen.ts`, `RunScreen.test.tsx`.
3. `fix(ui): the sidebar re-reads what a save or a finished run made stale (UI-11)` — `api/freshness.ts` and its test, `api/endpoints.ts` and its test, `Sidebar.tsx`, `useShellSummary.ts`, `useAcquiring.ts`, `acquiringProgress.ts` and its test, `useRunScreen.ts`, `useWatchedRun.ts`, `App.test.tsx`. Under option B, also the Configure hooks listed above.
4. `fix(api): attributes say which sources can fetch them, and Acquire stops guessing from priority order (UI-32)` — the contract, catalog and UI files listed under UI-32.
5. `fix(ui): the acquisition diff compares stored figures, not rounded text (UI-22)` — `acquisitionDiff.ts` and its test, `format/figure.ts` and its test.
6. `fix(api): a run estimate lists each source once (UI-33)` — `runs.py`, `test_runs_api.py`, `openapi.yaml`, `schema.ts`.

**(b) Every file these plans touch, and which findings touch it**
- `ui/src/routes/run/useRunScreen.ts`: UI-04, UI-24, UI-17, UI-11
- `ui/src/routes/run/useWatchedRun.ts` (new): UI-04, UI-24, UI-11
- `ui/src/routes/run/RunScreen.test.tsx`: UI-04, UI-24, UI-17, UI-32
- `ui/src/routes/run/RunScreen.tsx`: UI-24 (comments only)
- `ui/src/routes/run/sourceReach.ts` and its test: UI-24
- `ui/src/routes/run/acquisitionDiff.ts` and its test: UI-22
- `ui/src/routes/run/unsourced.ts` and its test, `UnsourcedAttributes.tsx`, `OpenToHandEntry.tsx`: UI-32
- `ui/src/routes/run/useManualEntry.ts`: UI-11, only under option B (also edited by UI-06)
- `ui/src/shell/useAcquiring.ts`: UI-24, UI-11
- `ui/src/shell/acquiringProgress.ts` and its test, `ui/src/shell/Sidebar.tsx`, `ui/src/shell/useShellSummary.ts`: UI-11
- `ui/src/api/freshness.ts` and its test (new): UI-11
- `ui/src/api/endpoints.ts` and its test: UI-17, UI-11 (also UI-16)
- `ui/src/api/schema.ts` (regenerated): UI-32, UI-33
- `ui/src/mocks/handlers.ts`: UI-17
- `ui/src/mocks/fixtures.ts`: UI-32
- `ui/src/format/figure.ts` and its test: UI-22
- `ui/src/app/App.test.tsx`: UI-11
- `ui/src/routes/configure/criteria/criterionReading.ts` and its test: UI-32 (Configure owner)
- Configure hooks, only under UI-11 option B: `household/useHouseholdForm.ts`, `settings/useSettingsForm.ts`, `useCriteriaEditor.ts`, `pillars/PillarWeightsPanel.tsx`, `rules/useRuleToggles.ts`, `sources/useDataSources.ts`, `proposals/useProposals.ts`
- `docs/openapi.yaml`: UI-32, UI-33
- `docs/openapi.implemented.yaml`, `docs/reqs.md`: UI-32
- `backend/src/starnest/api/catalog.py`, `backend/tests/acceptance/test_catalog_api.py`: UI-32
- `backend/src/starnest/api/runs.py`, `backend/tests/acceptance/test_runs_api.py`: UI-33

**(c) Defects next to these findings that the review does not list**
1. **Every action on Acquire resets the diff's chosen pair.**
   - `act` reloads the history (`useRunScreen.ts:114`), and `useResource` resets to loading on every reload (`useResource.ts:54`).
   - The holds panel, the diff panel and the history only render when ready (`RunScreen.tsx:93,251,262`), so they unmount and the diff panel loses its earlier/later selection on every open, Refresh or estimate.
   - The UI-11 plan removes this for open, Refresh and estimate. A run starting or ending would still reset it.
   - The full fix is to keep showing the last loaded list while reloading.
2. **The BE-39 commit removed a test class header.** In `f30c661`, `class TestSwitchingASourceOff:` was deleted from `test_catalog_api.py`. Its docstring is now a bare string at line 152, and its `SOURCE`, `_restore` and source-switch tests now sit inside `TestTheAttributes`. The tests still run, but are reported under the wrong class.
3. **The listRuns default differs between contract and server.** The contract default is 100 (`openapi.yaml:1019`) but the server serves 20 (`runs.py:421`, recorded in `openapi.implemented.yaml`). The drift test compares parameter names, not defaults.
4. **The hand-entry card shows a raw pillar id.** `OpenToHandEntry.tsx:102` prints `attribute.pillar` as-is, while the card beside it uses `pillarName`.
5. **The busy label can clear too early.** When two actions overlap, the first one's `finally` clears `busy` while the second is still reading (`useRunScreen.ts:108-120`), so the Refresh button loses its "Reading…" state early.
