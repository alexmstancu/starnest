# Detailed plan: UI Configure screen and gate research

> Written on 2026-10-14 by a read-only planning agent against `c943761`, before the scope rule of 2026-10-15. It is the step-by-step detail behind [copilot-remediation-plan.md](../copilot-remediation-plan.md). Where the two differ (scope, decisions, order), the main plan wins.

> **Correction, 2026-10-25 (PL-182, G-S8).** This plan relies on a shared answers resource, `routes/configure/useGateAnswers.ts`, owned by `ConfigureScreen` and passed down to the rules, the proposals and the answers form (UI-01, UI-12, UI-29, BE-36, UI-13). **That resource was never built.** What was built, checked at `738a3ec`:
> - **No shared resource is passed down.** `ConfigureScreen.tsx` owns a counter, `answersVersion`, and `noteAnswered`, which bumps it whenever a gate answer is written anywhere on the screen (a confirm, a research pass, the answers form). Each panel that shows answers gets it as `answersFreshness` and reads `fetchMatchRuleResults` itself, again whenever it moves.
> - **The rules panel** reads the answers in `routes/configure/rules/useRuleToggles.ts`, and the rest of what its cost lines need -- the live ranking, the household's citizenships and whether the roster has placed the answers at a level -- through `routes/configure/rules/useGateEvidence.ts` (PL-156, PL-164).
> - **The proposals** read them in `routes/configure/proposals/useProposals.ts`.
> - **A hook named `useGateAnswers` does exist, at `routes/configure/answers/useGateAnswers.ts`** (PL-152, 2026-10-25), but it is the gate-answers area's own: its read of the answers at one level, the recorded list, and the form that records, corrects or rules out an answer, one write at a time. Nothing outside `answers/` imports it.
> - **The research pass is the screen's**, as UI-01 step 4 planned: `ConfigureScreen.tsx` owns `useResearchPass`, so a set switch does not end a pass.
>
> The passages below that name the shared hook are kept as written, with a note at each, so the history of the plan stays readable.

I've written plans for all 17 findings. 16 are still fully present at HEAD, and UI-01 is partly fixed: nothing under `ui/src/routes/configure/` has changed since the baseline. Five need a decision from you: UI-01, UI-09, UI-12, UI-13 and UI-29. The questions are at the end of each section. Paths below are relative to `ui/src/` unless they start with `ui/`, `backend/`, `storage/` or `docs/`; the "Files touched" bullets give full paths.

### UI-01 [High] Gate research is one long request that the proxy can still cut off
- **Still present at HEAD?** Partly.
  - Commit `812f2ff` gave research its own proxy block with a 300 s read timeout (`ui/nginx.conf:37-47`) and a text guard for it (`app/architecture.test.ts:305-322`).
  - The page still sends the whole level in one request: `routes/configure/proposals/useProposals.ts:82-91` calls `researchMatchRules({level, accept_uncapped_spend})` with no `match_rules` or `candidates` filter.
  - The backend asks every gate × candidate pair inside that one request (`backend/.../data_acquisition/research.py:131-164`). Each pair is one web-search call, and the SDK runs with default settings (600 s timeout, 2 retries, `backend/src/starnest/main.py:453`). Up to 160 calls can never fit under 300 s.
- **Root cause:** The whole pass travels in one synchronous request, so its duration grows with gates × candidates and no proxy ceiling is safe. The server's spend cap is per request, so it is the only cap on a pass.
- **Fix:** send the pass as a series of one-question requests, with the page holding the pass to the spend cap.
  1. `api/endpoints.ts` → `ResearchScope`: add `candidates?: string[] | null`. It is already in the contract and in `api/schema.ts:2071`.
  2. New pure module `routes/configure/proposals/researchPass.ts`:
     - `questionsFor(rules, roster)`: gate-major order, matching the server's `gates_to_ask`.
     - `PassTally` and `withOutcome`: add up the server's `cost_eur`, `calls`, proposals and refusals. Sum in integer micro-euros so float drift can't matter at the cap boundary.
     - `reachedCap(tally, cap)`: `cap !== null && spent >= cap`, the same rule as the server meter's `is_exhausted`.
     - `spendIsKnown(error)`: a refusal in the contract's error shape (4xx) spent nothing; a network error, 5xx or 504 means unknown.
  3. New hook `routes/configure/proposals/useResearchPass.ts`:
     - At start, read `fetchSettings()` (the cap), `fetchMatchRules(level)` and `fetchCandidates(level)`.
     - Then for each question, one at a time: stop if Stop was pressed or `reachedCap`. Otherwise POST `{level, match_rules:[g], candidates:[c], accept_uncapped_spend}` with an AbortSignal.
     - End on `halted_on_spend_cap`, on any refusal and on any failure.
     - Re-read the answers once at the end, not after every request: `useResource.reload` blanks the list.
     - Abort on unmount. Stop takes effect after the question in flight.
  4. `routes/configure/ConfigureScreen.tsx`: own the pass and a new shared answers resource, `routes/configure/useGateAnswers.ts`, and pass both down. This way switching criteria set (which remounts RulesPanel and its children) does not abort a pass.
     - *As built (2026-10-25, PL-182):* the screen owns the pass, but not an answers resource. It passes down `answersFreshness`, a counter `noteAnswered` bumps, and each panel reads the answers itself. See the correction at the top.
  5. `useProposals.ts`: drop `research` and `refusals`, and read answers from the shared resource. `ProposalsPanel.tsx`: progress, a "Stop after this question" button, and Estimate/Research/Confirm disabled while a pass runs (see (c)2: a proposal in flight can overwrite a confirmation).
  6. Keep the nginx block and its guard. Update the nginx comment: each request is now one question, and the ceiling covers one slow call with SDK retries.
- **Tests first:** in `routes/configure/proposals/ProposalsPanel.test.tsx`:
  - "asks one gate about one candidate per request, never the whole level". Every recorded body has exactly one `match_rules` entry and one `candidates` entry, and together they cover 3 gates × 6 mock candidates. It fails today because there is one body with only `level`.
  - "stops before the next question once the pass has spent the cap". The mock returns `cost_eur: 4, calls: 1` per request and the cap is 10, so exactly 3 requests go. It fails today because only 1 request goes.
  - Follow-ups:
    - a `halted_on_spend_cap` on the 2nd request means 2 requests;
    - a 409 `spend_cap_not_set` means 1 request;
    - `HttpResponse.error()` on the 2nd request stops the pass with "spend unknown";
    - Stop during a held request means no further requests;
    - unmount mid-pass means no further requests;
    - the uncapped flag goes with every request of the pass and not with the next pass;
    - answers are re-read once at the end.
  - New `routes/configure/proposals/researchPass.test.ts`: order, sums, cap below/at/above/null, `spendIsKnown`.
  - Rewrite the 4 existing research tests that assume a single request.
  - The nginx timeout itself can't run in vitest; the existing architecture guard keeps it locked.
- **Migration / contract / docs:** No contract change.
  - `docs/reqs.md` Appendix B: a new decision entry recording the batching decision, at the next free number (Q233 is taken since NEW-24).
  - `docs/known-issues.md` P28: the per-request cap no longer bounds a pass; the page does.
  - `docs/design-brief.md`: progress, Stop and outcome have no design yet.
  - `ui/nginx.conf`: comment only.
