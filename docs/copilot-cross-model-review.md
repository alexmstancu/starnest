# Cross-model review of Copilot's remediation commits

**Date:** 2026-10-21. **Reviewed:** all 109 commits Copilot made during remediation, up to and including `4e462c8`.
**Reviewers:** two non-Claude models, each commit checked by both. GPT-6 Astra ran at max effort. Grok 4.7 ran at xhigh, its maximum.
**Method:** read-only and static. Reviewers read git objects at `4e462c8`; they did not run tests or read the working tree.
**Line numbers** refer to `4e462c8` unless stated otherwise.

The reviewers worked in four verticals:
- UI Configure;
- UI Acquire, Rank and Compare;
- backend (acquisition, API, gate research);
- infrastructure and docs (Makefile, e2e, browser specs).

No vertical broke an architecture rule. They found **22 distinct problems**; three were reported twice and are merged here.

**ID prefixes:**
- `UIC`: UI Configure.
- `UIR`: UI Acquire, Rank and Compare.
- `INF`: infrastructure.
- `DOC`: documentation.
- `BEA`, `BE-A`, `BEB`: backend.

**ID suffixes:**
- `-A`: GPT-6 Astra.
- `-G`: Grok 4.7.
- `-M`: Astra's Makefile pass.

**Severity** is my final call after weighing both models. Where it differs from what the reporting model said, that model's rating is shown in brackets.

**Status** is as of 2026-10-21: master `a7a2fa8`, plus the other agent's uncommitted work.

## Summary

| # | ID | Severity | Area | Status | Problem |
|---|---|---|---|---|---|
| H1 | INF-G1 / BEB-1 | High | Tooling | FIXED (`bf47645`, other agent) | `make check` was red: the migration-tooling guard did not know `e2e-database` |
| H2 | UIC-A1 | High | e2e isolation | FIXED (`cc02071`, follow-ups `d10a605`, `96a2166`) | A command-line `E2E_DATABASE_URL` lets the e2e migration reach the live database |
| H3 | INF-G2 | High | e2e isolation | FIXED (`cc02071`, `d10a605`); residual accepted: `docker-migrate` and `up` | `make e2e DATABASE_PORT=…` recreates the live database container |
| M1 | UIR-G1 | Medium | UI Acquire | FIXED (`e7a3a19`, `3075c76`); RB-2 accepted (P94) | Refresh, Dismiss or history Open during a start keeps the started run off the card |
| M2 | INF-M1 | Medium | Tooling | FIXED (`cc02071`) | `make -n e2e` runs the workflow and prints the database password |
| M3 | UIR-A2 / UIR-G2 | Medium | UI Compare | FIXED (`599c826`, `9261802`) | A euro gap is divided by the original-currency amount, and the gap has no unit label |
| M4 | UIR-A1 | Medium | UI Acquire | FIXED (`faf8085`, `3075c76`) | Refresh leaves the acquisition diff showing stale figures |
| M5 | UIC-A2 | Medium | UI Configure | FIXED (`eaf20a1`) | A research pass that stored nothing can leave an outdated proposal confirmable |
| M6 | UIC-A4 | Medium | UI Configure | FIXED (`df62171`) | A failed criteria-set switch hides Stop while paid research continues |
| M7 | UIC-G1 | Medium | UI Configure | FIXED (`372a40b`) | Saving or discarding a rule from the keyboard drops focus to the page |
| M8 | UIC-G2 | Medium | UI Configure | FIXED (`1f5b922`) | Enter in the place picker saves the household when several countries match |
| M9 | DOC-A1 | Medium | Docs | FIXED (tracker corrected 2026-10-22; code fixed by `946db36`) | The tracker marks BE-19 FIXED, but failures were still lost on a hard kill |
| L1 | BEA-1 | Low | Backend | ACCEPTED (2026-10-22): `known-issues.md` P93 | A hard kill loses a rejected figure's failure; a re-read rejected figure counts as stored |
| L2 | UIC-A3 | Low | UI Configure | FIXED (`0693baf`) | A set read racing a weight save can end on the old weights |
| L3 | BE-A1 | Low | Storage | FIXED (`cba634b`) | The 0503 rollback counts, then drops, without locking first |
| L4 | INF-M2 | Low | Tooling | FIXED (`cc02071`) | A failed e2e cleanup still reports success |
| L5 | INF-G3 / DOC-A4 | Low | Docs | FIXED (2026-10-22) | `known-issues.md` still lists the closed P35 as a standing risk |
| L6 | DOC-A2 | Low | Docs | FIXED (2026-10-22) | A checkpoint calls the restored gate answer "identical" |
| L7 | DOC-A3 | Low | Docs | FIXED (2026-10-22) | UI-03's test count predates its review fix |
| L8 | DOC-A5 | Low | Docs | FIXED (2026-10-22) | "Drops the copy whatever the outcome" is not true for Ctrl-C |
| L9 | UIR-G3 | Low | UI Acquire | FIXED (`faf8085`, `96f00a8`) | "What else would answer it" prints source ids instead of names |
| N1 | DOC-A6 | Nit | Docs | FIXED (2026-10-22) | "929 lines deleted" should be 923 |

