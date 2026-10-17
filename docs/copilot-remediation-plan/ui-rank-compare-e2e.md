# Detailed plan: UI Rank and Compare screens, and the browser test suite

> Written on 2026-10-14 by a read-only planning agent against `c943761`, before the scope rule of 2026-10-15. It is the step-by-step detail behind [copilot-remediation-plan.md](../copilot-remediation-plan.md). Where the two differ (scope, decisions, order), the main plan wins.

# Plan: Rank, Compare and browser-test findings (UI-03, UI-23, UI-15, UI-16, UI-18, UI-19, UI-20, UI-21, UI-25, UI-30)

I checked everything at HEAD `c943761`. The only change in this area since `7182d376` is `812f2ff`, which touched `gate-c.spec.ts`. The rank and compare code has not changed since the review, so its line numbers still hold. `ui/src/api/endpoints.ts` lost 19 lines; the line numbers below are re-located at HEAD. Nothing was run and no file was written.

---

### UI-03 [High] The browser tests use the live database through the Docker containers and can leave real answers and settings changed
- **Still present at HEAD?** Partly.
  - `ui/playwright.config.ts:39-55`: both servers use `reuseExistingServer: true` on `127.0.0.1:8000` and `localhost:5173`. Those are the ports Docker publishes (`compose.yaml:60,79`). So `make e2e` (`Makefile` `e2e:` runs `npm run e2e`) attaches to the last-built backend image and the live database.
  - `ui/e2e/gate-c.spec.ts:154-177,497-523`: the restore sends only `match_result` and `reason`.
    - `api/rules.py:61-68` then defaults `data_source` to `manual` and empties citations, period and override.
    - An answer that was absent comes back as a manual `matching`.
    - A faithful restore is impossible through the API: there is no DELETE for an answer, and the server stamps `override_date` itself (`rules.py:398-399`).
  - `ui/e2e/sanity.spec.ts:124-145`: the spend cap is restored at the end of the test body, so any earlier failure skips it. Lines 133-136 also reload the page without waiting for the save to land.
  - `gate-c.spec.ts:3` and `minimum-end-to-end.spec.ts:3`: an `UI_ORIGIN` override that defaults to port 5173.
- **Root cause:** The suite has no stack of its own. It borrows whatever is answering on the Docker ports, plus that stack's database. It then tries to undo global writes that the API cannot undo.
- **Fix:**
  1. `Makefile`: add the variables and targets below, replace the old `e2e` recipe, and extend `.PHONY`. `compose.yaml` stays unchanged because its `backup` tools service already has `pg_restore`, `createdb` and `dropdb`, and mounts `./backups`. The host has no `pg_restore`.
     ```make
     E2E_DB := $(POSTGRES_DB)_e2e
     E2E_BACKEND_PORT ?= 8100
     E2E_UI_PORT ?= 5180
     E2E_DATABASE_URL := postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@127.0.0.1:$(or $(DATABASE_PORT),5432)/$(E2E_DB)
     NEWEST_BACKUP := $(lastword $(sort $(wildcard backups/*.dump)))
     PG_TOOLS := docker compose --profile tools run --rm -T --entrypoint sh backup -c
     e2e-database: ## A throwaway copy of the newest backup, migrated to this checkout
     	@test -n "$(POSTGRES_DB)" || { echo "no .env: run make env"; exit 1; }
     	@test -n "$(NEWEST_BACKUP)" || { echo "no backup in ./backups: run make backup"; exit 1; }
     	@echo "e2e: $(notdir $(NEWEST_BACKUP)) -> $(E2E_DB)"
     	@$(PG_TOOLS) 'dropdb --if-exists --force $(E2E_DB) && createdb $(E2E_DB) && pg_restore --no-owner --no-privileges --single-transaction --dbname=$(E2E_DB) /backups/$(notdir $(NEWEST_BACKUP))'
     	@cd $(BACKEND) && uv run yoyo apply --batch --database '$(subst postgresql://,postgresql+psycopg://,$(E2E_DATABASE_URL))' ../$(STORAGE)/migrations
     e2e-drop: ## Drop the throwaway e2e database
     	@$(PG_TOOLS) 'dropdb --if-exists --force $(E2E_DB)'
     e2e: e2e-database ## Playwright on a throwaway copy of the newest backup, served from this checkout
     	@cd $(UI) && E2E_DATABASE_URL='$(E2E_DATABASE_URL)' E2E_BACKEND_PORT=$(E2E_BACKEND_PORT) E2E_UI_PORT=$(E2E_UI_PORT) \
     	  npm run e2e -- $(E2E_ARGS); status=$$?; $(MAKE) -C $(CURDIR) --no-print-directory e2e-drop; exit $$status
     ```
     - The recipes are `@`-prefixed so the password is never echoed.
     - The database name is derived from `POSTGRES_DB`, so the product name does not appear as a literal.
     - `E2E_ARGS` lets a single spec run, for example `make e2e E2E_ARGS=e2e/sanity.spec.ts`.
  2. `ui/playwright.config.ts`:
     - Read `E2E_DATABASE_URL`, `E2E_BACKEND_PORT` and `E2E_UI_PORT`; throw "run make e2e" if any is missing.
     - Throw if the database name (`new URL(url).pathname`) does not end in `_e2e`. The message prints only the database name, never the URL.
     - Set `baseURL` to `http://localhost:${uiPort}` and delete the `UI_ORIGIN` override.
     - Backend server:
       - URL `http://127.0.0.1:${backendPort}/v1/settings` with `reuseExistingServer: false`.
       - Environment `{ DATABASE_URL, PORT: backendPort, ANTHROPIC_API_KEY: "" }`.
       - This works without backend changes: `main.py:44-131` reads `PORT` and `DATABASE_URL`, environment variables beat `.env`, and an empty key switches the paid path off (`main.py:411`).
     - Vite server: `npm run dev -- --port ${uiPort} --strictPort`, with `reuseExistingServer: false` and `env: { BACKEND_ORIGIN: http://127.0.0.1:${backendPort} }`. `vite.config.ts:13` already reads `BACKEND_ORIGIN`.
     - `playwright show-report` never loads the config, so `make e2e-report` is unaffected.
  3. `gate-c.spec.ts`:
     - Delete `readTheGateAnswer` and `priorAnswer`, and the answer reset in `afterEach`. Keep the `beforeEach` that sets the arrangement and `enforceTheGate(false)`.
     - Comment why: the database is this run's own copy, and a faithful restore is impossible through the API.
     - Replace `BASE_URL` in `beforeAll`/`afterAll` with `testInfo.project.use.baseURL`. Do the same in `minimum-end-to-end.spec.ts:3,38-56`.
  4. `sanity.spec.ts` `configuring`:
     - Capture `run_spend_cap_eur` through `request.get("/v1/settings")` in `beforeEach`.
     - Restore it through `PUT /v1/settings {...current, run_spend_cap_eur}` in `afterEach`, which Playwright runs even when the test fails.
     - Wait for `Saved.` before reloading.
     - Delete the restore at the end of the body.
  5. `smoke.spec.ts:12`: correct the stale header comment that says it runs on the msw mock. In the `CLAUDE.md` commands table, change the `make e2e` row to describe the throwaway database.