- **Files touched:** `ui/src/api/endpoints.ts`, `ui/src/routes/configure/useGateAnswers.ts` (new), `ui/src/routes/configure/ConfigureScreen.tsx`, `ui/src/routes/configure/proposals/researchPass.ts`(+`.test.ts`, new), `ui/src/routes/configure/proposals/useResearchPass.ts` (new), `ui/src/routes/configure/proposals/useProposals.ts`, `ui/src/routes/configure/proposals/ProposalsPanel.tsx`(+`.test.tsx`), `ui/nginx.conf`, plus the three docs above.
  - *As built (2026-10-25, PL-182):* `ui/src/routes/configure/useGateAnswers.ts` was never created. The answers are read in `rules/useRuleToggles.ts` and `proposals/useProposals.ts`, re-read through `ConfigureScreen`'s `answersFreshness`; see the correction at the top.
- **Behaviour change & risks:**
  - You see per-question progress and can stop.
  - The pass never starts a question once spending has reached the cap, so it ends at most one call past it, the same bound the server's meter gives a single request. That only holds as far as the server reports billed cost; BE-17 still under-reports billed failures.
  - Leaving Configure aborts the request in flight. The server still finishes that one call and stores its proposal.
  - A 504 shows up as `client.malformed_error_body`, so the end sentence should name the timeout instead.
  - About gates × candidates cheap requests per pass.
  - If "never past the cap" is wanted, each question can first be priced with the free plan endpoint; that doubles the requests.
- **Depends on / conflicts with:** UI-14 (same commit). BE-17 is needed for an exact bound. BE-34 means the outcome is session-only. `api/endpoints.ts` is shared. `ConfigureScreen.tsx` is also touched by UI-04, UI-12 and UI-29.
- **Effort:** L.
- **Needs a user decision?** Yes, two:
  1. Batch size:
     - (a) one gate × one candidate per request (**recommended**: one paid call per request, at most one call over the cap, well under 300 s);
     - (b) one candidate per request (fewer requests, but up to 5 calls ≈ minutes per request, and up to 5 calls over the cap).
  2. Leaving Configure:
     - (a) stops the pass (**recommended**);
     - (b) keeps it running from a shell-level context with progress in the sidebar (M–L).

