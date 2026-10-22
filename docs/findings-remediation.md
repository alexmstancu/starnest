# Findings remediation — independent verification and fix plan

**Date:** 2026-10-13 (verification) · **last updated 2026-10-21** (session close)
**Baseline:** HEAD `7182d37`
**Scope:** the 91 findings in [`copilot-review.md`](copilot-review.md) (UI 33, Backend 38, Storage 20).

> **2026-10-21 — my (larger-findings) lane is complete.** This document is authoritative for the
> findings I own; the `fix_status` column is a point-in-time snapshot and is **stale for the other
> agent's UI/NEW lane** — many rows still reading `wave-N` below have since landed in commits (see
> `git log`), and [`findings-review-comparison.md`](findings-review-comparison.md) (owned by the
> other agent) is the live cross-cutting status. I did not re-flip those rows here, to avoid
> intersecting the other agent's bookkeeping.
>
> Shipped by me this session (all TDD, `make check` green, pushed): **ST-02** `5358c3c`, **BE-19**
> `d7a1263`, **ST-09** `608919f`, **ST-07 remainder** `bf47645`, **BE-07** `4188571`, **BE-11 +
> NEW-48** `27add01`, **BE-31** `a9d7929`, **BE-33** `a7a2fa8`. Earlier clusters: validation,
> weather, presenter, ST-07/08 (`bf2145e`, `25c83b9`, `f30c661`, `c943761`).
>
> **2026-10-21 — cross-review (GPT-6 Astra + Grok 4.7) of `a7a2fa8`.** FIXED confirmed: **BE-31,
> BE-33, NEW-48**. **Downgraded to PARTIAL: ST-07, BE-07, BE-11, BE-19** — my "done/all green"
> claim was premature; `make check` passed on a throwaway DB that masked a boot regression. Gaps
> below; my `0504` FK is a shipped **boot-breaker** (no `ON DELETE CASCADE`, violates the `0482`
> rule — the boot sweep of test rankings now fails). Reopened for a follow-up pass.
>
> **2026-10-22 — follow-up pass (uncommitted, full `make check` green: 3237 backend / 1577 UI /
> 97.23%).** Closed in response to the cross-review: **the `0504` boot-breaker** (migration `0505`
> adds `ON DELETE CASCADE`, with a boot-sweep test that inserts a real warning-input and so has
> teeth); **BE-19** (failures now written per batch, so a hard kill leaves a retry something to
> reach); **BE-11 fully** (exact `(attribute, candidate)` pairs in both fetch paths, in `ask_again`,
> and a whole-source outage itemised over only the candidates a source was asked; the mixed-retry
> borrow is no longer dropped; migration `0506` `data_acquisition_run_item` makes item accounting
> exact pairs, not the rectangle); **BE-07 `make rank`** (now passes `max_age`, so the script
> downgrades like the screen); and **ST-07 freeze remainder** (`0507`: a `pillar_weight_locked`
> column, `evaluation_match_rule`/`evaluation_compound_rule` tables, a `non_match_input` table and
> an `ordinal` on both input tables — each a frozen child of `evaluation` with `ON DELETE CASCADE`,
> proven by a real-insert boot-sweep test). **Only open item left in my lane:** BE-07's month-end
> calendar precision (a Low deferral — unfixable Python-side without carrying calendar units through
> psycopg's `interval`→`timedelta` mapping, and it would then disagree with `active_value`'s SQL).
>
> Four High/Medium rows below still read `wave-1/2` but are in fact **fixed outside my commits**
> (verified in code 2026-10-21, landed by the other agent's waves): **BE-02** (scores stay
> unrounded until display — `normalisation.py:55-57`), **BE-12** (`run_in_flight()` guard +
> background 202 — `api/runs.py:283-287,395`), **BE-22** (`min_length=1` on rename/duplicate —
> `api/criteria.py:416-456`), **ST-03** (forward migration `0499` rebalances the career pillar the
> `0487` delete unbalanced). Marked `FIXED-ELSEWHERE` in their rows.

## Method

