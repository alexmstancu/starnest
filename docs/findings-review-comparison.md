# Independent findings verification comparison

**Date:** 2026-10-12  
**Baseline:** `7182d376ebb1d59cfff984b9f3d2a646303d23c3`

Both models independently reviewed every finding at maximum reasoning effort, using the documentation, current implementation, and relevant tests. Verification was static-only: no application tests, services, databases, migrations, or external calls were executed.

**Sources:** [Original findings](copilot-review.md), [GPT-6 Astra reasoning](gpt-6-astra-findings-review.md), [Claude Opus 5 reasoning](claude-opus-5-findings-review.md), and the [fresh Claude Opus 5 third adjudication](claude-opus-5-third-review.md).

GPT-6 Astra returned **88 REAL, 2 UNREAL, 1 UNCERTAIN**. Claude Opus 5 returned **91 REAL, 0 UNREAL, 0 UNCERTAIN**. They agree on **88 findings**, all REAL, and differ on **BE-11, BE-13, and BE-36**.

The table preserves the original IDs, order, severity labels, and both independent model verdicts. Summaries describe the reported issue; the decision column records the outcome of the requested adjudication process. REAL can include an accurately scoped known/deferred limitation or latent integrity gap; it does not establish runtime incidence or automatically require remediation. BE-35 remains folded into ST-18, as in the original report.

**Actions applied:** 88 `no-op`, 2 `third-review`, and 1 `verify`. `no-op` accepts the agreed REAL verdict without further investigation in this phase; it does not mean a confirmed problem will never require remediation. A fresh Claude Opus 5 subagent at maximum effort adjudicated BE-11 and BE-13; its verdicts are adopted unchanged. The coordinator directly reassessed BE-36 against both arguments, the original finding, documentation, implementation, and tests.

**Final decisions:** **89 REAL, 1 UNREAL, 1 left empty**. BE-36's action is complete, but its classification remains blocked by an unspecified validity/override policy. The empty decision and its blocker are intentional under the agreed unresolved-case policy, not an omitted review. No application code was changed and no application tests or database operations were executed.

**Fix status:** Checked at `c943761` (2026-10-14), after the builder's 12 remediation commits: **18 FIXED, 7 PARTIAL, 65 NOT_FIXED, 1 N/A** (BE-13, decided UNREAL). Commits claim 25 findings; 18 are fixed and 7 partly fixed. Of the 14 High findings, 8 are fixed, 3 partly fixed (UI-01, UI-03, BE-01), and 3 are untouched (BE-10, BE-17, BE-19). The method, the remaining gaps, and two risks introduced by the fixes are in [Fix status validation](#fix-status-validation).

