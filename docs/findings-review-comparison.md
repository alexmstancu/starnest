# Independent findings verification comparison

**Date:** 2026-10-12  
**Baseline:** `7182d376ebb1d59cfff984b9f3d2a646303d23c3`

Both models independently reviewed every finding at maximum reasoning effort, using the documentation, current implementation, and relevant tests. Verification was static-only: no application tests, services, databases, migrations, or external calls were executed.

**Sources:** [Original findings](copilot-review.md), [GPT-6 Astra reasoning](gpt-6-astra-findings-review.md), [Claude Opus 5 reasoning](claude-opus-5-findings-review.md), and the [fresh Claude Opus 5 third adjudication](claude-opus-5-third-review.md).

GPT-6 Astra returned **88 REAL, 2 UNREAL, 1 UNCERTAIN**. Claude Opus 5 returned **91 REAL, 0 UNREAL, 0 UNCERTAIN**. They agree on **88 findings**, all REAL, and differ on **BE-11, BE-13, and BE-36**.

The table preserves the original IDs, order, severity labels, and both independent model verdicts. Summaries describe the reported issue; the decision column records the outcome of the requested adjudication process. REAL can include an accurately scoped known/deferred limitation or latent integrity gap; it does not establish runtime incidence or automatically require remediation. BE-35 remains folded into ST-18, as in the original report.

**Actions applied:** 88 `no-op`, 2 `third-review`, and 1 `verify`. `no-op` accepts the agreed REAL verdict without further investigation in this phase; it does not mean a confirmed problem will never require remediation. A fresh Claude Opus 5 subagent at maximum effort adjudicated BE-11 and BE-13; its verdicts are adopted unchanged. The coordinator directly reassessed BE-36 against both arguments, the original finding, documentation, implementation, and tests.

**Final decisions:** **89 REAL, 1 UNREAL, 1 left empty**. BE-36's action is complete, but its classification remains blocked by an unspecified validity/override policy. The empty decision and its blocker are intentional under the agreed unresolved-case policy, not an omitted review. No application code was changed and no application tests or database operations were executed.