Every prior verdict was treated as a hypothesis. Verification was done **from the code first**:
three read-only area agents (UI, Backend, Storage) each read *only* the allegation in
`copilot-review.md` plus the actual implementation and tests, and were **walled off from the
other reviewers' docs** so their verdicts could not be anchored. The lead then traced the
contested findings (BE-11, BE-13, BE-36, BE-37) directly in the code, and only afterward
challenged the whole set against [`gpt-6-astra-findings-review.md`](gpt-6-astra-findings-review.md),
[`claude-opus-5-findings-review.md`](claude-opus-5-findings-review.md),
[`claude-opus-5-third-review.md`](claude-opus-5-third-review.md) and
[`findings-review-comparison.md`](findings-review-comparison.md). No application code was changed
during verification.

## Independent adjudication

**89 REAL, 2 UNREAL (BE-13, BE-37), 0 UNCERTAIN.** BE-36's behaviour is REAL and is now actionable
under a policy the household set (below).

Divergences worth stating, since the point of an independent pass is the disagreements:

- **BE-37 → UNREAL (my one substantive disagreement with the prior adjudication, which had it REAL).**
  `main.py:361-387` documents attribute-level fallback eligibility as the literal reading of
  `reqs.md` 6.10 use 1 ("no dataset covers this" = "no adapter declares it"). The only
  partial-coverage case is `international_air_connectivity` (openflights answers 31/32); the one
  gap, Liechtenstein, **has no airport**, so a candidate-specific fallback would make the LLM
  fabricate a figure for a country with none — worse than the current behaviour. By-design and
  harmless; no present triggering case.