**Round 2 (2026-10-17):** the small-fix round of [copilot-remediation-plan.md](copilot-remediation-plan.md) fixed 37 more findings, each test-first, ending at `074d71b`. Five are closed without code and ST-08's remainder is closed, so the column now reads **56 FIXED, 4 PARTIAL, 25 NOT_FIXED, 5 CLOSED, 1 N/A**. BE-36's decision is now REAL: the household set its policy on 2026-10-12, and its stage 1 is planned for later. Commits per finding, and what is still open, are in [Round 2](#round-2-small-fixes-2026-10-17).

**Round 2 review (2026-10-18):** four independent agents re-checked the round. BE-31 moves to PARTIAL: its forbidden import is gone and guarded, but the whole import table is still not enforced, which the plan left for later. The column now reads **55 FIXED, 5 PARTIAL, 25 NOT_FIXED, 5 CLOSED, 1 N/A**. What the review found, and the fixes that followed, are in [Round 2 review](#round-2-review-2026-10-18).

**After the other agent's fixes (2026-10-18):** its ST-02, BE-19 and ST-09 were checked against the code and are FIXED; UI-23 is FIXED too, because NEW-51 was UI-23 found again by running the browser suite. The column now reads **59 FIXED, 5 PARTIAL, 21 NOT_FIXED, 5 CLOSED, 1 N/A**. Details in [The other agent's fixes, checked](#the-other-agents-fixes-checked-2026-10-18).

**Phase B (2026-10-19):** UI-11, UI-15, UI-26 and UI-32 are FIXED, and BE-23 moves from PARTIAL to FIXED. The column now reads **64 FIXED, 4 PARTIAL, 17 NOT_FIXED, 5 CLOSED, 1 N/A**. Details in [Phase B](#phase-b-the-decided-items-2026-10-19).

**Gate research (2026-10-19):** UI-01 moves from PARTIAL to FIXED and BE-34 from NOT_FIXED to FIXED. The column now reads **66 FIXED, 3 PARTIAL, 16 NOT_FIXED, 5 CLOSED, 1 N/A**. Details in [Gate research](#gate-research-2026-10-19).

**The browser suite's own database (2026-10-20):** UI-03 moves from PARTIAL to FIXED. The column now reads **67 FIXED, 2 PARTIAL, 16 NOT_FIXED, 5 CLOSED, 1 N/A**. Details in [The browser suite's own database](#the-browser-suites-own-database-2026-10-20).

| nr | finding_id | finding_summary | severity | gpt-6-astra | claude-opus-5 | action | decision | fix_status |
|---:|---|---|---|---|---|---|---|---|
| 1 | UI-01 | nginx's 60-second read timeout can interrupt synchronous paid gate research before its result and actual cost reach the browser. Continued work after disconnection was not runtime-verified. | High | REAL | REAL | no-op | REAL | FIXED |
| 2 | UI-02 | Whole-bucket failed/unanswered retry buttons start a request without the estimate and confirmation used by selected-item retries. They also cannot convey explicit uncapped acceptance. | High | REAL | REAL | no-op | REAL | FIXED |
| 3 | UI-03 | Browser tests replace global Greece gate answers without restoring the previous answer and provenance. A sanity test can also leave a changed spend cap after an intervening failure. | High | REAL | REAL | no-op | REAL | FIXED |
| 4 | UI-04 | Unguarded asynchronous completions can merge old-set responses into a newly selected set or overwrite newer weights and run selections. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 5 | UI-05 | Multiple release/blur handlers can commit the same pillar-slider gesture before the server prop updates, creating duplicate rebalance requests. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 6 | UI-06 | Save completion replaces or clears the current draft even when the user entered newer edits while the request was pending. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 7 | UI-07 | Other source controls remain usable during a reorder, allowing interleaved priority writes. A mid-sequence failure leaves persisted partial changes without refreshing the displayed order. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 8 | UI-08 | Undo-history keys omit criteria-set identity, so consecutive edits to one attribute in different sets can collapse and undo into the wrong set. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 9 | UI-09 | Reversing only the edited weight cannot recover sibling proportions after they were reduced to zero, despite the UI presenting the operation as undo. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 10 | UI-10 | Nonblank invalid numeric settings can become NaN or infinity and serialize as null, clearing configuration rather than reporting invalid input. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 11 | UI-11 | Relevant writes do not invalidate persistent sidebar resources, leaving household context, match counts, or the last-run summary stale. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 12 | UI-12 | Rule-effect explanations count unconfirmed proposals as exclusions and describe compound rules as affecting nobody even when warnings apply. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 13 | UI-13 | Confirmation omits a proposal's reference period and does not display it. The loss is latent while the current researcher supplies no periods. | Low | REAL | REAL | no-op | REAL | FIXED |
| 14 | UI-14 | The proposal screen discards actual research cost, call count, and cap-halt status, leaving partial completion and spending undisclosed. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 15 | UI-15 | Alternative/rejected values display the selected value's score and contribution, while active descriptive or excluded values can be labeled Scored. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 16 | UI-16 | Candidate provenance fetches only one 500-value page while claiming to show every stored observation. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 17 | UI-17 | Only ten runs feed the claimed complete history and monthly-spend total, omitting older runs and their recorded costs. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 18 | UI-18 | Score presentation assumes a 100-point maximum and can clamp valid larger pillar scores to 100 or mislabel live/frozen scales. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 19 | UI-19 | Raw focus-minus-comparator deltas are presented with comparator-minus-focus desirability semantics, reversing ahead/behind meaning for some goals. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 20 | UI-20 | External-score rows omit reference and retrieval dates, so users cannot distinguish edition age despite the provenance requirement. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 21 | UI-21 | Repeat folding ignores quotes and citations, hiding distinct evidence behind observations with equal numeric payloads. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 22 | UI-22 | Acquisition diff decides whether measurements changed by comparing rounded display strings rather than underlying payloads. | Low | REAL | REAL | no-op | REAL | FIXED |
| 23 | UI-23 | Browser-gate selectors expect obsolete attribute-ID labels and comparison markup that disagree with the current product. This is a test-suite defect, not proof of broken product behavior. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 24 | UI-24 | Acquire does not poll its displayed running/stopping report; it stays stale until manual Refresh despite the live-progress requirement. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 25 | UI-25 | Clearing comparison focus produces an empty string that leaves Compare enabled, but submission silently does nothing. | Low | REAL | REAL | no-op | REAL | FIXED |
| 26 | UI-26 | Tabbing into a household-picker option starts a blur timer that closes the list and removes the focused option. | Low | REAL | REAL | no-op | REAL | FIXED |
| 27 | UI-27 | Candidate-roster read failures become empty required pickers without an actionable error or retry, blocking household/manual-entry workflows. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 28 | UI-28 | A successful empty criteria-set refresh is treated like loading and retains a deleted selection, reachable through overlapping or independent deletions. | Low | REAL | REAL | no-op | REAL | FIXED |
| 29 | UI-29 | No UI workflow independently enters or overrides a gate answer; the exposed write only confirms a proposal unchanged. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 30 | UI-30 | External-score React keys omit reference-period end, allowing distinct same-start editions to collide. | Low | REAL | REAL | no-op | REAL | FIXED |
| 31 | UI-31 | Settings help says an unset comparator limit means unlimited comparison, although the backend refuses comparisons until it is set. | Low | REAL | REAL | no-op | REAL | FIXED |
| 32 | UI-32 | The UI treats source-priority membership as adapter capability and makes unsupported claims about whether acquisition can answer an attribute. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 33 | UI-33 | Multiple adapters sharing a publisher produce duplicate plan-row keys and indistinguishable counts in the Per source table. | Low | REAL | REAL | no-op | REAL | FIXED |
| 34 | BE-01 | Criterion matching thresholds are stored and served but never evaluated when deciding a candidate's match status. | High | REAL | REAL | no-op | REAL | FIXED |
| 35 | BE-02 | Normalised criterion scores are rounded before weighting, which can change displayed totals and reverse rankings. | High | REAL | REAL | no-op | REAL | FIXED |
| 36 | BE-03 | An insufficient-scoreability return precedes gate and compound-rule evaluation, suppressing definite non-matches and warnings. | High | REAL | REAL | no-op | REAL | FIXED |
| 37 | BE-04 | Legal exclusions can leave zero scoring mass and cause an unmapped ranking error. An empty zero-weight pillar is also refused despite zero weight being a suggested remedy. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 38 | BE-05 | Criterion validation permits normalisation methods prohibited for the attribute's semantic value type, leading to arbitrary scores or unscoreable columns. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 39 | BE-06 | Quantity validation does not check the declared unit/dimension, allowing a magnitude in one unit to be interpreted in another. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 40 | BE-07 | Confidence derivation is disconnected from production reads, so stale observations can retain their original HIGH grade in confidence summaries. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 41 | BE-08 | Rejected returned measurements are stored without corresponding acquisition failures, preventing selective failed-item retry from reaching them. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 42 | BE-09 | WHO constructs observations without common attribute-explicit validation. The credible-range bypass is latent under the current catalog. | Low | REAL | REAL | no-op | REAL | FIXED |
| 43 | BE-10 | Retry wrappers do not forward the active cost meter, allowing absent or stale underlying meters to undermine cap enforcement or reject valid retries. | High | REAL | REAL | no-op | REAL | FIXED |
| 44 | BE-11 | Selective retry expands exact failed/unanswered pairs into broader candidate-attribute rectangles, allegedly re-fetching unrelated work. The models differ on whether the explicit retry contract permits this. | Medium | UNREAL | REAL | third-review | REAL | NOT_FIXED |
| 45 | BE-12 | Retry awaits completion despite returning 202 and omits the in-flight guard used by ordinary start, enabling blocking or overlapping passes. | High | REAL | REAL | no-op | REAL | FIXED |
| 46 | BE-13 | Unanswered retry reintroduces paid-source eligibility rather than preserving an initial free-sweep decision. Current cap refusal overlaps BE-14; unexpected billing requires a different registry. | Medium | UNREAL | REAL | third-review | UNREAL | N/A |
| 47 | BE-14 | A free explicit scope can require a spend cap solely because an unrelated enabled paid adapter is registered. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 48 | BE-15 | Research, CLI acquisition, and stand-in consultation do not consistently honor disabled-source decisions, including paid gate research. | High | REAL | REAL | no-op | REAL | FIXED |
| 49 | BE-16 | A legally configured zero cap is already exhausted at zero spend and halts an entirely free sweep after its first work. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 50 | BE-17 | Billed empty gate-research answers lose their cost and call count when converted to failed results, making the research cap ineffective on that path. | High | REAL | REAL | no-op | REAL | FIXED |
| 51 | BE-18 | Negative configured prices or token estimates can understate spending and compromise the cap model. Astra separately narrows the original non-finite configuration claim. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 52 | BE-19 | Completed paid candidate outcomes remain buffered until an attribute fetch returns, so hard death can lose earlier completed answers and failures. | High | REAL | REAL | no-op | REAL | FIXED |
| 53 | BE-20 | Some parser/conversion exceptions escape contextual source handling, abort remaining acquisition without recording the current failed item. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 54 | BE-21 | Loose request/domain validation boundaries can produce 500s, and ordinary framework validation errors do not use the promised uniform error body. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 55 | BE-22 | Unvalidated rename/duplicate copies can persist an empty-name criteria set that subsequent validated reads cannot load. | High | REAL | REAL | no-op | REAL | FIXED |
| 56 | BE-23 | Unknown body/query fields and unsupported nulls can be ignored or coerced, resulting in silent no-ops, cleared settings/anchors, or unintended threshold values. | Low | REAL | REAL | no-op | REAL | FIXED |
| 57 | BE-24 | Bulk acquisition/research silently intersects mixed valid and unknown scope IDs instead of reporting the omitted inputs. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 58 | BE-25 | Plans omit freshness filtering that execution applies, advertising work and cost that may be skipped or refused as nothing-to-fetch. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 59 | BE-26 | Weather aggregation accepts incomplete or misaligned nonempty series and labels their averages with the entire requested year/season. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 60 | BE-27 | Unquoted commas in current WDPA workings fields are accepted by the CSV parser and silently truncate methodology provenance. | Low | REAL | REAL | no-op | REAL | FIXED |
| 61 | BE-28 | AssignedScore fallback uses an invalid constructor and cannot store an otherwise eligible paid answer. Current manual AssignedScores are excluded, making the branch latent. | Low | REAL | REAL | no-op | REAL | FIXED |
| 62 | BE-29 | Source JSON is decoded through binary floats before Decimal conversion, losing publisher precision for long numeric tokens. | Low | REAL | REAL | no-op | REAL | FIXED |
| 63 | BE-30 | Employer-response elements are stringified instead of validated as firm-name strings, allowing nulls, numbers, or objects to become labels. | Low | REAL | REAL | no-op | REAL | FIXED |
| 64 | BE-31 | Comparison directly imports criteria despite the exhaustive dependency table, and the configured layer guard permits this forbidden edge. | Low | REAL | REAL | no-op | REAL | PARTIAL |
| 65 | BE-32 | Bare pytest excludes paid live tests but still selects ordinary live-publisher tests, making the default invocation network-dependent. | Low | REAL | REAL | no-op | REAL | FIXED |
| 66 | BE-33 | Known/deferred spending durability remains per source, so death before the current source returns loses its billed totals. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 67 | BE-34 | Known/deferred gate research returns/logs spending but creates no durable billing record, leaving lost responses or process death unledgered. | Low | REAL | REAL | no-op | REAL | FIXED |
| 68 | BE-36 | Finite-period confirmed gates keep applying and are skipped by research. Whether expiry should invalidate manual decisions remains a policy question. | Medium | UNCERTAIN | REAL | verify | REAL | NOT_FIXED |
| 69 | BE-37 | Fallback eligibility excludes an entire attribute whenever any structured adapter declares it, rather than considering candidate-specific gaps or failed sources. | Low | REAL | REAL | no-op | REAL | CLOSED |
| 70 | BE-38 | Backend coverage combines line and branch percentages into one floor, allowing one metric below the separately promised threshold. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 71 | BE-39 | Attribute responses serve only source-priority overrides rather than the contractually resolved order including remaining global sources. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 72 | ST-01 | The running-run check and insertion are not atomic, so concurrent starts can create multiple active acquisitions and duplicate financial work. | High | REAL | REAL | no-op | REAL | FIXED |
| 73 | ST-02 | Whole-set read/modify/replace has no stale-version protection, allowing one successful edit to erase an unrelated concurrent decision. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 74 | ST-03 | Career retirement removes posting weights from every profile but compensates only named defaults, potentially invalidating customized or duplicated sets during upgrade. | High | REAL | REAL | no-op | REAL | FIXED |
| 75 | ST-04 | Normalisation migrations overwrite custom fixed interpretations or violate valid target-range constraints, silently changing choices or blocking upgrade. | Medium | REAL | REAL | no-op | REAL | CLOSED |
| 76 | ST-05 | Type-correction migrations delete criteria without handling restrictive anchor/threshold children, blocking upgrades with configured interpretations. | Medium | REAL | REAL | no-op | REAL | CLOSED |
| 77 | ST-06 | Housing replacement transfers weight but hardcodes inclusion and unlocks, discarding prior user exclusion and lock decisions. | Medium | REAL | REAL | no-op | REAL | CLOSED |
| 78 | ST-07 | Saved evaluations omit supported interpretation fields and exact unscored rule-input evidence, preventing complete historical explanation after later changes. | Medium | REAL | REAL | no-op | REAL | PARTIAL |
| 79 | ST-08 | Historical criteria read current attribute types even though migrations retype the same IDs, allowing saved interpretation to drift during upgrade. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 80 | ST-09 | Successful rereads of unchanged transcribed observations insert no new row or reuse association and are consequently reported as unanswered. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 81 | ST-10 | External-score queries return all editions without selecting or labeling the current edition, with incomplete deterministic ordering. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 82 | ST-11 | Separate run-detail queries under READ COMMITTED can observe different snapshots and return counts inconsistent with their lists or source totals. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 83 | ST-12 | SQL does not pin run-linked evidence to planned scope and level, allowing out-of-scope writes that break progress partition arithmetic. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 84 | ST-13 | Saved contribution FKs do not pin evidence to the correct candidate/attribute or frozen criterion, permitting wrong provenance or reopening failure from faulty writes. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 85 | ST-14 | Frozen criteria are not constrained to their evaluation's level, allowing contradictory generic snapshots through storage/SQL writers. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 86 | ST-15 | SQL enforces payload-family agreement but not accepted-payload completeness or composition totals, allowing states that fail subsequent domain reads. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 87 | ST-16 | SQL constraints named finite reject NaN only and permit numeric infinities that normal payload reads cannot accept. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 88 | ST-17 | SQL permits multiple share bounds but the mapper keeps only the first, allowing an unrelated whole-set rewrite to delete remaining bounds. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 89 | ST-18 | Known/deferred storage and API presentation omit the conversion rate's complete provenance despite an internal published-rate FK. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 90 | ST-19 | Attribute-removing rollbacks ignore persistent run-scope references and fail on otherwise ordinary populated historical databases. | Low | REAL | REAL | no-op | REAL | CLOSED |
| 91 | ST-20 | The container migration path runs yoyo without enforcing the backup prerequisite present on the local migration path. | Medium | REAL | REAL | no-op | REAL | FIXED |

## Differences in interpretation

- **BE-11:** Astra treats the handwritten retry contract's explicit covering rectangle as permitted behavior and classifies the defect claim UNREAL. Opus treats the broader rectangle as violating the requirements' "only what failed" promise, particularly for paid per-candidate work.
- **BE-13:** Astra treats ask-again's all-capable-source behavior and renewed financial consent as intentional, placing the current erroneous cap refusal under BE-14. Opus confirms the loss of original free-sweep eligibility, while agreeing that unexpected billing is conditional and the demonstrated refusal shares BE-14's cause.
- **BE-36:** Both identify ignored periods and confirmed-answer skipping, and both acknowledge that automatic invalidation of expired manual decisions is not settled. Astra therefore returns UNCERTAIN for the compound finding; Opus returns REAL for the missing expiry/re-check behavior while narrowing the policy-dependent claim.

The independent verdicts and their reasoning remain unchanged. The decision column applies the requested third-review/direct-verification process rather than majority voting. Detailed qualifications, proofs, and test analysis remain in the linked individual reports.

## Final adjudication and blocker

### BE-11: third-review -> REAL

The fresh adjudicator independently checked both arguments, current code/tests, authoritative scope statements, and the history of the covering-rectangle rationale. Its conclusion is adopted unchanged: **REAL, with scope qualifications**. The failed-retry rectangle is contract-sanctioned and near-harmless for all-free bulk sources, but the rationale predates per-candidate paid adapters. In a supported mixed OECD/employers run, a whole-source failure expands the candidate union and can cause retry to bill employers calls for countries that already succeeded. The unanswered branch also discards exact pairing and re-asks already answered pairs. A cap limits spending but does not restrict the requested pairs.

This does not decide whether future policy should preserve the free-source approximation or revise it universally. The complete reasoning, history, counterexample, and separation from BE-10/BE-12/BE-14 are in [the third adjudication](claude-opus-5-third-review.md).

### BE-13: third-review -> UNREAL

The fresh adjudicator's conclusion is adopted unchanged: **UNREAL as a distinct defect**. Ask-again's all-capable-source selection and renewed per-request financial consent are explicitly documented after the paid path existed. Current free-sweep unanswered attributes cannot reach either paid adapter because of the registry's disjoint declarations. The demonstrated erroneous cap refusal is the independently accepted BE-14, not proof that original financial eligibility must be inherited. BE-14 and UI-02 remain REAL; this decision does not dismiss those adjacent problems.

### BE-36: verify -> decision left empty

**Coordinator reassessment completed; no definitive REAL/UNREAL classification.** I reread my original compound finding and both verification arguments, then independently checked the following:

- `docs/reqs.md:1493-1503` defines the period a judgement holds for and requires expired-finding marking/re-check prompting. `docs/openapi.yaml:1484-1501` carries that period, but neither states that expiry automatically overrides a human-confirmed gate, nor defines how changed citizenship invalidates a previous answer.
- `backend/src/starnest/storage/match_rule_result_store.py:40-61` and `backend/src/starnest/api/rules.py:355-391` preserve an explicitly supplied period. This is not a storage/serialization omission on the manual-answer path.
- `backend/src/starnest/evaluation/rules.py:150-179` applies confirmed negative answers without consulting their periods. `backend/src/starnest/data_acquisition/research.py:110-115,190-208` deliberately excludes all confirmed answers from both research and its estimate. The reported behavior is real, including for confirmed unknown answers, but behavior alone does not settle whether that protection should cease at expiry.
- `backend/tests/unit/data_acquisition/test_research.py:150-170,245-261` explicitly protects confirmed answers from paid re-research. `backend/tests/unit/evaluation/test_rules.py:195-225,238-282` distinguishes proposals, confirmations, enforcement, and unknown outcomes, but does not resolve finite-period expiry or household-context changes. These assertions were read, not executed.
- `ui/src/routes/configure/proposals/useProposals.ts:71-73` and `ui/src/routes/configure/proposals/ProposalsPanel.tsx:118-149` show only unconfirmed proposals and a count of confirmed answers; no confirmed-period expiry/re-check presentation exists there. This supports a narrower UI obligation, not by itself the original compound backend-validity claim.
- `storage/queries/criteria.sql:631-653` keeps one answer per gate/candidate and replaces it on write. Simply enabling research on confirmed answers would let a new non-enforcing LLM proposal replace the previous human finding before confirmation. That makes protection/coexistence policy material, rather than a missing date comparison that can safely be assumed.

**Blocker:** The product must specify whether a period-expired human answer remains enforced with an expiry notice, becomes unknown/non-enforcing pending review, or may be explicitly re-researched while preserving the previous confirmation. It must also specify manual-override exceptions and which household changes invalidate answers. No authoritative decision resolves those alternatives. The missing expiry presentation can be acknowledged without silently changing BE-36 into a different, narrower finding. Per the agreed unresolved-case policy, its decision stays empty rather than inventing a binary conclusion.

## Fix status validation

**Checked at:** `c943761` (2026-10-14), 12 commits after the baseline; working tree clean. Static-only: every post-baseline diff and the current code and tests were read; nothing was executed. Commit messages and the builder's [`findings-remediation.md`](findings-remediation.md) were treated as claims, not evidence. Its `fix_status` column is stale for wave-1 items.

**Status values:**

- `FIXED`: the reported defect no longer follows from the code. Residual remedy suggestions are noted below.
- `PARTIAL`: a change landed, but at least one scenario named by the finding still reproduces.
- `NOT_FIXED`: no relevant change. Every finding whose cited code lies only in unchanged files is in this group.
- `N/A`: the finding was decided UNREAL.

### PARTIAL: what remains

- **UI-01:** nginx now gives `/v1/match-rule-research` a 300-second read timeout. Research is still one synchronous request that asks gates × candidates sequentially, with up to five web searches per call, so a large pass can still exceed the timeout. There is no job/poll or disconnect handling; the commit itself names job/poll as the real fix.
- **UI-03:** `gate-c.spec.ts:167-177` restores only `match_result` and `reason`. The PUT body defaults `data_source` to `manual` and clears citations, period, and override. An absent answer is restored as a manual `matching`. `sanity.spec.ts` (unchanged) still restores the spend cap outside `finally`.
- **BE-01:** `thresholds_that_rule_out` judges all four threshold shapes, but `ranking.py:444` passes only scored criteria. Excluded criteria never gate, including every LabelSet criterion (`0122` forbids scoring them), although `d6-scale-anchors.md:77-78` says an excluded criterion "still matches, still gates".
- **BE-21:** Request validation now uses the single error shape, and money and score-scale fields are bounded. These cases still return 500 because the domain error arrives wrapped in a pydantic `ValidationError` that `refusal_for` cannot map: malformed household candidate IDs and impossible place combinations, inverted range thresholds (`criteria.py:211`), and inverted periods on manual values (`values.py:132`) and gate answers (`rules.py:393`).
- **BE-23:** `extra="forbid"` now covers settings, household, set-name, and pillar-weight bodies. Run, retry, research, and gate-answer bodies still drop unknown fields. Unknown query parameters are still ignored. `scale_anchors: null` still clears anchors (`criteria.py:176`), and `required_value: null` still becomes `false` (`criteria.py:213`).
- **ST-07:** Locks, typed thresholds, reducers, and breakdowns are now frozen and read back (`0500`). Rule-input Value IDs are still not frozen, so a warning's source/date chain still cannot be reopened. Rows saved before `0500` read back as unlocked and without a threshold.
- **ST-08:** New snapshots freeze `value_type`, but `0500` backfills old rows from today's attribute type. Snapshots saved before `0478`/`0492` still report the retyped type.

### FIXED: caveats

- **UI-02:** Bucket buttons now go through plan, estimate, confirmation, and start. They start a scoped run over the candidates × attributes product, asking every switched-on source (paid ones too, because attributes are named), rather than the selective `/retry` described in `reqs.md` 6.4. The estimate discloses this, and the UI no longer calls `/retry`.
- **BE-05:** See R-1.
- **BE-15:** When the `llm` source is switched off, research is refused with 501 `llm_not_configured`, a code that says the source is unconfigured rather than switched off.
- **BE-20:** Fixed for Open-Meteo. The generic abort path (`execution.py:327`) still drops the in-flight item when an unforeseen exception occurs.
- **ST-03:** `0499` silently skips any damaged set that lacks `tech_employment_share` and has no post-migration assertion.

### Untouched High findings

- **BE-10:** `_AskedOnlyAbout` (`execution.py:570`) still inherits the base no-op `meter_with` (`adapter.py:101`).
- **BE-17:** `llm/gates.py` is unchanged.
- **BE-19:** `llm/employers.py` and `llm/fallback.py` are unchanged; the `run.py` and `execution.py` edits do not touch buffering.

BE-36 is not fixed: `findings-remediation.md` records a household policy, but no expiry or re-research change was made. BE-37 is not fixed; the builder judged it UNREAL.

### New risks introduced by the fixes

These are outside the 91 findings:

- **R-1 (BE-05 with ST-08):** Snapshots saved before `0478` froze `country.school_system_quality` with `as_is`. `0500` backfills its type as `Quantity`, and BE-05's validator rejects `Quantity` with `as_is` when `_criterion_from` rebuilds it (`evaluation_store.py:399`). `GET /evaluations/{id}/criteria` would therefore return 500 for such a snapshot. A live set with a method that is now illegal would fail to load in the same way. Whether such rows exist was not checked, because no database access was used.
- **R-2 (UI-03):** The restore rewrites the prior answer as a manual answer, so an LLM proposal that was not ruling anything out becomes a confirmed, enforceable answer after the suite runs.

## Round 2: small fixes (2026-10-17)

The round was scoped by the household to real bugs whose fix is a few lines in a few files: no migration, no contract change, no new flow. Every finding below started with tests that failed for the right reason, then the fix, then the same tests passing, with at least 80% coverage of the changed lines (100% in practice). Each lane passed its half of `make check`, a code-review agent read each lane's diff, and the full `make check` passed on `master` before the push: 2,998 backend tests at 97.24% coverage, 1,320 UI tests.

| Finding | Commit(s) on `master` |
|---|---|
| BE-01 | 86ac25f |
| BE-08 | cef4abb, 85d545d, 24f217a |
| BE-09 | 268292f |
| BE-10 | 3056c15 |
| BE-17 | 0e60b7b |
| BE-21 | 1423046, 72fdad1 |
| BE-25 | 612e5d9 |
| BE-27 | 77a2abc, b092c2c |
| BE-28 | 268292f |
| BE-29 | 268292f |
| BE-30 | 268292f |
| BE-31 | 986cdd8 (PARTIAL) |
| BE-32 | c222046 |
| BE-38 | c222046, dd2af3e |
| ST-20 | fb53d42 |
| UI-04 | fdcbc6e, b2a41e7, 1da9392 |
| UI-05 | b2a41e7 |
| UI-06 | 49e4cae |
| UI-07 | a04f86d |
| UI-08 | b2a41e7 |
| UI-09 | b2a41e7 |
| UI-10 | 49e4cae |
| UI-12 | 694e24c, 50713a2 |
| UI-13 | 694e24c |
| UI-14 | 694e24c, b5de286, 074d71b |
| UI-16 | da6a3ae |
| UI-17 | da6a3ae |
| UI-19 | f3ba2db |
| UI-20 | fc1b406 |
| UI-21 | fc1b406 |
| UI-22 | e0fddab, c75e2b4 |
| UI-25 | f3ba2db |
| UI-27 | b93632c |
| UI-28 | 040d25b |
| UI-30 | fc1b406 |
| UI-31 | 040d25b |
| UI-33 | 612e5d9 |

**Partly fixed in this round:** UI-03, where only the sanity test's spend-cap restore (`040d25b`) landed. The browser suite still runs against the live stack until UI-03's own database is built, so the three `sanity.spec.ts` edits were checked by lint and typecheck only.

**Closed without code:**

- BE-37: by design (reqs.md 6.10 use 1).
- ST-04, ST-05 and ST-06: your backups show no choice was overwritten.
- ST-19: a failed old rollback leaves data intact.
- ST-08's remainder: there are no saved rankings.

Details: [copilot-remediation-plan.md](copilot-remediation-plan.md) section 6.

**A side effect, found by review and fixed before the push:** BE-08 records a failure beside every rejected figure, so the Acquire screen's red card read "0 failed" over its own list, and a source's bar summed one pair twice. `85d545d` counts a rejected figure as its source's failure only. `24f217a` counts the card from its own failures, which also fixes the older OECD-and-estimate case.

**Two more side effects, found by the review of the Configure changes and also fixed before the push:**

- After a failed research pass, the panel still showed the previous pass's spend as the last pass. `b5de286` clears it, says when a failed pass's cost is unknown, and `074d71b` re-reads what such a pass stored, so it isn't paid for twice.
- After confirming a proposal, the gate's new sentence kept saying it ruled nobody out. `50713a2` re-reads the gate answers after a confirm or a research pass.

**Still open:** the 25 NOT_FIXED and 5 PARTIAL findings are planned in [copilot-remediation-plan.md](copilot-remediation-plan.md):

- section 3 lists five that have a smaller fix awaiting the household's OK;
- section 4 lists the rest, held for later.

New defects found during the round are listed in that plan's section 7. The four small ones found last were fixed the same way, test-first, on 2026-10-18:

| Defect | Commit |
|---|---|
| NEW-26: the Compare refusal for an unset comparator limit offered no way to Configure | 9dc38a1 |
| NEW-27: with a refetch age set, a rejected figure made its pair fresh, so the plan never asked again | a02dfb3 |
| NEW-28: a billed research answer with no text was described as "could not be reached" | 75b2435 |
| NEW-29: two quick submits of a hand-typed figure sent two POSTs | 347c800 |

## Round 2 review (2026-10-18)

Four independent agents re-read the round: a code review of the backend and of the UI, and a verification of every FIXED claim against the original finding, the code and the tests. The UI verification found all 33 UI claims fixed. The backend verification found 26 of 28 fixed. Two were partial:

- **BE-21:** creating a criteria set under a malformed id still answered 500. Fixed by `72fdad1`; a probe of every other request shape found no other case.
- **BE-31:** the forbidden import is gone and guarded, but the whole import table is not enforced. The plan left that guard for later, so BE-31 now reads PARTIAL.

The reviews also found side effects of the round itself. Each was confirmed in the code (and on your data where it applies), then fixed test-first:

| Defect | Commit |
|---|---|
| NEW-30: since `85d545d`, a figure rejected without a failure row counted as neither stored nor failed. That is every run before BE-08, and runs 15 to 17, whose 156 AI figures `0473` rejected. The Acquire screen dropped the `llm` source from those runs. | 64e0872 |
| NEW-31: a research pass refused with 501 (the AI source switched off) said its cost was unknown and re-read the answers | 769b5e8 |
| UI-04 (rest): a failed read of a run the reader had left still showed its error over the run they chose | 1da9392 |
| UI-22 (rest): a non-euro figure that moved only in euros read "refreshed" beside two identical cells | c75e2b4 |
| NEW-32: when their read failed, the browser suite's restores could clear your live spend cap or coverage floor, or write `matching` over Greece's gate answer (checked by lint and typecheck only: the browser suite still runs on the live database) | ffdcaef, f673460 |
| NEW-33: BE-27 moved three tables' read date to a day nobody read the publishers. You chose to restore the dates; your current database keeps the 12 shortened notes until a table is really read again | b092c2c |
| NEW-34: controls disabled while a save runs dropped keyboard focus. You chose to keep focus on the control | 7bf3184, 73ebfc4, 947ec2b, 2c8e0f1, bf05144, 17c5bdc |
| NEW-35: freshness counted a switched-off source's figures, which cannot score | cfb0547 |
| NEW-43: tabbing onto a weight slider, or clicking its thumb without dragging, sent a weight nobody chose. Chromium holds a slider's value snapped to its 0.5 step, so a stored 6.8 read back as 7 and was sent, rebalancing the pillar. This predates round 2; the focus work found it. | f230c3a |
| Text left behind: the `start_run` comment (NEW-15) and the `make coverage` help line (BE-38) | dd2af3e |

Recorded for later, in the plan's section 7: NEW-36 to NEW-42 and NEW-44 to NEW-47. One of them needs your attention: **NEW-47**. The builder's commit `2c04381` (2026-10-02, before this review) deleted 929 lines of `styles.css` without saying so, and 56 classes the screens still use have had no styles since. They include the criterion rows, the confirmation strip, the tiles and the danger button. It is a look, not a behaviour, but it is a lost write, and it needs a visual check and a restore.

## Checkpoint (2026-10-18)

Everything above, tested and reviewed again at `cfabd6c`:

- **`make check`:** green. 3,027 backend tests at 97.25% coverage, the import contracts kept, every audit passing; 1,383 UI tests, eslint without errors.
- **Browser suite** (Playwright), against the containers rebuilt at `cfabd6c`: 25 passed, 4 failed, 3 did not run.
  - The four failures are specs left stale on 2026-10-04, when the builder's `2a13d73` named the weight sliders after their attributes' catalog names and `ddbf555` gave the Compare matrix a "Pillar" column instead of "Attribute". Neither changed since `acb56e5`, so none of the four comes from this review's commits (NEW-51).
  - The three that did not run follow a failure in the same serial spec.
  - Your live data came back as it was. Weights, rules, sources, settings and the gate answer are identical to before the run. The run added one `[e2e]` saved ranking, which the next boot discards, and run 123: one free Eurostat figure for Portugal.
- **Five independent reviews** of `acb56e5..cfabd6c`, by area (acquisition and storage, API and evaluation, Configure, Acquire/Rank/Compare, and test integrity). The API and Configure reviews found nothing significant. The others found three defects in this review's own work, each confirmed in the code:

| Defect | Severity | Status |
|---|---|---|
| NEW-48: since BE-08 (`cef4abb`), a retry can bill a paid source again for a country it answered, because a free source's rejected figure puts that country in the retry. It is BE-11's rectangle with a new trigger | Low: only a direct call to `/retry` reaches it; the app's Retry button starts a scoped run (UI-02) | Held for BE-11 (your choice). A tested fix (`468645b`) is kept on a local branch: merged alone, the run's recorded scope would show pairs nobody needed to ask as unanswered |
| NEW-49: since `fdcbc6e` (UI-04), a Refresh clicked while a Stop is being sent can leave the card showing no stop, with Stop live again | Medium | Fixed (8e5ece9, f9e432c) |
| NEW-50: two UI-06 tests decide on a fixed one-second wait, so under load they pass without proving anything, or fail for no reason. One assertion has checked nothing since NEW-34 | Medium (tests) | Fixed (d3182d4) |

The Acquire review also confirmed UI-03's remaining part again: gate C's restore re-dates the gate answer and drops its period, pages and override. The fix is the browser suite's own database.

**After the checkpoint**, you chose to fix these, to update the stale browser specs and to restore the missing styles in the same round:

- NEW-51: the four stale browser specs were updated (`6865e27`). Sliders are found by the attribute's catalog name, read from the API; the comparison is found by its table's name.
- NEW-47: the styles `2c04381` deleted were restored (`54ef14f`) from the version before it, adapted to the held controls of NEW-34. That covers 60 classes, not 56: four status-pill classes are built in code, so a text search missed them. Before-and-after screenshots show, for example, the criterion rows: their weight bars had drawn as black bands, and now align with their sliders, values, locks and chips.
- NEW-49, the rest: the final review found a second way to drop a stop's read. While a stop is being sent, a start is always refused, and that refusal reads nothing back. `f9e432c` re-reads the card when a start is refused and is still the reader's newest act.
- NEW-52 and NEW-53 were noticed on the way, and are recorded for later in the plan's section 7.

**Final state at `f9e432c`** (pushed, and deployed to your containers):

- `make check` is green: 3,027 backend tests at 97.25% coverage, every audit passing, and 1,395 UI tests.
- The browser suite passes in full, **32 of 32**, up from 25.
- Your live data came back as it was after each browser run. The browser suite adds a small free Eurostat run each time; this round added runs 123 to 125. It also re-dates Greece's gate answer, which is UI-03's remaining part. The `[e2e]` rankings were discarded by a backend restart.
- A last code review of the final four commits found only the NEW-49 case above.

## The other agent's fixes, checked (2026-10-18)

While the decisions above were open, the other agent committed three fixes to `master`. Each was read against the code; none undoes anything this review fixed, and the backend tests that cover them pass.

| Finding | Commit | Checked |
|---|---|---|
| ST-02 | `5358c3c` | Each set edit reads, mutates and writes in one transaction, under a `FOR UPDATE` row lock (`pool.connection()` commits at the end of the block), so overlapping edits serialise and both land. The mutations are plain functions on the same connection, so the single-connection pool cannot deadlock. FIXED |
| BE-19 | `d7a1263` | The two AI adapters yield each candidate as it lands, and `acquire` stores each batch before asking for the next. BE-08's failure for a rejected figure is kept in the new loop. FIXED. Its cost is still saved only when the whole source ends, so BE-33 stays open |
| ST-09 | `608919f`, then `b673fde` | A re-read transcribed figure counts as answered, not unanswered. Its new table recorded no source, so the source-by-source bars could not show it (NEW-54); `b673fde` amended `0501` before it was applied anywhere, and the bars now credit the source. FIXED |

Consequences for the plan: the next migration is `0502`; the held NEW-48 commit no longer works as written, since a run now asks through `fetch_in_batches`; and keeping one database connection (NEW-21) no longer rests on ST-02.


## Phase B: the decided items (2026-10-19)

On 2026-10-18 you chose the small fix for UI-11, UI-15 and UI-26, the full fix for UI-32 and BE-23, and a batch of the recorded defects. Each started with tests that failed for the right reason, then the fix, then the same tests passing, with 100% coverage of the changed lines. Three lanes ran in parallel without sharing a file, and a fourth did UI-32's screens once its server half had landed. Each lane passed its half of `make check`, and independent reviews read every commit.

| Finding | Commit(s) on `master` | What changed |
|---|---|---|
| UI-11 | 48e14e8 | The sidebar re-reads the household, the match counts and the last run when you change screens, and when a run you are watching ends |
| UI-15 | a8d2b71, 9be5ac6 | Score and contribution show only on the figure the pass scored, and an active figure nothing counts reads "Active". The review found that the first commit hid the numbers when the set could not be read; the second takes the ranking's word then |
| UI-26 | c53af61 | The household picker stays open while focus is anywhere inside it |
| UI-32 | d217dd9, 7c6cb9e, c3f18e4 | The server says which sources can fetch each attribute (`answerable_by`, Q235), and the Acquire card, Configure's chip and the hand-entry card read it. On your data, four attributes have nothing that can fetch them: `remote_work_tax_treaty`, `climate_zone`, `pension_portability` and `residency_admin_ease` |
| BE-23 | d8d5636 | Undeclared body fields, undeclared query parameters and nulls with no meaning are refused as 422 `invalid_request` |

Defects fixed in the same phase:

| Defect | Commit |
|---|---|
| NEW-04: the AI client waited up to 600 s and retried twice, outlasting the proxy's 300 s | d883af3 |
| NEW-11: every Acquire action reset the diff's chosen pair | 876d75c |
| NEW-18 and NEW-41: no operation declared a 422, and the generated contract described one as `{detail}` | 27f6d6c |
| NEW-36: a model's gate answer sent over a person's stored nothing and still answered 200 | c96d40a |
| NEW-37: the refetch age printed as "30 days, 0:00:00" | 3464c9d |
| NEW-38: `useManualEntry`'s `onStored` was never passed | 9eabba5 |
| NEW-39: the exact diff left out an assigned score's rationale | eebf7fc |
| NEW-40: planning a run for an unknown level answered 200 with nothing to do | 041008f |
| NEW-42: "Saved." was not announced to a screen reader | b4d3e5f |
| NEW-44: older controls disabled themselves during a write and dropped keyboard focus | 45f2c25, 46d84d1 |
| NEW-52: Stop was offered again while a Refresh overlapped it. The review found that a start pressed during the stop did the same; the second commit keeps Stop held until the stop is refused | 6d72d97, d7b6bfb |
| NEW-53: a browser spec could read pillar names before they had loaded | 5b44462 |
| `arch.md` 7.3 promised a 400 for a malformed request; the contract and the code say 422 | 891b413 |

**Checked at `d7b6bfb`:**

- `make check` is green: 3,151 backend tests at 97.29% coverage, the import contracts kept, every audit passing; 1,495 UI tests at 98.97% coverage, eslint without errors.
- The containers were rebuilt and the browser suite passed in full, 32 of 32. Your live data came back as it was: the browser run added one free Eurostat figure (run 127), re-dated Greece's gate answer (UI-03's remaining part) and saved an `[e2e]` ranking, which a backend restart discarded.
- Independent reviews:
  - Backend and contract: nothing found. The reviewer also sent the UI's real request shapes to the built app, and none was refused.
  - Acquire, Rank and the browser specs: the two gaps fixed by `9be5ac6` and `d7b6bfb`, and an older defect recorded as NEW-57.
  - Configure, the shell, UI-32's screens and the two follow-up fixes: nothing found.

**Recorded for later** in the plan's section 7: NEW-55 to NEW-63. One needs your attention: **NEW-57**. Since before this review, pressing Refresh during a start lets go of Start, so a second start can be sent. The database refuses it, but the card then drops the run that did start and shows the old one under a `run_already_in_flight` banner. The fix is NEW-52's: track a start apart from `busy`.

**After Phase B (2026-10-19):** you chose to fix NEW-57 at once. `8bad828` holds Start, "Yes, start it" and "Not yet" for as long as a start is in flight, whatever act is newest, as NEW-52 does for Stop. It was written test-first, with 100% of its changed lines covered. `make ui-check` passed (1,497 tests), and so did the browser suite against the rebuilt containers (32 of 32). Your live data came back as it was, apart from run 128's one free figure and Greece's re-dated answer.

## Gate research (2026-10-19)

The plan you approved on 2026-10-18, built test-first in two lanes that shared no file: the server's, then the page's. Every item began with tests that failed for the right reason, and 100% of the changed lines are covered.

| Finding | Commit(s) on `master` | What changed |
|---|---|---|
| NEW-01 | 567faf4 | Research asks only the gates the catalog marks researchable, about the countries each concerns (migration `0502`, decision Q236): the UK Skilled Worker route about the United Kingdom, the Swiss and Liechtenstein quotas about Switzerland and Liechtenstein. A pass over the country level is 3 paid calls, not 160, and a gate research cannot answer costs nothing |
| BE-34 | c99e4a1 | Every billed research call is written to a spend ledger as it returns (migration `0503`), before its proposal is stored and before the next question, so a pass that dies keeps the record of what it paid for. Write-only, by decision |
| UI-01 | 34f9b30, 36bad8c, 634fb1e | The page asks one gate per request, so each request is one paid call at most (each call is bounded to 240 s, under the proxy's 300 s). It holds the whole pass to the spend cap, stops when you press "Stop after this question" or leave Configure, survives a switch of criteria set, shows its progress, and re-reads the answers once at the end |
| NEW-60 | d6ef9a9 | The research estimate and pass refuse an unknown level with 422, as runs do |
| NEW-63 | 5e7787f, 89307fc | A proposal a person's answer displaced during a pass is reported among the answers not stored, rather than listed as a proposal. The review found that the panel headed that list "Answered without citing anything", which this proposal had not done; the list is now headed "Asked, but nothing was stored", and the contract names both causes |
| Contract text | 8c90549 | The estimate's and the pass's descriptions say research asks only what it can answer. Descriptions only: no shape changes |

**Checked at `8c90549`:**

- `make check` is green: 3,200 backend tests at 97.30% coverage, the import contracts kept, every audit passing; 1,553 UI tests at 98.99% coverage, eslint without errors.
- `make migrate` took the backup `backups/20261019-170218.dump`, then applied `0502` and `0503`. Your database now marks the three gates researchable, each with its country, and the ledger is empty.
- After the rebuild, the live estimate for the country level is **3 calls, at most €0.22**. A gate research cannot answer costs nothing, and an unknown level is refused. The ranking is unchanged (the Netherlands 77, Ireland and Malta 72).
- The browser suite passed in full, 32 of 32. Your live data came back as it was, apart from run 129's one free figure and Greece's re-dated answer; the `[e2e]` ranking was discarded by a backend restart.
- Independent reviews:
  - The server lane: the NEW-63 heading, fixed in `89307fc`; nothing else.
  - The page lane: nothing in the pass itself. No request goes after Stop, leaving Configure or the cap; the cap holds exactly at its boundary; the acceptance never carries into the next pass. It confirmed one older gap: a keyboard user standing in the proposals table when a pass ends is put back on the page, because the re-read at the end blanks the table for a moment. That predates this build and is recorded under NEW-45.

## The browser suite's own database (2026-10-20)

You approved the plan for UI-03 and chose to delete the Greece answer the suite had written.

| Finding | Commit | What changed |
|---|---|---|
| UI-03 | 05f17bd, 854d78a | `make e2e` restores your newest backup into a throwaway `<db>_e2e` database, migrates it (so a pending migration is rehearsed on real data first), runs the suite on a backend and a Vite it starts itself on ports 8100 and 5180, and drops the copy whatever the outcome. The config refuses to run without that database, refuses any database whose name does not end in `_e2e`, never reuses a running server, and has no AI key, so the suite cannot spend. R-2 goes with it: the suite can no longer turn an answer into a manual one in your data |

It was written test-first: five architecture guards failed first, then passed. One choice differs from the plan. Gate C still puts Greece's answer back after each test, because a later spec ranks with `local_employment`, which enforces that gate; on the copy, that reset can no longer touch your data.

**Checked:**

- `make ui-check` is green: 1,558 tests, eslint without errors.
- A real `make e2e`: 32 of 32 passed in 37 s, **your live database identical before and after**, and no `_e2e` database left behind.
- Refused as intended: no backup ("run make backup"), a bare `playwright test` ("run the browser suite with `make e2e`"), a URL pointing at the live database (refused by name, without printing the password), and a busy backend port (the backend cannot bind, and the copy is still dropped).
- The Greece answer: `make backup` took `backups/20261020-165241.dump`, then one transaction deleted the suite's `not_manually_excluded` answer for Greece. It refused unless exactly that one row matched (manual, `matching`, no reason, no override); it had no citations. Your ranking is unchanged: Greece 46, matching.
- Independent review: one real gap, three minor points, all fixed in `854d78a`.
  - The guards checked keywords, not what each server is started with: deleting the backend's database line would have sent it back to your live database through `.env`, with every guard green. They now read each server's entry: no reuse, the e2e database, no AI key, Vite proxying to the e2e backend.
  - `make e2e E2E_DB=<your database>` would have dropped and restored over your live database before Playwright could refuse. The name is now derived and cannot be passed.
  - A restore or migration that fails now drops the copy at once, and a stale setup comment in minE2E was corrected.
- **An incident of mine while verifying, repaired at once.** To force a migration failure I passed `DATABASE_PORT=1` to `make`. GNU make exports command-line variables to its recipes, so `docker compose` read it and recreated your database container with its port published on 1 instead of 5432. The data volume was untouched: your live data is identical to the snapshot before. I recreated the container with the normal port, the backend reconnected by itself, and the ranking is unchanged. The failure path was then verified safely, with a variable `compose.yaml` never reads.
