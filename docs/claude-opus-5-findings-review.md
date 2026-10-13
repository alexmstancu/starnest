# Claude Opus 5 findings verification

**Baseline:** `7182d376ebb1d59cfff984b9f3d2a646303d23c3` (`docs: draft the v2.0 (city level) development plan`)
**Date:** 2026-10-12
**Source under review:** `docs/copilot-review.md` (untracked, unmodified)
**Reviewer:** independent staff-level implementation-verification pass, Claude Opus 5, maximum reasoning effort.

## Method and scope

Each of the 91 findings was adjudicated on its own: read the claim, resolve the authoritative
requirement or deliberate exception in `docs/reqs.md`, `docs/arch.md`, `docs/devplan.md`,
`docs/openapi.yaml`, `docs/known-issues.md` and the Appendix B decision log, then trace the
**actual current implementation** — callers, callees, guards, stored state, SQL constraints,
transaction boundaries and the relevant tests — and attempt to **falsify** the claim rather than
confirm its cited lines. The source report was treated as a hypothesis, never as evidence: several
of its line citations and secondary characterisations were checked and are noted where they are
loose.

**Strictly static.** No test, build, lint, typecheck, generator, migration, backup, container,
service, database connection, publisher request or paid API call was executed. No application
code, test, configuration, data file or pre-existing document was modified. Dependency sources
inside the repository were read only. `docs/gpt-6-astra-findings-review.md` was neither read nor
consulted, and no other reviewer was contacted.

**Consequences of the no-execution rule.** Nothing below asserts that any test passes or fails;
where a test is cited, only what it *asserts in source* is stated. Nothing below asserts the
contents of the live database. Where a conclusion depends on an unobserved runtime fact
(browser event ordering, provider payload shapes, live catalog drift), that dependency is named
explicitly in the finding's limitations.

**Verdict vocabulary.** `REAL` — the substantive reported behaviour exists under its stated
supported conditions and the causal chain holds, with no guard, later migration or recorded
decision disproving it. `UNREAL` — counterevidence disproves the substantive claim or its impact.
`UNCERTAIN` — static evidence cannot establish an essential premise, or the finding is materially
mixed. Original severities are preserved verbatim from `copilot-review.md`; any disagreement is
stated in prose and never applied to the severity cell.

## Verdict summary

| finding_id | severity | verdict |
|---|---|---|
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
| BE-11 | Medium | REAL |
| BE-12 | High | REAL |
| BE-13 | Medium | REAL |
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
| BE-36 | Medium | REAL |
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

**Totals: REAL 91, UNREAL 0, UNCERTAIN 0** (91 rows, 91 unique IDs; `BE-35` is deliberately absent,
folded into ST-18 by the source report).

---

## Detailed adjudication

### UI-01 - nginx times out synchronous paid gate research

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `reqs.md` 6.10 use 3 and Q218 make gate research a real, paid, country-level
operation; `reqs.md` 6.3 requires the cost of a paid pass to be reported.

**Code.** `ui/nginx.conf:13-28` applies `proxy_connect_timeout 10s; proxy_send_timeout 60s;
proxy_read_timeout 60s` to the whole of `location /v1/`, with an explicit rationale that "A data
acquisition run is started with one POST and then polled (arch.md 8.4), so no request is
long-lived." `backend/src/starnest/api/rules.py:269-325` (`research_match_rules`) is **not** of
that shape: it `await`s `research_gates(...)` inline and returns proposals, `cost_eur`, `calls`
and `halted_on_spend_cap` in the response body.
`backend/src/starnest/data_acquisition/research.py:100-180` loops `gates_to_ask(...)` — one LLM
call per (gate, candidate) pair — awaiting `researcher.research(...)` each time.
`ui/src/routes/configure/proposals/useProposals.ts:82-91` calls `researchMatchRules` once and
waits for the whole result.

**Proof.** With `n` unconfirmed (gate, candidate) pairs and a web-searching model answering in
`t` seconds, total latency is `n·t` with **no response bytes emitted until the end** (FastAPI
serialises the single `ResearchOutcomeBody` after the loop). `proxy_read_timeout` measures the
interval between successive reads from the upstream, so a single quiet interval above 60 s yields
504 to the browser. The shipped country catalog has 5 gates (`reqs.md` 7.3) and 32 candidates;
even a single gate across 32 countries at >60 s for one call trips it. The lost payload is exactly
`cost_eur`, `calls` and `halted_on_spend_cap` — the paid-operation report `reqs.md` 6.3 requires.

**Reachability.** Production reachable whenever the containerised interface is used
(`compose.yaml` serves `ui` behind this nginx) and the LLM path is configured. Not reachable in
Vitest (msw resolves immediately) or in `npm run dev` (Vite proxies without this timeout), which
is why no existing test covers it.

**Secondary claim — no exclusivity/disconnect check.** Confirmed: `research_match_rules` has no
equivalent of `runs.run_in_flight()` (contrast `api/runs.py:243-248`), and nothing inspects client
disconnection; `research_gates` would continue to completion on the server after a 504.

**Limitations.** Actual per-call latency and whether Anthropic + nginx would in practice exceed
60 s on a given gate is a runtime measurement not performed. Whether uvicorn cancels the task on
client disconnect was not observed.

### UI-02 - whole-bucket retry starts without an estimate or confirmation

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `reqs.md` 6.3: "Before a run, display the **planned call count and an estimated
cost**, and require confirmation." Q220 adds that an uncapped run must be accepted *in the
request*.

**Code.** `ui/src/routes/run/RunScreen.tsx:144-153` (`Retry N failed`) and `:184-193`
(`Retry N unanswered`) both call `run.again(...)` directly in `onClick`.
`ui/src/routes/run/useRunScreen.ts:232-235`: `again: (items) => void act(..., async () => { if
(current) await watch(await retryRun(current.id, items)); })` — no `planRun`, no `setArmed`, no
`describeCommitment`. Contrast `propose`/`commit` (`:175-209`), the path the per-item cards use,
which plans, reads the cap, and arms an `ArmedRun`.
`ui/src/api/endpoints.ts:249-261`: `retryRun` posts `{ items }` only — `accept_uncapped_spend` is
never sent, so the backend's `RetryBody.accept_uncapped_spend` defaults to `False`
(`backend/src/starnest/api/runs.py:126-137`).

**Proof.** Click → `POST /data-acquisition-runs/{id}/retry` → `retry_run`/`ask_again` →
`execute_run` → `open_run`, which calls `refuse_unless_capped(costs_money=any(adapter.costs_money
…), cap_eur=cap, uncapped_is_accepted=False)`. Two outcomes, both wrong against 6.3: (a) a cap is
set, so the retry **starts spending** with nothing shown first; (b) no cap is set, so it is
refused with `spend_cap_not_set` and the wrapper has no way to convey acceptance.

**Reachability.** Production reachable on every run that has failures or unanswered items.

**Tests.** `RunScreen.test.tsx` asserts the immediate request shape; no test asserts an estimate
precedes it, which is why the gap is invisible to the suite.

### UI-03 - browser tests overwrite household-owned gate answers

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `reqs.md` Q152 makes `not_manually_excluded` the mechanism for a hand-excluded
country; `reqs.md` 3.7 requires the answer's reason, dates, citations and override to be audited.

**Code.** `ui/e2e/gate-c.spec.ts:31` `SCORING_SET = "e2e_gate_c"`; `:63-64`
`THE_EXCLUDED_ONE = {id: "country.greece"}`, `THE_GATE = "not_manually_excluded"`. `:155-163`
`beforeEach` → `answerTheGate(request, "not_matching", "Gate C: recorded by the browser suite")`;
`afterEach` → `answerTheGate(request, "matching", null)`. `:483-493` `answerTheGate` issues
`PUT /v1/match-rule-results/not_manually_excluded/country.greece` with `{match_result, reason}`.
`backend/src/starnest/api/rules.py:61-68` defaults `data_source` to `manual`, so the PUT succeeds;
`:355-373` constructs a whole `MatchRuleResult` and `results.record(...)` it — one row per
(rule, candidate), so this is a replacement, not an addition.

**Proof.** The gate answer lives in `match_rule_result`, keyed by rule and candidate only — it is
*not* scoped to a criteria set, so duplicating `local_employment` into `e2e_gate_c` isolates the
*enforcement* flag (`criteria_set_match_rule`) and nothing else. If a user has excluded Greece by
hand with a reason, citations and an override, the `beforeEach` overwrites it and the `afterEach`
writes `matching` with `reason=null`, `citations=()`, `override_reason=None`. The prior state is
never read, so it cannot be restored. `ui/playwright.config.ts:39-66` runs the real backend
(`uv run python -c "from starnest.main import run; run()"`) against the developer's real database —
its own comment says "the database must already be up (`make up`) and migrated".

**Sanity sub-claim.** `ui/e2e/sanity.spec.ts:124-144` reads the spend cap, writes a different one,
reloads, asserts, and only then restores `before`. The restore is in the test body, not in an
`afterEach`/fixture, so any failure between leaves the household's cap changed.

**Limitations.** Whether the live database currently holds a user-authored Greece exclusion is a
data question not inspected. The mechanism, not a present loss, is what is verified.

### UI-04 - asynchronous completions can overwrite the current selection

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High for the first two
sub-claims, Medium for the third

**Code.** `ui/src/routes/configure/useCriteriaEditor.ts:100-128` (`setWeight`), `:140-161`
(`setLock`), `:175-185` (`setRule`). Each closes over `criteriaSetId` at call time and, on
resolution, does `setCriteria((current) => applyRebalance(current, response.criteria))`.
`applyRebalance` (`:200-210`) matches **by attribute only**. The separate effect at `:80-84`
replaces `criteria` whenever `resource.data` changes (i.e. after a set switch).

**Proof (sub-claim 1 — cross-set merge).** t0: user on set A issues PATCH for `country.rule_of_law`.
t1: user switches to set B; `useResource` refetches and the effect sets `criteria` to B's rows.
t2: A's response resolves; nothing compares `criteriaSetId` then with `criteriaSetId` now, so A's
rebalanced pillar rows are substituted into B's displayed list wherever the attribute matches.
The screen then shows B's identity with A's numbers.

**Proof (sub-claim 2 — out-of-order rebalance).** Two `updateCriterionWeight` calls in flight for
the same pillar; whichever resolves last wins `setCriteria`, which need not be the last issued.
There is no request generation counter anywhere in this hook.

**Proof (sub-claim 3 — run opening).** `useRunScreen.ts:133-157`: an effect fires once when the
history resource first becomes ready and calls `void watch(newest)`. A user click on a history row
(`open`, `:237`) also calls `watch`. Both end in `setCurrent(await fetchRun(...))` with no
ordering guard, so a slow automatic read can land after a deliberate one. The window is narrow
(the automatic read is issued at the same render in which the history list first becomes
clickable), which is why this sub-claim carries lower confidence than the other two.

**Tests.** `useResource.test.ts` has an explicit out-of-order guard test for GETs; no equivalent
exists for these mutation/open paths. `ST-02` is correctly identified as the separate persisted
lost-update problem.

### UI-05 - a pillar-slider release can submit multiple commits

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** Medium-High

**Code.** `ui/src/routes/configure/pillars/PillarWeightsPanel.tsx:310-329` binds
`onPointerUp={release}`, `onMouseUp={release}`, `onKeyUp={release}` and `onBlur={release}` to the
same `<input type="range">`. `release` → `commit(event.currentTarget.value)` (`:245-267`), which
sends unless `moved === weight.weight`, where `weight` is the **prop** carrying the server's
current weight. `move` (`:64-80`) is async and only replaces `weights` when the response lands.

**Proof.** A mouse release on a pointer-events-capable browser fires `pointerup` and then the
compatibility `mouseup` (W3C Pointer Events, §"Compatibility mapping with mouse events"), unless
`preventDefault()` was called on `pointerdown` — it is not. With stored weight 20 and a drag to 35:
`pointerup` → `35 !== 20` → `updatePillarWeight(..., 35)`; microseconds later `mouseup` → prop is
still 20 → a **second** whole-level rebalance PATCH for 35. Each PATCH is a full read-modify-write
of the criteria set server-side (`api/criteria.py:496-545` → `replace_criteria_set`), so the two
interleave with each other and with ST-02.

**Tests.** `PillarWeightsPanel.test.tsx` dispatches `pointerUp` only; jsdom does not synthesise
the compatibility mouse event, so the duplicate cannot appear there.

**Limitations.** The duplicate depends on real browser event synthesis, which was not executed.
The same four-handler pattern exists on the criterion slider
(`CriteriaPanel.tsx:356-359`), so the same reasoning applies there.

### UI-06 - save completion discards edits entered while saving

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.**
- `ui/src/routes/configure/household/useHouseholdForm.ts:37-48`:
  `setDraft(draftOf(await replaceHousehold(householdFrom(draft))))` — the response replaces the
  *current* draft. `save` has no in-flight flag and `HouseholdPanel.tsx` does not disable fields.
- `ui/src/routes/configure/settings/useSettingsForm.ts:30-46`: identical shape.
- `ui/src/routes/run/useManualEntry.ts:58-69`: on success `setDraft(NOTHING_TYPED)`.
  `ManualEntryPanel.tsx` disables only the submit button (`:182`), never the inputs.
- `ui/src/routes/configure/criteria/useCriterionRule.ts:59-66`: on the `saving → not saving`
  transition it unconditionally does `setDraft(JSON.parse(asJson))`, reverting to the stored rule.

**Proof.** t0 submit with draft D1; t1 user edits a field → draft D2 (inputs are live); t2 response
for D1 arrives → `setDraft(server(D1))` / `NOTHING_TYPED` / `stored` — D2 is gone with no notice.
The household/settings forms additionally allow a second submit at t1, so two whole-record PUTs
race and the later response wins regardless of issue order.

**Tests.** The suites submit and then assert; none types a new value while a request is held, so
the overwrite is unobservable to them.

### UI-07 - source reorders allow concurrent operations and stale partial-failure state

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `ui/src/routes/configure/sources/DataSourcesPanel.tsx:66`
`const busy = sources.saving === source.id;` — used at `:126` (the enable switch), `:149` and
`:161` (the arrows). `anySaving` (`:33-34`) is passed **only** to `useSourceDrag`.
`ui/src/routes/configure/sources/useDataSources.ts:24-45`: `change` sets `saving` to one id,
`await updateDataSource(id, patch)`, then loops `alsoChange` sequentially, then `reload()`; the
`catch` records the failure and **does not** reload.

**Proof (concurrency).** Row A is saving ⇒ `saving === "A"`. Row B's arrows and switch have
`busy === false`, so a second `change` can start. Its `alsoChange` list was computed by
`sources.moveTo(...)` from `sources`, which is still the pre-A order (the reload has not landed),
so the second sequence writes priorities derived from stale positions and interleaves with A's.

**Proof (partial persistence).** `change` issues N PATCHes in order. If PATCH k (k>1) rejects, the
first k−1 are already committed server-side; the catch block sets `failure` and skips `reload()`,
so the rendered order is the pre-change one while storage holds a partially applied order. The
screen then misreports which source wins — the exact thing `reqs.md` 6.6 is about.

**Tests.** `useSourceDrag.test.ts` covers drag concurrency and first-PATCH failure; neither covers
other rows' controls nor a mid-sequence failure.

### UI-08 - undo history omits criteria-set identity

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `ui/src/routes/configure/useCriteriaEditor.ts:105-123` records
`target: \`criterion:${attribute}\`` and a `reverse` closure bound to the *then-current*
`criteriaSetId`; `:145-157` records `target: \`lock:${attribute}\``, likewise.
`ui/src/routes/configure/changeHistory.ts:52-62`: `record` collapses when
`latest?.target === change.target`, producing `{...change, before: latest.before}` — the **new**
entry's `reverse` with the **old** entry's `before`.

**Proof.** Edit `country.rule_of_law` in set A from 30 → 55 (entry: before=30, reverse→A). Switch
to set B. Edit `country.rule_of_law` in B from 12 → 40. Targets are identical
(`criterion:country.rule_of_law`) and the A entry is still `history[0]`, so the entries collapse
to `{before: 30, after: 40, reverse: →B}`. Undo issues `updateCriterionWeight(B,
country.rule_of_law, 30)` — A's original value written into B, restoring neither change. The row
also displays A's "30 to 40" as if it described B.

**Tests.** The history tests operate within one set, so the collapse-across-sets case is
unexercised.

### UI-09 - scalar weight reversal is not always a true undo

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `changeHistory.ts` header: "Undo re-issues the real request; it never restores local
state"; `describeReach` labels the button "Undo this".

**Code.** `useCriteriaEditor.ts:98-123` stores only the scalar `was` and reverses with
`updateCriterionWeight(criteriaSetId, attribute, before)`.
`backend/src/starnest/criteria/rebalancing.py:62-76` redistributes proportionally and, where every
absorber holds 0, splits the remainder **evenly**:
`share = item.weight / absorbed if absorbed > 0 else Decimal(1) / Decimal(len(absorbers))`.