- **BE-13 → UNREAL as a distinct defect (concur with the final adjudication, against my own
  backend sub-agent's REAL).** `ask_again` does pass all enabled adapters unfiltered
  (`execution.py:603-604`), but a free sweep's unanswered attributes are declared by *free*
  adapters, and the LLM fallback set is disjoint (only attributes no adapter declares,
  `main.py:379-383`), so no paid source is reachable. The demonstrated cap-refusal symptom is
  **BE-14**, which stays REAL.
- **BE-11 → REAL, scoped (concur).** `retry_run` builds a global candidate union
  (`execution.py:496-497`) and narrows only attributes per source. Harmless for free
  whole-indicator sources (the docstring's stated rationale), but a per-candidate **paid** LLM
  adapter is re-billed for already-succeeded candidates — contradicting `reqs.md` 6.4.
- **BE-36 → REAL (behaviour), policy now set.** `evaluation/rules.py` applies confirmed gate
  answers without consulting their period; `research.py` excludes every confirmed answer from
  re-research. **Household policy (2026-10-13):** a confirmed answer is **never auto-expired or
  silently overwritten**; add an explicit, user-triggered, non-destructive re-research path and
  surface the answer's period/age so staleness is visible. The fix implements that policy; it
  does not add automatic invalidation.

## Fix plan (waves, per the agreed sequencing)

Each fix is surgical and root-cause, ships a regression test that fails before and passes after,
and preserves historical data, provenance, user configuration and the `arch.md` 6.1/6.2
boundaries. No city/v2.0 functionality. `make check` green per wave. **No commits without
explicit approval.**

- **Wave 1 — High (14):** UI-01, UI-02, UI-03; BE-01, BE-02, BE-10, BE-12, BE-15, BE-17, BE-19,
  BE-21, BE-22; ST-01, ST-03.
- **Wave 2 — Medium (44 REAL):** the Medium findings below, including **BE-36** (policy set). Note
  BE-13 is Medium-UNREAL (no fix).
- **Wave 3 — Low (28 REAL):** the Low findings below. Note BE-37 is Low-UNREAL (no fix).
- **No fix (UNREAL):** BE-13, BE-37 — documented above.

Latent / raw-ingestion-only / known-deferred findings are still fixed where the fix is a cheap
guard (a CHECK, a validator, a narrowed query), but are called out so their priority is honest.

## Verdict tables

`fix_status`: `wave-1/2/3` = scheduled in that wave; `no-fix` = UNREAL; `policy-set` = BE-36.

### UI (UI-01 … UI-33)

| ID | sev | verdict | evidence (file:line) | note | fix_status |
|---|---|---|---|---|---|
| UI-01 | High | REAL | `nginx.conf:27`; `api/rules.py:310-326` | synchronous gate research behind 60s proxy timeout → 504 loses proposals/cost/halt | wave-1 |
| UI-02 | High | REAL | `RunScreen.tsx:144-153,184-193`; `useRunScreen.ts:232-235` | whole-bucket retry skips estimate/confirm and can't signal uncapped acceptance | wave-1 |
| UI-03 | High | REAL | `e2e/gate-c.spec.ts:155-163,483-493` | test overwrites global Greece gate answer against shared DB, erasing provenance | wave-1 |
| UI-04 | Medium | REAL | `useCriteriaEditor.ts:100-128,175-185` | async mutation completions merge set-A response into set-B; out-of-order rebalance | wave-2 |
| UI-05 | Medium | REAL | `PillarWeightsPanel.tsx:245-258,325-328` | pointerUp+mouseUp both commit → duplicate rebalance PUTs | wave-2 |
| UI-06 | Medium | REAL | `useHouseholdForm.ts:42-51`; `useSettingsForm.ts:30-39`; `useManualEntry.ts:64-72` | save completion overwrites/clears edits typed while pending; no submit guard | wave-2 |
| UI-07 | Medium | REAL | `useDataSources.ts:30-48` | interleaved priority writes; partial failure leaves displayed order ≠ storage (no reload) | wave-2 |
| UI-08 | Medium | REAL | `useCriteriaEditor.ts:105-125`; `changeHistory.ts:52-64` | history key omits set id; cross-set undo writes into the wrong set | wave-2 |
| UI-09 | Medium | REAL | `useCriteriaEditor.ts:116-124`; `rebalancing.py:62-76` | single-scalar undo can't recover siblings zeroed then even-split | wave-2 |
| UI-10 | Medium | REAL | `numericInput.ts:30-34`; `settingsForm.ts:154-156`; `client.ts:350` | invalid numeric → NaN → serialized `null` → clears a nullable setting | wave-2 |
| UI-11 | Medium | REAL | `Sidebar.tsx:180-183`; `useShellSummary.ts:42-53` | writes don't invalidate sidebar resources → stale household/counts/last-run | wave-2 |
| UI-12 | Medium | REAL | `ruleEffect.ts:30-47`; `RulesPanel.tsx:87-89` | counts unconfirmed proposals as exclusions; compound rows always "affects nobody" | wave-2 |
| UI-13 | Low | REAL (latent) | `useProposals.ts:93-105` | confirm body omits reference_period; never displayed (latent, P58) | wave-3 |
| UI-14 | Medium | REAL | `useProposals.ts:82-92`; `rules.py:320-326` | research cost/calls/cap-halt discarded; partial pass looks complete | wave-2 |
| UI-15 | Medium | REAL | `CandidateDetail.tsx:373-410`; `attributeScores.ts:32-37` | superseded/rejected rows show active value's score; descriptive rows mislabeled "Scored" | wave-2 |
| UI-16 | Medium | REAL (latent) | `endpoints.ts:287-296`; `CandidateDetail.tsx:167-173` | one 500-value page claimed "every stored value"; append-only can exceed | wave-2 |
| UI-17 | Medium | REAL | `useRunScreen.ts:113-115`; `databaseHolds.ts:57-67` | only 10 runs feed "every acquisition" + monthly spend total | wave-2 |
| UI-18 | Medium | REAL (latent) | `rankTable.ts:95-100,206-228` | clamps pillar score at 100; conditional on score_scale_max≠100 | wave-2 |
| UI-19 | Medium | REAL | `attributeRows.ts:39,88-95`; `openapi.yaml:1864` | raw delta is focus−comparator but presented with comparator−focus semantics (reversed) | wave-2 |
| UI-20 | Medium | REAL | `CandidateDetail.tsx:560-597` | external-score rows omit reference & retrieval dates (reqs 8.4) | wave-2 |
| UI-21 | Medium | REAL | `repeatedValues.ts:38-49` | fingerprint omits quote/citations → distinct evidence folds away | wave-2 |
| UI-22 | Low | REAL | `acquisitionDiff.ts:142-158`; `figure.ts:55-61` | unchanged decided on rounded display strings, not payloads | wave-3 |
| UI-23 | Medium | REAL | `e2e/gate-c.spec.ts:56,391-454`; `CriteriaPanel.tsx:326,353` | e2e selectors expect id labels / "Attribute" header that disagree with product | wave-2 |
| UI-24 | Medium | REAL (debatable) | `AcquiringBar.tsx:23`; `RunScreen.tsx:484,547-556` | Acquire report doesn't poll; stale until manual Refresh (shell polls globally) | wave-2 |
| UI-25 | Low | REAL | `CompareScreen.tsx:147-150,255-257` | cleared focus (`""`) leaves Compare enabled but submit is a no-op | wave-3 |
| UI-26 | Low | REAL | `CandidateField.tsx:96-111,129-131` | keyboard tab into option fires blur timer, removes focused option | wave-3 |
| UI-27 | Medium | REAL | `ManualEntryPanel.tsx:36-55`; `useCandidateNames.ts:76-82` | roster read failure → empty required picker, no error/retry | wave-2 |
| UI-28 | Low | REAL (latent) | `SelectionContext.tsx:94` | empty set list treated as "reload in flight"; retains deleted selection (404) | wave-3 |
| UI-29 | Medium | REAL | `useProposals.ts:93-105`; `RulesPanel.tsx:76-115` | no UI path to independently enter/override/correct a gate answer (only confirm) | wave-2 |
| UI-30 | Low | REAL (latent) | `CandidateDetail.tsx:577-581` | external-score key omits period end; same-start editions collide | wave-3 |
| UI-31 | Low | REAL | `settingsForm.ts:79`; `CompareScreen.tsx:219-220` | blank-state copy says unlimited comparators; backend refuses until set | wave-3 |
| UI-32 | Medium | REAL (latent) | `unsourced.ts:89`; `criterionReading.ts:188-190` | empty effective priority equated with "nobody can answer"; leans on BE-39 | wave-2 |
| UI-33 | Low | REAL (latent) | `RunScreen.tsx:407-409`; `runs.py:190-194` | adapters sharing a publisher → duplicate plan-row keys / conflated counts | wave-3 |

### Backend (BE-01 … BE-39; BE-35 folded into ST-18)

| ID | sev | verdict | evidence (file:line) | note | fix_status |
|---|---|---|---|---|---|
| BE-01 | High | REAL | `evaluation/ranking.py:422-441`; `criteria/criterion.py:166,330-337` | matching_threshold parsed/served but never read in evaluation (0 call sites) | wave-1 |
| BE-02 | High | REAL | `evaluation/normalisation.py:46-97`; `ranking.py:326-365,523` | scores quantized to int before weighting; reqs 5.1 forbids intermediate rounding | FIXED-ELSEWHERE (`normalisation.py:55-57` keeps scores unrounded, caller rounds for display only) |
| BE-03 | Medium | REAL | `evaluation/ranking.py:407-428` | insufficient_data returned before gate/compound eval, hiding definite non-matches | FIXED (prior session: match_status computed as refusals→NOT_MATCHING / insufficient→INSUFFICIENT_DATA / else MATCHING, before the insufficient short-circuit) |
| BE-04 | Medium | REAL | `evaluation/weighting.py:131-146`; `ranking.py:84` | WeightingError unmapped → HTTP 500; zero-weight empty pillar still refused | FIXED (prior session: `_refuse_a_pillar_nothing_scores_into` filters zero-weight pillars; WeightingError wrapped as RankingError→422) |
| BE-05 | Medium | REAL | `criteria/criterion.py:168-177`; `0009-criteria.sql:76-77` | reqs 3.3a legal-scales-per-type unenforced | FIXED (`_reject_a_method_illegal_for_the_value_type` + `_LEGAL_METHODS`; non-normalised types unconstrained) |
| BE-06 | Medium | REAL (latent) | `data/attribute.py:286-317`; `data/payloads.py:189-200` | Quantity payload unit not checked vs declared unit (manual-entry exposed) | FIXED (unit-match check in `rejection_reason_for`; stored-with-reason, non-destructive; unconstrained when no declared unit) |
| BE-07 | Medium | REAL | `data/confidence.py:69-100`; `data/measurements.py:49,83` | derive_confidence has no production caller; stale HIGH stays HIGH | FIXED (core `4188571`; 2026-10-22 `scripts/rank.py` now builds `max_age` from the catalog and passes it, so `make rank` downgrades like the screen. **Low remainder deferred:** the month-end calendar precision (`ranking.py` compares a `timedelta`) cannot be fixed Python-side without carrying calendar units through psycopg's `interval`->`timedelta` mapping and would then disagree with `active_value`'s SQL unless that changed too -- disproportionate to a "few days at month ends" Low) |

| BE-08 | Medium | REAL | `data/measurements.py:90-102`; `data_acquisition/run.py:114-138` | range-rejected figure stored as Value, not a failure; selective retry can't reach it | wave-2 |
| BE-09 | Low | REAL (latent) | `data_sources/who/adapter.py:164-195` | WHO builds Value without rejection_reason_for; credible-range bypass (latent) | wave-3 |
| BE-10 | High | REAL | `execution.py:532-564`; `run.py:84-85,124-125` | retry wrapper never forwarded `meter_with`; fresh/exhausted meter breaks cap on retries | wave-1 |
| BE-11 | Medium | REAL (scoped) | `execution.py:495-520` | retry candidate union re-bills succeeded candidates on a per-candidate paid adapter | FIXED (NEW-48 `27add01` removed the cross-source bleed; 2026-10-22 closed the rest. `_FailedOn` holds exact (attribute, candidate) pairs, narrowed per-attribute in both `fetch` and `fetch_in_batches`, so a paid source is never re-asked a pair it answered; `ask_again` wraps every source to the exact unanswered pairs the same way; a whole-source outage is itemised over only the candidates that source was asked; the mixed source+stand-in retry keeps the borrow (union, not `answerable or borrowable`). Migration `0506` `data_acquisition_run_item` persists the exact pairs (rectangle backfilled for existing runs) and the item-accounting SQL reads from it, so a retry's items_total/unanswered are the real pairs, not phantom corners. 6 new tests, teeth-checked) |

| BE-12 | High | REAL | `api/runs.py:321-387` | retry awaits inline (blocks) yet returns 202; no in-flight guard → concurrent paid passes | FIXED-ELSEWHERE (`run_in_flight()` guard refuses `run_already_in_flight`; retry splits to a background 202 — `api/runs.py:283-287,386-395`) |
| BE-13 | Medium | **UNREAL** | `execution.py:603-604`; `main.py:379-383` | distinct billing defect unreachable (disjoint registry); symptom is BE-14 | no-fix |
| BE-14 | Medium | REAL | `execution.py:185-189,411-427` | an unrelated enabled paid adapter forces a cap on free named-scope work | FIXED (prior commit 218c56a: `_a_paid_source_would_be_asked(adapters, answerable)` -- costs_money reflects the selected scope, not the registry) |
| BE-15 | High | REAL | `api/rules.py:292-319`; `scripts/acquire.py:46-72`; `execution.py:319-325` | disabled sources not honored: paid gate research, CLI fetch, stand-in consultation | wave-1 |
| BE-16 | Medium | REAL | `spend.py:57-59`; `run.py:144-145` | a legal cap=0 is exhausted at zero spend and halts a free sweep after one attribute | FIXED (prior commit 218c56a: `has_spent_to_its_cap` = exhausted AND spent>0; a free sweep under cap=0 is not halted) |
| BE-17 | High | REAL | `data_sources/llm/gates.py:76-81`; `client.py:164-167` | billed empty gate answers lose cost/calls → research cap ineffective on that path | wave-1 |
| BE-18 | Medium | REAL | `data_sources/llm/pricing.py:65-90`; `main.py:436` | negative/NaN/Infinity prices/token estimates pass; cap model compromised | FIXED (`configured()` rejects non-finite/negative prices + non-finite rate, zero allowed; `_the_model` treats non-positive call size as unset) |
| BE-19 | High | REAL (latent) | `llm/employers.py:126-176`; `fallback.py:145-206`; `run.py:87-122` | LLM buffers per-candidate; death mid-candidate loses earlier paid answers | FIXED (per-candidate streaming `d7a1263` made paid answers AND spend survive a mid-sweep death; 2026-10-22 closed the remainder: `acquire` takes a `record_failures` callback and writes each batch's failures durably before the next fetch (`continue_run` passes `runs.record_failures`, keyed on (run,source,item) so the end-of-run write re-confirms rather than duplicates) -- a hard kill now leaves the retry endpoint something to reach) |

| BE-20 | Medium | REAL | `open_meteo/response.py:26`; `execution.py:327-346` | Decimal(str) InvalidOperation escapes source handling → run aborts, item unrecorded | FIXED (`_a_reading` raises `OpenMeteoError` on a non-numeric reading; caught per-candidate as a failure) |
| BE-21 | High | REAL | `api/settings.py:24-74`; `household.py:29-68`; `errors.py:110-135` | request DTOs lack domain bounds → ValidationError → 500; 422 body not uniform | wave-1 |
| BE-22 | High | REAL | `api/criteria.py:387-417`; `criteria/criteria_set.py:94` | rename/duplicate lack min_length; empty name persists then unreadable (500 on read) | FIXED-ELSEWHERE (`min_length=1` on id+name in rename/duplicate bodies — `api/criteria.py:416-456`) |
| BE-23 | Low | REAL | `api/settings.py:24`; `household.py:29`; various bodies | missing `extra="forbid"` → misspelled field clears a setting; null coercions | wave-3 |
| BE-24 | Medium | REAL | `api/runs.py:451-469`; `rules.py:247-256` | unknown scope IDs silently intersected; paid research spends while concealing the drop | FIXED (shared `unknown_scope_refusal`/`absent` in errors.py; `_scope_targets` (runs) + `_research_targets` (rules) refuse all unknowns across both dimensions, 422 `unknown_scope`) |
| BE-25 | Medium | REAL | `api/runs.py:161-203`; `execution.py:142-155,281-287` | plan omits freshness filter execution applies; overstated items/cost or NothingToFetch | wave-2 |
| BE-26 | Medium | REAL (latent) | `open_meteo/response.py:11-27`; `adapter.py:150,166-194` | incomplete/misaligned series averaged and labeled with the full window | FIXED (`daily_series` takes `expected_days`; a short series or a time/readings length mismatch is an `OpenMeteoError`) |
| BE-27 | Low | REAL | `published_tables/table.py:116-147`; `…protected_land.csv:12-15` | unquoted commas in `workings` → DictReader restkey drops provenance text | wave-3 |
| BE-28 | Low | REAL (latent) | `llm/fallback.py:322-325`; `data/payloads.py:337-365` | AssignedScore fallback uses wrong kwarg + omits range → always errors (latent) | wave-3 |
| BE-29 | Low | REAL (latent) | `data_sources/transport.py:85-87`; `eurostat/jsonstat.py:126-145` | JSON decoded via binary float before Decimal → precision loss for long tokens | wave-3 |
| BE-30 | Low | REAL | `llm/employers.py:212-235` | employer elements `str()`-coerced, not validated as non-blank firm names | wave-3 |
| BE-31 | Low | REAL | `comparison/comparison.py:26,200`; `pyproject.toml:183-197` | comparison imports criteria; import-linter layer order permits the forbidden edge | FIXED (test_architecture.py `test_each_policy_module_imports_only_what_the_table_allows`: enforces arch.md 6.1's exact May-import table on DIRECT imports via grimp -- catches a table-forbidden downward edge the layers contract permits, without false-positiving the legitimate transitive reach. import-linter's forbidden is transitive and cannot express exact edges) |

| BE-32 | Low | REAL | `pyproject.toml:58-64`; `conftest.py:109-131` | bare `pytest` deselects only `live_llm`; plain `live` network tests still run | wave-3 |
| BE-33 | Low | REAL (known/deferred P36) | `execution.py:281-287`; `fallback.py:178-191` | per-source spend durability; death before source returns loses its billed totals | FIXED (closes P36: `acquire` takes a `record_spend` callback and writes the run's cost/calls per batch as each is billed, not once the source ends; `continue_run` passes `runs.add_spend` and keeps only the log -- a death mid-sweep keeps the spend already billed, as BE-19 keeps the figures) |

| BE-34 | Low | REAL (known/deferred P28/Q224) | `research.py:122-179`; `api/rules.py:310-326` | gate research spend not durably ledgered | wave-3 |
| BE-36 | Medium | REAL | `evaluation/rules.py:150-179`; `research.py:110-115,190-208` | confirmed gate answers ignore period; re-research skips them — see policy above | policy-set (wave-2) |
| BE-37 | Low | **UNREAL** | `main.py:356-387` | attribute-level fallback is documented reqs 6.10 use-1 intent; only case fabricates a figure | no-fix |
| BE-38 | Medium | REAL | `tools/audit_coverage.py:86-87`; `pyproject.toml:77,89` | coverage pools line+branch into one floor; branch can sit below the stated floor | wave-2 |
| BE-39 | Medium | REAL | `api/catalog.py:197,226-228`; `openapi.yaml:1128-1135` | attribute presenter returns only override sources, not the resolved full order (contract) | FIXED (`_attribute_body` resolves `effective_source_priority(sources).ordered` -- whole order, overrides promoted; both callers pass the global sources) |

### Storage (ST-01 … ST-20; BE-35 folded in at ST-18)

| ID | sev | verdict | evidence (file:line) | trigger + note | fix_status |
|---|---|---|---|---|---|
| ST-01 | High | REAL | `api/runs.py:250-255`; `run_store.py:41-67`; `0004:5-23` | concurrency: check-then-insert, no partial-unique/advisory lock → two running runs | wave-1 |
| ST-02 | Medium | REAL | `criteria_store.py:90-112`; `criteria.sql` | concurrency: no version token on replace → silent last-writer-wins | FIXED (server-side transactional lock, not a client token: `edit_criteria_set` reads+mutates+writes in one tx under `lock_criteria_set` (SELECT…FOR UPDATE); the 5 edit endpoints use it; overlapping edits serialise and both land. No migration/contract/UI change) |
| ST-03 | High | REAL | `0487:33-43` | populated upgrade: unscoped `DELETE criterion` breaks custom sets' pillar-sum | FIXED-ELSEWHERE (forward migration `0499` rebalances the career pillar the `0487` delete unbalanced) |
| ST-04 | Medium | REAL | `0489:59-60`;`0490:54-55`;`0491:22-23`; CHECK `0468:21-22` | populated upgrade: unconditional percentile UPDATE blocks on target_range set | wave-2 |
| ST-05 | Medium | REAL | `0478:38-44`;`0492:26-32`; FKs `0009:110,131,147,159,173` | populated upgrade: delete+reinsert blocks on RESTRICT child FKs; loses children | wave-2 |
| ST-06 | Medium | REAL | `0488:64-71` | populated upgrade: replacement hardcodes is_scored/lock/blocks, resetting user choices | wave-2 |
| ST-07 | Medium | REAL | `0010:34-80`; `evaluation_store.py:359-382`; `evaluation.sql:236-266` | snapshot omits weight_locked + typed thresholds; drops reducer/breakdown on read | FIXED (0500 froze value_type/weight_locked/matching_threshold + reducer/breakdown; 0504 froze warning inputs; **2026-10-22 `0505` fixed the 0504 boot-breaker** with `ON DELETE CASCADE` + a real-insert boot-sweep test; **`0507` froze the remainder**: a `pillar_weight_locked` column (pillar-level lock), `evaluation_match_rule`/`evaluation_compound_rule` (the enforced/applied rule lists), a `non_match_input` table (a `not_matching` compound rule's input figures, mirror of candidate_warning_input), and an `ordinal` on both input tables so figures read back in condition order. `read_criteria` restores the lock+rules, `read_candidate`/`read_results` the ordered inputs. Every new table uses `ON DELETE CASCADE` and is proven swept by a real-insert boot test. 2026-10-21 review: **0504 was a boot-breaker** -- its `candidate_warning_input -> candidate_warning` FK lacks `ON DELETE CASCADE` (violates the `0482` rule), so the boot sweep's `DELETE FROM candidate_warning` fails and the backend won't start; masked by TRUNCATE CASCADE in tests and the throwaway e2e DB. Also still unfrozen: pillar locks and the enforced/applied rule lists (`evaluation_store.py:229-238`), and a `not_matching` compound rule keeps none of its input ids (`rules.py:103-106`); warning input order not preserved (`evaluation.sql:240,329`). Fixes `bf2145e`/`bf47645`) |
| ST-08 | Medium | REAL | `evaluation.sql:236-239`; `0478:46-49`;`0492:34-37` | snapshot joins live value_type; in-place retyping drifts historical type label | FIXED (0500: snapshot carries its own value_type; read query selects ec.value_type, drops the live attribute join -- safe against 0478/0492 in-place retypes) |
| ST-09 | Medium | REAL | `published_tables/adapter.py:76`; `values.sql:252,271`; `0005:55-58` | re-run of a transcribed item → identical natural key → reported unanswered | FIXED (0501 `data_acquisition_run_reuse`; `acquire` records a pair the source answered but append skipped (transcribed re-read), `ValueStore.record_reuse` writes it, accounting counts reuse as completed not unanswered across select_run/select_runs/select_run_unanswered) |

| ST-10 | Low | REAL (known) | `values.sql:339-356`; `known-issues.md:497-498` | external scores: all editions, no current selection; non-deterministic ties | wave-3 |
| ST-11 | Low | REAL | `run_store.py:132-155`; `connections.py:46-53` | 4 SELECTs under READ COMMITTED → counts inconsistent with their lists | wave-3 |
| ST-12 | Low | REAL (latent/raw) | `0005:7-18`; `0004:32-58` | value not pinned to run's planned scope → partition arithmetic can break | wave-3 |
| ST-13 | Low | REAL (latent/raw) | `0010:125-139`; `evaluation.sql:353-358` | contribution evidence not pinned to its candidate/attribute → wrong provenance | wave-3 |
| ST-14 | Low | REAL (latent/known) | `0010:34-37`; `evaluation_store.py:88-95`; `known-issues.md:494-496` | frozen criteria not pinned to evaluation level (generic integrity, not city work) | wave-3 |
| ST-15 | Low | REAL (latent/raw) | `0005:7-62`; `0006:93-115` | accepted parent may lack payload / empty LabelSet / shares≠100 | wave-3 |
| ST-16 | Low | REAL (latent/raw) | `0006:29-30,47` | `*_is_finite` CHECKs reject NaN but accept ±Infinity | wave-3 |
| ST-17 | Low | REAL (latent/raw) | `criteria_store.py:360-365`; `0009:162-181` | multiple share-threshold rows collapse to `[0]`; whole-set rewrite drops the rest | wave-3 |
| ST-18 | Low | REAL (known/deferred P10) | `values.sql:49-53,153-157`; `api/values.py:204-207`; `openapi.yaml:1062-1068` | FX conversion provenance unexposed (absorbs BE-35) | wave-3 |
| ST-19 | Medium | REAL | `0488.rollback:46-47`; `0470.rollback:33-35`; `0004:38-45` | rollback DELETE attribute violates run-scope FK on shipped populated data | wave-2 |
| ST-20 | Medium | REAL | `Makefile:72-77,180-181`; `compose.yaml:132-135` | docker-migrate runs yoyo with no backup, bypassing backup-before-migrate | wave-2 |

## Preservation constraints (apply to every fix)

Historical data, provenance, user configuration and the `arch.md` 6.1/6.2 module/import
boundaries are preserved. Several storage findings (ST-03/04/05/06) touch *already-shipped*
migrations — fixes are forward migrations or guards, never edits to a migration that may already
have run on the user's DB. No change expands into city/v2.0 scope.
