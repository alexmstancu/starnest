# UI functional review against the design

**Date:** 2026-10-23. **Baseline commit:** `34409c5` (`master`).

This report merges six read-only reviews of the code against the design and two passes in a real browser into one list. It is the single place to read what the interface does differently from its specification. Every finding keeps the ids of the reviews it came from, and the appendix maps each of those ids to exactly one finding here.

## Contents

1. What was checked and how
2. Summary
3. Findings by tab: Shell and global states; Configure; Acquire; Rank; Compare
4. Recorded divergences (not defects)
5. Not tested, and why
6. Appendix: every original id and where it went

## 1. What was checked and how

**The specification.** The design handoff in `docs/design/` (`README.md`, `UX-REVIEW.md`, `DECISIONS.md`, the live design file `Starnest Product.dc.html` and the captures in `screens/`), together with `docs/design-brief.md` (the code's return channel to the design) and `docs/reqs.md` (requirements and ontology). Where a capture and the README disagree, the live `.dc.html` wins, as the README says.

**Six read-only reviews.** Each took one area (the shell and global states, Configure in two halves, Acquire, Rank, Compare), listed every control, state and behaviour the specification asks for (387 items in all), and compared each with the code at `34409c5`. They ran nothing and changed nothing, and produced 197 findings: SH-, CA-, CB-, AQ-, RK- and CP-.

**A hands-on test in a real browser.** Headless Chromium at 1560×1000 drove the interface on a throwaway copy of the user's data (database `starnest_e2e`, through a local server on port 5180). The live database was never touched, every other host was blocked, and the backend had no AI key, so nothing could spend money. Only small, free acquisitions were started. That pass found HO-01 to HO-50.

**A second browser pass** took the 151 browser checks the reviews had written and confirmed 150 of them: every one of the 150 static findings it covered. The 151st, an unrated check of the Compare matrix's column alignment, was not reproduced. 39 confirmations (marked †) needed the browser to simulate a slow, failed or in-flight response, because the throwaway backend could not safely be made to produce it; those simulations were answered inside the browser and never reached the backend. The pass also found four new defects, HO-51 to HO-54. The other 47 static findings concern code, wording or documents and had no browser check of their own; 15 of them were nonetheless seen in the browser, in the first pass or as part of another check, and their source lists say so.

**Why earlier reviews missed these.** Earlier reviews read code and diffs. None compared the running product with its specification, screen by screen. Code that exists can be correct in itself while the feature around it is half built: a button with no operation behind it, a history that records two of the eleven kinds of edit, a selector the contract has no verb for. Reading the diff shows what was written, not what is missing, so half-built features looked finished.

**How to read a finding.** Each has a new id (UF-001 onwards, in the order they appear), a severity, the design's words with their reference, what happens with short steps to reproduce, the code location, and the screenshot names. Screenshots and logs are in the review session's working folder, not in the repository: `/Users/alex/.copilot/session-state/2667687a-14e9-4ce1-bec9-56f98115158b/files/scan-hands-on/` (`shots/` and `logs/`). Code paths are relative to the repository root, at `34409c5`. "Source ids" lists every original finding merged into this one, with its verdict: *confirmed* (seen in the browser), *confirmed †* (seen with a simulated response), *found in the browser* (a hands-on finding), or *static only* (no browser check).

**Severity, applied the same way everywhere.** *Critical:* wrong numbers shown or stored, data lost or destroyed without recovery, money spent or hidden unexpectedly, or a core workflow impossible. *High:* a specified feature missing or broken in a core workflow. *Medium:* a partial feature, or misleading behaviour. *Low:* minor. *Nit:* cosmetic. Where this differs from a source's rating, the finding says why.

## 2. Summary

**251 original findings (197 static, 54 from the browser) became 144 findings after merging duplicates**; one more (HO-12) is a decided behaviour and is listed under Recorded divergences.

| Tab | Critical | High | Medium | Low | Nit | Total |
|---|---:|---:|---:|---:|---:|---:|
| Shell and global states | 1 | 1 | 12 | 8 | 2 | 24 |
| Configure | 2 | 4 | 15 | 20 | 5 | 46 |
| Acquire | 3 | 3 | 12 | 12 | 2 | 32 |
| Rank | 0 | 2 | 8 | 9 | 2 | 21 |
| Compare | 1 | 2 | 8 | 8 | 2 | 21 |
| **All tabs** | **7** | **12** | **55** | **57** | **13** | **144** |

**The 15 worst problems, worst first:**

1. **UF-124** (Critical, Compare): The synthesis cards are signed backwards: each card's number and lists describe the focus but sit under the comparator's name
2. **UF-071** (Critical, Acquire): A hand-entered score is scored without its scale: "7 on 0–10" counts as 7 out of 100
3. **UF-026** (Critical, Configure): Number fields silently rewrite what is typed and report "Saved.": "72,000" is stored as 72
4. **UF-025** (Critical, Configure): Delete removes a criteria set, even the one in use, in one click: no confirmation, no history entry, no way back
5. **UF-072** (Critical, Acquire): Money spent on gate research is left out of "Spent this month" and disappears from every screen once the pass ends
6. **UF-073** (Critical, Acquire): The acquisition diff calls re-confirmed figures "went missing" and leaves them out of "Unchanged"
7. **UF-001** (Critical, Shell and global states): Reads that are still loading or have failed are shown as facts: zeros, "not set", "no figure stored"
8. **UF-030** (High, Configure): Recent changes misses criteria-set, household, source and limit edits, and "Back to where I started" leaves them changed
9. **UF-027** (High, Configure): "Create set" makes an empty set that nothing can fill, and moves the whole app onto it
10. **UF-074** (High, Acquire): Items nobody was asked are reported as "unanswered: every source answered, none had a row. Retrying changes nothing"
11. **UF-075** (High, Acquire): "What the database holds" shows the last acquisition's accounting, not the database, and lacks "countries scored" and the ageing count
12. **UF-103** (High, Rank): In the drill-down, "Weight" and "Weight used" are on different bases, so every row seems to have lost most of its weight
13. **UF-125** (High, Compare): At the comparator limit a new tick silently drops the oldest choice, which stays hidden and can come back by itself
14. **UF-126** (High, Compare): Gaps are printed less precisely than their figures, so real differences read "+0" or "−0" beside a coloured bar
15. **UF-076** (High, Acquire): An armed "Yes, start it" goes stale and starts a scope that is no longer on screen

**Patterns behind many findings.**

- **Input and reads are trusted when they should be checked.** Number fields rewrite what is typed and report "Saved."; a hand-entered scale is stored and ignored; a read that fails or is slow is drawn as zero, "not set" or "nothing stored".
- **Half-built features look finished.** Create set, saved rankings (no leader, no delete), the gate/warning selector, the change history, the stopping state and the round-4 loading, empty and error states each exist in part.
- **Signs, bases and scopes disagree on one screen.** Compare's cards and matrix use opposite signs; Rank's two weight columns use different bases; Acquire's cards, history and holds panel count the same run differently.
- **Identifiers reach the screen**, against the user's ruling of 2026-10-23: error codes, set and attribute ids, enum names, database text.
- **State does not survive a tab change or a reload**: Compare's selection, Rank's open rows, the active criteria set, Configure's drafts and history.

## 3. Findings by tab

Within each tab, findings are sorted by severity. Configure's findings carry the stage they belong to; within a severity they follow the order sets, household, weights and rules, change history, rules and gates, sources, limits.

### Shell and global states

24 findings: 1 Critical, 1 High, 12 Medium, 8 Low, 2 Nit.

#### UF-001 — Critical — Reads that are still loading or have failed are shown as facts: zeros, "not set", "no figure stored"

- **Design says:** "Null never becomes zero" and absence is never drawn as a zero (DECISIONS.md, Principles; README.md, Interactions & behaviour, "Null propagation"). Every tab has its own loading and error state (README.md, Round 4 additions, "Loading, empty, error").
- **What happens:** When a read is slow or fails, several panels fill the gap with an answer and show no error. Acquire's "What the database holds" reads "Values filled 0 of 0", "Nobody answered 0", "Failed 0" and "no cap is set, so an acquisition that would spend refuses" while the cap is €15. Compare says "No comparator limit is configured, so the server will refuse a comparison." while the limit is 5, and a failed candidate list leaves an empty Focus list with no message. Rank's drill-down says "No figure has been stored for anything in Economy." when the criteria-set read failed, and shows "—" (the sign for "no score") in Score, Weight used and Contribution while the score read is pending or after it fails. On a slow read these flash; on a failed read they stay.
- **To reproduce:**
  1. In the browser, make `GET /v1/data-acquisition-runs/{id}` or `GET /v1/settings` fail, or delay it by 3 s.
  2. Open Acquire, then Compare.
  3. Make `GET /v1/criteria-sets/{id}` fail, open a Rank row and choose a pillar.
- **Evidence:** `ui/src/routes/run/DatabaseHoldsPanel.tsx:99-136`; `ui/src/routes/run/databaseHolds.ts:70-81`; `ui/src/routes/compare/CompareScreen.tsx:104-111, 222-223`; `ui/src/routes/rank/CandidateDetail.tsx:98-135, 198-205`; `ui/src/routes/rank/attributeScores.ts:100-116`; `ui/src/routes/rank/pillarFilter.ts:38-47`. Screenshots: `shots/s2-10-shell-sim-03-SH-02-run-detail-aborted.png`, `shots/s2-10-shell-sim-04-SH-02-compare-settings-aborted.png`, `shots/s2-10-shell-sim-05-SH-02-acquire-settings-aborted.png`, `shots/s2-20-acquire-07-AQ-06-holds-pending.png`, `shots/s2-60-compare-08-CP-10-candidates-aborted.png`, `shots/s2-50-rank-06-RK-12-criteria-aborted.png`, `shots/s2-50-rank-07-RK-12-detail-aborted.png`, `shots/s2-54-dash-01-drilldown-pending.png`.
- **Source ids:** SH-02 (confirmed †), AQ-06 (confirmed †), CP-10 (confirmed †), RK-12 (confirmed †), HO-51 (found in the browser)
- **Severity:** Re-rated Critical (the sources rated it High to Low). On a failed read the screen states false figures as fact, with no error. The sources held it lower because a slow read is brief; a failed read is not, and the zeros also flash on every act on Acquire (UF-009).
- **Fix direction:** Give every panel its own loading and error states ("—" or a skeleton while loading, an error with Try again on failure), and never default a missing read to 0, "not set" or "nothing stored".

#### UF-002 — High — When the server is down, every screen says the response "has a shape this interface does not recognise", with no Try again

- **Design says:** One error card per screen: "<What> could not be loaded", "Nothing on this screen has changed, and nothing was charged.", "If this keeps happening, the Starnest server is probably not running. Start it, then try again.", and Try again (README.md, Round 4 additions; screen 38).
- **What happens:** Behind a proxy, a stopped backend answers with a 502 page (nginx in Docker) or a 500 with an empty body (the Vite dev proxy). The client turns any error that is not JSON into `client.malformed_error_body`: "The backend reported an error in a shape this interface does not recognise." It is marked not retryable, so no notice offers Try again. The household card adds "Nothing has been recorded about the household yet." and Rank and Compare ask the reader to "Choose a criteria set and a level…". Nothing recovers when the server comes back; only a reload helps. The backend refuses to boot on a stale schema (Gate D), so this happens after any pull without `make migrate`.
- **To reproduce:**
  1. Simulate the backend down: every `/v1` request answers 500 with an empty body.
  2. Open Rank, then Compare.
  3. Bring the backend back and wait 10 s without reloading.
- **Evidence:** `ui/src/api/ApiError.ts:57-90`; `ui/src/api/client.ts:345`; `ui/src/api/errorPresentation.ts:43-46`; `ui/nginx.conf:14-27`; `ui/src/routes/rank/RankScreen.tsx:149-152`. Screenshots: `shots/s2-10-shell-sim-01-SH-01-backend-down.png`, `shots/s2-10-shell-sim-02-SH-01-after-recovery.png`.
- **Source ids:** SH-01 (confirmed †)
- **Fix direction:** Map 502, 503, 504 and an empty-bodied 500 to "server not reachable" (retryable) before the shape check, and show the design's one card per screen.

#### UF-003 — Medium — Error notices print error codes, the server's raw sentences and database text, in monospace, without the round-4 title or reassurance

- **Design says:** "Error: one shape everywhere … '<What> could not be loaded', 'Nothing on this screen has changed, and nothing was charged.' … Try again. No error codes on screen." (README.md, Round 4 additions). The user's ruling of 2026-10-23: "The copy rule against programmatic identifiers stands without exception" (DECISIONS.md). "No programmatic identifiers in rendered text" (README.md, Deviations 8); "No monospace anywhere" (README.md, Design tokens, Typography).
- **What happens:** Every notice prints its code on a line the browser draws in monospace: `criteria_set_exists`, `criteria_set_in_use`, `weights_all_locked`, `invalid_criterion`, `invalid_request`, `llm_not_configured`, `run_already_in_flight`, `nothing_to_fetch`, `cannot_be_ranked`, `client.unreachable`. For codes the client does not know, it shows the server's sentence word for word: set ids ("a criteria set called 'ho_test_set' already exists"), document references ("(reqs.md 10)"), an environment variable ("set ANTHROPIC_API_KEY and the LLM prices"), and for a set in use the PostgreSQL foreign-key message. No notice has the "<What> could not be loaded" title or the reassurance, and the card is louder than designed (red border and text, 8 px padding). With the run list failing, Acquire silently drops its progress card, its "What the database holds" panel and the diff; only the history table at the bottom reports anything.
- **To reproduce:**
  1. Configure stage 1: create a set whose name already exists.
  2. Save a ranking on a set, then press Delete on that set.
  3. Configure stage 6: type 150 in Minimum coverage and save.
  4. In the browser, make `GET /v1/rankings` or `GET /v1/comparisons` fail.
- **Evidence:** `ui/src/shell/ErrorNotice.tsx:11-34`; `ui/src/api/errorPresentation.ts:39-46, 86-89`; `ui/src/app/App.test.tsx:484-498` (asserts the code is shown); `backend/src/starnest/storage/criteria_store.py:87-89, 166-171`; `backend/src/starnest/api/runs.py:285-288`; `ui/src/styles.css:2811-2826, 2863-2865`. Screenshots: `shots/04-sets-02-duplicate-name.png`, `shots/s2-40-configure-10-CA-13-delete-refused.png`, `shots/13-pillars-05-refusal.png`, `shots/22-settings-01-Minimum-150.png`, `shots/20-rules-03-proposals-estimate.png`, `shots/s2-20-acquire-09-AQ-12-refusal-top.png`, `shots/s2-50-rank-08-RK-17-rankings-aborted.png`, `shots/s2-60-compare-09-CP-12-comparison-aborted.png`, `shots/43-states-01-rank-error.png`, `shots/43-states-03-acquire-error.png`, `shots/53-verify-hist-01-history-runs-failing.png`.
- **Source ids:** SH-04 (confirmed), CA-10 (confirmed), CB-14 (confirmed), AQ-13 (confirmed †), RK-17 (confirmed †), CP-12 (confirmed †), CA-18 (confirmed), SH-29 (static only), HO-05 (found in the browser), HO-41 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; CA-18 (Low) and SH-29 (Nit) rated it lower.
- **Fix direction:** Rebuild the shared error notice to the round-4 card (a per-screen title, the reassurance, a plain cause, Try again), drop the visible code, word every contract code the interface can meet, and update the tests that assert codes.

#### UF-004 — Medium — An unset score range is only half handled: the sidebar shows a red error and loses Total, Compare keeps its picker, Rank keeps Save

- **Design says:** "When the score range is unset, only Total shows, with an amber line explaining that the other three depend on a score" (README.md, Shell, Sidebar item 5). Rank and Compare are each replaced by one card with a route to the setting (README.md, 3. Rank and 4. Compare); "Rank, Compare and the sidebar counts all empty out" (README.md, Stage 6; UX-REVIEW.md R3).
- **What happens:** Rank shows its "No ranking" card, but keeps "Save this ranking" and the "One attribute, every candidate" panel. The sidebar's Candidates card turns into a red alert with `score_scale_not_set` and a button, and Total disappears, because the count and the ranking are fetched together. The alert is inserted again, and announced again, on every tab change. Compare draws its whole picker; "Nothing to compare" appears only after a focus, a pick and Compare. After the range is set again on Configure, the sidebar keeps saying nothing can be ranked until another tab is opened.
- **To reproduce:**
  1. Configure stage 6: clear "Top of the score range" and save.
  2. Read the sidebar, then open Rank and Compare.
  3. On Compare, pick a focus and a comparator and press Compare.
  4. Set the range back and save.
- **Evidence:** `ui/src/shell/useShellSummary.ts:35-45`; `ui/src/shell/Sidebar.tsx:293`; `ui/src/routes/compare/CompareScreen.tsx:101, 166-174`; `ui/src/routes/rank/RankScreen.tsx:145, 191`. Screenshots: `shots/s2-70-settings-driven-04-RK-07-save-with-range-unset.png`, `shots/s2-70-settings-driven-05-CP-09-after-compare.png`, `shots/23-unset-scale-03-rank-scale-unset.png`, `shots/23-unset-scale-04-compare-scale-unset.png`, `shots/s2-71-misc-02-CB-20-after-restore-same-screen.png`.
- **Source ids:** SH-03 (confirmed), RK-06 (confirmed), CB-20 (confirmed), CP-09 (confirmed), HO-23 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; CB-20 (Low) and HO-23 (Low) rated it lower.
- **Related:** Rank's save control is UF-111. The sidebar staying stale after a Configure save is the decided UI-11 behaviour (see Recorded divergences).
- **Fix direction:** Fetch the candidate count apart from the ranking and show Total with the amber line; replace Compare as soon as the settings say the range is unset; hide Rank's save control and attribute panel under its card.

#### UF-005 — Medium — When an acquisition ends, the sidebar updates but an open Rank or a drawn comparison does not

- **Design says:** "Acquisitions change the database… Each writes a numbered row into the history and updates the sidebar", and "the ranking reorders live" (README.md, Interactions & behaviour).
- **What happens:** Only the sidebar listens for the end of a run. Rank's table, its "Computed" time and any open drill-downs keep the old scores and statuses while the counts beside them change, so the two disagree on one screen. "Save this ranking" then stores a freshly computed ranking that differs from the one on screen. A drawn comparison does not refresh either. A run that starts and ends between two of the shell's 2-second looks is never seen, so even the sidebar is not told.
- **To reproduce:**
  1. Open Rank while a run is in flight (simulated in the browser).
  2. Let the run end, with one candidate's status changed in the new ranking.
  3. Compare the sidebar counts with the table.
- **Evidence:** `ui/src/shell/SelectionContext.tsx:46, 149`; `ui/src/shell/Sidebar.tsx:64-68`; `ui/src/routes/rank/RankScreen.tsx:81-86`; `ui/src/shell/acquiringProgress.ts:39-44`; `backend/src/starnest/api/evaluations.py:103-121`. Screenshots: `shots/s2-20-acquire-11-SH-09-after-run-end.png`.
- **Source ids:** SH-09 (confirmed †), RK-08 (confirmed †)
- **Related:** Distinct from P99, which is about reads racing a Configure write.
- **Fix direction:** Pass the "acquisition ended" signal as a freshness key to Rank's ranking, its open details and a drawn comparison (or show a "figures changed, refresh" line), and read back what a save kept.

#### UF-006 — Medium — Compare and Rank forget their state on every tab change, criteria-set switch and reload

- **Design says:** Focus, comparators, both view choices, the open pillar and Rank's open rows are app state (README.md, State management). "Comparisons are always live" (docs/reqs.md 8.5). Lowering the comparator limit trims the selection to the newest N (README.md, 4. Compare), which assumes the selection survives a visit to Configure.
- **What happens:** Leaving Compare for any tab, switching the criteria set or reloading empties the focus and the ticks, resets "Raw figures" and removes the matrix. "Change it in Configure", the route Compare itself offers, loses everything, so the trim never meets a lowered limit and the alert's "Raise the limit in Configure to bring them back" is false. Rank's open rows close on every visit elsewhere. The core loop (change a weight, read the effect on Compare) means rebuilding the comparison each time.
- **To reproduce:**
  1. Compare: choose a focus and two comparators, select Raw figures, press Compare.
  2. Press "Change it in Configure", then come back.
  3. Switch the criteria set in the sidebar.
  4. Rank: open two rows, visit Compare, return.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:52-56, 68-73`; `ui/src/routes/rank/RankScreen.tsx:110`; `ui/src/app/App.tsx:52-73`. Screenshots: `shots/42-compare-limit-02-after-limit-2.png`.
- **Source ids:** SH-10 (confirmed), CP-07 (confirmed), HO-39 (found in the browser)
- **Fix direction:** Keep Compare's selection and view choices, and Rank's open rows, in a provider above the routes or in the URL; reset only on a level change, and redraw the comparison on return.

#### UF-007 — Medium — The active criteria set is forgotten on reload; the app reopens on whichever set id sorts first

- **Design says:** The active criteria set is what every number on screen is relative to (docs/design-brief.md, "Where the implementation has got to"). Tabs are links that can be opened in a new window (code comment, `ui/src/shell/TabBar.tsx:12-14`).
- **What happens:** The choice lives only in memory. After a reload, or in a new browser tab, the app adopts the first set by id. Because every edit writes straight through (reqs Q168), landing silently on another set invites editing the wrong one. A set whose id sorts first ("Aardvark", or the test's "HO …" sets) becomes the default on every load, even when it is empty.
- **To reproduce:**
  1. Sidebar: choose "Remote only".
  2. Reload the page.
- **Evidence:** `ui/src/shell/SelectionContext.tsx:58-59, 107-116`. Screenshots: `shots/09-reload-focus-02-after-enter-on-bar.png`.
- **Source ids:** SH-24 (confirmed), HO-06 (found in the browser)
- **Severity:** Medium, as the browser test rated it (the static scan said Low): with edits written through, opening on the wrong set leads to editing it.
- **Fix direction:** Keep the set and level in the URL or in local storage, and fall back to the first set only when the stored one no longer exists.

#### UF-008 — Medium — The sidebar's household card says "Nothing has been recorded" when it simply could not read

- **Design says:** One household, shown with the same labels and values as Configure stage 2 (README.md, Shell, Sidebar item 2); one error shape (README.md, Round 4 additions).
- **What happens:** Any failed household read, including a server fault or a server that is down, prints "Nothing has been recorded about the household yet." with no error and no Try again. This invites the reader to type the household in again, beside error notices that say the opposite. Configure tells "not configured" apart from a fault; the sidebar does not. Its idle "Reload" branch can never run.
- **To reproduce:**
  1. In the browser, make `GET /v1/household` answer 500.
  2. Open any tab and read the household card.
- **Evidence:** `ui/src/shell/Sidebar.tsx:221-226, 272-278`; compare `ui/src/routes/configure/household/HouseholdPanel.tsx:43-58`. Screenshots: `shots/s2-10-shell-sim-06-SH-05-household-500.png`.
- **Source ids:** SH-05 (confirmed †), CA-25 (static only; the same defect as SH-05)
- **Severity:** Medium, the rating of its most serious part; CA-25 (Low) rated it lower.
- **Fix direction:** Say "not recorded" only when the server says no household has been configured; otherwise show the error with Try again; delete the dead branch.

#### UF-009 — Medium — Every re-read blanks what it re-reads: the sidebar collapses, the set list empties and Acquire's panels vanish, so content jumps under the pointer

- **Design says:** Loading is drawn as skeletons in the shape of the content (README.md, Round 4 additions); this codebase's own rule is that what was drawn stays on screen while it is read again.
- **What happens:** The shared read hook throws its data away whenever it reads again. On every tab change the sidebar's household card, Candidates and Last acquisition collapse to "Loading…" and refill, and the set selector jumps 186 px and back, so a click aimed at it can land elsewhere; one tab switch also sends 9 requests, a whole ranking among them. On Acquire, every Estimate, Refresh, Open or Stop removes "What the database holds" and turns the history into "Loading…"; with a slow read the cards below jump up 187 px, and the panel returns showing zeros first. In Configure stage 1, each set action briefly shows "0 sets", an empty list and a sidebar select reading "No criteria sets".
- **To reproduce:**
  1. On Rank, note the position of the "Active criteria set" select.
  2. Click Compare and sample the position every frame.
  3. On Acquire, press Refresh with the history read slowed to 1.5 s.
  4. In Configure, press Duplicate with the set list slowed.
- **Evidence:** `ui/src/api/useResource.ts:52-56`; `ui/src/shell/Sidebar.tsx:64-68, 84, 221, 292, 328`; `ui/src/routes/run/RunScreen.tsx:101-103, 269-271`; `ui/src/routes/run/useRunScreen.ts:158`; `ui/src/shell/SelectionContext.tsx:78-81`; `ui/src/routes/configure/sets/CriteriaSetsPanel.tsx:37-40`. Screenshots: `shots/s2-94-sh08-01-SH-08-sidebar-during-slow-reread.png`, `shots/s2-93-aq07-02-AQ-07-during-estimate.png`, `shots/s2-93-aq07-01-AQ-07-after-refresh-settled.png`.
- **Source ids:** SH-08 (confirmed), AQ-07 (confirmed), CA-19 (confirmed †)
- **Severity:** Medium, the rating of its most serious part; CA-19 (Low) rated it lower.
- **Related:** AQ-07 corrects map-runs §7.1 sibling 1, which assumed the holds panel was never read again.
- **Fix direction:** Keep the previous data while a re-read is in flight (stale-while-revalidate in the shared read hook), so only a first load shows a loading state.

#### UF-010 — Medium — Times are shown in UTC with no label, while Recent changes uses local time

- **Design says:** The design prints wall-clock times ("Computed 28 Aug 2026, 09:31"; README.md, 3. Rank, header), and every displayed figure carries its dates (provenance invariant).
- **What happens:** One shared formatter pins the UTC zone. At 00:04 local time (Bucharest, UTC+3), Rank read "Computed 23 Oct 2026, 21:04" and the sidebar's "Started" showed run 131's start in UTC, with no "UTC" anywhere. The run history and card, the diff pickers, every "Fetched" date and the saved-ranking dates do the same. Recent changes uses local time, so its entries sit three hours apart from the ranking beside them, and a ranking saved after midnight is listed under the previous day.
- **To reproduce:**
  1. Note the computer clock.
  2. Move a weight in Configure and read the Recent changes time.
  3. Read Rank's "Computed" and the sidebar's "Started".
- **Evidence:** `ui/src/format/display.ts:76-94`; `ui/src/routes/configure/changeHistory.ts:147-152`; used at `ui/src/routes/rank/RankingTable.tsx:184`, `ui/src/shell/Sidebar.tsx:336`, `ui/src/routes/run/RunScreen.tsx:560-562, 683`, `ui/src/routes/rank/CandidateDetail.tsx:383`, `ui/src/format/savedRanking.ts:67`. Screenshots: `shots/s2-50-rank-05-RK-09-computed-vs-clock.png`, `shots/s2-40-configure-04-CA-20-rail.png`.
- **Source ids:** SH-12 (confirmed), RK-09 (confirmed)
- **Fix direction:** Format instants in the browser's time zone (pin the zone in tests instead), or label them "UTC"; keep UTC only for day-only dates.

#### UF-011 — Medium — Empty states are missing or misleading on all four tabs

- **Design says:** "Empty: a card saying why it is empty and the one action that fills it (Rank/Compare → Go to Acquire, Acquire → See the estimate, Configure → Create a first set)" (README.md, Round 4 additions; screen 37).
- **What happens:** With no criteria sets, Configure says "Choose a criteria set to see its criteria.", the sidebar select reads "No criteria sets" and the counts say "Choose a criteria set and a level…": instructions nobody can follow. With no values stored, Rank draws every candidate as "No score" under a "Not in the ranking" band instead of "Nothing to rank yet". Compare has no empty state: an empty roster gives an empty Focus list, and unscored candidates give a matrix of dashes. Acquire shows a hint with no "See the estimate" button.
- **To reproduce:**
  1. In the browser, answer `GET /v1/criteria-sets` with an empty list.
  2. Open Configure and Rank. (No database without values was to hand; that half is read from the code.)
- **Evidence:** `ui/src/routes/configure/ConfigureScreen.tsx:76-81`; `ui/src/shell/Sidebar.tsx:129, 289-291`; `ui/src/routes/rank/RankingTable.tsx:90-98`; `ui/src/routes/compare/CompareScreen.tsx` (no empty branch); `ui/src/routes/run/DatabaseHoldsPanel.tsx:69-74`. Screenshots: `shots/s2-10-shell-sim-09-SH-14-configure-no-sets.png`, `shots/s2-10-shell-sim-10-SH-14-rank-no-sets.png`.
- **Source ids:** SH-14 (confirmed †), RK-19 (static only; seen in the SH-11 and SH-14 checks), CP-15 (static only)
- **Severity:** Medium, the rating of its most serious part; RK-19 (Low) and CP-15 (Low) rated it lower.
- **Related:** The empty-state halves of CA-11 and AQ-19 are noted under UF-012. Configure's "Create a first set" needs a create that works (UF-027).
- **Fix direction:** Detect "no sets" and "no values" from server data and draw the design's four cards, each with its one action.

#### UF-012 — Medium — Loading is a plain "Loading…" line on every tab: no skeletons, no busy flag, and content pops in

- **Design says:** "Loading: skeletons in the shape of the real content (#eaecf0 blocks, 3px radius, 1.4s opacity pulse 1 → 0.5, none under prefers-reduced-motion), aria-busy='true'. Page title renders immediately." (README.md, Round 4 additions; UX-REVIEW.md B5; screens 35 and 36).
- **What happens:** Rank, Configure, Acquire and the sidebar print "Loading…" (Compare prints "Comparing…"), and no element anywhere carries `aria-busy`. Sections arrive one at a time, so the page jumps as each read lands, and screen readers are not told a region is busy. Configure and Acquire also lack their empty-state actions (see UF-011).
- **To reproduce:**
  1. In the browser, delay `GET /v1/rankings` by 3 s and open Rank.
  2. Repeat for Configure (`/v1/criteria-sets/*`) and Acquire (`/v1/data-acquisition-runs`).
  3. Count the elements with `aria-busy`.
- **Evidence:** `ui/src/routes/rank/RankScreen.tsx:155`; `ui/src/routes/configure/ConfigureScreen.tsx:82`; `ui/src/routes/run/RunScreen.tsx:270`; `ui/src/routes/compare/CompareScreen.tsx:163`; `ui/src/shell/Sidebar.tsx:221, 292, 328, 380`; no `aria-busy` anywhere in `ui/src`. Screenshots: `shots/s2-10-shell-sim-07-SH-11-rank-loading.png`, `shots/s2-10-shell-sim-08-SH-11-configure-loading.png`, `shots/43-states-05-rank-loading.png`, `shots/43-states-06-acquire-loading.png`.
- **Source ids:** SH-11 (confirmed †), CA-11 (confirmed †), AQ-19 (confirmed †)
- **Related:** The loading halves of RK-19 and CP-14 are the same defect (both mapped elsewhere); Configure's stage cards that lose their headings are UF-065.
- **Fix direction:** One shared skeleton primitive with per-screen shapes in the stylesheet, `aria-busy` on the region while it loads, and the page title drawn at once.

#### UF-013 — Medium — Saved rankings show no leader and cannot be deleted

- **Design says:** "Each row is the saved name over '<leader> led, <date>', clicking loads it…, plus a × to delete" (README.md, Shell, Sidebar item 7); "with the leader, its score and the date" (UX-REVIEW.md A).
- **What happens:** Each row shows the note (or, with no note, "local_employment, country") over the set id and a date ("ho_scratch, 23 Oct 2026"), never the leader. There is no ×: the contract has no `DELETE /evaluations/{id}`, and the prepared style for the button is unused. A mistaken or doubled save stays for ever, and it also makes its criteria set impossible to delete (UF-031). The omission is recorded only in a comment in an end-to-end test.
- **To reproduce:**
  1. Rank: Save this ranking, once with a note and once without.
  2. Read the sidebar's Saved rankings card.
- **Evidence:** `ui/src/format/savedRanking.ts:40-48, 66-68`; `ui/src/shell/Sidebar.tsx:389-404`; `ui/src/styles.css:419-430`; `docs/openapi.yaml:927-1010, 1861-1874`; `ui/e2e/sanity.spec.ts:120-121, 179-181`. Screenshots: `shots/36-saved-rankings-02-after-save.png`, `shots/s2-71-misc-04-RK-04-noteless-entry.png`.
- **Source ids:** SH-07 (confirmed †), RK-26 (confirmed), HO-36 (found in the browser)
- **Severity:** Medium (two sources rated it Low): a specified part of a top-priority feature is missing, and a save that cannot be deleted also blocks deleting its set.
- **Related:** The raw ids in these rows are UF-112. map-ui notes that NEW-56's double press can create a duplicate save that cannot be removed.
- **Fix direction:** Add the leader to the evaluation summary and a delete operation (contract first), then wire the × with a confirmation; or record both gaps in design-brief.md.

#### UF-014 — Medium — The narrow-desktop rule was adopted but never built, and at 1440 px or less Rank's rows outgrow their table

- **Design says:** "Narrow desktop: 1280px minimum; Δ home drops at 1440, Pillars at 1280; the sidebar narrows to 200px rather than collapsing" (UX-REVIEW.md, Round 4, "Recorded, not redesigned"; DECISIONS.md 2026-10-12; docs/design-brief.md:86-91).
- **What happens:** The 1440 px rule hides `.col--delta`, but no cell carries that class, so Δ home never drops. There is no 1280 px rule (it was deleted in `2c04381` and left out of the `54ef14f` restore), and the sidebar stays 262 px wide. Worse, the 1440 px rule lowers the table's minimum width to 1,124 px while each row still needs about 1,630 px. At 1440×900 the header and row grounds stop at 1,128 px inside a card that scrolls to 1,614 px, so scrolled right the cells have no row ground or header background, and rows with warnings grow four times taller. At 1920 px the last cell ends 5 px past the card.
- **To reproduce:**
  1. Set the window to 1440×900 and open Rank.
  2. Scroll the table to the right.
  3. Repeat at 1280×800 and measure the sidebar.
- **Evidence:** `ui/src/styles.css:131, 2958-2979, 3868-3876`; `ui/src/routes/rank/RankingTable.tsx` (no `col--delta` on any cell). Screenshots: `shots/s2-50-rank-09-RK-16-1440-scrolled.png`, `shots/s2-50-rank-10-RK-16-1920.png`, `shots/s2-10-shell-sim-11-SH-15-1280.png`, `shots/02-shell-07-rank-at-1280.png`, `shots/02-shell-08-rank-at-1100.png`.
- **Source ids:** RK-16 (confirmed), SH-18 (confirmed), HO-10 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; SH-18 (Low) and HO-10 (Low) rated it lower.
- **Fix direction:** Per breakpoint, set the grid tracks without the dropped columns, put the class on both header and cells, keep the minimum width at least the sum of the tracks, and restore the 200 px sidebar; or record that the rule was dropped.

#### UF-015 — Low — Routes to a setting or section land at the top of the page, thousands of pixels from the target

- **Design says:** "No source yet →" jumps to Acquire and highlights "Attributes with no data source at all" (README.md, Stage 3; UX-REVIEW.md H). "Set it in Configure" and "Change it in Configure" are routes to the setting (README.md, 3. Rank and 4. Compare; UX-REVIEW.md R3).
- **What happens:** "Set it in Configure" (Rank, sidebar) and "Change it in Configure" (Compare) open Configure at the top with focus on the page; the field is about 4,800 px down in stage 6, below 39 source rows. On Configure itself, the sidebar's "Set it in Configure" does nothing. The sidebar's "Edit" and "Acquisition history" links also land at the top. "No source yet →" does open Acquire with the card ringed in amber, but leaves the page at the top, with the card starting near the bottom edge of the window (847 px down a 1,000 px window); the ring fades within 4.5 s, before the reader has scrolled to it, and the attribute's row is not marked.
- **To reproduce:**
  1. Clear the score range and press "Set it in Configure" on Rank.
  2. On Compare, press "Change it in Configure".
  3. Configure stage 3: open Economy and press "No source yet →" on Remote work tax treaty.
- **Evidence:** `ui/src/shell/refusalRemedy.ts:28-33`; `ui/src/shell/Sidebar.tsx:217, 343`; `ui/src/routes/compare/CompareScreen.tsx:228-230`; `ui/src/navigation/highlight.ts:14-16`; `ui/src/routes/run/UnsourcedAttributes.tsx:46-69`; `ui/src/styles.css:2267-2284`. Screenshots: `shots/23-unset-scale-06-after-route-to-setting.png`, `shots/44-unsourced-bar-01-after-no-source-link.png`.
- **Source ids:** SH-21 (static only; seen in HO-44 and in the CB-21 check), CB-21 (confirmed), CP-26 (confirmed), HO-44 (found in the browser), HO-43 (found in the browser)
- **Fix direction:** Extend the existing `?show=` highlight to the limits, household and history; scroll the target into view, focus it, keep the highlight until the reader acts, and mark the attribute's row.

#### UF-016 — Low — A criteria-set list that is loading or has failed reads as "no sets", with instructions that cannot be followed

- **Design says:** Loading and error are states of their own (README.md, Round 4 additions).
- **What happens:** While the list loads, the sidebar select reads "No criteria sets" and is disabled, and Configure stage 1 says "0 sets". When it fails, Rank, Compare and Configure ask the reader to "Choose a criteria set…", which they cannot do. A failed candidate-list read enables the City level for good.
- **To reproduce:**
  1. In the browser, delay or fail `GET /v1/criteria-sets`.
  2. Open Compare, Rank and Configure.
- **Evidence:** `ui/src/shell/Sidebar.tsx:109-115, 127-129`; `ui/src/routes/rank/RankScreen.tsx:149-152`; `ui/src/routes/configure/ConfigureScreen.tsx:76-80`; `ui/src/routes/compare/CompareScreen.tsx:122-125`. Screenshots: `shots/s2-71-misc-06-CP-14-selection-loading.png`, `shots/s2-10-shell-sim-01-SH-01-backend-down.png`, `shots/s2-10-shell-sim-10-SH-14-rank-no-sets.png`.
- **Source ids:** SH-23 (confirmed †), CP-14 (confirmed †)
- **Fix direction:** Give the selection its own loading and error states, pass them to every screen, and never enable a level because a read failed.

#### UF-017 — Low — The progress strip never says "Stopping…", counts only completed items, and announces every poll

- **Design says:** The strip reads "Stopping…" once a stop is asked, and its "N of M" counts settled items (`.dc.html` l.2711-2714; README.md, Round 4 additions, "Stop").
- **What happens:** After Stop, the strip on other tabs still reads "Acquiring…". It counts completed items only, so it shows "13 of 40" while 13 are done and 2 have failed, and a run with many failures looks stuck. The strip is a live region rewritten every 2 s, so a screen reader announces every poll; the sidebar's alerts are also inserted again, and announced again, on every tab change.
- **To reproduce:**
  1. Start a run (simulated in the browser) and press Stop on Acquire.
  2. Open Rank and read the strip.
  3. Watch the strip's text for 6 s.
- **Evidence:** `ui/src/shell/AcquiringBar.tsx:31-42`; `ui/src/shell/useAcquiring.ts:56-60`. Screenshots: `shots/s2-20-acquire-10-SH-15-strip-stop-asked.png`, `shots/s2-96-aq32-01-AQ-32-strip-live-region.png`.
- **Source ids:** SH-15 (confirmed †), AQ-32 (confirmed †), SH-25 (static only; the strip's live region was checked under AQ-32)
- **Related:** The card's own stopping state is UF-084.
- **Fix direction:** Read the run's stop time and switch the title to "Stopping…"; count completed plus failed items; announce only the start and the end.

#### UF-018 — Low — The shell asks for the run list every 2 seconds for as long as a tab is open

- **Design says:** The code's own rule: "It stops asking the moment the run stops. A poll that continues after `completed` is a request per two seconds forever" (`ui/src/shell/useAcquiring.ts:13-14`).
- **What happens:** With nothing running, the run list was requested every 2,010 ms: about 1,800 requests an hour per open tab. Only the detail read stops. The comment misleads the next maintainer.
- **To reproduce:**
  1. Open Configure with no run in flight.
  2. Watch the network for 10 s.
- **Evidence:** `ui/src/shell/useAcquiring.ts:13-14, 68`. Log: `logs/s2-10-shell-sim.json`.
- **Source ids:** SH-16 (confirmed)
- **Fix direction:** Ask rarely (for example every 30 s) while nothing runs, and every 2 s only while a run is in flight or has just started; or correct the comment.

#### UF-019 — Low — Every saved-ranking link, and several sidebar links, claim to be the current page

- **Design says:** Not drawn (accessibility is deferred by DECISIONS.md 2026-09-20), but docs/design-brief.md says the interface is keyboard navigable, and a link marked current must be the page being read.
- **What happens:** The router's link matches on the path only, so on `/rank` every saved-ranking link carries `aria-current="page"`, even when no saved ranking is open. The same happens to "Edit" on Configure, "Acquisition history" on Acquire and the remedy buttons. A screen reader announces several "current page" links at once.
- **To reproduce:**
  1. Save a ranking.
  2. On `/rank`, read `aria-current` on the saved-ranking link.
- **Evidence:** `ui/src/shell/Sidebar.tsx:217, 343, 393-397`; `ui/src/shell/ErrorNotice.tsx:30`; `ui/src/shell/UnsetSetting.tsx:45`. Log: `logs/s2-71-misc.json`.
- **Source ids:** SH-20 (confirmed)
- **Related:** Rank's own accessibility gaps are UF-120.
- **Fix direction:** Use a plain link for these, and mark as current only the saved ranking that is open.

#### UF-020 — Low — Each screen's title is an h2; the brand is the page's only h1

- **Design says:** "Page `<h1>` 20px/600" for each tab (README.md, Shell).
- **What happens:** The sidebar's brand is the `h1` and every screen title is an `h2`, and two end-to-end tests assert it. Heading navigation lands on "Starnest" rather than on the screen being read. The choice is not recorded anywhere.
- **To reproduce:**
  1. Static: read the heading levels in the markup.
- **Evidence:** `ui/src/shell/Sidebar.tsx:79`; `ui/src/routes/rank/RankScreen.tsx:132`; `ui/src/routes/compare/CompareScreen.tsx:39`; `ui/src/routes/configure/ConfigureScreen.tsx:58`; `ui/src/routes/run/RunScreen.tsx:78`; `ui/e2e/smoke.spec.ts:27`; `ui/e2e/sanity.spec.ts:46`. No screenshot (found by reading the code).
- **Source ids:** SH-19 (static only)
- **Fix direction:** Make each screen title the `h1` and the brand a non-heading (and update the two tests), or record the choice in design-brief.md.

#### UF-021 — Low — The product name has two sources, and APP_DISPLAY_NAME never reaches the interface

- **Design says:** "The application name lives in configuration as a single display parameter" (docs/reqs.md 10); "Renaming the product is a change to this line and nothing else" (`.env.example:98-100`).
- **What happens:** The interface reads its name from `ui/public/config.json`, which is copied into the image when it is built. `APP_DISPLAY_NAME` only titles the backend's API document. Renaming in `.env` changes nothing on screen, and editing `config.json` needs an image rebuild, which a code comment says it should not.
- **To reproduce:**
  1. Static: follow the display name from `.env` to the screen.
- **Evidence:** `ui/public/config.json`; `ui/src/config/appConfig.ts:4-8, 15`; `ui/Dockerfile:17-24`; `compose.yaml:75-84`; `backend/src/starnest/main.py:136, 199`. No screenshot (found by reading the code).
- **Source ids:** SH-17 (static only)
- **Fix direction:** Serve the display name from the backend's environment, or write `config.json` from it when the container starts, and fix the comments.

#### UF-022 — Low — Divergences the code made are not recorded in design-brief.md, and some recorded ones are out of date

- **Design says:** `docs/design-brief.md` is the return channel the design reads (CLAUDE.md; docs/design-brief.md, opening section).
- **What happens:** Not recorded for the design: editing that writes straight through with no unsaved-changes guard (reqs Q168), which the design still asks for (README.md, Deviations 12; the browser test switched sets with no guard); tabs as links; `h2` screen titles; the household words; saved rankings with no leader and no delete; the per-criterion rule editor; gates and compound rules as two lists. Out of date: design-brief says source rows have "no drag grip" (grip and dragging are both built) and that Compare's tints are "three bands" (they have been continuous again since `d71b313`); the README's screens table says screen 04 shows "the six limits" (there are five); a code comment says source priority "comes last and is read-only". The next design sync, and every reviewer, will raise these again as defects.
- **To reproduce:**
  1. Static: compare docs/design-brief.md and docs/design/README.md with the code.
- **Evidence:** `docs/design-brief.md:110-141` (the divergences list), `:117-120`, `:130-133`; `docs/design/README.md:378`; `ui/src/routes/configure/ConfigureScreen.tsx:25-27`; `ui/src/routes/configure/rules/RulesPanel.tsx:21-24`; `docs/reqs.md:3236`. Screenshots: `shots/07-sets-delete-switch-02-after-sidebar-switch.png`.
- **Source ids:** SH-28 (static only), CA-09 (confirmed), CA-35 (static only), CB-30 (static only), CB-31 (static only), CP-30 (static only)
- **Severity:** Low. CA-09 was rated Medium; it is rated Low here because the behaviour itself is decided (reqs Q168, listed under Recorded divergences); what is missing is the record.
- **Fix direction:** Add one "Divergences" pass to design-brief.md covering each item, remove the stale notes and fix the comment; if Q168 stands, consider a one-click "Experiment on a copy".

#### UF-023 — Nit — The progress strip draws a black bar, an ungrouped count, and slides 3 px under the tab bar

- **Design says:** "A 6px progress track" in the teal accent, sticky at `top:44px` under a 44 px tab bar, with a grouped count ("1,376 of 1,376") (README.md, Shell, Acquisition progress bar; `.dc.html` l.2713).
- **What happens:** The fill is an SVG rectangle styled with `background`, which SVG ignores, so it paints black. The count reads "1376 of 1376". The tab bar is 47.25 px tall, so the strip, stuck at 44 px, slides 3 px under it.
- **To reproduce:**
  1. With a run in flight (simulated in the browser), open Rank and look at the strip.
- **Evidence:** `ui/src/shell/AcquiringBar.tsx:34-41`; `ui/src/styles.css:146, 191-210, 442-473`; `ui/src/shell/acquiringProgress.ts:20`. Screenshots: `shots/44-unsourced-bar-02-strip-on-rank.png`.
- **Source ids:** HO-42 (found in the browser), SH-30 (static only), SH-31 (confirmed)
- **Severity:** Nit. HO-42 was rated Low; a wrong colour is cosmetic.
- **Fix direction:** Use `fill` on the rectangle, format the count with the shared count formatter, and match the offset to the tab bar's real height.

#### UF-024 — Nit — Dead code, and comments that mislead

- **Design says:** Not specified (code hygiene).
- **What happens:** Shell: `ROUTES[].summary` is never read; the sidebar's idle "Reload" branch cannot run; `.saved-list__remove` and `--content-max-width` are unused. Rank: `detailOf` is used only by tests; `fetchEvaluationCriteria` and `fetchCandidateScoreDetail` have no callers; `.pillar-card__fill--*` is unused; a comment says the ranking does not say why a score is absent (`insufficient_reason` does); another rests on a premise the drill-down endpoint has since removed.
- **To reproduce:**
  1. Static: search for callers.
- **Evidence:** `ui/src/navigation/routes.ts:13-14, 25-45`; `ui/src/shell/Sidebar.tsx:272-278`; `ui/src/styles.css:132, 419-430, 3251-3262`; `ui/src/format/savedRanking.ts:56`; `ui/src/api/endpoints.ts:731-752`; `ui/src/routes/rank/RankingTable.tsx:633-636`; `ui/src/routes/rank/CandidateDetail.tsx:234-238`. No screenshot (found by reading the code).
- **Source ids:** SH-32 (static only), RK-31 (static only)
- **Fix direction:** Delete what is dead (or wire it when the saved-ranking delete and drill-down are built) and correct the comments.

### Configure

46 findings: 2 Critical, 4 High, 15 Medium, 20 Low, 5 Nit.

#### UF-025 — Critical — Delete removes a criteria set, even the one in use, in one click: no confirmation, no history entry, no way back

- **Area:** Stage 1, criteria sets
- **Design says:** Deleting a set "appear[s] in the history with [its] stage and can be undone" (UX-REVIEW.md R6, rated High by the design itself; DECISIONS.md 2026-09-20; `.dc.html` l.2886-2891).
- **What happens:** Delete sends the request at once (204). There is no prompt, no message and nothing in Recent changes. Deleting the set in use silently switches the whole app to the first remaining set by id (in the test, an empty one), so Rank and the sidebar then show errors. The set's weights, locks, rules and gate choices are gone; in the test the shipped set could only be rebuilt through the API from an earlier copy. The red Delete sits next to Duplicate, and the stylesheet itself calls it "the one action here that cannot be undone". The contract refuses a delete only when a saved ranking uses the set.
- **To reproduce:**
  1. Configure stage 1.
  2. Press Delete on the row marked "in use".
- **Evidence:** `ui/src/routes/configure/sets/CriteriaSetsPanel.tsx:126-139`; `ui/src/routes/configure/sets/useCriteriaSets.ts:53-61, 110`; `ui/src/shell/SelectionContext.tsx:100-117`; `ui/src/styles.css:1510`. Screenshots: `shots/07-sets-delete-switch-03-delete-active.png`, `shots/07-sets-delete-switch-04-delete-nonactive.png`.
- **Source ids:** HO-01 (found in the browser), CA-02 (confirmed)
- **Severity:** Critical. The static scan rated it High; on this scale a set's judgements destroyed with no recovery is Critical.
- **Related:** Recent changes coverage is UF-030. Entries from a deleted set also block every older undo (map-history S5, planned with NEW-67).
- **Fix direction:** Arm a confirmation that names what will be lost (the Acquire strip pattern), or delete softly with an undo, and record it in Recent changes; at least confirm before deleting the set in use.

#### UF-026 — Critical — Number fields silently rewrite what is typed and report "Saved.": "72,000" is stored as 72

- **Area:** Stage 2, household, and Stage 6, limits
- **Design says:** A figure is stored as typed or refused with a reason: problems are listed "in an amber notice and mark their fields" (README.md, Round 4 additions, the validation rule). The comparator limit is "1–20" (README.md, Stage 6).
- **What happens:** One shared keystroke filter drops "-" and "e" and turns the first "," into a decimal point. In stage 2, "72,000" (the format the sidebar itself shows, "€72,000.00") is sent as 72, "-5" as 5 and "1e9" as 19, each with "Saved.". In stage 6, "-10" in Minimum coverage is saved as 10; "abc" is saved as unset, which silently switches the coverage floor off; "2.5" comparators becomes 2; a spend cap of "-1" becomes €1 and "1,5" becomes €1.50. The sidebar keeps showing the old figure until a tab change, so nothing on screen reveals a 1,000-fold error.
- **To reproduce:**
  1. Configure stage 2: type 72,000 in the income field and press Save household.
  2. Read the request body: `net_income` is 72.
  3. Stage 6: type -10, then abc, in Minimum coverage and press Save settings.
- **Evidence:** `ui/src/routes/configure/numericInput.ts:12-48`, used by `ui/src/routes/configure/household/householdForm.ts:1` and `ui/src/routes/configure/settings/SettingsPanel.tsx:5`; `ui/src/shell/Sidebar.tsx:237-240` (prints "€72,000.00"). Screenshots: `shots/10-household-05-income-72_000.png`, `shots/10-household-02-income-_5.png`, `shots/10-household-03-income-1e9.png`, `shots/22-settings-02-Minimum-_10.png`, `shots/22-settings-03-Minimum-abc.png`, `shots/22-settings-06-Candidates-2_5.png`, `shots/22-settings-07-Spend-_1.png`. Log: `logs/10-household.json`.
- **Source ids:** HO-11 (found in the browser), HO-22 (found in the browser)
- **Severity:** Re-rated Critical (the browser test rated it High and Medium): typed 72,000 is stored as 72 and reported as Saved, which is a wrong number stored.
- **Related:** The comparator limit's missing 1–20 range, also seen in HO-22, is UF-063.
- **Fix direction:** Keep what the reader types and validate it: refuse a minus sign, an exponent or a thousands separator with a message on the field, and never turn text that is not a number into "unset".

#### UF-027 — High — "Create set" makes an empty set that nothing can fill, and moves the whole app onto it

- **Area:** Stage 1, criteria sets
- **Design says:** Any set other than the default "is created by duplicating it in full" (docs/reqs.md 3.4); the design seeds a new set with even weights across the 11 pillars (`.dc.html` l.2851-2858); stage 3 promises "the total is always 100" (README.md, Stage 3).
- **What happens:** Create sends an id and a name. The server makes a set with no pillar weights and no criteria, and the app switches to it at once. Stage 3 reads "Total 0.0%  This set weighs no pillar yet." with no control to add anything, and the contract has no operation that could. Rank and the sidebar refuse with "ho_test_set scores nothing at level country…" over `cannot_be_ranked`; Compare still offers its form. Duplicate, the only route that works, is never suggested, and the tests treat the empty set as intended.
- **To reproduce:**
  1. Configure stage 1: type "Probe set" and press Create set.
  2. Look at stage 3, Rank and the sidebar.
- **Evidence:** `ui/src/routes/configure/sets/useCriteriaSets.ts:89-97`; `backend/src/starnest/api/criteria.py:500-514`; `backend/src/starnest/criteria/criteria_set.py:391-395`; `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:160-161`; tests `ui/src/routes/configure/sets/CriteriaSetsPanel.test.tsx:42-52`, `ui/e2e/sanity.spec.ts:246-247`. Screenshots: `shots/04-sets-01-after-create.png`, `shots/05-empty-set-01-pillar-panel-empty-set.png`, `shots/05-empty-set-02-rank-empty-set.png`.
- **Source ids:** CA-01 (confirmed), HO-02 (found in the browser)
- **Related:** Rank's dead end for such a set is UF-110.
- **Fix direction:** Make Create a full copy of the default set (or seed even pillar weights and the catalog's criteria on the server); until then, relabel it or point to Duplicate.

#### UF-028 — High — Net income is labelled annual; the requirements, the domain model and the design all say monthly

- **Area:** Stage 2, household
- **Design says:** `net_income` is "Estimated monthly net income … in EUR" (docs/reqs.md 3.9; the same text in `backend/src/starnest/household/household.py:67-69`). Money fields carry "per month", and the sidebar reads "Net income €7,400 / month" (README.md, Stage 2; `.dc.html` l.2604, 2932).
- **What happens:** Stage 2 labels the field "Net annual income" with the suffix "per year", and the sidebar uses the same label. A reader types a yearly figure into a field that the requirements, and any rule that reads it, treat as monthly. The copy of the user's data holds €72,000 under this label, which under the requirements already means €72,000 a month. A rule comparing cost of living with income, which the requirements plan for the city level (docs/reqs.md 7.4), would be off by a factor of 12.
- **To reproduce:**
  1. Read Configure stage 2's income label and suffix.
  2. Read the sidebar's household card.
- **Evidence:** `ui/src/format/vocabulary.ts:15`; `ui/src/routes/configure/household/HouseholdPanel.tsx:124-132`; `ui/src/shell/Sidebar.tsx:237-240`; `storage/migrations/0105-catalog-household-fields.sql:9-10`. Screenshots: `shots/s2-40-configure-01-CA-03-household-labels.png`.
- **Source ids:** CA-03 (confirmed), SH-06 (confirmed)
- **Severity:** Kept High, not Critical: nothing reads net income at country level yet. It becomes a wrong score the day a rule does.
- **Related:** The other household words are UF-049.
- **Fix direction:** Decide the period (the requirements say monthly), change the label, the suffix and the stored figure together, and ask the user to check the stored value.

#### UF-029 — High — Household edits reach no gate, although stage 2 says every gate reads them

- **Area:** Stage 2, household, and Stage 4, gates
- **Design says:** "Citizenship drives the citizenship gates. A British or Irish passport clears the UK skilled-worker gate; a Swiss one clears the EU/EFTA quota gate." (README.md, Interactions & behaviour; UX-REVIEW.md R5; DECISIONS.md 2026-09-20). The EU/EEA free-movement gate is "automatic while that citizenship is EU" (docs/reqs.md 7.3). Stage 2's lead: "Every attribute default, warning and gate reads these."
- **What happens:** Gates act only on recorded answers. Citizenship reaches only the paid research prompt; the ranking reads only the home country, and the compound rules that read a household field belong to the city level. With answers recorded that rule the UK and Switzerland out, adding British and Swiss passports and saving changed nothing: stage 4 still read "Removes United Kingdom." and Rank still showed both as Not matching. Nothing says the answers were recorded for a different household, and there is no screen to re-ask or correct them. The free-movement gate is derived from nothing, so it never fires.
- **To reproduce:**
  1. Record a "not matching" answer for UK Skilled Worker × United Kingdom (there is no screen for it; the test used the API).
  2. Configure stage 2: add British citizenship and press Save household.
  3. Read stage 4 and Rank.
- **Evidence:** `ui/src/routes/configure/household/HouseholdPanel.tsx:86-88`; `backend/src/starnest/household/household.py:173` (`holds_citizenship_of`, never called); `backend/src/starnest/evaluation/ranking.py:82-84`; `backend/src/starnest/data_acquisition/research.py:114-139`. Screenshots: `shots/s2-90-gates-01-R5-gates-before.png`, `shots/s2-90-gates-02-R5-gates-after.png`, `shots/s2-90-gates-03-R5-rank-after.png`.
- **Source ids:** CA-04 (confirmed), CB-12 (confirmed)
- **Severity:** High, the rating of its most serious part; CB-12 (Medium) rated it lower.
- **Related:** Extends map-gates S6 (the free-movement gate is never derived); overlaps BE-36 (its household-change policy) and UI-29 (no screen to record or correct an answer).
- **Fix direction:** Decide BE-36's household-change policy, derive the free-movement gate from citizenship, and mark answers recorded under other citizenships as needing a re-check; until then, make stage 2's lead true.

#### UF-030 — High — Recent changes misses criteria-set, household, source and limit edits, and "Back to where I started" leaves them changed

- **Area:** Change history
- **Design says:** The history lists "every weight, lock, rule, source, limit and household edit… Back to where I started resets the session" (UX-REVIEW.md E). Creating, renaming, duplicating and deleting a set "appear in the history with their stage and can be undone" (UX-REVIEW.md R6). Entries read "Stage 5, Source priority" and "Stage 6, Acquisition limits" (`.dc.html` l.2639, 3006-3025).
- **What happens:** Only a criterion's weight and lock are recorded. Creating, renaming, duplicating, deleting and switching sets, saving the household, switching or moving a source, and saving a limit leave no entry. In one session with an attribute-weight change, a maximum rent of 2600, a comparator limit of 6 and Numbeo switched off, the rail listed only the weight entries. "Back to where I started" restored the weights exactly, but left the rent at 2600, the limit at 6 and Numbeo off, with nothing on screen saying so. Each of those changes moves scores at once.
- **To reproduce:**
  1. In one Configure visit: move an attribute weight, save the household, save a limit, switch a source off.
  2. Read the rail.
  3. Press "Back to where I started".
- **Evidence:** `ui/src/routes/configure/useCriteriaEditor.ts:155, 214` (the only calls that record); `ui/src/routes/configure/sets/useCriteriaSets.ts:53-61`; `ui/src/routes/configure/household/useHouseholdForm.ts:56-77`; `ui/src/routes/configure/sources/useDataSources.ts:46-81`; `ui/src/routes/configure/settings/useSettingsForm.ts:45-63`; `ui/src/routes/configure/RecentChanges.tsx:89-91`. Screenshots: `shots/18-history-01-rail-after-changes.png`, `shots/18-history-04-after-back-to-start.png`, `shots/07-sets-delete-switch-03-delete-active.png`.
- **Source ids:** CB-01 (confirmed), CA-06 (confirmed), HO-04 (found in the browser), HO-18 (found in the browser)
- **Severity:** High, the rating of its most serious part; CA-06 (Medium), HO-04 (Medium) and HO-18 (Medium) rated it lower.
- **Related:** Extends NEW-67, which covers pillar weights and locks, rules, gates and compound rules. Its recommended option D1(a) would still leave all of these out; this is its option D1(b).
- **Fix direction:** When deciding NEW-67's scope, weigh R6 and E: record at least set create, rename, duplicate and delete, household saves, source switches and moves, and limit saves, each with its reverse request; or say on the rail that it covers weights only.

#### UF-031 — Medium — A set used by a saved ranking can never be deleted, and the refusal is database text

- **Area:** Stage 1, criteria sets
- **Design says:** The contract refuses the delete with 409 when the set is in use (README.md, Contract bindings); refusals are said in plain words, with no identifiers (README.md, Deviations 8).
- **What happens:** Delete is offered on every set. On a set that a saved ranking was computed from, the refusal reads "the criteria set 'ho_scratch' cannot be discarded because a saved evaluation was computed from it: update or delete on table "criteria_set" violates foreign key constraint "evaluation_criteria_set_fkey"…" over `criteria_set_in_use`. Saved rankings cannot be deleted, so such a set can never be deleted either.
- **To reproduce:**
  1. Save a ranking on a set.
  2. Configure stage 1: press Delete on that set.
- **Evidence:** `backend/src/starnest/storage/criteria_store.py:166-171`; `ui/src/routes/configure/sets/CriteriaSetsPanel.tsx:50`; `docs/openapi.yaml` (no `DELETE /evaluations`). Screenshots: `shots/s2-40-configure-10-CA-13-delete-refused.png`.
- **Source ids:** CA-13 (confirmed)
- **Related:** Saved rankings that cannot be deleted are UF-013; the raw text is part of UF-003.
- **Fix direction:** Show Delete as unavailable on such a set, with a sentence naming the saved rankings that hold it, and decide whether saved rankings can be deleted.

#### UF-032 — Medium — Rename accepts a name another set already has

- **Area:** Stage 1, criteria sets
- **Design says:** A taken name cancels the rename (`.dc.html` l.2871); names are how the reader tells sets apart.
- **What happens:** Renaming a set to "Remote only" succeeds (PATCH 200). The stage 1 list and the sidebar select then show two identical "Remote only" entries. Create refuses a taken name; Rename does not, and the server checks only ids. Because edits write through, picking the wrong one edits the wrong set.
- **To reproduce:**
  1. Stage 1: rename any set to the name of another and press Save.
  2. Open the sidebar select.
- **Evidence:** `ui/src/routes/configure/sets/useCriteriaSets.ts:80-88`; `backend/src/starnest/storage/criteria_store.py:86-89`; `storage/migrations/0009-criteria.sql:13-18` (no unique name). Screenshots: `shots/06-sets-manage-02-rename-to-existing.png`.
- **Source ids:** CA-16 (confirmed), HO-03 (found in the browser)
- **Severity:** Medium, as the browser test rated it (the static scan said Low): it leads to editing the wrong set.
- **Fix direction:** Refuse a taken name in the form, which has the list, and on the server.

#### UF-033 — Medium — Unsaved edits in the household, the rule editor and the limits are dropped without a word, and stage 6 warns about edits it has not saved

- **Area:** Stages 2, 3 and 6, forms
- **Design says:** In the design, edits apply as they are made (`.dc.html` l.2597-2610, 2633-2640), and any route that would replace work goes through a guard (README.md, Interactions & behaviour). Stage 6's banner reports what Rank, Compare and the sidebar show (README.md, Stage 6).
- **What happens:** The household and the limits are Save forms and the rule editor keeps a draft per row. None marks an edit as unsaved, and leaving the tab, closing the pillar or switching sets drops the edit silently: an unsaved income of 99,999 came back as the stored 80,000, and a changed Goal was gone after the pillar was reopened. "Save household" is enabled before any edit. Stage 6's banners follow the unsaved draft: clearing the score range raises "Nothing can be ranked…" while Rank still ranks, and typing a value hides it while Rank still refuses.
- **To reproduce:**
  1. Stage 2: change Target monthly spend, do not save, open Rank, come back.
  2. Stage 3: change a rule's Goal, close and reopen the pillar.
  3. Stage 6: clear "Top of the score range" without saving and open Rank.
- **Evidence:** `ui/src/routes/configure/household/HouseholdPanel.tsx:194-201`; `ui/src/routes/configure/criteria/useCriterionRule.ts:73`; `ui/src/routes/configure/settings/SettingsPanel.tsx:34-37, 69-87`; `ui/src/routes/configure/settings/useSettingsForm.ts:32`. Screenshots: `shots/s2-40-configure-07-CB-07-unsaved-clear.png`. Log: `logs/s2-40-configure.json`, `logs/10-household.json`.
- **Source ids:** CA-12 (confirmed), CB-07 (confirmed)
- **Related:** Extends NEW-55 ("Saved." stays while the form is edited again), which only clears that word.
- **Fix direction:** Mark a draft that differs from what is stored ("Not saved yet"), say that stage 6's banners describe the draft, and warn before leaving with unsaved edits; or save each field as it changes, as the design does.

#### UF-034 — Medium — Criteria that are not scored look exactly like scored ones

- **Area:** Stage 3, weights and rules
- **Design says:** An excluded criterion's weight is shared out across the rest of its pillar (docs/reqs.md 8.2); a weight that does not count is labelled "Weight redistributed" (README.md, Stage 3).
- **What happens:** Configure never reads whether a criterion is scored. Climate zone, International employers and Remote work tax treaty, which the shipped sets do not score (in Local employment they hold 15.0%, 20.0% and 8.1% of their pillars), each show a live slider, a weight share, a bar and the usual chips, possibly "Required". Moving their sliders cannot change the ranking, and the shares shown for their siblings are not the shares that count: Career's tech share reads 63.3% and counts about 79%.
- **To reproduce:**
  1. Configure stage 3: open Climate and find "Climate zone" (15.0%).
  2. Compare with the API, which says it is not scored.
- **Evidence:** `ui/src/routes/configure/criteria/CriteriaPanel.tsx:363-452`; `ui/src/routes/configure/criteria/criterionReading.ts:141-167`; `is_scored` is read only in `ui/src/routes/rank/pillarFilter.ts:80` and `ui/src/routes/rank/pillarCompleteness.ts:54`; migration `0122`. Screenshots: `shots/s2-40-configure-02-CA-07-climate-zone-row.png`.
- **Source ids:** CA-07 (confirmed)
- **Related:** Extends NEW-58 (its Rank twin: "Required" on an excluded criterion) and map-saved D6 and N8 (what Configure's chip and checkbox should say about such a criterion).
- **Fix direction:** Mark such rows "Not scored, matching only", hold or hide the slider (or show the share that counts), and drop "Required" on them.

#### UF-035 — Medium — The "every other weight is locked" refusal is wrong in three of its four cases, names no pillar, and outlives its cause

- **Area:** Stage 3, weights and rules
- **Design says:** "If every other weight is locked the change is refused with a banner naming up to three to unlock" (README.md, Interactions & behaviour; UX-REVIEW.md G).
- **What happens:** The server refuses a move with `weights_all_locked` in four cases: the moved weight is itself locked, it is the only one, every sibling is locked, or the locked siblings hold all the room. The screen says "Every other weight in this pillar is locked, so there is nothing to rebalance into." for all four, prints the code, and says "in this pillar" for a pillar move. Dragging a locked criterion's own slider previews a move, then lists that same criterion as the lock in the way (the server had said "country.rule_of_law is itself locked"). Pillar refusals name no pillar, locked sliders are not held, and both banners stay after the locks are released.
- **To reproduce:**
  1. Stage 3: lock one Governance criterion and drag its own slider.
  2. Lock Economy and drag Economy.
  3. Lock every pillar but Health and move Health.
  4. Unlock and look at the banner.
- **Evidence:** `ui/src/api/errorPresentation.ts:58-61`; `backend/src/starnest/criteria/rebalancing.py:95-125`; `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:140, 356-363`; `ui/src/routes/configure/criteria/CriteriaPanel.tsx:370-388`; test `ui/src/routes/configure/ConfigureScreen.test.tsx:639-649`. Screenshots: `shots/s2-40-configure-03-CA-08a-own-locked-slider.png`, `shots/13-pillars-05-refusal.png`, `shots/14-locks-attrs-01-locked-slider-clicked.png`.
- **Source ids:** CA-08 (confirmed), HO-17 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; HO-17 (Low) rated it lower.
- **Related:** Moving the banner beside the locks is parked backlog item [14] (UX-REVIEW.md); the held look of a locked slider is NEW-46.
- **Fix direction:** Word each case from the refusal's details, naming up to three locks (or "this weight is locked: unlock it first"); hold a locked slider; clear the banner when the locks change.

#### UF-036 — Medium — A refused rule save is reported out of view, with ids and a code, and the form snaps back

- **Area:** Stage 3, weights and rules
- **Design says:** Problems are listed "in an amber notice and mark their fields" (README.md, Round 4 additions, the hand-entry validation the rule editor should share); no identifiers on screen (README.md, Deviations 8).
- **What happens:** With Goal set to "target_range" and no band, Save rule goes to the server, which refuses with "country.economic_outlook aims at a target range but names no band…" over `invalid_criterion`. The message appears (twice) at the top of the pillar's attribute list, out of view, inside a notice written for weight refusals. The form returns to the stored rule (the restore chosen in P55), so the fields jump back with no reason nearby. Nothing is checked before sending.
- **To reproduce:**
  1. Stage 3: open Economy, then "Edit the rule for Economic outlook".
  2. Set Goal to target_range, leave the band empty.
  3. Press Save rule without scrolling.
- **Evidence:** `ui/src/routes/configure/useCriteriaEditor.ts:239-262`; `ui/src/routes/configure/criteria/CriteriaPanel.tsx:130-132, 488`; `ui/src/routes/configure/criteria/useCriterionRule.ts:84-92`. Screenshots: `shots/17-rule-refusal-01-after-refusal-viewport.png`. Log: `logs/16-rule-editor.json`.
- **Source ids:** CA-14 (confirmed), HO-14 (found in the browser)
- **Fix direction:** Check the band and anchors in the form, show a server refusal in words inside the form's problem list, and keep the refused values visible beside the stored rule.

#### UF-037 — Medium — The rule editor and the "Accept an uncapped spend" checkbox have no layout styles: fields sprawl, and a click anywhere on a line ticks the consent

- **Area:** Stage 3 rule editor, and Stage 4 gate research
- **Design says:** Every screen is built in the design's own idiom (docs/design-brief.md); a checkbox is a control with its own states (docs/design-brief.md, Interaction states); accepting an uncapped spend is an explicit act (README.md, Contract bindings; UX-REVIEW.md D).
- **What happens:** The stylesheet has no rule for the rule editor's layout classes or for the inline checkbox field. In the rule editor, selects and number boxes run the full card width, labels sit at body size on their own lines, the "Missing figure blocks scoring" checkbox floats mid-line away from its label, and Save rule and Discard are cramped. In gate research, the "Accept an uncapped spend for this pass" checkbox takes the 891 px width of a text field: its square floats mid-panel above its label, and a click 400 px away from it ticks it.
- **To reproduce:**
  1. Stage 3: open Economy, then "Edit the rule for Cost of living index".
  2. Stage 4: estimate the research (simulated, as no model is configured) and click the empty line above "Accept an uncapped spend".
- **Evidence:** `ui/src/routes/configure/criteria/CriterionRuleFields.tsx:45-301`; `ui/src/routes/configure/proposals/ProposalsPanel.tsx:75, 142`; `ui/src/styles.css` (no rule for `.rule-form*` or `.field--inline`). Screenshots: `shots/16-rule-editor-01-target-range-no-band.png`, `shots/17-rule-refusal-01-after-refusal-viewport.png`, `shots/s2-89-checkbox-01-HO-54-uncapped-checkbox.png`.
- **Source ids:** HO-13 (found in the browser), HO-54 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; HO-54 (Low) rated it lower.
- **Related:** Confirms and extends NEW-46-S2 (map-ui), which found these classes have no rule but could not see the effect.
- **Fix direction:** Add the missing layout rules (a checkbox beside its label, rows and groups on the stage grid), and guard them with a test that fails on a class used in markup that has no rule.

#### UF-038 — Medium — Recent changes is not the design's rail: no single-change undo, no preview, the withdrawn "after it" wording, raw numbers and grey labels

- **Area:** Change history
- **Design says:** "Undo this — undoes that change alone… Offered only when no later change touched the same state"; "↑ Undo all N — that change and everything above it"; hovering "previews its scope: affected entries turn #fffaeb and strike through"; "Held by a later change to the same setting."; the stage in small uppercase teal, "STAGE 3, PILLAR WEIGHTS"; changes read "Weight — Economy to 25.0%" (README.md, Change history rail; UX-REVIEW.md round 3; DECISIONS.md 2026-09-20).
- **What happens:** Each older entry offers only "Undo this and the N after it", the wording the design withdrew because "after" points down a list that runs newest first. There is no single undo, no "Held by…" note and no tooltip stating the consequence, and hovering changes nothing. Entries print raw floats ("7.638357010500309 to 0"), the stage reads "Pillar weights" in grey sentence case, and the count reads "N in this session".
- **To reproduce:**
  1. Stage 3: move two different attribute weights.
  2. Read the older entry's button and hover over it.
- **Evidence:** `ui/src/routes/configure/changeHistory.ts:133-138`; `ui/src/routes/configure/useChangeHistory.ts:84-85`; `ui/src/routes/configure/RecentChanges.tsx:117-158`; `ui/src/styles.css:1648-1697`; `ui/src/routes/configure/useCriteriaEditor.ts:147, 158`. Screenshots: `shots/15-attr-weights-03-history-after-attr-weights.png`, `shots/18-history-02-rail-hover-preview.png`, `shots/18-history-03-after-undo-through.png`.
- **Source ids:** CA-05 (confirmed), HO-16 (found in the browser), HO-19 (found in the browser), CA-32 (confirmed)
- **Severity:** Medium, the rating of its most serious part; HO-19 (Low) and CA-32 (Nit) rated it lower.
- **Related:** The raw floats are map-history S4, already planned with NEW-67's label decision (D6).
- **Fix direction:** Add single undo (withheld, with the "Held by…" note, when a newer entry touched the same target), rename the rewind "↑ Undo all N", add the hover preview and tooltips, and style the stage label as designed.

#### UF-039 — Medium — Rule rows do not say what a rule tests: compound rules print raw enums, gates say only "Asked at country level."

- **Area:** Stage 4, rules and gates
- **Design says:** Each row has "the rule name and description" (README.md, Stage 4), for example "Comfortable today, projected heat days above 35 °C by 2050." (`.dc.html` l.1542); no programmatic identifiers (README.md, Deviations 8).
- **What happens:** Compound rules read "AllConditionsHold, and warnings when it fires.", a raw enum in broken grammar, and a unit test pins those words. Gates read "Asked at country level.", which says nothing about what "EU/EEA free movement" or "Not manually excluded" checks, or that the first is never derived. The contract gives a gate no description. The info callout repeats the stage subtitle.
- **To reproduce:**
  1. Configure stage 4: read each rule row.
- **Evidence:** `ui/src/routes/configure/rules/RulesPanel.tsx:95, 127`; test `ui/src/routes/configure/rules/RulesPanel.test.tsx:130-139`; `docs/openapi.yaml:1553-1559`; `storage/migrations/0103-catalog-rules.sql:34-36`. Screenshots: `shots/20-rules-01-rules-initial.png`.
- **Source ids:** CB-03 (confirmed), CB-16 (static only; seen in HO-20), HO-20 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; CB-16 (Low) and HO-20 (Low) rated it lower.
- **Fix direction:** Write compound descriptions from their conditions (attribute names and bands, already in the contract), add a description to gates seeded from reqs 7.3's "Matches when" column, and test the wording rather than the enum.

#### UF-040 — Medium — A rule's cost line never names whom a compound rule flags, and is red even when a rule costs nothing or is switched off

- **Area:** Stage 4, rules and gates
- **Design says:** The third line states what the rule costs: "Removes United Kingdom.", "Flags 3 countries: …", "Applies to no country right now.", gaining "— not while this is off." (README.md, Stage 4; UX-REVIEW.md O). It is dim when nothing is affected or the rule is off, red for an active gate, amber for a warning, and an off rule's name and description are dimmed (`.dc.html` l.2987-2990).
- **What happens:** An applied compound rule reads "Applied. Who it flags right now is shown on Rank." while Rank flags Bulgaria, Croatia, Hungary and Romania with "Mild now, brutal later"; the ranking already carries each warning's rule. Every gate's line is red, including "No answer has been recorded for this rule, so it never fires.", and it stays red when the gate is switched off. Nothing is dimmed, and no line says "— not while this is off.".
- **To reproduce:**
  1. Configure stage 4: read the compound rules' third lines.
  2. Switch the UK gate off and read its row.
- **Evidence:** `ui/src/routes/configure/rules/ruleEffect.ts:91-95`; `ui/src/styles.css:2533-2570`; `ui/src/routes/configure/rules/RulesPanel.tsx:106`. Screenshots: `shots/20-rules-01-rules-initial.png`, `shots/s2-40-configure-06-CB-15-uk-off.png`, `shots/03-rank-cols-01-scrolled-right.png`.
- **Source ids:** CB-05 (confirmed), CB-15 (confirmed)
- **Severity:** Medium, the rating of its most serious part; CB-15 (Low) rated it lower.
- **Fix direction:** Count the live ranking's warnings and exclusions per rule to name who is flagged, choose the colour from the effect, and add a style for a rule that is off.

#### UF-041 — Medium — There is no gate/warning selector, so a gate cannot be softened to a warning or a warning made a gate

- **Area:** Stage 4, rules and gates
- **Design says:** Each rule row ends with a gate/warning select; "switching a gate to 'warning' keeps them ranked with the reason attached; switching a warning to 'gate' excludes them" (README.md, Stage 4 and Interactions & behaviour; DECISIONS.md 2026-09-20).
- **What happens:** The row ends with fixed text, "Gate — removes from the ranking" or "Warning — keeps it, flags it", which looks like a control. The contract has no way to change it (a rule can only be switched on or off, and a compound rule's outcome is catalog data), and no document records the gap.
- **To reproduce:**
  1. Configure stage 4: look at the end of each row.
- **Evidence:** `ui/src/routes/configure/rules/RulesPanel.tsx:87, 120, 212`; `docs/openapi.yaml:484-522`. Screenshots: `shots/20-rules-01-rules-initial.png`.
- **Source ids:** CB-04 (confirmed)
- **Fix direction:** Either record the divergence in design-brief.md (the outcome is catalog data under reqs 3.7a) and stop drawing the text like a control, or add a per-set "as a warning" flag and draw the select.

#### UF-042 — Medium — Source rows show no attribute count, several name the wrong kind, and nothing says what switching one off costs

- **Area:** Stage 5, sources
- **Design says:** Each row shows "its attribute count (or 'not consulted')" (README.md, Stage 5).
- **What happens:** Rows show a coarse kind phrase instead of a count. Stand-ins ("Another country's figure, standing in"), derived attributes and the Eurostat tax estimate all read "published dataset", and the EF English Proficiency Index reads "typed by hand". The 39 rows look alike, though only about 15 sources have adapters: Eurostat, which answers many attributes, several of them blocking, looks the same as ILO, which answers none. Switching off "LLM with web search" also disables gate research, and nothing says so. Configure already loads the catalog that would give the count.
- **To reproduce:**
  1. Configure stage 5: read the rows.
- **Evidence:** `ui/src/routes/configure/sources/sourceReading.ts:25-48`; `docs/openapi.yaml:1203-1209` (`answerable_by`); `ui/src/routes/configure/ConfigureScreen.tsx:38`. Screenshots: `shots/00-baseline-03-configure-full.png`.
- **Source ids:** CB-09 (confirmed)
- **Fix direction:** Count each source's attributes from the catalog and show "N attributes" or "answers nothing yet", correct or drop the kind phrase, and say what switching off a source that answers a blocking attribute does.

#### UF-043 — Medium — Source priority hides per-attribute orders and maximum ages, and its lead overstates what the order decides

- **Area:** Stage 5, sources
- **Design says:** Configure shows "the global default order, plus per-attribute overrides and `max_age`" (docs/reqs.md 8.2); the active value is chosen by freshness first, then priority (docs/reqs.md, the active-value rule, l.1467-1476).
- **What happens:** The lead says a lower number wins. Nothing shows that the total tax rate, homicide rate, cost of living, summer and winter temperature, coastline, elevation, European air connectivity, housing price level and English proficiency name their own order, or that a figure past its maximum age loses to a fresher one lower down. Reordering the list can therefore change nothing for exactly the attributes a reader cares about, with no hint why.
- **To reproduce:**
  1. Compare `GET /v1/attributes` (per-attribute orders and maximum ages) with Configure stage 5.
- **Evidence:** `ui/src/routes/configure/sources/DataSourcesPanel.tsx:51-57`. Screenshots: `shots/00-baseline-03-configure-full.png`.
- **Source ids:** CB-10 (confirmed)
- **Fix direction:** Add a read-only list of attributes that name their own order, with each attribute's maximum age, and reword the lead: "…unless the attribute names its own order, or the figure is past its age".

#### UF-044 — Medium — One drag renumbers every source 1 to n and erases the stored priority tiers

- **Area:** Stage 5, sources
- **Design says:** A new source "simply enters at its global rank", and manual entry ranks last so that a real source "should win automatically" (docs/reqs.md 6.6).
- **What happens:** The shipped priorities are tiers from 10 to 90 that leave room for sources added later. One drag sent 39 requests and rewrote them to 1 to 39 (manual entry from 90 to 39). After that, a source added by a migration at its tier, say 55, would sort below the language model and manual entry, so a hand-typed placeholder would beat a new real source. The tiers were restored after the test; the user's own database has not been dragged.
- **To reproduce:**
  1. Configure stage 5: drag one row.
  2. Read the requests and the stored priorities.
- **Evidence:** `ui/src/routes/configure/sources/sourceOrder.ts:104-112`. Screenshots: `shots/21-sources-01-after-drag.png`.
- **Source ids:** CB-11 (confirmed)
- **Fix direction:** Renumber only the rows a move crosses, keeping the gaps, or add a batch reorder operation that keeps the tier spacing.

#### UF-045 — Medium — An out-of-range limit is refused with a generic sentence that names no field and no rule

- **Area:** Stage 6, limits
- **Design says:** Problems are listed in plain words and their fields marked (docs/design-brief.md, Interaction states, invalid; README.md, Round 4 additions); no error codes (DECISIONS.md 2026-10-23).
- **What happens:** Minimum coverage 150, a comparator limit of 0 or a score range of 0 is refused with "The request does not match what this operation accepts." over `invalid_request`. The server's detail ("min_coverage: Input should be less than or equal to 100") is dropped, no field is marked, and the typed value stays in the box. The form checks only that the text is a number.
- **To reproduce:**
  1. Configure stage 6: type 150 in Minimum coverage.
  2. Press Save settings.
- **Evidence:** `ui/src/routes/configure/settings/settingsForm.ts:129-134`; `backend/src/starnest/api/settings.py:40-44`; `backend/src/starnest/api/errors.py:259-266`; `ui/src/api/errorPresentation.ts:86-89`. Screenshots: `shots/22-settings-01-Minimum-150.png`, `shots/22-settings-04-Candidates-0.png`.
- **Source ids:** CB-08 (confirmed), HO-21 (found in the browser)
- **Fix direction:** Check each bound in the form and state the range in each field's note, and map the refusal's field names onto the fields.

#### UF-046 — Low — Rename is not keyboard-complete

- **Area:** Stage 1, criteria sets
- **Design says:** Renaming swaps the name for an input with Save and Cancel (README.md, Stage 1); docs/design-brief.md says the interface is keyboard navigable.
- **What happens:** Pressing Rename puts focus on the Cancel button that replaced it, not on the name field. Enter in the field does not save, and Escape does not cancel.
- **To reproduce:**
  1. Stage 1: Tab to Rename and press Enter.
  2. Type a name, press Enter, then Escape.
- **Evidence:** `ui/src/routes/configure/sets/CriteriaSetsPanel.tsx:64-71, 84-100`. Screenshots: `shots/06-sets-manage-02-rename-open.png`.
- **Source ids:** CA-15 (confirmed), HO-48 (found in the browser)
- **Related:** Sibling of NEW-56-S3 (map-ui: Rename's Save and Delete drop focus).
- **Fix direction:** Focus and select the field, let Enter save and Escape cancel, and return focus to Rename.

#### UF-047 — Low — "Create set" stays disabled, with no reason, for a name with no Latin letters or digits

- **Area:** Stage 1, criteria sets
- **Design says:** Not specified; a control that cannot act should say why (docs/design-brief.md, Interaction states).
- **What happens:** "Ελλάδα" produces an empty id, so Create set stays grey with no hint and no title.
- **To reproduce:**
  1. Stage 1: type Ελλάδα in the name field.
- **Evidence:** `ui/src/routes/configure/sets/setIdentifier.ts:16-24`; `ui/src/routes/configure/sets/useCriteriaSets.ts:68`. Screenshots: `shots/s2-40-configure-09-CA-17-greek-name.png`.
- **Source ids:** CA-17 (confirmed)
- **Fix direction:** Say why, or build the id from a transliteration or a counter.

#### UF-048 — Low — Set rows do not show their heaviest pillar

- **Area:** Stage 1, criteria sets
- **Design says:** Each row shows "the heaviest pillar as meta" ("heaviest: Economy 14.0%") (README.md, Stage 1; `.dc.html` l.2900).
- **What happens:** No meta is shown, so sets cannot be told apart at a glance. The reason (the list operation serves only id and name) is only in the message of commit `3e93d6b`, and an unused style for the meta carries a comment about showing ids.
- **To reproduce:**
  1. Static: read the set rows.
- **Evidence:** `ui/src/routes/configure/sets/CriteriaSetsPanel.tsx`; `ui/src/styles.css:1475-1481`. No screenshot (found by reading the code).
- **Source ids:** CA-23 (static only)
- **Fix direction:** Add pillar weights to the list response and show the meta, or record the gap in design-brief.md and delete the dead style.

#### UF-049 — Low — The household words, and the sidebar's household values, are not the design's

- **Area:** Stage 2, household
- **Design says:** One vocabulary in both places, in the design's words: "Net income", "Comfortable monthly spend", "Rent ceiling", "Moving from", "Passports held" (DECISIONS.md 2026-09-20, item I; `.dc.html` l.2604-2610, 2929-2936).
- **What happens:** The shared words are "Target monthly spend", "Maximum rent", "Home country candidate" ("candidate" is the model's word, not the reader's) and "Citizenships". The sidebar card is titled "Household summary", leaves out the home city, prints money as "€2,800.00" with no "/ month", and shows "2" rather than "Two". One vocabulary does hold across both places; it is not the design's.
- **To reproduce:**
  1. Read Configure stage 2 and the sidebar's household card.
- **Evidence:** `ui/src/format/vocabulary.ts:14-23`; `ui/src/shell/Sidebar.tsx:204-270`. Screenshots: `shots/s2-40-configure-01-CA-03-household-labels.png`.
- **Source ids:** CA-26 (static only; the words were confirmed under SH-06), CA-34 (static only; visible in the SH-06 screenshot)
- **Severity:** Low, the rating of its most serious part; CA-34 (Nit) rated it lower.
- **Related:** The annual-or-monthly error is UF-028.
- **Fix direction:** Adopt the design's words in the shared vocabulary (the sidebar follows), print money without cents and with the period, or record the divergence.

#### UF-050 — Low — Adults stop at 4 and children at 3, and the design documents still say "number fields"

- **Area:** Stage 2, household
- **Design says:** design-brief.md and UX-REVIEW.md round 4 record "number fields for adults and children" because "the domain has no ceiling" (docs/design-brief.md l.122; UX-REVIEW.md l.263).
- **What happens:** The fields became segmented controls (`2a13d73`) that stop at 4 adults and 3 children. A household of five adults cannot be entered, and if one is stored, no segment is pressed and nothing says 5. Both documents still describe number fields.
- **To reproduce:**
  1. Static: read the household count fields.
- **Evidence:** `ui/src/routes/configure/household/CountField.tsx:1-20`; `ui/src/routes/configure/household/HouseholdPanel.tsx:134-149`. No screenshot (found by reading the code).
- **Source ids:** CA-27 (static only)
- **Fix direction:** Add a "more" segment that opens a number field, or update both documents.

#### UF-051 — Low — Stage 3 prints programmatic identifiers: units, goals and methods

- **Area:** Stage 3, weights and rules
- **Design says:** Type phrases such as "Counted in postings", "A percentage", "Index on EU27=100", never "Type · unit" (README.md, Stage 3); no programmatic identifiers (README.md, Deviations 8).
- **What happens:** Attribute lines read "Measured in eu27_average_100" and "Measured in percent_per_year". The rule editor offers "minimise / maximise / target_range" and "fixed / percentile / as_is", its hints say "Only used by the target_range goal", and the goal chip reads "goal: target_range" (copied from the design's own pill).
- **To reproduce:**
  1. Stage 3: open Economy and read the attribute lines.
  2. Open a rule.
- **Evidence:** `ui/src/routes/configure/criteria/criterionReading.ts:84-117, 148`; `ui/src/routes/configure/criteria/CriterionRuleFields.tsx:64-66, 83-85, 109, 146`. Screenshots: `shots/14-locks-attrs-02-economy-expanded.png`, `shots/16-rule-editor-01-target-range-no-band.png`.
- **Source ids:** CA-21 (static only; seen in HO-15), HO-15 (found in the browser)
- **Related:** Stage 6's "insufficient_data", also seen in HO-15, is UF-064; the compound-rule enums are UF-039.
- **Fix direction:** Word the units, goals and methods (reusing the existing wording for normalisation) in options, hints and chips.

#### UF-052 — Low — Pillar rows omit the unsourced share, and unsourced attributes omit "Weight redistributed"

- **Area:** Stage 3, weights and rules
- **Design says:** Pillar meta reads "6 attributes, 44% of them unsourced"; an unsourced attribute shows "No source yet →" "plus a neutral 'Weight redistributed'" (README.md, Stage 3).
- **What happens:** The meta reads only "4 attributes". Remote work tax treaty shows "No source yet →" but not "Weight redistributed", so nothing on Configure says its weight goes elsewhere, and a pillar resting on unsourced attributes looks complete until it is opened.
- **To reproduce:**
  1. Stage 3: open Economy.
- **Evidence:** `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:311-318`; `ui/src/routes/configure/criteria/criterionReading.ts:169-179`. Screenshots: `shots/14-locks-attrs-02-economy-expanded.png`.
- **Source ids:** CA-22 (confirmed), HO-50 (found in the browser)
- **Fix direction:** Compute the unsourced share from the catalog and the weights, and add the neutral pill.

#### UF-053 — Low — A failed attribute-catalog read is silent, so unsourced attributes look sourced

- **Area:** Stage 3, weights and rules
- **Design says:** One error shape on every screen (README.md, Round 4 additions).
- **What happens:** If the catalog read fails, the "No source yet →" chips and the type lines simply disappear, with no notice.
- **To reproduce:**
  1. Static: read how stage 3 handles a failed catalog read.
- **Evidence:** `ui/src/routes/configure/useAttributeCatalog.ts:15-35`; `ui/src/routes/configure/criteria/criterionReading.ts:191-193`. No screenshot (found by reading the code).
- **Source ids:** CA-28 (static only)
- **Fix direction:** Show a one-line notice with Try again in stage 3.

#### UF-054 — Low — A successful "Save rule" gives no confirmation

- **Area:** Stage 3, weights and rules
- **Design says:** Not specified; the sibling forms say "Saved." in a live region.
- **What happens:** After a valid save the pills change and the button becomes unavailable, but nothing says the rule was saved, so a save looks like nothing happened.
- **To reproduce:**
  1. Stage 3: give Press freedom a threshold of at least 1 and press Save rule.
- **Evidence:** `ui/src/routes/configure/criteria/CriterionRuleFields.tsx:285-301`. Screenshots: `shots/s2-40-configure-05-CA-29-after-save-rule.png`.
- **Source ids:** CA-29 (confirmed)
- **Fix direction:** Add a brief "Saved." in a status region beside the buttons.

#### UF-055 — Low — Locking then unlocking leaves one entry, "Unlocked X", whose undo does nothing

- **Area:** Change history
- **Design says:** Only edits worded "to" or "→" merge; lock toggles stay separate (`.dc.html` l.1831-1835).
- **What happens:** Consecutive changes to the same target merge, so lock-then-unlock leaves one entry whose before and after are both "unlocked". Its undo sends a request that changes nothing.
- **To reproduce:**
  1. Stage 3: lock, then unlock, Press freedom.
  2. Read the rail and press the entry's undo.
- **Evidence:** `ui/src/routes/configure/changeHistory.ts:59-75`; `ui/src/routes/configure/useCriteriaEditor.ts:215`. Screenshots: `shots/s2-40-configure-04-CA-20-rail.png`.
- **Source ids:** CA-20 (confirmed)
- **Related:** Extends map-history S2 (a merged entry shows only its last step).
- **Fix direction:** Drop a merged entry whose before equals its after, or stop merging toggles.

#### UF-056 — Low — A compound rule's kind label ignores its outcome (latent)

- **Area:** Stage 4, rules and gates
- **Design says:** A compound rule's outcome is a warning or `not_matching`, and the latter "is a computed gate" (docs/reqs.md 3.7a).
- **What happens:** Every compound row says "Warning — keeps it, flags it". With an outcome rewritten to `not_matching` in the browser, the row still said "Warning", while its own detail read "…not_matchings when it fires." Both shipped rules warn, so nothing is mislabelled today.
- **To reproduce:**
  1. In the browser, rewrite "Cheap but taxed"'s outcome to `not_matching`.
  2. Read its row.
- **Evidence:** `ui/src/routes/configure/rules/RulesPanel.tsx:120, 127`. Screenshots: `shots/s2-92-latent-01-CB-17-not-matching-rule-label.png`.
- **Source ids:** CB-17 (confirmed †)
- **Fix direction:** Choose the label from the rule's outcome.

#### UF-057 — Low — Rule switches are not held while their change is being saved

- **Area:** Stage 4, rules and gates
- **Design says:** A control looks held while its change is written (docs/design-brief.md, Interaction states); the source switches already do this.
- **What happens:** A rule switch has no in-flight guard and no held look. A second press while the first is being saved sends the same value again, because the switch has not moved yet.
- **To reproduce:**
  1. Static: read the rule switch.
- **Evidence:** `ui/src/routes/configure/rules/RulesPanel.tsx:184-195`; `ui/src/routes/configure/rules/useRuleToggles.ts:91-110`. No screenshot (found by reading the code).
- **Source ids:** CB-18 (static only)
- **Related:** Extends NEW-46 (held controls that look unchanged); here there is no hold at all.
- **Fix direction:** Hold the switch while its request is in flight, with the source switches' held style.

#### UF-058 — Low — Gate research counts every gate in its progress, while its estimate counts only the ones it will ask

- **Area:** Stage 4, gate research
- **Design says:** Progress names "the gate being asked ('gate 2 of 5')" (docs/design-brief.md, gate research section); research asks only the researchable gates (docs/reqs.md 7.3, Q236).
- **What happens:** The estimate says "3 gate answers to research, 3 calls, about €0.42". The pass then walks all five gates, "Asking gate 1 of 5…" to "5 of 5", including EU/EEA free movement and Not manually excluded, which research never asks, and ends "asked every gate, 5 of 5". "About €0.42" sits beside "The cost is a ceiling, not a forecast."
- **To reproduce:**
  1. Stage 4: estimate the research and run the pass (simulated in the browser; no model is configured).
- **Evidence:** `ui/src/routes/configure/proposals/useResearchPass.ts:165`; `ui/src/routes/configure/proposals/researchPass.ts:183-189, 207-209`; `ui/src/routes/configure/proposals/ProposalsPanel.tsx:134-139`. Screenshots: `shots/s2-88-research-01-CB-23-estimate-with-cap.png`, `shots/s2-88-research-02-CB-22-after-pass.png`.
- **Source ids:** CB-22 (confirmed †)
- **Related:** NEW-65 (the pass does not name its level) touches the same lines.
- **Fix direction:** Take the gates from the estimate (or mark researchable gates in the contract), count pairs in both places, and say "at most €X".

#### UF-059 — Low — Gate research offers "Accept an uncapped spend" even when a cap is set, never states the cap, and a missing-cap refusal loses the estimate

- **Area:** Stage 4, gate research
- **Design says:** Before spending, the confirmation states the cap (README.md, 2. Acquire, Confirmation; UX-REVIEW.md D).
- **What happens:** With the €15 cap set, the panel still offers "Accept an uncapped spend for this pass" and states the cap nowhere; the contract ignores the box when a cap exists. A missing-cap refusal prints the server's sentence over its code with no link to stage 6, and the estimate and the "Research the gates" button are gone, so the estimate must be made again.
- **To reproduce:**
  1. Stage 4: estimate the research with a cap set (simulated).
  2. Simulate a missing-cap refusal.
- **Evidence:** `ui/src/routes/configure/proposals/ProposalsPanel.tsx:104, 131-151`; `ui/src/routes/configure/proposals/useResearchPass.ts:162-170`; `ui/src/shell/refusalRemedy.ts:28-32`. Screenshots: `shots/s2-88-research-01-CB-23-estimate-with-cap.png`, `shots/s2-88-research-03-CB-23-refusal-no-cap.png`.
- **Source ids:** CB-23 (confirmed †)
- **Related:** The checkbox's broken layout is UF-037.
- **Fix direction:** Read the settings with the estimate and say "Halts at the €X cap", or offer the box only when no cap is set; keep the estimate after a refusal that spent nothing.

#### UF-060 — Low — Gate proposals show no retrieval date

- **Area:** Stage 4, gate research
- **Design says:** Full provenance on every finding: the source and both dates (CLAUDE.md, design invariants; docs/reqs.md 3.7).
- **What happens:** The proposal table shows the gate, candidate, proposed answer, the period it holds for, the reason and the pages, but not when the model read those pages, so a stale proposal cannot be spotted before it is confirmed.
- **To reproduce:**
  1. Static: no proposal can exist without a configured model.
- **Evidence:** `ui/src/routes/configure/proposals/ProposalsPanel.tsx:205-215`. No screenshot (found by reading the code).
- **Source ids:** CB-28 (static only)
- **Related:** The same table prints raw ids (NEW-66, planned).
- **Fix direction:** Add "Read on <date>" beside "Holds for".

#### UF-061 — Low — The arrows refuse to swap two sources that share a priority, and give no reason

- **Area:** Stage 5, sources
- **Design says:** ▲▼ are disabled only at the ends of the list (`.dc.html` l.3027).
- **What happens:** A move against a neighbour with the same priority is refused, so the arrow is disabled with only "Lower priority" or "Higher priority" as its title, while the positions still read 1, 2, … as if the order were strict. The migrations ship ECB and UNODC at the same priority, but this copy of the data had no tie, so one was made for the test and removed.
- **To reproduce:**
  1. Give two adjacent sources the same priority (through the API).
  2. Try their arrows.
- **Evidence:** `ui/src/routes/configure/sources/sourceOrder.ts:56`; `ui/src/routes/configure/sources/DataSourcesPanel.tsx:155, 172`. Screenshots: `shots/s2-32-tie2-01-CB-24-ecb-row.png`, `shots/s2-32-tie2-02-CB-24-unodc-row.png`.
- **Source ids:** CB-24 (confirmed)
- **Fix direction:** Swap tied sources by giving the pair distinct numbers.

#### UF-062 — Low — Switching off "Manual entry" does not stop hand entry, and the stored figure then silently stops counting

- **Area:** Stage 5, sources
- **Design says:** "Switch one off and nothing is ever acquired from it" (README.md, Stage 5).
- **What happens:** With Manual entry off, Acquire still opens the hand-entry form with "Store this figure" enabled and no warning, and the server accepts the figure. Scoring leaves out figures from switched-off sources, so Portugal's hand-entered Residency admin ease stopped counting (coverage fell from 99.44% to 99.16%) with nothing saying why.
- **To reproduce:**
  1. Stage 5: switch Manual entry off.
  2. Acquire: open "Enter a value by hand".
  3. Rank: open Portugal.
- **Evidence:** `backend/src/starnest/api/values.py:120-152`; `backend/src/starnest/data/active_value.py`. Screenshots: `shots/s2-71-misc-07-CB-25-manual-off-form.png`, `shots/s2-86-partials-03-CB-25-rank-manual-off.png`.
- **Source ids:** CB-25 (confirmed)
- **Related:** How Rank labels such a figure is UF-113.
- **Fix direction:** Refuse hand entry while Manual entry is off, with the reason, or say on the form that the figure will not count until it is switched back on.

#### UF-063 — Low — The comparator limit has no 1–20 range, and leaving it unset blocks Compare while looking advisory

- **Area:** Stage 6, limits
- **Design says:** "comparator limit (1–20, default 5)"; Compare keeps to the same range (README.md, Stage 6; DECISIONS.md 2026-09-20, comparator limit).
- **What happens:** The field shows no range, and neither the form nor Compare enforces 20: 25 and 200 were both saved. The backend asks only for at least 1. A limit of 32 allows 31 columns, a matrix about 3,300 px wide. When it is unset, the field is styled as advisory and the panel's summary says "…the rules behind them are not in force", although Compare refuses every comparison.
- **To reproduce:**
  1. Stage 6: type 25 in "Candidates you can compare at once" and save.
  2. Clear it, read the summary, then press Compare on Compare.
- **Evidence:** `ui/src/routes/configure/settings/settingsForm.ts:74-84`; `ui/src/routes/compare/comparatorLimit.ts:24-27`; `backend/src/starnest/api/settings.py:42`; `ui/src/routes/configure/settings/SettingsPanel.tsx:79-86`. Screenshots: `shots/22-settings-05-Candidates-25.png`.
- **Source ids:** CB-19 (static only; seen in HO-22 and in the CB-08 check), CP-19 (static only; seen in HO-22 and in the CB-08 check)
- **Fix direction:** State "1–20" on the field and enforce it in the form and in Compare, and treat "unset" as blocking Compare in the stage's banner.

#### UF-064 — Low — Stage 6 wording: a raw "insufficient_data", two names for one field, and a cap that seems not to cover research

- **Area:** Stage 6, limits
- **Design says:** No identifiers on screen (README.md, Deviations 8); one vocabulary (README.md, Shell); the spend cap also bounds gate research (`docs/openapi.yaml`, `/match-rule-research`).
- **What happens:** The coverage note reads "Below this, a candidate is insufficient_data." The banner calls the score range "score scale maximum" while its field is "Top of the score range". The cap's note says "per acquisition… A run halts here", which suggests it does not apply to gate research.
- **To reproduce:**
  1. Configure stage 6: read the notes.
  2. Clear the score range and read the banner.
- **Evidence:** `ui/src/routes/configure/settings/settingsForm.ts:60, 68, 89-91`; `ui/src/routes/configure/settings/SettingsPanel.tsx:72`. No screenshot (found by reading the code).
- **Source ids:** CB-26 (static only; "insufficient_data" seen in HO-15)
- **Fix direction:** Write "insufficient data", use "top of the score range" everywhere, and add "and each gate-research pass" to the cap's note.

#### UF-065 — Low — Stages lose their card and heading while loading or after a failure, so the stage numbers shift

- **Area:** All stages
- **Design says:** Six numbered stage cards (README.md, 1. Configure); one error shape that says what failed (README.md, Round 4 additions).
- **What happens:** The household and limits panels return a bare note or error outside their stage card, and the numbers come from a stylesheet counter. While the set loads, the stages read Criteria set, Household, Source priority, Acquisition limits; then Pillar weights and Match rules appear between them and Source priority moves from 3 to 5. A failed settings read puts a `client.unreachable` notice where the "Acquisition limits" heading should be, so nothing says which stage failed.
- **To reproduce:**
  1. In the browser, delay `GET /v1/criteria-sets/{id}` and open Configure.
  2. Make `GET /v1/settings` fail.
- **Evidence:** `ui/src/routes/configure/household/HouseholdPanel.tsx:36-46`; `ui/src/routes/configure/settings/SettingsPanel.tsx:23-28`; `ui/src/styles.css:1101-1104`. Screenshots: `shots/s2-10-shell-sim-08-SH-11-configure-loading.png`, `shots/s2-71-misc-05-CB-27-settings-failed.png`, `shots/43-states-04-configure-error.png`.
- **Source ids:** CA-24 (confirmed †), CB-27 (confirmed †)
- **Fix direction:** Always draw each stage's card and heading, with its loading or error state inside.

#### UF-066 — Nit — A long set name runs under the row's buttons and past the sidebar

- **Area:** Stage 1, criteria sets
- **Design says:** "Buttons never change position" (README.md, Stage 1).
- **What happens:** A 220-character name is drawn through the Use, Rename, Duplicate and Delete buttons, and its id runs out of the sidebar's error card. Nothing limits the length.
- **To reproduce:**
  1. Stage 1: create a set with a 220-character name.
- **Evidence:** `ui/src/styles.css:1452-1457` (the name has no truncation). Screenshots: `shots/04-sets-04-long-name.png`, `shots/06-sets-manage-02-rename-to-existing.png`.
- **Source ids:** HO-49 (found in the browser)
- **Fix direction:** Truncate names with an ellipsis inside their slot (full name in a title) and cap the length.

#### UF-067 — Nit — Stage 3 colours differ from the design: the open pillar is not tinted, and the totals use amber and teal instead of red and green

- **Area:** Stage 3, weights and rules
- **Design says:** The open row's background is `#f0fdfa`; the total pill is green at 100 and red otherwise (README.md, Stage 3).
- **What happens:** The open pillar row is transparent. The stage total turns amber when off 100, while the in-pillar total is teal at 100 and red when off: two colour codes for one rule.
- **To reproduce:**
  1. Stage 3: open a pillar.
  2. In the browser, make the weights sum to 105.
- **Evidence:** `ui/src/styles.css:1185-1193`; `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:152, 325`; `ui/src/routes/configure/criteria/CriteriaPanel.tsx:186-190`. Screenshots: `shots/s2-87-ca31-01-CA-31-off-100-simulated.png`. Log: `logs/s2-40-configure.json`.
- **Source ids:** CA-30 (confirmed), CA-31 (confirmed †)
- **Fix direction:** Tint the open row, and use green and red in both totals.

#### UF-068 — Nit — Two explanatory paragraphs, with "backend" jargon, open inside every pillar

- **Area:** Stage 3, weights and rules
- **Design says:** The block has a header line and a total pill only (README.md, Stage 3).
- **What happens:** Each opened pillar starts with two paragraphs, one of them saying "…which the backend computes and this panel reports".
- **To reproduce:**
  1. Stage 3: open any pillar.
- **Evidence:** `ui/src/routes/configure/criteria/CriteriaPanel.tsx:113-126`. No screenshot (found by reading the code).
- **Source ids:** CA-33 (static only)
- **Fix direction:** Remove them, or move them into a help tip.

#### UF-069 — Nit — Stage 4 says the same thing twice, nests a heading wrongly, and its switch has no tooltip

- **Area:** Stage 4, rules and gates
- **Design says:** A callout only, with no subtitle; the switch's title "Apply this rule" (`.dc.html` l.604-618).
- **What happens:** The stage's lead repeats the callout. "Gate proposals" is an `h3` inside the stage's `h3`, below `h4` lists. The switch has no title.
- **To reproduce:**
  1. Configure stage 4: read the top of the stage.
- **Evidence:** `ui/src/routes/configure/rules/RulesPanel.tsx:56-60, 69-79`; `ui/src/routes/configure/proposals/ProposalsPanel.tsx:63`. Screenshots: `shots/20-rules-01-rules-initial.png`.
- **Source ids:** CB-29 (static only; the repeated text seen in HO-20)
- **Fix direction:** Drop the lead or the callout, make the proposals heading an `h4`, and add the title.

#### UF-070 — Nit — The spend cap reads "5" after a save, not "5.00"

- **Area:** Stage 6, limits
- **Design says:** `5.00` (`.dc.html` l.1682; screen 04).
- **What happens:** The saved cap is shown as plain text of the number, so money loses its cents.
- **To reproduce:**
  1. Static: read how the saved cap is put back in the field.
- **Evidence:** `ui/src/routes/configure/settings/settingsForm.ts:164-166`. No screenshot (found by reading the code).
- **Source ids:** CB-32 (static only)
- **Fix direction:** Show the cap with two decimals.

### Acquire

32 findings: 3 Critical, 3 High, 12 Medium, 12 Low, 2 Nit.

#### UF-071 — Critical — A hand-entered score is scored without its scale: "7 on 0–10" counts as 7 out of 100

- **Area:** Hand entry
- **Design says:** The form asks for Score, Scale lowest and Scale highest, "required — a score means nothing without its scale" (README.md, Round 4 additions, hand entry). A figure on a declared scale is rescaled from it (docs/reqs.md 3.3a; the header of `backend/src/starnest/evaluation/normalisation.py`).
- **What happens:** Storing Residency admin ease = 7 on 0–10 for Portugal reads back "Stored 7 on 0–10", but the server scores it as 7 out of 100: the drill-down shows "Score 0–100: 7", and Portugal's Governance pillar fell from 49 to 42, the opposite of what 7 out of 10 means. Only an Index passes its declared bounds to scoring; an assigned score's scale is stored and then ignored. Any scale other than 0–100 silently gives a wrong score, and the form does not say that only 0–100 is honoured. This is not UI-18 (the interface assuming 100): here the server scores the raw 7.
- **To reproduce:**
  1. Acquire: "Figures you can enter by hand", Residency admin ease, Portugal: Score 7, Scale 0 to 10, both dates, Store this figure.
  2. Rank: open Portugal, then Governance.
- **Evidence:** `backend/src/starnest/evaluation/magnitudes.py:139-150` (bounds are passed for an Index only); `backend/src/starnest/evaluation/normalisation.py:205-221`; `backend/src/starnest/data/payloads.py:244-257` (an assigned score carries its scale). Screenshots: `shots/32-hand-entry-store-02-stored.png`, `shots/34-rank-02-portugal-governance.png`.
- **Source ids:** HO-32 (found in the browser)
- **Fix direction:** Rescale an assigned score from its declared scale, exactly as an Index is, and add a test that 7 on 0–10 scores 70 on a 0–100 scale.

#### UF-072 — Critical — Money spent on gate research is left out of "Spent this month" and disappears from every screen once the pass ends

- **Area:** What the database holds, and gate research
- **Design says:** "'What has this month cost?' is a sum over the runs and that table" (docs/reqs.md 3.8, Q236); Acquire shows "spend this month" (README.md, 2. Acquire). Gate research is "the most expensive thing here" (CLAUDE.md). design-brief.md calls the pass's outcome line "the one place on this screen that reports money already spent".
- **What happens:** "Spent this month" adds up acquisitions only; it read €12.75, this month's run costs to the cent. After a research pass that reported "it made 3 calls and spent €0.42" (simulated, as no model is configured), Acquire still read €12.75. The research spend ledger has no read operation, so a real pass could not be counted either. The pass's outcome line is the only place the money appears, and it is gone after one visit to another tab.
- **To reproduce:**
  1. Configure stage 4: run a research pass (simulated) and read its outcome line.
  2. Open Acquire and read "Spent this month".
  3. Return to Configure.
- **Evidence:** `ui/src/routes/run/databaseHolds.ts:57-67`; `ui/src/routes/run/DatabaseHoldsPanel.tsx:128-136`; `ui/src/routes/configure/proposals/useResearchPass.ts:78-88`; migration `0503`; `docs/known-issues.md:349` (P28: the ledger is "write-only"). Screenshots: `shots/s2-84-spend-01-AQ-02-spent-this-month.png`, `shots/s2-91-research-spend-01-AQ-02-pass-outcome.png`, `shots/s2-91-research-spend-02-AQ-02-spent-after-pass.png`, `shots/s2-91-research-spend-03-CB-02-after-leaving-configure.png`.
- **Source ids:** AQ-02 (confirmed †), CB-02 (confirmed †)
- **Severity:** Critical. CB-02 rated it High; on this scale money hidden is Critical, and the omission is permanent once the pass's line has gone.
- **Fix direction:** Add a read of the research ledger (a monthly total is enough) and include it in "Spent this month", or show research spend beside it; keep the last pass's outcome until it has been read.

#### UF-073 — Critical — The acquisition diff calls re-confirmed figures "went missing" and leaves them out of "Unchanged"

- **Area:** What changed between two acquisitions
- **Design says:** Four counts: newly acquired, refreshed (the figure moved), unchanged ("asked again, same figure"), went missing ("the later run produced none") (README.md, Round 4 additions; UX-REVIEW.md round 4, B2; screen 34).
- **What happens:** Re-reading a transcribed table (RSF, EF EPI, MIPEX, PISA, sunshine normals, OECD family tables, WDPA and others) writes no new value; the run only records that it re-confirmed the figure. The diff reads values only. Run 132 (Portugal × Press freedom, free) was reported as "Finished. 1 figure stored.", with "1 answered" in the history and "Values filled 1 of 1", yet the diff of run 132 against itself said "Neither acquisition produced a figure for any candidate", and against run 131 it showed Unchanged 0. Comparing the run that first stored a table with a later full run would list every re-confirmed pair as "went missing" (that variant could not arise in the test copy, whose tables came from migrations).
- **To reproduce:**
  1. Acquire: estimate and run a one-item acquisition over a transcribed attribute (free).
  2. In "What changed between two acquisitions", compare it with itself and with the previous run.
- **Evidence:** `ui/src/routes/run/AcquisitionDiffPanel.tsx:43-55`; `ui/src/api/endpoints.ts:329-339`; `ui/src/routes/run/acquisitionDiff.ts:85-127`; `storage/queries/values.sql:240-255`; `storage/queries/runs.sql:217-227`; migration `0501`. Screenshots: `shots/s2-82-aq01-run-01-AQ-01-run-card.png`, `shots/s2-82-aq01-run-02-AQ-01-diff-132-132.png`, `shots/s2-82-aq01-run-03-AQ-01-diff-131-132.png`.
- **Source ids:** AQ-01 (confirmed)
- **Fix direction:** Serve each run's re-confirmed pairs (on the run, or with the values) and count them as unchanged.

#### UF-074 — High — Items nobody was asked are reported as "unanswered: every source answered, none had a row. Retrying changes nothing"

- **Area:** Progress card and gap cards
- **Design says:** The unanswered card means "Every source answered, none had a row. Retrying changes nothing." (README.md, 2. Acquire). After a stop, "sources never begun read 'not reached'" (README.md, Round 4 additions, Stop). The overall bar is done out of total (`.dc.html` l.2733-2740).
- **What happens:** Any item with no figure and no failure counts as unanswered, whatever the run's state. Right after a start, run 131 read "0 of 2 answered, 0 failed, 2 unanswered" and the yellow card below already said "2 unanswered — Every source answered, and none had a row. Retrying the same sources changes nothing." with live Retry buttons. After a Stop (run 130), Open-Meteo's items, which no source was ever asked, sat in that card for good, and the outcome read "…2 nobody answered". The bar is always full. The same happens permanently after a cap halt or a crash. The advice is the opposite of the right action.
- **To reproduce:**
  1. Acquire: select two failed items in an earlier run, press Retry 2 selected, then Yes, start it.
  2. Read the card within the first second; or press "Stop — keep what completed" at once and read the card afterwards.
- **Evidence:** `storage/queries/runs.sql:239-260, 275-299`; `ui/src/routes/run/runProgress.ts:37-63`; `ui/src/routes/run/RunScreen.tsx:176-222`; `ui/src/routes/run/DatabaseHoldsPanel.tsx:114-121`; `ui/src/routes/run/sourceReach.ts:79-101`; `docs/openapi.yaml:1739-1741`. Screenshots: `shots/29-run-b-02-rank-acquiring-bar.png`, `shots/28-run-a-02-after-stop-click.png`, `shots/28-run-a-06-card-after-refresh.png`.
- **Source ids:** AQ-03 (confirmed), HO-24 (found in the browser), HO-25 (found in the browser)
- **Severity:** Kept High, not Critical: the counts add up, but the label and the advice are false; no stored figure is wrong.
- **Related:** Extends map-runs §7.8 C5, which noted only the in-flight case. That the card does not move on its own is UI-24 (planned).
- **Fix direction:** Count "not reached" apart from "unanswered" (a backend count for runs that did not complete), draw it as the empty part of the bar, and hold the unanswered verdict and its retry until the run has finished.

#### UF-075 — High — "What the database holds" shows the last acquisition's accounting, not the database, and lacks "countries scored" and the ageing count

- **Area:** What the database holds
- **Design says:** "Headline figures plus stats: values stored, countries scored, values past their allowed age (derived from the refetch setting, amber when non-zero, green at zero), spend this month" (README.md, 2. Acquire; UX-REVIEW.md R8; screen 08: "Values stored 1,247 of 1,312").
- **What happens:** The panel repeats the newest acquisition's own figures, whatever its scope. After a 2-item retry it read "Values filled 2 of 2 the last acquisition asked for", "Nobody answered 0", "Failed 0", while the database holds figures for all 32 countries and earlier runs still have gaps outstanding. There is no count of stored values, no "countries scored" and no ageing count anywhere on the screen, even with a 30-day refetch age that many stored figures exceed, so Stage 6's refetch setting gives no feedback.
- **To reproduce:**
  1. Configure stage 6: set "Refetch data older than" to 30 days.
  2. Run a small scoped acquisition.
  3. Open Acquire and read "What the database holds".
- **Evidence:** `ui/src/routes/run/DatabaseHoldsPanel.tsx:88-140`; `ui/src/routes/run/databaseHolds.ts:33-41, 73-81`. Screenshots: `shots/47-misc-01-database-panel.png`, `shots/s2-82-aq01-run-01-AQ-01-run-card.png`, `shots/s2-70-settings-driven-07-AQ-18-estimate-3650.png`.
- **Source ids:** AQ-05 (confirmed), CB-13 (confirmed), HO-47 (found in the browser)
- **Severity:** High, the rating of its most serious part; CB-13 (Medium) and HO-47 (Low) rated it lower.
- **Related:** The refresh card's false lead about the refetch age is UF-082.
- **Fix direction:** Show database-level figures: active values stored, countries scored (from the ranking) and values past their allowed age (from the maximum ages and the refetch setting), which likely needs a backend read.

#### UF-076 — High — An armed "Yes, start it" goes stale and starts a scope that is no longer on screen

- **Area:** Gap cards and confirmation strip
- **Design says:** The count, the ceiling and the button label follow the selection (README.md, 2. Acquire, Selection); the strip confirms the current selection (`.dc.html` l.2538-2544).
- **What happens:** Once armed, the strip survives opening another run, Refresh, Stop, Dismiss and changes to the selection. Armed on run 12 ("Retry everything that failed over 64 values…"), it stayed under run 122's card, which listed 76 different failures, and "Yes" would have started run 12's scope. After a third item was ticked, the list read "Retry 3 selected" while the strip still said "Retry 2 selected over 2 values". That scope can include paid calls.
- **To reproduce:**
  1. Acquire: open run 12 and arm its failed-items retry, so the confirmation strip appears.
  2. Open run 122 from the history.
  3. Or, with "Retry 2 selected" armed, tick a third item.
- **Evidence:** `ui/src/routes/run/useRunScreen.ts:266, 286-305, 318, 324, 333, 360-363`; `ui/src/routes/run/RunScreen.tsx:342-346`; `ui/src/routes/run/ItemGroups.tsx:52`. Screenshots: `shots/s2-20-acquire-01-AQ-04-stale-strip-after-opening-122.png`, `shots/s2-20-acquire-02-AQ-04-part2-strip-vs-selection.png`.
- **Source ids:** AQ-04 (confirmed)
- **Fix direction:** Clear the armed strip whenever the card's run or the selection changes, and name the run and the items in the strip.

#### UF-077 — Medium — The failed card counts failures rather than failed items, so it disagrees with the run and the three cards do not add up

- **Area:** Gap cards
- **Design says:** Three cards "whose counts sum to the acquisition total" (README.md, 2. Acquire; reqs Q217).
- **What happens:** For run 12 the progress card reads "625 of 640 answered, 1 failed, 14 unanswered" and the history says Failed 1, but the failed card below says "33 failed … from 2 sources" and offers "Retry 33 failed": 32 of them are OECD failures on items another source answered. 625 + 33 + 14 is not 640, under the line "All 640 values acquisition 12 asked for, by outcome".
- **To reproduce:**
  1. Acquire: open run 12 from the history.
  2. Compare the progress card, the history row and the failed card.
- **Evidence:** `ui/src/routes/run/failureGroups.ts:126-135`; `ui/src/routes/run/RunScreen.tsx:127, 170, 695-704`; `ui/src/routes/run/DatabaseHoldsPanel.tsx:122-127`. Screenshots: `shots/26-acquire-run12-01-gaps-collapsed.png`.
- **Source ids:** AQ-27 (confirmed), HO-26 (found in the browser)
- **Severity:** Medium, as the browser test rated it (the static scan said Low): "Retry 33 failed" offers to retry 32 figures another source already answered.
- **Fix direction:** Count failed items as the run does, or label the card "failures, some answered by another source" and leave answered items out of its retry.

#### UF-078 — Medium — The remedy cards follow whichever run is on the card, so outstanding gaps disappear

- **Area:** Gap cards
- **Design says:** The cards account for the acquisition's total; after a retry they still read the full acquisition's outstanding failures and unanswered items (README.md, 2. Acquire; screen 08; UX-REVIEW.md R2).
- **What happens:** The failed and unanswered cards read the run shown on the card. Run 12 shows "33 failed" and "14 unanswered"; pressing Dismiss removes both remedy cards although nothing was retried, and after runs 130 and 131 the page offers only their gaps, never run 12's outstanding ones. The reader has to find the right run in the history to see what is still missing.
- **To reproduce:**
  1. Acquire: open run 12.
  2. Press Dismiss on its card.
  3. Run a small retry and look for run 12's gaps.
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:123, 176`; `ui/src/routes/run/useRunScreen.ts:272-333, 360-363`; `ui/src/routes/run/databaseHolds.ts:107-116`. Screenshots: `shots/s2-20-acquire-04-AQ-11-after-dismiss.png`.
- **Source ids:** AQ-11 (confirmed)
- **Fix direction:** Base the remedies on what is still outstanding (the latest outcome for each pair) or on the newest full run, not on the card.

#### UF-079 — Medium — Acquire's refusal banner cannot be dismissed, and its "Try again" retries nothing

- **Area:** Refusal banner
- **Design says:** "Refusal banner … with a Dismiss button" (README.md, 2. Acquire); Try again repeats the failed request (README.md, Round 4 additions).
- **What happens:** Refusals ("run already in flight", "nothing to fetch") show no Dismiss, no link and no button. A failed estimate or start shows "Try again", which only removes the notice: no request is sent. The banner sits at the top of the page, far from the button that was pressed.
- **To reproduce:**
  1. In the browser, make the estimate or the start answer 503.
  2. Press Try again and watch the network.
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:87-89`; `ui/src/routes/run/useRunScreen.ts:263`; `ui/src/shell/ErrorNotice.tsx:23-27`; `ui/src/api/errorPresentation.ts:105-107`. Screenshots: `shots/s2-86-partials-02-AQ-14-failed-start-notice.png`, `shots/s2-85-aq15-02-AQ-15-refusal-after-start.png`, `shots/s2-10-shell-sim-12-SH-22-plan-failed.png`.
- **Source ids:** AQ-14 (confirmed †), SH-22 (confirmed †)
- **Severity:** Medium, the rating of its most serious part; SH-22 (Low) rated it lower.
- **Related:** Sibling of NEW-56-S5 (planned: the save control's Try again only dismisses).
- **Fix direction:** Give every refusal a Dismiss, keep "Try again" for a real re-send, and show the refusal next to the control that was pressed.

#### UF-080 — Medium — Starting is offered while a run is in flight, and the refusal gives no way to that run

- **Area:** Starting an acquisition
- **Design says:** On `run_already_in_flight`, "poll the named run, never start a second" (README.md, Contract bindings; UX-REVIEW.md B).
- **What happens:** With a run in flight (simulated in the browser), the refresh card still offers an enabled "Start this acquisition", and the retry buttons stay live. Pressing them ends in a refusal that names the run ("run 999 is still going… (reqs.md 10). Poll run 999 rather than starting another.") but offers no way to open it.
- **To reproduce:**
  1. Simulate a run in flight.
  2. Acquire: press Estimate, then Start this acquisition.
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:150-171, 201-221, 233-241, 366-404`; `ui/src/routes/run/databaseHolds.ts:44-48`; `backend/src/starnest/api/runs.py:286-287`. Screenshots: `shots/s2-20-acquire-08-AQ-12-refusal-in-view.png`, `shots/s2-20-acquire-09-AQ-12-refusal-top.png`.
- **Source ids:** AQ-12 (confirmed †)
- **Related:** P94 (accepted) covers a start lost when Acquire is left during it.
- **Fix direction:** Hold the start controls while a run is in flight, saying which run, with "Open acquisition N".

#### UF-081 — Medium — With every source switched off, Acquire offers to start a zero-item acquisition and refuses only after it is confirmed

- **Area:** Starting an acquisition
- **Design says:** The screen refuses "with a stated reason and a pointer to stage 5: 'Every data source is switched off, so there is nothing to ask.'" (UX-REVIEW.md R1; README.md, 2. Acquire, refusal banner).
- **What happens:** With every source off, the estimate reads "Items 0, Paid calls 0, At most €0.00" with a live "Start this acquisition" and no refusal. A retry arms "…over 0 values. No paid source is in scope, so this costs nothing." Only after Start does a red notice appear at the top, with the server's sentence over `nothing_to_fetch` and no link to stage 5. The same happens when the refetch age leaves nothing to ask.
- **To reproduce:**
  1. Configure stage 5: switch every source off.
  2. Acquire: press Estimate an acquisition.
- **Evidence:** `backend/src/starnest/api/runs.py:198-216`; `ui/src/routes/run/RunScreen.tsx:366-376`; `ui/src/routes/run/spendCommitment.ts:41-50`; `ui/src/shell/refusalRemedy.ts:28-33`. Screenshots: `shots/33-all-sources-off-01-all-off-estimate.png`, `shots/s2-85-aq15-01-AQ-15-zero-item-estimate.png`, `shots/s2-85-aq15-02-AQ-15-refusal-after-start.png`.
- **Source ids:** AQ-15 (confirmed †), HO-31 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; HO-31 (Low) rated it lower.
- **Fix direction:** Refuse at the estimate when it has no items, with the reason and a link to stage 5.

#### UF-082 — Medium — The refresh-everything card starts at once after its estimate, has no counts, and says it re-asks everything when the refetch age narrows it

- **Area:** Refresh-everything card
- **Design says:** "No button spends on click. Each arms a strip" (README.md, 2. Acquire, Confirmation; UX-REVIEW.md D: "retry, ask-again and refresh alike"). The card shows the total, "re-asks everything, clears the ageing values" quoting the live count, and who would be asked (README.md, 2. Acquire; UX-REVIEW.md R8; screen 05).
- **What happens:** After Estimate, "Start this acquisition" starts the run at once: 1,152 items on one click, with no strip, no cap sentence and no "Not yet" (read from the code; not pressed). The card shows no count, and the list of sources appears only after Estimate, outside the card. Its lead says "Re-asks everything, including what is already stored and still fresh.", but with a refetch age set the estimate fell from 1,152 to 544 items. No money is at risk today, because a sweep over a level asks no paid source.
- **To reproduce:**
  1. Configure stage 6: set "Refetch data older than" to 3,650 days.
  2. Acquire: press Estimate an acquisition and read the card (do not start).
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:224-251, 366-376, 416-450`; `backend/src/starnest/api/runs.py:204-214`; `backend/src/starnest/data_acquisition/execution.py:148-156`. Screenshots: `shots/27-acquire-select-03-sweep-estimate.png`, `shots/s2-70-settings-driven-07-AQ-18-estimate-3650.png`.
- **Source ids:** AQ-18 (confirmed), HO-27 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; HO-27 (Low) rated it lower.
- **Fix direction:** Use the same confirmation strip as the other remedies, show the count and the ageing figure in the card, and word the lead from the refetch setting.

#### UF-083 — Medium — Run outcomes print raw status ids, and a stop by the reader looks like a halt at the spend cap

- **Area:** Progress card and history
- **Design says:** Two halts stay distinct: "halted by you" (a neutral chip) and "halted at the spend cap" (amber), with headings "Stopped by you" and "Halted at the spend cap" (README.md, Round 4 additions; `.dc.html` l.2715-2724; screen 31). No identifiers on screen (README.md, Deviations 8).
- **What happens:** After a stop, the card's pill reads the raw "halted_by_user", the heading reads "Stopped early" for either halt, both halts are amber, and the outcome line reads "halted_by_user. 0 figures stored, 2 failed, 2 nobody answered." In the history the chip reads "halted by user" with no colour at all, because its style rule does not exist; the sidebar's "Last acquisition" also reads "halted by user".
- **To reproduce:**
  1. Acquire: start a small run and press "Stop — keep what completed".
  2. Read the card, the history row and the sidebar.
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:616-630, 686-690, 722-740`; `ui/src/routes/run/sourceReach.ts:116-126`; `ui/src/styles.css:3409-3435`; `ui/src/shell/Sidebar.tsx:335`. Screenshots: `shots/28-run-a-06-card-after-refresh.png`, `shots/s2-20-acquire-03-AQ-08-history-row-130.png`.
- **Source ids:** AQ-08 (confirmed), SH-26 (static only; seen in HO-24)
- **Severity:** Medium, the rating of its most serious part; SH-26 (Low) rated it lower.
- **Fix direction:** One shared map from status to words and colour, used by the pill, the heading, the outcome line, the history chip and the sidebar.

#### UF-084 — Medium — The stopping state is not drawn

- **Area:** Progress card
- **Design says:** "Once asked, the Stop button withdraws and the card turns amber with 'Stopping after the source in flight' and 'Stop asked at HH:MM…'" (README.md, Round 4 additions; screen 30).
- **What happens:** Between Stop and the halt, only the pill changes, to "stopping". The heading stays "Acquiring now", the border stays teal, and nothing says that the source in flight will finish, that nothing new will start, or when the stop was asked.
- **To reproduce:**
  1. Acquire: start a small run and press "Stop — keep what completed" at once.
  2. Read the card before the halt.
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:537, 542, 618-621`; `ui/src/routes/run/sourceReach.ts:141-147`. Screenshots: `shots/28-run-a-02-after-stop-click.png`, `shots/s2-20-acquire-10-SH-15-strip-stop-asked.png`.
- **Source ids:** AQ-09 (confirmed †)
- **Related:** The strip on other tabs is UF-017.
- **Fix direction:** Add the amber card, the heading and the "Stop asked at HH:MM" note, using the stop time the run already carries.

#### UF-085 — Medium — The source-by-source bars show a success rate rather than progress, and never say "not reached"

- **Area:** Progress card
- **Design says:** A per-source list with done-out-of-total bars, and "not reached" for sources never begun (README.md, 2. Acquire and Round 4 additions; screens 08, 30, 31).
- **What happens:** Each bar is stored out of stored-plus-failed, so a source 5 items into 300 shows a full bar. Sources that touched nothing are left out: after a stop, "Source by source" listed only OECD, and Open-Meteo, never reached, was simply absent. The run carries no planned count per source to draw progress from.
- **To reproduce:**
  1. Acquire: start a small run over two sources and stop it at once.
  2. Read "Source by source".
- **Evidence:** `ui/src/routes/run/sourceReach.ts:44-70`; `docs/openapi.yaml:1754-1767`. Screenshots: `shots/28-run-a-06-card-after-refresh.png`.
- **Source ids:** AQ-10 (confirmed)
- **Fix direction:** Put each source's planned item count on the run (a contract change) and draw done out of planned, with "not reached".

#### UF-086 — Medium — The acquisition diff misreads scope and picks: everything outside a small run "went missing", reversed and identical picks are accepted, and its notes overclaim

- **Area:** What changed between two acquisitions
- **Design says:** Pickers read "Acquisition 142, 28 Aug 2026 (32 countries × 41 attributes)" so the scopes show; "Went missing (the later run produced none…)" (README.md, 2. Acquire and Round 4 additions); the same run on both sides reads "Pick two different acquisitions." (`.dc.html` l.2703-2705).
- **What happens:** Comparing the 32×20 sweep (run 12) with a 2-item retry (run 131) lists 624 red "went missing" rows for pairs the retry never asked about. The pickers show only number and date, so the scopes are invisible. Swapping the order gives "624 newly acquired" without remark, and the same run on both sides reports "Unchanged 2 — Re-fetched and identical". For runs 130 and 131 the note "No figure for that pair before this run" is false: the database already held Austria's 5.03 °C from run 12. Pairs are compared whatever their source, a rejected re-read reads as "refreshed", and the pickers and columns differ from the design (an extra Source column, "Candidate" for "Country").
- **To reproduce:**
  1. Acquire, diff: Earlier = run 12, Later = run 131.
  2. Swap them.
  3. Pick run 131 on both sides.
- **Evidence:** `ui/src/routes/run/AcquisitionDiffPanel.tsx:43-55, 127-146, 156-171, 214-216`; `ui/src/routes/run/acquisitionDiff.ts:54-64, 136-151`; test `ui/src/routes/run/RunScreen.test.tsx:1258-1272`. Screenshots: `shots/30-diff-02-diff-12-131.png`, `shots/30-diff-03-diff-131-12-reversed.png`, `shots/30-diff-04-diff-same.png`.
- **Source ids:** AQ-17 (static only; its false note was seen in HO-29), AQ-25 (confirmed), AQ-37 (static only; seen in HO-29), HO-29 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; AQ-25 (Low), AQ-37 (Nit) and HO-29 (Low) rated it lower.
- **Fix direction:** Compare only pairs the later run was asked about, show each run's scope in the pickers, refuse identical picks and warn on reversed ones, and word the notes from what was actually read.

#### UF-087 — Medium — After storing a hand-typed figure there is no "See it in the Rank drill-down", and Rank cannot be opened at a candidate

- **Area:** Hand entry
- **Design says:** "Success reads back exactly what was stored… with See it in the Rank drill-down, which opens that candidate and pillar" (README.md, Round 4 additions; DECISIONS.md 2026-10-12; screen 33).
- **What happens:** The read-back reads "Stored 7 on 0–10 (assigned by human) for Portugal, under Manual entry." with no link. Rank keeps its open rows only in memory, so `/rank?candidate=…`, `/rank?open=…` and `/rank#…` all open with nothing expanded. To check how an irreplaceable figure scored, the reader must find the country and pillar by hand.
- **To reproduce:**
  1. Acquire: store a hand-typed figure.
  2. Look for the link; then try opening Rank at that candidate.
- **Evidence:** `ui/src/routes/run/ManualEntryPanel.tsx:190-198`; `ui/src/routes/rank/RankScreen.tsx:110`; `ui/src/routes/rank/SavedRankingsPanel.tsx:26-30` (only `?saved` is read from the address). Screenshots: `shots/32-hand-entry-store-02-stored.png`.
- **Source ids:** AQ-16 (confirmed), RK-15 (confirmed)
- **Fix direction:** Let Rank open a candidate and pillar from the address, as it already does for a saved ranking, and link to it from the read-back.

#### UF-088 — Medium — There is no way to acquire one candidate, one attribute or one pillar

- **Area:** Starting an acquisition
- **Design says:** "Scope selector — level, which candidates, which criteria" (docs/reqs.md 8.3; "by level, by candidate, by criterion, or any combination", 6.2); the contract's run scope supports it (README.md, Contract bindings). The design parks per-pillar re-acquisition (UX-REVIEW.md, Parked ideas).
- **What happens:** The screen offers only a whole-level estimate, or a pick inside a run's failure and unanswered lists. Re-fetching one country, one attribute or one pillar is impossible unless it happens to be in a failure list. No document records this as a decision.
- **To reproduce:**
  1. Static: read the estimate and selection paths.
- **Evidence:** `ui/src/routes/run/useRunScreen.ts:264-270`; `ui/src/routes/run/ItemGroups.tsx`. No screenshot (found by reading the code).
- **Source ids:** AQ-20 (static only)
- **Fix direction:** Rule on it: record the gap in DECISIONS.md or design-brief.md, or add a picker that estimates a chosen set of candidates and attributes.

#### UF-089 — Low — The hand-entry form lacks several specified parts: bands, a chip preview, the retrieval date, and marked fields

- **Area:** Hand entry
- **Design says:** Same frame for both editors: a "The figure" band and a "Where it came from" band; labels "previewed as chips, de-duplicated"; "Retrieved stamped for you"; confidence "Absolute / High / Medium / Low"; problems "mark their fields (#fda29b border, #fffbfa fill)"; the list of attributes with their type in words and a count badge (README.md, Round 4 additions; screens 32 and 33).
- **What happens:** Problems are listed in an amber notice, but no field is marked. There are no bands, no Retrieved field (the date is stamped but never shown), and the confidence options are lower case. The label-set editor is one text field: "SAP, Siemens, SAP,  , Erste Group" shows no preview and is not de-duplicated before storing. The card has no count badge and lists no types. Focus stays on the row's button when the form opens, and a successful store clears the draft.
- **To reproduce:**
  1. Acquire: Residency admin ease, "Enter a value by hand".
  2. Submit it empty, then with a reversed scale and period, then valid.
  3. Open International employers and type "SAP, Siemens, SAP".
- **Evidence:** `ui/src/routes/run/OpenToHandEntry.tsx:52-61, 109-125`; `ui/src/routes/run/ManualEntryPanel.tsx:84-185`; `ui/src/routes/run/manualEntry.ts:72-118`; `ui/src/routes/run/useManualEntry.ts:67, 76-80`. Screenshots: `shots/31-hand-entry-02-empty-submit.png`, `shots/32-hand-entry-store-01-invalid-submit.png`, `shots/55-labelset-01-labelset-preview.png`.
- **Source ids:** AQ-22 (confirmed), HO-30 (found in the browser)
- **Related:** The missing link to Rank is UF-087; NEW-59 (a label containing a comma) concerns the same field.
- **Fix direction:** Add the two bands, a read-only Retrieved field, the chip preview with de-duplication, capitalised confidence, the type column and badge, and per-field problem marks.

#### UF-090 — Low — The hand-entry Link field accepts text that will never be shown as a link

- **Area:** Hand entry
- **Design says:** "Source in words, link" (README.md, Round 4 additions); full provenance on every figure (docs/reqs.md 3.6).
- **What happens:** "example.com" or "not a url" is accepted and stored, but the drill-down shows only web addresses as links, so the provenance of a figure that can never be re-fetched quietly disappears.
- **To reproduce:**
  1. Acquire: enter a figure with "example.com" as its link.
  2. Rank: open the candidate and look for the link.
- **Evidence:** `ui/src/routes/run/manualEntry.ts:105`; `backend/src/starnest/api/values.py:79`; `ui/src/format/display.ts:103-117`; `ui/src/routes/rank/CandidateDetail.tsx:545-560`. Screenshots: `shots/s2-86-partials-04-AQ-24-rank-citation-simulated.png`.
- **Source ids:** AQ-24 (confirmed †)
- **Fix direction:** Require a full web address in the form, with a problem message, and check it on the server.

#### UF-091 — Low — The one measured attribute that permits hand entry appears in neither card

- **Area:** Hand entry
- **Design says:** "A Quantity attribute that permits entry says there is no form for it yet rather than offering one" (README.md, Round 4 additions; screen 33).
- **What happens:** Naturalisation pathway (a Quantity that permits manual entry) is answered by a published table, so it is in neither "Figures you can enter by hand" nor "Attributes with no data source at all", and the catalog's permission is invisible.
- **To reproduce:**
  1. Acquire: read both cards and look for Naturalisation pathway.
- **Evidence:** `ui/src/routes/run/unsourced.ts:156-158`; `storage/migrations/0101-catalog-pillars-and-attributes.sql:67`. Screenshots: `shots/31-hand-entry-02-empty-submit.png`.
- **Source ids:** AQ-23 (confirmed)
- **Fix direction:** List it with "Permitted, but there is no form for a measured quantity yet".

#### UF-092 — Low — The "no data source" card lacks the attribute's type, its remedy is plain text, and its weights are wrong while the set loads

- **Area:** Attributes with no data source
- **Design says:** Each attribute with "its share of its pillar and its type", highlighted amber when reached from Configure (README.md, 2. Acquire); hand entry is "not permitted" here (README.md, Round 4 additions).
- **What happens:** The columns are Attribute, Pillar, Weight in pillar and What would fill it, with no type. "Enter a value by hand" is plain text with nothing to click. While the set loads, every weight reads "not scored here" for about 1.6 s, then the real shares appear and the rows reorder. Criteria that are not scored (International employers 20.0%, Climate zone 15.0%, Remote work tax treaty 8.1%) show their weights. The design's claim that this card and the hand-entry card never share an attribute no longer holds (two attributes are in both), and here the code is right.
- **To reproduce:**
  1. Acquire: read "Attributes with no data source at all".
  2. Reload with the set read delayed by 2 s.
- **Evidence:** `ui/src/routes/run/UnsourcedAttributes.tsx:79-84, 127-150`; `ui/src/routes/run/unsourced.ts:52-60, 93-95`; `backend/src/starnest/main.py:400`. Screenshots: `shots/s2-95-aq30-01-AQ-30-no-source-card-local-employment.png`, `shots/s2-95-aq30-02-AQ-30-while-set-loads.png`.
- **Source ids:** AQ-30 (confirmed †)
- **Related:** The route into this card, and its fading highlight, are UF-015.
- **Fix direction:** Add the type, link the remedy to the hand-entry row, show "—" while the set loads, leave out criteria that are not scored, and record the overlap in design-brief.md.

#### UF-093 — Low — The card's spend line omits the ceiling and the cap

- **Area:** Progress card
- **Design says:** "Spend against the ceiling"; "Charged €X of the €Y ceiling." (README.md, 2. Acquire and Round 4 additions).
- **What happens:** The line reads "96 paid calls, €12.75" or "No paid call, nothing charged", with neither the ceiling nor the cap, so a reader watching a paid run cannot see how close it is to its limits. The run does not carry either figure.
- **To reproduce:**
  1. Acquire: open run 122 and read its spend line.
- **Evidence:** `ui/src/routes/run/spendCommitment.ts:79-87`; `ui/src/routes/run/RunScreen.tsx:571-574`; `docs/openapi.yaml:1691-1780`. Screenshots: `shots/24-acquire-open-122-03-opened-122-top.png`.
- **Source ids:** AQ-21 (confirmed)
- **Fix direction:** Store the estimate's ceiling and the cap on the run (a contract change) and print both.

#### UF-094 — Low — Spend and cap wording disagree: a retry is not called a new acquisition, "refuses" sits beside "uncapped", and a monthly total is captioned with a per-run cap

- **Area:** What the database holds, and confirmation strip
- **Design says:** "This starts a new acquisition over N values and can spend up to €X across N paid calls. It halts at the €5.00 cap and keeps whatever completed." (README.md, 2. Acquire, Confirmation); the cap applies per run (docs/reqs.md 6.3).
- **What happens:** The strip reads "Retry everything that failed over 12 values, and can spend…", so the reader is not told a retry is a new acquisition. With no cap set, the panel says "no cap is set, so an acquisition that would spend refuses" while "Yes" sends an uncapped acceptance, so the screen says both. "Spent this month €12.75 — the cap is €15.00 per acquisition" puts a per-run ceiling under a monthly total, which reads as a budget nearly used up.
- **To reproduce:**
  1. Acquire: arm a retry and read the strip.
  2. Read "Spent this month" with a €15 cap set.
- **Evidence:** `ui/src/routes/run/spendCommitment.ts:47, 54`; `ui/src/routes/run/DatabaseHoldsPanel.tsx:128-136`; `ui/src/routes/run/useRunScreen.ts:313-317`. Screenshots: `shots/s2-84-spend-01-AQ-02-spent-this-month.png`.
- **Source ids:** AQ-35 (static only), HO-52 (found in the browser)
- **Severity:** Low, the rating of its most serious part; HO-52 (Nit) rated it lower.
- **Fix direction:** Use the design's sentence, word the panel note "…unless you accept going uncapped", and show the per-run cap away from the monthly total.

#### UF-095 — Low — The failed card says each message is listed once; it is listed once per item

- **Area:** Gap cards
- **Design says:** The failed list is grouped by source (README.md, 2. Acquire).
- **What happens:** The card says "The same message repeated is one problem, so each is listed once with what it hit", but the OECD group repeats the same Cloudflare message on each of its 32 items.
- **To reproduce:**
  1. Acquire: open run 12 and expand the failed list.
- **Evidence:** `ui/src/routes/run/failureGroups.ts:107-113`; `ui/src/routes/run/ItemGroups.tsx:69, 156-178`. Screenshots: `shots/26-acquire-run12-02-gaps-expanded.png`.
- **Source ids:** AQ-26 (confirmed)
- **Fix direction:** Reword the sentence, or group by message inside each source.

#### UF-096 — Low — The selection controls are only partly built

- **Area:** Gap cards
- **Design says:** Tri-state group boxes; "Select all / Clear all" and "All / None" that grey out when they would do nothing; one action per card whose label follows the selection, with its statistics above it (README.md, 2. Acquire, Selection; DECISIONS.md 2026-09-20).
- **What happens:** There are no group boxes, and the select buttons never grey out. Each card has two competing actions (the list's "Retry N selected" and the card's "Retry N failed"); the statistics appear only after a click, below the button; and a retry's list of sources, paid ones included, is never shown.
- **To reproduce:**
  1. Static: read the selection controls.
- **Evidence:** `ui/src/routes/run/ItemGroups.tsx:84-99, 104-149, 197-208`; `ui/src/routes/run/RunScreen.tsx:150-171, 249-251, 351-363`. No screenshot (found by reading the code).
- **Source ids:** AQ-28 (static only)
- **Fix direction:** One action whose label follows the selection, a tri-state group box, and the sources a retry would ask shown in the strip.

#### UF-097 — Low — Empty failed and unanswered cards disappear instead of reading "Nothing is failing"

- **Area:** Gap cards
- **Design says:** "When nothing is failing the button reads 'Nothing is failing' and is inert" (README.md, 2. Acquire; DECISIONS.md 2026-09-20).
- **What happens:** A card with nothing in it is not drawn at all, and a test asserts that it goes. The three-card comparison collapses, and a clean run does not say "nothing failed" where the reader looks. The divergence is not recorded.
- **To reproduce:**
  1. Static: read how an empty card is drawn.
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:123, 176`; test `ui/src/routes/run/RunScreen.test.tsx:213-240`. No screenshot (found by reading the code).
- **Source ids:** AQ-29 (static only)
- **Fix direction:** Keep empty cards with an inert action, or record the divergence.

#### UF-098 — Low — Opening an acquisition from the history changes the card 2,000 px above and leaves the reader at the bottom

- **Area:** Every acquisition so far
- **Design says:** The history "opens a run by its own number" (docs/design-brief.md, fourth pass); the opened run should be visible.
- **What happens:** Clicking run 122 in the history leaves the page scrolled at the history (2,093 px down) while the card at the top silently switches to run 122; only the clicked number's underline changes in view.
- **To reproduce:**
  1. Acquire: scroll to "Every acquisition so far".
  2. Click 122.
- **Evidence:** `ui/src/routes/run/useRunScreen.ts:360-363`; `ui/src/routes/run/RunScreen.tsx:674-681`. Screenshots: `shots/24-acquire-open-122-02-opened-122-viewport.png`.
- **Source ids:** HO-28 (found in the browser)
- **Fix direction:** Scroll to the card and move focus to its heading when a run is opened.

#### UF-099 — Low — History rows and links say less than the design

- **Area:** Every acquisition so far
- **Design says:** Scope in words ("retry of the failed values"); a sidebar "Acquisition history" link (README.md, 2. Acquire and Shell; screen 34).
- **What happens:** The scope column gives only a size ("32 candidates over 41 attributes"). The run number's accessible name is just the number. The sidebar's "Acquisition history" link lands at the top of Acquire, not at the table at the bottom.
- **To reproduce:**
  1. Static: read the history table and the sidebar link.
- **Evidence:** `ui/src/routes/run/databaseHolds.ts:92-100`; `ui/src/routes/run/RunScreen.tsx:675-681, 689`; `ui/src/shell/Sidebar.tsx:343-345`. No screenshot (found by reading the code).
- **Source ids:** AQ-34 (static only)
- **Related:** Status words are UF-083; the link's landing is part of UF-015.
- **Fix direction:** Record a run's purpose and word the scope from it, name the button "Open acquisition N", and link to the table itself.

#### UF-100 — Low — Keyboard focus falls to the page when the pressed control disappears

- **Area:** Gap cards and confirmation strip
- **Design says:** Focus stays on, or moves sensibly from, the control that acted (this codebase's NEW-34 and NEW-44 rule; docs/design-brief.md, Interaction states).
- **What happens:** "Yes, start it" and "Not yet" vanish with the strip, "Start this acquisition" with the estimate, and Dismiss with the card; after each, focus is on the page itself, so a keyboard user loses their place.
- **To reproduce:**
  1. Acquire: arm a retry with the keyboard and press Enter on "Not yet".
  2. Check where focus is.
- **Evidence:** `ui/src/routes/run/useRunScreen.ts:279, 318, 324`; `ui/src/routes/run/RunScreen.tsx:597-601`. Log: `logs/s2-20-acquire.json`.
- **Source ids:** AQ-31 (confirmed)
- **Related:** Sibling of map-runs §7.8 C6 (Stop disappears and drops focus).
- **Fix direction:** Move focus to the new card's heading, or back to the control that opened the strip.

#### UF-101 — Nit — Acquire's visual details differ from the design

- **Area:** Gap cards and progress card
- **Design says:** Gap cards stretch with their actions at the foot; an 8 px overall bar, amber when halted or stopping; red failure detail; a tinted open hand-entry row; an amber confirmation strip (`.dc.html` l.777-779, 860, 896, 2733-2734; README.md, Round 4 additions).
- **What happens:** At 1440 px the three cards' actions sit at different heights (1393, 1616 and 1003 px). The bar is 6 px, with a green completed segment. Failure detail is grey, the open hand-entry row is not tinted, and the uncapped strip is red.
- **To reproduce:**
  1. Acquire at 1440 px: open run 12 and compare the cards.
- **Evidence:** `ui/src/styles.css:2133-2138, 2206-2224, 2240-2253, 3281-3286, 3319-3321, 4147-4153`. Screenshots: `shots/s2-20-acquire-05-AQ-33-gap-cards-1440.png`.
- **Source ids:** AQ-33 (confirmed)
- **Fix direction:** Adjust the stylesheet to the design's values.

#### UF-102 — Nit — "Estimating…" shows on the refresh card while a retry is being estimated

- **Area:** Refresh-everything card
- **Design says:** A busy label belongs to the act that raised it (the code's own rule, `ui/src/routes/run/useRunScreen.ts:44-51`).
- **What happens:** Pressing "Retry 33 failed" turns the refresh card's button into "Estimating…".
- **To reproduce:**
  1. Acquire: delay the estimate in the browser and press Retry 33 failed.
- **Evidence:** `ui/src/routes/run/RunScreen.tsx:236-238`; `ui/src/routes/run/useRunScreen.ts:286-287`. Screenshots: `shots/s2-20-acquire-06-AQ-36-estimating.png`.
- **Source ids:** AQ-36 (confirmed †)
- **Fix direction:** Key the label to the act that started the estimate.

### Rank

21 findings: 2 High, 8 Medium, 9 Low, 2 Nit.

#### UF-103 — High — In the drill-down, "Weight" and "Weight used" are on different bases, so every row seems to have lost most of its weight

- **Area:** Drill-down, stored values
- **Design says:** "Weight used" turns teal "when it differs from declared by >0.6pt", which assumes both columns share one basis (README.md, 3. Rank, expanded row; `.dc.html` l.2142-2147). The contract defines an attribute's weight as "within the pillar" (`docs/openapi.yaml:1876-1890`).
- **What happens:** "Weight" is the criterion's share of its pillar (100 per pillar); "Weight used" is its share of the whole level. For Malta, Health's single attribute reads Weight 100.0% beside Weight used 15.6%; Career's rows read 16.7% and 63.3% beside 1.1% and 4.2%. The headings sit side by side with no note, so the column meant to show where a missing figure's weight went cannot show it, and every row appears to have lost 80 to 95 per cent of its weight. The interface's own mock prints 50.0% beside 12.5% with nothing redistributed.
- **To reproduce:**
  1. Rank: open Malta, then Health.
  2. Read Weight and Weight used.
- **Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:404-418`; `backend/src/starnest/evaluation/ranking.py:95, 475, 615`; `ui/src/mocks/fixtures.ts:61, 729-734`. Screenshots: `shots/s2-50-rank-01-RK-01-health-weights.png`.
- **Source ids:** RK-01 (confirmed)
- **Severity:** Kept High: each number is right on its own basis, so this is a broken column rather than a wrong figure, but it misleads on every row of the drill-down.
- **Fix direction:** Put both columns on one basis (prefer server fields), label the basis, then add the teal difference rule.

#### UF-104 — High — An opened saved ranking appears out of sight, says nothing about itself, and has lost its pillar breakdown and Δ home

- **Area:** Saved rankings
- **Design says:** Saved rankings freeze "weights, locks and every value behind the scores" (README.md, 3. Rank header; UX-REVIEW.md A); opening one shows it, "a real thing to look at" (docs/design-brief.md, divergences).
- **What happens:** Clicking a saved ranking changes the address to `/rank?saved=72`, but the screen still shows the live table under "Nothing is kept until you save it.". The saved table is drawn 1,230 px further down, below the live table and the attribute panel, with no scroll and no focus, under the generic heading "A saved ranking": no criteria set, level, date or note. Its Pillars column is empty and Δ home is "—" on every row: the saved ranking is served without its attribute scores, so no pillar rollup is derived, and Δ home is only ever computed for the live ranking. Its rows show a pointer and a hover tint, but clicking one opens nothing.
- **To reproduce:**
  1. Rank: Save this ranking with a note.
  2. Click the saved entry in the sidebar.
  3. Scroll down to find it.
- **Evidence:** `ui/src/routes/rank/RankScreen.tsx:56-60, 191`; `ui/src/routes/rank/SavedRankingsPanel.tsx:22-50`; `ui/src/routes/rank/SavedRankingView.tsx:16-41`; `backend/src/starnest/api/evaluations.py:124-142`; `backend/src/starnest/storage/evaluation_store.py:251-260, 430-452`; `backend/src/starnest/evaluation/ranking.py:152`; `ui/src/styles.css:3499-3506`. Screenshots: `shots/36-saved-rankings-03-saved-opened.png`, `shots/38-saved-view-shot-01-saved-region-in-view.png`.
- **Source ids:** RK-05 (confirmed), HO-35 (found in the browser)
- **Severity:** High, the rating of its most serious part; RK-05 (Medium) rated it lower.
- **Related:** The saved drill-down and its evidence are planned under N3, FU-A3 and FU-A4 (map-saved, map-gates); this finding is about the table itself.
- **Fix direction:** Serve the saved ranking with its pillar scores and Δ home (both can be derived from what was saved), scroll to it and focus its heading, and show its set, level, date and note.

#### UF-105 — Medium — Candidates outside the ranking are listed alphabetically, not by score

- **Area:** Ranking table
- **Design says:** "Sort: matching by score descending and ranked 1..n; then non-matching and insufficient-data by score descending, unranked" (README.md, 3. Rank). A gated candidate "is worth seeing as exactly that" (docs/reqs.md 5.4).
- **What happens:** With a cost-of-living threshold that excluded 16 countries, the rows under "Not in the ranking" ran Austria 62, Belgium 62, Denmark 41, Estonia 61 … with Liechtenstein's "No score" among them and the Netherlands (68, the best of them) twelfth. The saved copy of the same ranking lists them by score, so the live and saved tables disagree on order.
- **To reproduce:**
  1. Configure: give Cost of living index a matching threshold of at most 100.
  2. Rank: read the rows under "Not in the ranking".
- **Evidence:** `backend/src/starnest/api/rankings.py:301-308`; `backend/src/starnest/evaluation/ranking.py:129`; `ui/src/routes/rank/RankScreen.tsx:24-26`. Screenshots: `shots/34-rank-01-two-expanded.png`.
- **Source ids:** RK-02 (confirmed), HO-34 (found in the browser)
- **Fix direction:** Order unranked rows by score, highest first, with "No score" last, for live and saved rankings alike, and add an acceptance test.

#### UF-106 — Medium — "Why this status" explains exclusions in machine text, and the band blames a gate for every exclusion

- **Area:** Ranking table
- **Design says:** "Why this status — plain language… No rule identifiers." (README.md, 3. Rank); exclusions come from two mechanisms, thresholds and match rules (docs/reqs.md 5.2).
- **What happens:** Threshold reasons print the attribute id: "country.cost_of_living_index is 108.3, above your maximum of 100". Insufficient-data reasons do too: "no figure for country.english_proficiency, which this criteria set requires…", and method tokens such as "(normalised percentile)". Compound-rule warnings print raw conditions with four decimals, no units and "to any": "Projected summer heat days 36.9140 within 25 to any", wrapping Croatia's, Hungary's and Romania's rows to 259 px tall. The band above the excluded rows says "16 ruled out by a gate" when a threshold, not a gate, excluded them, and one of the 16 had no score at all.
- **To reproduce:**
  1. Rank with the shipped set: scroll right and read Bulgaria, Croatia, Hungary and Romania.
  2. Configure: give Cost of living index a maximum of 100, then read Rank's excluded rows and the band.
  3. Make English proficiency block when missing, then read the insufficient-data rows.
- **Evidence:** `ui/src/routes/rank/RankingTable.tsx:163-168, 372-380`; `backend/src/starnest/evaluation/ranking.py:651-683`; `backend/src/starnest/evaluation/rules.py:157-176, 279-297`; `ui/src/routes/rank/rankTable.ts:299-311`. Screenshots: `shots/03-rank-cols-01-scrolled-right.png`, `shots/34-rank-01-two-expanded.png`, `shots/s2-71-misc-03-RK-10-why-insufficient.png`.
- **Source ids:** RK-10 (confirmed), HO-08 (found in the browser), HO-33 (found in the browser), RK-22 (confirmed)
- **Severity:** Medium, the rating of its most serious part; RK-22 (Low) rated it lower.
- **Related:** Extends N2 (map-saved: threshold reasons freeze raw attribute ids into saved rankings) and map-gates S1 (a gate reason with no text prints the raw gate id).
- **Fix direction:** Have the server write reasons with attribute names, units and readable precision, as compound rules already name their attributes, and count gates and thresholds apart in the band.

#### UF-107 — Medium — The drill-down counts missing attributes but never names them

- **Area:** Drill-down, stored values
- **Design says:** A missing attribute is a row reading "no value stored" in amber, with Weight used an amber 0% and In use "No value" (README.md, 3. Rank, expanded row; `.dc.html` l.2131-2153).
- **What happens:** Liechtenstein's drill-down says "16 of the 37 attributes this set scores have no stored value." and lists none of them. Finding out which ones means comparing Configure's list with this table by hand, although the server already returns every scored criterion, the missing ones included.
- **To reproduce:**
  1. Rank: open Liechtenstein, then Career.
- **Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:198-205, 244-265`; `ui/src/routes/rank/pillarCompleteness.ts:45-90`; `backend/src/starnest/evaluation/ranking.py:477-482`. Screenshots: `shots/s2-50-rank-02-RK-03-liechtenstein-career.png`.
- **Source ids:** RK-03 (confirmed)
- **Fix direction:** Draw a row for each scored attribute with no stored value, in the design's words and colours, with the "No value" pill.

#### UF-108 — Medium — Each figure's confidence chip ignores the age downgrade that the row's confidence split applies

- **Area:** Drill-down, stored values
- **Design says:** Confidence is "downgraded for age beyond max_age … shown beside every figure" (docs/reqs.md 5.7).
- **What happens:** Portugal's row reads high 66%, medium 31%, low 3%, but the weights of its scored figures, grouped by their chips, give high 84, medium 14, low 2. The chips show the stored grade, not the grade after ageing: a 1961–1990 sunshine normal is chipped like a 2025 figure. The screen contradicts itself, and the reader cannot see which figures were downgraded.
- **To reproduce:**
  1. Rank: open Portugal.
  2. Compare the row's confidence split with the chips in the drill-down.
- **Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:420-424`; `backend/src/starnest/evaluation/ranking.py:96-103`; `storage/queries/values.sql:96-133`. Screenshots: `shots/s2-52-wcompare-01-RK-13-portugal-chips.png`.
- **Source ids:** RK-13 (confirmed)
- **Related:** Related to KT-A4 (map-saved: maximum ages in months compared as days).
- **Fix direction:** Serve the aged grade (or a freshness flag) with each value, and show it, or an "older than its allowed age" mark, beside the chip.

#### UF-109 — Medium — The candidate detail shows no gate answers and the reason cell no override marker

- **Area:** Drill-down
- **Design says:** Non-matching rows show "which rule was not met, and any override marker"; the candidate detail shows "match-rule results and any overrides" (docs/reqs.md 8.4).
- **What happens:** The detail reads values, outside opinions, the set and the scores, never the gate answers. A candidate ruled out by a gate cannot be traced to who answered, from which pages, for what period, or whether the answer was overridden; a gate answered "matching" leaves no trace on Rank at all.
- **To reproduce:**
  1. Static: read what the candidate detail loads.
- **Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:76-135`; `ui/src/routes/rank/RankingTable.tsx:372-377`; `docs/openapi.yaml:1580-1601`. No screenshot (found by reading the code).
- **Source ids:** RK-14 (static only)
- **Related:** Extends map-gates B3 (gate staleness not shown on Rank); to be coordinated with UI-29 and BE-36, and with FU-A4 for saved rankings.
- **Fix direction:** Add a "Gates" block to the detail from the gate-answer read, and an override mark in the reason cell.

#### UF-110 — Medium — Legitimate states leave Rank on a red error made of ids, with no way out

- **Area:** Ranking table
- **Design says:** A refusal the household can lift gets a card and a route, as the unset score range does (UX-REVIEW.md R3); an empty new set is "a state a set passes through legitimately" (code comment, `backend/src/starnest/evaluation/ranking.py:161-177`).
- **What happens:** A new empty set (from Create set) leaves Rank and the sidebar on "… scores nothing at level country, so there is no ranking to produce" over `cannot_be_ranked`. A score-range top of 10, which the settings accept, leaves them on "country.cost_of_living_index anchors 70.0 to a score of 100, and the score scale stops at 10" over `invalid_criterion`. Neither has a button or a link back to the setting.
- **To reproduce:**
  1. Configure stage 6: set the top of the score range to 10 and save.
  2. Open Rank.
  3. Or create an empty set and open Rank.
- **Evidence:** `backend/src/starnest/evaluation/ranking.py:88-91`; `backend/src/starnest/api/errors.py:109`; `backend/src/starnest/criteria/criterion.py:399-404`; `backend/src/starnest/api/settings.py:41`; `ui/src/shell/refusalRemedy.ts:27-32`. Screenshots: `shots/s2-70-settings-driven-06-RK-11-range-10.png`, `shots/05-empty-set-02-rank-empty-set.png`.
- **Source ids:** RK-11 (confirmed)
- **Related:** The empty set itself is UF-027; the raw text is part of UF-003.
- **Fix direction:** Word both refusals plainly with a "Go to Configure" route, and refuse a score range below the anchors when the setting is saved.

#### UF-111 — Medium — "Save this ranking" is offered when there is nothing to save

- **Area:** Saving a ranking
- **Design says:** When the score range is unset, "the whole tab is replaced" by the "No ranking" card (README.md, 3. Rank); the loading and empty states show only the title (screens 35 and 37).
- **What happens:** The save control sits in the header whatever the state. With the range unset, the note field opens, Save sends the request, and a red notice with `score_scale_not_set` comes back. The same control is offered after a failed load and for an empty roster.
- **To reproduce:**
  1. Configure: clear the top of the score range.
  2. Rank: press Save this ranking, type a note, press Save.
- **Evidence:** `ui/src/routes/rank/RankScreen.tsx:145`; `ui/src/routes/rank/useSavedRankings.ts:25`; `ui/src/routes/rank/SaveControl.tsx:62-71`. Screenshots: `shots/s2-70-settings-driven-04-RK-07-save-with-range-unset.png`.
- **Source ids:** RK-07 (confirmed)
- **Related:** NEW-56 (planned) covers the same control's focus during a save.
- **Fix direction:** Draw the save control only when a ranking has loaded and has candidates.

#### UF-112 — Medium — The criteria set is shown by its database id in Rank's header and in the saved-rankings list

- **Area:** Header and saved rankings
- **Design says:** The header's "Criteria set" shows the set's name (README.md, 3. Rank; screens 11 and 23: "Alex + Teodora (default)"); no programmatic identifiers (README.md, Deviations 8).
- **What happens:** The header reads "CRITERIA SET local_employment" (or "ho_scratch"), while the sidebar and Configure say "Local employment". After a rename the header keeps the old id, so the two disagree. The saved-rankings list shows the same ids ("ho_scratch, 23 Oct 2026"; with no note, "local_employment, country").
- **To reproduce:**
  1. Open Rank and read the header.
  2. Rename the set in Configure and read it again.
- **Evidence:** `ui/src/routes/rank/RankingTable.tsx:182`; `backend/src/starnest/api/rankings.py:235`; `ui/src/format/savedRanking.ts:40-68`. Screenshots: `shots/00-baseline-06-rank-viewport.png`, `shots/s2-71-misc-04-RK-04-noteless-entry.png`.
- **Source ids:** RK-04 (confirmed †), HO-07 (found in the browser)
- **Severity:** Medium (HO-07 rated it Low): after a rename the header names a set the reader cannot find.
- **Fix direction:** Look the name up from the list of sets (or add it to the ranking and the evaluation summary), and word the level as the header does.

#### UF-113 — Low — A figure whose source is switched off is labelled "Superseded", though nothing replaced it

- **Area:** Drill-down, stored values
- **Design says:** The In use pill reads Scored, Superseded, Rejected or No value, and a missing figure reads "no value stored" with an amber 0% (README.md, 3. Rank, expanded row); "switch one off and nothing is ever acquired from it" (README.md, Stage 5).
- **What happens:** With Manual entry switched off, Portugal's only figure for Residency admin ease is greyed, scores "—", and is labelled "Superseded", although no other figure supersedes it. Nothing on Rank says its source is off, and Portugal's coverage drops from 99.44% to 99.16% with no explanation. Any figure that is not active and not rejected gets this label.
- **To reproduce:**
  1. Configure stage 5: switch Manual entry off.
  2. Rank: open Portugal and find Residency admin ease.
  3. Switch Manual entry back on.
- **Evidence:** `ui/src/routes/rank/attributeScores.ts:105-109`; `ui/src/routes/rank/CandidateDetail.tsx:449-455`. Screenshots: `shots/s2-86-partials-03-CB-25-rank-manual-off.png`.
- **Source ids:** HO-53 (found in the browser)
- **Related:** Hand entry while Manual entry is off is UF-062.
- **Fix direction:** Label such a figure "Source switched off", and read the attribute as having no value in use.

#### UF-114 — Low — A rejected figure never shows why it was rejected

- **Area:** Drill-down, stored values
- **Design says:** A rejected figure is "stored and marked rejected, with the reason" (docs/reqs.md 3.3a, Validation).
- **What happens:** Portugal holds five rejected figures (for example a language-model English-proficiency score of 612 on 0–800). Each shows a "Rejected" chip and nothing else: no reason, no title, nothing on hover.
- **To reproduce:**
  1. Rank: open Portugal and find a "Rejected" row.
- **Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:428-456`. Screenshots: `shots/s2-50-rank-04-RK-24-rejected-row.png`.
- **Source ids:** RK-24 (confirmed)
- **Fix direction:** Print the rejection reason under the chip, or as its title.

#### UF-115 — Low — The home country's Δ home reads "—" instead of "baseline", and an all-dash column is unexplained

- **Area:** Ranking table
- **Design says:** Δ home reads "baseline" on the home row, a signed figure elsewhere, and "—" only for a missing comparison (README.md, 3. Rank). Compare already says "baseline".
- **What happens:** Romania (home) shows its "home" pill and "—" in Δ home, the sign the design keeps for a missing comparison. When the home country is unset, unranked or unscored, every row reads "—" with no note.
- **To reproduce:**
  1. Rank: find Romania and read Δ home.
- **Evidence:** `ui/src/routes/rank/rankTable.ts:263-272`; `backend/src/starnest/evaluation/ranking.py:134-158, 579-588`. Screenshots: `shots/03-rank-cols-01-scrolled-right.png`.
- **Source ids:** RK-21 (confirmed), HO-09 (found in the browser)
- **Fix direction:** Print "baseline" on the home row and add a one-line note when no home figure exists.

#### UF-116 — Low — "Weight used" is never tinted, and no tooltip says how a figure was scored

- **Area:** Drill-down, stored values
- **Design says:** "Weight used" is teal when it differs from the declared weight by more than 0.6 points; an "i" tooltip gives what the attribute measures, its goal, anchors or band, source and whether it is required (`.dc.html` l.331-332, 1785-1797, 2147).
- **What happens:** The cells are plain text and the attribute name has no tooltip, so nothing shows how a stored figure became its 0–100 score.
- **To reproduce:**
  1. Static: read the stored-values table.
- **Evidence:** `ui/src/routes/rank/CandidateDetail.tsx:349-357, 404-418`. No screenshot (found by reading the code).
- **Source ids:** RK-23 (static only)
- **Related:** The tint needs UF-103 fixed first.
- **Fix direction:** After the bases are fixed, add the tint, and add a tooltip built from the set's criterion (goal, method, anchors, band).

#### UF-117 — Low — Stored values are listed in attribute-id order, with descriptive attributes mixed in

- **Area:** Drill-down, stored values
- **Design says:** The detail lists "the descriptive attributes … first, then every scored attribute" (docs/reqs.md 8.4).
- **What happens:** The server orders values by candidate and attribute id, and the screen keeps that order, so the list reads as unsorted (ids and names differ: "total_tax_rate_effective" sits among the Ts while its name is "Total tax rate…"), and descriptive and scored figures are interleaved.
- **To reproduce:**
  1. Static: read the order of the stored values.
- **Evidence:** `storage/queries/values.sql:132-133`; `ui/src/routes/rank/CandidateDetail.tsx:330`. No screenshot (found by reading the code).
- **Source ids:** RK-25 (static only)
- **Fix direction:** Order by pillar and name, descriptive attributes first, from server data.

#### UF-118 — Low — The save control omits its hint, and still says "Nothing is kept" right after a save

- **Area:** Saving a ranking
- **Design says:** Save opens a note field "with Save / Cancel and a hint that weights, locks and every value behind the scores are frozen with it"; after a save the line reads "Live — recomputes as you change weights." (README.md, 3. Rank header; `.dc.html` l.2948-2950).
- **What happens:** The note field ("Why keep this one?") has Save and Cancel only. The line under the header always reads "Nothing is kept until you save it.", even right after a save, so the only confirmation is a sidebar list that may be out of view. Enter does not save and Escape does not cancel.
- **To reproduce:**
  1. Rank: press Save this ranking, type a note, press Save.
  2. Read the header line.
- **Evidence:** `ui/src/routes/rank/SaveControl.tsx:33-60, 73-75`; test `ui/src/routes/rank/SavedRankingsPanel.test.tsx:96-108`. Screenshots: `shots/36-saved-rankings-01-save-open.png`, `shots/36-saved-rankings-03-saved-opened.png`.
- **Source ids:** RK-20 (confirmed), HO-46 (found in the browser)
- **Severity:** Low, the rating of its most serious part; HO-46 (Nit) rated it lower.
- **Fix direction:** Add the hint, change the line once something is saved (or read back "Saved as …"), and let Enter save and Escape cancel.

#### UF-119 — Low — The open-row and not-matching row backgrounds never show

- **Area:** Ranking table
- **Design says:** Row background: white, `#fcfcfd` when not matching, `#f0fdfa` when open (README.md, 3. Rank; screens 12 and 24).
- **What happens:** Both modifiers lose to a more specific base rule, so an open row stays white (it turns teal only while hovered) and a non-matching row is not tinted. With several rows open, only the caret ties a row to its panel.
- **To reproduce:**
  1. Rank: open Poland and move the pointer away.
  2. Read the row's computed background.
- **Evidence:** `ui/src/styles.css:3489-3508`. Log: `logs/s2-50-rank.json`.
- **Source ids:** RK-18 (confirmed)
- **Fix direction:** Write both modifiers with the base rule's specificity, after it, and add a computed-style browser check.

#### UF-120 — Low — Rank rows cost 12 tab stops each, and the row toggle does not say whether it is open

- **Area:** Ranking table
- **Design says:** "The whole row is the toggle" (README.md, 3. Rank); docs/design-brief.md says the interface is keyboard navigable (accessibility is otherwise deferred, DECISIONS.md 2026-09-20).
- **What happens:** Each row is the candidate button plus 11 focusable pillar bars, so reaching row 10 takes about 120 presses of Tab. The candidate button has no expanded state, so a screen reader cannot tell an open row from a closed one (Enter and Space do toggle it). The saved view's rows look clickable but do nothing.
- **To reproduce:**
  1. Rank: press Tab repeatedly from "Save this ranking".
  2. Open a row and inspect its button.
- **Evidence:** `ui/src/routes/rank/RankingTable.tsx:326-328, 486`. Screenshots: `shots/09-reload-focus-01-pillar-bar-focused.png`. Log: `logs/02-shell.json`, `logs/s2-71-misc.json`.
- **Source ids:** RK-28 (confirmed), HO-45 (found in the browser)
- **Related:** The saved-ranking links that all claim to be the current page are UF-019.
- **Fix direction:** Add the expanded state to the row button and use one tab stop for the pillar chart, moving between bars with the arrow keys.

#### UF-121 — Low — The attribute panel miscounts, and says a weight redistributes when it does not

- **Area:** One attribute, every candidate
- **Design says:** An addition for docs/reqs.md 8.4 (one attribute across every candidate); not drawn by the design.
- **What happens:** "N of the level's candidates have a figure" counts value rows, not candidates, gives no total and says "1 … have". "Its weight redistributes across the rest of its pillar" is printed even for descriptive or unscored attributes.
- **To reproduce:**
  1. Static: read the panel's wording.
- **Evidence:** `ui/src/routes/rank/AttributeDrillDown.tsx:108-121`. No screenshot (found by reading the code).
- **Source ids:** RK-27 (static only)
- **Fix direction:** Count distinct candidates against the roster ("31 of 32"), and mention redistribution only when the active set scores the attribute.

#### UF-122 — Nit — Every row shows a fourth confidence reading, "absolute 0%"

- **Area:** Ranking table
- **Design says:** Three readings: high, medium, low (README.md, 3. Rank; UX-REVIEW.md R7).
- **What happens:** Every row's confidence starts with "absolute 0%" before the three designed readings. The reason is written only in a code comment.
- **To reproduce:**
  1. Rank: read any row's Confidence.
- **Evidence:** `ui/src/routes/rank/rankTable.ts:247-260`. Screenshots: `shots/03-rank-cols-01-scrolled-right.png`.
- **Source ids:** RK-29 (confirmed)
- **Fix direction:** Show "absolute" only when it is above zero, and record the reason in design-brief.md.

#### UF-123 — Nit — Small wording and colour differences on Rank

- **Area:** Ranking table and saved rankings
- **Design says:** The chip's tooltip: "<Name>. A flag replaces this code once the catalog carries flag images"; the medium confidence chip neutral and the low one amber (`.dc.html` l.2152, 2200; README.md, Round 4 additions, country chip).
- **What happens:** The tooltip reads "Portugal — PT". Medium and low chips share the amber tint. Cancel keeps the typed note where the design clears it. A long note is not truncated in the sidebar. A saved ranking names candidates from the live roster, so a removed candidate would print its id.
- **To reproduce:**
  1. Static: compare the strings and tints.
- **Evidence:** `ui/src/routes/rank/RankingTable.tsx:315`; `ui/src/styles.css:408-412, 3402-3407`; `ui/src/routes/rank/SaveControl.tsx:57`; `backend/src/starnest/api/evaluations.py:133-136`. No screenshot (found by reading the code).
- **Source ids:** RK-30 (static only)
- **Fix direction:** Match the design's strings and tints, clamp the note, and fall back to a readable name.

### Compare

21 findings: 1 Critical, 2 High, 8 Medium, 8 Low, 2 Nit.

#### UF-124 — Critical — The synthesis cards are signed backwards: each card's number and lists describe the focus but sit under the comparator's name

- **Area:** Synthesis cards
- **Design says:** Each card shows the comparator's name and total gap, "+4.2 points" in green or "−7.1 points" in red (README.md, 4. Compare); the design computes comparator minus focus (`.dc.html` l.2463-2468), so in screen 13 the Romania card reads −24.0 in red, like its column in the matrix.
- **What happens:** The server computes the card's gap as focus minus comparator, and its "Ahead on" list holds the attributes where the focus leads; the card prints both under the comparator's name, green when positive. With Portugal (70) as focus, Malta's card reads "-7.0" in red although Malta is 7 points ahead, and Germany's reads "+10.0" in green although Germany is 10 behind; the matrix below says "77 +7" (green) and "60 −10" (red). In Raw mode the attribute rows flip back again ("gaps read focus minus comparator"), so one screen uses three conventions. A unit test asserts the reversed sign.
- **To reproduce:**
  1. Compare: Focus Portugal; tick Malta, Romania, Germany, Liechtenstein and Poland; press Compare.
  2. Compare each card's number with its column's Total score cell.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:373-382, 391-404`; `backend/src/starnest/comparison/comparison.py:205, 242-254`; `ui/src/routes/compare/pillarMatrix.ts:67`; test `ui/src/routes/compare/CompareScreen.test.tsx:154-164`. Screenshots: `shots/40-compare-03-matrix-full.png`, `shots/41-compare-views-02-raw-figures.png`, `shots/s2-60-compare-01-CP-01-malta-vs-greece.png`.
- **Source ids:** CP-01 (confirmed), HO-37 (found in the browser)
- **Severity:** Critical, as the static review rated it (the browser test said High): the headline number of every card reads backwards, which is a wrong number shown.
- **Fix direction:** Use one direction everywhere: title each card from the focus ("Portugal against Malta", "Portugal is ahead on"), or show comparator minus focus with the lists swapped, and test the card's sign against the matrix.

#### UF-125 — High — At the comparator limit a new tick silently drops the oldest choice, which stays hidden and can come back by itself

- **Area:** Selection
- **Design says:** "At the limit the remaining chips dim, take not-allowed and a title explaining why" (README.md, 4. Compare; UX-REVIEW.md L: "no silent no-op at the comparator ceiling"; DECISIONS.md 2026-09-20). Lowering the limit trims the selection to the newest N.
- **What happens:** Chips are never dimmed and have no title. A tick past the limit is accepted and the oldest choice is quietly unticked, while the alert blames a lowered limit ("The comparator limit is lower than what was picked…"). The dropped country stays in the stored selection: clicking its chip once does nothing visible, and unticking another chip makes it reappear ticked, so the matrix can compare a country the reader removed ("Portugal against Malta, Romania").
- **To reproduce:**
  1. Configure: set the comparator limit to 2.
  2. Compare: Focus Portugal; tick Malta, then Spain, then Romania.
  3. Click Malta once; then untick Spain.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:130, 150-157, 236-245, 276-286`; `ui/src/routes/compare/comparatorLimit.ts:17-28`; test `ui/src/routes/compare/CompareScreen.test.tsx:704-722`. Screenshots: `shots/40-compare-01-selection-at-limit.png`, `shots/s2-70-settings-driven-01-CP-03-after-c3.png`, `shots/s2-71-misc-01-CP-03-b-drawn.png`.
- **Source ids:** CP-03 (confirmed), CB-06 (confirmed), HO-38 (found in the browser)
- **Severity:** High, the rating of its most serious part; CB-06 (Medium) and HO-38 (Medium) rated it lower.
- **Related:** That "Change it in Configure" then loses the whole selection is UF-006.
- **Fix direction:** Block new ticks at the limit (dimmed, with the design's title), trim only when the limit itself is lowered, and remove trimmed countries from the stored selection.

#### UF-126 — High — Gaps are printed less precisely than their figures, so real differences read "+0" or "−0" beside a coloured bar

- **Area:** Matrix
- **Design says:** Weighted impact values and gaps to one decimal (`.dc.html` l.2345-2370); raw gaps at the attribute's own precision (`.dc.html` l.2421-2428).
- **What happens:** In "Weighted impact" mode, contributions and gaps are rounded to whole numbers. With pillar weights of 4 to 25%, most gaps are under one point, so they print "+0" or "−0" over a visible bar and tint (Nature, Governance, Culture), and others contradict their own cells: Safety for Greece reads "2 −1" against the focus's 2, and Climate reads "5 −2" against 6. In Raw mode, gaps are rounded to one decimal while figures show two, so Austria's 1.65 against Germany's 1.6 reads "+0.0". The view meant to show what a difference is worth mostly shows zeros.
- **To reproduce:**
  1. Compare: draw a comparison and choose "Weighted impact".
  2. Choose "Raw figures" and open Governance.
- **Evidence:** `ui/src/routes/compare/ComparisonMatrix.tsx:137, 147-148, 386-388`; `ui/src/format/display.ts:36-39, 48-55`; `ui/src/routes/rank/rankTable.ts:102-104, 263-271`; `ui/src/routes/compare/attributeRows.ts:117-120`. Screenshots: `shots/s2-60-compare-02-CP-02-weighted.png`, `shots/s2-60-compare-07-CP-22-governance-raw.png`.
- **Source ids:** CP-02 (confirmed), CP-22 (confirmed)
- **Severity:** High, the rating of its most serious part; CP-22 (Low) rated it lower.
- **Fix direction:** Print impact to one decimal and raw gaps at the figures' own precision, and never print a zero with a sign.

#### UF-127 — Medium — The comparison waits for a Compare press, and an old result stays on screen when the selection changes

- **Area:** Selection and matrix
- **Design says:** The selection card drives the matrix directly: "No fetch, no spinner, no recalculate button" (README.md, 4. Compare and Interactions & behaviour); comparisons are "always live" (docs/reqs.md 8.5).
- **What happens:** Nothing is drawn until Compare is pressed. After that, changing the focus or the ticks leaves the old cards and matrix on screen with nothing marking them out of date: "Malta against Greece, Germany, Romania" stayed after Romania was unticked and the focus changed to Spain. The comparison is not redrawn when an acquisition ends either.
- **To reproduce:**
  1. Compare: draw a comparison.
  2. Untick a country and change the focus without pressing Compare.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:73, 86-102, 158, 293-300`. Screenshots: `shots/s2-60-compare-05-CP-06-stale-result.png`.
- **Source ids:** CP-06 (confirmed)
- **Fix direction:** Redraw as the selection changes (after a short pause), or mark the result as out of date and name what it shows.

#### UF-128 — Medium — Compare never says that a candidate is not matching or lacks the data to score

- **Area:** Matrix and synthesis cards
- **Design says:** Candidates that do not match stay visible, with their reason shown (CLAUDE.md, design invariants; README.md, Deviations 4).
- **What happens:** Each candidate arrives with its match status and reasons, but none is shown. Liechtenstein, "Insufficient data" on Rank, appears as a comparator with no status or reason anywhere on the screen, and a country a gate rules out looks like any other. A reader can settle on a place that does not match.
- **To reproduce:**
  1. Compare: add Liechtenstein as a comparator and press Compare.
  2. Look for its status.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx` and `ui/src/routes/compare/ComparisonMatrix.tsx` (match status and reasons never drawn). Log: `logs/s2-60-compare.json`.
- **Source ids:** CP-25 (confirmed)
- **Severity:** Re-rated Medium (the static scan said Low): misleading, against the rule that a non-match is always shown with its reason.
- **Fix direction:** Show a status tag in each column header and on each card, with the reason on hover.

#### UF-129 — Medium — Raw figures are shown without a source, period, retrieval date or confidence

- **Area:** Matrix, Raw figures
- **Design says:** "Full provenance on every displayed number" (CLAUDE.md, design invariants; docs/reqs.md 10). The server sends each side's full value "for the provenance the table shows beside it" (code comment, `backend/src/starnest/api/comparisons.py:157-162`).
- **What happens:** Only the figure's text is kept; no source or date appears, not even on hover. Liechtenstein's cost of living shows Switzerland's 171.3 with nothing marking it as a stand-in, and the five estimated tax rates and the language-model figures read as measurements. The note even says raw figures are "what a source can be checked against".
- **To reproduce:**
  1. Compare: draw a comparison, choose Raw figures and open Governance or Economy.
- **Evidence:** `ui/src/routes/compare/ComparisonMatrix.tsx:73, 79`; `ui/src/routes/compare/ViewChoices.tsx:49`; `backend/src/starnest/api/comparisons.py:157-162, 193-198`. Screenshots: `shots/s2-60-compare-07-CP-22-governance-raw.png`, `shots/41-compare-views-02-raw-figures.png`.
- **Source ids:** CP-13 (confirmed)
- **Fix direction:** Show each figure's source and both dates, at least on hover, and mark low-confidence and borrowed figures.

#### UF-130 — Medium — The weighted contribution of each attribute's gap is never shown

- **Area:** Matrix, attribute rows
- **Design says:** "Per-attribute table — raw value of focus, raw value of each comparator, signed delta, and the weighted contribution of that delta" (docs/reqs.md 8.5; UX-REVIEW.md F).
- **What happens:** With "Weighted impact" on, an opened pillar's attribute rows still show normalised 0–100 scores ("64 baseline", "71 +7"); nothing shows what each attribute's gap adds to or takes from the total, although the server sends it and the synthesis is built on it.
- **To reproduce:**
  1. Compare: draw a comparison, choose Weighted impact and open Economy.
- **Evidence:** `ui/src/routes/compare/ComparisonMatrix.tsx:67-83`; `docs/openapi.yaml:1942`; `backend/src/starnest/api/comparisons.py:187-189`. Screenshots: `shots/s2-60-compare-03-CP-05-economy-open.png`.
- **Source ids:** CP-04 (confirmed)
- **Fix direction:** Show the server's weighted contribution on attribute rows in impact mode, to one decimal, in the matrix's direction.

#### UF-131 — Medium — Attribute rows have an empty weight cell and no "#N in pillar" tags

- **Area:** Matrix, attribute rows
- **Design says:** An attribute row shows its weight ("20.0%", or "—" when missing) and "#1 / #2 / #3 in pillar" tags (README.md, 4. Compare; `.dc.html` l.2405-2413; screen 14).
- **What happens:** The weight cell is drawn empty and there are no tags, so inside an open pillar the reader cannot tell which attribute drives it, and the empty column looks broken. Commit `ddbf555` calls this "a known gap, not a choice" (the comparison response carries neither), but it is recorded nowhere else.
- **To reproduce:**
  1. Compare: draw a comparison and open Economy.
- **Evidence:** `ui/src/routes/compare/ComparisonMatrix.tsx:264`. Screenshots: `shots/s2-60-compare-03-CP-05-economy-open.png`.
- **Source ids:** CP-05 (confirmed)
- **Fix direction:** Add each attribute's weight to the comparison response (the server already has it) and draw the weight and the tags; record the gap until then.

#### UF-132 — Medium — The synthesis never says when a comparison is partial: the "Not comparable" footnote is missing

- **Area:** Synthesis cards
- **Design says:** "A null pillar is excluded from ahead/behind and named in the 'Not comparable' footnote" (README.md, 4. Compare and Interactions & behaviour, "Null propagation").
- **What happens:** Liechtenstein's card has no footnote although its Career, Culture and Family cells read "—". With Liechtenstein as the focus (no total score), every card reads "—", has no footnote, and still lists lines "worth −13.2 points" against a total that does not exist.
- **To reproduce:**
  1. Compare: add Liechtenstein and press Compare.
  2. Make Liechtenstein the focus and press Compare.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:361-407`. Screenshots: `shots/40-compare-03-matrix-full.png`, `shots/s2-60-compare-04-CP-16-liechtenstein-focus.png`.
- **Source ids:** CP-08 (confirmed)
- **Fix direction:** Under each card, name the pillars where either side has no score, and suppress impact lines when the focus has no total.

#### UF-133 — Medium — The synthesis lists attributes, not pillars, and its "#1" tags mean something different from the matrix's

- **Area:** Synthesis cards
- **Design says:** Each "Ahead on" or "Behind on" item is a pillar, with a teal "#1 priority" pill on a pillar among the household's three heaviest (README.md, 4. Compare; `.dc.html` l.2453-2473; screen 13). The page's subtitle says "Differences are per pillar".
- **What happens:** The lines are the server's sentences about attributes ("Overcrowding rate: 69 against 100, worth −2.3 points"), and the "#1", "#2", "#3" tags rank the lines by impact: Romania's card tags "#1 Overcrowding rate" and "#3 Housing price level" (both Housing) around "#2 Cost of living index". In the matrix, "#1 priority" means the heaviest pillar, so "#1" means two things on one screen.
- **To reproduce:**
  1. Compare: Focus Portugal; tick Romania and others; press Compare.
  2. Read the cards' tags and lines.
- **Evidence:** `ui/src/routes/compare/synthesisImpact.ts:41-83`; `backend/src/starnest/comparison/comparison.py:266-285`; `ui/src/routes/compare/ComparisonMatrix.tsx:213-216`. Screenshots: `shots/40-compare-03-matrix-full.png`, `shots/41-compare-views-03-weighted.png`, `shots/42-compare-limit-01-focus-no-score.png`.
- **Source ids:** CP-11 (confirmed), HO-40 (found in the browser)
- **Severity:** Medium, the rating of its most serious part; HO-40 (Low) rated it lower.
- **Fix direction:** Give "#N" one meaning: tag a line by its pillar's rank among the heaviest (the server would send each line's pillar), and consider one line per pillar.

#### UF-134 — Medium — An unset comparator limit, the shipped state, is a red error naming a settings key and a "Settings" screen that does not exist

- **Area:** Selection
- **Design says:** Settings that can be unset read as unset, not as faults (UX-REVIEW.md K; README.md, Stage 6); no programmatic identifiers (README.md, Deviations 8).
- **What happens:** With the limit cleared, the note says "No comparator limit is configured, so the server will refuse a comparison.". Pressing Compare then gives a red notice, "comparator_limit is not set, so there is no bound… Set it in Settings…", over `comparator_limit_not_set`, with a "Set it in Configure" button. The score range's unset state already has calm wording; this one has none.
- **To reproduce:**
  1. Configure stage 6: clear the comparator limit and save.
  2. Compare: pick a focus and a comparator and press Compare.
- **Evidence:** `ui/src/shell/UnsetSetting.tsx:34-37`; `ui/src/shell/refusalRemedy.ts:31-32`; `ui/src/api/errorPresentation.ts:62-70, 86-89`; `backend/src/starnest/api/comparisons.py:98-109`. Screenshots: `shots/s2-70-settings-driven-03-SH-13-limit-unset.png`.
- **Source ids:** SH-13 (confirmed), CP-27 (confirmed)
- **Severity:** Medium, the rating of its most serious part; CP-27 (Low) rated it lower.
- **Related:** Refusing rather than falling back to five is decided (UI-31, NEW-26); this finding is about how the refusal reads.
- **Fix direction:** Treat it like the unset score range: plain wording and the calm "not set" card, naming the setting in words.

#### UF-135 — Low — Missing values read "—" instead of "No score", and card gaps have no "points"

- **Area:** Matrix and synthesis cards
- **Design says:** "Missing values show 'No score'" (README.md, 4. Compare); "'No score', never 0 or — in a score slot" (DECISIONS.md, Principles); cards read "+4.2 points" or "No comparable score" (README.md, 4. Compare).
- **What happens:** Liechtenstein's total and its missing pillars read "—", where Rank says "No score". A card with no gap shows "—", and gaps read "-7.0" or "+1.0" with no unit.
- **To reproduce:**
  1. Compare: add Liechtenstein and press Compare.
- **Evidence:** `ui/src/format/display.ts:35-39`; `ui/src/routes/compare/ComparisonMatrix.tsx:116, 137, 147, 266, 278`; `ui/src/routes/compare/CompareScreen.tsx:381`. Screenshots: `shots/40-compare-03-matrix-full.png`.
- **Source ids:** CP-16 (confirmed)
- **Fix direction:** Use "No score", "No value" and "No comparable score", and add "points".

#### UF-136 — Low — Compare opens empty, its Compare button is disabled without a reason, and "Raw figures" seems to do nothing

- **Area:** Selection
- **Design says:** The design opens with a focus (falling back to the first matching candidate), five comparators and Economy open (`.dc.html` l.1678-1679, 2302).
- **What happens:** On arrival nothing is chosen, no pillar is open, and Compare is disabled with no title or reason. Choosing "Raw figures" before a comparison changes only the note.
- **To reproduce:**
  1. Open Compare.
  2. Choose Raw figures.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:68-73`; `ui/src/routes/compare/ComparisonMatrix.tsx:55`. Log: `logs/s2-60-compare.json`.
- **Source ids:** CP-20 (confirmed)
- **Fix direction:** Choose a default focus (home or rank 1) and comparators and open the first pillar, or explain the disabled button and what the toggle affects.

#### UF-137 — Low — Comparator columns follow the order of the clicks, not the scores

- **Area:** Matrix
- **Design says:** Columns ordered by score, highest first (`.dc.html` l.2303-2304; screen 13).
- **What happens:** The columns read "Portugal against Malta, Romania, Germany, Liechtenstein, Poland" in click order, not by score (Malta 77, Poland 73, Romania 69, Germany 60), which makes the matrix and the cards harder to scan.
- **To reproduce:**
  1. Compare: tick comparators in any order and press Compare.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:151-157`; `ui/src/routes/compare/comparisonRequest.ts:18-20`. Screenshots: `shots/40-compare-03-matrix-full.png`.
- **Source ids:** CP-21 (confirmed)
- **Fix direction:** Order columns and cards by total score, with "No score" last.

#### UF-138 — Low — Pillar weights are whole percentages on the left, and the priority tags move when only the focus changes

- **Area:** Matrix, pillar rows
- **Design says:** The weight sits on the right, to one decimal, and the priorities come from the set's configured weights (README.md, 4. Compare; `.dc.html` l.2382, 2396).
- **What happens:** Weights read "18%" (Configure says 16.9) and "6%" (8.0), left-aligned, and come from the focus's own redistributed weights: with Liechtenstein as the focus, Economy becomes "#1 priority" at 29%, and Career, Culture and Family drop to 0%.
- **To reproduce:**
  1. Compare: draw a comparison and read the pillar weights.
  2. Make Liechtenstein the focus and read them again.
- **Evidence:** `ui/src/routes/compare/ComparisonMatrix.tsx:114, 219`; `ui/src/routes/compare/pillarMatrix.ts:151-160`; `ui/src/styles.css:1730-1737, 1857-1861`. Screenshots: `shots/s2-60-compare-04-CP-16-liechtenstein-focus.png`.
- **Source ids:** CP-23 (confirmed)
- **Fix direction:** Show the set's pillar weights to one decimal on the right, and take the priority tags from them.

#### UF-139 — Low — The Raw note and the attribute notes leave out what the design says

- **Area:** View choices
- **Design says:** "Pillar rows stay in points, and the note says why: a pillar has no unit of its own"; attribute notes read "in <unit>, as published" or "no value for <focus>" (README.md, 4. Compare; `.dc.html` l.2414-2415, 3111-3113).
- **What happens:** The Raw note never says why pillar rows stay in points. "normalised 0–100" appears even where the focus has no score, and label-set rows that have no gaps still say "gaps read focus minus comparator".
- **To reproduce:**
  1. Compare: choose Raw figures and open a pillar.
- **Evidence:** `ui/src/routes/compare/ViewChoices.tsx:49`; `ui/src/routes/compare/ComparisonMatrix.tsx:256, 293-298`. Screenshots: `shots/41-compare-views-02-raw-figures.png`.
- **Source ids:** CP-18 (confirmed)
- **Fix direction:** Restore the pillar sentence, say "no value for <focus>", and drop the gap wording where there is no gap.

#### UF-140 — Low — The limit note does not say how many are chosen

- **Area:** Selection
- **Design says:** "Up to N countries, the limit set in Configure. M chosen." (README.md, 4. Compare).
- **What happens:** The note gives the limit but not the number chosen, so the reader counts the ticks.
- **To reproduce:**
  1. Static: read the note.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:226`. No screenshot (found by reading the code).
- **Source ids:** CP-17 (static only)
- **Fix direction:** Add "M chosen".

#### UF-141 — Low — An empty "Ahead on" or "Behind on" list still shows its label

- **Area:** Synthesis cards
- **Design says:** Not specified; an empty list should not look like something that failed to load.
- **What happens:** When one side of a card has nothing, the label still prints over an empty list (seen by emptying the list in the browser; with the shipped data both lists had entries).
- **To reproduce:**
  1. In the browser, empty a comparison's "Behind on" list and draw it.
- **Evidence:** `ui/src/routes/compare/CompareScreen.tsx:391-404`. Screenshots: `shots/s2-92-latent-02-CP-24-empty-behind-on.png`.
- **Source ids:** CP-24 (confirmed †)
- **Fix direction:** Say "Nothing", or hide the label.

#### UF-142 — Low — Every comparison refusal offers "Change it in Configure", even when no setting is to blame, and prints raw ids

- **Area:** Refusals
- **Design says:** A remedy is offered only where a setting lifts the refusal (the code's own rule, `ui/src/shell/refusalRemedy.ts:24-25`).
- **What happens:** One refusal code covers no comparator, too many comparators, a country compared with itself, a duplicate, and a country not in the ranking ("'country.x' is not in this ranking"), and all of them get "Change it in Configure". Rare, because the picker prevents most, but when met it points to the wrong fix.
- **To reproduce:**
  1. Static: read the comparison refusals.
- **Evidence:** `ui/src/shell/refusalRemedy.ts:29`; `backend/src/starnest/comparison/comparison.py:102-141`. No screenshot (found by reading the code).
- **Source ids:** SH-27 (static only)
- **Fix direction:** Offer the remedy only for the over-the-limit case (a distinct code or detail), and word the refusals with names.

#### UF-143 — Nit — Two kinds of minus sign on one screen

- **Area:** Matrix and synthesis cards
- **Design says:** The real minus sign, U+2212, throughout (README.md, 3. Rank, Δ home; `.dc.html` l.2366, 2467).
- **What happens:** Matrix gaps use "−"; the cards and raw gaps use the hyphen ("-0.4", "-100.0 EUR"), so the same gap reads differently in two places and columns do not line up.
- **To reproduce:**
  1. Compare: draw a comparison with Raw figures and compare the signs.
- **Evidence:** `ui/src/routes/rank/rankTable.ts:270`; `ui/src/format/display.ts:48-55`. Screenshots: `shots/s2-60-compare-07-CP-22-governance-raw.png`.
- **Source ids:** CP-28 (confirmed)
- **Fix direction:** Use one formatter for every signed number.

#### UF-144 — Nit — Column headers are not styled as designed

- **Area:** Matrix
- **Design says:** "(focus)" in teal, every header right-aligned, 11.5 px bold (`.dc.html` l.2308-2311).
- **What happens:** All headers are grey, 11 px and left-aligned above right-aligned numbers, so the focus column does not stand out.
- **To reproduce:**
  1. Static: read the header styles.
- **Evidence:** `ui/src/styles.css:1743-1750`; `ui/src/routes/compare/ComparisonMatrix.tsx:97-104`. No screenshot (found by reading the code).
- **Source ids:** CP-29 (static only)
- **Fix direction:** Draw the focus header in the accent colour and right-align all headers.

## 4. Recorded divergences (not defects)

Each of these differs from the design on purpose, by a decision recorded somewhere. They are not counted above. Where the decision is not recorded in `docs/design-brief.md`, the design will keep asking for the designed behaviour; that gap is UF-022.

1. **The sidebar re-reads only when the screen changes or a run ends, so it shows old household figures and counts right after a Configure save.** UI-11's small fix, chosen on 2026-10-18 (`docs/copilot-remediation-plan.md`, lines 136-145: "It's stale until you navigate"). Marked in the reviews as SH inventory I07 (intentional), CA-I24 (decided) and CB I57; the browser finding HO-12 is this behaviour. Not in design-brief.md, and README Stage 2 still says edits flow to the card. The browser test shows the cost on one screen: the card beside the household form keeps the old figures after "Saved.", and the counts disagree with a threshold just saved (see also UF-004).
2. **No unsaved-changes state and no guard when switching sets: every edit writes straight through.** reqs Q168 (`docs/reqs.md:3236`) and `docs/arch.md:1027-1030`. SH inventory I09 (intentional), CA-I15 and CA-I16 (decided). The missing record for the design is part of UF-022.
3. **A level is offered as soon as it holds a candidate; City is disabled today because it holds none.** `docs/design-brief.md:135`; UX-REVIEW.md round 4, "Recorded, not redesigned". SH inventory I10.
4. **Opening a saved ranking shows it; it does not restore its weights over the live set.** `docs/design-brief.md:140`; UX-REVIEW.md round 4. SH inventory I17, CA-I68, RK inventory I-42.
5. **The pillar slider's ceiling scales with how many pillars share the hundred (never below 40).** `docs/design-brief.md`, "Divergences, and why each one is deliberate"; UX-REVIEW.md round 4. CA-I33.
6. **There is no include/exclude control for a criterion; the design's way to make one not count is a weight of 0.** P90, closed as not a gap (`docs/known-issues.md:537`). CA-I48 (decided). reqs 8.2 still asks for the control; how the three unscored criteria look today is UF-034.
7. **The acquisition diff is built in the client from stored values, so the design's "design only, no endpoint yet" badge is dropped.** `docs/todos.md:104` ("Q, the acquisition diff. Done, client side"). AQ inventory I-80.
8. **In Raw figures, an attribute's gap reads focus minus comparator, and the screen says so.** UI-19, decided and built in `f3ba2db` (`docs/copilot-cross-model-review.md:139`); noted by the Compare review as known. How this third convention adds to the sign confusion is part of UF-124.
9. **An unset comparator limit is refused rather than falling back to five, with a route to Configure.** UI-31 and NEW-26 (`docs/copilot-remediation-plan.md`, lines 110 and 335). CP inventory I-10. How the refusal reads is UF-134.
10. **The rule editor edits only a numeric threshold; a threshold of another shape is kept and the form says one is there.** P52 (`docs/known-issues.md:431`). Noted under CA-I47.
11. **After a refused rule save, the form returns to the stored rule.** P55 (`docs/known-issues.md:434`). Noted in CA-14; what remains wrong around it is UF-036.

## 5. Not tested, and why

- **Anything that spends money.** The backend had no AI key, so gate research and acquisitions that need the language model could not run (the research estimate answers 501). The research progress line, Stop, outcome line, the uncapped-spend refusal and the research spend were checked with responses simulated in the browser (UF-058, UF-059, UF-072), and the research spend ledger itself was never written.
- **A full sweep, "Retry 33 failed" or "Retry 14 unanswered".** Out of bounds: only three small free runs were started (130 and 131 in pass 1, 132 in pass 2). The sweep's one-click start (UF-082) and the all-sources-off case (UF-081) were read from the estimate and the code, not pressed.
- **A halt at the spend cap, and a long run's live progress.** The runs finished in under 5 s; the stopping state and the strip were checked with a simulated run.
- **`run_already_in_flight` with a real second start.** The runs were too short; it was simulated (UF-080).
- **Real gate effects.** The copy held no gate answers and there is no screen to record one (UI-29), so every gate "never fires". Pass 2 recorded two answers through the API to test citizenship (UF-029) and reset them to "unknown" afterwards, as the contract cannot delete an answer. The EU free-movement half stayed inconclusive: it has no answers, so it never fires either way.
- **The diff's "went missing" for whole transcribed tables (UF-073).** It cannot arise in the copy: its only full run predates the tables, whose rows came from migrations. The mechanism was reproduced with one re-confirmed figure.
- **A stopped container behind nginx.** `docker compose stop` was out of bounds; the down server was simulated with the dev proxy's empty 500 (UF-002). The 502 page nginx returns was read from its configuration, not seen.
- **A database with no values.** None was to hand, so the empty states were checked only with an empty set list (UF-011).
- **The design's unsaved-changes guard.** Not built, by decision (reqs Q168).
- **Anchor labels and the Quantity hand-entry path.** Anchor labels were not exercised, and no attribute in the catalog offers the Quantity form.
- **The city level.** Post-v1.
- **Screen readers and other browsers.** Only Chromium was available; accessibility was checked through the accessibility tree and the keyboard.
- **Speed.** Each open Rank row recomputes the whole level, and the sidebar computes a second ranking for its counts; this was noted but not timed.
- **The test suites.** The reviews ran no tests, builds or containers, so whether `make check` is green at `34409c5` was not checked.

**Left behind in the throwaway copy** (from the browser passes): the "HO Scratch" set and saved ranking 72 on it (neither can be deleted, UF-031 and UF-013); acquisitions 130, 131 and 132; one hand-entered figure (Residency admin ease, 7 on 0–10, for Portugal, which lowers its Governance score, UF-071); and two gate answers reset to "unknown". Everything else was put back.

## 6. Appendix: every original id and where it went

One row per original finding. "Severity" is the source's own rating; the finding's rating may differ, and says why when it does.

| Original id | Source | Severity | Verdict | Now |
|---|---|---|---|---|
| SH-01 | scan-shell | High | confirmed † | UF-002 |
| SH-02 | scan-shell | High | confirmed † | UF-001 |
| SH-03 | scan-shell | Medium | confirmed | UF-004 |
| SH-04 | scan-shell | Medium | confirmed | UF-003 |
| SH-05 | scan-shell | Medium | confirmed † | UF-008 |
| SH-06 | scan-shell | Medium | confirmed | UF-028 |
| SH-07 | scan-shell | Medium | confirmed † | UF-013 |
| SH-08 | scan-shell | Medium | confirmed | UF-009 |
| SH-09 | scan-shell | Medium | confirmed † | UF-005 |
| SH-10 | scan-shell | Medium | confirmed | UF-006 |
| SH-11 | scan-shell | Medium | confirmed † | UF-012 |
| SH-12 | scan-shell | Medium | confirmed | UF-010 |
| SH-13 | scan-shell | Medium | confirmed | UF-134 |
| SH-14 | scan-shell | Medium | confirmed † | UF-011 |
| SH-15 | scan-shell | Low | confirmed † | UF-017 |
| SH-16 | scan-shell | Low | confirmed | UF-018 |
| SH-17 | scan-shell | Low | static only | UF-021 |
| SH-18 | scan-shell | Low | confirmed | UF-014 |
| SH-19 | scan-shell | Low | static only | UF-020 |
| SH-20 | scan-shell | Low | confirmed | UF-019 |
| SH-21 | scan-shell | Low | static only | UF-015 |
| SH-22 | scan-shell | Low | confirmed † | UF-079 |
| SH-23 | scan-shell | Low | confirmed † | UF-016 |
| SH-24 | scan-shell | Low | confirmed | UF-007 |
| SH-25 | scan-shell | Low | static only | UF-017 |
| SH-26 | scan-shell | Low | static only | UF-083 |
| SH-27 | scan-shell | Low | static only | UF-142 |
| SH-28 | scan-shell | Low | static only | UF-022 |
| SH-29 | scan-shell | Nit | static only | UF-003 |
| SH-30 | scan-shell | Nit | static only | UF-023 |
| SH-31 | scan-shell | Nit | confirmed | UF-023 |
| SH-32 | scan-shell | Nit | static only | UF-024 |
| CA-01 | scan-configure-a | High | confirmed | UF-027 |
| CA-02 | scan-configure-a | High | confirmed | UF-025 |
| CA-03 | scan-configure-a | High | confirmed | UF-028 |
| CA-04 | scan-configure-a | High | confirmed | UF-029 |
| CA-05 | scan-configure-a | Medium | confirmed | UF-038 |
| CA-06 | scan-configure-a | Medium | confirmed | UF-030 |
| CA-07 | scan-configure-a | Medium | confirmed | UF-034 |
| CA-08 | scan-configure-a | Medium | confirmed | UF-035 |
| CA-09 | scan-configure-a | Medium | confirmed | UF-022 |
| CA-10 | scan-configure-a | Medium | confirmed | UF-003 |
| CA-11 | scan-configure-a | Medium | confirmed † | UF-012 |
| CA-12 | scan-configure-a | Medium | confirmed | UF-033 |
| CA-13 | scan-configure-a | Medium | confirmed | UF-031 |
| CA-14 | scan-configure-a | Medium | confirmed | UF-036 |
| CA-15 | scan-configure-a | Low | confirmed | UF-046 |
| CA-16 | scan-configure-a | Low | confirmed | UF-032 |
| CA-17 | scan-configure-a | Low | confirmed | UF-047 |
| CA-18 | scan-configure-a | Low | confirmed | UF-003 |
| CA-19 | scan-configure-a | Low | confirmed † | UF-009 |
| CA-20 | scan-configure-a | Low | confirmed | UF-055 |
| CA-21 | scan-configure-a | Low | static only | UF-051 |
| CA-22 | scan-configure-a | Low | confirmed | UF-052 |
| CA-23 | scan-configure-a | Low | static only | UF-048 |
| CA-24 | scan-configure-a | Low | confirmed † | UF-065 |
| CA-25 | scan-configure-a | Low | static only | UF-008 |
| CA-26 | scan-configure-a | Low | static only | UF-049 |
| CA-27 | scan-configure-a | Low | static only | UF-050 |
| CA-28 | scan-configure-a | Low | static only | UF-053 |
| CA-29 | scan-configure-a | Low | confirmed | UF-054 |
| CA-30 | scan-configure-a | Nit | confirmed | UF-067 |
| CA-31 | scan-configure-a | Nit | confirmed † | UF-067 |
| CA-32 | scan-configure-a | Nit | confirmed | UF-038 |
| CA-33 | scan-configure-a | Nit | static only | UF-068 |
| CA-34 | scan-configure-a | Nit | static only | UF-049 |
| CA-35 | scan-configure-a | Nit | static only | UF-022 |
| CB-01 | scan-configure-b | High | confirmed | UF-030 |
| CB-02 | scan-configure-b | High | confirmed † | UF-072 |
| CB-03 | scan-configure-b | Medium | confirmed | UF-039 |
| CB-04 | scan-configure-b | Medium | confirmed | UF-041 |
| CB-05 | scan-configure-b | Medium | confirmed | UF-040 |
| CB-06 | scan-configure-b | Medium | confirmed | UF-125 |
| CB-07 | scan-configure-b | Medium | confirmed | UF-033 |
| CB-08 | scan-configure-b | Medium | confirmed | UF-045 |
| CB-09 | scan-configure-b | Medium | confirmed | UF-042 |
| CB-10 | scan-configure-b | Medium | confirmed | UF-043 |
| CB-11 | scan-configure-b | Medium | confirmed | UF-044 |
| CB-12 | scan-configure-b | Medium | confirmed | UF-029 |
| CB-13 | scan-configure-b | Medium | confirmed | UF-075 |
| CB-14 | scan-configure-b | Medium | confirmed | UF-003 |
| CB-15 | scan-configure-b | Low | confirmed | UF-040 |
| CB-16 | scan-configure-b | Low | static only | UF-039 |
| CB-17 | scan-configure-b | Low | confirmed † | UF-056 |
| CB-18 | scan-configure-b | Low | static only | UF-057 |
| CB-19 | scan-configure-b | Low | static only | UF-063 |
| CB-20 | scan-configure-b | Low | confirmed | UF-004 |
| CB-21 | scan-configure-b | Low | confirmed | UF-015 |
| CB-22 | scan-configure-b | Low | confirmed † | UF-058 |
| CB-23 | scan-configure-b | Low | confirmed † | UF-059 |
| CB-24 | scan-configure-b | Low | confirmed | UF-061 |
| CB-25 | scan-configure-b | Low | confirmed | UF-062 |
| CB-26 | scan-configure-b | Low | static only | UF-064 |
| CB-27 | scan-configure-b | Low | confirmed † | UF-065 |
| CB-28 | scan-configure-b | Low | static only | UF-060 |
| CB-29 | scan-configure-b | Nit | static only | UF-069 |
| CB-30 | scan-configure-b | Nit | static only | UF-022 |
| CB-31 | scan-configure-b | Nit | static only | UF-022 |
| CB-32 | scan-configure-b | Nit | static only | UF-070 |
| AQ-01 | scan-acquire | Critical | confirmed | UF-073 |
| AQ-02 | scan-acquire | Critical | confirmed † | UF-072 |
| AQ-03 | scan-acquire | High | confirmed | UF-074 |
| AQ-04 | scan-acquire | High | confirmed | UF-076 |
| AQ-05 | scan-acquire | High | confirmed | UF-075 |
| AQ-06 | scan-acquire | High | confirmed † | UF-001 |
| AQ-07 | scan-acquire | Medium | confirmed | UF-009 |
| AQ-08 | scan-acquire | Medium | confirmed | UF-083 |
| AQ-09 | scan-acquire | Medium | confirmed † | UF-084 |
| AQ-10 | scan-acquire | Medium | confirmed | UF-085 |
| AQ-11 | scan-acquire | Medium | confirmed | UF-078 |
| AQ-12 | scan-acquire | Medium | confirmed † | UF-080 |
| AQ-13 | scan-acquire | Medium | confirmed † | UF-003 |
| AQ-14 | scan-acquire | Medium | confirmed † | UF-079 |
| AQ-15 | scan-acquire | Medium | confirmed † | UF-081 |
| AQ-16 | scan-acquire | Medium | confirmed | UF-087 |
| AQ-17 | scan-acquire | Medium | static only | UF-086 |
| AQ-18 | scan-acquire | Medium | confirmed | UF-082 |
| AQ-19 | scan-acquire | Medium | confirmed † | UF-012 |
| AQ-20 | scan-acquire | Medium | static only | UF-088 |
| AQ-21 | scan-acquire | Low | confirmed | UF-093 |
| AQ-22 | scan-acquire | Low | confirmed | UF-089 |
| AQ-23 | scan-acquire | Low | confirmed | UF-091 |
| AQ-24 | scan-acquire | Low | confirmed † | UF-090 |
| AQ-25 | scan-acquire | Low | confirmed | UF-086 |
| AQ-26 | scan-acquire | Low | confirmed | UF-095 |
| AQ-27 | scan-acquire | Low | confirmed | UF-077 |
| AQ-28 | scan-acquire | Low | static only | UF-096 |
| AQ-29 | scan-acquire | Low | static only | UF-097 |
| AQ-30 | scan-acquire | Low | confirmed † | UF-092 |
| AQ-31 | scan-acquire | Low | confirmed | UF-100 |
| AQ-32 | scan-acquire | Low | confirmed † | UF-017 |
| AQ-33 | scan-acquire | Nit | confirmed | UF-101 |
| AQ-34 | scan-acquire | Low | static only | UF-099 |
| AQ-35 | scan-acquire | Low | static only | UF-094 |
| AQ-36 | scan-acquire | Nit | confirmed † | UF-102 |
| AQ-37 | scan-acquire | Nit | static only | UF-086 |
| RK-01 | scan-rank | High | confirmed | UF-103 |
| RK-02 | scan-rank | Medium | confirmed | UF-105 |
| RK-03 | scan-rank | Medium | confirmed | UF-107 |
| RK-04 | scan-rank | Medium | confirmed † | UF-112 |
| RK-05 | scan-rank | Medium | confirmed | UF-104 |
| RK-06 | scan-rank | Medium | confirmed | UF-004 |
| RK-07 | scan-rank | Medium | confirmed | UF-111 |
| RK-08 | scan-rank | Medium | confirmed † | UF-005 |
| RK-09 | scan-rank | Medium | confirmed | UF-010 |
| RK-10 | scan-rank | Medium | confirmed | UF-106 |
| RK-11 | scan-rank | Medium | confirmed | UF-110 |
| RK-12 | scan-rank | Medium | confirmed † | UF-001 |
| RK-13 | scan-rank | Medium | confirmed | UF-108 |
| RK-14 | scan-rank | Medium | static only | UF-109 |
| RK-15 | scan-rank | Medium | confirmed | UF-087 |
| RK-16 | scan-rank | Medium | confirmed | UF-014 |
| RK-17 | scan-rank | Medium | confirmed † | UF-003 |
| RK-18 | scan-rank | Low | confirmed | UF-119 |
| RK-19 | scan-rank | Low | static only | UF-011 |
| RK-20 | scan-rank | Low | confirmed | UF-118 |
| RK-21 | scan-rank | Low | confirmed | UF-115 |
| RK-22 | scan-rank | Low | confirmed | UF-106 |
| RK-23 | scan-rank | Low | static only | UF-116 |
| RK-24 | scan-rank | Low | confirmed | UF-114 |
| RK-25 | scan-rank | Low | static only | UF-117 |
| RK-26 | scan-rank | Low | confirmed | UF-013 |
| RK-27 | scan-rank | Low | static only | UF-121 |
| RK-28 | scan-rank | Low | confirmed | UF-120 |
| RK-29 | scan-rank | Nit | confirmed | UF-122 |
| RK-30 | scan-rank | Nit | static only | UF-123 |
| RK-31 | scan-rank | Nit | static only | UF-024 |
| CP-01 | scan-compare | Critical | confirmed | UF-124 |
| CP-02 | scan-compare | High | confirmed | UF-126 |
| CP-03 | scan-compare | High | confirmed | UF-125 |
| CP-04 | scan-compare | Medium | confirmed | UF-130 |
| CP-05 | scan-compare | Medium | confirmed | UF-131 |
| CP-06 | scan-compare | Medium | confirmed | UF-127 |
| CP-07 | scan-compare | Medium | confirmed | UF-006 |
| CP-08 | scan-compare | Medium | confirmed | UF-132 |
| CP-09 | scan-compare | Medium | confirmed | UF-004 |
| CP-10 | scan-compare | Medium | confirmed † | UF-001 |
| CP-11 | scan-compare | Medium | confirmed | UF-133 |
| CP-12 | scan-compare | Medium | confirmed † | UF-003 |
| CP-13 | scan-compare | Medium | confirmed | UF-129 |
| CP-14 | scan-compare | Low | confirmed † | UF-016 |
| CP-15 | scan-compare | Low | static only | UF-011 |
| CP-16 | scan-compare | Low | confirmed | UF-135 |
| CP-17 | scan-compare | Low | static only | UF-140 |
| CP-18 | scan-compare | Low | confirmed | UF-139 |
| CP-19 | scan-compare | Low | static only | UF-063 |
| CP-20 | scan-compare | Low | confirmed | UF-136 |
| CP-21 | scan-compare | Low | confirmed | UF-137 |
| CP-22 | scan-compare | Low | confirmed | UF-126 |
| CP-23 | scan-compare | Low | confirmed | UF-138 |
| CP-24 | scan-compare | Low | confirmed † | UF-141 |
| CP-25 | scan-compare | Low | confirmed | UF-128 |
| CP-26 | scan-compare | Low | confirmed | UF-015 |
| CP-27 | scan-compare | Low | confirmed | UF-134 |
| CP-28 | scan-compare | Nit | confirmed | UF-143 |
| CP-29 | scan-compare | Nit | static only | UF-144 |
| CP-30 | scan-compare | Nit | static only | UF-022 |
| HO-01 | scan-hands-on | Critical | found in browser (pass 1) | UF-025 |
| HO-32 | scan-hands-on | Critical | found in browser (pass 1) | UF-071 |
| HO-02 | scan-hands-on | High | found in browser (pass 1) | UF-027 |
| HO-11 | scan-hands-on | High | found in browser (pass 1) | UF-026 |
| HO-35 | scan-hands-on | High | found in browser (pass 1) | UF-104 |
| HO-37 | scan-hands-on | High | found in browser (pass 1) | UF-124 |
| HO-03 | scan-hands-on | Medium | found in browser (pass 1) | UF-032 |
| HO-04 | scan-hands-on | Medium | found in browser (pass 1) | UF-030 |
| HO-05 | scan-hands-on | Medium | found in browser (pass 1) | UF-003 |
| HO-06 | scan-hands-on | Medium | found in browser (pass 1) | UF-007 |
| HO-08 | scan-hands-on | Medium | found in browser (pass 1) | UF-106 |
| HO-12 | scan-hands-on | Medium | found in browser (pass 1) | already decided as UI-11 (see Recorded divergences) |
| HO-13 | scan-hands-on | Medium | found in browser (pass 1) | UF-037 |
| HO-14 | scan-hands-on | Medium | found in browser (pass 1) | UF-036 |
| HO-16 | scan-hands-on | Medium | found in browser (pass 1) | UF-038 |
| HO-18 | scan-hands-on | Medium | found in browser (pass 1) | UF-030 |
| HO-21 | scan-hands-on | Medium | found in browser (pass 1) | UF-045 |
| HO-22 | scan-hands-on | Medium | found in browser (pass 1) | UF-026 |
| HO-24 | scan-hands-on | Medium | found in browser (pass 1) | UF-074 |
| HO-25 | scan-hands-on | Medium | found in browser (pass 1) | UF-074 |
| HO-26 | scan-hands-on | Medium | found in browser (pass 1) | UF-077 |
| HO-33 | scan-hands-on | Medium | found in browser (pass 1) | UF-106 |
| HO-34 | scan-hands-on | Medium | found in browser (pass 1) | UF-105 |
| HO-38 | scan-hands-on | Medium | found in browser (pass 1) | UF-125 |
| HO-39 | scan-hands-on | Medium | found in browser (pass 1) | UF-006 |
| HO-41 | scan-hands-on | Medium | found in browser (pass 1) | UF-003 |
| HO-07 | scan-hands-on | Low | found in browser (pass 1) | UF-112 |
| HO-09 | scan-hands-on | Low | found in browser (pass 1) | UF-115 |
| HO-10 | scan-hands-on | Low | found in browser (pass 1) | UF-014 |
| HO-15 | scan-hands-on | Low | found in browser (pass 1) | UF-051 |
| HO-17 | scan-hands-on | Low | found in browser (pass 1) | UF-035 |
| HO-19 | scan-hands-on | Low | found in browser (pass 1) | UF-038 |
| HO-20 | scan-hands-on | Low | found in browser (pass 1) | UF-039 |
| HO-23 | scan-hands-on | Low | found in browser (pass 1) | UF-004 |
| HO-27 | scan-hands-on | Low | found in browser (pass 1) | UF-082 |
| HO-28 | scan-hands-on | Low | found in browser (pass 1) | UF-098 |
| HO-29 | scan-hands-on | Low | found in browser (pass 1) | UF-086 |
| HO-30 | scan-hands-on | Low | found in browser (pass 1) | UF-089 |
| HO-31 | scan-hands-on | Low | found in browser (pass 1) | UF-081 |
| HO-36 | scan-hands-on | Low | found in browser (pass 1) | UF-013 |
| HO-40 | scan-hands-on | Low | found in browser (pass 1) | UF-133 |
| HO-42 | scan-hands-on | Low | found in browser (pass 1) | UF-023 |
| HO-43 | scan-hands-on | Low | found in browser (pass 1) | UF-015 |
| HO-44 | scan-hands-on | Low | found in browser (pass 1) | UF-015 |
| HO-45 | scan-hands-on | Low | found in browser (pass 1) | UF-120 |
| HO-47 | scan-hands-on | Low | found in browser (pass 1) | UF-075 |
| HO-48 | scan-hands-on | Low | found in browser (pass 1) | UF-046 |
| HO-50 | scan-hands-on | Low | found in browser (pass 1) | UF-052 |
| HO-46 | scan-hands-on | Nit | found in browser (pass 1) | UF-118 |
| HO-49 | scan-hands-on | Nit | found in browser (pass 1) | UF-066 |
| HO-51 | scan-confirmations | Low | found in browser (pass 2) | UF-001 |
| HO-52 | scan-confirmations | Nit | found in browser (pass 2) | UF-094 |
| HO-53 | scan-confirmations | Low | found in browser (pass 2) | UF-113 |
| HO-54 | scan-confirmations | Low | found in browser (pass 2) | UF-037 |

**Check.** Original ids in the inputs: **251** (SH 32, CA 35, CB 32, AQ 37, RK 31, CP 30, HO 54). Rows in this table: **251** (250 mapped to a UF finding, 1 marked as already decided). Every original id appears exactly once. The one browser check that was not reproduced, the unrated Compare layout check, has no finding id and is not counted.