- **Tests first:**
  - In `ui/src/app/architecture.test.ts`, add `describe("the browser suite's own stack")` as text guards, following the nginx guard from `812f2ff`. All four fail at HEAD.
    - `it("never attaches to a server it did not start")`: no `reuseExistingServer: true` in `playwright.config.ts`.
    - `it("names neither port the Docker stack publishes")`: no `8000` or `5173` in the config or in `ui/e2e/*.ts`.
    - `it("starts its backend on the throwaway database make e2e restored")`: the config reads `E2E_DATABASE_URL` and refuses a database without `_e2e`.
    - `it("lets no spec choose its own origin")`: no `UI_ORIGIN` anywhere.
  - Verify with a real `make e2e` run:
    - `GET :8000/v1/settings` and the Greece answer are identical before and after.
    - `docker compose logs database` shows writes only from `…@<db>_e2e` (the log prefix is `%u@%d` with `log_statement=mod`).
    - Afterwards no `_e2e` database exists.
  - Sad paths:
    - No backup: stops with "run make backup".
    - Port 8100 busy: Playwright refuses with "already used".
    - Bare `npx playwright test`: the config refuses.
    - A URL pointing at the live database: refused.
  - The sanity restore cannot fail first without injecting a failure mid-test. The `afterEach` structure plus `make e2e` lock it.
- **Migration / contract / docs:** No migration and no API contract change. Docs: the `CLAUDE.md` commands row, the Makefile help text, and the header comment in `playwright.config.ts`.
- **Files touched:** `Makefile`, `ui/playwright.config.ts`, `ui/e2e/gate-c.spec.ts`, `ui/e2e/minimum-end-to-end.spec.ts`, `ui/e2e/sanity.spec.ts`, `ui/e2e/smoke.spec.ts`, `ui/src/app/architecture.test.ts`, `CLAUDE.md`. Left unchanged: `compose.yaml`, `ui/vite.config.ts`, `backend/src/starnest/main.py`.
- **Behaviour change & risks:**
  - `make e2e` now needs Docker's database and at least one backup, and adds a few seconds (the newest dump is about 650 KB). The copy is migrated, so pending migrations are also rehearsed on real data.
  - The paid LLM path is off in e2e. No spec uses it, and this makes "the suite cannot spend" structural rather than true by accident.
  - Gate C's narrow run still fetches from Eurostat, as before.
  - Ctrl-C leaves the copy behind; the next run drops it.
  - Leftovers from earlier runs against Docker stay in the live database: `e2e_*` sets and a manual Greece answer. Cleaning them up is a data task, not code.
  - The password must be URL-safe. `compose.yaml:59` already has the same constraint.
- **Depends on / conflicts with:**
  - UI-23 must land straight after this; the first green `make e2e` comes only after it.
  - Other findings touch these specs: UI-31 (sanity `:282-300` text), UI-12 (`:391-394` regex), UI-08 (`:359`), UI-24 (gate-c `:300-309` Refresh poll).
  - `architecture.test.ts` is shared with other areas' guards.
