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

| nr | finding_id | finding_summary | severity | gpt-6-astra | claude-opus-5 | action | decision | fix_status |
|---:|---|---|---|---|---|---|---|---|
| 1 | UI-01 | nginx's 60-second read timeout can interrupt synchronous paid gate research before its result and actual cost reach the browser. Continued work after disconnection was not runtime-verified. | High | REAL | REAL | no-op | REAL | PARTIAL |
| 2 | UI-02 | Whole-bucket failed/unanswered retry buttons start a request without the estimate and confirmation used by selected-item retries. They also cannot convey explicit uncapped acceptance. | High | REAL | REAL | no-op | REAL | FIXED |
| 3 | UI-03 | Browser tests replace global Greece gate answers without restoring the previous answer and provenance. A sanity test can also leave a changed spend cap after an intervening failure. | High | REAL | REAL | no-op | REAL | PARTIAL |
| 4 | UI-04 | Unguarded asynchronous completions can merge old-set responses into a newly selected set or overwrite newer weights and run selections. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 5 | UI-05 | Multiple release/blur handlers can commit the same pillar-slider gesture before the server prop updates, creating duplicate rebalance requests. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 6 | UI-06 | Save completion replaces or clears the current draft even when the user entered newer edits while the request was pending. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 7 | UI-07 | Other source controls remain usable during a reorder, allowing interleaved priority writes. A mid-sequence failure leaves persisted partial changes without refreshing the displayed order. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 8 | UI-08 | Undo-history keys omit criteria-set identity, so consecutive edits to one attribute in different sets can collapse and undo into the wrong set. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 9 | UI-09 | Reversing only the edited weight cannot recover sibling proportions after they were reduced to zero, despite the UI presenting the operation as undo. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 10 | UI-10 | Nonblank invalid numeric settings can become NaN or infinity and serialize as null, clearing configuration rather than reporting invalid input. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 11 | UI-11 | Relevant writes do not invalidate persistent sidebar resources, leaving household context, match counts, or the last-run summary stale. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 12 | UI-12 | Rule-effect explanations count unconfirmed proposals as exclusions and describe compound rules as affecting nobody even when warnings apply. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 13 | UI-13 | Confirmation omits a proposal's reference period and does not display it. The loss is latent while the current researcher supplies no periods. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 14 | UI-14 | The proposal screen discards actual research cost, call count, and cap-halt status, leaving partial completion and spending undisclosed. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 15 | UI-15 | Alternative/rejected values display the selected value's score and contribution, while active descriptive or excluded values can be labeled Scored. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 16 | UI-16 | Candidate provenance fetches only one 500-value page while claiming to show every stored observation. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 17 | UI-17 | Only ten runs feed the claimed complete history and monthly-spend total, omitting older runs and their recorded costs. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 18 | UI-18 | Score presentation assumes a 100-point maximum and can clamp valid larger pillar scores to 100 or mislabel live/frozen scales. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 19 | UI-19 | Raw focus-minus-comparator deltas are presented with comparator-minus-focus desirability semantics, reversing ahead/behind meaning for some goals. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 20 | UI-20 | External-score rows omit reference and retrieval dates, so users cannot distinguish edition age despite the provenance requirement. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 21 | UI-21 | Repeat folding ignores quotes and citations, hiding distinct evidence behind observations with equal numeric payloads. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 22 | UI-22 | Acquisition diff decides whether measurements changed by comparing rounded display strings rather than underlying payloads. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 23 | UI-23 | Browser-gate selectors expect obsolete attribute-ID labels and comparison markup that disagree with the current product. This is a test-suite defect, not proof of broken product behavior. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 24 | UI-24 | Acquire does not poll its displayed running/stopping report; it stays stale until manual Refresh despite the live-progress requirement. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 25 | UI-25 | Clearing comparison focus produces an empty string that leaves Compare enabled, but submission silently does nothing. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 26 | UI-26 | Tabbing into a household-picker option starts a blur timer that closes the list and removes the focused option. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 27 | UI-27 | Candidate-roster read failures become empty required pickers without an actionable error or retry, blocking household/manual-entry workflows. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 28 | UI-28 | A successful empty criteria-set refresh is treated like loading and retains a deleted selection, reachable through overlapping or independent deletions. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 29 | UI-29 | No UI workflow independently enters or overrides a gate answer; the exposed write only confirms a proposal unchanged. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 30 | UI-30 | External-score React keys omit reference-period end, allowing distinct same-start editions to collide. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 31 | UI-31 | Settings help says an unset comparator limit means unlimited comparison, although the backend refuses comparisons until it is set. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 32 | UI-32 | The UI treats source-priority membership as adapter capability and makes unsupported claims about whether acquisition can answer an attribute. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 33 | UI-33 | Multiple adapters sharing a publisher produce duplicate plan-row keys and indistinguishable counts in the Per source table. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 34 | BE-01 | Criterion matching thresholds are stored and served but never evaluated when deciding a candidate's match status. | High | REAL | REAL | no-op | REAL | PARTIAL |
| 35 | BE-02 | Normalised criterion scores are rounded before weighting, which can change displayed totals and reverse rankings. | High | REAL | REAL | no-op | REAL | FIXED |
| 36 | BE-03 | An insufficient-scoreability return precedes gate and compound-rule evaluation, suppressing definite non-matches and warnings. | High | REAL | REAL | no-op | REAL | FIXED |
| 37 | BE-04 | Legal exclusions can leave zero scoring mass and cause an unmapped ranking error. An empty zero-weight pillar is also refused despite zero weight being a suggested remedy. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 38 | BE-05 | Criterion validation permits normalisation methods prohibited for the attribute's semantic value type, leading to arbitrary scores or unscoreable columns. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 39 | BE-06 | Quantity validation does not check the declared unit/dimension, allowing a magnitude in one unit to be interpreted in another. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 40 | BE-07 | Confidence derivation is disconnected from production reads, so stale observations can retain their original HIGH grade in confidence summaries. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 41 | BE-08 | Rejected returned measurements are stored without corresponding acquisition failures, preventing selective failed-item retry from reaching them. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 42 | BE-09 | WHO constructs observations without common attribute-explicit validation. The credible-range bypass is latent under the current catalog. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 43 | BE-10 | Retry wrappers do not forward the active cost meter, allowing absent or stale underlying meters to undermine cap enforcement or reject valid retries. | High | REAL | REAL | no-op | REAL | NOT_FIXED |
| 44 | BE-11 | Selective retry expands exact failed/unanswered pairs into broader candidate-attribute rectangles, allegedly re-fetching unrelated work. The models differ on whether the explicit retry contract permits this. | Medium | UNREAL | REAL | third-review | REAL | NOT_FIXED |
| 45 | BE-12 | Retry awaits completion despite returning 202 and omits the in-flight guard used by ordinary start, enabling blocking or overlapping passes. | High | REAL | REAL | no-op | REAL | FIXED |
| 46 | BE-13 | Unanswered retry reintroduces paid-source eligibility rather than preserving an initial free-sweep decision. Current cap refusal overlaps BE-14; unexpected billing requires a different registry. | Medium | UNREAL | REAL | third-review | UNREAL | N/A |
| 47 | BE-14 | A free explicit scope can require a spend cap solely because an unrelated enabled paid adapter is registered. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 48 | BE-15 | Research, CLI acquisition, and stand-in consultation do not consistently honor disabled-source decisions, including paid gate research. | High | REAL | REAL | no-op | REAL | FIXED |
| 49 | BE-16 | A legally configured zero cap is already exhausted at zero spend and halts an entirely free sweep after its first work. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 50 | BE-17 | Billed empty gate-research answers lose their cost and call count when converted to failed results, making the research cap ineffective on that path. | High | REAL | REAL | no-op | REAL | NOT_FIXED |
| 51 | BE-18 | Negative configured prices or token estimates can understate spending and compromise the cap model. Astra separately narrows the original non-finite configuration claim. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 52 | BE-19 | Completed paid candidate outcomes remain buffered until an attribute fetch returns, so hard death can lose earlier completed answers and failures. | High | REAL | REAL | no-op | REAL | NOT_FIXED |
| 53 | BE-20 | Some parser/conversion exceptions escape contextual source handling, abort remaining acquisition without recording the current failed item. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 54 | BE-21 | Loose request/domain validation boundaries can produce 500s, and ordinary framework validation errors do not use the promised uniform error body. | Medium | REAL | REAL | no-op | REAL | PARTIAL |
| 55 | BE-22 | Unvalidated rename/duplicate copies can persist an empty-name criteria set that subsequent validated reads cannot load. | High | REAL | REAL | no-op | REAL | FIXED |
| 56 | BE-23 | Unknown body/query fields and unsupported nulls can be ignored or coerced, resulting in silent no-ops, cleared settings/anchors, or unintended threshold values. | Low | REAL | REAL | no-op | REAL | PARTIAL |
| 57 | BE-24 | Bulk acquisition/research silently intersects mixed valid and unknown scope IDs instead of reporting the omitted inputs. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 58 | BE-25 | Plans omit freshness filtering that execution applies, advertising work and cost that may be skipped or refused as nothing-to-fetch. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 59 | BE-26 | Weather aggregation accepts incomplete or misaligned nonempty series and labels their averages with the entire requested year/season. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 60 | BE-27 | Unquoted commas in current WDPA workings fields are accepted by the CSV parser and silently truncate methodology provenance. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 61 | BE-28 | AssignedScore fallback uses an invalid constructor and cannot store an otherwise eligible paid answer. Current manual AssignedScores are excluded, making the branch latent. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 62 | BE-29 | Source JSON is decoded through binary floats before Decimal conversion, losing publisher precision for long numeric tokens. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 63 | BE-30 | Employer-response elements are stringified instead of validated as firm-name strings, allowing nulls, numbers, or objects to become labels. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 64 | BE-31 | Comparison directly imports criteria despite the exhaustive dependency table, and the configured layer guard permits this forbidden edge. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 65 | BE-32 | Bare pytest excludes paid live tests but still selects ordinary live-publisher tests, making the default invocation network-dependent. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 66 | BE-33 | Known/deferred spending durability remains per source, so death before the current source returns loses its billed totals. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 67 | BE-34 | Known/deferred gate research returns/logs spending but creates no durable billing record, leaving lost responses or process death unledgered. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 68 | BE-36 | Finite-period confirmed gates keep applying and are skipped by research. Whether expiry should invalidate manual decisions remains a policy question. | Medium | UNCERTAIN | REAL | verify | | NOT_FIXED |
| 69 | BE-37 | Fallback eligibility excludes an entire attribute whenever any structured adapter declares it, rather than considering candidate-specific gaps or failed sources. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 70 | BE-38 | Backend coverage combines line and branch percentages into one floor, allowing one metric below the separately promised threshold. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 71 | BE-39 | Attribute responses serve only source-priority overrides rather than the contractually resolved order including remaining global sources. | Medium | REAL | REAL | no-op | REAL | FIXED |
| 72 | ST-01 | The running-run check and insertion are not atomic, so concurrent starts can create multiple active acquisitions and duplicate financial work. | High | REAL | REAL | no-op | REAL | FIXED |
| 73 | ST-02 | Whole-set read/modify/replace has no stale-version protection, allowing one successful edit to erase an unrelated concurrent decision. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 74 | ST-03 | Career retirement removes posting weights from every profile but compensates only named defaults, potentially invalidating customized or duplicated sets during upgrade. | High | REAL | REAL | no-op | REAL | FIXED |
| 75 | ST-04 | Normalisation migrations overwrite custom fixed interpretations or violate valid target-range constraints, silently changing choices or blocking upgrade. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 76 | ST-05 | Type-correction migrations delete criteria without handling restrictive anchor/threshold children, blocking upgrades with configured interpretations. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 77 | ST-06 | Housing replacement transfers weight but hardcodes inclusion and unlocks, discarding prior user exclusion and lock decisions. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 78 | ST-07 | Saved evaluations omit supported interpretation fields and exact unscored rule-input evidence, preventing complete historical explanation after later changes. | Medium | REAL | REAL | no-op | REAL | PARTIAL |
| 79 | ST-08 | Historical criteria read current attribute types even though migrations retype the same IDs, allowing saved interpretation to drift during upgrade. | Medium | REAL | REAL | no-op | REAL | PARTIAL |
| 80 | ST-09 | Successful rereads of unchanged transcribed observations insert no new row or reuse association and are consequently reported as unanswered. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |
| 81 | ST-10 | External-score queries return all editions without selecting or labeling the current edition, with incomplete deterministic ordering. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 82 | ST-11 | Separate run-detail queries under READ COMMITTED can observe different snapshots and return counts inconsistent with their lists or source totals. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 83 | ST-12 | SQL does not pin run-linked evidence to planned scope and level, allowing out-of-scope writes that break progress partition arithmetic. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 84 | ST-13 | Saved contribution FKs do not pin evidence to the correct candidate/attribute or frozen criterion, permitting wrong provenance or reopening failure from faulty writes. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 85 | ST-14 | Frozen criteria are not constrained to their evaluation's level, allowing contradictory generic snapshots through storage/SQL writers. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 86 | ST-15 | SQL enforces payload-family agreement but not accepted-payload completeness or composition totals, allowing states that fail subsequent domain reads. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 87 | ST-16 | SQL constraints named finite reject NaN only and permit numeric infinities that normal payload reads cannot accept. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 88 | ST-17 | SQL permits multiple share bounds but the mapper keeps only the first, allowing an unrelated whole-set rewrite to delete remaining bounds. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 89 | ST-18 | Known/deferred storage and API presentation omit the conversion rate's complete provenance despite an internal published-rate FK. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 90 | ST-19 | Attribute-removing rollbacks ignore persistent run-scope references and fail on otherwise ordinary populated historical databases. | Low | REAL | REAL | no-op | REAL | NOT_FIXED |
| 91 | ST-20 | The container migration path runs yoyo without enforcing the backup prerequisite present on the local migration path. | Medium | REAL | REAL | no-op | REAL | NOT_FIXED |

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