**Totals by severity:** 3 High, 9 Medium, 9 Low, 1 Nit.

**Totals by status (2026-10-22):**
- 7 FIXED: INF-G1, and the six documentation findings.
- 1 ACCEPTED: BEA-1.
- 14 OPEN.

You settled the two disputed items, UIR-G1 and BE-A1, on 2026-10-22. See [Decisions](#decisions-2026-10-22).

## High

### H1. INF-G1 / BEB-1: `make check` was red at `4e462c8`

- **Severity:** High. Grok: High. Astra: Medium, in two separate passes.
- **Found by:** both models (`inf-grok`, `be-astra-api`, `inf-astra-make`).
- **Commits:** `fb53d42` added the guard. `05f17bd` and `854d78a` added `yoyo apply` to `e2e-database`.
- **Where:** `backend/tests/unit/test_migration_tooling.py:68-77`; `Makefile:192`.
- **Problem:** `test_every_make_target_that_runs_yoyo_backs_up_first` requires the targets that run yoyo to be exactly `migrate` and `rollback`. `e2e-database` also runs `yoyo apply`, against the throwaway copy, and has no `backup` prerequisite. So the unit suite failed, and `make check` with it.
- **My mistake:** my UI-03 handoff said "all green at `4e462c8`". After UI-03 I had run only `make ui-check`, not the full `make check`.
- **Suggested fix:** exempt the throwaway target. Keep the backup rule for the targets that touch the live database, and assert the throwaway target's own safeguards.
- **Status:** FIXED by the other agent in `bf47645`. `test_migration_tooling.py:69,81` now exempts `e2e-database`.

### H2. UIC-A1: a command-line `E2E_DATABASE_URL` lets the e2e migration reach the live database

- **Severity:** High. Astra: High; its Makefile pass confirmed it.
- **Found by:** GPT-6 Astra (`uic-astra`, `inf-astra-make`).
- **Commits:** `05f17bd`, `854d78a`.
- **Where:** `Makefile:183-192`. Playwright's `_e2e` refusal comes later, in `ui/playwright.config.ts:30-37`.
- **Problem:** only `E2E_DB` is `override`. `E2E_DATABASE_URL := …` is an ordinary assignment, and a command-line assignment beats it. So `make e2e E2E_DATABASE_URL=<live URL>` makes `e2e-database` run `yoyo apply` against the live database, with no backup, before Playwright refuses the database name.
- **Suggested fix:** make the derived URL `override` too. Before calling yoyo, check that the migration target is the copy that was just created.
- **Status:** FIXED in `cc02071`: every compose call goes through a guard that refuses compose variables from outside the Makefile, and the copy's URLs are set by the Makefile alone. The review of the fix found RA-1, RA-3 and RA-4, closed in `d10a605` and `96a2166`. See [Findings from the reviews of the fixes](#findings-from-the-reviews-of-the-fixes).

### H3. INF-G2: `make e2e DATABASE_PORT=…` recreates the live database container

- **Severity:** High. Astra: High. Grok: Medium.
- **Found by:** both models (`inf-grok`, `inf-astra-make`).
- **Commits:** `05f17bd`, `854d78a`, `8e306fe`.
- **Where:** `Makefile:183-198`, where `PG_TOOLS` runs `docker compose`. `compose.yaml:39` publishes `127.0.0.1:${DATABASE_PORT:-5432}:5432`.
- **Problem:** GNU make exports command-line variables into recipe environments. Compose then reads the new `DATABASE_PORT` and recreates the live `database` container on that port. The same applies to `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD`. This happened once, with `DATABASE_PORT=1` on 2026-10-20. The tracker recorded it, but nothing yet prevents it.
- **Suggested fix:** run the compose client with those variables unset (`env -u …`) and/or with `--no-deps`, so compose reads only `.env`. Keep `$(DATABASE_PORT)` for the host URL that yoyo and Playwright use.
- **Status:** FIXED in `cc02071` and `d10a605`: compose variables from the command line or an environment override are refused, and the e2e tools, `backup` and `schema-diagram` run `--no-deps`. Accepted residual (RA-2): `docker-migrate` and `up` keep their compose dependency, because `docker-migrate`'s compose-level backup is what makes it safe.

## Medium

### M1. UIR-G1: Refresh, Dismiss or a history Open during a start keeps the started run off the card (disputed)

- **Severity:** Medium. Grok: High.
- **Found by:** Grok (`uir-grok`).
- **The dispute:** GPT-6 Astra treats this behaviour as the approved trade-off of UI-04, where the last act decides what the card shows.
- **Commit:** `8bad828` (NEW-57).
- **Where:** `ui/src/routes/run/useRunScreen.ts:272-290, 307-331, 333`; `ui/src/routes/run/RunScreen.tsx:60, 565-585`.
- **Problem:**
  - Start claims a ticket with no run id yet.
  - During "Running…", three controls claim newer tickets:
    - Refresh, which is held only while `busy === "opening"`;
    - Dismiss;
    - a history Open.
  - So `watch(startTicket, started.id)` is ignored. The new run is stored and appears in the history, but the card keeps showing the previous run.
  - A later Start is then refused with `run_already_in_flight`.
  - `RunScreen.test.tsx:3496-3534` builds this interleaving, but only asserts that no second POST is sent.
- **Suggested fix (Grok):** either hold Refresh, Dismiss and history Open while `starting` is true, or let a start outrank a refresh of the run already on the card.
- **Status:** FIXED in `e7a3a19`, as you decided: Refresh, Dismiss and history Open are held while a start is pending. Its review found RB-1, Stop taking the card the same way, fixed in `3075c76`, and RB-2, leaving Acquire mid-start, which you accepted (`known-issues.md` P94).

### M2. INF-M1: `make -n e2e` runs the workflow and prints the database password

- **Severity:** Medium.
- **Found by:** GPT-6 Astra (`inf-astra-make`).
- **Commits:** `05f17bd`, `854d78a`.
- **Where:** `Makefile:192-198`.
- **Problem:**
  - GNU make runs any recipe line containing `$(MAKE)` even under `-n`, together with everything else on that line.
  - So a "dry run" drops, restores and migrates the copy, then launches the browser suite.
  - `-n` also prints the expanded database URL, password included.
- **Suggested fix:** move the orchestration into a helper script called from a non-recursive recipe, and read credentials inside the helper.
- **Status:** FIXED in `cc02071`: no recipe names `$(MAKE)`, so `make -n e2e` only prints, and the recipes read the copy's URLs as shell variables, so the password is never printed.

### M3. UIR-A2 / UIR-G2: Compare divides a euro gap by the original-currency amount

- **Severity:** Medium (both models).
- **Found by:** both models (`uir-astra-2`, `uir-grok`).
- **Commit:** `f3ba2db` (UI-19).
- **Where:**
  - `ui/src/routes/compare/attributeRows.ts:87-96`;
  - `ComparisonMatrix.tsx:71, 251-283`;
  - `divergingBar.ts:107-119`.
- **Problem:**
  - The server computes a monetary delta from `amount_eur` on both sides (`evaluation/magnitudes.py:43-44`, `comparison/comparison.py:195-199`).
  - The UI's `payloadMagnitude` returns `amount` before `amount_eur`, so the tint divides that euro gap by the original-currency figure.
  - Example: 150,000 HUF (€380) against 200,000 HUF (€510). The gap is −130 EUR, but the tint computes 130 / 150,000, which falls below the 5% `NOTICEABLE` threshold. So a real gap is drawn as noise.
  - The gap is also printed without a unit next to the HUF figures, under a note saying it is in "its own unit".
- **Suggested fix:** use `amount_eur` for monetary geometry and label monetary gaps as EUR. Add a test with a non-euro focus.
- **Status:** FIXED in `599c826`: the gap is computed from the euro amounts and labelled EUR. Its review found RC-1, that no screen showed the euro equivalent at all; fixed in `9261802`.

### M4. UIR-A1: Refresh leaves the acquisition diff showing stale figures

- **Severity:** Medium. Grok passed `876d75c`.
- **Found by:** GPT-6 Astra (`uir-astra-2`).
- **Commit:** `876d75c` (NEW-11).
- **Where:** `ui/src/routes/run/AcquisitionDiffPanel.tsx:33-47`; `RunScreen.tsx:256-259`.
- **Problem:**
  - The diff panel stays mounted across history reloads, and its values fetcher depends only on `[earlier, later]`. So Refresh never re-reads `/values`.
  - A diff against a run that is still going keeps its first figures. It can report "Went missing" for figures the run has since stored, even after the run finishes.
  - The tests keep the compared values static, so they miss this.
- **Suggested fix:** pass a refresh generation into the diff's resource. Add a test that changes the values, refreshes, and checks both the new contents and the kept selection.
- **Status:** FIXED in `faf8085`: the diff reads again when either run's progress moves. Its review found RB-3, a figure added for a pair already counted; fixed in `3075c76`, where a run still going is read again on every read of the history.

### M5. UIC-A2: a research pass that stored nothing can leave an outdated proposal confirmable

- **Severity:** Medium.
- **Found by:** GPT-6 Astra (`uic-astra`).
- **Commits:** `34f9b30`, `36bad8c` (UI-01).
- **Where:** `ui/src/routes/configure/proposals/researchPass.ts:155-161`; `useResearchPass.ts:102-106`.
- **Problem:**
  - If a person answers a gate while research is pending, the server declines the model's proposal. It returns a refusal with no proposals (`backend/src/starnest/data_acquisition/research.py:202-211`).
  - `mayHaveStored` is false when no proposals came back. So Configure is not told to re-read, the freshness counter does not move, and NEW-45's stale-list hold never engages.
  - After the pass ends, the old Confirm button works again and can overwrite the person's answer.
- **Suggested fix:** re-read answers after every successful research request, or at least when a refusal reports a displaced proposal.
- **Status:** FIXED in `eaf20a1`: a pass reads its answers again whenever it asked anything or failed.

### M6. UIC-A4: a failed criteria-set switch hides Stop while paid research continues

- **Severity:** Medium.
- **Found by:** GPT-6 Astra (`uic-astra`).
- **Commit:** `36bad8c`.
- **Where:** `ui/src/routes/configure/ConfigureScreen.tsx:85-125`; `useResearchPass.ts:177-193`.
- **Problem:**
  - Configure owns the research pass (line 51), but the panel with Stop, progress and spend renders only when `editor.status === "ready"`.
  - If the new set's read fails, those controls stay hidden while the loop keeps sending paid requests. The only way to stop it is to leave Configure.
- **Suggested fix:** mount the research controls independently of the criteria-set read state. Gate research is level-scoped and does not need a loaded set.
- **Status:** FIXED in `df62171`: a running or ended research pass keeps its panel, Stop included, when the rules panel is not shown.

### M7. UIC-G1: saving or discarding a rule from the keyboard drops focus to the page

- **Severity:** Medium.
- **Found by:** Grok (`uic-grok`).
- **Commit:** `73ebfc4` (NEW-34).
- **Where:** `ui/src/routes/configure/criteria/CriterionRuleFields.tsx:287, 295`; `useCriterionRule.ts:87`.
- **Problem:**
  - During the request, Save is only `aria-disabled`, so it keeps focus.
  - When the answer lands, the draft resets and `changed` becomes false. `disabled={!form.changed}` then natively disables the focused button, and Chromium moves focus to the page.
  - Discard does the same immediately.
  - The keyboard test asserts focus only while the button is held.
- **Suggested fix:** keep Save and Discard focusable (`aria-disabled`, ignoring the press), or move focus to a control that stays, as NEW-45 does.
- **Status:** FIXED in `372a40b`: Save and Discard are held (`aria-disabled`) and never natively disabled, so focus stays on them. The hook now refuses an unchanged draft, which native `disabled` used to do for Enter in a field.

### M8. UIC-G2: Enter in the place picker saves the household when several countries match

- **Severity:** Medium.
- **Found by:** Grok (`uic-grok`).
- **Commit:** `c53af61` (UI-26).
- **Where:** `ui/src/routes/configure/household/CandidateField.tsx:109`. The form is at `HouseholdPanel.tsx:120`.
- **Problem:**
  - `onKeyDown` calls `preventDefault` only when exactly one option matches.
  - With several matches, Enter submits `<form onSubmit={form.save}>`. If the household is already complete, it is saved with the previous choice, not the typed filter.
  - The same happens in the home-country and citizenship pickers.
- **Suggested fix:** while the list is open, prevent Enter's default action. Choose only when one option remains or one is highlighted.
- **Status:** FIXED in `1f5b922`: Enter chooses only when exactly one place matches, and does nothing while several are listed.

### M9. DOC-A1: the tracker marks BE-19 FIXED, but failures were still lost on a hard kill

- **Severity:** Medium.
- **Found by:** GPT-6 Astra (`inf-astra-docs`). On 2026-10-21 both verifiers of the other agent's work confirmed it (KT-B1, KT-G1).
- **Commits:** `707d321`, repeated in `d4bd036`, `a4fd7a0`, `95f7fb9`, `8e306fe` and `4e462c8`.
- **Where:**
  - the claim: `docs/findings-review-comparison.md:343`;
  - the code: `backend/src/starnest/data_acquisition/run.py:168-180`, and `execution.py:269, 387, 393`.
- **Problem:** values are committed per batch, but failures were written only on a halt, a caught exception, or completion. A hard kill lost every failure collected so far.
- **Suggested fix:** mark BE-19 PARTIAL and correct the tracker totals.
- **Status:** FIXED. The code gap was closed by `946db36`, which writes each batch's failures before the next fetch. The tracker note was corrected on 2026-10-22.

## Low

### L1. BEA-1: a hard kill loses a rejected figure's failure, and a re-read rejected figure counts as stored

- **Severity:** Low. Astra: Medium. It has the same root cause as BE-19's remainder (M9).
- **Found by:** GPT-6 Astra (`be-astra-acq`).
- **Commits:** `cef4abb` (BE-08), `b673fde` (NEW-54).
- **Where:** `backend/src/starnest/data_acquisition/run.py:158-170`; `storage/queries/runs.sql:410-429`.
- **Problem:**
  - A rejected figure's failure (BE-08) stayed in memory until the run ended. After a kill, neither retry path selects that pair.
  - A re-read rejected figure reads `stored=1, failed=0` in the per-source breakdown, because that query excludes only failures that were saved.
  - The acceptance "death" test raises a `RuntimeError`, which the handler catches. It never simulates a hard kill.
- **Suggested fix:** save each rejection failure together with its value or reuse row, ideally in one transaction. Add hard-kill tests for both cases.
- **Status:** ACCEPTED on 2026-10-22. `946db36` writes rejected-figure failures per batch. What remains is a narrow window: the value or reuse row commits before its failure, in a separate transaction (FU-A7). It is recorded as P93 in `known-issues.md`.

### L2. UIC-A3: a set read racing a weight save can end on the old weights

- **Severity:** Low. Astra: Medium. It needs a switch away and back within one save round trip on a local server.
- **Found by:** GPT-6 Astra (`uic-astra`).
- **Commit:** `b2a41e7` (UI-04).
- **Where:** `ui/src/routes/configure/useCriteriaEditor.ts:98-120`.
- **Problem:**
  - Save a weight in set A, switch away, and switch back while the PATCH is pending.
  - If the returning GET read A before the write committed, but arrives after the PATCH's answer, the screen ends on the old weights. The PATCH's answer was merged into an empty list.
  - The undo baseline can also be wrong.
- **Suggested fix:** invalidate reads taken before a write and re-read after it, or version the results.
- **Status:** FIXED in `0693baf`: each read carries how many writes to its set had been answered when it began, and a read that lands after another was answered is read again instead of shown. Its first test acted on a half-loaded screen and failed once under load; it now waits for the second read and `settled()`, the file's P13 convention.

### L3. BE-A1: the 0503 rollback counts, then drops, without locking first (disputed)

- **Severity:** Low. Astra: Medium. Grok passed `c99e4a1`. It needs a paid research call to commit during a manual rollback, with the backend still running.
- **Found by:** GPT-6 Astra (`be-astra-research`).
- **Commit:** `c99e4a1` (BE-34).
- **Where:** `storage/migrations/0503-gate-research-spend-is-ledgered.rollback.sql:12-21`.
- **Problem:** the `SELECT count(*)` takes only an `ACCESS SHARE` lock. A research insert can commit between the count and the `DROP TABLE`, so the rollback deletes a billed-call record it promised to refuse over.
- **Suggested fix:** take `LOCK TABLE match_rule_research_spend IN ACCESS EXCLUSIVE MODE` before counting. Add a two-connection test.
- **Status:** FIXED in `cba634b`, as you decided. The four refusing rollbacks (`0503`, `0493`, `0492`, `0478`) lock what they count before counting: ACCESS EXCLUSIVE in `0503`, whose drop takes it anyway, and SHARE ROW EXCLUSIVE elsewhere, so reads go on. Mapping the change found a sibling: `0444`, `0478` and `0492` copy `criterion` rows to put them back, and an edit committed between the copy and the delete was lost. They now lock `criterion` first, in both directions. (I told you only two migrations did this; the guard's own parse found `0444`.) Two guards in `test_migration_hygiene.py` hold every refusing rollback and every copying migration to the rule. `test_rollback_races.py` races a real write against each real rollback: before the fix `0503` dropped the billed row, the other three met raw foreign-key errors, and both copies lost the edit. Thirteen mutants (a lock removed, narrowed, weakened or moved) all fail. A real `yoyo rollback` through `0444` and back passed on a scratch database. The other agent's `0506` and `0507` do not refuse yet (FU-A5); the guard holds them once they do. The safe but raw foreign-key failures the mapping found are recorded as `known-issues.md` P95.

### L4. INF-M2: a failed e2e cleanup still reports success

- **Severity:** Low. Astra: Medium. Only a throwaway `_e2e` database is left behind.
- **Found by:** GPT-6 Astra (`inf-astra-make`).
- **Commits:** `05f17bd`, `854d78a`.
- **Where:** `Makefile:192-198`.
- **Problem:**
  - Line 198 keeps only the suite's exit status. If the suite passes and `dropdb` fails, `make e2e` still succeeds and the copy stays.
  - Line 192 prints "it was dropped" without checking that it was.
- **Suggested fix:** propagate a cleanup failure when the suite passed, and announce the drop only after it succeeded.
- **Status:** FIXED in `cc02071`: a failed drop fails the run, and the drop is announced only after it succeeded.

### L5. INF-G3 / DOC-A4: `known-issues.md` still lists the closed P35 as a standing risk

- **Severity:** Low. Grok: Medium. Astra: Low.
- **Found by:** both models (`inf-grok`, `inf-astra-docs`).
- **Commit:** `02288b5`.
- **Where:** `docs/known-issues.md:42-45`.
- **Problem:** the standing-mediums paragraph still says that `POST /v1/data-acquisition-runs` blocks, and calls P35 a standing risk. But the same file closes P35 at line 28, and `api/runs.py:319-323` runs `continue_run` in the background.
- **Suggested fix:** delete the P35 clause. P36 is the item that remains.
- **Status:** FIXED on 2026-10-22. The P35 clause is gone from the standing paragraph.

### L6. DOC-A2: a checkpoint calls the restored gate answer "identical"

- **Severity:** Low. Astra: Medium.
- **Found by:** GPT-6 Astra (`inf-astra-docs`).
- **Commit:** `0bd959d`.
- **Where:** `docs/findings-review-comparison.md:311`.
- **Problem:** the gate-c restore resends only `match_result` and `reason`, so the restored answer gets a new retrieval date. The same document says so at line 320.
- **Suggested fix:** limit the claim to the fields that were restored. The Greece answer itself was deleted on 2026-10-20.
- **Status:** FIXED on 2026-10-22. The tracker now says the gate answer kept its verdict and reason, with a new retrieval date.

### L7. DOC-A3: UI-03's test count predates its review fix

- **Severity:** Low.
- **Found by:** GPT-6 Astra (`inf-astra-docs`).
- **Commit:** `8e306fe`.
- **Where:** `docs/findings-review-comparison.md:427`.
- **Problem:** the document says 1,558 UI tests. That was the count after `05f17bd`. `854d78a` added five more, so the final count was 1,563.
- **Suggested fix:** attribute 1,558 to `05f17bd` and record 1,563.
- **Status:** FIXED on 2026-10-22. The tracker now attributes 1,558 to `05f17bd` and records 1,563.

### L8. DOC-A5: "drops the copy whatever the outcome" is not true for Ctrl-C

- **Severity:** Low.
- **Found by:** GPT-6 Astra (`inf-astra-docs`).
- **Commit:** `8e306fe`.
- **Where:** `docs/findings-review-comparison.md:421`; `Makefile:174, 198`.
- **Problem:** there is no signal trap, and the Makefile's own comment says Ctrl-C leaves the copy behind.
- **Suggested fix:** say that cleanup runs after success, after failure and after a setup failure, and that an interrupt leaves the copy until the next run or `make e2e-drop`.
- **Status:** FIXED on 2026-10-22. The tracker now says Ctrl-C leaves the copy until the next run or `make e2e-drop`.

### L9. UIR-G3: "What else would answer it" prints source ids instead of names

- **Severity:** Low.
- **Found by:** Grok (`uir-grok`).
- **Commit:** `7c6cb9e` (UI-32).
- **Where:** `ui/src/routes/run/unsourced.ts:175-180`. The rule it breaks is at `ui/src/format/display.ts:178-181`.
- **Problem:** `answerable_by` is printed as stored ids, such as `world_bank` and `llm`. The catalog already has display names (`storage/migrations/0100-catalog-reference-data.sql:61-65`), and pillars on the same screen already go through `pillarName`.
- **Suggested fix:** resolve each id through the source catalog's name.
- **Status:** FIXED in `faf8085`: the hint names the sources. Its review found RB-4, source ids in eight more places, fixed in `96f00a8`.

## Nit

### N1. DOC-A6: "929 lines deleted" should be 923

- **Found by:** GPT-6 Astra (`inf-astra-docs`).
- **Commits:** `cfabd6c`, `b428ed6`.
- **Where:** `docs/findings-review-comparison.md:301`; `docs/copilot-remediation-plan.md:333`.
- **Problem:** `2c04381` made 6 insertions and 923 deletions in `styles.css`. 929 is the sum of the two.
- **Suggested fix:** say 923.
- **Status:** FIXED on 2026-10-22, in both documents.

## Findings from the reviews of the fixes

Each cluster's fixes were reviewed by GPT-6 Astra against their consequence maps, the protocol's fifth step. These are what those reviews found, with each reviewer's severity.

| ID | Severity | Found in | Problem | Outcome |
|---|---|---|---|---|
| RA-1 | High | `cc02071` (H2) | Under `make -e`, an environment `E2E_YOYO_URL` might beat the target-specific one and migrate the live database | Not reproduced on GNU make 3.81, and withdrawn by the reviewer. Guarded anyway in `d10a605`: the copy's four names are refused from outside the Makefile. CLOSED |
| RA-2 | High | `cc02071` (H3) | `make -e`, or `e` in `MAKEFLAGS`, let the environment beat `.env`, and the guard checked only the command line; `backup` could recreate the database container | Both origins refused, and `backup` and `schema-diagram` run `--no-deps` (`d10a605`). PARTIAL, residual accepted: `docker-migrate` and `up` keep their dependency |
| RA-3 | High | `cc02071` (H2) | PostgreSQL keeps 63 bytes of a name, so the copy of a 63-byte database name was the live name, and `dropdb --force` would drop it | A name whose copy does not fit is refused, counted in bytes (`d10a605`). CLOSED |
| RA-4 | Medium | `d10a605` | The length guard counted a dotenv value's quotes, so a quoted name that fits was refused and `make e2e-drop` stopped working | Measured as the container's shell reads it (`96a2166`). Not yet re-reviewed |
| RC-1 | Medium | `599c826` (M3) | No screen showed a converted amount's euro equivalent, though `reqs.md` 5.5 requires it, and the commit message said Compare did | Shown beside every converted amount (`9261802`). CLOSED |
| RB-1 | Medium | `e7a3a19` (M1) | Stop could take the card from a pending start, as Refresh had | Stop held during a start (`3075c76`) |
| RB-2 | Medium | `e7a3a19` (M1) | Leaving Acquire and returning during a start loses the start's ownership | Accepted by you: `known-issues.md` P94 |
| RB-3 | Medium | `faf8085` (M4) | The diff's freshness key missed a figure added for a pair already counted | A run still going is read again on every read of the history (`3075c76`) |
| RB-4 | Medium | `faf8085` (L9) | Source ids were still printed in eight more places | The catalog's names everywhere (`96f00a8`) |

`3075c76`, `96f00a8`, `0693baf` and cluster D are under review now. `96a2166` and `cba634b` go to the final review.

## What the reviewers found sound

- **Architecture:** no rule broken in any vertical. This covers:
  - the UI speaking to the backend over HTTP only;
  - text-to-number parsing kept in plain modules;
  - styling kept in `styles.css`;
  - write controls held rather than natively disabled;
  - the policy/plugin import boundaries;
  - SQL kept in `storage/`.
- **Backend:** Grok reviewed 36 commits and found no new defect.
- **Browser specs:** Astra reviewed 5 commits and found no problem.
- **Not re-filed as new:** items already open were left alone. These are UI-18, UI-24, BE-11, NEW-48, BE-31 (PARTIAL at the time), BE-33, BE-36, NEW-55, NEW-56, NEW-58, NEW-59, NEW-61, NEW-62, NEW-64, NEW-65 and NEW-66.

## Why the chase does not end

The fixes kept producing new defects. This happened both in my 109 commits and in the other agent's follow-up. The causes fall into four classes, and none of them is random. Each class has one question that, asked before writing code, would have caught it.

**1. The fix covered the reported path and missed a sibling path.**
- Mine: UIR-G1, UIC-G1, UIC-G2, UIR-A2, BEA-1, UIC-A3.
- The other agent's: KT-A5, KT-B2, FU-A1.
- The question: **what else reaches this state?**

**2. The fix broke something that depended on the old behaviour.**
- Mine: UIR-A1. The diff panel was kept mounted, and its fetch had only ever re-run because the panel remounted.
- The other agent's: FU-A6. `items_total` changed meaning, but the contract still says "cross product".
- The question: **who reads what I am changing?**

**3. A new mechanism was built without listing how it can fail.**
- Mine (8): five in UI-03's Makefile, two in UI-01's research pass, and one in BE-34's rollback.
- The other agent's: KT-A1 (the missing cascade), FU-A5 (rollbacks that delete history).
- The question: **what happens on rollback, on a kill -9, with a second client, or on a database that already has data?**

**4. A rule lives in a comment, not in a check.**
- Mine: UIR-G3.
- The other agent's: KT-A1, where 0482's cascade rule was written down but not tested.
- The question: **would a test fail if someone broke this rule?**

The safety net had three holes as well:
- Tests checked one example rather than every path. For example, focus was asserted only while the button was held.
- Tests matched text rather than behaviour. The Makefile tests match recipe wording, which is how UIC-A1 and INF-G2 got through.
- Both agents called work done after a partial check. I did with INF-G1, and the other agent did with "BE-11 fully".

## The causal-change protocol

You adopted this on 2026-10-22, for both agents and every change.

1. **Name the rule being protected, not the symptom.** For example: "`make e2e` touches only its own `_e2e` copy, whatever is on the command line."
2. **Map the consequences before writing code**, using searches of the code as evidence:
   - *Paths in:* every way to reach the bad state.
   - *Paths out:* everything that reads what I change. That means tests that pin it, the UI, the API contract, docs, the CLI, and the other agent's lane.
   - *State and time:* a database that already has data, rollback, kill -9, requests in flight, a second client, tool versions.

   Every undesired or uncertain consequence is **reported to you before coding**.
3. **Write tests that cover every path first.** They run the real thing rather than matching text. Then undo the fix and confirm the tests fail.
4. **Guard the rule with a structural test** wherever the rule cuts across the codebase.
5. **Run the full gate on every commit:** `make check`, plus `make e2e` for UI or infrastructure. A claim of "green" names the command, the commit and the counts.
6. **Give reviewers the map**, and ask them to find what it is missing.
7. **Work one cluster at a time.** Each is merged and verified before the next starts.

**When the work stops:**
- Scope is frozen to this list.
- It is done when no High or Medium finding is open, and every Low is either fixed or recorded in `known-issues.md` with its reason, visibly and not hidden.
- One final independent review must then find no new Medium or worse caused by the fixes.
- A finding in that final review reopens only its own cluster.

## Plan for the open findings

The work runs in this order: docs (done 2026-10-22), then A, C, B, D and E. Each consequence below is something I would otherwise have discovered after the change. Each was raised with you before any code was written.

**A. e2e isolation: H2 UIC-A1, H3 INF-G2, M2 INF-M1, L4 INF-M2.** All four sit in `Makefile:180-198`.
- **The rule:** `make e2e` touches only its own `_e2e` copy, whatever is on the command line, under `-n`, or after a failure. It never prints the password.
- **The fix:**
  - `override E2E_DATABASE_URL`.
  - Run compose with every variable `compose.yaml` interpolates removed from its environment (`env -u`).
  - Call the cleanup through an indirect variable. GNU make runs a recipe line under `-n` only if it names `$(MAKE)` directly.
  - Pass the URL as a shell variable, so `-n` prints its name, not the password.
  - A failed cleanup fails the run, and the drop is announced only after it succeeded.
- **Consequences:**
  - `architecture.test.ts:409-415` and `test_migration_tooling.py:67-85` match the recipe text, so both change in the same commit. They become behaviour tests that put fake `docker`, `uv` and `npm` on `PATH`; the fakes record their arguments and environment.
  - A `DATABASE_PORT` exported in the shell that differs from `.env` now fails safe (connection refused) instead of moving the live container.
  - macOS runs GNU make 3.81, so every construct is checked on 3.81.
  - The Makefile is the master agent's file. You approved the change, and the other agent stays out of it meanwhile.

**C. Compare: M3 UIR-A2/G2.** The fix is in `attributeRows.ts:87-96`.
- **The rule:** a gap is judged in the unit the server subtracted.
- **The fix:** monetary shading divides by `amount_eur`, and the gap is labelled EUR. The figure itself stays in its own currency.
- **Consequences:** where there is no `amount_eur` (no ECB rate), there is no shading rather than wrong shading. Every importer of `payloadMagnitude` is checked first.

**B. Acquire: M1 UIR-G1, M4 UIR-A1, L9 UIR-G3.**
- **UIR-G1:** hold Refresh, Dismiss and history Open while a start is pending (`RunScreen.tsx:565, 584, 657`).
  - The ticket logic shared with NEW-49, NEW-52 and NEW-57 is not touched.
  - gate-c clicks Refresh only after the card shows the run, so it is unaffected.
  - During the start's round trip, the reader cannot open history or dismiss the card.
- **UIR-A1:** use `useResource`'s existing `freshness` argument, keyed on the selected runs' status and counts.
  - A refetch resets to "Loading" (`useResource.ts:55`). A running run's diff blinks once per refresh; a finished run never refetches.
- **UIR-G3:** source names come from the source catalog.
  - This adds one more read on Acquire. If it fails, the column shows nothing rather than ids.

**D. Configure: M5 UIC-A2, M6 UIC-A4, M7 UIC-G1, M8 UIC-G2, L2 UIC-A3.**
- **UIC-A2:** re-read the answers after any pass that asked something (`researchPass.ts:160`). That is one extra GET per pass, and Confirm is held for that round trip.
- **UIC-A4:** the research controls stay mounted when the set read fails. They must render exactly once, or two Stop buttons appear.
- **UIC-G1:** Save and Discard use `aria-disabled` instead of `disabled`.
  - Native `disabled` on the submit button is what stops Enter in a rule field from submitting today.
  - So `save` and `revert` must refuse an unchanged rule. Otherwise Enter would send it as a PATCH.
- **UIC-G2:** Enter never submits while the list is open (`CandidateField.tsx:109`). The list opens on focus, so Enter in the place box no longer saves the household.
- **UIC-A3:** a set read that started before a write finished is discarded and read again (`useCriteriaEditor.ts:98-120`).
  - This hook carries UI-04, UI-05, UI-08, UI-09 and NEW-07, so it has the widest blast radius in the list.
  - It is done last, with those findings' tests as the safety net.

**E. Rollbacks: L3 BE-A1.**
- **The fix:** take `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` before the count in `0503`'s rollback.
- **The same pattern:** `0478`, `0492` and `0493` also check and then act, so they get the same lock.
- **A guard test:** a rollback that refuses must lock what it counts.
- **Consequences:**
  - This relies on yoyo running each file in a transaction; no migration opts out. It is proven by running each rollback on the test database.
  - ST-19 stays closed. This change closes the race, and does not reopen ST-19.

**Not touched:**
- The other agent's acquisition and evaluation code, which carries FU-A1 to FU-A6.
- The API contract.
- New migrations.

## Decisions (2026-10-22)

| Question | Your decision |
|---|---|
| Protocol and stopping rule | Adopted, for both agents |
| Read-only | Lifted |
| Cluster A | Patch the Makefile, with behaviour tests |
| UIR-G1 | Hold Refresh, Dismiss and history Open while a start is pending |
| UIC-A3 | Fix it, last |
| Rollbacks that would delete recorded history | They refuse, and lock before counting: `0503`, `0478`, `0492`, `0493`, and the other agent's `0506` and `0507`, with a guard test |
| ST-07's remainder (FU-A3, FU-A4) | Finished as the approved plan says, by the other agent |
| BEA-1 / FU-A7 | Accepted and recorded (`known-issues.md` P93) |