| nr | finding_id | finding_summary | severity | gpt-6-astra | claude-opus-5 | action | decision |
|---:|---|---|---|---|---|---|---|
| 1 | UI-01 | nginx's 60-second read timeout can interrupt synchronous paid gate research before its result and actual cost reach the browser. Continued work after disconnection was not runtime-verified. | High | REAL | REAL | no-op | REAL |
| 2 | UI-02 | Whole-bucket failed/unanswered retry buttons start a request without the estimate and confirmation used by selected-item retries. They also cannot convey explicit uncapped acceptance. | High | REAL | REAL | no-op | REAL |
| 3 | UI-03 | Browser tests replace global Greece gate answers without restoring the previous answer and provenance. A sanity test can also leave a changed spend cap after an intervening failure. | High | REAL | REAL | no-op | REAL |
| 4 | UI-04 | Unguarded asynchronous completions can merge old-set responses into a newly selected set or overwrite newer weights and run selections. | Medium | REAL | REAL | no-op | REAL |
| 5 | UI-05 | Multiple release/blur handlers can commit the same pillar-slider gesture before the server prop updates, creating duplicate rebalance requests. | Medium | REAL | REAL | no-op | REAL |
| 6 | UI-06 | Save completion replaces or clears the current draft even when the user entered newer edits while the request was pending. | Medium | REAL | REAL | no-op | REAL |
| 7 | UI-07 | Other source controls remain usable during a reorder, allowing interleaved priority writes. A mid-sequence failure leaves persisted partial changes without refreshing the displayed order. | Medium | REAL | REAL | no-op | REAL |
| 8 | UI-08 | Undo-history keys omit criteria-set identity, so consecutive edits to one attribute in different sets can collapse and undo into the wrong set. | Medium | REAL | REAL | no-op | REAL |
| 9 | UI-09 | Reversing only the edited weight cannot recover sibling proportions after they were reduced to zero, despite the UI presenting the operation as undo. | Medium | REAL | REAL | no-op | REAL |
| 10 | UI-10 | Nonblank invalid numeric settings can become NaN or infinity and serialize as null, clearing configuration rather than reporting invalid input. | Medium | REAL | REAL | no-op | REAL |
| 11 | UI-11 | Relevant writes do not invalidate persistent sidebar resources, leaving household context, match counts, or the last-run summary stale. | Medium | REAL | REAL | no-op | REAL |
| 12 | UI-12 | Rule-effect explanations count unconfirmed proposals as exclusions and describe compound rules as affecting nobody even when warnings apply. | Medium | REAL | REAL | no-op | REAL |
| 13 | UI-13 | Confirmation omits a proposal's reference period and does not display it. The loss is latent while the current researcher supplies no periods. | Low | REAL | REAL | no-op | REAL |
| 14 | UI-14 | The proposal screen discards actual research cost, call count, and cap-halt status, leaving partial completion and spending undisclosed. | Medium | REAL | REAL | no-op | REAL |
| 15 | UI-15 | Alternative/rejected values display the selected value's score and contribution, while active descriptive or excluded values can be labeled Scored. | Medium | REAL | REAL | no-op | REAL |
| 16 | UI-16 | Candidate provenance fetches only one 500-value page while claiming to show every stored observation. | Medium | REAL | REAL | no-op | REAL |
| 17 | UI-17 | Only ten runs feed the claimed complete history and monthly-spend total, omitting older runs and their recorded costs. | Medium | REAL | REAL | no-op | REAL |
| 18 | UI-18 | Score presentation assumes a 100-point maximum and can clamp valid larger pillar scores to 100 or mislabel live/frozen scales. | Medium | REAL | REAL | no-op | REAL |
| 19 | UI-19 | Raw focus-minus-comparator deltas are presented with comparator-minus-focus desirability semantics, reversing ahead/behind meaning for some goals. | Medium | REAL | REAL | no-op | REAL |
| 20 | UI-20 | External-score rows omit reference and retrieval dates, so users cannot distinguish edition age despite the provenance requirement. | Medium | REAL | REAL | no-op | REAL |
| 21 | UI-21 | Repeat folding ignores quotes and citations, hiding distinct evidence behind observations with equal numeric payloads. | Medium | REAL | REAL | no-op | REAL |
| 22 | UI-22 | Acquisition diff decides whether measurements changed by comparing rounded display strings rather than underlying payloads. | Low | REAL | REAL | no-op | REAL |
| 23 | UI-23 | Browser-gate selectors expect obsolete attribute-ID labels and comparison markup that disagree with the current product. This is a test-suite defect, not proof of broken product behavior. | Medium | REAL | REAL | no-op | REAL |
| 24 | UI-24 | Acquire does not poll its displayed running/stopping report; it stays stale until manual Refresh despite the live-progress requirement. | Medium | REAL | REAL | no-op | REAL |
| 25 | UI-25 | Clearing comparison focus produces an empty string that leaves Compare enabled, but submission silently does nothing. | Low | REAL | REAL | no-op | REAL |
| 26 | UI-26 | Tabbing into a household-picker option starts a blur timer that closes the list and removes the focused option. | Low | REAL | REAL | no-op | REAL |
| 27 | UI-27 | Candidate-roster read failures become empty required pickers without an actionable error or retry, blocking household/manual-entry workflows. | Medium | REAL | REAL | no-op | REAL |
| 28 | UI-28 | A successful empty criteria-set refresh is treated like loading and retains a deleted selection, reachable through overlapping or independent deletions. | Low | REAL | REAL | no-op | REAL |
| 29 | UI-29 | No UI workflow independently enters or overrides a gate answer; the exposed write only confirms a proposal unchanged. | Medium | REAL | REAL | no-op | REAL |
| 30 | UI-30 | External-score React keys omit reference-period end, allowing distinct same-start editions to collide. | Low | REAL | REAL | no-op | REAL |
| 31 | UI-31 | Settings help says an unset comparator limit means unlimited comparison, although the backend refuses comparisons until it is set. | Low | REAL | REAL | no-op | REAL |
| 32 | UI-32 | The UI treats source-priority membership as adapter capability and makes unsupported claims about whether acquisition can answer an attribute. | Medium | REAL | REAL | no-op | REAL |
| 33 | UI-33 | Multiple adapters sharing a publisher produce duplicate plan-row keys and indistinguishable counts in the Per source table. | Low | REAL | REAL | no-op | REAL |
| 34 | BE-01 | Criterion matching thresholds are stored and served but never evaluated when deciding a candidate's match status. | High | REAL | REAL | no-op | REAL |
| 35 | BE-02 | Normalised criterion scores are rounded before weighting, which can change displayed totals and reverse rankings. | High | REAL | REAL | no-op | REAL |
| 36 | BE-03 | An insufficient-scoreability return precedes gate and compound-rule evaluation, suppressing definite non-matches and warnings. | High | REAL | REAL | no-op | REAL |
| 37 | BE-04 | Legal exclusions can leave zero scoring mass and cause an unmapped ranking error. An empty zero-weight pillar is also refused despite zero weight being a suggested remedy. | Medium | REAL | REAL | no-op | REAL |
| 38 | BE-05 | Criterion validation permits normalisation methods prohibited for the attribute's semantic value type, leading to arbitrary scores or unscoreable columns. | Medium | REAL | REAL | no-op | REAL |
| 39 | BE-06 | Quantity validation does not check the declared unit/dimension, allowing a magnitude in one unit to be interpreted in another. | Medium | REAL | REAL | no-op | REAL |
| 40 | BE-07 | Confidence derivation is disconnected from production reads, so stale observations can retain their original HIGH grade in confidence summaries. | Medium | REAL | REAL | no-op | REAL |
| 41 | BE-08 | Rejected returned measurements are stored without corresponding acquisition failures, preventing selective failed-item retry from reaching them. | Medium | REAL | REAL | no-op | REAL |
| 42 | BE-09 | WHO constructs observations without common attribute-explicit validation. The credible-range bypass is latent under the current catalog. | Low | REAL | REAL | no-op | REAL |
| 43 | BE-10 | Retry wrappers do not forward the active cost meter, allowing absent or stale underlying meters to undermine cap enforcement or reject valid retries. | High | REAL | REAL | no-op | REAL |
| 44 | BE-11 | Selective retry expands exact failed/unanswered pairs into broader candidate-attribute rectangles, allegedly re-fetching unrelated work. The models differ on whether the explicit retry contract permits this. | Medium | UNREAL | REAL | third-review | REAL |
| 45 | BE-12 | Retry awaits completion despite returning 202 and omits the in-flight guard used by ordinary start, enabling blocking or overlapping passes. | High | REAL | REAL | no-op | REAL |
| 46 | BE-13 | Unanswered retry reintroduces paid-source eligibility rather than preserving an initial free-sweep decision. Current cap refusal overlaps BE-14; unexpected billing requires a different registry. | Medium | UNREAL | REAL | third-review | UNREAL |
| 47 | BE-14 | A free explicit scope can require a spend cap solely because an unrelated enabled paid adapter is registered. | Medium | REAL | REAL | no-op | REAL |
| 48 | BE-15 | Research, CLI acquisition, and stand-in consultation do not consistently honor disabled-source decisions, including paid gate research. | High | REAL | REAL | no-op | REAL |
| 49 | BE-16 | A legally configured zero cap is already exhausted at zero spend and halts an entirely free sweep after its first work. | Medium | REAL | REAL | no-op | REAL |
| 50 | BE-17 | Billed empty gate-research answers lose their cost and call count when converted to failed results, making the research cap ineffective on that path. | High | REAL | REAL | no-op | REAL |
| 51 | BE-18 | Negative configured prices or token estimates can understate spending and compromise the cap model. Astra separately narrows the original non-finite configuration claim. | Medium | REAL | REAL | no-op | REAL |
| 52 | BE-19 | Completed paid candidate outcomes remain buffered until an attribute fetch returns, so hard death can lose earlier completed answers and failures. | High | REAL | REAL | no-op | REAL |
| 53 | BE-20 | Some parser/conversion exceptions escape contextual source handling, abort remaining acquisition without recording the current failed item. | Medium | REAL | REAL | no-op | REAL |
| 54 | BE-21 | Loose request/domain validation boundaries can produce 500s, and ordinary framework validation errors do not use the promised uniform error body. | Medium | REAL | REAL | no-op | REAL |
| 55 | BE-22 | Unvalidated rename/duplicate copies can persist an empty-name criteria set that subsequent validated reads cannot load. | High | REAL | REAL | no-op | REAL |
| 56 | BE-23 | Unknown body/query fields and unsupported nulls can be ignored or coerced, resulting in silent no-ops, cleared settings/anchors, or unintended threshold values. | Low | REAL | REAL | no-op | REAL |
| 57 | BE-24 | Bulk acquisition/research silently intersects mixed valid and unknown scope IDs instead of reporting the omitted inputs. | Medium | REAL | REAL | no-op | REAL |
| 58 | BE-25 | Plans omit freshness filtering that execution applies, advertising work and cost that may be skipped or refused as nothing-to-fetch. | Medium | REAL | REAL | no-op | REAL |
| 59 | BE-26 | Weather aggregation accepts incomplete or misaligned nonempty series and labels their averages with the entire requested year/season. | Medium | REAL | REAL | no-op | REAL |
| 60 | BE-27 | Unquoted commas in current WDPA workings fields are accepted by the CSV parser and silently truncate methodology provenance. | Low | REAL | REAL | no-op | REAL |
| 61 | BE-28 | AssignedScore fallback uses an invalid constructor and cannot store an otherwise eligible paid answer. Current manual AssignedScores are excluded, making the branch latent. | Low | REAL | REAL | no-op | REAL |
| 62 | BE-29 | Source JSON is decoded through binary floats before Decimal conversion, losing publisher precision for long numeric tokens. | Low | REAL | REAL | no-op | REAL |
| 63 | BE-30 | Employer-response elements are stringified instead of validated as firm-name strings, allowing nulls, numbers, or objects to become labels. | Low | REAL | REAL | no-op | REAL |
| 64 | BE-31 | Comparison directly imports criteria despite the exhaustive dependency table, and the configured layer guard permits this forbidden edge. | Low | REAL | REAL | no-op | REAL |
| 65 | BE-32 | Bare pytest excludes paid live tests but still selects ordinary live-publisher tests, making the default invocation network-dependent. | Low | REAL | REAL | no-op | REAL |
| 66 | BE-33 | Known/deferred spending durability remains per source, so death before the current source returns loses its billed totals. | Low | REAL | REAL | no-op | REAL |
| 67 | BE-34 | Known/deferred gate research returns/logs spending but creates no durable billing record, leaving lost responses or process death unledgered. | Low | REAL | REAL | no-op | REAL |
| 68 | BE-36 | Finite-period confirmed gates keep applying and are skipped by research. Whether expiry should invalidate manual decisions remains a policy question. | Medium | UNCERTAIN | REAL | verify | |
| 69 | BE-37 | Fallback eligibility excludes an entire attribute whenever any structured adapter declares it, rather than considering candidate-specific gaps or failed sources. | Low | REAL | REAL | no-op | REAL |
| 70 | BE-38 | Backend coverage combines line and branch percentages into one floor, allowing one metric below the separately promised threshold. | Medium | REAL | REAL | no-op | REAL |
| 71 | BE-39 | Attribute responses serve only source-priority overrides rather than the contractually resolved order including remaining global sources. | Medium | REAL | REAL | no-op | REAL |
| 72 | ST-01 | The running-run check and insertion are not atomic, so concurrent starts can create multiple active acquisitions and duplicate financial work. | High | REAL | REAL | no-op | REAL |
| 73 | ST-02 | Whole-set read/modify/replace has no stale-version protection, allowing one successful edit to erase an unrelated concurrent decision. | Medium | REAL | REAL | no-op | REAL |
| 74 | ST-03 | Career retirement removes posting weights from every profile but compensates only named defaults, potentially invalidating customized or duplicated sets during upgrade. | High | REAL | REAL | no-op | REAL |
| 75 | ST-04 | Normalisation migrations overwrite custom fixed interpretations or violate valid target-range constraints, silently changing choices or blocking upgrade. | Medium | REAL | REAL | no-op | REAL |
| 76 | ST-05 | Type-correction migrations delete criteria without handling restrictive anchor/threshold children, blocking upgrades with configured interpretations. | Medium | REAL | REAL | no-op | REAL |
| 77 | ST-06 | Housing replacement transfers weight but hardcodes inclusion and unlocks, discarding prior user exclusion and lock decisions. | Medium | REAL | REAL | no-op | REAL |
| 78 | ST-07 | Saved evaluations omit supported interpretation fields and exact unscored rule-input evidence, preventing complete historical explanation after later changes. | Medium | REAL | REAL | no-op | REAL |
| 79 | ST-08 | Historical criteria read current attribute types even though migrations retype the same IDs, allowing saved interpretation to drift during upgrade. | Medium | REAL | REAL | no-op | REAL |
| 80 | ST-09 | Successful rereads of unchanged transcribed observations insert no new row or reuse association and are consequently reported as unanswered. | Medium | REAL | REAL | no-op | REAL |
| 81 | ST-10 | External-score queries return all editions without selecting or labeling the current edition, with incomplete deterministic ordering. | Low | REAL | REAL | no-op | REAL |
| 82 | ST-11 | Separate run-detail queries under READ COMMITTED can observe different snapshots and return counts inconsistent with their lists or source totals. | Low | REAL | REAL | no-op | REAL |
| 83 | ST-12 | SQL does not pin run-linked evidence to planned scope and level, allowing out-of-scope writes that break progress partition arithmetic. | Low | REAL | REAL | no-op | REAL |
| 84 | ST-13 | Saved contribution FKs do not pin evidence to the correct candidate/attribute or frozen criterion, permitting wrong provenance or reopening failure from faulty writes. | Low | REAL | REAL | no-op | REAL |
| 85 | ST-14 | Frozen criteria are not constrained to their evaluation's level, allowing contradictory generic snapshots through storage/SQL writers. | Low | REAL | REAL | no-op | REAL |
| 86 | ST-15 | SQL enforces payload-family agreement but not accepted-payload completeness or composition totals, allowing states that fail subsequent domain reads. | Low | REAL | REAL | no-op | REAL |
| 87 | ST-16 | SQL constraints named finite reject NaN only and permit numeric infinities that normal payload reads cannot accept. | Low | REAL | REAL | no-op | REAL |
| 88 | ST-17 | SQL permits multiple share bounds but the mapper keeps only the first, allowing an unrelated whole-set rewrite to delete remaining bounds. | Low | REAL | REAL | no-op | REAL |
| 89 | ST-18 | Known/deferred storage and API presentation omit the conversion rate's complete provenance despite an internal published-rate FK. | Low | REAL | REAL | no-op | REAL |
| 90 | ST-19 | Attribute-removing rollbacks ignore persistent run-scope references and fail on otherwise ordinary populated historical databases. | Low | REAL | REAL | no-op | REAL |
| 91 | ST-20 | The container migration path runs yoyo without enforcing the backup prerequisite present on the local migration path. | Medium | REAL | REAL | no-op | REAL |

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