### UI-14 [Medium] Research throws away what it actually spent and whether it hit the cap
- **Still present at HEAD?** Yes. `useProposals.ts:82-91` keeps only `outcome.refusals`. `ProposalsPanel.tsx:73-96` shows only the estimate; `cost_eur`, `calls` and `halted_on_spend_cap` are never shown.
- **Root cause:** The hook discards the response's billing fields, and there is no "last outcome" state.
- **Fix** (in the UI-01 commit):
  1. `researchPass.ts` gets `describeProgress` and `describeEnd`. They show actual calls and euros (`formatMoney`) beside "estimated at most €X", and the end reason: finished, stopped at the cap (with the cap, the amount spent and how many questions were not asked), stopped by you, or failed (with whether that request's spend is known). Refusals accumulate.
  2. `ProposalsPanel.tsx` renders the running tally (`role="status"`) and the last pass's end block. The estimate is formatted with `formatMoney` too.
  3. The plan is cleared when a pass ends, so another paid pass needs a fresh estimate.
- **Tests first:** in `ProposalsPanel.test.tsx`:
  - "says what the pass actually spent, beside what it was estimated to" (default mock: 18 × €0.04 = €0.72, next to "€4.20"). Fails today.
  - "says the pass stopped at the spend cap rather than looking finished". Fails today.
  - Follow-ups: refusals accumulate across requests; a failed request reads "unknown"; a free pass says nothing was charged. Update the `/4\.2 EUR/` assertion and the "does not remember the acceptance" test, which must now re-estimate between passes.
- **Migration / contract / docs:** None beyond UI-01's.
- **Files touched:** `ui/src/routes/configure/proposals/researchPass.ts`(+test), `ui/src/routes/configure/proposals/useResearchPass.ts`, `ui/src/routes/configure/proposals/ProposalsPanel.tsx`(+test).
- **Behaviour change & risks:** The running total is a client-side sum of the server's figures, which you sanctioned; it lives only in the pure module. The outcome is lost on reload (BE-34 is deferred).
- **Depends on / conflicts with:** UI-01 (same commit); BE-17.
- **Effort:** S on top of UI-01.
- **Needs a user decision?** No.

### UI-04 [Medium] (Configure part) A save's answer can land in another set, or overwrite a newer answer
- **Still present at HEAD?** Yes.
  - `routes/configure/useCriteriaEditor.ts:100-104, 140-144, 176-180` merge every response into whatever list is on screen. `applyRebalance` (:200-210) matches on attribute only.
  - The undo reversers at :121-124 and :155-158 do the same.
  - Only the row being saved is disabled (`criteria/CriteriaPanel.tsx:352, 385`), so writes in the same pillar can overlap.
  - `pillars/PillarWeightsPanel.tsx:64-91` applies move and lock answers in arrival order, and no pillar control is ever disabled.
- **Root cause:** Completions never check which set they belong to, and overlapping writes are allowed, so answers can arrive out of order.
- **Fix:**
  1. `useCriteriaEditor.ts`:
     - Add a `shownSet` ref, updated in an effect (lint's `react-hooks/refs` rule forbids writing a ref during render).
     - Each write records the set it was issued for. Success, failure and the undo reverser merge criteria or set `saveError` only if that set is still the one shown (history is still noted; see UI-08).
     - Add an in-flight ref that refuses a second write, and expose `busy`.
  2. `CriteriaPanel.tsx`: disable every row's slider and lock, and the rule Save/Revert buttons (via `criteria/CriterionRuleFields.tsx`), while `busy || history.undoing`.
  3. `RecentChanges.tsx` (fed from `ConfigureScreen.tsx`): disable the undo buttons while the editor is busy.
  4. `PillarWeightsPanel.tsx`: add a `saving` state plus ref, set by `move` and `lock`; disable all pillar sliders and locks while it is set.
- **Tests first:**
  - `routes/configure/ConfigureScreen.test.tsx`, "a weight saved in one set never lands in another set chosen meanwhile": duplicate Default, hold the copy's PATCH, switch to Default, release; Default still shows 50. Fails today.
  - Same file, "while one criterion is being saved, the rest of the set waits": other rows' sliders, locks and rule Save are disabled. Fails today.
  - `PillarWeightsPanel.test.tsx`, "while one pillar's weight is being saved, no other pillar can be moved or locked". Fails today.
  - Follow-ups: a refusal for a set no longer shown is not reported against the one that is; undo is blocked during a save and the reverse; controls re-enable after the answer.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/useCriteriaEditor.ts`, `ui/src/routes/configure/criteria/CriteriaPanel.tsx`, `ui/src/routes/configure/criteria/CriterionRuleFields.tsx`, `ui/src/routes/configure/RecentChanges.tsx`, `ui/src/routes/configure/ConfigureScreen.tsx`, `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx`, with tests `ConfigureScreen.test.tsx`, `PillarWeightsPanel.test.tsx`, `criteria/CriteriaPanel.test.tsx`.
- **Behaviour change & risks:** Controls are disabled for the length of a save (~100 ms locally). A keyboard user loses focus on a disabled slider, which already happens on the row being saved. Lost updates between separate clients remain ST-02.
- **Depends on / conflicts with:** UI-05, UI-08 and UI-09 (same commit, same files). The Run-screen part belongs to another agent.
- **Effort:** M.
- **Needs a user decision?** No.

### UI-05 [Medium] One slider release can send the same weight twice
- **Still present at HEAD?** Yes.
  - `PillarWeightsPanel.tsx:325-328` binds pointerup, mouseup, keyup and blur to `release`.
  - `commit` (:245-258) compares only with the server's old weight, so a mouseup or blur before the answer sends a second whole-level PUT.
  - The criterion slider (`CriteriaPanel.tsx:361-364`) has the same handlers. Disabling it during its own save blocks the mouseup, but not a blur.
- **Root cause:** There is no per-gesture "already sent" state; the only guard reads a prop that changes only when the answer arrives.
- **Fix:**
  1. In `PillarRow` and `CriterionRow`, add a `sent` ref: set when a release sends, cleared by the next `onChange`. A release while it is set does nothing, and does not end the gesture (the answer ends it).
  2. Using UI-04's pillar `saving` state, add the same reset-on-save-end that `CriterionRow` already has (`CriteriaPanel.tsx:276-282`). Today a refused pillar weight leaves the thumb at the refused position, and the next blur sends it again.
- **Tests first:**
  - `PillarWeightsPanel.test.tsx`, "sends one weight for one release even when the mouse and focus also let go": held PUT, change 50, then pointerUp + mouseUp + blur, expect 1 request. Fails today.
  - Same file, "puts the thumb back after a refused weight and sends nothing on the next blur". Fails today.
  - `CriteriaPanel.test.tsx`: pointerUp then blur during a held PATCH, expect 1 request. Fails today.
  - Follow-ups: a new drag after the answer sends again; keyUp sends once.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx`(+test), `ui/src/routes/configure/criteria/CriteriaPanel.tsx`(+test).
- **Behaviour change & risks:** Exactly one request per gesture, and a refused thumb moves back. Low risk.
- **Depends on / conflicts with:** UI-04 (same commit).
- **Effort:** S.
- **Needs a user decision?** No.

### UI-08 [Medium] Undo history mixes the same attribute across criteria sets
- **Still present at HEAD?** Yes. History targets are `criterion:${attribute}` and `lock:${attribute}` (`useCriteriaEditor.ts:106, 146`). `record` collapses equal targets, keeping the old `before` with the new `reverse` (`routes/configure/changeHistory.ts:57-62`).
- **Root cause:** The history key leaves out the criteria set, so one attribute's edits in two sets collapse into one entry whose undo writes set A's value into set B.
- **Fix:**
  1. `useCriteriaEditor.ts`: targets become `criterion:${criteriaSetId}:${attribute}` and `lock:${criteriaSetId}:${attribute}`. Labels get the set's name, captured when the change is made (for example "…: 50 to 40, in Default"). Existing regex assertions still match.
  2. With UI-04, a completion for a set no longer shown is still noted but not merged.
- **Tests first:**
  - `ConfigureScreen.test.tsx`, "keeps the same change to two sets as two entries, each undone in its own set": edit in the copy, switch to Default, edit again. Expect two entries; undoing each sends `{weight:50}` to its own set's URL. Fails today (one entry, and the undo goes to the wrong set).
  - Follow-ups: the label names the set; a drag inside one set still collapses (`changeHistory.test.ts` stays green).
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/useCriteriaEditor.ts`, `ui/src/routes/configure/ConfigureScreen.test.tsx`.
- **Behaviour change & risks:** Entries say which set they belong to. Low risk.
- **Depends on / conflicts with:** UI-04 and UI-09 (same functions, same commit).
- **Effort:** S.
- **Needs a user decision?** No.

### UI-09 [Medium] "Undo" of a weight cannot always restore the rest of the pillar
- **Still present at HEAD?** Yes. Only the scalar `was` is kept, and one PATCH reverses it (`useCriteriaEditor.ts:98, 118-124`). When every absorbing sibling sits at zero, the backend splits the remainder evenly (`backend/src/starnest/criteria/rebalancing.py:68-76`): [50,20,30] → [100,0,0] → undo → [50,25,25].
- **Root cause:** The forward move destroys the siblings' proportions, and no operation can put a pillar's weights back as a whole.
- **Fix** (option a):
  1. Pure `undoCanRestore(before, after, moved)` in `changeHistory.ts`, using comparisons only: false when the response left every unlocked sibling at 0 while at least one had weight before.
  2. `useCriteriaEditor.ts` records a `caveat` on such entries.
  3. `RecentChanges.tsx` shows the caveat on the entry, and beside "Back to where I started" when it would undo one. Undo still re-sends the real request.
- **Tests first:**
  - `changeHistory.test.ts`, "says when an undo cannot put the others back". Fails today (the function doesn't exist).
  - `ConfigureScreen.test.tsx` with an overridden 3-sibling set and a stateful PATCH mock: "warns before undoing a change that left the rest of its pillar at zero". Fails today.
  - Follow-ups: an ordinary proportional move gets no caveat; a locked sibling is ignored; after the undo the screen shows the server's 25/25 (no local restore).
- **Migration / contract / docs:** None for option a. Option c changes `docs/openapi.yaml`.
- **Files touched:** `ui/src/routes/configure/changeHistory.ts`(+test), `ui/src/routes/configure/useChangeHistory.ts`, `ui/src/routes/configure/useCriteriaEditor.ts`, `ui/src/routes/configure/RecentChanges.tsx`, `ui/src/routes/configure/ConfigureScreen.test.tsx`.
- **Behaviour change & risks:** In that one case, undo is honest rather than exact.
- **Depends on / conflicts with:** UI-04 and UI-08.
- **Effort:** S for option a; M for b; M–L for c.
- **Needs a user decision?** Yes, which undo do you want?
  - (a) **Recommended now:** state the limit honestly, as above.
  - (b) Exact restore from the client: re-send each sibling's old weight with temporary locks. No contract change, but about 3 extra writes per sibling, and a partial failure can leave a lock on.
  - (c) Exact restore through a new "set this pillar's weights" operation: `openapi.yaml`, backend and UI.

### UI-06 [Medium] A save that finishes overwrites what was typed meanwhile
- **Still present at HEAD?** Yes.
  - `household/useHouseholdForm.ts:42-51` and `settings/useSettingsForm.ts:30-39` replace the draft with the response. Neither has a saving flag, and their submit buttons stay enabled (`HouseholdPanel.tsx:170`, the Save button in `SettingsPanel.tsx`).
  - `routes/run/useManualEntry.ts:58-69` clears the draft on success while the inputs stay live.
  - `criteria/useCriterionRule.ts:61-69` resets the draft when its save ends, and its fieldsets (`CriterionRuleFields.tsx:94, 133, 212`) stay editable.
- **Root cause:** Save completion ignores edits made after submitting, and the whole-record forms allow overlapping submits.
- **Fix:**
  1. Household, settings and manual-entry hooks: a revision ref bumped by `change`. `send` captures it; on success the form adopts or clears the response and shows "Saved." only if nothing was typed since. Otherwise the newer draft is kept.
  2. Household and settings: a `saving` flag plus in-flight ref; the submit button is disabled and reads "Saving…" during a save.
  3. Rule editor: `disabled={saving}` on its three fieldsets. Its draft is designed to follow the stored rule, so typing during a save is prevented rather than merged.
- **Tests first:**
  - `household/HouseholdPanel.test.tsx`, "keeps what was typed while the save was in flight": held PUT, type max rent after pressing Save; after release the field keeps the newer value and no "Saved." shows. Fails today.
  - Same file, "sends one save at a time" (two clicks, one PUT). Fails today.
  - The same pair in `settings/SettingsPanel.test.tsx`.
  - New `routes/run/ManualEntryPanel.test.tsx`, "does not clear a figure typed while the last one was being stored". Fails today.
  - `CriterionRuleFields.test.tsx`, "holds the rule's fields still while it is being saved". Fails today.
  - Follow-ups: a refusal keeps the draft; a save with nothing typed afterwards still adopts the response.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/household/useHouseholdForm.ts`, `.../household/HouseholdPanel.tsx`(+test), `.../settings/useSettingsForm.ts`, `.../settings/SettingsPanel.tsx`(+test), `.../criteria/CriterionRuleFields.tsx`(+test), `ui/src/routes/run/useManualEntry.ts`, `ui/src/routes/run/ManualEntryPanel.test.tsx` (new).
- **Behaviour change & risks:** No typing is lost, and only one save runs at a time. `routes/run/` is the Run-screen agent's area. Whoever does UI-11 may also edit `useHouseholdForm.ts` to notify the sidebar.
- **Depends on / conflicts with:** UI-10 (same hooks, same commit); UI-11.
- **Effort:** M.
- **Needs a user decision?** No.

### UI-10 [Medium] A lone "." is sent as null and clears a setting
- **Still present at HEAD?** Yes.
  - `routes/configure/numericInput.ts:27-33` keeps a lone point.
  - `settings/settingsForm.ts:154-156` turns it into `Number(".")`, which is NaN.
  - `JSON.stringify` (`api/client.ts:244, 269, 350`) sends NaN as `null`.
  - The household has the same path (`household/householdForm.ts:66-67, 106-108`): max rent "." clears it.
- **Root cause:** Parsing tells only blank from non-blank, and the serializer silently turns a non-finite number into null, which means "unset".
- **Fix:**
  1. `numericInput.ts`: `readTypedNumber(text)` returns blank, a finite number, or invalid. Invalid covers "." and digit strings too long to be finite.
  2. `settingsForm.ts`: `invalidSettings(draft)`; `useSettingsForm.ts` refuses to send while any field is invalid; `SettingsPanel.tsx` shows a message per field (`aria-invalid`).
  3. The same for `householdForm.ts`, `useHouseholdForm.ts` and `HouseholdPanel.tsx`.
  4. `api/client.ts`: one `serialise(body)` used by post, patch and put, which throws `ApiError({code:"client.unsendable_number"})` on a non-finite number, so nothing is ever sent as an accidental null. Add the code to `api/ApiError.ts` and its sentence to `api/errorPresentation.ts`.
- **Tests first:**
  - `settings/settingsForm.test.ts`, "calls a lone decimal point invalid rather than unset". Fails today (no such function).
  - `settings/SettingsPanel.test.tsx`, "refuses to save a coverage floor of '.', and says which field". Fails today (a PUT with null goes out).
  - `api/client.test.ts`, "refuses to send NaN rather than sending null" (fetch not called). Fails today.
  - Follow-ups: an over-long digit string is invalid; blank still means null; a comma still becomes a point; household max rent "." is refused.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/numericInput.ts`(+test), `.../settings/settingsForm.ts`(+test), `.../settings/useSettingsForm.ts`, `.../settings/SettingsPanel.tsx`(+test), `.../household/householdForm.ts`(+test), `.../household/useHouseholdForm.ts`, `.../household/HouseholdPanel.tsx`(+test), **`ui/src/api/client.ts`(+test), `ui/src/api/ApiError.ts`, `ui/src/api/errorPresentation.ts`(+test) (shared)**.
- **Behaviour change & risks:** Invalid input is refused, field by field. The `client.ts` guard affects every screen but only refuses bodies that were already wrong.
- **Depends on / conflicts with:** UI-06 (same commit); the `api/` files are shared with other agents.
- **Effort:** M.
- **Needs a user decision?** No.

### UI-07 [Medium] Source reorders can interleave, and a half-failed one leaves the wrong order on screen
- **Still present at HEAD?** Yes.
  - `sources/DataSourcesPanel.tsx:33` computes `anySaving`, but only drag uses it; switches and arrows use the per-row `busy` (:66, 126, 149, 161).
  - `sources/useDataSources.ts:31-48` sends the PATCHes one after another and reloads only on success (:40). The catch (:41-43) keeps the stale list.
- **Root cause:** Only the active row is locked, and a failure skips the re-read even after earlier PATCHes have been stored.
- **Fix:**
  1. `DataSourcesPanel.tsx`: disable every switch and arrow while `anySaving`.
  2. `useDataSources.ts`: an in-flight ref that refuses a second `change`, and `reload()` moved into `finally`, so a partial failure shows the stored order while the error stays visible.
- **Tests first:**
  - `sources/DataSourcesPanel.test.tsx`, "keeps every other row still while a move is being written". Fails today.
  - Same file, "re-reads the order after a move that failed half way": first PATCH succeeds, second returns 500; expect the error and a second GET, with the stored order shown. Fails today.
  - Follow-ups: a failure on the first PATCH; controls come back afterwards.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/sources/useDataSources.ts`, `ui/src/routes/configure/sources/DataSourcesPanel.tsx`(+test).
- **Behaviour change & risks:** All source controls are briefly disabled during a reorder, and the list briefly shows "Loading…" after a failure too. Low risk.
- **Depends on / conflicts with:** None.
- **Effort:** S.
- **Needs a user decision?** No.

### UI-12 [Medium] Rule explanations count proposals as exclusions and say compound rules affect nobody
- **Still present at HEAD?** Yes.
  - `rules/ruleEffect.ts:30-47` never reads `is_proposal`, and it is fed the raw list (`rules/useRuleToggles.ts:50-56, 106-107`).
  - That list is `[]` while loading, so a gate briefly reads "never fires".
  - Compound rules get `effect: null` (`rules/RulesPanel.tsx:111`), rendered as "Applies to no candidate right now." (:189).
- **Root cause:** The sentence re-derives eligibility without the human-confirmation rule, and invents "nobody" where it has no data.
- **Fix:**
  1. `ruleEffect.ts`: only confirmed `not_matching` answers count as removals. Proposals are mentioned separately ("1 proposed answer awaits confirmation and rules nobody out until then"). The wording keeps "Removes " and "rules nobody out" so the e2e regex at `ui/e2e/sanity.spec.ts:378-395` still matches.
  2. `useRuleToggles.ts`: read the shared `useGateAnswers` (from UI-01), passed down by `ConfigureScreen` through `RulesPanel`, so confirming or answering updates the sentence. Show "Reading the answers…" while loading.
     - *As built (2026-10-25, PL-182):* no shared hook. `useRuleToggles.ts` reads the answers itself and reads them again when `ConfigureScreen`'s `answersFreshness` moves, which `RulesPanel` passes in; "Reading the answers…" is shown while they load. The cost lines' other inputs (the live ranking, the household's citizenships, the roster) come from `rules/useGateEvidence.ts`.
  3. `RulesPanel.tsx`, compound rows: "Applied. Who it flags right now is shown on Rank." or "Not applied, so it flags nobody." Drop the null fallback.
- **Tests first:**
  - `rules/ruleEffect.test.ts`, "does not count a proposal as removing anyone". Fails today.
  - `rules/RulesPanel.test.tsx`, "does not say a proposed answer removes a candidate" (the fixture's Portugal proposal reads "Removes country.portugal." today). Fails today.
  - Same file, "never says a compound rule applies to nobody". Fails today.
  - Follow-ups: confirmed and proposed answers mixed; the loading state; the sentence updates after a confirmation without a page reload.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/rules/ruleEffect.ts`(+test), `.../rules/RulesPanel.tsx`(+test), `.../rules/useRuleToggles.ts`, `ui/src/routes/configure/ConfigureScreen.tsx`, `ui/src/routes/configure/useGateAnswers.ts`.
  - *As built (2026-10-25, PL-182):* the last file was never created; `ui/src/routes/configure/rules/useGateEvidence.ts` was added instead, for the cost lines' ranking, citizenships and roster (PL-156, PL-164).
- **Behaviour change & risks:** The rule rows stop claiming exclusions that are not happening. The e2e regex compatibility needs to be flagged to the e2e agent.
- **Depends on / conflicts with:** UI-01 (`useGateAnswers`); UI-29 and BE-36 (same commit).
  - *As built (2026-10-25, PL-182):* the dependency on UI-01 is on `ConfigureScreen`'s `answersFreshness` signal, not on a shared `useGateAnswers`.
- **Effort:** S–M.
- **Needs a user decision?** Yes, what should compound rows say?
  - (a) **Recommended:** honest pointer to Rank (S).
  - (b) Read `GET /rankings` warnings and non-match reasons for the selected set and list who each applied rule flags (M). Configure would then depend on a ranking, which is refused while the score scale is unset.

### UI-27 [Medium] A failed candidate list leaves required pickers empty with no explanation
- **Still present at HEAD?** Yes.
  - `api/useCandidateNames.ts:76-82` returns `NOBODY` for loading and error alike.
  - `household/HouseholdPanel.tsx:71-74` builds the pickers from it and shows no notice.
  - `routes/run/ManualEntryPanel.tsx:36-41, 80-88` lists options only when ready; it shows only write errors (:167), never the read error.
- **Root cause:** The roster hook hides status and error, and manual entry ignores its own resource's error.
- **Fix:**
  1. `api/useCandidateNames.ts`: export `useCandidateRosterState()` returning `{roster, status, error, reload}` from the same shared promise (it already resets on failure). Re-export it from `api/useCandidateRoster.ts`. Labels keep using the silent `useCandidateNames`.
  2. `HouseholdPanel.tsx`: in the Household stage, an ErrorNotice with Try again that says the home country and citizenship can't be chosen, plus a loading note.
  3. `ManualEntryPanel.tsx`: the same, using its own `candidates.reload`.
- **Tests first:**
  - `household/HouseholdPanel.test.tsx`, "says the list of places could not be read, and reads it again when asked" (one 500, then Try again fills the options). Fails today.
  - New `routes/run/ManualEntryPanel.test.tsx`, same scenario. Fails today.
  - `api/useCandidateNames.test.ts`: the state exposes the error and recovers on reload.
  - Follow-ups: names still fall back silently; Try again appears only for retryable codes (the existing ErrorNotice rule).
- **Migration / contract / docs:** None.
- **Files touched:** **`ui/src/api/useCandidateNames.ts`(+test), `ui/src/api/useCandidateRoster.ts` (shared)**, `ui/src/routes/configure/household/HouseholdPanel.tsx`(+test), **`ui/src/routes/run/ManualEntryPanel.tsx`** (Run-screen area), `ui/src/routes/run/ManualEntryPanel.test.tsx` (new).
- **Behaviour change & risks:** A failed list is explained and can be retried. Low risk.
- **Depends on / conflicts with:** UI-29 uses the new hook. Run-screen agent (manual entry).
- **Effort:** S.
- **Needs a user decision?** No.

### UI-29 [Medium] No way to answer, disagree with, or correct a gate by hand
- **Still present at HEAD?** Yes.
  - `putMatchRuleResult` has exactly one caller, `useProposals.ts:93-104`, which re-sends the proposal unchanged.
  - The proposals panel offers only Confirm, and `RulesPanel` only toggles enforcement.
  - The API already supports the rest (`backend/src/starnest/api/rules.py:353-405`, `docs/openapi.yaml:639-660`).
- **Root cause:** The UI exposes only the confirm path.
- **Fix:**
  1. New pure module `routes/configure/answers/gateAnswerForm.ts`: turns the draft into a `MatchRuleResultInput` with `data_source: "manual"`. Problems it reports: gate, candidate and answer are required; the period needs both dates or neither; each page must be an http(s) URL (via `safeHttpUrl`). Date order is left to the server (BE-21).
  2. New `answers/useGateAnswerForm.ts`:
     - `load(answer)` prefills the form, including period, pages and override, because the PUT replaces them.
     - Submit PUTs the answer, then `answers.reload()`.
     - Uses UI-06's revision rule.
  3. New `answers/GateAnswersPanel.tsx`:
     - Fields: gate (names from `fetchMatchRules(level)`), candidate (names from `useCandidateRosterState`), answer, reason, holds from/until, override reason, pages.
     - "Change" on each recorded answer (the BE-36 list) and "Answer differently" on each proposal row (`ProposalsPanel.tsx`) prefill it.
     - Disabled while a research pass runs.
     - Renders names only, so the page's identifier guard test stays green.
  4. `ConfigureScreen.tsx`: render it inside the Rules stage, before the proposals; all three panels share `useGateAnswers`.
  5. `mocks/handlers.ts`: the PUT mock keeps period, pages and override and stamps `override_date`, as the server does.
- **Tests first:**
  - New `answers/GateAnswersPanel.test.tsx`, "records a gate answer nobody proposed" (asserts the PUT body and the row it produces). Fails today (no form).
  - Same file, "answers a proposal differently". Fails today.
  - Same file, "corrects a recorded answer, keeping its pages and period unless they are changed". Fails today.
  - Follow-ups:
    - a 404 or 422 is shown;
    - one date only means nothing is sent;
    - a `javascript:` page is refused;
    - an override reason is sent and its date shown;
    - the form is disabled during a pass.
  - New `answers/gateAnswerForm.test.ts` for the pure parsing.
- **Migration / contract / docs:** No contract change. `docs/design-brief.md`: the form has no design.
- **Files touched:** `ui/src/routes/configure/answers/GateAnswersPanel.tsx`(+test), `.../answers/useGateAnswerForm.ts`, `.../answers/gateAnswerForm.ts`(+test) (all new), `ui/src/routes/configure/ConfigureScreen.tsx`, `ui/src/routes/configure/proposals/ProposalsPanel.tsx`, **`ui/src/mocks/handlers.ts` (shared)**, `docs/design-brief.md`.
- **Behaviour change & risks:** A manual `not_matching` answer on an enforced gate takes the candidate out of matching immediately; that is intended (Q152). Saving replaces the answer and its pages; the prefill prevents accidental loss.
- **Depends on / conflicts with:** UI-27 (roster state), UI-01 (`useGateAnswers`), UI-12 and BE-36 (same commit), BE-21 (an inverted period returns 500 today).
- **Effort:** L.
- **Needs a user decision?** No.

### BE-36 [Medium] (stage 1) Confirmed gate answers are not shown with their period and age
- **Still present at HEAD?** Yes for the UI.
  - `useProposals.ts:71-73` keeps only a count of confirmed answers, and `ProposalsPanel.tsx:118-124` prints it only when no proposal is waiting.
  - The backend already matches your policy and stays as it is:
    - `backend/src/starnest/evaluation/rules.py:182-186` keeps applying a confirmed `not_matching` answer whatever its period, so answers never auto-expire.
    - `research.py:198-208` never re-asks a confirmed pair, so research never overwrites one (apart from the race in (c)2).
  - **The API already returns what stage 1 needs:**
    - `MatchRuleResultBody` (`api/rules.py:72-83`) and `_result_body` (:408-426) serialise `reference_period`, `retrieval_date`, `override_reason`, `override_date`, `citations` and `is_proposal`.
    - The query selects them (`storage/queries/criteria.sql:601-629`), and the store maps them (`storage/match_rule_result_store.py:41-63`).
    - The contract (`docs/openapi.yaml:1484-1528`) and the generated type (`api/schema.ts:1081-1107`) carry them.
    - One caveat: a confirmed answer's `retrieval_date` is when it was written (the server defaults to now, `api/rules.py:390`), so its "age" means "since a person last recorded it".
- **Root cause:** Confirmed answers are treated as background (a count), so the period and date the API returns never reach the screen.
- **Fix:**
  1. New pure module `routes/configure/gateAnswerReading.ts`, with `now` injected:
     - `describePeriod`: "Holds for 1 Jan 2026 to 31 Dec 2026" or "No period recorded".
     - `periodHasEnded`.
     - `describeChecked`: date plus relative age via `Intl.RelativeTimeFormat` — presentation only.
     - `inReadingOrder`: ended periods first, then by gate and candidate.
  2. `answers/GateAnswersPanel.tsx` gets a "Recorded gate answers" table:
     - Columns: gate name, candidate name, answer, holds for, checked + age, override reason and date, reason and pages, and Change (UI-29).
     - A row whose period has ended carries: "Its period ended on 31 Dec 2025. It is still applied until you change it."
  3. `ProposalsPanel.tsx`: drop the count sentence.
- **Tests first:**
  - New `gateAnswerReading.test.ts`: period, no period, ended, and age phrases at a fixed date. Fails today (no module).
  - New `answers/GateAnswersPanel.test.tsx`, "lists each recorded answer with the period it holds for and when it was checked". Fails today.
  - Same file, "marks an answer whose period has ended and says it still applies". Fails today.
  - Update "leaves confirmed answers out of the list and counts them instead" in `ProposalsPanel.test.tsx`.
  - Follow-ups: no period; proposals are not listed as recorded; override shown; empty state.
- **Migration / contract / docs:** None. `docs/reqs.md` Appendix B: record the 2026-10-12 policy. `docs/design-brief.md`: the table has no design.
- **Stage 2 will need (not planned here):**
  - A place for a proposal next to a confirmed answer. Today there is one row per gate × candidate, written with an unconditional upsert (`criteria.sql:631-653`), and `is_proposal` is derived from the source kind (`criteria.sql:611-616`), so a re-research would replace the human answer. This needs a new table or columns, with a migration and rollback.
  - An explicit "re-check these confirmed pairs" request. `gates_to_ask` and the plan skip confirmed pairs today, so this is an `openapi.yaml` change (your decision).
  - GET returning the pending proposal beside the confirmed answer, plus "keep mine" and "take the proposal" operations.
  - A "Re-check" action per recorded answer in the UI, reusing the batched pass.
  - A policy on household citizenship changes: answers don't record which citizenships they assumed.
- **Files touched:** `ui/src/routes/configure/gateAnswerReading.ts`(+test, new), `ui/src/routes/configure/answers/GateAnswersPanel.tsx`(+test), `ui/src/routes/configure/proposals/useProposals.ts`, `ui/src/routes/configure/proposals/ProposalsPanel.tsx`(+test), `docs/reqs.md`, `docs/design-brief.md`.
- **Behaviour change & risks:** Every confirmed answer becomes visible, up to 160 rows at country level. The age is computed from the server's date against the browser clock.
- **Depends on / conflicts with:** UI-29 and UI-12 (same commit), UI-01 (`useGateAnswers`), UI-13 (reuses `describePeriod`).
- **Effort:** M.
- **Needs a user decision?** No (your policy covers it).

### UI-13 [Low] Confirming a proposal drops its period, and the row never shows it
- **Still present at HEAD?** Yes, though it can't trigger yet. `useProposals.ts:95-103` sends no `reference_period`, so the PUT stores null (`api/rules.py:392-396`). `ProposalRow` (`ProposalsPanel.tsx:159-205`) shows no period. Research sets no period today (`research.py:150-160`, P58).
- **Root cause:** The confirm body copies only answer, reason and pages.
- **Fix:**
  1. Confirm sends `reference_period: proposal.reference_period ?? null`, explicitly.
  2. The row shows `describePeriod` from `gateAnswerReading.ts`.
  3. The retrieval date follows the decision below, stated in a code comment.
- **Tests first:**
  - `ProposalsPanel.test.tsx`, "keeps the period a proposal holds for when it is confirmed". Fails today.
  - Same file, "shows the period beside the proposal". Fails today.
  - Follow-up: no period sends null and reads "No period recorded".
- **Migration / contract / docs:** None. `docs/known-issues.md` P58 closed.
- **Files touched:** `ui/src/routes/configure/proposals/useProposals.ts`, `ui/src/routes/configure/proposals/ProposalsPanel.tsx`(+test), `docs/known-issues.md`.
- **Behaviour change & risks:** None visible until research starts recording periods.
- **Depends on / conflicts with:** BE-36 (`gateAnswerReading.ts`), UI-29 (mock PUT keeps the period).
- **Effort:** S.
- **Needs a user decision?** Yes, what retrieval date should a confirmed answer carry?
  - (a) **Recommended:** the moment of confirmation, as today. Confirming means a person checked the pages, so the age starts then.
  - (b) The proposal's own retrieval date, so the age reflects when the model read the pages.

### UI-26 [Low] Tabbing into the household picker's options makes them vanish
- **Still present at HEAD?** Yes. `household/CandidateField.tsx:94-101` closes the list 120 ms after the input loses focus. The options are tab stops (:121-134), and only `onMouseDown` cancels the close.
- **Root cause:** Options are tab stops, but any blur of the input is treated as leaving the picker.
- **Fix:** the standard ARIA combobox pattern.
  1. Options get `tabIndex={-1}`, so Tab leaves the picker and closes it.
  2. ArrowUp/ArrowDown move an active option (`aria-activedescendant`, `data-active`, scrolled into view where supported). Enter chooses it, or the single match as today. Escape clears it, and typing resets it. An index helper goes in `household/candidateOptions.ts`.
  3. `styles.css`: append `.combo__option[data-active="true"]` after the `.combo__option` base, using existing tokens only.
- **Tests first:**
  - `household/CandidateField.test.tsx`, "leaves the picker on Tab rather than landing on an option that then vanishes". Fails today.
  - Same file, "moves through the options with the arrow keys and chooses with Enter" (ambiguous filter, ↓↓, Enter, expect the second id). Fails today.
  - Follow-ups: ↑ at the top; Escape; typing resets the active option; clicking still works; citizenship can be added by keyboard.
  - The existing "goes back to what is stored when it loses focus" stays green.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/household/CandidateField.tsx`(+test), `ui/src/routes/configure/household/candidateOptions.ts`(+test), **`ui/src/styles.css` (append)**.
- **Behaviour change & risks:** Keyboard users use the arrow keys instead of Tab inside the list. The alternative — keep options tabbable and close only when focus leaves the whole picker — is S effort but forces up to 32 tab stops.
- **Depends on / conflicts with:** None.
- **Effort:** M.
- **Needs a user decision?** No.

### UI-28 [Low] Deleting every set leaves the deleted one selected
- **Still present at HEAD?** Yes. `shell/SelectionContext.tsx:94` returns early on any empty list, loading or not.
- **Root cause:** A successfully empty list is treated the same as "still loading".
- **Fix:** in `SelectionContext.tsx`, return early only while the criteria-set resource is not ready. When the list is ready, even if empty, record it; if the selected set was in the previous list and is now gone, select `available[0] ?? null`. A just-created set is still kept, because only "was there and is gone" clears a selection.
- **Tests first:**
  - `sets/CriteriaSetsPanel.test.tsx`, "leaves nothing selected when the last sets are gone" (make the list read empty, delete Default; expect "Choose a criteria set…" and no further GET for `default`). Fails today.
  - Follow-ups: creating a set from an empty list selects it; a reload in flight keeps the selection (existing P44 tests).
- **Migration / contract / docs:** None.
- **Files touched:** **`ui/src/shell/SelectionContext.tsx` (shared shell)**, `ui/src/routes/configure/sets/CriteriaSetsPanel.test.tsx`.
- **Behaviour change & risks:** Low risk.
- **Depends on / conflicts with:** UI-11 (another agent) may edit `SelectionContext`.
- **Effort:** S.
- **Needs a user decision?** No.

### UI-31 [Low] Settings says an unset comparator limit allows unlimited comparisons
- **Still present at HEAD?** Yes. `settings/settingsForm.ts:79` says the opposite of what happens: the backend refuses with 409 `comparator_limit_not_set` (`backend/src/starnest/api/comparisons.py:97-109`), and Compare says so correctly (`compare/CompareScreen.tsx:219-220`).
- **Root cause:** Wrong guidance text.
- **Fix:** the consequence becomes "Compare refuses every comparison until this is set." Severity stays advisory: Rank still works, and the blocking alert is specific to the score scale.
- **Tests first:**
  - `settings/settingsForm.test.ts`, "says an unset comparator limit stops every comparison". Fails today.
  - `settings/SettingsPanel.test.tsx`: clearing the box shows the new sentence.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/configure/settings/settingsForm.ts`(+test), `ui/src/routes/configure/settings/SettingsPanel.test.tsx`. **`ui/e2e/sanity.spec.ts:290-294`** asserts the old text and must be updated by the e2e agent.
- **Behaviour change & risks:** Text only.
- **Depends on / conflicts with:** e2e agent.
- **Effort:** S.
- **Needs a user decision?** No.

---

**(a) Proposed commits, in priority order**
1. **High** — `fix(ui): gate research asks one question per request, stops at the spend cap and shows what it spent (UI-01, UI-14)`. Files: `api/endpoints.ts`, `routes/configure/useGateAnswers.ts`, `routes/configure/ConfigureScreen.tsx`, `proposals/researchPass.ts`(+test), `proposals/useResearchPass.ts`, `proposals/useProposals.ts`, `proposals/ProposalsPanel.tsx`(+test), `ui/nginx.conf`, `docs/reqs.md`, `docs/known-issues.md`, `docs/design-brief.md`.
2. **Medium** — `fix(ui): weight saves wait for each other, stay in their own set, and undo says when it cannot restore (UI-04, UI-05, UI-08, UI-09)`. Files: `useCriteriaEditor.ts`, `changeHistory.ts`(+test), `useChangeHistory.ts`, `RecentChanges.tsx`, `ConfigureScreen.tsx`(+test), `criteria/CriteriaPanel.tsx`(+test), `criteria/CriterionRuleFields.tsx`, `pillars/PillarWeightsPanel.tsx`(+test).
3. **Medium** — `fix(ui): forms keep what was typed during a save and refuse numbers they cannot send (UI-06, UI-10)`. Files: `numericInput.ts`, `settings/*`, `household/householdForm.ts`, `household/useHouseholdForm.ts`, `household/HouseholdPanel.tsx`, `criteria/CriterionRuleFields.tsx`, `run/useManualEntry.ts`, `run/ManualEntryPanel.test.tsx`, `api/client.ts`, `api/ApiError.ts`, `api/errorPresentation.ts`, with their tests.
4. **Medium** — `fix(ui): one source reorder at a time, and the order is re-read after a partial failure (UI-07)`. Files: `sources/useDataSources.ts`, `sources/DataSourcesPanel.tsx`(+test).
5. **Medium** — `fix(ui): a candidate list that fails to load says so and can be read again (UI-27)`. Files: `api/useCandidateNames.ts`(+test), `api/useCandidateRoster.ts`, `household/HouseholdPanel.tsx`(+test), `run/ManualEntryPanel.tsx`, `run/ManualEntryPanel.test.tsx`.
6. **Medium** — `fix(ui): gate answers can be entered, corrected and read with their period and age; rule effects count only confirmed answers (UI-12, UI-29, BE-36)`. Files: `rules/*`, `answers/*` (new), `gateAnswerReading.ts`(+test), `ConfigureScreen.tsx`, `proposals/ProposalsPanel.tsx`(+test), `proposals/useProposals.ts`, `mocks/handlers.ts`, `docs/reqs.md`, `docs/design-brief.md`.
7. **Low** — `fix(ui): confirming a proposal keeps and shows its period (UI-13)`. Files: `proposals/useProposals.ts`, `proposals/ProposalsPanel.tsx`(+test), `docs/known-issues.md`.
8. **Low** — `fix(ui): the household picker works by keyboard, an emptied set list clears the selection, and the comparator guidance is true (UI-26, UI-28, UI-31)`. Files: `household/CandidateField.tsx`, `household/candidateOptions.ts`, `styles.css`, `shell/SelectionContext.tsx`, `sets/CriteriaSetsPanel.test.tsx`, `settings/settingsForm.ts`, `settings/SettingsPanel.test.tsx`, with their tests.

Order constraints: 1 before 6 (`useGateAnswers`); 5 before 6 (roster state); 6 before 7 (`gateAnswerReading.ts`).

**(b) Every file these plans touch, with the IDs touching it** (shared or other-area files in bold)
- **`ui/src/api/endpoints.ts`** — UI-01
- **`ui/src/api/client.ts`**, **`ApiError.ts`**, **`errorPresentation.ts`** (+`client.test.ts`, `errorPresentation.test.ts`) — UI-10
- **`ui/src/api/useCandidateNames.ts`** (+test), **`useCandidateRoster.ts`** — UI-27
- **`ui/src/shell/SelectionContext.tsx`** — UI-28 (UI-11 may also touch it)
- **`ui/src/mocks/handlers.ts`** — UI-29; UI-13 and BE-36 tests rely on it
- **`ui/src/styles.css`** (append only) — UI-26
- **`ui/src/routes/run/useManualEntry.ts`** — UI-06; **`run/ManualEntryPanel.tsx`** — UI-27; **`run/ManualEntryPanel.test.tsx`** (new) — UI-06, UI-27
- **`ui/e2e/sanity.spec.ts`** — UI-31 (text), UI-12 (regex compatibility); e2e agent
- `ui/nginx.conf` (comment), `ui/src/app/architecture.test.ts` (kept) — UI-01
- `routes/configure/ConfigureScreen.tsx` — UI-01, UI-04, UI-12, UI-29, BE-36; its test — UI-04, UI-08, UI-09
- `routes/configure/useGateAnswers.ts` (new) — UI-01, UI-12, UI-29
- `routes/configure/gateAnswerReading.ts` (+test, new) — BE-36, UI-13
- `routes/configure/useCriteriaEditor.ts` — UI-04, UI-08, UI-09
- `routes/configure/changeHistory.ts` (+test), `useChangeHistory.ts` — UI-09
- `routes/configure/RecentChanges.tsx` — UI-04, UI-09
- `routes/configure/numericInput.ts` (+test) — UI-10
- `criteria/CriteriaPanel.tsx` (+test) — UI-04, UI-05
- `criteria/CriterionRuleFields.tsx` (+test) — UI-04, UI-06
- `pillars/PillarWeightsPanel.tsx` (+test) — UI-04, UI-05
- `household/useHouseholdForm.ts` — UI-06, UI-10 (UI-11 may also touch it)
- `household/householdForm.ts` (+test) — UI-10
- `household/HouseholdPanel.tsx` (+test) — UI-06, UI-10, UI-27
- `household/CandidateField.tsx` (+test), `household/candidateOptions.ts` (+test) — UI-26
- `settings/settingsForm.ts` (+test) — UI-10, UI-31
- `settings/useSettingsForm.ts` — UI-06, UI-10
- `settings/SettingsPanel.tsx` — UI-06, UI-10; its test — UI-06, UI-10, UI-31
- `sources/useDataSources.ts`, `sources/DataSourcesPanel.tsx` (+test) — UI-07
- `rules/ruleEffect.ts` (+test), `rules/RulesPanel.tsx` (+test), `rules/useRuleToggles.ts` — UI-12
- `proposals/useProposals.ts` — UI-01, UI-13, UI-14, BE-36
- `proposals/ProposalsPanel.tsx` (+test) — UI-01, UI-13, UI-14, UI-29, BE-36
- `proposals/researchPass.ts` (+test), `proposals/useResearchPass.ts` (new) — UI-01, UI-14
- `answers/GateAnswersPanel.tsx` (+test), `answers/useGateAnswerForm.ts`, `answers/gateAnswerForm.ts` (+test) (all new) — UI-29, BE-36
- `sets/CriteriaSetsPanel.test.tsx` — UI-28
- **`docs/reqs.md`** — UI-01, BE-36; **`docs/known-issues.md`** — UI-01, UI-13; **`docs/design-brief.md`** — UI-01, UI-14, UI-29, BE-36
- No `docs/openapi.yaml` change, unless you choose UI-09 option (c) or start BE-36 stage 2.

**(c) Real defects next to these findings that are not in the review**
1. **Research asks a model about gates it can't answer, for countries they don't concern.** `_research_targets` takes every gate (`backend/src/starnest/api/rules.py:95-125`), and `gates_to_ask` filters only by level and confirmation (`research.py:182-208`). So the model is asked about `not_manually_excluded` — a household choice, listed as source "Manual" in `reqs.md` 7.3 — and about the definitional `eu_free_movement`, for every country. The UK, Swiss and Liechtenstein gates are also asked for all 32 countries. The estimate prices all 160 calls, and `test_research.py:128` locks this in. Backend.
2. **A research proposal can overwrite a human answer written while that request runs.** The request reads existing answers once at its start (`api/rules.py:341`), and proposals are written with an unconditional upsert (`research.py:164` → `storage/queries/criteria.sql:631-653`). This breaks the "never silently overwritten" policy. UI-01's batching narrows the window to one call and the page blocks its own writes during a pass; a conditional upsert (never replace a non-LLM answer with an LLM one) would close it. Storage/backend.
3. **The research estimate ignores the `llm` switch.** `planMatchRuleResearch` checks only `researcher is None` (`api/rules.py:272`), so the panel prices a pass that the research endpoint then refuses with 501. BE-15 fixed only the pass.
4. **The Anthropic client runs on SDK defaults** (600 s timeout, 2 retries; `backend/src/starnest/main.py:453`), so one research call can outlast nginx's 300 s research ceiling. Its timeout should sit below the proxy's. Backend.
5. **A refused pillar weight leaves the slider thumb at the refused position**, and the next blur sends it again; criterion rows already reset after a save (`CriteriaPanel.tsx:276-282`). Folded into UI-05.
6. **The Rules panel says "No answer has been recorded… never fires" while answers are still loading**, and it doesn't refresh after a confirmation, because it reads answers separately (`useRuleToggles.ts:50-56` vs `useProposals.ts:47-51`). Folded into UI-12.
7. **Two msw mocks disagree with the server.**
   - `PUT /match-rule-results` drops period, pages and override (`ui/src/mocks/handlers.ts:319-343`); fixed in commit 6.
   - `/comparisons` refuses an unset limit as `invalid_comparison` (`handlers.ts:583`), where the backend answers `comparator_limit_not_set`.
8. **Rule effect sentences print candidate ids** ("Removes country.portugal."): `RulesPanel` never passes the `nameOf` option that `describeEffect` already supports.