**Numeric proof.** Pillar `[A=50, B=20, C=30]`. Move A→100: `absorbed = 50`, `available = 100 − 100
− 0 = 0`, so B=0·(20/50)=0 and C=0·(30/50)=0 ⇒ `[100, 0, 0]`. Undo A→50: now `absorbed = 0`, so
each absorber takes `1/2`; `available = 100 − 50 = 50` ⇒ B=25, C=25 ⇒ `[50, 25, 25]` ≠
`[50, 20, 30]`. The sibling proportions were destroyed by the forward move and are nowhere
recorded, so no "undo" over a scalar can restore them.

**Tests.** The undo tests assert the reverse *request*, not vector equality, so they cannot see it.

### UI-10 - invalid numeric settings silently serialize as null

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `ui/src/routes/configure/numericInput.ts:20-34`: for a non-`whole` field the first `.`
or `,` is kept (normalised to `.`), so the single string `"."` survives the filter intact.
`ui/src/routes/configure/settings/settingsForm.ts:140-155`: `asNumber(typed)` returns
`typed.trim() === "" ? null : Number(typed)`; `Number(".")` is `NaN`.
`ui/src/api/client.ts:337-353` (`putJson`) serialises with `JSON.stringify`, which emits `null` for
`NaN`/`±Infinity`. `backend/src/starnest/api/settings.py:55-73` is a whole-record replace: a null
is stored as "not decided".

**Proof.** `min_coverage` currently 60. User selects the field, types `.`, presses Save.
`isBlocked` (`settingsForm.ts:118-120`) only inspects *blank* fields, so it does not object.
Body becomes `{"min_coverage": null, …}` → 200 → the coverage floor is now unset, and
`rank_candidates(min_coverage=None)` stops applying the floor entirely
(`evaluation/ranking.py:610-615`). `run_spend_cap_eur` is reachable the same way, clearing the
spend ceiling. The whole-field-set behaviour makes this worse: the other four values are rewritten
from their drafts in the same request.

**Tests.** `settingsForm.test.ts` covers blank and well-formed numbers; no non-finite, non-blank
input is exercised.

### UI-11 - persistent sidebar facts are not invalidated after writes

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 8.1 requires the always-visible sidebar to carry the household context,
the candidate counts (total/matching/not matching/insufficient data) and the last-run summary.

**Code.** `ui/src/shell/useShellSummary.ts:26-55` builds two `useResource`s (counts = candidates +
ranking; last run = `fetchRuns(1)`) and exposes `reload`. Grepping the shell shows `summary.reload`
is wired **only** to the two `ErrorNotice` retry buttons (`Sidebar.tsx:278`, `:314`).
`Sidebar.tsx:180-183` gives `HouseholdCard` its *own* `useResource(fetchHousehold)` with no
external reload at all. Neither `useHouseholdForm` (`:43-48`), nor `useCriteriaEditor`, nor
`useRunScreen` (`:117-128`) notifies anything outside its own screen.

**Proof.** Save a new home country ⇒ `HouseholdPanel` shows it; the sidebar card still shows the
old one until a full remount. Change a weight or exclude a criterion ⇒ Rank recomputes; the
sidebar's matching/not-matching tallies are stale. Complete an acquisition ⇒ Acquire's report
updates on Refresh; the sidebar's "last run" is still the previous one. Two surfaces on screen at
once then disagree about the same fact.

**Tests.** Sidebar tests verify the initial read and the selection-triggered refetch only.

### UI-12 - rule-effect explanations make false eligibility claims

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` Q218 and 6.10 use 3: a researched answer "is stored, displayed with its
sources and **rules nothing out**" until a human writes it. `evaluation/rules.py:150-180`
implements exactly that (`and not answer.is_proposal`).

**Code (claim 1).** `ui/src/routes/configure/rules/ruleEffect.ts:30-47` filters
`result.match_rule === ruleId` and `result.match_result === REMOVES`; `is_proposal` is never
consulted. `RulesPanel.tsx:87-89` feeds it `rules.matchRuleResults`, which is the unfiltered
`listMatchRuleResults` payload (`useProposals`/`useRuleToggles` read the same endpoint, and the
backend serialises `is_proposal` at `api/rules.py:395`).

**Proof.** One unconfirmed LLM proposal of `not_matching` for Greece ⇒ the panel reads "Removes
Greece." while the ranking leaves Greece matching. The screen claims an exclusion the engine does
not make — the precise failure Q218 exists to prevent.

**Code (claim 2).** `RulesPanel.tsx:104-115` emits `effect: null` for **every** compound rule;
`:182-189` renders `row.effect ?? "Applies to no candidate right now."`.

**Proof.** `mild_now_brutal_later` is applied on `local_employment` (`0496`) and, per the project
record, warns for Bulgaria, Hungary, Romania and Croatia. The panel nevertheless prints "Applies
to no candidate right now" — a false negative stated as fact rather than an absence of
information.

**Tests.** No test reconciles the sentence with the proposals list or with server-produced
warnings.

### UI-13 - proposal confirmation drops its reference period

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Authority.** `docs/openapi.yaml:1484-1501` gives `MatchRuleResultInput` a `reference_period`;
`reqs.md` 3.7 defines it as "What period the judgement holds for. A Swiss quota is annual".
`known-issues.md:420` records this as **P58, open, low, latent**.

**Code.** `ui/src/routes/configure/proposals/useProposals.ts:95-103` sends exactly
`{match_result, reason, citations, data_source:"manual"}`.
`ProposalsPanel.tsx:170-177` renders the rule, candidate, answer, reason and citations — no period.
`backend/src/starnest/api/rules.py:358-368` sets `reference_period=None` when the body omits it,
so confirming a periodised proposal would *erase* the period on the replacing row.

**Latency of the trigger.** `data_acquisition/research.py:139-150` constructs the proposal without
`reference_period`, and `Researched` (`:60-66`) carries no period field — so today nothing has a
period to lose. The report labels this correctly ("latent while research supplies no periods").

### UI-14 - research discards actual spend and cap-halt outcome

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 6.3 (cost control is reported, and a cap halts "retaining everything
completed so far"); Q220.

**Code.** `ui/src/api/endpoints.ts:566-576` types the response as `{proposals, refusals?, cost_eur,
calls, halted_on_spend_cap}`. `useProposals.ts:82-91` keeps **only**
`setRefusals(outcome.refusals ?? [])` and then `reload()`. Grep of
`ProposalsPanel.tsx` finds `cost`/`calls` only in the *estimate* block (`:72-83`); `halted` appears
nowhere.

**Proof.** A pass that halts on the cap after 9 of 160 gates returns `halted_on_spend_cap: true`
and a real `cost_eur`; the panel renders the newly reloaded proposals beside the stale
**estimate** ("160 calls, about €X") and says nothing about the halt. A reader cannot distinguish
"finished" from "stopped early having spent money".

**Scope.** Correctly separated from BE-34 (the absent durable ledger): the data exists in the
response and is discarded by the client.

### UI-15 - alternative values display the active figure's contribution

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 3.0 (Attribute vs Value vs Criterion), 8.4 ("showing **all** stored source
values rather than only the active one", with full provenance).

**Code.** `ui/src/routes/rank/CandidateDetail.tsx:308` iterates `foldRepeats(values)` — every
stored value, active or not — and at `:372-405` reads
`contributions.get(value.attribute)?.score / .weightUsed / .pointsAdded`.
`ui/src/routes/rank/attributeScores.ts:35-55` keys the map by **attribute**, from the ranking's
per-attribute breakdown, which is computed from the single `used_value`
(`evaluation/ranking.py:498-512`). `pillarFilter.ts:60-78` keys `judgements` by attribute too.
`:398-408` renders `value.is_active ? "Scored"`.

**Proof.** Greece's `total_tax_rate_effective` has an OECD row (active, scored 62) and a
`eurostat_estimate` row (superseded) and possibly a rejected row. All three print "62",
the same "Weight used" and the same "Contribution": the superseded and rejected measurements are
shown as though the arithmetic had been performed on them. Separately, `is_active` is the
active-value-rule winner, which is true for a value of a **descriptive** attribute (no criterion at
all — `reqs.md` 3.0) and for an attribute whose criterion is excluded (`is_scored=false`); both are
labelled "Scored" although `_criteria_to_score` removed them from scoring entirely.

**Tests.** `AttributeDrillDown.test.tsx`/`RankScreen.test.tsx` inspect active rows' cells only.

### UI-16 - candidate provenance permanently stops at 500 values

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 3.6 (nothing is discarded; re-fetches are preserved) and 8.4 (the
drill-down shows **all** stored source values).

**Code.** `ui/src/api/endpoints.ts:287-296`: `getJson("/values", {candidate, include_superseded:
true, limit: 500})`. `CandidateDetail.tsx:74-78` consumes `values.resource.data.items` and never
reads `total`; `:168-172` heads the table "Every stored value".

**Proof.** `value`'s natural key includes `retrieval_date`
(`storage/migrations/0005-values.sql:38-50`), so every live re-fetch of an existing figure appends
a row. With ~43 country attributes and repeated runs, a candidate crosses 500 rows in the ordinary
course of use; the 501st onward are silently absent under a heading that claims completeness.
`foldRepeats` runs *after* truncation, so folding cannot recover them.

**Tests.** Pagination is tested for run-value reads, not for `fetchValues`.

### UI-17 - ten runs are presented as complete history and monthly spending

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `ui/src/routes/run/useRunScreen.ts:113-115`: `fetchRuns(10, {signal})`; the result feeds
both `RunHistory` and `AcquisitionDiffPanel`. `RunScreen.tsx:243` heads the list "Every acquisition
so far". `ui/src/routes/run/databaseHolds.ts:57-66` (`spentThisMonth`) reduces **the same ten
rows**, filtering on `started_at >= first of month`.

**Proof.** With 14 runs this month, the four oldest are outside the page, so "Spent this month"
omits their `cost_eur` even when the backend recorded them perfectly. `listRuns` accepts
`limit ≤ 1000` and returns `total` (`api/runs.py:398-414`), so the data exists and is not asked
for. Older runs are also unopenable and undiffable from this screen.

**Scope.** Correctly separated from BE-33/BE-34, which concern durability of the figures
themselves.

### UI-18 - configurable scores are clamped or interpreted as 0-100

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 5.1 "Score scale: 0–100, **configurable**"; `reqs.md` 3.10 and
`household/settings.py:52-55` make `score_scale_max` a user row with `gt=0` and no upper bound;
Q193 freezes a saved evaluation's scale, and `openapi.yaml:1786-1795` makes
`SavedEvaluation.score_scale_max` required.

**Code.** `ui/src/routes/rank/rankTable.ts:29` `const PERCENT_SCALE = 100;` → `:95-103`
`clampPercentage` → `:206-228` `pillarBars` uses the clamped value for both the drawn bar and the
printed `label`/`title`. `CandidateDetail.tsx:290-292` hardcodes the column header "Score 0–100";
`:480-485` sets `width={\`${pillar.score}%\`}` inside a `viewBox="0 0 100 4"`.
`ComparisonMatrix.tsx:251-256` labels score rows "normalised 0–100".
`SavedRankingView.tsx:35-45` states the frozen range in prose and passes `resource.data` straight
to `RankingTable` without threading `score_scale_max`.

**Proof.** Set `score_scale_max = 150`. A pillar scoring 128 is printed as "100" and its bar is
drawn at full height; a pillar at 150 and one at 101 become indistinguishable. This is a changed
**number**, not styling. With `score_scale_max = 50` the geometry under-uses the track and the
"0–100" captions are simply false. For a saved evaluation the frozen scale is available in the
payload and is not used.

### UI-19 - raw comparison mode reverses ahead/behind semantics

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `docs/openapi.yaml:1864`: `delta` is "Focus minus comparator, in the attribute's own
unit." `reqs.md` 8.5 asks for "signed delta" plus weighted contribution.

**Code.** `ui/src/routes/compare/attributeRows.ts:88-94`
`scoreDeltaOf(score, focusScore) = score − focusScore` (**comparator minus focus**); `:119-120`
`rawDelta: found?.rawDelta ?? null` taken verbatim from the server's `delta` (**focus minus
comparator**) via `ComparisonMatrix.tsx:72-77`. `ComparisonMatrix.tsx:267-280` picks one or the
other by `shownAs` and hands it to `divergingBar`, whose `:99-104` reads
`const direction = delta > 0 ? "ahead" : "behind";`.

**Numeric proof.** Maximise attribute; focus 90, comparator 70. Server `delta = 90 − 70 = +20`.
Raw mode: `divergingBar(+20)` ⇒ `direction = "ahead"`, bar drawn to the right in the
**comparator's** cell, text "+20" — i.e. the comparator is presented as ahead while it is in fact
20 units behind. Score mode for the same pair gives `cell.score − focusScore < 0` ⇒ "behind".
The two modes contradict each other on the same data. For `target_range` the raw sign cannot even
in principle express desirability, since both directions away from the band are worse.

**Tests.** `attributeRows.test.ts`/`divergingBar.test.ts` use minimise-flavoured examples where the
sign happens to read correctly.

### UI-20 - external scores omit both provenance dates

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 8.4: external scores display "the provider, the number, its scale, **both
dates**, and a link to the methodology". `reqs.md` 10 makes the two-date rule exceptionless.

**Code.** `ui/src/routes/rank/CandidateDetail.tsx:558-596`: the table declares exactly four
columns — Publisher, Published, Scale, Caveats — and the body renders `published_value`, an
optional `(rank N)`, `published_scale` and `caveats`. `reference_period` and `retrieval_date`
appear only inside the React `key` at `:577-582`. `published_rank_of` (the denominator) is also
never rendered, although `storage/queries/values.sql:339-356` selects it and
`api/values.py` serves it.

**Proof.** A Numbeo 2021 edition and a 2026 edition render identically apart from the number; the
reader cannot tell which is current or how old either is — the exact "edition age uninterpretable"
failure the two-date rule exists to prevent.

### UI-21 - repeat folding hides distinct quotes and citations

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 3.6 and 8.4 require full provenance per stored value; 6.10 requires LLM
values to show "the pages the model actually read".

**Code.** `ui/src/routes/rank/repeatedValues.ts:38-48` (`fingerprintOf`) hashes attribute,
candidate, data_source, breakdown_option, reference_period, payload, rejection_reason and
confidence_level — **not** `quote` and **not** `citations`. `:68-76` keeps only the newest member of
each group; `CandidateDetail.tsx:308,335-368` renders `value.citations` and `value.quote` of that
single survivor.

**Proof.** Two LLM fallback answers for the same country/attribute/period produce the same payload
but cite different pages (`fallback.py:279-285` attaches `answered.citations`). They fold into one
row showing only the newest set of pages; the other reading's evidence disappears from the one
screen designed to show it. The header still reads "Fetched again N times", implying the copies are
identical.

**Tests.** `repeatedValues.test.ts` varies payload, period and grade — never citations or quote.

### UI-22 - acquisition diff classifies rounded text instead of measurements

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `ui/src/routes/run/acquisitionDiff.ts:90-99` compares `figureOf(earlier)` with
`figureOf(later)` via `isUnchanged` (`:142-150`), where `figureOf` (`:152-157`) returns
`describeFigure({payload})`. `ui/src/format/figure.ts:55-62` (`readableNumber`) does
`Number(value.toFixed(2))`.

**Proof.** `1.071 → "1.07"` and `1.074 → "1.07"`, so `isUnchanged` is true and the row is
classified "unchanged" although the stored magnitudes differ by 0.003 — a difference that is in the
`value` table and can move a `percentile` ranking. The module's own comment states the trade
("Compared as the string a reader sees"), so the report's "explicit implementation choice" note is
fair; what makes it a finding is that the screen asserts factual equality on the basis of
presentation. No recorded decision in `reqs.md`, `arch.md` or Appendix B approves rounding as the
equality test, so this is not an approved exception.

**Severity note.** I agree with Low: the diff is informational and both figures remain stored.

### UI-23 - browser gates target obsolete labels and comparison markup

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code (labels).** Production: `ui/src/routes/configure/criteria/CriteriaPanel.tsx:326`
`const title = titleOf(criterion.attribute, attribute);` and `:353`
`aria-label={\`Weight for ${title}\`}`. `criterionReading.ts:52-60` (`titleOf`) returns the
catalog's display name, and when that is empty falls back to
`attributeName(NO_NAMES, attributeId)`; `format/display.ts:178-186` strips the level prefix and
runs `formatIdentifier`, i.e. "rule_of_law" → "Rule of law". **The raw id is never the accessible
name.** Tests: `e2e/gate-c.spec.ts:391-392,442-454`, `e2e/minimum-end-to-end.spec.ts:181-182,
238-239,251-252` and `e2e/sanity.spec.ts:348-349,371-372` all locate
`getByRole("slider", {name: \`Weight for ${attribute}\`})` with `attribute` an identifier
(`"country.rule_of_law"`, etc.). Playwright's `name` option is a case-insensitive **substring**
match by default; "Weight for country.rule_of_law" is not a substring of "Weight for Rule of law".
`0101-catalog-pillars-and-attributes.sql:67` gives `country.rule_of_law` the name "Rule of law", so
the fallback branch is not taken either.