- **Effort:** M.
- **Needs a user decision?** No. You decided the environment. I decided that Gate C's restore is removed, because it cannot be faithful.

### UI-23 [Medium] Browser specs look for controls by names the product no longer shows
- **Still present at HEAD?** Yes. I checked every selector in `ui/e2e/*.spec.ts` against the current markup.
  - **Stale (these fail today):**
    1. `gate-c.spec.ts:406,457,468` look for slider ``Weight for ${attribute}`` with the id `country.housing_cost_overburden_rate` (constant at `:59`). The product labels it "Weight for Housing cost overburden rate" (`CriteriaPanel.tsx:328,353`; name from `0101-catalog-pillars-and-attributes.sql:39`).
       - **Replacement:** `const A_CRITERION = { id, name: "Housing cost overburden rate" }`, the same pattern as `THE_EXCLUDED_ONE`. Look up `{ name: \`Weight for ${c.name}\`, exact: true }`. The pillar shortcut keeps using `c.id`.
    2. `minimum-end-to-end.spec.ts:182,239,252` (constant at `:54`) have the same problem. The `afterEach` at `:64-67` calls `setWeight`, so all four tests in that file fail.
       - **Replacement:** the same as item 1.
    3. `sanity.spec.ts:348-349,371-372` look for "Weight for country.rule_of_law".
       - **Replacement:** `"Weight for Rule of law"` with `exact: true` (`0101…sql:66`). The history assertion at `:359` (`hasText: "country.rule_of_law"`) stays, because the product currently writes the raw id there (see (c)).
    4. `gate-c.spec.ts:341` uses `getByRole("table").filter({ hasText: "Attribute" })`; no such table exists any more.
       - **Replacement:** `getByRole("table", { name: "Every pillar, focus against comparators" })` (`ComparisonMatrix.tsx:93-96`). The headers "Portugal" (a substring of "Portugal (focus)") and "Spain" still match.
  - **Vacuous or fragile (these pass but don't test what they claim, or are racy):**
    5. `gate-c.spec.ts:347-348`: `getByRole("checkbox").allInnerTexts()` returns empty strings, so the assertion is always true.
       - **Replacement:** the count of `getByRole("group", { name: "Compare with" }).getByRole("checkbox")` must equal the total from `/v1/candidates?level=country` minus the focus.
    6. `gate-c.spec.ts:295`: a row found by `hasText: String(run)` can be any row containing those digits.
       - **Replacement:** `page.getByRole("button", { name: String(run), exact: true })`.
    7. `sanity.spec.ts:186-199`: `locator("tbody tr").nth(2)` also counts rows of the evidence tables nested inside an opened row.
       - **Replacement:** open candidates by name, for example `getByRole("button", { name: "Finland", exact: true })`.
    8. `sanity.spec.ts:322`: `getByRole("table").last()` depends on table position.
       - **Replacement:** filter tables on `has: getByRole("columnheader", { name: "Started" })`.
    9. `minimum-end-to-end.spec.ts:89`: `hasText: "Matching"` also matches "Not matching", because the match is a case-insensitive substring.
       - **Replacement:** `has: getByText("Matching", { exact: true })`.
  - Every other selector matches the current markup: tabs, "Active criteria set", Pillar weights groups and openers, criteria-set and lock controls, settings fields, saved rankings, the Acquire cards and Refresh, the sidebar, and smoke.
- **Root cause:** The design pass moved accessible names from catalog ids to display names (`CriteriaPanel.tsx:319-321`) and the comparison into a pillar matrix. The specs were never run against the real product afterwards; when run, they ran against Docker.
- **Fix:** Apply the replacements above in the three specs. Add one `{ id, name }` constant per attribute the spec touches, and pass it through each spec's `openPillarOf`, `currentWeight`, `setCriterionWeight`/`setWeight` and `weightsInPillar` helpers.
- **Tests first:** The specs are the tests; no unit test can fail first because these selectors exist only in Playwright.
  - At the UI-03 commit, `make e2e` fails exactly seven tests: the four minE2E tests, gate-c "moves one weight…", gate-c "shows the deltas…", and sanity "records a weight change…".
  - After this fix, all of them pass. The replaced roster check (item 5) would fail if a city leaked into the comparator list.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/e2e/gate-c.spec.ts`, `ui/e2e/minimum-end-to-end.spec.ts`, `ui/e2e/sanity.spec.ts`.
- **Behaviour change & risks:** No product change. A catalog rename now breaks a spec loudly, which is the existing pattern for the hardcoded "Greece" and "Finland".
- **Depends on / conflicts with:** Needs UI-03 first. The same specs are hit by UI-31, UI-12, UI-08, UI-24 and UI-17 (the history table).
- **Effort:** S–M.
- **Needs a user decision?** No.

### UI-15 [Medium] Superseded and rejected values show the active value's score and contribution
- **Still present at HEAD?** Yes.
  - `ui/src/routes/rank/attributeScores.ts:35-55` keys each reading by attribute. `CandidateDetail.tsx:373,386,390` then print that reading on every row of the attribute, superseded and rejected included.
  - `CandidateDetail.tsx:404-406` labels every `is_active` value "Scored", including descriptive values and excluded LabelSet criteria (`0122`).
  - `pillarFilter.ts:67-78` gives an excluded criterion its configured weight.
  - The backend has the information and drops it: the domain carries `used_value` (`evaluation/results.py:60-67`), but `api/rankings.py:96-101,283-290` does not serve it. The contract already designs `AttributeScore.value` for this (`docs/openapi.yaml:1799-1813`; `:930-933` says "the exact value used").
- **Root cause:** The API drops the id of the value behind each contribution, so the UI can only match by attribute and treats "active" as "scored".
- **Fix:**
  1. `backend/src/starnest/api/rankings.py`:
     - `AttributeScoreBody` becomes a `ContractBody` with `omit_when_absent={"value"}` and a `value: ValueBody | None` field, reusing `api/values.py` `ValueBody` and `_value_body` as `comparisons.py:27-46` does.
     - `_attribute_score_body(row, listing)` takes the listing to serialise.
     - `get_ranked_candidate_detail` reads `values.read_values(candidate=…)` once and passes the listing whose id equals `row.used_value`.
  2. `backend/src/starnest/api/evaluations.py:171-183`: the saved drill-down uses the same read and the same helper, so the existing `live == saved` acceptance check still holds.
  3. Run `make openapi`.
  4. UI side:
     - `attributeScores.ts`: key readings by `row.value?.id`. Add a pure `inUse(value, readings)` that returns `scored | active | rejected | superseded`.
     - `pillarFilter.ts`: `judgementsByAttribute` returns `weight: null` when `is_scored === false`.
     - `CandidateDetail.tsx` `ValueTable`: look contributions up by `value.id`, and add a fourth chip, "Active", using the existing `chip--neutral` class.
     - `mocks/fixtures.ts`: move `ATTRIBUTE_SCORES` below `STORED_VALUES` and give each a `value` pointing at stored values 501 and 503.
- **Tests first:**
  - Fails today: in `RankScreen.test.tsx` › "what the pass made of each figure", add `it("prints nothing against a figure the pass did not use")`. The superseded cost-of-living row ("Eurostat 2024: 92.1") must not show 73, 12.5% or +9.1.
  - Fails today: update `it("shows every stored value…")` (`:396`) to expect Scored ×2, Active ×1 (air connectivity), Superseded ×1. It currently asserts Scored ×3, which encodes the bug.
  - Follow-ups:
    - A rejected row shows no contribution.
    - An active value whose criterion has `is_scored: false` reads "Active" with weight "—".
    - A contribution with no `value` attaches to no row.
    - With two active rows (breakdown options), only the used id gets the contribution.
    - `attributeScores.test.ts` is keyed by value id; replace "keeps the last row when an attribute appears twice".
    - `pillarFilter.test.ts`: `it("gives no weight to a criterion the set does not score")`.
  - Backend: in `test_evaluations_api.py`:
    - Live drill-down (`TestTheDrillDownOnALiveRanking`): `test_each_contribution_names_the_stored_value_it_was_computed_from` and `test_a_criterion_nothing_scored_names_no_value` (the field is omitted, not null).
    - Saved drill-down (`TestTheDrillDown`): `test_it_names_the_value_behind_each_contribution`.
- **Migration / contract / docs:**
  - No migration and no change to `docs/openapi.yaml`; this implements a field already designed there.
  - Regenerate `docs/openapi.implemented.yaml`.
  - Optional: a note in `docs/design-brief.md` that the "In use" column now has a fourth state.
- **Files touched:**
  - Backend (outside my area): `backend/src/starnest/api/rankings.py`, `backend/src/starnest/api/evaluations.py`, `backend/tests/acceptance/test_evaluations_api.py`, `docs/openapi.implemented.yaml`.
  - UI: `ui/src/routes/rank/attributeScores.ts` (+test), `ui/src/routes/rank/pillarFilter.ts` (+test), `ui/src/routes/rank/CandidateDetail.tsx`, `ui/src/routes/rank/RankScreen.test.tsx`, `ui/src/mocks/fixtures.ts`.
- **Behaviour change & risks:**
  - Superseded and rejected rows show "—" in the score, weight-used and contribution columns. Unscored active values read "Active". Excluded criteria show no weight. Each drill-down payload grows by about 43 value objects.
  - Risk: the live and saved drill-downs must be built from the same read, or `live == saved` breaks.
  - Risk: the value behind an old saved evaluation may no longer be active; it is shown as it is.
- **Depends on / conflicts with:** Shares `CandidateDetail.tsx` and `RankScreen.test.tsx` with UI-16, UI-18, UI-20, UI-21 and UI-30. Coordinate the backend `api/` files with the backend and storage planners (ST-07's remainder is in the evaluation store). `fixtures.ts` is shared.
- **Effort:** M.
- **Needs a user decision?** Yes: how should the drill-down learn which stored value a contribution used?
  - **A (recommended):** serve the already-designed `AttributeScore.value`. No API contract change, but it touches backend files outside this area.
  - **B:** add `used_value: integer|null` to the API contract. The smallest backend change, but it edits `docs/openapi.yaml`.
  - **C:** infer it in the UI from `is_active`. No backend change and correct for every shipped attribute, but wrong if an acquisition lands between the two reads, and ambiguous for broken-down attributes.

### UI-16 [Medium] The candidate drill-down silently stops at 500 stored values
- **Still present at HEAD?** Yes.
  - `ui/src/api/endpoints.ts:268-277` makes one request with `limit: 500` and no offset.
  - `CandidateDetail.tsx:170,281` titles the table "Every stored value" but uses only `items`.
  - The server pages, up to 1000 per request (`api/values.py:85-86`), in a stable order (`storage/queries/values.sql:131-133`).
- **Root cause:** The paging loop written for run reads (`endpoints.ts:296-330`, P89) was never applied to candidate reads.
- **Fix:** In `endpoints.ts`, extract a private `everyValue(query, options)` from `fetchValuesFromRun`. It keeps the same stop rules: a short page, or the offset reaching `total`. It also de-duplicates by `id`, because a value appended mid-read shifts the offset and could repeat a row. Both `fetchValues` and `fetchValuesFromRun` use it.
- **Tests first:**
  - Fails today: in `ui/src/api/endpoints.test.ts`, add `describe("reading every value one candidate has")` › `it("follows the pages rather than taking the first one")`. With 1,201 rows it must return 1,201 items over more than one request; today it returns 500.
  - Follow-ups:
    - Asks only once when one page holds everything.
    - Stops when the server over-reports `total`.
    - A candidate with no values returns an empty list.
    - `it("keeps one row for a value served on two pages")`.
    - Superseded values are asked for on every page.
    - A failure on page 2 rejects the whole read instead of returning a partial "everything".
    - In `RankScreen.test.tsx`, `it("shows a figure stored after the first five hundred")`: 500 identical copies (which fold into one row) plus a distinct 501st row, which must appear.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/api/endpoints.ts` (shared), `ui/src/api/endpoints.test.ts`, `ui/src/routes/rank/RankScreen.test.tsx`.
- **Behaviour change & risks:** The drill-down shows the complete history. A large history takes a few requests. An error on any page shows the error notice with Retry. Low risk.
- **Depends on / conflicts with:** `endpoints.ts` is likely touched by UI-17 (run paging) and UI-29 (a gate-answer client).
- **Effort:** S.
- **Needs a user decision?** No.

### UI-18 [Medium] Scores are clamped to 100, and the screens assume a 0–100 scale
- **Still present at HEAD?** Yes.
  - `rankTable.ts:95-100,208,223,227-229` print the clamped score as the bar label and title. Line 141 hardcodes a drawing range of 40–96.
  - `CandidateDetail.tsx:292` says "Score 0–100"; `:473,484` draw the card bar as ``${score}%`` of a 100-wide track.
  - `ComparisonMatrix.tsx:256` says "normalised 0–100"; `ViewChoices.tsx:33,48,79` say "0–100".
  - `SavedRankingView.tsx:35-41` never uses the frozen scale, although the contract offers it (`EvaluationSummary.score_scale_max`, `docs/openapi.yaml:1786-1797`: "Read scores against this").
- **Root cause:** The coverage-percentage clamp was reused for scores, and 100 is assumed everywhere instead of reading the live or frozen scale.
- **Fix:**
  1. `rankTable.ts`: `pillarBars(pillars, name, scaleMax: number | null)` prints the server's score unclamped in label and title. Height is drawn from `score / scaleMax` against a range of 0.40–0.96 of the scale. It returns an empty list when the scale is unknown. Add `scoreTrack(score, scaleMax)` for the card bars.
  2. `format/display.ts`: add `scoreRange(max)`, returning "0–150", or an empty string when unknown.
  3. `RankScreen.tsx`: read `fetchSettings` and pass `scoreScaleMax` to `RankingTable` and to `CandidateDetail` (the column header and card bars).
  4. `SavedRankingView.tsx`: read `fetchEvaluations()`, take this evaluation's `score_scale_max`, pass it to the table, and add "scored out of N" to its note. The existing "As it was when it was saved" wording stays.
  5. `CompareScreen.tsx` already reads settings: pass `score_scale_max` to `ComparisonMatrix` (the note) and to `ViewChoices` (labels and sentences).
- **Tests first:**
  - Fails today: `rankTable.test.ts` `it("prints a pillar's score as the server sent it, above 100 on a wider scale")`. Score 128 on scale 150 must label "128"; today it labels "100".
  - Follow-ups:
    - 75 on scale 150 draws the same height as 50 on scale 100.
    - Nothing is drawn when the scale is unknown.
    - `RankScreen.test.tsx` `it("heads the score column with the scale in use")` with settings at 150, plus a chart button named "Economy: 128…".
    - `SavedRankingsPanel.test.tsx` `it("reads a saved ranking against the scale it was saved with")` with a frozen scale of 50.
    - `CompareScreen.test.tsx` `it("labels attribute scores with the scale in use")`.
    - `display.test.ts` for `scoreRange`.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/rank/rankTable.ts` (+test), `RankingTable.tsx`, `RankScreen.tsx`, `CandidateDetail.tsx`, `SavedRankingView.tsx`, `SavedRankingsPanel.test.tsx`, `RankScreen.test.tsx`; `ui/src/routes/compare/ComparisonMatrix.tsx`, `ViewChoices.tsx`, `CompareScreen.tsx`, `CompareScreen.test.tsx`; `ui/src/format/display.ts` (+test, shared).
- **Behaviour change & risks:** Nothing changes at scale 100. On other scales, numbers print exactly as the server sent them and the bars follow the scale. One extra read each for settings and the evaluation list. If settings change between the two reads, the label could briefly disagree; with one local user this is negligible.
- **Depends on / conflicts with:** `CandidateDetail.tsx` (UI-15, UI-20, UI-30), `ComparisonMatrix.tsx` (UI-19), `CompareScreen.tsx` (UI-25), and the shared `display.ts`.
- **Effort:** M.
- **Needs a user decision?** No. The alternative is to add `score_scale_max` to `Ranking` and `Comparison`; it is race-free but changes the API contract.

### UI-19 [Medium] Raw comparison mode shows ahead and behind the wrong way round
- **Still present at HEAD?** Yes.
  - `attributeRows.ts:88-95` computes the score delta as comparator minus focus.
  - `:120` passes the raw delta through as the server's focus minus comparator (`docs/openapi.yaml:1864`; `comparison/comparison.py:194-198`).
  - `ComparisonMatrix.tsx:269-272` draws `divergingBar(cell.rawDelta…)`, and `divergingBar.ts:100` reads a positive value as "ahead".
- **Root cause:** One bar function is fed two deltas measured from opposite sides. Also, the sign of a raw gap says which figure is higher, not which is better.
- **Fix:**
  1. `attributeRows.ts`: add `AttributeCell.rawBar`: the size of the raw gap, signed by `scoreDelta`. The server's normalised scores say which side is better for every goal, including target ranges. It is null when either delta is missing or the scores tie.
  2. `ComparisonMatrix.tsx`, raw mode:
     - Draw the bar with `divergingBar(cell.rawBar, row.rawScale, row.focusRaw)`.
     - Keep the text as the server's number, `formatSigned(cell.rawDelta)`.
     - Change the note to "its own unit; gaps read focus minus comparator".
- **Tests first:**
  - Fails today: `attributeRows.test.ts` `it("draws a comparator that scored lower as behind in raw figures, whichever way its figure moved")`. For a maximised attribute, focus 70 against comparator 64 with a raw gap of +1341 must give `behind`.
  - Follow-ups:
    - Minimised attribute: raw +13.4 with the comparator scoring higher gives `ahead`.
    - A target range on both sides of the band.
    - A side with no score gives null (no colour).
    - Tied scores give null.
    - `CompareScreen.test.tsx` `it("says which way a raw gap is measured")`.
    - The existing "-13.4" test is unchanged.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/compare/attributeRows.ts` (+test), `ComparisonMatrix.tsx`, `CompareScreen.test.tsx`.
- **Behaviour change & risks:** Colours and directions in raw mode now agree with score mode. The text still shows the server's own number.
- **Depends on / conflicts with:** `ComparisonMatrix.tsx` with UI-18.
- **Effort:** S.
- **Needs a user decision?** Yes: which way should the raw number read?
  - **A (recommended):** keep the server's focus-minus-comparator number with the explicit label above.
  - **B:** negate it so both modes read comparator minus focus. More consistent visually, but the number on screen is then calculated by the UI.

### UI-20 [Medium] Outside opinions show neither the period they describe nor when they were fetched
- **Still present at HEAD?** Yes. `CandidateDetail.tsx:561-599` renders only Publisher, Published, Scale and Caveats. The dates appear only in the React key. `published_rank_of` is never shown, although the backend serves it (`api/values.py:263-268`).
- **Root cause:** The table was built around the number and its scale; the provenance dates went into the row key instead.
- **Fix:** In `ExternalScoreTable`, add a block under the publisher name using the existing global `value-cell__meta` classes, so no CSS change is needed:
  - "Describes {start} to {end}" and "Fetched {date and time}", using `formatDate` and `formatDateTime`, with "—" when a date is missing.
  - Show the rank as "rank N of M" when a denominator is given.
- **Tests first:**
  - Fails today: `RankScreen.test.tsx` `it("dates each outside opinion: the period it describes and when it was fetched")`. The Numbeo row must contain "1 Jan 2026 to 30 Jun 2026" and the fetch time.
  - Follow-ups: `it("gives a publisher's rank out of how many it ranked")` and `it("prints a dash for a date the publisher did not give")`.
- **Migration / contract / docs:** None. Optional note in `docs/design-brief.md`.
- **Files touched:** `ui/src/routes/rank/CandidateDetail.tsx`, `ui/src/routes/rank/RankScreen.test.tsx`.
- **Behaviour change & risks:** Two more facts on each outside-opinion row. No risk.
- **Depends on / conflicts with:** UI-30 changes the same table; UI-15 and UI-18 change the same file.
- **Effort:** S.
- **Needs a user decision?** No.

### UI-21 [Medium] Folding repeated values hides different quotes and citations
- **Still present at HEAD?** Yes. The fold's fingerprint (`repeatedValues.ts:38-49`) ignores quote and citations. `:67-77` keeps only the newest copy, and `CandidateDetail.tsx:308,325-328,357-359` show that copy's citations and quote alone.
- **Root cause:** "Same evidence" was defined by the figure, not by the evidence the row shows.
- **Fix:** In `fingerprintOf`, also hash `value.quote || null` and `value.citations ?? []`. The server already sorts citations (`values.sql:118`). Fix the doc comment to match.
- **Tests first:**
  - Fails today in `repeatedValues.test.ts`: `it("keeps figures that cite different pages apart")` and `it("keeps figures whose quotes differ apart")`.
  - Follow-ups: `it("still folds copies whose missing quote and citations are written differently")` (null, "" and [] count as the same), and `RankScreen.test.tsx` `it("shows each re-read's own pages when they differ")`.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/rank/repeatedValues.ts` (+test), `ui/src/routes/rank/RankScreen.test.tsx`.
- **Behaviour change & risks:** Re-reads with different evidence now show as separate rows. No risk.
- **Depends on / conflicts with:** `RankScreen.test.tsx` is shared with the other rank findings.
- **Effort:** S.
- **Needs a user decision?** No.

### UI-25 [Low] Clearing the comparison focus leaves Compare enabled, and clicking it does nothing
- **Still present at HEAD?** Yes.
  - `CompareScreen.tsx:255` passes the placeholder's empty string to `onFocus`; `:146-149` store it as the focus.
  - `:291` disables the button only for `null`, while `:158` submits only when the focus is truthy.
  - `AttributeDrillDown.tsx:67` already does it correctly with `|| null`.
- **Root cause:** Two different checks for "no focus", and the empty string is never normalised to null.
- **Fix:**
  - New pure `ui/src/routes/compare/comparisonRequest.ts`: `requestFor(focus, comparators)` returns `{ focus, comparators }` or `null`.
  - The select's `onChange` maps `""` to `null`.
  - The button's `disabled` and its `onCompare` both use `requestFor`.
- **Tests first:**
  - Fails today: `CompareScreen.test.tsx` `it("disables Compare again when the focus is cleared")`.
  - Follow-ups: choosing a focus again re-enables the button; the ticked comparators are kept; `comparisonRequest.test.ts` covers null, "", no comparators and a valid request.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/compare/CompareScreen.tsx`, `ui/src/routes/compare/comparisonRequest.ts` (+test, new), `CompareScreen.test.tsx`.
- **Behaviour change & risks:** After clearing the focus, Compare is disabled. The previous result stays visible under its own heading, which is deliberately the same as changing the focus without pressing Compare.
- **Depends on / conflicts with:** `CompareScreen.tsx` with UI-18.
- **Effort:** S.
- **Needs a user decision?** No.

### UI-30 [Low] Outside-opinion row keys ignore when the period ends
- **Still present at HEAD?** Yes. The key at `CandidateDetail.tsx:577-582` uses source, period start and retrieval date. The database's natural key also includes the period end (`0113-external-scores-span-a-period.sql:19-21`).
- **Root cause:** The key was written before migration 0113 widened the natural key.
- **Fix:** Add `score.reference_period?.end ?? ""` to the key. That is the whole natural key; the contract has no row id.
- **Tests first:**
  - Fails today: `RankScreen.test.tsx` `it("keeps two editions apart when only the end of their period differs")`. React's duplicate-key warning already fails tests through `failOnConsoleError` in `ui/src/test-setup.ts`.
  - The test also asserts that both editions' values are shown.
- **Migration / contract / docs:** None.
- **Files touched:** `ui/src/routes/rank/CandidateDetail.tsx`, `ui/src/routes/rank/RankScreen.test.tsx`.
- **Behaviour change & risks:** None visible.
- **Depends on / conflicts with:** UI-20 touches the same table.
- **Effort:** S.
- **Needs a user decision?** No.

---

**(a) Commit grouping, in priority order.** Gate each commit on `make check`; the e2e commits also need `make e2e`.
1. `fix(e2e): the browser suite runs on its own throwaway database and servers, never the Docker stack (UI-03)`. Files: Makefile, `ui/playwright.config.ts`, `ui/e2e/{gate-c,minimum-end-to-end,sanity,smoke}.spec.ts`, `ui/src/app/architecture.test.ts`, `CLAUDE.md`. Expect `make e2e` to fail only UI-23's seven tests.
2. `fix(e2e): the browser specs find controls by the names the product shows (UI-23)`. Files: the three specs. `make e2e` should then be green.
3. `fix(ui): a contribution is shown only beside the stored value it was computed from (UI-15)`. Files: `api/rankings.py`, `api/evaluations.py`, `test_evaluations_api.py`, `openapi.implemented.yaml`, `attributeScores.ts`, `pillarFilter.ts`, `CandidateDetail.tsx`, `RankScreen.test.tsx`, `fixtures.ts`. This can be split into api and ui commits if you prefer.
4. `fix(ui): the drill-down shows every stored value, each re-read's own pages, and an outside opinion's two dates (UI-16, UI-21, UI-20)`. Files: `endpoints.ts`, `repeatedValues.ts`, `CandidateDetail.tsx`, tests.
5. `fix(ui): scores are read against the configured or frozen scale, never clamped to 100 (UI-18)`.
6. `fix(ui): raw comparison figures take ahead and behind from the server's scores (UI-19)`.
7. `fix(ui): clearing the comparison focus disables Compare (UI-25)`. Low.
8. `fix(ui): outside-opinion rows are keyed by their whole period (UI-30)`. Low; it could be folded into commit 4.

**(b) Every file the plans touch**

| File | IDs | Note |
|---|---|---|
| `Makefile` | UI-03 | |
| `ui/playwright.config.ts` | UI-03 | |
| `ui/e2e/gate-c.spec.ts` | UI-03, UI-23 | also affected by UI-24 |
| `ui/e2e/minimum-end-to-end.spec.ts` | UI-03, UI-23 | |
| `ui/e2e/sanity.spec.ts` | UI-03, UI-23 | also affected by UI-31, UI-12, UI-08, UI-17 |
| `ui/e2e/smoke.spec.ts` | UI-03 | comment only |
| `ui/src/app/architecture.test.ts` | UI-03 | shared |
| `CLAUDE.md` | UI-03 | commands row |
| `backend/src/starnest/api/rankings.py` | UI-15 | backend area |
| `backend/src/starnest/api/evaluations.py` | UI-15 | backend area |
| `backend/tests/acceptance/test_evaluations_api.py` | UI-15 | |
| `docs/openapi.implemented.yaml` | UI-15 | regenerated |
| `ui/src/mocks/fixtures.ts` | UI-15 | shared |
| `ui/src/routes/rank/attributeScores.ts` (+test) | UI-15 | |
| `ui/src/routes/rank/pillarFilter.ts` (+test) | UI-15 | |
| `ui/src/routes/rank/CandidateDetail.tsx` | UI-15, UI-18, UI-20, UI-30 | |
| `ui/src/routes/rank/RankScreen.test.tsx` | UI-15, UI-16, UI-18, UI-20, UI-21, UI-30 | |
| `ui/src/api/endpoints.ts` | UI-16 | shared |
| `ui/src/api/endpoints.test.ts` | UI-16 | |
| `ui/src/routes/rank/repeatedValues.ts` (+test) | UI-21 | |
| `ui/src/routes/rank/rankTable.ts` (+test) | UI-18 | |
| `ui/src/routes/rank/RankingTable.tsx` | UI-18 | |
| `ui/src/routes/rank/RankScreen.tsx` | UI-18 | |
| `ui/src/routes/rank/SavedRankingView.tsx` | UI-18 | |
| `ui/src/routes/rank/SavedRankingsPanel.test.tsx` | UI-18 | |
| `ui/src/format/display.ts` (+test) | UI-18 | shared |
| `ui/src/routes/compare/ComparisonMatrix.tsx` | UI-18, UI-19 | |
| `ui/src/routes/compare/ViewChoices.tsx` | UI-18 | |
| `ui/src/routes/compare/CompareScreen.tsx` | UI-18, UI-25 | |
| `ui/src/routes/compare/CompareScreen.test.tsx` | UI-18, UI-19, UI-25 | |
| `ui/src/routes/compare/attributeRows.ts` (+test) | UI-19 | |
| `ui/src/routes/compare/comparisonRequest.ts` (+test) | UI-25 | new |
| `docs/design-brief.md` | UI-15, UI-20 | optional |

No file changes `docs/openapi.yaml` unless you choose option B in UI-15 or the API contract alternative in UI-18.

**(c) Real defects found next to these findings that the review does not report**
- **Recent changes shows raw attribute ids.** `ui/src/routes/configure/useCriteriaEditor.ts:111,148` write "Weight for country.rule_of_law: 30 to 35" and "Locked country.rule_of_law". This breaks the design rule that `CriteriaPanel.tsx:319-321` itself cites. `sanity.spec.ts:359` depends on it.
- **The scorer ignores a criterion's breakdown option (latent).** `backend/src/starnest/evaluation/ranking.py:303-326` keeps whichever active value of an attribute it meets last. It never reads `breakdown_option` or `reducer_mode` (`criteria/criterion.py:177,315-322`), while `data/active_value.py:76-80` leaves that choice to "a criterion's choice, made later". No breakdown option is seeded at the country level, so nothing is wrong today; city rents by bedroom count would hit it.
- **The sanity cap test races its own reload.** `sanity.spec.ts:133-136` reloads without waiting for the save. This is folded into UI-03.
- **Pillar ids appear in prose (minor).** `pillarCompleteness.ts:65` and `CandidateDetail.tsx:275` print the pillar id ("in economics") where the catalog name is "Economy".