**Code (comparison markup).** `e2e/gate-c.spec.ts:327-329` does
`page.getByRole("table").filter({hasText: "Attribute"})` and then asserts column headers. The live
matrix (`ui/src/routes/compare/ComparisonMatrix.tsx:89-104`) is `aria-label="Every pillar, focus
against comparators"` with the single leading header `<th scope="col">Pillar</th>`; a grep of
`src/routes/compare/*.tsx` finds the string "Attribute" only in identifiers, never in rendered
text. Unexpanded, the matrix has no attribute rows at all.

**Proof.** Both selectors resolve to nothing against current markup, so the helpers throw ("no
pillar on screen holds …") or the assertion times out. This is a static disagreement between the
suite and the product; it does not by itself establish a product defect.

**Limitations.** No test was run. If a future catalog named an attribute with its own id, the
first selector would match again. Note that the adjacent history assertion
(`sanity.spec.ts:360`, `hasText: "country.rule_of_law"`) *is* consistent with production, because
`useCriteriaEditor.ts:107` writes the raw id into the history label.

### UI-24 - Acquire does not poll its displayed live progress

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 8.3 lists "**Live progress**, per candidate and per criterion" on the
Acquire tab; `reqs.md` Appendix B **Q161**: "Data acquisition progress is **polled** from the run
resource, not streamed."

**Code.** `ui/src/routes/run/useRunScreen.ts:219-222` — `refresh` re-reads only when invoked;
`:133-157` is a one-shot opening effect guarded by `opened.current`; there is no `setInterval` or
`setTimeout` anywhere in the hook. `RunScreen.tsx:482-485` states it outright: "nothing here
polls… A card that could not be re-read would show 'Acquiring now' for ever", and `:547-555` is the
manual Refresh button. The only poller is `ui/src/shell/useAcquiring.ts` (2 s), consumed solely by
`ui/src/shell/AcquiringBar.tsx:22-25`, which returns `null` when
`pathname === ACQUIRE.path` — i.e. it is hidden precisely on the screen in question, and it never
feeds `RunScreen`'s state.

**Proof.** Start a run from Acquire and stay there: `items_completed`, `by_source`, the status pill
and `stop_requested_at` remain frozen at their 202-time values until the reader presses Refresh.
After pressing Stop, the card can read "stopping" indefinitely.

**Exception search.** `devplan.md` 8 lists what is deferred; polled progress is not among it, and
`known-issues.md` records no accepted deviation. The in-code comment is an author's rationale, not
an approved scope exception.

### UI-25 - clearing comparison focus enables a silent no-op

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `ui/src/routes/compare/CompareScreen.tsx:286-294`: the focus `<select>` has
`<option value="">Choose a candidate…</option>` and `onChange={(e) => onFocus(e.target.value)}`, so
re-selecting the placeholder sets focus to `""`, not `null`. `:251-258`:
`disabled={focus === null || comparators.length === 0}` — `"" === null` is false, so the button
stays enabled. `:147-158`: `onCompare={() => focus && setAsked({focus, comparators: kept})}` —
`""` is falsy, so nothing is asked.

**Proof.** Choose Portugal + two comparators, compare, then reset the focus select to the
placeholder. The Compare button remains active, clicking does nothing, and the previous Portugal
result stays on screen under a form that no longer names Portugal.

**Tests.** The initial-`null` case is covered; clearing a chosen focus is not.

### UI-26 - keyboard focus inside the household picker closes its options

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `ui/src/routes/configure/household/CandidateField.tsx:96-101`: `onBlur` starts
`window.setTimeout(() => {setTyped(null); setOpen(false);}, 120)`. `:121-134`: each option is a
focusable `<button role="option">` whose **`onMouseDown`** clears the timer; there is no
`onFocus`-based cancellation and no composite-level `focusout`/`relatedTarget` check.

**Proof.** Tab from the input into the first option. `blur` fires on the input and arms the timer;
no mouse event occurs, so after 120 ms `setOpen(false)` unmounts the listbox and removes the
element that currently has focus — focus falls back to `<body>` and the typed filter is discarded.
A keyboard user cannot pause on an option. This is functional keyboard access, not styling.

**Tests.** `CandidateField.test.tsx` treats Tab as leaving the control entirely, so the
intermediate state is never exercised.

### UI-27 - roster failures become unexplained empty required pickers

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `ui/src/api/useCandidateNames.ts:77-86`: `useCandidateRoster` returns the shared constant
`NOBODY` (empty array) for **every** non-ready status, so `error` and `loading` are
indistinguishable and the error object is never surfaced.
`ui/src/routes/configure/household/HouseholdPanel.tsx:70-72` builds `countries`/`cities` from that
roster; the panel's only `ErrorNotice` (`:41-43`) belongs to the *household* resource, not the
roster. `ui/src/routes/run/ManualEntryPanel.tsx:35-42` fetches its own candidate list and `:75-88`
renders options only `when status === "ready"`; `:167` shows an `ErrorNotice` for
`entry.failure` (the write), never for the read.

**Proof.** `GET /candidates` fails (backend down, 500). Household: the three pickers render as
disabled/empty with a placeholder, every other field works, and nothing says why or offers a
retry — yet `home_country_candidate` and `citizenships` are required by the contract, so the form
cannot be completed. Manual entry: the Candidate select holds only "Choose one", and
`buildManualValue` will refuse on submit with a validation message that misattributes the cause.

### UI-28 - a successful empty set refresh retains a deleted selection

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** Medium-High

**Code.** `ui/src/shell/SelectionContext.tsx:85-97`: `if (available.length === 0) return;` — an
empty collection is treated as "a reload in flight", so neither `lastSeenCriteriaSets` nor the
selection is updated. `ui/src/routes/configure/sets/CriteriaSetsPanel.tsx:26`
`const only = criteriaSets.length === 1;` and `:128-140` disable Delete only when `only` is true;
`useCriteriaSets.ts:110` `discard` has no per-row in-flight disabling.
`backend/src/starnest/storage/criteria_store.py:130-142` permits deleting any set no saved
evaluation references.

**Proof.** With exactly two sets, both Delete buttons are enabled. Click both before the first
`reload()` lands: both DELETEs succeed, `GET /criteria-sets` then returns `items: []`, and the
effect's early return leaves `criteriaSetId` pointing at a deleted id. Every consumer
(`useCriteriaEditor`, `CandidateDetail`, the ranking) keeps requesting it and keeps receiving 404
`not_found`, with no path back because the selector has nothing to offer.

**Limitations.** Requires two deletes to overlap (two quick clicks, or a second tab). The two
states genuinely conflated — "loading" and "successfully empty" — are conflated unconditionally,
so the defect in the predicate is certain even where the trigger is narrow.

### UI-29 - manual gate entry and independent overrides have no UI workflow

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 2 (the user's day-to-day role includes matching thresholds and match
rules), 3.7 ("Overrides are permitted and audited… a visible marker"), 8.2 ("named match rules
**with their results, sources and overrides**"), **Q152** (excluding a candidate *is* answering
`not_manually_excluded`). `devplan.md` 8 does not defer any of this.

**Code.** A repository-wide grep shows `putMatchRuleResult` has exactly one caller in `ui/src`:
`useProposals.ts:95-103`, which re-sends the proposal's own `match_result`, `reason` and
`citations` unchanged. `ProposalsPanel.tsx:120-149,190-199` offers only "Confirm". `RulesPanel.tsx`
calls `rules.enforce`/`rules.apply` — `PUT /criteria-sets/{id}/match-rules/{rule}` — which writes
`criteria_set_match_rule.is_enforced`, a different table from the answer.

**Proof.** There is no screen on which a user can (a) exclude a country by hand, (b) answer a gate
`not_matching` when no proposal exists, (c) disagree with a proposal, (d) correct a confirmed
answer, or (e) record an `override_reason`. The backend serves all of it
(`api/rules.py:325-375`). Q152's stated mechanism for the headline "exclude this country" feature
is therefore unreachable from the interface.

**Note.** This is the same gap that forces the browser suite to drive the API directly (UI-03).

### UI-30 - external-score row keys omit reference-period end

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `ui/src/routes/rank/CandidateDetail.tsx:577-582` keys each row on
`[data_source, reference_period?.start ?? "", retrieval_date ?? ""]`. The entity's natural key in
`external_score` includes **both** period bounds (`0005`/`0007` follow `value`'s rule that "BOTH
reference dates are in the key"), and `storage/queries/values.sql:339-356` returns both.

**Proof.** A publisher issuing a January-anchored monthly edition (2026-01-01 → 2026-01-31) and an
annual edition (2026-01-01 → 2026-12-31), both ingested in one pass (identical `retrieval_date`),
produce two rows with byte-identical keys. React then reconciles siblings unreliably: on
re-render it may reuse the wrong row's DOM, showing one edition's number with the other's caveats.

**Scope.** Distinct from ST-10, which is about the *query* returning every edition; this is the
client-side identity of the rows it does return.

### UI-31 - unset comparator guidance promises unlimited comparisons

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `ui/src/routes/configure/settings/settingsForm.ts:74-80` declares
`consequence: "A comparison accepts as many comparators as you pick."` for `comparator_limit`;
`unsetFields`/`SettingsPanel` show the consequence exactly when the field is blank.
`backend/src/starnest/api/comparisons.py:97-109` does the opposite: with
`settings.comparator_limit is None` it raises `409 comparator_limit_not_set`.
`ui/src/routes/compare/CompareScreen.tsx:220-223` states the truth ("No comparator limit is
configured, so the server will refuse a comparison").

**Proof.** The two screens contradict each other about the same setting, and the one a user reads
while deciding whether to set it is the wrong one. `ui/e2e/sanity.spec.ts:290-294` asserts the
incorrect sentence, which is what keeps it in place.

### UI-32 - source-priority membership is mistaken for adapter capability

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 6.6 defines source priority as a **trust ordering** with a global default
beneath every override; `openapi.yaml:1128-1135` describes `effective_source_priority` as the
resolved consultation order, not a capability list. Which attributes a source can answer is the
adapter's own declaration (`data_acquisition/adapter.py:137-146`, `reqs.md` 6.7).

**Code.** `ui/src/routes/run/unsourced.ts:88-89`:
`.filter((a) => (a.effective_source_priority ?? []).length === 0)`.
`ui/src/routes/configure/criteria/criterionReading.ts:188-190` (`hasNoSource`) uses the same test.
`ui/src/routes/run/UnsourcedAttributes.tsx:108-117` renders the conclusion as fact: "Nobody would
be asked about these, so a run cannot fill them and retrying one changes nothing", and the empty
state claims "Every attribute at this level has at least one source that would be asked."

**Proof.** The inference is invalid in both directions even with a correct response: an attribute
with no override may still be answered by an adapter at its global rank (that is precisely what
6.6's partial-override rule guarantees), and an attribute **with** an override may have no adapter
registered (e.g. `country.remote_work_tax_treaty` lists `oecd` then `manual`). The current response
makes it worse — BE-39 shows only overrides are returned — but fixing BE-39 would not make the
inference sound, which is the report's own point.

### UI-33 - multiple adapters sharing a publisher produce duplicate plan-row keys

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `backend/src/starnest/api/runs.py:185-196` emits one `BySourceBody(data_source=…,
items=…)` **per adapter**. `backend/src/starnest/data_sources/published_tables/adapter.py:53-60`
returns `DataSourceId(self._table.data_source)` and declares exactly one attribute. The shipped
table headers declare: `oecd` three times (`child_benefit_policy.csv`, `oecd_parental_leave.csv`,
`pisa_school_quality.csv`) and `national_statistics` twice (`national_elevation_range.csv`,
`national_met_office_sunshine.csv`), in addition to the OECD API adapter registered in
`main.py`. `ui/src/routes/run/RunScreen.tsx:391-410` renders `sources.map(... <tr
key={source.data_source}>)` under the caption "Per source."

**Proof.** An unscoped country plan has `items = 1 attribute × 32 candidates = 32 > 0` for each
published-table adapter, so `by_source` contains up to four `oecd` entries and two
`national_statistics` entries. React receives duplicate sibling keys (a development-mode warning,
and unreliable reuse on re-render), and the reader sees "national_statistics — 32" twice with no
way to tell the two tables apart.

**Scope.** `RunDetail.by_source` is derived in SQL with a `GROUP BY data_source`
(`storage/queries/runs.sql`, `select_run_by_source`) and is correctly excluded by the report.

### BE-01 - criterion matching thresholds are never evaluated

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `reqs.md` 5.2 defines two mechanisms producing a non-match, the first being "A
`matching_threshold` on a criterion", with per-type semantics, and requires both to "feed a single
'why does this not match' surface". `arch.md:878-887`: "A candidate fails to match if an enforced
match rule says so, if a compound rule with outcome `not_matching` fires, **or if a criterion's
matching threshold is crossed by a value that exists**." `devplan.md` 8 does not defer it.

**Code.** A repository-wide grep for `matching_threshold` in `backend/src/starnest` returns six
sites: the field (`criteria/criterion.py:166`), its shape check against the value type
(`:336-337`), the `THE_SCORING_RULE` membership (`criteria/criteria_set.py:40`), storage write/read
(`storage/criteria_store.py:252,321`) and API (de)serialisation (`api/criteria.py:84,165,181-182,
349`). **`evaluation/` never imports or reads it.** `criteria/thresholds.py` defines four shapes
and exactly one behaviour — `refuse_unless_it_suits(value_type)` — with no "does this value satisfy
me" method on any of them. `evaluation/ranking.py:412-455` composes eligibility as
`refusals = gates_that_rule_out(enforced=…, answers=…) + ruled_out_by_a_rule`, with no third term.

**Proof.** A persisted `RangeThreshold(max_value=55)` on `country.total_tax_rate_effective` is
read back by `PostgresCriteriaStore`, serialised to the client, and then discarded: a candidate at
58% scores low and is still returned `MatchStatus.MATCHING`. The threshold is unreachable by any
code path that could change `match_status`, so the effect is not conditional on data.

**Tests.** `backend/tests/acceptance/test_endpoints.py:423-523` exercises setting, re-shaping and
clearing a threshold through `PATCH`, and `tests/storage/test_criteria_store.py:406` asserts the
round-trip. None asserts an eligibility outcome, which is precisely the untested half.

**Note on a stale comment.** `evaluation/ranking.py:12-18` claims thresholds, match rules and
compound rules are "deliberately not here"; the latter two are now implemented in the same file,
so the docstring is obsolete and cannot be read as an approved deferral.

### BE-02 - normalisation rounds before weighting and can reverse rankings

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `reqs.md` 5.1, verbatim: "**Rounding happens only at display.** All intermediate
arithmetic — normalising each value, applying weights, redistributing weight for missing data —
carries full precision. Rounding 41 criterion scores to integers before weighting would accumulate
error into the total and could reorder candidates separated by less than a point."
`arch.md:874` step 6: "**Total**, at full precision."

**Code.** `evaluation/normalisation.py:48-52` declares `scores_for(...) -> tuple[int, ...]`;
every branch quantizes — `:180-218` `_on_the_slope` / `_on_the_anchored_scale` return
`int(... .quantize(Decimal(1), ROUND_HALF_UP))`, `:328-343` `_by_standing` the same, `_already_a_score`
the same. `evaluation/ranking.py:329-364` stores those ints in `columns`, and `:517-531`
`_attribute_score` computes `contribution = Decimal(score) * weight / TOTAL` from the **int**.
`_result_for` then sums contributions and rounds once more.

**Numeric counterexample.** Two candidates, one pillar, two criteria weighted 90/10.
Precise normalised scores A = [49.49, 50.51], B = [49.51, 49.00].
Full precision: A = 49.49·0.9 + 50.51·0.1 = 44.541 + 5.051 = **49.592** → 50;
B = 49.51·0.9 + 49.00·0.1 = 44.559 + 4.900 = **49.459** → 49. Correct order A > B.
As implemented: A rounds to [49, 51] → 44.1 + 5.1 = **49.2** → 49; B rounds to [50, 49] →
45.0 + 4.9 = **49.9** → 50. Reported order B > A — **reversed**, with both displayed totals also
wrong by a point.

**Reachability.** Fractional intermediates are the norm, not the exception: `_on_the_anchored_scale`
interpolates linearly between anchors and `_by_standing` divides by `len−1` (for 32 candidates,
`k/31·100` is non-integral for 30 of 32 ranks).

**Tests.** `backend/tests/unit/evaluation/test_normalisation.py:125-126`
(`test_a_fractional_figure_becomes_an_integer_score`) asserts the early conversion, i.e. the suite
pins the behaviour `reqs.md` 5.1 forbids rather than catching it.

### BE-03 - insufficient scoreability suppresses definite non-matches

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `arch.md:878-887`: "**Eligibility is decided independently of scoreability, and
first.** … **A candidate can be both, and the model reports the decisive one: `not_matching`.** A
visa gate that fails is definite regardless of how much data was gathered." `reqs.md` 5.4 requires
a non-matching candidate to stay visible with its reason.

**Code.** `evaluation/ranking.py:412-439`:
```
refusal = _why_it_cannot_be_scored(...)
if refusal is not None:
    return CandidateResult(..., match_status=MatchStatus.INSUFFICIENT_DATA, insufficient_reason=refusal)
total = ...
warnings, ruled_out_by_a_rule = judgements_of(...)
refusals = gates_that_rule_out(...) + ruled_out_by_a_rule
```
The early return precedes **both** `judgements_of` and `gates_that_rule_out`, and the returned
object carries neither `warnings` nor `non_match_reasons`.

**Proof.** Liechtenstein holds a confirmed `not_matching` on an enforced `li_eea_quota`, and its
coverage sits below `min_coverage` (or a `blocks_if_missing` criterion is unanswered). The result
is `insufficient_data` with "only 41% of the scored weight was answered" and **no mention of the
quota** — the definite fact is replaced by the provisional one. The architecture states the
opposite precedence explicitly. Warnings are lost on the same path.

**Tests.** The rule tests build scoreable candidates, so the ordering never bites.

### BE-04 - valid zero-scoring-mass configurations cause unhandled errors

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `evaluation/weighting.py:135-146` (`_total_of`) raises `WeightingError` when the mapping
is empty or sums to ≤ 0. `evaluation/ranking.py:237-258` (`_renormalised_within_each_pillar`) calls
`renormalise` **per pillar** over the criteria left after exclusions.
`evaluation/ranking.py:161-171` (`_refuse_a_pillar_nothing_scores_into`) reads
`criteria.pillars_with_no_criteria`, which (`criteria/criteria_set.py:214-226`) returns every
weighted pillar with no criterion **regardless of its weight**.
`api/errors.py:67-100` has no `WeightingError` entry, and `refusal_for` (`:106-116`) re-raises when
there is none; `api/app.py:100-103` registers `domain_error_handler` for `ValueError`, so the
re-raise escapes as a 500.

**Proof (claim 1).** `Criterion.weight` is `Field(ge=0, le=100)` and `0009-criteria.sql:35`
constrains weights to 0–100, so a pillar `[A=100, B=0]` is legal and is exactly what the
rebalancer produces when a user drags A to 100. Exclude A (`is_scored=false`, a one-click
action). `_criteria_to_score` drops A; `_renormalised_within_each_pillar` builds `{B: 0}`;
`renormalise` → `_total_of` → `total == 0` → `WeightingError("the criteria carry no weight between
them…")`. `GET /rankings` answers **500**, for a configuration the domain and the schema both
accept.

**Proof (claim 2).** `_refuse_a_pillar_nothing_scores_into` raises `RankingError` naming the
remedy "give the pillar a criterion or give it no weight" — but setting the weight to 0 leaves the
`pillar_weight` row in place, so `pillars_with_no_criteria` still returns it and the refusal
repeats. The stated remedy does not work; only deleting the row does, and no endpoint deletes one.

**Note.** `RankingError` *is* mapped (422 `cannot_be_ranked`), so claim 2 is a bad message rather
than a 500; claim 1 is the 500.

### BE-05 - normalisation legality is not checked against value type

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 3.3a's "Legal scales" column is authoritative: `Monetary` → `fixed`;
`Quantity`/`Count` → `fixed`, `percentile`; `Ratio` → `fixed`, `percentile`, `as_is`; `Index` →
`as_is`, `percentile`; `AssignedScore` → `as_is`; `LabelSet`/`ShareComposition`/`Boolean`/`Text` →
none. The section then explains *why* ("Offering `fixed` uniformly would invite hand-set anchors
for a scale that is already known").

**Code.** `criteria/criterion.py:176-185` runs seven validators — target-range band, band-vs-method
(`0468`), zero-points, reducer/option, anchor count, anchor direction, threshold shape — and
**none** compares `normalisation_method` with `value_type`. `api/criteria.py:304-306`
(`update_criterion` → `_applied` → `with_criterion_scoring`) passes the method straight through.
SQL: `0009-criteria.sql:76-77` checks only membership in the three names;
`0468` adds only `goal <> 'target_range' OR normalisation_method = 'fixed'`. No constraint anywhere
mentions the pair.

**Proof.** `PATCH /criteria-sets/{id}/criteria/country.avg_annual_temperature {"goal":"maximise",
"normalisation_method":"as_is"}` is accepted. At scoring, `_already_a_score`
(`normalisation.py:218-234`) finds no `published_bounds` on a `Quantity`, so 15 °C is read as the
score 15 and, under `minimise`, as `score_scale_max − 15`. A raw magnitude has become an arbitrary
score. Symmetrically, `Count` → `as_is` with a count of 314 is refused
("314 is not a score on a scale of 0 to 100"), `scores_for` raises, `_scores_by_criterion` swallows
it into an empty column, and the whole criterion silently stops scoring for everyone.

**Tests.** `backend/tests/unit/criteria/test_criterion.py:299-301` and neighbours assert method
names and target-range combinations; type legality is untested because it is unimplemented.

### BE-06 - Quantity units are not validated against their declared dimension

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 3.3a, type-implicit table: `Quantity` — "Carries a unit **belonging to the
criterion's declared dimension**".

**Code.** `data/attribute.py:286-317` (`rejection_reason_for`) checks the payload's type, then
`allowed_range`, then `allowed_labels` — never the unit against
`attribute.quantity_parameters.unit`. `data/payloads.py:189-200`: `Quantity` carries
`magnitude: Decimal` and `unit: UnitId` with no cross-check. `data/manual.py:63-78` validates only
`payload_class_for(attribute.value_type)` and then goes through `Measurements.figure`.
`evaluation/magnitudes.py:47-48`: `_magnitude(payload) = payload.magnitude`, unit ignored. Storage:
`0006-value-payloads.sql:38-48` requires `unit REFERENCES unit (id)` — existence only, never
agreement with the attribute.

**Proof.** `country.naturalisation_pathway` is seeded `Quantity` with
`attribute_quantity_parameter.unit = 'years'` and `manual_entry = true`
(`0101-catalog-pillars-and-attributes.sql:67,98`). `POST /values` with
`{"magnitude": 5, "unit": "celsius"}` passes: `Quantity` constructs, `rejection_reason_for` returns
`None` (no `allowed_range` row for this attribute), the FK to `unit` resolves because `celsius` is
seeded for `country.avg_annual_temperature`, and the row stores clean. If no competing value exists
or the rival source is switched off, `figure_of` hands scoring the magnitude 5 and the criterion
reads "5 years of residence". A wrong number that looks entirely right.

**Tests.** `tests/unit/data/test_manual.py` uses correct units throughout.

### BE-07 - confidence derivation is disconnected from production reads

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 5.7: "**Confidence is derived, not typed.** It is computed from the
source's reliability tier, then downgraded for age beyond `max_age`, for geography coarser than
the candidate, and for values derived rather than directly reported", and `medium` is defined as
"Past-`max_age` official data".

**Code.** `data/confidence.py:69-100` implements exactly that. A repository-wide grep for
`derive_confidence` finds it only in `data/__init__.py` (re-export) and
`tests/unit/data/test_confidence.py` — **no production caller**. Adapters set the grade as a
constant (`Measurements.confidence_level`, e.g. `who/adapter.py:181` `HIGH`,
`open_meteo/adapter.py:190` `MEDIUM`, `llm/fallback.py:160` `LOW`), `data/measurements.py:49,83`
passes it through untouched, and `storage/value_store.py` reads the stored column back verbatim.
`evaluation/ranking.py:388-394` computes `coverage_by_confidence` from
`readings[attribute][candidate].confidence`, i.e. the stored constant.

**Proof.** `country.healthcare_system_quality` has `max_age = interval '24 months'`
(`0111-attribute-max-age.sql:44`) and a WHO value stamped `HIGH`. Three years later the
active-value rule still demotes it on freshness (`data/active_value.py:118-126` uses
`attribute.has_gone_stale`), but its **grade** is still `HIGH`, so `coverage_by_confidence` reports
weight resting on a stale figure as high-confidence. The disclosure `reqs.md` 5.7 exists to make
is wrong in the direction of flattery.

**Scope.** The report correctly separates the two: freshness ordering works; grade disclosure does
not.

### BE-08 - rejected measurements are absent from selective failure retry

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 3.3a, "On a validation failure": the value is stored and marked rejected,
it does not become active, **"the `DataAcquisitionRun` records it as a failure for that candidate
and attribute, so selective retry (section 6.4) can pick it up"**.

**Code.** `data/measurements.py:90-102` sets `rejection_reason` on the `Value` and returns it among
the adapter's `values`. `data_acquisition/run.py:114-138` appends `acquired.values` (rejected rows
included) and stamps/collects **only** `acquired.failures`. No code path converts a
`value.rejection_reason` into an `AcquisitionFailure`. `execution.py:360-380` (`_item_by_item`) and
`run_store.record_failures` therefore never see it, and `retry_run`
(`execution.py:466-520`) works from `failed.failures`.

**Proof.** Open-Meteo returns 62 °C for a summer-day attribute whose
`attribute_allowed_range` is −20..40. The row is stored rejected and excluded from the active-value
comparison, so the candidate loses coverage. `select_run_failures` returns nothing for that pair;
`run.failures` is empty; `POST /{id}/retry` answers `409 nothing_to_retry` — "failed on nothing"
about a run that demonstrably rejected a figure. Worse, `items_completed` counts the pair
(the SQL counts `value` rows for the run regardless of `rejection_reason`,
`storage/queries/runs.sql:174-176`), so the run reports it as answered.

### BE-09 - WHO bypasses attribute-explicit validation

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `data_sources/who/adapter.py:164-194` (`_a_value`) constructs `Value(...)` directly with
`payload=Index(...)`, never routing through `Measurements.figure`. `data/measurements.py:12-20`
exists precisely so the attribute-explicit layer (`rejection_reason_for`) is applied to every
figure — the P59 fix.

**Proof.** The type-implicit layer still applies (`Index` refuses a value outside its own declared
`scale_min`/`scale_max`), but `attribute_allowed_range` and `attribute_allowed_label` are never
consulted for WHO. If `country.healthcare_system_quality` gained a credible range narrower than
0–100 (say 20–100), a WHO reading of 8 would be stored **accepted**, become active and be scored.

**Present reachability: none.** `0101-catalog-pillars-and-attributes.sql:133-138` seeds
`attribute_allowed_range` for exactly two attributes — `country.avg_annual_temperature` and
`country.child_benefit_policy` — and later migrations add it only for
`country.european_air_connectivity` (`0470`) and the summer/winter day attributes (`0466`). WHO's
only attribute has none, so the gap is latent today. The report says so.

### BE-10 - retry wrappers do not forward the running cost meter

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Code.** `data_acquisition/adapter.py:103-130` declares `meter_with` as a concrete **no-op** hook
with a working default. `data_acquisition/execution.py:532-564` (`_AskedOnlyAbout`) explicitly
forwards `data_source`, `costs_money`, `estimate_for`, `attributes` and `fetch` — the class
docstring even argues "A delegating subclass forwards all of its subject or none of it" — and
**does not override `meter_with`**. `data_acquisition/run.py:84-85`:
`if meter is not None and adapter.costs_money: adapter.meter_with(meter)` — invoked on the
wrapper, so the base no-op runs and the wrapped adapter is never told.

**Proof (claim 1 — overrun).** `LlmFallbackAdapter.fetch` (`llm/fallback.py:145-206`) consults
`self._meter` before each candidate. Under `_AskedOnlyAbout`, `self._meter` is whatever it was
before (often `None`), so the guard at `:155` never trips: all 32 candidate calls are billed and
committed, and the run's meter only learns about them in `run.py:97-108`'s post-`fetch`
reconciliation. With a €1.00 cap and ~€0.05 per call, a retry bills ~€1.60 on one attribute before
anything halts — exactly the P91 residue the hook was added to remove, reintroduced on the retry
path.

**Proof (claim 2 — stale meter).** Adapters are constructed once at boot
(`main.py:320-342`, held on `app.state.adapters`), so `LlmFallbackAdapter._meter` persists across
runs. If an earlier *direct* run exhausted its meter, a later retry through `_AskedOnlyAbout`
leaves `self._meter` pointing at that exhausted `CostMeter`; `is_exhausted` is `True` from the
first candidate, and every candidate is recorded as "the run reached its spend cap before this
candidate was asked" although the new run's cap is untouched.

**Tests.** The retry tests assert `costs_money`/`estimate_for` forwarding (the P41 fix) and never
drive a metered candidate loop through the wrapper.

### BE-11 - selective retries expand exact items into Cartesian products

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 6.4: "a single action retries **only what failed**."

**Code.** `execution.py:495-505`:
```
wanted_candidates = {failure.candidate for failure in failed.failures}
wanted_attributes = {failure.attribute for failure in failed.failures}
```
then `attributes=[a for a in attributes if a.id in wanted_attributes]`,
`candidates=[c for c in candidates if c.id in wanted_candidates]`. The per-source narrowing
(`_what_each_source_failed_on`, `:522-528`) is by **attribute only**; `_AskedOnlyAbout.attributes`
(`:601-606`) filters attributes and `fetch` receives the full candidate list.
`ask_again` (`:586-616`) does the same over `run.unanswered`.

**Proof.** Failures `(A, Germany, attr1)` and `(B, France, attr2)` produce
`candidates = {Germany, France}`, `attributes = {attr1, attr2}` — four pairs from two. Source A is
asked about attr1 for **France** as well, and source B about attr2 for **Germany**, neither of
which failed. For `ask_again` the same holds over the diagonal of unanswered pairs. Where the
expanded source charges per candidate (the LLM path), the extra pairs are billed; where it does
not, they append redundant observations and inflate the new run's `items_total`.

**Mitigation acknowledged.** `retry_run`'s docstring argues the extra pairs are free because each
source answers a whole indicator per request; that is true of the structured adapters and false of
the per-candidate paid ones, which is the case the cap exists for.

### BE-12 - retry blocks despite 202 and omits the in-flight guard

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Code.** `api/runs.py:250-287` (`start_run`) is the reference protocol: check
`runs.run_in_flight()` → 409 `run_already_in_flight`; `open_run(...)`;
`background.add_task(continue_run, opened)`; return the opened run.
`api/runs.py:362-387` (`retry`) does neither: it `await ask_again(...)` / `await retry_run(...)`,
both of which call `execute_run` = `continue_run(await open_run(...))` inline, and it never calls
`runs.run_in_flight()`. The decorator still declares `status_code=202`.

**Proof (blocking).** The response is emitted only after the whole retry sweep finishes; a 202 that
blocks is indistinguishable from a hang, and behind the containerised proxy it is additionally
subject to `proxy_read_timeout 60s` (UI-01's mechanism). The 202's own contract — "accepted, poll
the id" — is false here.

**Proof (overlap).** Nothing refuses a retry while a run is `running`, and nothing refuses two
retries. Each `open_run` inserts a new `data_acquisition_run` row with status `running`, so N
concurrent `running` rows exist. `sweep_abandoned_runs` and `select_run_in_flight`
(`storage/queries/runs.sql:274-288`) both assume at most one, and `start_run`'s own guard becomes
useless since it names only the first of them.

**Scope.** ST-01 is correctly identified as the distinct problem that the guard, even when
present, is not atomic.

### BE-13 - unanswered retry loses the original paid-source eligibility decision

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High for the eligibility
claim, which the report already states is the demonstrated effect

**Authority.** Q220: "**a paid source is asked only when a run names its attributes**, so a sweep
over a level is free by construction and spending is always something somebody chose."

**Code.** `api/runs.py:259-260` applies that rule at start:
`asked = asked_this_run(consulted, attributes_named=scope.attributes is not None)`, and
`execution.py:425-441` (`asked_this_run`) drops `costs_money` adapters for an unscoped run.
`api/runs.py:360-365` (the `unanswered` branch) passes `adapters=consulted` — **the full enabled
registry** — with no `asked_this_run` call and nothing persisted from the original run that could
reconstruct the decision. `data_acquisition_run` stores level, scope rows, status and spend; it
does not store "this was a free sweep".

**Proof (demonstrated effect).** `open_run` then evaluates
`refuse_unless_capped(costs_money=any(adapter.costs_money for adapter in adapters), …)`
(`execution.py:185-188`) over the whole registry. With the LLM path configured and no cap set,
ask-again over a free sweep's unanswered Eurostat items is refused `409 spend_cap_not_set`, or —
with a cap set — proceeds under cap accounting it should not be subject to. The original consent
("free, so no cap needed") is neither preserved nor reapplied.

**Proof (billing risk is conditional, as the report says).** `open_run` computes `answerable` from
the adapters it is given, so on the original free sweep the paid adapters' attributes were never in
scope and cannot appear in `run.unanswered`. With today's registry — `LlmEmployersAdapter`
(`country.international_employers`) and `LlmFallbackAdapter` (attributes **no** other adapter
declares, `main.py:356-390`) — no unanswered item from a free sweep is answerable by a paid
adapter. A future or custom registry with an overlapping paid source removes that accident. The
report qualifies this correctly.

### BE-14 - unrelated paid adapters make free explicit work require a cap

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `execution.py:185-188`:
`refuse_unless_capped(costs_money=any(adapter.costs_money for adapter in adapters), cap_eur=…,
uncapped_is_accepted=…)`. The predicate ranges over the adapter list handed in, which for an
attribute-scoped run is the **entire** switched-on registry (`asked_this_run` returns
`tuple(adapters)` unchanged when `attributes_named`). Nothing intersects `adapter.attributes` with
the run's `in_scope` before asking the question.

**Proof.** Configure the LLM path (so `LlmEmployersAdapter.costs_money` is `True`). Request
`POST /data-acquisition-runs {"level":"country","attributes":["country.overcrowding_rate"]}` — an
Eurostat-only scope. `answerable` resolves to that one attribute, and the plan
(`plan_run`, which loops `adapter.estimate_for` only where `items > 0`) correctly reports
`estimated_cost_eur = 0`. `open_run` nevertheless sees `any(costs_money) == True` and raises
`SpendCapNotSetError` → `409 spend_cap_not_set` for a run that cannot spend a cent. Conversely,
with a cap set, a genuinely free scope is accounted against the cap and can be halted by BE-16's
zero-cap bug.

**Tests.** The spend tests build registries that are either all-free or all-paid, so a mixed
registry with an *unrelated* paid adapter is unexercised.

### BE-15 - disabled sources remain consultable through other paths

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** Q232, verbatim: "**Switching one off stops it being scored and keeps every figure it
produced** … **It also stops being asked by a run**, since fetching figures that cannot score is
work nobody wants and is paid for where the source charges."

**Code and proof, three paths.**
1. **Gate research.** `api/rules.py:269-325` builds rules, roster, household and cap and calls
   `research_gates`; it never reads `catalog.read_data_sources()` and never tests the `llm` row's
   `is_enabled`. Switching the LLM source off therefore does not stop
   `POST /match-rule-research`, which is the single most expensive operation in the product.
2. **CLI acquisition.** `backend/scripts/acquire.py:46-47`:
   `return tuple(adapter for adapter in _the_sources(...) if not adapter.costs_money)` — it filters
   on **charging**, not on enabled state, and `main()` (`:65-72`) loops those adapters directly.
   `switched_on` exists (`execution.py:395-410`) and is not called. `make acquire` therefore asks a
   source the household has switched off and writes figures the active-value view then discards.
3. **Stand-ins.** `execution.py:319-325` runs `stand_in(...)` unconditionally at the end of every
   run; `open_run` passes `stand_ins=await catalog.read_stand_ins(level=…)` with no
   `is_enabled` check on the `stand_in` data source (`0460`). Switching `stand_in` off still
   writes borrowed rows each run.

**Tests.** The disabled-source tests cover `plan`, `start` and `retry` (the P65 fix) only.

### BE-16 - a zero cap stops an entirely free sweep

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `data_acquisition/spend.py:56-59`:
`return self.cap_eur is not None and self.spent_eur >= self.cap_eur`.
`household/settings.py:60-66`: `run_spend_cap_eur: Decimal | None = Field(default=None, ge=0)` —
zero is a legal, settable value, and `api/settings.py:31-36` imposes no further bound.
`execution.py:288-296` in `continue_run`:
```
if meter.is_exhausted:
    return await _halt(run, runs, candidates, failures, RunStatus.HALTED_ON_SPEND_CAP)
```
checked after **every** adapter, unconditionally. `run.py:131-133` applies the same test between
attributes inside a source.

**Proof.** Set the cap to 0 (a reasonable way to say "never spend"). Start an ordinary free sweep:
`refuse_unless_capped(costs_money=False, …)` returns, `CostMeter(cap_eur=Decimal(0))` is built with
`spent_eur = 0`, and `0 >= 0` is **already true**. Inside `acquire`, the first attribute is fetched
and stored, then `meter.is_exhausted` breaks the loop; back in `continue_run` the same test halts
the whole run as `halted_on_spend_cap`. One attribute of one source is fetched; the remaining
sources are never asked; the run reports a monetary halt having spent nothing.

**Correct behaviour.** Monetary exhaustion should gate monetary work; the zero cap's real meaning
("refuse paid calls") is preserved by `is_exhausted` only at the points where money is about to be
spent.

### BE-17 - billed empty research responses are treated as free

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Code.** `data_sources/llm/client.py:164-167`:
```
if not text.strip():
    raise LlmUnavailableError("the model answered with no text at all", cost_eur=cost, calls=1)
```
— the exception deliberately carries what the provider billed (the P71 fix).
`data_sources/llm/gates.py:76-81`:
```
except LlmUnavailableError as unavailable:
    return Researched(match_result=MatchResult.UNKNOWN, reason=f"...{unavailable}", citations=())
```
`cost_eur` and `calls` are omitted, so `Researched`'s defaults apply
(`data_acquisition/research.py:60-66`: `cost_eur: Decimal = Decimal(0)`, `calls: int = 0`).
`research_gates` then does `meter.spent(cost_eur=found.cost_eur, calls=found.calls)`
(`research.py:125`) — i.e. `spent(0, 0)`.

**Proof.** A model in a bad state answers every gate with tool blocks and no prose. Each call bills
(say) €0.05 and raises; each is converted to a zero-cost `Researched`; the meter stays at €0.00;
`meter.is_exhausted` is never true; the loop runs all `gates × candidates` pairs. With 5 gates ×
32 countries that is 160 billed calls against a €1.00 cap, and `ResearchOutcome.cost_eur =
meter.spent_eur = 0` reports the pass as free. The cap is not merely late — it is inert on exactly
the failure mode it was written for.

**Contrast.** `llm/fallback.py:171-178` does it correctly: `cost += unavailable.cost_eur; calls +=
unavailable.calls; self._record(...)`. The gate path is the one that drops it.

### BE-18 - invalid configured prices undermine the spending model

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** Q219: prices are required configuration with no defaults, because "A run that cannot
measure its own cost cannot be capped."

**Code.** `data_sources/llm/pricing.py:65-90` builds a `missing` list from `value is None` only,
then guards **one** field: `if not eur_usd_rate or Decimal(str(eur_usd_rate)) <= 0: raise`. The
three component prices receive no sign or finiteness check. `main.py:84-107` declares them as
`Decimal | None = Field(default=None, …)` with no `ge`/`gt` and without `allow_inf_nan=False`, so
Pydantic accepts `NaN`/`Infinity`. `main.py:436-451`: `if not environment.llm_input_tokens_per_call:`
rejects `None` and `0` but **accepts a negative int**, which is truthy.

**Proof.** `LLM_INPUT_USD_PER_MTOK=-3` passes every check. `cost_of(...)` then returns a negative
contribution per call, so `CostMeter.spent_eur` **decreases** as calls are made and
`is_exhausted` recedes — an unbounded paid run under a cap that reads as satisfied.
`LLM_INPUT_TOKENS_PER_CALL=-20000` passes and makes `cost_of_a_call_at_most` understate (or go
negative), so `planRun`/`planMatchRuleResearch` quote a ceiling below what will be billed — the
"plausible-looking number" `reqs.md` 10 forbids, in the one place that is supposed to prevent a
surprise bill. A legitimate zero rate (a promotional free tier) must stay allowed, which is why the
remedy is "finite and non-negative", not "positive".

**Tests.** The pricing tests cover absent prices and an absent/zero FX rate, not these values.

### BE-19 - completed paid candidate answers still wait in memory before commit

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `arch.md` 7.1: commits are per item, which is what makes "a process that dies
mid-run keeps every figure it had written" true; P30 fixed the per-source version of this.

**Code.** `llm/fallback.py:145-206` and `llm/employers.py:126-176` both accumulate
`values: list[Value]` across the whole candidate loop and return `Acquired(values=tuple(values),
…)` only at the end. `data_acquisition/run.py:90,114-138` appends **after** `fetch` returns —
`acquired = await adapter.fetch(attribute, candidates)` … `stored.extend(await
values.append(fetched))`. `execution.py:227` calls `acquire` per adapter; `:342,348` write
`record_failures` at the end.

**Proof.** 32 candidates, one paid attribute. The adapter bills and parses candidate 1 at t1 and
is killed during candidate 2's call at t2. Nothing has reached `ValueStore`: `append` has not been
called once, so the per-append transaction `storage/connections.py:44-53` provides cannot help —
it protects data that was handed to it. Candidate 1's paid answer is lost and must be bought
again. The same window loses the `failures` list for that source, except on the `except Exception`
path, which a SIGKILL does not reach.

**Why Gate D misses it.** `backend/tests/acceptance/test_gate_d.py:48` describes its source as one
that "Answers one attribute and then dies" — the death is **between** `fetch` calls, after the
first returned, so the per-attribute append has already run. The inner per-candidate window is
unexercised by construction.

**Scope.** Correctly distinguished from the already-fixed P30 and from BE-33 (spend durability).

### BE-20 - source-protocol exceptions abort without contextual failure records

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** Medium-High

**Code.** `data_sources/open_meteo/response.py:23-26`:
`series.append([None if r is None else Decimal(str(r)) for r in readings])`.
`Decimal(str(x))` raises `decimal.InvalidOperation` for any non-numeric token;
`InvalidOperation` derives from `ArithmeticError`, **not** from `ValueError`, and `OpenMeteoError`
is a `ValueError` subclass. `open_meteo/adapter.py:114-120` catches only
`(SourceUnavailableError, OpenMeteoError)`.

**Proof.** A 200 response whose `daily.temperature_2m_max` array contains `"n/a"`, `true` or an
object — a protocol violation, not a transport failure — escapes `fetch`, propagates through
`acquire` (`run.py` has no catch), and lands in `continue_run`'s `except Exception`
(`execution.py:327-345`). That block records the failures **collected so far**, closes the run
`failed` and re-raises. The current weather item never becomes an `AcquisitionFailure`, so the run
shows no failure for it; every source after Open-Meteo in the adapter order is skipped; and the
affected pairs surface as `unanswered` rather than as a named parse failure, so `retry` offers
nothing and `ask_again` re-asks everyone.

**Limitations.** Reachability depends on Open-Meteo emitting a non-numeric cell, which was not
observed. The structural point — an expected protocol error outside the adapter's recognised
catches aborts the run — is established statically regardless.

### BE-21 - invalid requests can produce 500s or the wrong error body

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `arch.md:900`: `api/` catches malformed requests — "Missing field, unparseable id,
unknown query parameter → `400`". `arch.md` 7.6 gives the API **one** error shape (`code`,
`message`, optional `details`), and `openapi.yaml:1045-1056` declares it.

**Mechanism.** `api/app.py:100-103` registers `domain_error_handler` for `ValueError` and
`LookupError`; `api/errors.py:106-128` returns `None` for any exception with no `STATUS_FOR` entry
and then **re-raises inside the handler**, which Starlette turns into a 500. Pydantic's
`ValidationError` is a `ValueError` subclass whose MRO contains no mapped type, so **any**
domain `ValidationError` that is not explicitly translated becomes a 500.

**Code and proof, per case.**
- `api/settings.py:24-35,63-72`: `SettingsBody.score_scale_max: int | None` has no bound;
  `Settings.score_scale_max` is `Field(gt=0)`. `PUT /settings {"score_scale_max": 0}` →
  `ValidationError` → unmapped → **500**.
- `api/household.py:29-39,56-66`: `HouseholdBody.net_income: float` is unbounded;
  `Household.net_income` is `Field(ge=0)`. `PUT /household {"net_income": -1, …}` → **500**.
  The same applies to a malformed `home_country_candidate` and to every `HouseholdPlaceError`,
  which *is* mapped (422 `unknown_place`) but is raised inside a `model_validator` and therefore
  arrives wrapped in a `ValidationError` the table cannot see. `household/__init__.py:12-18`
  documents the wrapping explicitly.
- `api/criteria.py:209-217` (`_the_threshold_in`) and `api/values.py:132-135` raise mapped domain
  errors directly and are **not** affected — these are the counter-examples that show the pattern is
  inconsistent rather than absent. Inverted threshold bounds reach `RangeThreshold`'s validator
  through `_the_threshold_in`, i.e. also wrapped; the criterion path survives only because
  `CriteriaSet._with_revalidated` (`criteria/criteria_set.py:356-380`) catches `ValidationError`
  and re-raises it as `CriterionDeclarationError`.
- Body conformance: `api/errors.py:118-128` (`refusal_handler`) is registered for `HTTPException`
  only, and FastAPI's own `RequestValidationError` 422s are rendered by its default handler as
  `{"detail": [...]}` — the agreed `code`/`message` shape is absent for every malformed-request
  refusal, including the 422 `weight: 140` case the acceptance suite asserts
  (`tests/acceptance/test_endpoints.py:280-289`, which checks only the status).

**Tests.** The suite asserts statuses at DTO boundaries, which is exactly where the shape is
already right; the conversion boundary is untested.

### BE-22 - empty-name edits can persist an unreadable criteria set

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Code.** `criteria/criteria_set.py:92` `name: str = Field(min_length=1)`.
`api/criteria.py:399-416` (`rename_criteria_set`):
`await criteria.replace_criteria_set(current.model_copy(update={"name": body.name}))` — Pydantic
v2's `model_copy` **does not validate**. `RenameBody.name: str` has no `min_length`.
`api/criteria.py:486-488` (`duplicate_criteria_set`) is the same shape via
`CriteriaSet.duplicated_as` (`criteria_set.py:244-260`), which is also `model_copy`.
`storage/criteria_store.py:91-112` writes the name through `update_criteria_set_name`;
`0009-criteria.sql:13-16` declares `name text NOT NULL` with **no length CHECK**.

**Proof.** `PATCH /criteria-sets/local_employment {"name": ""}` → 422? No: the body validates, the
copy is unvalidated, the row is written. The handler then calls
`_set_body(await criteria.read_criteria_set(criteria_set_id))`, and *that* read constructs a
`CriteriaSet` from the row → `ValidationError` on `min_length=1` → unmapped (BE-21's mechanism) →
**500**. The rename has already committed. From then on `GET /criteria-sets/{id}`,
`GET /rankings?criteria_set={id}`, any further rename, and every screen that selects the set answer
500. `duplicate` persists the same state under a brand-new id. Recovery requires `DELETE`, which
`criteria_store._delete` refuses with 409 `criteria_set_in_use` once any saved evaluation
references the set (`0010-evaluation.sql:9-13`, no `ON DELETE`), leaving direct SQL as the only
route.

**Tests.** Every criteria-set test uses a valid name.

### BE-23 - unknown fields and illegal nulls are inconsistently ignored or coerced

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Authority.** `arch.md:900` requires an unknown query parameter to be a 400. `openapi.yaml:1366-
1372` types `scale_anchors` as a plain `array` (not nullable), while `matching_threshold` is
documented as "Null clears it" — i.e. the design distinguishes the two.

**Code and proof.**
- `api/settings.py:24-35`, `api/household.py:19-28`, `api/runs.py:46-60,126-137`,
  `api/rules.py:61-68,85-95` all declare plain `BaseModel`s with no `model_config`, so Pydantic's
  default `extra="ignore"` applies. Only `CriterionInput` (`api/criteria.py:127-140`) and the
  threshold bodies set `extra="forbid"`.
- `api/criteria.py:465-480` `PillarWeightInput` has both fields optional and no `extra="forbid"`.
  `PUT /criteria-sets/{id}/pillar-weights/{p} {"weightLocked": true}` → both fields are `None` →
  `update_pillar_weight` (`:496-545`) changes nothing, rewrites the set, and answers **200** with
  the unchanged weights. A misspelling reads as success.
- `PUT /settings` is a whole-record replace, so `{"min_coverge": 60}` silently clears
  `min_coverage` (the correctly spelled field defaults to `None`) and reports the cleared record
  back as if it were the request.
- `CriterionInput.scale_anchors: tuple[...] | None` plus
  `rule["scale_anchors"] = tuple(... for a in (self.scale_anchors or ()))`
  (`api/criteria.py:175-180`) means an explicit `"scale_anchors": null` — a value the contract does
  not declare — **clears every anchor**.
- `_the_threshold_in` (`:209-217`) selects the shape from `model_fields_set`, so
  `{"required_value": null}` names the boolean shape and `BooleanThreshold(required_value=bool(None))`
  stores **false** — a matching rule the client never expressed.
- Query parameters: FastAPI ignores undeclared ones, so `GET /rankings?criteria_sett=x` runs
  against the default rather than answering 400.

**Tests.** The strictness tests concentrate on `CriterionInput` extras, which is the one place the
rule is enforced.

### BE-24 - mixed unknown scope IDs silently disappear

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `api/runs.py:451-469`:
```
wanted = set(scope.candidates); return [c for c in roster if str(c.id) in wanted]
```
and the attribute twin — pure intersection, with `wanted - found` never computed.
`api/rules.py:247-255` and `:298-306` repeat it for `match_rules` and `candidates` in both the
research plan and the research pass.

**Proof.** `POST /data-acquisition-runs {"level":"country","candidates":["country.de",
"country.gemany"],"attributes":["country.forest_cover"]}` runs happily over Germany alone; the
plan, the run record and the progress report all describe a one-candidate run, and nothing says the
second identifier was discarded. The research equivalent is worse because it spends: naming three
gates of which one is misspelled researches two, bills for two, and reports a completed pass. Level
is equally unchecked — a city id in a country-level scope is simply dropped.

**Tests.** The scope tests narrow with valid identifiers only.

### BE-25 - plans omit freshness suppression applied at execution

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` 6.3 requires the plan to show what the run will do; Q233 introduced
`refetch_older_than_days` as a run-scoping rule.

**Code.** `api/runs.py:162-203` (`plan_run`) reads candidates, attributes and
`asked_this_run(switched_on(...))`, and computes `items_total = len(answerable) * len(roster)` —
it never calls `runs.last_retrieved(...)` and never reads `settings.refetch_older_than_days`.
`execution.py:142-155` (`open_run`) does both: `still_fresh_everywhere(...)` then
`answerable = [a for a in answerable if str(a.id) not in fresh]`, and `:170-176` raises
`NothingToFetchError` when freshness empties the scope.

**Proof.** With `refetch_older_than_days = 30` and a sweep run yesterday, `POST /plan` quotes 32
candidates × 43 attributes = 1,376 items (and, for a paid adapter, a matching call count and cost
ceiling). Pressing Start then answers `409 nothing_to_fetch` — "every attribute in this run's scope
was fetched within the last 30 days". A partially fresh scope is worse: the plan's `items_total`
and `estimated_cost_eur` describe work that will not happen, and the household agrees to a number
that is not the one being incurred.

**Tests.** Planning and freshness are each covered in isolation; nothing asserts they agree.

### BE-26 - truncated weather data is labeled a complete period

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `data_sources/open_meteo/response.py:11-27` validates the number of **locations** and
that each has a `daily[variable]` sequence; `daily.time` is never read and no expected length or
date alignment is computed. `open_meteo/adapter.py:166-170` keeps a place when
`readings and all(reading is not None for reading in readings)`; `:189-194` stamps
`ReferencePeriod(start=window[0], end=window[1])` — the full requested window — and a quote naming
it.

**Proof.** The archive returns one day for a 365-day request (a partially ingested ERA5 window, a
truncated proxy response, a silently clamped date range). The series is non-empty with no `None`,
so the place is "complete"; `sum(readings)/len(readings)` is that single day's value; the value is
stored as the **annual population-weighted mean** for 2025-01-01 → 2025-12-31, with
`confidence_level = MEDIUM` and a quote that asserts the full period. Downstream the figure is
indistinguishable from a real annual mean and is scored against a target band. Misalignment is
equally invisible: a window shifted by a month passes every check.

**Scope.** The report states that no current publisher truncation was observed; the finding is the
absent validation, not an observed bad figure.

### BE-27 - malformed WDPA CSV rows silently lose provenance

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `data_sources/published_tables/table.py:117-146` builds
`csv.DictReader(io.StringIO(...))`, checks `reader.fieldnames == COLUMNS` (five columns) and then
reads `record["workings"]`. `DictReader` places surplus fields under the `restkey` (default
`None`), and this loader never sets or inspects `restkey`/`restval`.

**Proof.** `tables/protected_planet_protected_land.csv:12-15` — the `workings` cell is unquoted and
contains commas. Row `NO`:
`…,terrestrial + inland waters protected area 17.81% of mainland land area (57781 of 324484 km2; mainland, excludes Svalbard/Jan Mayen), WDPA profile read Oct 2026`
splits into seven fields. `record["workings"]` is `"terrestrial + inland waters protected area
17.81% of mainland land area (57781 of 324484 km2; mainland"` and `record[None]` is
`[" excludes Svalbard/Jan Mayen)", " WDPA profile read Oct 2026"]`, which is discarded. The
Norway row's territory-exclusion caveat — the one note that explains why its denominator differs —
never reaches `Value.quote`, and the same truncation applies to CH, GB and IS. The loader's stated
contract ("read strictly at boot… a slip in a file stops the start-up with the file and row
named") does not hold for row width.

### BE-28 - AssignedScore fallback always constructs an invalid payload

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `data_sources/llm/fallback.py:322-325`:
`return AssignedScore(value=figure, assigner=Assigner.LLM)`.
`data/payloads.py:337-364`: `AssignedScore` requires `value`, `range_min`, `range_max` and
`assigned_by` — there is no `assigner` field, and `Payload` is `extra="forbid"`.

**Proof.** Every construction raises `ValidationError` (three missing required fields plus one
unknown). `_the_figure_given` wraps the call in `except ValueError as unshapeable` (`:259-262`),
and `ValidationError` is a `ValueError`, so the outcome is an `AcquisitionFailure` — *after*
`self._llm.ask(...)` has already been billed and `self._record(...)` has charged the meter
(`:188-191`). An eligible `AssignedScore` attribute would therefore pay for an answer the code
can never store, once per candidate, deterministically.

**Latency.** The only two `AssignedScore` attributes in the catalog —
`country.residency_admin_ease` and `country.pension_portability`
(`0101-catalog-pillars-and-attributes.sql:69,71`) — both carry `manual_entry = true`, and
`main.py:379-387` excludes manual-entry attributes from the fallback declaration set. So the branch
is unreachable today, exactly as the report says.

### BE-29 - JSON float decoding loses precision before Decimal conversion

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `data_sources/transport.py:85-87` returns `response.json()`, i.e. httpx's default
`json.loads`, which decodes every JSON number with a fraction or exponent into a binary `float`.
`data_sources/eurostat/jsonstat.py:136-143` then does `Decimal(str(figure))` on that already-lossy
`float`. The decimal-preserving loader the project does own —
`storage/connections.py:23` `functools.partial(json.loads, parse_float=Decimal)` — is applied to
database jsonb only, never to source responses.

**Proof.** `0.1234567890123456789` → `float` → `0.12345678901234568` → `Decimal(
"0.12345678901234568")`. Seventeen significant digits survive; the rest cannot be recovered, and
the round trip is not the publisher's number. The adapters' own comments ("Money never becomes a
float in this application (`arch.md` 9.6)", `jsonstat.py:138-141`) state the intent that the
transport layer defeats one step earlier.

**Impact.** Latent: no shipped Eurostat series publishes that many significant digits, so no
present ranking is claimed to change. It matters for any exact boundary comparison
(`_within` in `evaluation/rules.py:95-101`, `allowed_range.excludes`, anchor interpolation).

### BE-30 - malformed employer elements become company-name strings

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Authority.** `reqs.md` 6.10 use 2: the named firms **are** the evidence; `reqs.md` 10 forbids a
plausible-looking value with nothing behind it.

**Code.** `data_sources/llm/employers.py:212-235`:
```
listed = reply.get("employers", [])
if not isinstance(listed, list): return refused(...)
named = [str(name).strip() for name in listed if str(name).strip()]
```
The container is type-checked (the P72 fix); the **elements** are stringified unconditionally.

**Proof.** `{"employers": [null, 123, {"name": "Acme"}]}` yields
`["None", "123", "{'name': 'Acme'}"]`, all non-blank, all kept. `LabelSet(labels=…)` accepts them,
`measuring.figure(...)` attaches the model's real citations, and the drill-down displays `None`,
`123` and a Python dict repr as international employers of that country, at `low` confidence with
genuine-looking provenance. No failure is recorded, so a retry sees nothing to fix.

**Tests.** The employer tests reject a scalar container; non-string elements are unexercised.

### BE-31 - comparison imports a dependency forbidden by the exhaustive graph

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Authority.** `arch.md:550` — the module table row for `comparison/` lists its allowed imports as
exactly `candidates`, `data`, `evaluation`; `arch.md` 6.1 calls the table exhaustive, and
`CLAUDE.md` restates "the import table in `arch.md` 6.1 is exhaustive". `arch.md:603-604` shows
`comparison --> evaluation` and `comparison --> data` and no edge to `criteria`.

**Code.** `backend/src/starnest/comparison/comparison.py:27`: `from starnest.criteria import TOTAL`.
`backend/pyproject.toml:185-198` is a **layers** contract listing
`comparison` above `criteria`, so a downward import is permitted; contract 1 forbids policy →
plugin, contract 3 forbids `data → criteria/household/evaluation`. No contract encodes the
per-module allow-lists of `arch.md` 6.1.

**Proof.** A concrete edge the architecture's own exhaustive table forbids exists in the source and
passes `make boundaries`. The claim being falsified is not "comparison is broken" but "the boundary
enforcement is exhaustive" — it is not. `TOTAL` is the percentage constant `Decimal(100)`
(`criteria/rebalancing.py:17`), so the remedy is placement rather than redesign.

### BE-32 - bare pytest includes live publishers by default

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `backend/pyproject.toml:52-59`: `testpaths = ["tests"]` and
`addopts = "-q --strict-markers -m 'not live_llm'"` — `live` is **not** excluded.
`backend/tests/conftest.py:108-133` guards only `live_llm`, and only against being *selected*
without naming it. `backend/tests/live/test_world_bank_collections.py:21`
`pytestmark = pytest.mark.live`, and `:81-101` performs real `httpx` GETs against
`api.worldbank.org` for all 32 countries. `tests/live/test_gate_b.py` is the same family.

**Proof.** `cd backend && uv run pytest` collects `tests/live/**`, matches `-m 'not live_llm'`, and
makes outbound HTTP. A developer's default invocation therefore becomes network-dependent and
publisher-dependent, contrary to the repository's own statement that live tests "Never run in the
normal suite — a failure here means the source was slow, not that we broke"
(`pyproject.toml:63`).

**Scope.** Correctly qualified: the `Makefile` targets pass `-m "not live"`
(`Makefile:176-177`), so `make check` is unaffected, and the paid tier is separately guarded.

### BE-33 - current-source spend is not durable per billed call

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Status check.** `known-issues.md:353` records **P36** as open/low: "A run killed mid-flight loses
its own spend record… runs 15 and 16… report 0 calls and 0 EUR having spent 2.70 EUR between them."

**Code.** `execution.py:258-285`: `await runs.add_spend(run, calls=outcome.calls,
cost_eur=outcome.cost_eur)` runs **after** `acquire` returns for a source.
`llm/employers.py:154-166` and `llm/fallback.py:178-191` update only the in-process `CostMeter`
per call (`self._record(...)`). Nothing writes a row per call.

**Refinement.** The report's correction of P36's wording is accurate: spend is persisted per
*source*, not only at run end, so a death after source 2 keeps sources 1–2's totals and loses
source 3's. `known-issues.md` also notes the related half — `add_run_spend` returns authoritative
running totals and `add_spend` is typed `-> None` and drops them — so the cap is decided from a
per-process meter that starts at zero on every restart.

**Limitations.** Gate D's death points (`test_gate_d.py:48,71`) are between attributes of a free
source, so the suite demonstrates figure durability, not cost durability.

### BE-34 - gate-research spending has no durable record

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Status check.** `reqs.md` Appendix B **Q224**, verbatim: "Gate research spends money and writes
gate answers rather than values, and a run is defined as a pass that writes values (section 3.8) —
so its cost reaches the response and the log, and no table: 'what has this month cost?' cannot be
answered from the database (`known-issues.md` P28). **Deferred deliberately rather than
overlooked.**"

**Code.** `data_acquisition/research.py:127-178` accumulates into a request-local `CostMeter`, logs
`meter.describe()`, and returns `ResearchOutcome(cost_eur=meter.spent_eur, calls=meter.calls, …)`.
`api/rules.py:310-325` serialises it into the response. No store is touched: `research_gates`'s
only persistence port is `ProposalStore.record` for the proposals themselves.

**Proof of the stated consequence.** A lost response, a killed process or the UI-01 proxy timeout
leaves `match_rule_result` proposal rows (written as each is found) and **no** record of what the
pass billed, anywhere except the application log.

**Verdict rationale.** The behaviour exists exactly as described and the report labels it as a
recorded deferral rather than a regression, which is the correct scope.

### BE-36 - finite-period confirmed gates never expire or become researchable again

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** Medium

**Authority.** `reqs.md` 3.7 gives `match_rule_result` `reference_period_start`/`_end` — "What
period the judgement holds for. A Swiss quota is annual" — and states: "**A gate ages like any
other finding.** Section 10's two-date rule has no exceptions… The reference period lets the
interface **mark an expired judgement and prompt a re-check**."

**Code.** `evaluation/rules.py:168-179` (`gates_that_rule_out`) filters on
`match_result is NOT_MATCHING and not answer.is_proposal` only — `reference_period` is never read,
and `MatchRuleResult` carries it (`data/rules.py:163-170`).
`data_acquisition/research.py:198-208` (`gates_to_ask`) excludes every `(rule, candidate)` whose
stored answer has `is_proposal == False`, with no period, outcome or household test; so a confirmed
`unknown`, an expired annual quota, and an answer predicated on a citizenship the household has
since changed are all permanently skipped. A grep confirms no UI surface renders a gate answer's
period either (UI-29 shows the only gate-answer screen is the proposals list).

**Proof.** Confirm `ch_eu_efta_quota` as `not_matching` for 2026 with
`reference_period = 2026-01-01..2026-12-31`. In 2028 it still rules Switzerland out of every
ranking, is still skipped by `research_match_rules`, is marked nowhere as expired, and can only be
changed by hand-editing through an API the interface does not expose.

**Compound adjudication.** The two factual sub-claims — evaluation ignores the period, research
skips every confirmed answer — are verified. The requirement verified against them is
`reqs.md` 3.7's expiry/re-check obligation, which nothing implements. The *third* element, that
evaluation itself ought to stop applying an expired gate, is **not** settled by any document —
3.7 assigns the marking to the interface — so that part of the report is overstated, and
`gates_to_ask`'s skip is an explicitly argued decision ("paying a model to disagree with somebody
who looked is noise with a bill"). The report's own Medium confidence and "pending validity/
override policy" qualifier match this reading, which is why the verdict is REAL rather than
UNCERTAIN.

**What would settle the remainder.** A recorded decision stating whether an expired confirmed gate
is enforced, ignored or merely flagged, and whether a citizenship change invalidates stored
answers.

### BE-37 - fallback eligibility is attribute-global rather than candidate-specific

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Authority.** `reqs.md` 6.10, use 1: "**Fallback source for a measurable attribute** — no dataset
covers **this candidate**", and the closing rule: "If an adapter covers the attribute **for that
candidate**, the model is not asked."

**Code.** `main.py:379-387`:
```
covered = {attribute for adapter in registered for attribute in adapter.attributes}
uncovered = tuple(a.id for a in await catalog.read_attributes()
                  if a.id not in covered and a.value_type in ANSWERABLE
                  and not a.is_retired and not a.manual_entry)
```
— pure set subtraction over **declarations**, computed once at boot. The docstring restates the
narrower reading as the design: "'No dataset covers this' is literally 'no adapter declares it'".

**Proof.** `country.protected_land_share` is declared by both the Eurostat adapter (27 EU members)
and the WDPA published table (4 non-EU). Liechtenstein is covered by neither and is deliberately
excluded by the WDPA transcription's own header. It is nevertheless absent from `uncovered`, so the
documented fallback cannot be used for it even if a citable figure existed, and no per-run
mechanism schedules the model after the structured sources have actually failed.

**Scope.** The report's qualifiers are correct and worth preserving: this is a divergence from the
written requirement whose present *need* is unverified, and it explicitly does **not** authorise
inventing EF-native-English scores or filling the two deliberately uncitable `AssignedScore` gaps.

### BE-38 - the backend coverage gate blends two required floors

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `devplan.md:818-820`: "**85% of lines and 85% of branches, enforced on both sides**,
configured in `backend/pyproject.toml` (`[tool.coverage.report] fail_under`)". `CLAUDE.md` repeats
it.

**Code.** `tools/audit_coverage.py:85-87`:
```
totals[0] += summary["covered_lines"] + summary["covered_branches"]
totals[1] += summary["num_statements"] + summary["num_branches"]
```
and `:53-54`: `percentage = covered / measurable * 100; if percentage < BAR:` — one blended ratio
against one bar. `backend/pyproject.toml:88-90` sets a single `fail_under = 85`, and coverage.py's
own total with `branch = true` is the same blend
((executed statements + executed branches) / (statements + branches)).

**Numeric counterexample.** A package with 1,000 statements and 1,000 branch arcs at 100% lines and
80% branches: covered = 1,000 + 800 = 1,800; measurable = 2,000; 90.0% ≥ 85 ⇒ **pass**, with branch
coverage 5 points under its own stated floor. The asymmetry is real in practice because branch
coverage is described in `devplan.md:824` as "the tightest of the four metrics".

**Scope.** No coverage command was run; this is a disproof of the guard's arithmetic, not a claim
about the current numbers. The per-package audit remains valuable — the finding is that it checks
one number where the document promises two.

### BE-39 - effective source priority returns overrides, not the resolved order

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `openapi.yaml:1128-1135`: "The order sources are consulted for this attribute,
highest first: the attribute's own overrides, **then every other source in the global order beneath
them. Resolved on the server so no client reimplements the rule.**" `reqs.md` 6.6 defines the same
resolution and its worked example (`[numbeo, national_statistics]` ⇒
`numbeo > national_statistics > eurostat > llm > manual`).

**Code.** `api/catalog.py:225-228`:
`effective_source_priority=tuple(str(override.data_source) for override in
attribute.source_priority_overrides)` — overrides only. This single `_attribute_body` serves both
`GET /attributes` (`:189`) and `GET /attributes/{id}` (`:340`), so both presenters are affected.
The correct resolver exists and is unused here: `data/attribute.py:278-284`
`effective_source_priority(sources) -> SourcePriority`, whose `.ordered` is what the active-value
rule ranks on.

**Proof.** `country.forest_cover` has no `attribute_source_priority` row, so the field serves `[]`
although the World Bank adapter answers it at its global rank —
and UI-32 then reports it as "Nobody would be asked". `country.economic_outlook`'s override is
`[imf, european_commission, world_bank]`; the response omits `manual`, `llm` and every other
source that would still be consulted beneath them, so a client cannot see the tail the contract
promises. `ui/src/mocks/fixtures.ts:610-683` encodes the truncated shape, which is why the
interface's tests agree with it.

### ST-01 - concurrent starts can create multiple running acquisitions

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Authority.** `reqs.md` 10 (one household, one machine) is what
`execution.py:443-456` (`RunAlreadyInFlightError`) and `sweep_abandoned_runs` both rely on:
"a run in flight when nothing is running it is a run whose process died."

**Code.** `api/runs.py:243-248` reads `in_flight = await runs.run_in_flight()` in one connection;
`storage/run_store.py:41-67` (`start_run`) opens a **separate** `acquire(self._pool)` block and
inserts. `storage/queries/runs.sql:19-25` is a bare `INSERT … RETURNING id`; `:274-288`
(`select_run_in_flight`) is a bare `SELECT … WHERE run_status = 'running' … LIMIT 1` with no
`FOR UPDATE`. `0004-data-acquisition.sql:5-23` declares `data_acquisition_run` with a surrogate PK
and `run_status text NOT NULL`; there is **no** partial unique index
(`CREATE UNIQUE INDEX … WHERE run_status = 'running'`), and `0012-indexes.sql:16-20` adds only two
non-unique indexes on `value` and `data_acquisition_failure`.

**Interleaving.** T1 `SELECT run_in_flight` → none. T2 `SELECT run_in_flight` → none (READ
COMMITTED; T1 has not inserted yet, and even after it does, T2's uncommitted-row visibility rules
would hide it). T1 `INSERT` + commit. T2 `INSERT` + commit. Two rows now hold `run_status =
'running'`. Both background tasks fetch, both write values stamped with different run ids, and for
a paid source both bill against **independent** `CostMeter`s, so the effective ceiling is 2 × cap —
which is precisely the €2.70 double-run incident the guard was written for.

**Reachability.** Two browser tabs, a double-click that beats the disable, or the retry endpoint
(BE-12), which omits the check entirely.

**Note.** The storage suite creating two running runs sequentially is consistent with the schema
permitting it; it is a symptom of the missing constraint, not an argument against the finding.

### ST-02 - whole-set replacement loses concurrent decisions

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** The read and the write are separate transactions by construction. `api/criteria.py`
endpoints do `current = await criteria.read_criteria_set(id)` (one `acquire` block,
`storage/criteria_store.py:58-68`), mutate the frozen domain object, then
`await criteria.replace_criteria_set(changed)` (a second `acquire` block, `:90-112`), whose body is
`delete_criteria_set_contents` + `_write_contents`
(`storage/queries/criteria.sql:242-294`). There is no version column, no `SELECT … FOR UPDATE`, and
no advisory lock anywhere in `criteria_store.py`.

**Interleaving.** T1 `GET` the set (gates: `{visa}`; housing weight 25). T2 `GET` the same set. T2
`PUT …/match-rules/ch_eu_efta_quota {is_enforced:true}` → writes `{visa, ch_eu_efta_quota}`. T1
`PATCH …/criteria/country.housing_price_level {weight:40}` → its in-memory object still carries
`enforced_match_rules = {visa}`, so `_write_contents` clears both association tables and writes
back only `visa`. T2's gate decision is gone, the database is perfectly consistent, and nothing
reports it. The same loss applies to pillar weights, criterion flags and thresholds, because the
replacement is whole.

**Aggravating factor.** The sparse rule model (`CLAUDE.md`, `0496`'s lesson) means "off" is the
absence of a row, so a lost enable is indistinguishable from a deliberate disable afterwards.

**Why the in-transaction lock is insufficient.** Locking only `replace_criteria_set` serialises the
writes but not the read-modify-write; the stale object is already in memory when the lock is taken.

### ST-03 - career retirement invalidates user-created and edited profiles

**Verdict:** REAL — **Severity (original):** High — **Confidence:** High

**Code.** `0487-career-is-measured-by-the-workforce-that-exists.sql:33-43`:
```
UPDATE criterion SET weight = 63.33 WHERE criteria_set='local_employment' AND attribute='country.tech_employment_share';
UPDATE criterion SET weight = 52.63 WHERE criteria_set='remote_only'      AND attribute='country.tech_employment_share';
DELETE FROM criterion WHERE attribute IN ('country.tech_software_jobs','country.tech_product_jobs');
```
The two `UPDATE`s name sets; the `DELETE` does not.
`0477-career-weights-sum-exactly.sql:21-27` establishes the `local_employment` career pillar as
`tech_product_jobs 24.45`, `tech_software_jobs 24.44`, `international_employers 20.00`,
`average_working_hours 16.67`, `tech_employment_share 14.44`.
`criteria/criteria_set.py:161-184` (`_reject_weights_that_do_not_sum`) refuses any set whose
criteria under a pillar do not sum to exactly `Decimal(100)` — and `0477`'s own header records
that `Decimal` compares exactly where SQL guards round.

**Numeric proof.** A user duplicates `local_employment` (the `duplicateCriteriaSet` endpoint and
`duplicate_criteria_set` SQL copy every criterion by SELECT). `0487` then deletes the two posting
criteria **from the copy as well** and raises nothing in it, leaving
`14.44 + 20.00 + 16.67 = 51.11`. Every subsequent read of that set raises
`CriteriaSetError("the criteria under career at level country … sum to 51.11, not 100")` → 422
`invalid_criteria_set`. The set cannot be ranked, edited or repaired through the API, because every
write path begins with a read.

**Edited defaults are also exposed.** The two `UPDATE`s set absolute literals, so a household that
had already moved `tech_employment_share` (a one-drag action) has its choice overwritten by
63.33/52.63 rather than having the retired weight transferred.

**Status.** Correctly labelled a populated-upgrade hazard; whether the live database holds such a
duplicate was not inspected.

### ST-04 - default normalisation migrations overwrite choices or block upgrade

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** Four unqualified statements:
`0489-coastline…:59-60` `UPDATE criterion SET normalisation_method='percentile' WHERE attribute='country.coastline_access';`
`0490-elevation…:54-55` the same for `country.elevation_range`;
`0491-forest-cover…:22-23` the same for `country.forest_cover`;
`0495-projected-heat…:16-19` the same for `country.projected_summer_heat_days`, narrowed only by
`AND normalisation_method = 'fixed'`. None filters on `criteria_set`.
`0468-a-band-needs-the-method-that-can-draw-it.sql:22` adds
`CHECK (goal <> 'target_range' OR normalisation_method = 'fixed')` to `criterion`.

**Proof (blocked upgrade).** A user's set declares `country.coastline_access` as
`goal='target_range'` with a band — a legal, API-reachable configuration
(`criterion.py:200-216` requires only that the method be `fixed`, which it is). `0489`'s `UPDATE`
flips it to `percentile`, violating `criterion_a_band_needs_a_fixed_scale`; the statement aborts
and, inside yoyo's transaction, the migration fails and the upgrade stops. `0495`'s extra
`AND normalisation_method = 'fixed'` does not help, because a `target_range` criterion is
*necessarily* `fixed` and therefore still matches.

**Proof (silent supersession).** A user who chose `fixed` with deliberate anchors for
`country.forest_cover` keeps the anchors (nothing deletes `criterion_scale_anchor`) but the method
becomes `percentile`, so `_on_the_anchored_scale` is never called and the anchors stop having any
effect — with no record that a choice was overridden.

**Status.** Populated-upgrade hazard; the fresh-seed arithmetic each migration guards is unaffected.

### ST-05 - type-correction upgrades cannot delete criteria with child interpretations

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `0478-school-quality-is-a-quantity.sql:38-68` and
`0492-child-benefit-is-a-share-of-the-wage.sql:26-55` both: `CREATE TEMP TABLE lifted AS SELECT
criteria_set, attribute, pillar, is_scored, weight, weight_locked, goal, target_range_*,
zero_score_*, blocks_if_missing, breakdown_option, reducer_mode FROM criterion WHERE attribute = …;`
then `DELETE FROM criterion WHERE attribute = …;` then re-insert. The capture list contains **no**
anchors and **no** threshold.
`0009-criteria.sql:108-114` `criterion_scale_anchor.criterion REFERENCES criterion (id)` and
`:117-197` the four `criterion_threshold_*` tables likewise, all without `ON DELETE`.

**Proof (blocked).** A user sets a `RangeThreshold(min_value=450)` on
`country.school_system_quality`, or two scale anchors. `0478`'s `DELETE FROM criterion` then
violates `criterion_threshold_range_agrees_with_criterion` / `criterion_scale_anchor_…_fkey`; the
migration aborts and the upgrade cannot proceed. `0492` is identical in shape, and its header's
reassurance addresses only `value_matches_attribute_type` ("The attribute has no stored values yet
(0 of 32)"), not the criterion's children.

**Proof (the alternative is worse).** Had the FKs cascaded, the delete would silently erase anchors
expressed in the *old* unit (a Monetary child-benefit band in euros) and the re-insert would carry
no trace — preferences destroyed with no record. Retire-and-recreate is the shape the catalog
already uses for `crime_safety_index` (`0442`) and `income_tax_effective` (`0445`).

**Tests.** `test_migration_hygiene` checks `depends:` lines, rollbacks and predecessors; it does not
populate an upgrade database with user interpretations.

### ST-06 - housing replacement resets inclusion and lock choices

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `0488-housing-is-priced-by-what-it-costs-to-live-in.sql:64-71`:
```
INSERT INTO criterion (criteria_set, attribute, value_type, pillar, weight, goal,
                       normalisation_method, is_scored, weight_locked, blocks_if_missing)
SELECT retiring.criteria_set, 'country.housing_price_level', 'Quantity', 'housing',
       retiring.weight, 'minimise', 'percentile', true, false, false
FROM   criterion AS retiring
WHERE  retiring.attribute = 'country.house_price_to_income_ratio';
```
`weight` is read from the row (the migration's comment explains why), and **`is_scored`,
`weight_locked` and `blocks_if_missing` are literals**.

**Proof.** A household that had excluded `country.house_price_to_income_ratio`
(`is_scored = false`) and locked its weight finds the replacement **included** and **unlocked**.
Inclusion changes the score: `_criteria_to_score` now admits it, `_level_wide_weights`
renormalises differently, and the ranking moves — in a profile the user never touched, with no
record of why. The unlock also changes who absorbs the next rebalance.

**Note.** `goal` and `normalisation_method` are necessarily new for a new attribute, so hardcoding
those is defensible; the two flags are decisions about *this user's* set, which the migration had
in hand and discarded.

### ST-07 - saved interpretation and rule evidence are incompletely frozen

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `reqs.md` **Q193**: "**A saved evaluation freezes the interpretation too** — target
range, reducer, breakdown option and the anchors", because otherwise "every evaluation saved before
that revision would show scores its own drill-down could no longer reproduce". `reqs.md` 5.3
requires each warning to be stored so "a saved result must read the same later".

**Code and proof, four sub-claims.**
1. **Locks and thresholds unfrozen.** `0010-evaluation.sql:34-79` declares `evaluation_criterion`
   with `is_scored, weight, pillar_weight, goal, target_range_*, zero_score_*,
   normalisation_method, breakdown_option, reducer_mode, blocks_if_missing` — no `weight_locked`
   and no threshold child. `storage/evaluation_store.py:359-382` (`_frozen`) writes the same set.
   Verified.
2. **Reducer/breakdown written but omitted on read.** `_frozen` (`:376-377`) writes both;
   `storage/queries/evaluation.sql:249-251` selects both; `evaluation_store._criterion_from`
   (`:359-382`) constructs `Criterion(...)` **without** `breakdown_option` or `reducer_mode`, so
   both default to `None`. A reopened evaluation of a broken-down attribute therefore cannot say
   which option produced the number — the exact thing Q193 lists first. Verified.
3. **Rule evidence is text.** `0010-evaluation.sql:143-164`: `non_match_reason.reason_detail text`
   and `candidate_warning.detail text`. `evaluation/ranking.py:306-326` (`_detail`) renders the
   magnitudes into prose; no `value` id is stored for a rule's inputs, and `used_value`
   (`:517-531`) pins only *scored* criteria. Verified.
4. **The worked scenario.** Exclude `country.projected_summer_heat_days` from scoring while
   `mild_now_brutal_later` still reads it (`_magnitudes_of` is deliberately wider than the scored
   set, `ranking.py:277-290`), save, then acquire a newer figure. The warning's stored text names
   the old magnitude; nothing identifies which `value` row it was, and the active value has since
   changed — so the chain from the warning to a source and a date cannot be reopened. Verified.

**Tests.** The snapshot tests assert selected fields rather than full interpretation equality; the
strengthening of `test_it_agrees_with_the_saved_evaluation` recorded in `CLAUDE.md` compared the
live and saved results, not the frozen criteria.

### ST-08 - historical snapshots read live types after same-ID retyping

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Code.** `storage/queries/evaluation.sql:236-264`:
```
SELECT ec.attribute, a.value_type, ec.pillar, …
FROM evaluation_criterion AS ec JOIN attribute AS a ON a.id = ec.attribute
```
with the in-file justification "The attribute's type is not frozen and does not need to be: a value
type is immutable for an attribute (arch.md 3.3b), and **retyping one means retiring it and adding
another**."

**Counterevidence to that assumption.**
`0478-school-quality-is-a-quantity.sql:46-49` `UPDATE attribute SET value_type='Quantity' … WHERE
id='country.school_system_quality';`
`0492-child-benefit-is-a-share-of-the-wage.sql:34-37` the same for
`country.child_benefit_policy`.
Both mutate `value_type` **in place, under the same id** — the precise operation the query's
invariant forbids.

**Proof.** An evaluation saved before `0492` froze `country.child_benefit_policy`'s
interpretation while the attribute was `Monetary`. After `0492`, `read_criteria`
(`evaluation_store.py:197-214`) builds `Criterion(value_type=ValueType('Quantity'), …)` from
today's row beside yesterday's goal, anchors and bounds. A `Monetary` anchor set
("€200 → 100") is reported as a Quantity scale in `pct_of_average_wage`. Stored totals are not
recomputed — the report is explicit about that — but the drill-down that is supposed to explain
them now describes a different quantity.

**Status.** Populated-upgrade hazard; whether any evaluation predating `0478`/`0492` exists in the
live database was not inspected.

### ST-09 - successful transcribed rereads are reported unanswered

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** **Q230**: "The retrieval date is the day the table was read, because a run
re-copying an unchanged file has not looked at the publisher again." **Q217** defines
`items_unanswered` as the pairs that produced neither a value nor a failure, and offers a re-ask
for them.

**Code.** `published_tables/adapter.py:73-77` builds
`Measurements(retrieved=datetime.combine(self._table.transcribed_on, time(), tzinfo=UTC))` — a
**fixed** instant — and `:93-104` returns figures stamped with it.
`storage/queries/values.sql:245-253` `insert_value … ON CONFLICT ON CONSTRAINT value_natural_key DO
NOTHING RETURNING id`, where the natural key includes `retrieval_date`
(`0005-values.sql:38-50`); `:264-272` the rejected twin. A no-op returns no row, so
`data_acquisition/run.py:111-122` appends nothing and records no failure.
`storage/queries/runs.sql:172-203` computes `items_completed` as
`count(DISTINCT (v.candidate, v.attribute)) … WHERE v.data_acquisition_run = r.id` and
`items_unanswered` as the scope pairs with **no value row for this run** and no failure row;
`:217-239` lists them.

**Proof.** Run 1 reads `rsf_press_freedom.csv` and stores 32 rows stamped with the transcription
date. Run 2 reads the same file: the natural key matches exactly, `DO NOTHING`, no row carries run
2's id, no failure is recorded. Run 2 therefore reports 32 `items_unanswered` for
`country.press_freedom` and offers "Retry 32 unanswered", although RSF answered with evidence the
database already holds. The report's own qualification — "'Zero new rows' is accurate; 'nobody
answered' is not" — is the right distinction: the idempotence is deliberate, the run accounting is
the defect.

### ST-10 - external-score reads do not select a current edition

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Status check.** `known-issues.md:494-498`: "**Re-fetching an external score stores a second row
and both are served**, while `append_external_score` claims a current edition is derived. Nothing
derives it."

**Code.** `storage/queries/values.sql:339-356` (`select_external_scores`) applies only
`WHERE (:candidate IS NULL OR …) AND (:level IS NULL OR …)` and
`ORDER BY e.candidate, e.data_source, e.reference_period_start DESC`. There is no `DISTINCT ON`,
no current flag, and the tiebreaker chain stops at the period **start**, so two editions sharing a
January start are ordered non-deterministically.

**Proof.** With a 2021 and a 2026 Numbeo edition stored, `GET /external-scores` returns both;
`CandidateDetail` renders both as peers (and, per UI-20, without their dates). The design's
"other people's opinions, shown beside the score" becomes two contradictory opinions with no stated
currency. Latent until a second edition exists, which is exactly what re-fetching produces.

### ST-11 - one run poll combines different database snapshots

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `storage/run_store.py:132-155` (`read_run`) issues four statements —
`select_run`, `select_run_failures`, `select_run_unanswered`, `select_run_by_source` — inside one
`acquire(self._pool)` block. `storage/connections.py:44-53` yields
`pool.connection()` with no `isolation_level`/`read_only` configuration, and a grep for
`isolation` in `backend/src/starnest` finds none, so the server default **READ COMMITTED** applies:
each statement takes a fresh snapshot.

**Proof.** Poll `GET /data-acquisition-runs/{id}` while the run is writing. `select_run` computes
`items_unanswered = 4` at t1; a value row for one of those pairs commits at t2; `select_run_unanswered`
at t3 returns 3 rows — or, at the boundary, `items_unanswered = 1` with an **empty** list.
`ProgressBody`'s stated invariant (the three counts sum to `items_total`) and the list it is meant
to explain disagree inside one response, so the screen's remedy card can offer "Retry 1 unanswered"
with nothing to show.

**Remedy shape.** A single statement, or `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ
ONLY` for the block.

### ST-12 - run-linked evidence is not constrained to planned scope or level

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `0005-values.sql:7-18`: `value.candidate REFERENCES candidate (id)`,
`value.attribute` (via the composite type key) and
`value.data_acquisition_run REFERENCES data_acquisition_run (id)` — three **independent** keys, with
nothing tying the triple to `data_acquisition_run_candidate` / `data_acquisition_run_attribute`
(`0004-data-acquisition.sql:32-58`) and no level pin anywhere (contrast
`0108`'s `candidate_result_ranks_a_candidate_at_that_level`).
`storage/queries/runs.sql:172-203` computes `items_completed` over `value … WHERE
v.data_acquisition_run = r.id` with no scope membership test.

**Proof.** Scope = {Germany} × {forest_cover} (1 planned item). Insert one value row for
(France, coastline_access, run) — individually valid against all three FKs, out of scope.
`items_total = 1`, `items_completed = 1` (the France row counts), `items_failed = 0`, and
`items_unanswered = 1` (Germany/forest_cover has no value row). The partition Q217 closed now sums
to 2 of 1. A city-level value can likewise be attached to a country-level run.

**Reachability.** Not through the application: `open_run` derives the scope from the same lists it
passes to `acquire`, and adapters answer only the candidates handed to them. This is a promised DB
invariant with no enforcement, activated by direct SQL or a future writer — which is how the report
labels it.

### ST-13 - saved contribution evidence can name the wrong measurement

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `0010-evaluation.sql:125-138`:
```
CREATE TABLE candidate_attribute_score (
    candidate_result bigint NOT NULL REFERENCES candidate_result (id),
    attribute        text   NOT NULL REFERENCES attribute (id),
    used_value       bigint REFERENCES value (id), …
```
`used_value` is a bare FK to `value`; `attribute` points at the **live** catalog, not at
`evaluation_criterion`. `0107`/`0108` added composite pins to `candidate_result`,
`non_match_reason` and the scale, and `known-issues.md:494-496` records the omission:
"`candidate_attribute_score` has no foreign key to it".
`storage/queries/evaluation.sql:353-358` reads it with
`LEFT JOIN evaluation_criterion AS ec ON ec.evaluation = r.evaluation AND ec.attribute = s.attribute`
and `LEFT JOIN value AS used ON used.id = s.used_value`.

**Proof (wrong evidence).** A row for Portugal's result naming attribute
`country.total_tax_rate_effective` with `used_value` = the id of a **Romania**
`country.housing_price_level` value satisfies every constraint. Reopening the saved evaluation then
shows Portugal's tax contribution justified by Romania's housing figure, with that figure's real
source, dates and citations attached — the provenance chain the snapshot exists to close, pointing
at the wrong measurement.

**Proof (reopening failure).** Because `attribute` is unconstrained against the snapshot, a score
row for an attribute with no `evaluation_criterion` leaves `ec.pillar` NULL;
`evaluation_store._attribute_score_from` builds `PillarId(row.pillar)` from `None` and raises, so
`GET /evaluations/{id}/candidates/{c}` fails rather than degrading.

### ST-14 - frozen criteria are not pinned to evaluation level

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Status check.** `known-issues.md:494-496`, verbatim: "**`evaluation_criterion` is the one
evaluation child `0108` did not pin to its level**… Both unreachable today."

**Code.** `0010-evaluation.sql:34-54`: `evaluation_criterion.attribute text NOT NULL REFERENCES
attribute (id)` — no level column, no composite key against `evaluation (id, level)`, although
`0108-results-belong-to-their-evaluation.sql:33-48` created `evaluation_level_key UNIQUE (id,
level)` for exactly this purpose and used it on `candidate_result`.
`storage/evaluation_store.py:88-95` writes the snapshot from whatever `CriteriaSet` it is given;
`save` takes `level` separately and never cross-checks the criteria against it.

**Proof.** `insert_evaluation_criteria(evaluation=E(level='city'), criteria=[… 'country.forest_cover' …])`
is accepted. The snapshot then claims a city evaluation was computed from country criteria, while
`candidate_result` is correctly constrained to city candidates — an internally contradictory saved
record. A multi-level set can be frozen wholesale with no narrowing.

**Scope.** Generic integrity, latent at one level; explicitly not a demand to implement cities.

### ST-15 - accepted payload completeness and composition totals are not enforced

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `0005-values.sql:34-37` pins `(id, value_type)` so a payload child cannot be of the wrong
family, and `0006-value-payloads.sql:104-115` keys `value_sharecomp` on `(value_id, label)` with
`share` between 0 and 100 **per row**. Nothing requires an accepted parent to *have* a child;
nothing requires `value_labelset` to hold ≥ 1 row; nothing sums
`value_sharecomp.share` to 100 (no deferred constraint, no trigger).
The domain says otherwise: `data/value.py:115-130` refuses a value with neither payload nor
rejection reason, and `payloads.ShareComposition` validates the sum.
`storage/value_store.py:401-430` (`_payload_from`/`_holds_nothing`) reads a parent with no child
back as `payload=None`.

**Proof.** Insert an accepted `Ratio` parent with no `value_ratio` row.
`storage/queries/runs.sql:174-176` counts it in `items_completed`, so the run reports the item
answered. The first domain read — `read_values`, `read_active_values`, the ranking — constructs
`Value(payload=None, rejection_reason=None)` and raises `MalformedValueError`, so `GET /values` and
`GET /rankings` fail for that candidate rather than degrading. A `ShareComposition` totalling 80
passes every CHECK and fails the same way on read.

**Scope.** Correctly qualified: this is not a claim that displayed scoring coverage is dishonest —
the domain refuses before coverage is computed. It is a promised DB invariant absent from the DB.

### ST-16 - SQL finite checks permit numeric infinity

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `0006-value-payloads.sql:29-30`
`CONSTRAINT value_monetary_amount_is_finite CHECK (amount <> 'NaN'::numeric)` and
`value_monetary_eur_is_finite` likewise; `:47`
`CONSTRAINT value_quantity_magnitude_is_finite CHECK (magnitude <> 'NaN'::numeric)`.
`compose.yaml:19` runs `postgres:17-alpine`; PostgreSQL has accepted `Infinity`/`-Infinity` for
`numeric` since 14.

**Proof.** `INSERT INTO value_quantity (value_id, value_type, magnitude, unit) VALUES (…,
'Quantity', 'Infinity', 'years')` satisfies the CHECK whose name promises finiteness. The domain's
own guard is the other layer — `payloads.Quantity.magnitude = Field(allow_inf_nan=False)` — so the
row is refused on *read*, not prevented on *write*, and in the meantime
`figure_of`-adjacent SQL (`active_value`, ordering, the run counts) treats the row as real
evidence.

**Scope.** Latent SQL-ingestion gap; the constraint's name is the specific thing that is false.

### ST-17 - multiple share thresholds collapse silently to the first

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `0009-criteria.sql:175-197`: `criterion_threshold_share` is keyed
`PRIMARY KEY (criterion, label)`, so **several labels per criterion are permitted** — unlike
`criterion_threshold_range`/`_boolean`, which are keyed on `criterion` alone.
`storage/queries/criteria.sql:94-102` aggregates them into a JSON array.
`storage/criteria_store.py:360-365`:
```
if entry["threshold_shares"]:
    share = entry["threshold_shares"][0]
    return ShareThreshold(label=share["label"], …)
```
— index zero, silently. The neighbouring label branch (`:347-357`) does the opposite and **raises**
when `len(labels) > 1`, with a comment explaining why.

**Proof.** Two rows (`catholic ≥ 10`, `muslim ≤ 30`) are legal in SQL. The read returns only the
first; the domain object now represents one bound. The next edit of the set calls
`replace_criteria_set` → `delete_criteria_set_contents`
(`storage/queries/criteria.sql:242-294` clears `criterion_threshold_share`) → `_write_threshold`
writes the single surviving shape. The second bound is **permanently deleted** by an unrelated
weight change, with no error at any point.

**Reachability.** Not through HTTP: `api/criteria.py:209-217` constructs exactly one
`ShareThreshold`. Direct SQL or a future writer activates it, as the report says.

### ST-18 - conversion provenance is omitted by storage and API

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Authority.** `reqs.md` 5.5: the exchange rate is "a row in its own right, carrying the currency
pair, the date, the rate and **the source that published it**… The rate is data, not an
implementation detail." `openapi.yaml:1062-1068` declares
`FxRate {rate, rate_date, data_source}`, all required.

**Code.** `storage/queries/values.sql:49-53` and `:153-157` build the Monetary payload as
`jsonb_build_object('amount', …, 'currency', …, 'amount_eur', …, 'fx_rate', monetary.fx_rate,
'fx_rate_date', monetary.fx_rate_date)` — **no publisher column**, although
`0112` added the internal FK to the published rate.
`storage/value_store.py:307-318` maps exactly those keys.
`api/values.py:204-207` then removes even the two scalars:
`exclude = {"value_type"} | ({"fx_rate", "fx_rate_date"} if isinstance(payload, Monetary) else set())`,
with a docstring saying so and citing P10.

**Proof.** No client can display the rate, its date or its publisher for any Monetary value; the
nested `FxRate` the contract requires is never served and never assembled. `known-issues.md`
records P10 as open, and the report folds backend finding BE-35 (the API-side exclusion) into this
one, preserving its evidence — which is the correct consolidation, since the two halves are one
gap.

**Scope.** No country-level Monetary attribute currently has a non-EUR source, so nothing is
presently mis-displayed; the obligation is unmet in code.

### ST-19 - attribute-removing rollbacks ignore persistent run references

**Verdict:** REAL — **Severity (original):** Low — **Confidence:** High

**Code.** `0488-housing-is-priced-by-what-it-costs-to-live-in.rollback.sql:40-47` deletes
`value_citation`, `value_quantity`, `value` and then `DELETE FROM attribute WHERE id =
'country.housing_price_level';`. `0470-european-air-connectivity.rollback.sql:26-35` does the same
for `country.european_air_connectivity`, additionally clearing
`attribute_source_priority` and `attribute_allowed_range`. Neither touches
`data_acquisition_run_attribute` or `data_acquisition_failure`, both of which carry
`attribute text NOT NULL REFERENCES attribute (id)` with no `ON DELETE`
(`0004-data-acquisition.sql:40-45,49-58`).

**Proof.** Every ordinary run at the relevant schema version expands its scope into
`data_acquisition_run_attribute` (`storage/run_store.py:52-66`), so after a single acquisition the
attribute is referenced. The rollback's final `DELETE FROM attribute` then raises
`ForeignKeyViolation`; yoyo rolls the transaction back, so **nothing is corrupted** — the finding is
that the documented recovery operation is unusable in exactly the populated state it exists for,
and the failure surfaces as a raw constraint name rather than a preflight refusal. The rollbacks'
own comments show the authors reasoning about `value`'s eleven dependants and about
`candidate_attribute_score.used_value`; the run-scope tables were not considered.

**Tests.** `test_migration_hygiene` checks that a rollback exists and is well-formed, not that it
runs against a database with run history.

### ST-20 - container migrations bypass the required backup

**Verdict:** REAL — **Severity (original):** Medium — **Confidence:** High

**Authority.** `arch.md:1093-1101` (7.4) requires migrations to be an explicit command preceded by
a backup, because hand-entered values cannot be re-fetched at any price; `Makefile:70-72` restates
it in a comment: "Back up first: manually entered values cannot be re-fetched at any price
(arch.md 9.5)."

**Code.** `Makefile:73-74` `migrate: backup` then `yoyo apply …` — the dependency is real, and
`backup` (`:79-81`) runs `docker compose --profile tools run --rm backup`.
`Makefile:180-181` `docker-migrate: docker compose --profile tools run --rm migrate` — **no
prerequisite**. `compose.yaml:132-135` shows the `migrate` service's command is bare
`yoyo apply --batch --database … /app/storage/migrations`, with no `pg_dump` anywhere in it.

**Proof.** The documented container workflow is `make docker-build` → `make docker-migrate` →
`make docker-up` (`CLAUDE.md`'s command table says "Migrate first"), so the ordinary container path
applies schema **and catalog** changes — including the destructive ones in ST-03 to ST-06 and the
irreversible ones in ST-19 — with no backup taken. `docker compose run migrate` used directly has
the same gap and is documented nowhere as needing a backup first.

**Scope.** Operational/tooling; no migration or backup was executed in the course of this review.

---

## Totals and disagreements

**Verdict totals:** REAL 91 · UNREAL 0 · UNCERTAIN 0 (91 unique IDs; `BE-35` intentionally absent).

**By area:** UI 33 REAL · Backend 38 REAL · Storage 20 REAL.

**Severity disagreements (recorded, not applied).** The severity cells above are the source
report's. I would argue two of them differently and have left both unchanged:
- **BE-02 (High)** understates if anything: silent reordering of a ranking is the single failure
  `reqs.md` 10 names as the one the product exists to prevent, and the error is deterministic
  rather than conditional.
- **UI-22 (Low)** is correctly Low, but the phrase "explicit implementation choice" should not be
  read as an approval: no decision in `reqs.md`, `arch.md` or Appendix B sanctions deciding factual
  equality on rounded presentation.
- **BE-36 (Medium)** is partly a policy question; see its section. I would keep the severity and
  narrow the claim to the missing expiry/re-research path.

**Characterisations I would tighten (without changing the verdict).**
- **BE-39** says "Both attribute presenters"; there is one presenter, `_attribute_body`, reached by
  two routes (`api/catalog.py:189` and `:340`). The substance is unaffected.
- **BE-33** correctly refines `known-issues.md` P36's "written when the run ends" to "persisted
  after a source returns"; the older note is the stale one.
- **UI-04**'s third sub-claim (automatic run opening overwriting a deliberate selection) is real but
  materially narrower than the first two; it is the only part of that finding I hold at Medium
  confidence.
- **UI-23** is a disagreement between the browser suite and current markup, not a product defect;
  the report says so, and the distinction should survive into any remediation plan.

## Limitations of this verification

1. **Nothing was executed.** No statement here asserts that any test passes or fails, that any
   coverage figure is above or below a floor, that any migration applies, or that any adapter
   reaches a publisher. Where a test is cited, only its asserted content was read.
2. **The live database was not inspected.** Every populated-upgrade hazard (ST-03 to ST-06,
   ST-08, ST-19) is verified as a mechanism against the migration text, not as present damage.
   Whether a user-created criteria set, a configured threshold, a periodised gate answer or a
   pre-`0478` saved evaluation exists today is unknown.
3. **Runtime premises named per finding.** UI-05 depends on browser compatibility-event
   synthesis; UI-01 on real research latency against a 60 s proxy read timeout; BE-20 and BE-26 on
   Open-Meteo emitting a malformed or truncated series; BE-10's stale-meter half on adapter
   instance reuse across runs (established statically from `main.py`/`app.state`, not observed).
4. **Concurrency findings are reasoned from isolation semantics**, not reproduced: ST-01, ST-02 and
   ST-11 assume psycopg3's default (no `isolation_level` is set anywhere in
   `backend/src/starnest`) and PostgreSQL's READ COMMITTED behaviour.
5. **Publisher accuracy and fixture contents were not audited**, including the vendored OpenFlights
   route graph and the binary/network fixtures.
6. **Cross-layer confirmations in the source report were re-derived independently** rather than
   accepted; where a citation was loose it is noted in the finding.



