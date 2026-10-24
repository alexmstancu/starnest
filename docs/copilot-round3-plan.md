# Round 3 plan: every built feature works to its specification

**Owner:** Copilot, end to end. **Status:** awaiting your approval and your decisions. No code has been written.
**Baseline:** `master` at `7a5d8e6`, 2026-10-24.

**Inputs.** The UI functional review (`docs/ui-functional-review.md`, UF-001 to UF-144). The earlier round-3 draft and its Appendix B. Seven read-only consequence maps (gates, saved rankings, runs, integrity, UI, tooling, history). The trackers: `docs/findings-review-comparison.md`, `docs/copilot-remediation-plan.md` section 7, `docs/known-issues.md` and `docs/copilot-cross-model-review.md`. The specification: `docs/design/` (README, UX-REVIEW, DECISIONS, the live `.dc.html` and the screens), `docs/design-brief.md` and `docs/reqs.md`. The live-data checks of 2026-10-23.

The maps, the scans and the draft live in the session folder, not in the repository: `/Users/alex/.copilot/session-state/2667687a-14e9-4ce1-bec9-56f98115158b/files/`. The master list is also there as a CSV, `plan-work/master-list.csv`, with one extra column: the review's original ids (SH-, CA-, CB-, AQ-, RK-, CP-, HO-) behind each UF finding.

## Contents

1. Summary
2. Master list
3. Feature clusters
4. Phases and order
5. The process for every cluster
6. Decisions
7. The sections the planning rule requires
8. Coordination with the other agent
9. Completeness check

## 1. Summary

**What will be done.** Fix everything that is open in built functionality, one feature at a time, until each feature matches its specification: the design handoff, the design brief and the requirements. That covers the 144 findings of the UI review, the 40 items of the earlier round-3 draft and the 58 defects the maps found on the way. Each feature is fixed completely in one cluster, all severities at once, under the causal-change protocol. A feature is done only when an agent has walked through it in a real browser and confirmed every item of its design section.

**How many.** 242 sources merge into **182 plan items**, PL-001 to PL-182. Two items are excluded, with their reasons in section 2.

| Severity | Items |
|---|---:|
| Critical | 8 |
| High | 13 |
| Medium | 67 |
| Low | 80 |
| Nit | 14 |
| **Total** | **182** |

An item takes the highest severity among its sources, re-rated by the review's scale. Two round-3 items rise: **UI-18 becomes Critical** (at any score range but 100 the screen shows wrong scores, and Settings accepts such a range today), and **UI-29 becomes High** (recording a gate answer is a specified feature missing from a core workflow). Where a defect can be reached only by an API client, by SQL or by a developer's mistake, the source rating stands.

**Order.** Three phases, seventeen clusters.

| Phase | Clusters | Why here |
|---|---|---|
| 1. Critical features, shared mechanisms first | C01 The shell and truthful states. C02 Forms. C03 Criteria-set management. C04 Runs: accounting, evidence and the diff. C05 Rank. C06 Hand entry. C07 Compare | Every cluster with a Critical item. C01 and C02 also build the mechanisms most other work depends on: read states, errors, names, session state and input parsing |
| 2. The remaining features | C08 Weights, locks and held controls. C09 Acquire: starting, following, stopping and retrying. C10 Source priority. C11 The change history. C12 Saved rankings and the evaluation tree. C13 Gates and research. C14 The household | High and Medium items, ordered by what each needs from the others |
| 3. Integrity, tooling and docs | C15 Data integrity in SQL, and the contract. C16 Tooling and rollbacks. C17 Docs, dead code and trackers, then the final convergence review | Low items, plus one Medium (PL-178) that only a deliberate rollback can reach |

The hard ordering rules from the maps all hold: FU-A1 lands before ST-12 (both in C04); FU-A3 and FU-A4 share one migration (C12); ST-13 and ST-14 come last in C12; NEW-68 lands with NEW-46 (C08); NEW-67 lands before P99 (C11); P100 is the first tooling item (C16).

**The new definition of done.** A feature is done when all six hold:
1. Its consequence map was reported to you, and you approved any undesired consequence before code.
2. Its tests were written first, including browser tests, and each was mutation-checked.
3. Every commit passed `make check`, and `make e2e` for interface, infrastructure and migration work.
4. **An agent walked through it in a real browser, on a copy of your data, and confirmed every item of its design section.**
5. A model other than Claude reviewed it and left nothing unresolved at Medium or above.
6. The trackers carry the commit for each item.

**Size and calendar.**

| Work | Count | Hours each | Hours |
|---|---:|---:|---:|
| S items | 92 | 1 | 92 |
| M items | 75 | 3 | 225 |
| L items | 15 | 8 | 120 |
| Protocol per cluster: map, walkthrough, review and its fixes, trackers | 17 | 8 | 136 |
| Migration rehearsal and deploy | 15 | 1 | 15 |
| Allowance for what reviews find, 20% | | | 118 |
| **Total** | | | **about 706** |

The assumption: an hour is one hour of one agent's work, including tests first, mutation checks and gate runs, and the agent works 10 such hours each working day. That gives about 71 working days, **about 14 working weeks**. The last round fixed 22 small findings, with their reviews, in about two days, which is faster than these units. At about half of them (S half an hour, M two hours, L six, and 6 hours per cluster), the total is about 460 hours, **about 9 weeks**. Both figures assume each cluster's decisions are answered before it starts and each review comes back the same day. A decision that waits a day delays every cluster behind it by a day.

**Your decisions.** **70 decisions, 9 of them major**, are in section 6, grouped by cluster, each with its options, a recommendation first, and why it cannot be defaulted. The major ones change architecture or scope, or depart from a recorded decision or from `reqs.md`. Two of them (D2 and D46) touch phase 1, so they are best taken before any code starts.

**Decided on 2026-10-24:**
- **The plan:** approved with its recommendations. Each cluster's decisions are put to you, with their recommendations, when the cluster starts.
- **D2:** keep Q168. Edits write straight to the set and Recent changes undoes them. The divergence from the design is recorded in the design brief (PL-180).
- **D46:** a saved ranking shows its evidence. That is:
  - the gate answer and the judged figure behind each refusal;
  - a warning's inputs;
  - each contribution's figure, with its source and dates;
  - the frozen score scale.

  The saved view gains pillars, Δ home and a drill-down.
- **Pace:** two parallel lanes with strict file ownership (section 5.1).

## 2. Master list

Every open item, merged across the three sources. The same table is in `plan-work/master-list.csv` in the session folder.

**How items were merged.** Two sources become one item when they report the same defect, or when one fix closes both. A sibling the maps found inside a finding's files joins that finding. Every source id is kept. One source id appears twice on purpose: BE-11, whose two remaining gaps are FU-A1 and FU-A2.

**Source ids.**
- **UF-001 to UF-144:** the UI functional review. Its appendix maps each UF id to the original scan and browser ids.
- **Round-3 items:** FU-A1 to FU-A4, FU-A6, UI-18, UI-24, UI-29, BE-36, ST-10 to ST-18, KT-A4, the NEW- ids, P93 to P100. Tracker ids that name the same work are kept beside them: BE-11 (now FU-A1 and FU-A2), ST-07 (now FU-A3 and FU-A4), P10 and BE-35 (now ST-18).
- **Mapping finds**, prefixed by the map that found them:
  - UI map: NEW-55-S1, NEW-55-S2, NEW-56-S1 to S6, NEW-46-S1, NEW-46-S2, P99-S1 to S3, E2E-1, as the map names them;
  - gates map: G-S1 to G-S9 (its S1 to S9);
  - saved-rankings map: SV-N1 to SV-N10 (its N1 to N10);
  - runs map: RN-R1 to RN-R4 (its R1 to R4);
  - integrity map: IN-D1 (`score_delta` sent as null), IN-D2 (`CompoundRule.level` nullable), IN-D3 (`RunDetail` descriptions), IN-NAN (about twenty more numeric columns that accept NaN or Infinity), IN-LABEL (the label-threshold table can make a set unreadable);
  - tooling map: TL-N1 to TL-N6 (its N1 to N6);
  - history map: H-S1 to H-S7 and H-L1 to H-L3 (its siblings S1 to S7 and L1 to L3).

**Severity.** The highest of the item's sources, re-rated by the review's scale. *Critical:* wrong numbers shown or stored, data lost without recovery, money spent or hidden unexpectedly, or a core workflow impossible. *High:* a specified feature missing or broken in a core workflow. *Medium:* a partial feature or misleading behaviour. *Low:* minor. *Nit:* cosmetic. I raised a rating only where the scale clearly applies on a path you can take through the app. Raised: UI-18 (Medium to Critical) and UI-29 (Medium to High). Rated here for the first time: NEW-23 (Medium: a contradicted figure is kept and reported as re-confirmed, though only a developer's edit can cause it, and the live figures are sound), NEW-68 (Low), the mapping finds as their maps rated them, and TL-N2 with SV-N1 (Medium, because they break your 2026-10-22 rule that a rollback never deletes recorded history without refusing).

**Size.** S is about an hour of agent work, M about three, L about a day, each including tests first and mutation checks. "Depends on" lists what must land first. Every interface item also relies on C01's shared states and C02's parser; that is not repeated on each row. In the last three columns, "if chosen" means the answer depends on a decision in section 6.

**Excluded, with the reason:**
- **NEW-21**, one database connection for everything. It is a design choice you made ("keep one until a slowdown is measured"), not a defect, and ST-11's fix (PL-044) stops relying on it.
- **NEW-25**, breakdown reduction. It belongs to the city level, which is not built. It goes to the v2 plan.

### The items, cluster by cluster

#### C01 The shell and truthful states (phase 1): PL-001 to PL-023

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-001 | UF-001 | Critical | Reads still loading or failed are shown as facts: zeros, "not set", "no figure stored" | One read state for every panel (pending, ready, refreshing, failed): a dash or a skeleton while pending, the error card with Try again on failure, never a default value. Guard: the read result is a union type, so data cannot be read before it exists, plus a browser sweep that fails each read once. | L | none | no | no | no |
| PL-002 | UF-002 | High | When the server is down every screen says the response "has a shape this interface does not recognise", with no Try again and no recovery | Map 502, 503, 504 and an empty-bodied 500 to "server not reachable" (retryable) before the shape check; one error card per screen; Try again re-reads. | M | PL-001 | no | no | no |
| PL-003 | UF-003 | Medium | Error notices print codes, the server's raw sentences and database text, in monospace, without the round-4 title or reassurance | Rebuild the shared notice as the round-4 card; word every code the contract names; the server's refusal sentences use names, never ids, environment variables or SQL. Guards: every code in openapi.yaml has wording; no code string is ever rendered. | L | PL-001 | no | no | yes |
| PL-004 | UF-079 | Medium | Refusal banners cannot be dismissed, and their "Try again" retries nothing | Every refusal has Dismiss; Try again appears only where it re-sends the request; the refusal sits beside the control that was pressed. | M | PL-003 | no | no | no |
| PL-005 | UF-004 | Medium | An unset score range is half handled: the sidebar loses Total and shows red, Compare keeps its picker, Rank keeps Save | Read the candidate count apart from the ranking; Total with the amber line; Rank and Compare replaced by their "not set" cards; Save and the attribute panel hidden. | M | PL-001 | no | no | no |
| PL-006 | UF-110 | Medium | Legitimate states leave Rank on a red error made of ids, with no way out | Word both refusals plainly with a route to Configure; the server refuses a score range below the anchors when the setting is saved. | M | PL-003 | no | yes | yes |
| PL-007 | UF-142 | Low | Every comparison refusal offers "Change it in Configure", even when no setting is to blame, and prints raw ids | Offer the remedy only when the limit is to blame (a distinct code or detail); refusals name candidates and settings. | S | PL-003 | no | yes | yes |
| PL-008 | UF-008 | Medium | The sidebar's household card says "Nothing has been recorded" when it simply could not read | Say "not recorded" only on the server's household_not_configured; otherwise the error card with Try again; delete the dead branch. | S | PL-001 | no | no | no |
| PL-009 | UF-016 | Low | A criteria-set list that is loading or has failed reads as "no sets", with instructions that cannot be followed | The selection carries its own loading and error states to every screen; a failed read never enables a level. | M | PL-001 | no | no | no |
| PL-010 | UF-009 | Medium | Every re-read blanks what it re-reads, so content jumps under the pointer | Keep the previous data while a re-read is in flight (stale-while-revalidate in the shared read hook); only a first load shows loading. | M | PL-001 | no | no | no |
| PL-011 | UF-011 | Medium | Empty states are missing or misleading on all four tabs | Detect "no sets" and "no values" from server data and draw the four designed cards, each with its one action. | M | PL-001 | no | no | no |
| PL-012 | UF-012 | Medium | Loading is a plain "Loading…" line: no skeletons, no busy flag, content pops in | One skeleton primitive with per-screen shapes in the stylesheet, aria-busy while loading, the page title drawn at once, no pulse under reduced motion. | M | PL-001 | no | no | no |
| PL-013 | UF-065 | Low | Configure stages lose their card and heading while loading or after a failure, so the stage numbers shift | Always draw each stage's card and heading, with its loading or error state inside. | S | PL-001 | no | no | no |
| PL-014 | UF-053 | Low | A failed attribute-catalog read is silent, so unsourced attributes look sourced | A one-line notice with Try again in stage 3. | S | PL-001 | no | no | no |
| PL-015 | UF-005 | Medium | When an acquisition ends, the sidebar updates but an open Rank or a drawn comparison does not | The "acquisition ended" signal becomes a freshness key for Rank's ranking, its open details and a drawn comparison; a save reads back what it kept. | M | PL-010 | no | no | no |
| PL-016 | UF-006 | Medium | Compare and Rank forget their state on every tab change, criteria-set switch and reload | A session store above the routes holds Compare's selection and view choices and Rank's open rows; reset only on a level change; the comparison is redrawn on return. | M | none | no | no | no |
| PL-017 | UF-007 | Medium | The active criteria set is forgotten on reload; the app reopens on whichever set id sorts first | Keep the set and level in the address and the session store; fall back to the first set only when the stored one no longer exists. | S | PL-016 | no | no | no |
| PL-018 | UF-015 | Low | Routes to a setting or section land at the top of the page, thousands of pixels from the target | Extend the ?show= highlight to the limits, the household and the history; scroll the target into view, focus it, keep the highlight until the reader acts; mark the attribute's row. | M | none | no | no | no |
| PL-019 | UF-134 | Medium | An unset comparator limit, the shipped state, is a red error naming a settings key and a screen that does not exist | Treat it like the unset score range: the calm "not set" card, the setting named in words, a route that lands on it. | S | PL-003, PL-018 | no | no | no |
| PL-020 | UF-010 | Medium | Times are shown in UTC with no label, while Recent changes uses local time | One instant formatter in the browser's time zone (tests pin the zone); day-only dates stay dates. | M | none | no | no | no |
| PL-021 | UF-019 | Low | Every saved-ranking link, and several sidebar links, claim to be the current page | Plain links; aria-current only on the saved ranking that is open. | S | none | no | no | no |
| PL-022 | UF-020 | Low | Each screen's title is an h2; the brand is the page's only h1 | Each screen title is the h1 and the brand is not a heading; the two browser tests follow. | S | none | no | no | no |
| PL-023 | UF-021 | Low | The product name has two sources, and APP_DISPLAY_NAME never reaches the interface | The interface container writes config.json from APP_DISPLAY_NAME when it starts; the comments are corrected. | S | none | no | no | no |

#### C02 Forms: what is typed, refused and saved (phase 1): PL-024 to PL-032

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-024 | UF-026 | Critical | Number fields silently rewrite what is typed and report "Saved.": "72,000" is stored as 72 | One parser for every numeric field: it keeps what is typed and refuses with a message on the field, and never turns text into "unset". Guard: every numeric input under routes/ goes through it. | L | none | no | no | no |
| PL-025 | UF-033, UF-054, NEW-55, NEW-55-S1 | Medium | Forms do not say truthfully whether what is on screen is saved: drafts vanish silently, "Saved." outlives an edit, a first-save note outlives the save, and "Save rule" confirms nothing | One form save state (Not saved yet, Saving…, Saved.) for the household, the settings and the rule editor: any edit clears "Saved.", the first-save note goes once something is saved, stage 6's banners say they describe the draft, and leaving with a draft warns (per decision). | M | PL-024 | no | no | no |
| PL-026 | UF-036 | Medium | A refused rule save is reported out of view, with ids and a code, and the form snaps back | Check the band and the anchors in the form; show a server refusal in words in the form's problem list; keep the refused values visible beside the stored rule. | M | PL-003, PL-024 | no | no | no |
| PL-027 | UF-037, NEW-46-S2 | Medium | The rule editor and the "Accept an uncapped spend" checkbox have no layout styles: fields sprawl, and a click anywhere on a line ticks the consent | Write the missing layout rules (checkbox beside its label, rows on the stage grid). Guard: a test fails on any class used in markup that has no rule in the stylesheet. | M | none | no | no | no |
| PL-028 | UF-045 | Medium | An out-of-range limit is refused with a generic sentence that names no field and no rule | Check each bound in the form and state the range in each field's note; map the refusal's field names onto the fields. | M | PL-024, PL-003 | no | no | yes |
| PL-029 | UF-051 | Low | Stage 3 prints programmatic identifiers: units, goals and methods | Word units, goals and methods in options, hints and chips, reusing the normalisation wording. | S | PL-003 | no | no | no |
| PL-030 | UF-063 | Low | The comparator limit has no 1–20 range, and leaving it unset blocks Compare while looking advisory | State and enforce 1–20 in the form, on the server and in Compare; stage 6's banner says that unset blocks Compare. | S | PL-024 | no | yes | yes |
| PL-031 | UF-064 | Low | Stage 6 wording: a raw "insufficient_data", two names for one field, and a cap that seems not to cover research | Write "insufficient data", use "top of the score range" everywhere, and say the cap covers each research pass too. | S | none | no | no | no |
| PL-032 | UF-070 | Nit | The spend cap reads "5" after a save, not "5.00" | Show money with two decimals. | S | PL-024 | no | no | no |

#### C03 Criteria-set management (phase 1): PL-033 to PL-041

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-033 | UF-025 | Critical | Delete removes a criteria set, even the one in use, in one click: no confirmation, no history entry, no way back | An armed confirmation strip that names the set and what goes with it, and says when it is in use, with "Duplicate first" offered; its history entry is delivered by the history cluster (per decision). | M | PL-003 | if chosen | if chosen | if chosen |
| PL-034 | UF-027 | High | "Create set" makes an empty set that nothing can fill, and moves the whole app onto it | The server seeds a new set from the catalog (per decision): even pillar weights, each attribute's default criterion, the default rules; the app moves to it only once it can be ranked. | M | none | no | yes | yes |
| PL-035 | UF-031 | Medium | A set used by a saved ranking can never be deleted, and the refusal is database text | Delete is shown unavailable on such a set, with a sentence naming the saved rankings that hold it; the route out is deleting those rankings. | S | PL-003 | no | yes | yes |
| PL-036 | UF-032 | Medium | Rename accepts a name another set already has | Refuse a taken name in the form and on the server: a unique name enforced by a migration whose pre-check names any duplicates. | M | none | yes | yes | yes |
| PL-037 | NEW-56-S1, NEW-56-S2, NEW-56-S3, NEW-56-S4 | Low | Set actions throw keyboard focus to the page, and a double press sends twice and shows a refusal after a success | Use, Create, Rename's Save, Duplicate and Delete are held, never disabled; one request per press; focus returns to a control that stays. | M | none | no | no | no |
| PL-038 | UF-046 | Low | Rename is not keyboard-complete | Focus and select the field; Enter saves, Escape cancels; focus returns to Rename. | S | none | no | no | no |
| PL-039 | UF-047 | Low | "Create set" stays disabled, with no reason, for a name with no Latin letters or digits | Build the id with a counter fallback, and say why when a name cannot be used. | S | none | no | no | no |
| PL-040 | UF-048 | Low | Set rows do not show their heaviest pillar | Serve each set's heaviest pillar in the list response and show the meta; delete the dead style. | S | none | no | yes | yes |
| PL-041 | UF-066 | Nit | A long set name runs under the row's buttons and past the sidebar | Truncate inside its slot with the full name as a title, and cap the length. | S | none | no | no | no |

#### C04 Runs: accounting, evidence and the diff (phase 1): PL-042 to PL-061

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-042 | FU-A1, BE-11 | Medium | Stand-in borrowing ignores a retry's exact pairs, and a run's counts can exceed its total ("3 of 2") | Carry the run's exact pairs into the borrow step; count completed, failed and by-source only over the run's recorded items. | M | none | no | no | yes |
| PL-043 | FU-A2, BE-11 | Medium | A retry records pairs from failures of sources nobody will ask | Build the retry only from failures that a switched-on source or a declared stand-in will be asked about; otherwise refuse with a true message. | S | PL-042 | no | yes | yes |
| PL-044 | ST-11 | Low | One run read combines several database snapshots, so its counts can disagree with its lists | Make the run read one statement: counts and lists from the same CTEs; delete the three list queries. | M | PL-042 | no | no | yes |
| PL-045 | P93 | Low | A rejected figure's failure commits after the figure, so a kill can lose the failure | Write accepted figures, then the batch's failures (rejections included), then rejected figures and their reuse rows; persist stand-in failures as soon as the borrow returns. | S | none | no | no | yes |
| PL-046 | NEW-23 | Medium | A re-read that contradicts the stored figure under the same date is silently kept and counted as re-confirmed | On a re-read that stores nothing, compare payload and verdict with the stored row: a contradiction becomes a run failure (409 for manual entry). A manifest test pins each transcribed table's figures to its date. | M | PL-045 | no | yes | yes |
| PL-047 | RN-R2 | Low | A run's generic abort drops the item in flight | Record a failure for the item in flight before the run is marked failed. | S | PL-045 | no | no | yes |
| PL-048 | ST-12, SV-N10 | Low | SQL does not pin a run's evidence to its items, its scope and its level | Migration: a locked pre-check that names offenders; level on the scope lists; foreign keys from values, failures and reuse rows to the item, and from the item to the scope lists; reuse 0460's attribute key rather than adding one. | L | PL-042, PL-044 | yes | no | yes |
| PL-049 | UF-073 | Critical | The acquisition diff calls re-confirmed figures "went missing" and leaves them out of "Unchanged" | Serve each run's re-confirmed pairs with its detail and count them as unchanged. | M | PL-044, PL-046 | no | yes | yes |
| PL-050 | UF-074 | High | Items nobody was asked are reported as "unanswered: every source answered, none had a row. Retrying changes nothing" | Count "not reached" apart from "unanswered" for a run that did not finish; draw it as the empty part of the bar; hold the unanswered verdict and its retry until the run has ended. | M | PL-044 | no | yes | yes |
| PL-051 | UF-075 | High | "What the database holds" shows the last acquisition's accounting, not the database, and lacks "countries scored" and the ageing count | A database-level read: active values stored, countries scored, values past their allowed age (from each maximum age and the refetch setting); the panel shows it. | M | PL-044 | no | yes | yes |
| PL-052 | UF-072 | Critical | Money spent on gate research is left out of "Spent this month" and disappears from every screen once the pass ends | A monthly read of the research ledger; "Spent this month" sums runs and research (reqs 3.8, Q236); the last pass's outcome stays until it has been read. | M | PL-051 | no | yes | yes |
| PL-053 | UF-077 | Medium | The failed card counts failures rather than failed items, so it disagrees with the run and the three cards do not add up | Count failed items as the run does; leave items another source answered out of the failed retry. | S | PL-042 | no | no | no |
| PL-054 | UF-078 | Medium | The remedy cards follow whichever run is on the card, so outstanding gaps disappear | Base the remedies on what is still outstanding: the latest outcome for each pair across runs, read by the server. | M | PL-044 | no | yes | yes |
| PL-055 | UF-085 | Medium | The source-by-source bars show a success rate rather than progress, and never say "not reached" | A run records at start each source's planned items (migration); bars draw done out of planned, with "not reached". | M | PL-048 | yes | yes | yes |
| PL-056 | UF-093 | Low | The card's spend line omits the ceiling and the cap | The run records its estimate's ceiling and the cap at start (same migration); the card prints both. | S | PL-055 | yes | yes | yes |
| PL-057 | UF-094 | Low | Spend and cap wording disagree: a retry is not called a new acquisition, "refuses" sits beside "uncapped", a monthly total is captioned with a per-run cap | Use the design's sentence, word the note "…unless you accept going uncapped", and show the per-run cap away from the monthly total. | S | PL-052 | no | no | no |
| PL-058 | UF-095 | Low | The failed card says each message is listed once; it is listed once per item | Group by message inside each source. | S | PL-053 | no | no | no |
| PL-059 | UF-097 | Low | Empty failed and unanswered cards disappear instead of reading "Nothing is failing" | Keep each card with its "Nothing is failing" reading and an inert action. | S | none | no | no | no |
| PL-060 | UF-086 | Medium | The acquisition diff misreads scope and picks: everything outside a small run "went missing", reversed and identical picks are accepted, and its notes overclaim | Compare only pairs the later run was asked about; show each run's scope in the pickers; refuse identical picks and warn on reversed ones; word the notes from what was read. | M | PL-049 | no | yes | yes |
| PL-061 | FU-A6, RN-R3, RN-R4, IN-D3 | Low | The contract, SQL comments, docstrings and reqs still describe a run's scope as a rectangle, under-list its 409 codes and omit a run status | Say "exact pairs" everywhere (contract, runs.sql, execution.py, stand_in.py, run_store.py, arch.md, reqs.md with the item and reuse tables in both diagrams, Q237); list every 409 the run operations answer; add halted_by_user to reqs; correct RunDetail's descriptions; regenerate the client. Written last in the cluster. | M | PL-042, PL-043, PL-044, PL-048, PL-049, PL-050, PL-055 | no | yes | no |

#### C05 Rank: the table, the drill-down and the score scale (phase 1): PL-062 to PL-082

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-062 | UI-18 | Critical | Scores are drawn and labelled as if the scale were 0–100: at a scale of 150, a pillar score of 128 prints "100" | Ranking, CandidateScoreDetail and Comparison carry score_scale_max (contract first; the saved half per the saved-evidence decision); bars, labels and tracks use it; never clamp; an unknown scale draws numbers without bars. | M | none | no | yes | yes |
| PL-063 | UF-103 | High | In the drill-down, "Weight" and "Weight used" are on different bases, so every row seems to have lost most of its weight | Both columns on one basis, served by the server and labelled; then the teal difference rule. | M | none | no | yes | yes |
| PL-064 | KT-A4, SV-N4, SV-N5 | Low | Month-based maximum ages are compared as day counts, so a figure's grade drops a day or two early or late | Read freshness once, from the active-value view, through the value store; the ranking takes the stale ids; make rank uses the API's ranking assembly (per decision); fix the test that fails from 2028 and the false interval comment. | M | none | no | no | yes |
| PL-065 | SV-N9 | Low | A ranking reads active values once per candidate: 32 statements and 32 snapshots | One read per level, built from the roster so that candidates with no values stay. | S | PL-064 | no | no | yes |
| PL-066 | UF-105 | Medium | Candidates outside the ranking are listed alphabetically, not by score | Unranked rows by score, highest first, "No score" last, for live and saved rankings, with an acceptance test. | S | none | no | no | yes |
| PL-067 | UF-106, G-S1, SV-N2 | Medium | "Why this status" explains exclusions in machine text (raw attribute and gate ids, `not_matching`), and the band blames a gate for every exclusion | The server writes reasons with attribute and gate names, units and readable precision; the band counts gates and thresholds apart. | M | PL-003 | no | no | yes |
| PL-068 | UF-107 | Medium | The drill-down counts missing attributes but never names them | A row for each scored attribute with no stored value, in the design's words and colours, with the "No value" pill. | M | none | no | no | no |
| PL-069 | UF-108 | Medium | Each figure's confidence chip ignores the age downgrade that the row's confidence split applies | Serve a freshness flag with each value (from the single freshness read) and mark "older than its allowed age" beside the chip. | M | PL-064 | no | yes | yes |
| PL-070 | UF-112 | Medium | The criteria set is shown by its database id in Rank's header and in the saved-rankings list | Names from the set list; the level worded as the header does. | S | PL-003 | no | no | no |
| PL-071 | UF-113 | Low | A figure whose source is switched off is labelled "Superseded", though nothing replaced it | Label it "Source switched off" and read the attribute as having no value in use. | S | none | no | no | no |
| PL-072 | UF-114 | Low | A rejected figure never shows why it was rejected | Print the rejection reason under the chip. | S | none | no | no | no |
| PL-073 | UF-116 | Low | "Weight used" is never tinted, and no tooltip says how a figure was scored | After the bases agree, add the tint and a tooltip built from the criterion's goal, method, anchors and band. | S | PL-063 | no | no | no |
| PL-074 | UF-117 | Low | Stored values are listed in attribute-id order, with descriptive attributes mixed in | Order by pillar and name, descriptive attributes first, from server data. | S | none | no | no | yes |
| PL-075 | UF-119 | Low | The open-row and not-matching row backgrounds never show | Write both modifiers after their base with its specificity; a computed-style browser check. | S | none | no | no | no |
| PL-076 | UF-120 | Low | Rank rows cost 12 tab stops each, and the row toggle does not say whether it is open | aria-expanded on the row button; one tab stop for the pillar chart, arrow keys between bars. | M | none | no | no | no |
| PL-077 | UF-121 | Low | The attribute panel miscounts, and says a weight redistributes when it does not | Count distinct candidates against the roster ("31 of 32"); mention redistribution only when the set scores the attribute. | S | none | no | no | no |
| PL-078 | UF-122 | Nit | Every row shows a fourth confidence reading, "absolute 0%" | Show "absolute" only above zero, and record why in design-brief.md. | S | none | no | no | no |
| PL-079 | UF-123 | Nit | Small wording and colour differences on Rank | Match the design's strings and tints, clamp the note, fall back to a readable name. | S | none | no | no | no |
| PL-080 | UF-143 | Nit | Two kinds of minus sign on one screen | One formatter for every signed number: the true minus sign, the figure's own precision, never a signed zero. | S | none | no | no | no |
| PL-081 | UF-115 | Low | The home country's Δ home reads "—" instead of "baseline", and an all-dash column is unexplained | Print "baseline" on the home row and a one-line note when no home figure exists. | S | PL-080 | no | no | no |
| PL-082 | UF-014 | Medium | The narrow-desktop rule was adopted but never built, and at 1440 px or less Rank's rows outgrow their table | Per breakpoint (1440 and 1280 px, design-brief.md §2), grid tracks without the dropped columns, the class on header and cells, a minimum width no smaller than the tracks, and the 200 px sidebar at 1280. | M | none | no | no | no |

#### C06 Hand entry (phase 1): PL-083 to PL-090

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-083 | UF-071 | Critical | A hand-entered score is scored without its scale: "7 on 0–10" counts as 7 out of 100 | Rescale an assigned score from its declared range, as an Index is; a test that 7 on 0–10 scores 70 on a 0–100 scale. | M | none | no | no | yes |
| PL-084 | UF-087 | Medium | After storing a hand-typed figure there is no "See it in the Rank drill-down", and Rank cannot be opened at a candidate | Rank opens a candidate and pillar from the address; the read-back links to it. | M | PL-016 | no | no | no |
| PL-085 | UF-089, NEW-55-S2 | Low | The hand-entry form lacks the designed bands, chip preview, retrieval date and marked fields, and its "Stored…" line is never announced | Build the two bands, a read-only Retrieved, the chip preview with de-duplication, capitalised confidence, the type column and badge, and per-field marks; keep the status region mounted so the read-back is announced. | M | PL-024 | no | no | no |
| PL-086 | UF-090 | Low | The hand-entry Link field accepts text that will never be shown as a link | Require a full web address in the form, and check it on the server. | S | none | no | yes | yes |
| PL-087 | UF-091 | Low | The one measured attribute that permits hand entry appears in neither card | List it with "Permitted, but there is no form for a measured quantity yet". | S | none | no | no | no |
| PL-088 | UF-092 | Low | The "no data source" card lacks the attribute's type, its remedy is plain text, and its weights are wrong while the set loads | Type in words, the remedy linked to the hand-entry row, a dash while the set loads, unscored criteria left out, the overlap recorded. | S | PL-001 | no | no | no |
| PL-089 | UF-062 | Low | Switching off "Manual entry" does not stop hand entry, and the stored figure then silently stops counting | Refuse hand entry while Manual entry is off, with the reason (per decision). | S | none | no | yes | yes |
| PL-090 | NEW-59 | Nit | A label containing a comma reads as two labels in the diff's exact view, and cannot be typed by hand | Exact mode quotes each label and share label; hand entry takes labels as decided. | S | PL-085 | no | no | no |

#### C07 Compare (phase 1): PL-091 to PL-108

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-091 | UF-124 | Critical | The synthesis cards are signed backwards: each card's number and lists describe the focus but sit under the comparator's name | Cards follow the matrix (per decision): comparator minus focus, with "Ahead on" describing the card's country; a test checks each card's sign against its matrix column. | M | none | no | yes | yes |
| PL-092 | UF-125 | High | At the comparator limit a new tick silently drops the oldest choice, which stays hidden and can come back by itself | Block new ticks at the limit (dimmed, with the design's title); trim only when the limit is lowered; remove trimmed countries from the stored selection. | M | PL-016 | no | no | no |
| PL-093 | UF-126 | High | Gaps are printed less precisely than their figures, so real differences read "+0" or "−0" beside a coloured bar | Impact to one decimal and raw gaps at the figures' own precision, through the shared signed-number formatter. | S | PL-080 | no | no | no |
| PL-094 | UF-127 | Medium | The comparison waits for a Compare press, and an old result stays on screen when the selection changes | Redraw as the selection changes, after a short pause; never show a result for another selection. | M | PL-016 | no | no | no |
| PL-095 | UF-128 | Medium | Compare never says that a candidate is not matching or lacks the data to score | A status tag in each column header and on each card, with the reason on hover. | S | none | no | no | no |
| PL-096 | UF-129 | Medium | Raw figures are shown without a source, period, retrieval date or confidence | Each figure's source and both dates on hover; low-confidence and borrowed figures marked. | M | none | no | no | no |
| PL-097 | UF-130 | Medium | The weighted contribution of each attribute's gap is never shown | Show the server's weighted contribution on attribute rows in impact mode, to one decimal, in the matrix's direction. | S | PL-091 | no | no | no |
| PL-098 | UF-131 | Medium | Attribute rows have an empty weight cell and no "#N in pillar" tags | Add each attribute's weight to the comparison response and draw the weight and the tags. | M | none | no | yes | yes |
| PL-099 | UF-132 | Medium | The synthesis never says when a comparison is partial: the "Not comparable" footnote is missing | Under each card, name the pillars where either side has no score; no impact lines when the focus has no total. | S | none | no | no | no |
| PL-100 | UF-133 | Medium | The synthesis lists attributes, not pillars, and its "#1" tags mean something different from the matrix's | One meaning for "#N": a pillar's rank among the heaviest; the server sends each line's pillar; one line per pillar (per decision). | M | PL-091 | no | yes | yes |
| PL-101 | UF-135 | Low | Missing values read "—" instead of "No score", and card gaps have no "points" | "No score", "No value" and "No comparable score", and "points" on card gaps. | S | none | no | no | no |
| PL-102 | UF-136 | Low | Compare opens empty, its Compare button is disabled without a reason, and "Raw figures" seems to do nothing | A default focus (per decision) with the first pillar open; say what the toggle affects. | S | PL-094 | no | no | no |
| PL-103 | UF-137 | Low | Comparator columns follow the order of the clicks, not the scores | Order columns and cards by total score, "No score" last. | S | none | no | no | no |
| PL-104 | UF-138 | Low | Pillar weights are whole percentages on the left, and the priority tags move when only the focus changes | The set's pillar weights to one decimal on the right, and the priority tags taken from them. | S | none | no | no | no |
| PL-105 | UF-139 | Low | The Raw note and the attribute notes leave out what the design says | Restore the pillar sentence, say "no value for <focus>", and drop the gap wording where there is no gap. | S | none | no | no | no |
| PL-106 | UF-140 | Low | The limit note does not say how many are chosen | Add "M chosen", amber at the limit. | S | none | no | no | no |
| PL-107 | UF-141 | Low | An empty "Ahead on" or "Behind on" list still shows its label | Say "Nothing" under the label. | S | none | no | no | no |
| PL-108 | UF-144 | Nit | Column headers are not styled as designed | The focus header in the accent colour, and every header right-aligned. | S | none | no | no | no |

#### C08 Weights, locks and held controls (phase 2): PL-109 to PL-115

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-109 | NEW-46, NEW-46-S1 | Low | A held slider, the pillar lock, the "blocks scoring" box and Acquire's history "Open" look unchanged while they are held | A held rule in styles.css for each of them, one held look (per decision); expectHeld() fails when no held rule matches the control; a browser test reads the computed style. | S | none | no | no | no |
| PL-110 | NEW-68, H-L1, H-L2, H-L3 | Low | The lock draws a disc, not a padlock; neither lock has a hover or pressed state; dead lock CSS; titles duplicated | One shared inline-SVG padlock (sized by attributes, currentColor, aria-hidden), shut when locked and open when free, in both locks; hover and pressed states; delete .toggle--lock; one source for the titles; the padlock recorded in design-brief.md. Lands in the same commit as the held look. | S | PL-109 | no | no | no |
| PL-111 | UF-034, NEW-58, SV-N8 | Medium | Criteria that are not scored look like scored ones: live sliders, the usual chips, "Required" on Configure and on Rank, and a "blocks scoring" box that does nothing | Mark such rows "Not scored, matching only" and hold the slider; "Required" only when a criterion is scored and blocks, on both screens; the box explains it takes effect once the criterion is scored (per decision). | M | none | no | no | no |
| PL-112 | UF-035 | Medium | The "every other weight is locked" refusal is wrong in three of its four cases, names no pillar, and outlives its cause | Word each case from the refusal's details, naming up to three locks or "this weight is locked: unlock it first"; hold a locked slider; clear the banner when the locks change. | M | PL-003 | no | no | yes |
| PL-113 | UF-052 | Low | Pillar rows omit the unsourced share, and unsourced attributes omit "Weight redistributed" | Compute the unsourced share from the catalog and the weights, and add the neutral pill. | S | none | no | no | no |
| PL-114 | UF-067 | Nit | Stage 3 colours differ from the design: the open pillar is not tinted, and the totals use amber and teal | Tint the open row, and use green and red in both totals. | S | none | no | no | no |
| PL-115 | UF-068 | Nit | Two explanatory paragraphs, with "backend" jargon, open inside every pillar | Remove them. | S | none | no | no | no |

#### C09 Acquire: starting, following, stopping and retrying (phase 2): PL-116 to PL-133

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-116 | UF-076 | High | An armed "Yes, start it" goes stale and starts a scope that is no longer on screen | Clear the armed strip whenever the card's run or the selection changes; the strip names the run and the items. | S | none | no | no | no |
| PL-117 | UI-24 | Medium | Acquire does not follow the run it shows; its history and "What the database holds" stay stale too | A card poll outside the ticket logic (never through act), stopping at a terminal status, on dismissal, on another run and on unmount; the history and the holds panel re-read once when the run ends; the comments that say "nothing here polls" corrected. | M | PL-044, PL-051 | no | no | no |
| PL-118 | P94 | Medium | A start in flight is forgotten when Acquire is left and opened again | A page-level pending-start store that a remounted Acquire reads, holding every way to start until the run appears; an outcome that lands while Acquire is closed is handled per decision. | M | PL-117 | no | no | no |
| PL-119 | UF-080 | Medium | Starting is offered while a run is in flight, and the refusal gives no way to that run | Hold the start controls while a run is in flight, naming it, with "Open acquisition N"; the refusal carries the run's id in its details. | S | PL-117, PL-109 | no | yes | yes |
| PL-120 | UF-081 | Medium | With every source switched off, Acquire offers a zero-item acquisition and refuses only after it is confirmed | Refuse at the estimate when it has no items, with the reason and a link to stage 5. | S | none | no | yes | yes |
| PL-121 | UF-082 | Medium | The refresh-everything card starts at once after its estimate, has no counts, and says it re-asks everything when the refetch age narrows it | The same confirmation strip as the other remedies; the count and the ageing figure in the card; the lead worded from the refetch setting. | M | PL-051 | no | no | no |
| PL-122 | UF-083 | Medium | Run outcomes print raw status ids, and a stop by the reader looks like a halt at the spend cap | One map from status to words and colour, used by the pill, the heading, the outcome line, the history chip and the sidebar. | S | PL-003 | no | no | no |
| PL-123 | UF-084 | Medium | The stopping state is not drawn | The amber card, its heading and "Stop asked at HH:MM", from the stop time the run already carries. | S | PL-117 | no | no | no |
| PL-124 | UF-096, RN-R1 | Medium | Retry is not selective (it asks every switched-on source about the rectangle, paid ones too), and the selection controls are only partly built | Per decision: the plan and retry operations take exact pairs, so Retry is estimated and stays selective; one action whose label follows the selection, tri-state group boxes, and the sources a retry would ask shown in the strip. | L | PL-042, PL-043, PL-116 | no | yes | yes |
| PL-125 | UF-088 | Medium | There is no way to acquire one candidate, one attribute or one pillar | A picker that estimates and starts a chosen set of candidates and attributes through the scoped run (reqs 5.6: re-fetching is explicit, per candidate and per attribute). | M | PL-124 | no | no | no |
| PL-126 | UF-098 | Low | Opening an acquisition from the history changes the card 2,000 px above and leaves the reader at the bottom | Scroll to the card and move focus to its heading. | S | none | no | no | no |
| PL-127 | UF-099 | Low | History rows and links say less than the design, and a pair-scoped run is worded as a rectangle | A run records its purpose (per decision) and its scope is worded from it ("N items over C candidates"); "Open acquisition N"; the sidebar links to the table itself. | M | none | if chosen | yes | yes |
| PL-128 | UF-100 | Low | Keyboard focus falls to the page when the pressed control disappears, Stop included | Move focus to the new card's heading, or back to the control that opened the strip; Refresh after Stop vanishes. | S | none | no | no | no |
| PL-129 | UF-101 | Nit | Acquire's visual details differ from the design | Adjust the stylesheet to the design's values. | S | none | no | no | no |
| PL-130 | UF-102 | Nit | "Estimating…" shows on the refresh card while a retry is being estimated | Key the label to the act that started the estimate. | S | none | no | no | no |
| PL-131 | UF-017 | Low | The progress strip never says "Stopping…", counts only completed items, and announces every poll | Read the stop time and say "Stopping…"; count completed plus failed items; announce only the start and the end. | S | none | no | no | no |
| PL-132 | UF-018 | Low | The shell asks for the run list every 2 seconds for as long as a tab is open | Every 30 s while nothing runs; every 2 s while a run is in flight or has just started. | S | none | no | no | no |
| PL-133 | UF-023 | Nit | The progress strip draws a black bar, an ungrouped count, and slides 3 px under the tab bar | fill on the rectangle, the shared count formatter, and the offset matched to the tab bar. | S | none | no | no | no |

#### C10 Source priority (phase 2): PL-134 to PL-137

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-134 | UF-042 | Medium | Source rows show no attribute count, several name the wrong kind, and nothing says what switching one off costs | "N attributes" or "answers nothing yet" from the catalog; the kind phrase corrected or dropped; what switching off a source behind a blocking attribute does. | M | none | no | no | no |
| PL-135 | UF-043 | Medium | Source priority hides per-attribute orders and maximum ages, and its lead overstates what the order decides | A read-only list of attributes that name their own order, with each maximum age; the lead reworded. | M | none | no | no | no |
| PL-136 | UF-044 | Medium | One drag renumbers every source 1 to n and erases the stored priority tiers | A batch reorder operation that keeps the tier gaps and is atomic (per decision). | M | none | no | yes | yes |
| PL-137 | UF-061 | Low | The arrows refuse to swap two sources that share a priority, and give no reason | Swap tied sources by giving the pair distinct numbers, through the reorder operation. | S | PL-136 | no | no | no |

#### C11 The change history (phase 2): PL-138 to PL-142

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-138 | UF-030, NEW-67, UF-057 | High | Recent changes records only a criterion's weight and lock: pillar weights and locks, rules, gates, compound rules, sets, household, sources and limits leave no entry, and "Back to where I started" leaves them changed | Record every Configure edit in the decided scope with its reverse request, through screen-level writer hooks; undo held while any recorded write is in flight and the reverse; switches held while saving. Guard: set-mutating client calls are imported only by recording hooks, each of which notes the change. | L | PL-109, PL-110, PL-136, PL-025, PL-033 | no | no | no |
| PL-139 | H-S1, H-S3, H-S5, H-S6, H-S7 | Medium | Recent changes forgets, blocks and misstates its own entries: it empties on leaving Configure, a deleted set's entries block every older undo, a half-finished undo stays listed, a pillar answer overwrites other levels, and two comments state false rules | Keep the history for the session (per decision); drop a deleted set's entries and say how many; remove what a half-finished undo did undo; merge pillar answers per level; rewrite the comments. | M | PL-138, PL-016 | no | no | no |
| PL-140 | UF-038, H-S4, P99-S1 | Medium | Recent changes is not the design's rail: no single-change undo, no preview, the withdrawn "after it" wording, raw numbers and a renamed set's old name | "Undo this" (withheld, with "Held by a later change…", when a newer entry touched the same target), "↑ Undo all N", the hover preview and tooltips; labels composed at render from structured parts, numbers formatted, the set's current name; the stage label styled. | L | PL-138 | no | no | no |
| PL-141 | UF-055, H-S2 | Medium | A merged entry shows only its last step while its undo goes back to the first, and lock-then-unlock leaves an entry whose undo does nothing | Label from the original before and the latest after; drop an entry whose before equals its after. | S | PL-140 | no | no | no |
| PL-142 | P99, P99-S2, P99-S3 | Medium | A stale set read that lands before a write's answer still reaches the panels, and Rank, the sidebar, Compare and the drill-down can read a set before a Configure write lands | Count a write as in flight from send to settle; accept a set read only if no write overlapped it, otherwise wait and read again; the rule lives in getJson for every set-scoped read and before a ranking is saved. Guard: every set-scoped path names criteriaSetId. | M | PL-138 | no | no | no |

#### C12 Saved rankings and the evaluation tree (phase 2): PL-143 to PL-148

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-143 | FU-A3, FU-A4, ST-07, G-S7, G-S9 | Medium | A saved refusal keeps neither the figure a threshold judged nor the gate answer it read, and a new gate answer destroys the one it replaces | One migration (per decision): immutable gate-answer versions with the live row pointing at one; the saved reason pins the version it read and the value a threshold judged; both read statements return them; a savepoint discards a declined proposal's version; a structural test that every foreign key into the evaluation tree cascades; the follow-up test uses a person's correction. | L | none | yes | if chosen | yes |
| PL-144 | UF-104, SV-N3 | High | An opened saved ranking appears out of sight, says nothing about itself, has lost its pillars and Δ home, and no saved figure's provenance is served | Serve the saved ranking with its attribute scores and their frozen evidence and provenance (per decision), from which pillars and Δ home derive; scroll to it and focus its heading; show its set, level, date and note; its rows open a drill-down. | L | PL-143, PL-062 | no | yes | yes |
| PL-145 | UF-013 | Medium | Saved rankings show no leader and cannot be deleted | The leader in the evaluation summary; a delete operation (contract first) wired to the × with a confirmation (per decision). | M | PL-143 | no | yes | yes |
| PL-146 | UF-111, UF-118, NEW-56, NEW-56-S5, NEW-56-S6 | Medium | Rank's save control is offered with nothing to save, drops keyboard focus while saving, lacks its hint, still says "Nothing is kept" after a save, and its "Try again" only dismisses | Drawn only when a ranking with candidates has loaded; "nothing to save" disabled, "saving" held, one save per press; focus returns to "Save this ranking"; Cancel held while saving; the hint; "Saved as …"; Enter saves and Escape cancels; a failure keeps the box (per decision); the test that checks a detached input fixed. | M | PL-004, PL-109 | no | no | no |
| PL-147 | ST-13, SV-N6 | Low | Saved contributions and evidence inputs are not pinned to their candidate, attribute and frozen criterion | Migration with ST-14, last in the cluster: keys on value and candidate_result; contributions and (per decision) every evidence input pinned; non_match_input pinned to its reason; one locked pre-check. | M | PL-143, PL-144, PL-145 | yes | no | yes |
| PL-148 | ST-14, SV-N7 | Low | Frozen criteria are not constrained to their evaluation's level, nor are the frozen rule lists | Same migration: level on evaluation_criterion with foreign keys; save freezes only the level's criteria and their anchors; the rule lists pinned where their level is set and the rest recorded (per decision). | S | PL-147 | yes | no | yes |

#### C13 Gates and research (phase 2): PL-149 to PL-162

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-149 | NEW-64, G-S3 | Nit | A gate's concerned candidates are not checked to sit at its level, and the API's level refusal is untested | Migration: level on match_rule_candidate with foreign keys and a pre-check naming offenders (a gate with no level lists none, per decision); a test for the API's level refusal. | S | none | yes | no | yes |
| PL-150 | NEW-66, G-S2 | Low | The Proposals panel prints raw ids, and links its pages without the URL safety check | A gate-names hook; names in the cells and in Confirm; the answer through the shared status words; pages through safeHttpUrl; the server's refusal lines use names; the identifier guard sees real gate ids. | S | PL-003 | no | no | yes |
| PL-151 | NEW-65, G-S4 | Low | The research panel never says which level a pass researches, and the proposals and rule sentences mix levels | The pass carries its level and names it in its progress and end lines; proposals and rule sentences are filtered to the panel's level. | S | PL-150 | no | no | no |
| PL-152 | UI-29 | High | No screen lets a person record, override, correct or rule out a gate answer | A "Gate answers" area keyed by level, outside the set-keyed rules panel: a prefilled form that always writes manual, with validated pages, an override reason and a period; "Change" and "Answer differently"; Save held, never disabled; the mock learns to refuse as the server does. | L | PL-143, PL-150 | no | if chosen | if chosen |
| PL-153 | BE-36, G-S5 | Medium | Confirmed answers keep applying whatever their period, invisibly, with no way to re-check them | Stage 1: the recorded answers with their period, age and "ended, still applied", a test pinning "never auto-expired", the count sentence dropped. Stage 2: an explicit re-check whose proposal is stored as a version beside the person's answer, with "Take the proposal". | L | PL-152, PL-143 | no | yes | yes |
| PL-154 | UF-109 | Medium | The candidate detail shows no gate answers, and the reason cell no override mark | A "Gates" block in the detail from the answers read (answer, period, age, source, pages), and an override mark in the reason cell. | M | PL-153 | no | no | no |
| PL-155 | UF-039 | Medium | Rule rows do not say what a rule tests: compound rules print raw enums, gates say only "Asked at country level." | Compound descriptions written from their conditions (names and bands); gate descriptions as catalog data seeded from reqs 7.3's "Matches when" column (migration). | M | PL-003 | yes | yes | yes |
| PL-156 | UF-040 | Medium | A rule's cost line never names whom a compound rule flags, and is red even when a rule costs nothing or is switched off | Count the live ranking's warnings and exclusions per rule to name who is flagged; colour from the effect; a style for a rule that is off. | M | none | no | no | no |
| PL-157 | UF-041 | Medium | There is no gate/warning selector, so a gate cannot be softened to a warning or a warning made a gate | Per decision: a per-set "as a warning" choice with the select, read by evaluation; or the divergence recorded and the text no longer drawn like a control. | L | none | if chosen | if chosen | if chosen |
| PL-158 | UF-056 | Low | A compound rule's kind label ignores its outcome (latent) | Choose the label from the rule's outcome. | S | none | no | no | no |
| PL-159 | UF-058 | Low | Gate research counts every gate in its progress, while its estimate counts only the ones it will ask | Take the gates from the estimate, count pairs in both places, and say "at most €X". | S | PL-151 | no | no | no |
| PL-160 | UF-059 | Low | Gate research offers "Accept an uncapped spend" even when a cap is set, never states the cap, and a missing-cap refusal loses the estimate | Read the settings with the estimate and say "Halts at the €X cap"; offer the box only when no cap is set; keep the estimate after a refusal that spent nothing. | S | none | no | no | no |
| PL-161 | UF-060 | Low | Gate proposals show no retrieval date | Add "Read on <date>" beside "Holds for". | S | none | no | no | no |
| PL-162 | UF-069 | Nit | Stage 4 says the same thing twice, nests a heading wrongly, and its switch has no tooltip | Drop the duplicate, make the proposals heading an h4, and add the title. | S | none | no | no | no |

#### C14 The household (phase 2): PL-163 to PL-166

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-163 | UF-028 | High | Net income is labelled annual; the requirements, the domain model and the design all say monthly | Label and suffix monthly, in Configure and the sidebar; the stored figure is checked by the household before the change is deployed (per decision). | S | none | no | no | no |
| PL-164 | UF-029, G-S6 | High | Household edits reach no gate: citizenship does not clear the citizenship gates, and nothing derives EU free movement, so that enforced gate never fires | Per decision: catalog rows naming the citizenships that clear each gate; evaluation reads the household's citizenships; eu_free_movement derived from EU citizenship; answers record the citizenships they assumed and are flagged for a re-check when those change (migration). | L | PL-143, PL-153 | yes | yes | yes |
| PL-165 | UF-049 | Low | The household words, and the sidebar's household values, are not the design's | The design's words in the shared vocabulary; money without cents and with its period. | S | PL-163 | no | no | no |
| PL-166 | UF-050 | Low | Adults stop at 4 and children at 3, and the design documents still say "number fields" | A "more" segment that opens a number field, through the shared parser; the documents corrected. | S | PL-024 | no | no | no |

#### C15 Data integrity in SQL, and the contract (phase 3): PL-167 to PL-172

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-167 | ST-16, IN-NAN | Low | SQL checks named "finite" accept ±Infinity, and about twenty other numeric columns accept NaN or Infinity | Migration: real finite checks, behind a locked pre-check naming table, column and id, on every numeric column the domain reads (per decision); published tables refuse non-finite text. | L | none | yes | no | yes |
| PL-168 | ST-15 | Low | An accepted figure can lack its payload, and a share composition need not sum to 100 | Per decision: deferred constraint triggers for payload completeness and the share sum (accepted or rejected), with DELETE triggers; arch.md 3.3b amended; the race tests updated in the same commit. | M | PL-167 | yes | no | yes |
| PL-169 | ST-17, IN-LABEL | Low | Several share bounds collapse silently to the first, and two label thresholds make a set unreadable | Migration: UNIQUE (criterion) on both threshold tables, with a pre-check that refuses to choose; the reader refuses extras. | S | none | yes | no | yes |
| PL-170 | ST-18, P10, BE-35 | Low | A converted amount's rate provenance is not served, and conversion is not built end to end | Per decision: an ECB rate source that writes fx_rate; the publisher stored with the amount (migration) and served as {rate, rate_date, data_source}; the contract's nested input accepted; an unpublished rate refused 409, never 500. | L | PL-167 | yes | yes | yes |
| PL-171 | ST-10 | Low | External scores have no current edition, an incomplete order, and nothing that says which index a row belongs to | Per decision: a series column (migration), a total order, is_current derived and served (contract); earlier editions labelled on Rank. | M | none | if chosen | yes | yes |
| PL-172 | NEW-61, NEW-62, IN-D1, IN-D2 | Low | Request and response bodies, and the generated contract, disagree with the design about null | A null-refusing base for whole-replace and create bodies; separate household request and response bodies; ContractBody leaves null out of the schema for omitted fields; score_delta and CompoundRule.level settled with the design (per decision); a drift guard in both directions. | M | none | no | yes | yes |

#### C16 Tooling and rollbacks (phase 3): PL-173 to PL-179

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-173 | P100, TL-N4 | Low | make e2e builds the copy's URL from values make read from .env, so a quoted or special password breaks it or can be printed, and compose builds its URLs from the raw password | tools/e2e_copy.py reads .env with python-dotenv (file first, then the environment), percent-encodes, migrates in-process and execs npm; compose builds encoded URLs. First among the tooling items. | M | none | no | no | no |
| PL-174 | P98 | Low | The migration lock guards skip two SQL shapes | A fail-closed hygiene test that refuses any shape it cannot read, naming the readable form. | S | PL-173 | no | no | no |
| PL-175 | P96 | Low | make reads POSTGRES_DB=app#db as app | Per decision: a sandbox test that proves the copy's name stays safe (recommended), or a refusal through the e2e script. | S | PL-173 | no | no | no |
| PL-176 | P97 | Low | Replacing an attribute's criterion drops its weight lock | Carry weight_locked and is_scored in 0442, 0445, 0488 and their rollbacks; a structural check; a read-only check of the live locks against the dumps taken before each migration (per decision). | M | PL-174 | no | no | no |
| PL-177 | P95, TL-N1 | Low | Rollbacks stop on PostgreSQL's foreign-key error instead of a refusal, in seventeen places rather than the four recorded | tools/migrate.py turns an integrity error into a refusal naming the table, the constraint and the remedy, with no traceback; named refusals in the four recorded rollbacks (per decision); the known-issues text corrected. | M | PL-176 | no | no | no |
| PL-178 | TL-N2, SV-N1 | Medium | Eight rollbacks delete or rewrite recorded history without refusing: 0500, 0501, 0504, 0486, 0461, 0483, and 0507's frozen columns | Each refuses, locking first, whenever it would delete or rewrite recorded history, as 0503, 0506 and 0507 do; each joins the race tests. | M | PL-174 | no | no | no |
| PL-179 | TL-N5, TL-N6 | Low | Rollbacks assume only the shipped sets exist, and seven overwrite user weights with literals | Rollbacks address every set, and refuse rather than overwrite weights a person changed (per decision). | M | PL-178 | no | no | no |

#### C17 Docs, dead code and trackers (phase 3): PL-180 to PL-182

| Plan id | Sources | Severity | Title | Fix direction | Size | Depends on | Migration | Contract | Backend |
|---|---|---|---|---|---|---|---|---|---|
| PL-180 | UF-022 | Low | Divergences the code made are not recorded in design-brief.md, and some recorded ones are out of date | One divergences pass in design-brief.md covering every decision this plan takes against the design, with stale notes removed. | M | none | no | no | no |
| PL-181 | UF-024, E2E-1 | Low | Dead code, and comments that mislead, including the e2e helper's claim that it waits for the server | Delete what is dead or wire it (the saved-ranking delete and drill-down are built by then); correct the comments. | S | PL-145, PL-144 | no | no | no |
| PL-182 | G-S8, TL-N3 | Low | Plan texts rely on a hook that was never built, and CLAUDE.md is wrong about an exported DATABASE_URL | Correct the plan appendix; relay the CLAUDE.md correction to the other agent. | S | none | no | no | no |

## 3. Feature clusters

A cluster fixes one feature completely, to its specification, all severities at once, so its files are opened once. Where a mechanism must exist before a feature can be fixed, an earlier cluster builds it and later clusters only use it. The few files that two clusters touch are named in each cluster.

Each cluster lists: its items; the design and requirement sections it must satisfy; the shared mechanism and the structural guard that keep the rule enforced across the code; files likely changed; what you will see change; risks and undesired consequences; alternatives; migrations and contract changes; tests; size; and dependencies. Risks come from the maps where a map covers the item. For review findings no map covers, I reasoned them out from paths in, paths out, and state and time. Each cluster's own consequence map (section 5, step 1) will check these before any code.

### C01 The shell and truthful states (phase 1)

**Items (23):** PL-001 to PL-023. UF-001, UF-002, UF-003, UF-079, UF-004, UF-110, UF-142, UF-008, UF-016, UF-009, UF-011, UF-012, UF-065, UF-053, UF-005, UF-006, UF-007, UF-015, UF-134, UF-010, UF-019, UF-020, UF-021.

**Specification:**
- README, Shell: the sidebar (household card, active set, level, candidates card and its unset-score behaviour, last acquisition, saved rankings), the tab bar, each screen's h1 and subtitle.
- README, Round 4 additions, "Loading, empty, error — every tab": the title drawn at once, skeletons with a busy flag, one error shape with its title, reassurance and Try again, no error codes, an empty card with one action.
- README, Interactions & behaviour, "Null propagation", and DECISIONS, Principles: absence is never drawn as a zero.
- README, Deviations 8, and the ruling of 2026-10-23: no programmatic identifiers in rendered text.
- UX-REVIEW R3, K and L (settings that can say "not set"); `reqs.md` 3.10, 8.1 and 10.

**Shared mechanisms.**
1. *One read state.* The shared read hook returns pending, ready, refreshing (the old data kept while it re-reads) or failed. Its result is a union type, so no screen can touch data that does not exist yet. One renderer turns each state into a skeleton, the error card or the content.
2. *One error card and one wording table.* The client maps 502, 503, 504 and an empty 500 to "server not reachable" before it checks the body's shape. Every error code the contract names has a sentence; codes are never drawn. The server's own refusal sentences use names.
3. *Names, not identifiers.* Name lookups for gates (new), sets, pillars, sources, candidates and statuses. The identifier guard grows to real ids (gate ids without a level prefix, set ids, attribute ids) and to enum words such as `not_matching`, on every screen. It starts with a ledger of every known offender and the plan item that removes it. A stale entry fails the test, and the ledger must be empty when the round ends.
4. *A session store above the routes* for view state: Compare's selection and view choices, Rank's open rows, the active set and level (also kept in the address). C11 keeps the change history there too.

**Structural guards:** the union type (a compile-time guard); a browser "failure sweep" that fails each read once per screen and checks for the error card and for the absence of "0", "not set" and "nothing stored"; a test that the contract's error codes and the wording table match both ways; the identifier guard with its ledger; a test that every refusal's route lands on an element that exists.

**Files likely changed:** `ui/src/api/` (`useResource.ts`, `client.ts`, `ApiError.ts`, `errorPresentation.ts`, a new gate-names hook); `ui/src/shell/` (`ErrorNotice.tsx`, `Sidebar.tsx`, `SelectionContext.tsx`, `refusalRemedy.ts`, `UnsetSetting.tsx`, a new session store); `ui/src/app/App.tsx` and `appConfig.ts`; the top level of every screen and the panels the review names (`RankScreen.tsx`, `CompareScreen.tsx`, `RunScreen.tsx`, `ConfigureScreen.tsx`, `DatabaseHoldsPanel.tsx`, `CandidateDetail.tsx`, `HouseholdPanel.tsx`, `SettingsPanel.tsx`); `ui/src/format/display.ts`; `ui/src/styles.css`; the interface container's start script; backend `storage/criteria_store.py`, `api/runs.py`, `api/settings.py`, `api/comparisons.py`, `api/errors.py`; `docs/openapi.yaml`; the screen tests, `ui/e2e/sanity.spec.ts`, `smoke.spec.ts` and a new failure-sweep spec.

**What you will see change:**
- A slow read shows a skeleton. A failed one shows "… could not be loaded" with Try again, never a zero or "not set".
- With the server stopped, each screen shows the "server is probably not running" card, and recovers when the server answers again (D3).
- Refusals read in words, without codes or database text, and can be dismissed. Try again appears only where it re-sends.
- An unset score range or comparator limit shows the calm "not set" card, with a route that lands on the setting.
- Content stays in place while it is re-read. Each tab has its empty state. Times are local. Compare and Rank keep their state across tabs and reloads. Each screen title is the page's h1.

**Risks and undesired consequences:**
- *Paths in:* every read in the interface. The union type breaks the build in every consumer until each handles all four states. That is intended, but it makes this the widest change of the round, which is why it goes first.
- *Paths out:* about thirty tests assert codes or the old wording (`App.test.tsx` asserts a code is shown). Browser specs that wait for "Loading…" change.
- *State and time:* refreshing data stays on screen during a re-read, so a figure can be briefly stale; it is marked as refreshing. A session store could carry a selection into a level where it does not exist; it resets on a level change. Local time makes tests depend on the zone, so tests pin it.
- The server's refusal sentences change for API clients (only you).
- The identifier guard may find ids the review did not list. Each joins the ledger with the cluster that fixes it.

**Alternatives:** fixing each panel's states in place (rejected: the rule would drift again, which is how these findings arose); one error boundary for the whole app (rejected: it loses per-panel recovery and the design's per-screen card); keeping all view state in the address (D5).

**Migrations and contract:** no migration. Contract: refusal details for a comparison over the limit (PL-007) and for a score range below the anchors (PL-006).

**Tests:** unit tests for each mechanism (the four states, the server-down mapping, the wording table, the name lookups, the session store); each finding's test, failing before its fix. Browser: the failure sweep; a server-down run (every `/v1` request answers 502, then the server returns); the empty states on an empty copy; one h1 per screen.

**Size:** 2 L, 12 M, 9 S: 61 hours of item work. **Depends on:** nothing; it is first.

### C02 Forms: what is typed, refused and saved (phase 1)

**Items (9):** PL-024 to PL-032. UF-026; UF-033 with UF-054, NEW-55 and NEW-55-S1; UF-036; UF-037 with NEW-46-S2; UF-045; UF-051; UF-063; UF-064; UF-070.

**Specification:** README, Stage 2 (money fields with € and "per month") and Stage 6 (five fields, each can be left unset, the comparator limit 1–20); README, Round 4 additions, hand entry ("problems list in an amber notice and mark their fields"); README, Stage 3 (pills in words); UX-REVIEW K; DECISIONS 2026-09-20, comparator limit; `reqs.md` 1.4, 3.9, 3.10 and 8.2. The recorded divergences on the rule editor (P52 and P55) stay.

**Shared mechanism:** one numeric parser, a plain module that turns text into a number or a reason and never rewrites, and one numeric field built on it. Every number typed anywhere uses it: household, settings, the rule editor, hand entry (C06) and the household's "more" segment (C14). Beside it, one form save state: "Not saved yet", "Saving…", "Saved.", or refused with the fields marked.

**Structural guards:** an architecture test that every numeric input under `routes/` is the shared field; an it.each that types "72,000", "-5", "1e9" and "abc" into every numeric field and expects a refusal, never a stored rewrite; a stylesheet test that fails on any class used in markup with no rule.

**Files likely changed:** `ui/src/routes/configure/household/`, `settings/` and `criteria/` (`CriterionRuleFields.tsx`, `useCriterionRule.ts`, `criterionForm.ts`, `criterionReading.ts`); `proposals/ProposalsPanel.tsx` (the checkbox layout only); the shared parser and field, replacing `numericInput.ts`; `ui/src/styles.css`; `ui/src/app/architecture.test.ts`; backend `api/settings.py` and `api/errors.py`; `docs/openapi.yaml`.

**What you will see change:** "72,000" is refused with a message on the field and nothing is stored; text that is not a number is refused, never saved as "unset"; "Saved." appears only after a save and clears on any edit; a draft says "Not saved yet", and leaving with one asks first (D8); a refused rule shows its reason inside the form, with your values beside the stored rule; each limit states its range; the comparator limit is 1 to 20 everywhere; the cap reads €5.00; rule options and chips are in words.

**Risks and undesired consequences:**
- *Paths in:* every typed number. Refusing a comma refuses the format the sidebar itself prints (D7 decides).
- *Paths out:* tests that type into fields; the leave warning is new behaviour on every route out of Configure.
- *State:* the server's new 1–20 range refuses a stored value outside it. The live limit is 5; the rehearsal reads it anyway.
- The stylesheet guard may find more unstyled classes than UF-037 names; they are fixed here.
- *Time:* a save in flight while you type keeps today's revision rule, and "Saved." must never be announced for a save that newer typing has overtaken.

**Alternatives:** patching the keystroke filter's cases (rejected: it still rewrites what you type); saving each field as you type, as the design does (D8).

**Migrations and contract:** no migration. Contract: settings refusals name their fields; the comparator limit gains its 1 and 20 bounds.

**Tests:** the parser's table; the it.each over fields; save-state tests per form (the UI map's T55-1, T55-2 and S1); rule-refusal tests. Browser: type "72,000" as income, expect the refusal and an unchanged stored value, read back through the API on the copy.

**Size:** 1 L, 4 M, 4 S: 24 hours. **Depends on:** C01.

### C03 Criteria-set management (phase 1)

**Items (9):** PL-033 to PL-041. UF-025, UF-027, UF-031, UF-032, NEW-56-S1 to S4, UF-046, UF-047, UF-048, UF-066.

**Specification:** README, Stage 1 (four fixed slots in a constant order, "in use", the heaviest pillar as meta, rename inline, "N sets", Delete unavailable when one set remains); UX-REVIEW J and R6; the Acquire confirmation strip as the pattern for anything that cannot be undone; `reqs.md` 3.4, 8.2 and Q168.

**Shared mechanism:** one armed confirmation strip, the one Acquire uses, for every destructive action; the held button and the focus-return helper move to the shell folder (D12), so sets, Rank and Acquire share them.

**Structural guards:** a test that each destructive action goes through the strip; an it.each that a double press of each set action sends one request.

**Files likely changed:** `ui/src/routes/configure/sets/` (`CriteriaSetsPanel.tsx`, `useCriteriaSets.ts`, `setIdentifier.ts`); `ui/src/shell/` (the moved helpers, `SelectionContext.tsx`); the three Acquire files that import the held button; `ui/src/styles.css`; backend `api/criteria.py`, `criteria/criteria_set.py`, `storage/criteria_store.py`, `storage/queries/criteria.sql`; migration 0508; `docs/openapi.yaml`.

**What you will see change:** Delete asks first and names what will be lost; Create gives a set that can be ranked at once; a taken name is refused; a set held by saved rankings names them; rename works from the keyboard; a long name is cut, with the full name on hover; the set buttons keep focus.

**Risks and undesired consequences:**
- *Paths in:* Create and Delete are reached from stage 1 and from Configure's new empty state (C01).
- *Paths out:* seeding changes what Create means for API clients and for the tests that expect an empty set.
- *State:* the unique-name migration refuses if two live sets share a name, ignoring case. Not checked yet; its pre-check names them, and the rehearsal shows it before `make migrate`.
- Moving the held button touches three Acquire files; their tests are the safety net.
- Between C03 and C11 a deletion is confirmed but not yet listed in Recent changes.

**Alternatives:** a soft delete with a real undo (D9); Create as a client-side copy of a named default set (D10); a taken name refused in the form only (D11).

**Migrations and contract:** 0508, unique set names behind a locked pre-check; its rollback drops the constraint and loses nothing. Contract: Create's meaning; the set list carries each set's heaviest pillar and the saved rankings that use it; a 409 for a taken name on rename.

**Tests:** seeding (pillar weights sum to 100, every default criterion present, the set ranks); the constraint and its pre-check replayed; the strip, focus and one-request tests. Browser: create a set and rank it; delete it through the strip.

**Size:** 4 M, 5 S: 17 hours. **Depends on:** C01.

### C04 Runs: accounting, evidence and the diff (phase 1)

**Items (20):** PL-042 to PL-061. FU-A1, FU-A2, ST-11, P93, NEW-23, RN-R2, ST-12, UF-073, UF-074, UF-075, UF-072, UF-077, UF-078, UF-085, UF-093, UF-094, UF-095, UF-097, UF-086, and FU-A6 with RN-R3, RN-R4 and IN-D3.

**Specification:** README, 2. Acquire (the progress card; "What the database holds" with values stored, countries scored, values past their allowed age and spend this month; three remedy cards whose counts sum to the total; the diff's pickers and four counts; the history); Round 4 additions (Stop, "not reached", the diff's four counts); UX-REVIEW B, C and Q; `reqs.md` 3.8 (Q236: a month's cost is the runs plus the research ledger), 6.3, 6.4 and Q217.

**Shared mechanism:** one run read. One SQL statement returns a run's counts, lists, per-source progress, re-confirmed pairs and not-reached count from one snapshot, and every count is taken over the run's recorded items only. Beside it, one database-level read: what is stored, what is scored, what has aged, and what this month cost in runs and research.

**Structural guards:** an invariant test over every run shape (sweep, scoped, retry, ask again, stopped, halted, failed): completed, failed, unanswered and not reached sum to the total, none is negative, and each source's counts lie within the items. ST-12's foreign keys are the database's own guard. The existing dead-SQL guard holds once three list queries are deleted.

**Order inside the cluster:** FU-A1, FU-A2, ST-11, P93, NEW-23, RN-R2, ST-12 (0509), the run's plan (0510), the new read fields, the cards and the diff, and FU-A6's texts last.

**Files likely changed:** backend `data_acquisition/` (`execution.py`, `stand_in.py`, `run.py`), `storage/run_store.py`, `storage/value_store.py`, `storage/queries/runs.sql` and `values.sql`, `api/runs.py`, `api/values.py`, the published-table tests; migrations 0509 and 0510; `ui/src/routes/run/` (`DatabaseHoldsPanel.tsx`, `databaseHolds.ts`, `AcquisitionDiffPanel.tsx`, `acquisitionDiff.ts`, `failureGroups.ts`, `ItemGroups.tsx`, `runProgress.ts`, `sourceReach.ts`, `spendCommitment.ts`, `RunScreen.tsx`); `ui/src/routes/configure/proposals/useResearchPass.ts` (the pass's outcome kept until read); `docs/openapi.yaml`; `docs/reqs.md` (both diagrams, the field tables, Q237); `docs/arch.md` (the retry text).

**What you will see change:** a run never reports more than it was asked; a retry asks only what it can; a stopped or unfinished run shows "not reached", and "retrying changes nothing" waits for the end; "What the database holds" shows the database; "Spent this month" includes research; the diff counts re-confirmed figures as unchanged and compares only what the later run was asked; each source's bar shows progress; the spend line shows the ceiling and the cap; a re-read that contradicts a stored figure shows as a failure.

**Risks and undesired consequences (from the runs and integrity maps):**
- ST-12 before FU-A1 would turn a leaking borrow into a failed run. The hard edge prevents it.
- If any run's evidence lies outside its items, 0509 refuses at the rehearsal, and a rebuilt backend would not boot until it is resolved (D15). No run is over-counted today, which makes leaked rows unlikely but does not prove there are none; the rehearsal will.
- Runs that already leaked would show smaller counts after the fix, while their diff still lists the leaked values.
- Each poll and each page of the history gains a key lookup per answered pair; measured with EXPLAIN on the copy.
- A retry no longer refreshes a borrow outside its exact pairs (D13).
- NEW-23: the value store must never raise on a contradiction, or one table would fail a whole run. The first run after deploy reports a failure for any table edited without a new date. Parental leave matches its table (31 of 31); the new manifest test checks the others before release.
- P93's fix leaves one residual: after a kill, a "stored and rejected" failure can stand without its figure until a retry.
- The contract changes reach the generated client, the mocks and the conformance tests. An old container cannot start on the migrated database, so migrate and rebuild together.

**Alternatives (from the maps):** filtering borrows in one caller (rejected: the rule in two places); a REPEATABLE READ transaction for the run read (rejected: it cannot be prepared, and it leaks isolation to writers through the pool); constraint triggers for ST-12 (rejected: not declarative); one transaction across stores for P93 (rejected: it gives up per-value durability); comparing quotes in NEW-23 (rejected: it contradicts NEW-33).

**Migrations and contract:** 0509, a run's evidence pinned to its items, scope and level; 0510, a run records its plan (each source's planned items, the estimate's ceiling and the cap). Contract: the run detail gains not reached, re-confirmed pairs, per-source planned items, ceiling and cap; a new database-holdings read with the month's spend; the retry's 409 text; every scope description says "exact pairs".

**Tests:** the maps' tests (FU-A1 T1–T5, FU-A2 T1–T4, ST-11 T1–T2, ST-12's scope tests with a pre-check replay and a race, P93 T1–T5 with a kill the run cannot catch, NEW-23's tests and manifest); each finding's test. Browser: a small free run whose three cards sum to its total; a run compared with itself reads "unchanged"; a stopped run, simulated, shows "not reached".

**Size:** 1 L, 11 M, 8 S: 49 hours. **Depends on:** C01.

### C05 Rank: the table, the drill-down and the score scale (phase 1)

**Items (21):** PL-062 to PL-082. UI-18, UF-103, KT-A4 with SV-N4 and SV-N5, SV-N9, UF-105, UF-106 with G-S1 and SV-N2, UF-107, UF-108, UF-112, UF-113, UF-114, UF-116, UF-117, UF-119, UF-120, UF-121, UF-122, UF-123, UF-143, UF-115, UF-014.

**Specification:** README, 3. Rank: the header (set, level, computed); the table and its columns; "No score"; Δ home with "baseline"; eleven pillar bars mapped between 40 and 96 with the score printed; coverage; all three confidence figures; the status pill; "Why this status" in plain words with no rule identifiers; the row backgrounds; the "Not in the ranking" band; the sort (matching by score, then the rest by score); the expanded row with pillar cards and the stored-values table (Weight, Weight used turning teal past 0.6 points, Contribution, Confidence, the "In use" pill); outside opinions. README, Deviations 3, 4 and 8. `docs/design-brief.md` §2: desktop only, down to 1280 px. `reqs.md` 5.1 to 5.4, 5.7 (confidence and its age downgrade), 7.1 (maximum ages) and 8.4.

**Shared mechanisms:** the scale travels with every score; one formatter for every signed number (the true minus sign, the figure's own precision, never a signed zero), which Compare also uses; one freshness source, the active-value view, read once per level.

**Structural guards:** a render test at a scale of 150 over Rank, the drill-down and the saved view that fails on any clamp or "0–100" label; the formatter's tests; the identifier guard's Rank entries removed from its ledger; computed-style browser checks of the row backgrounds at 1920, 1560, 1440 and 1280 px; the existing base-before-modifier test.

**Files likely changed:** backend `api/rankings.py`, `api/evaluations.py`, `api/catalog.py` (a false comment), `evaluation/ranking.py`, `evaluation/rules.py`, `data/store.py`, `data/value.py`, `storage/value_store.py`, `storage/queries/values.sql`, `backend/scripts/rank.py`, the in-memory test store; `ui/src/routes/rank/` (`RankingTable.tsx`, `rankTable.ts`, `CandidateDetail.tsx`, `attributeScores.ts`, `pillarFilter.ts`, `pillarCompleteness.ts`, `AttributeDrillDown.tsx`, `RankScreen.tsx`, `savedRanking.ts`); `ui/src/format/display.ts`; `ui/src/styles.css`; `docs/openapi.yaml`.

**What you will see change:** scores drawn and labelled on the scale they were computed on; both weight columns on one basis; unranked rows in score order; reasons in words, with units; missing attributes named; aged figures marked beside their chip; the set's name instead of its id; "Source switched off" and rejection reasons; "baseline" on the home row; a tooltip saying how each figure was scored; one tab stop per row, with its open state announced; the table fits at 1440 and 1280 px.

**Risks and undesired consequences:**
- *From the saved-rankings map (UI-18):* the saved half of the scale is a contract change against your 2026-10-14 ruling (D46); two browser specs find the score column by the text "Score", so that header keeps its text; a four-digit score may not fit a narrow bar at large scales.
- *From the same map (KT-A4):* a new abstract method on the value store, which every fake must implement; `make rank` sits outside coverage and was missed once before (BE-07), hence D20; "as of" becomes the database's date, whose time zone is not checked; the test that fails from 2028 is fixed here.
- One read per level (SV-N9) must still build its results from the roster, or candidates with no values would vanish.
- Reasons are frozen into saved rankings. You have none, so no saved text keeps the old wording.
- UF-103's basis change alters every figure in one column (D21).
- The narrow-desktop rules can disturb the 1560 px grid, hence checks at four widths.

**Alternatives:** each screen reads the scale from the settings (rejected: the scale can change between the two reads, and the bars would vanish when that read fails); carrying calendar months into Python, copying downgraded values, or a third query (all rejected in the map).

**Migrations and contract:** no migration. Contract: `score_scale_max` on Ranking, CandidateScoreDetail and Comparison; both weights on one basis; a freshness flag on each value.

**Tests:** the map's tests (128 on a scale of 150 prints "128"; a figure on the expiry boundary keeps its grade on any day); each finding's test. Browser: Rank at 1440 and 1280 px with nothing overflowing; a scale of 150 set on the copy and put back only after a successful read (the NEW-32 rule).

**Size:** 8 M, 13 S: 37 hours. **Depends on:** C01.

### C06 Hand entry (phase 1)

**Items (8):** PL-083 to PL-090. UF-071, UF-087, UF-089 with NEW-55-S2, UF-090, UF-091, UF-092, UF-062, NEW-59.

**Specification:** README, Round 4 additions, "Figures you can enter by hand": two editors in one frame; Values previewed as de-duplicated chips, or Score with its scale ("required — a score means nothing without its scale"); period from and to; Retrieved stamped for you; confidence; a link; problems in an amber notice with their fields marked; "Storing…"; the exact read-back with "See it in the Rank drill-down"; the note for a Quantity. README, 2. Acquire, "Attributes with no data source at all". `reqs.md` 3.3a (an assigned score and its range), 5.1, 6.5 and Q232.

**Shared mechanism:** C02's parser and field problems; one normalisation rule for any value with a declared range, so an Index and an assigned score are rescaled by the same function.

**Structural guard:** a normalisation table over every type that declares a range: a value at its midpoint scores the middle of the scale.

**Files likely changed:** backend `evaluation/normalisation.py`, `data/magnitudes.py`, `data/payloads.py`, `api/values.py`; `ui/src/routes/run/` (`ManualEntryPanel.tsx`, `manualEntry.ts`, `useManualEntry.ts`, `OpenToHandEntry.tsx`, `UnsourcedAttributes.tsx`, `unsourced.ts`); `ui/src/format/figure.ts`; `ui/src/routes/rank/RankScreen.tsx`; `ui/src/styles.css`; `docs/openapi.yaml`.

**What you will see change:** 7 on a scale of 0 to 10 scores 70; the form has its designed parts; a link must be a web address; a stored figure links to Rank at its candidate and pillar; with "Manual entry" switched off, hand entry is refused with the reason (D23); a label that contains a comma reads as one label, and hand entry takes labels as D22 decides.

**Risks and undesired consequences:** rescaling changes the score of any assigned score already stored with a range other than 0 to 100 (your two assigned-score attributes hold no figures by design; the rehearsal confirms it); opening Rank at a candidate must agree with the open rows the session store remembers; the 409 for "Manual entry" off is new API behaviour; D22's recommendation departs from the design's comma-separated field and is recorded in the design brief.

**Alternatives:** rescaling in the interface (rejected: the arithmetic belongs to the server); keeping the comma field and refusing commas (D22).

**Migrations and contract:** no migration. Contract: a 409 when "Manual entry" is off; the link check's 422.

**Tests:** normalisation unit tests; an acceptance test that stores 7 on 0 to 10 and reads 70 from the drill-down; the form's tests. Browser: a hand-entry round trip on the copy, whose read-back link opens the right row and pillar.

**Size:** 3 M, 5 S: 14 hours. **Depends on:** C02 and C05.

### C07 Compare (phase 1)

**Items (18):** PL-091 to PL-108. UF-124, UF-125, UF-126, UF-127, UF-128, UF-129, UF-130, UF-131, UF-132, UF-133, UF-135, UF-136, UF-137, UF-138, UF-139, UF-140, UF-141, UF-144.

**Specification:** README, 4. Compare: the selection card and its live note ("Up to N countries… M chosen"), chips dimmed at the limit, the synthesis cards ("+4.2 points" or "No comparable score", "Ahead on" and "Behind on" ordered by worth, "#1 priority", the "Not comparable" footnote), the matrix with its total row, diverging bars and thresholded tint, the expanded pillar with "#N in pillar". README, Null propagation. UX-REVIEW F, L and R4. DECISIONS 2026-09-20, comparator limit. `reqs.md` 8.5. The recorded divergences 8 (raw gaps read focus minus comparator) and 9 (an unset limit is refused).

**Shared mechanism:** one sign convention for cards and matrix (D24), the signed-number formatter from C05, and the selection held in C01's session store.

**Structural guards:** a render test that every card's sign agrees with its matrix column; formatter tests that no zero is ever signed.

**Files likely changed:** backend `comparison/comparison.py`, `api/comparisons.py`; `ui/src/routes/compare/` (`CompareScreen.tsx`, `ComparisonMatrix.tsx`, `ViewChoices.tsx`, `pillarMatrix.ts`, `attributeRows.ts`, `synthesisImpact.ts`, `comparisonRequest.ts`, `comparatorLimit.ts`); `ui/src/format/display.ts`; `ui/src/styles.css`; `docs/openapi.yaml`.

**What you will see change:** each card reads the right way round and agrees with the matrix; at the limit, new chips are dimmed with a reason and nothing is dropped silently; gaps carry their figures' precision; the comparison redraws as you choose; status tags on columns and cards; each raw figure's source and dates on hover; contributions and weights on attribute rows; a partial comparison says which pillars are missing; "No score" in words; a default focus (D26); columns in score order.

**Risks and undesired consequences:** the synthesis sign and lists change for API clients, and one unit test that asserts the reversed sign is rewritten; live redraw sends a request per change, so it is debounced and an older answer never replaces a newer one; a default focus may surprise (D26); raw mode keeps its own labelled direction unless you choose D24's second option.

**Alternatives:** titling each card from the focus (D24); marking an old result as out of date instead of redrawing (rejected: the design redraws live).

**Migrations and contract:** no migration. Contract: the synthesis sign and lists, each line's pillar, attribute weights.

**Tests:** the sign-agreement test; each finding's test. Browser: Portugal as focus against Malta and Germany, where each card's sign matches its matrix column; ticking past the limit is refused where you can see it.

**Size:** 6 M, 12 S: 30 hours. **Depends on:** C01 and C05.

### C08 Weights, locks and held controls (phase 2)

**Items (7):** PL-109 to PL-115. NEW-46 with NEW-46-S1, NEW-68 with H-L1 to H-L3, UF-034 with NEW-58 and SV-N8, UF-035, UF-052, UF-067, UF-068.

**Specification:** README, Stage 3 (the rows, the 26 px lock, "Weight redistributed", "Required", the refusal banner); README, Interactions & behaviour, weight rebalancing ("refused with a banner naming up to three to unlock"); `docs/design-brief.md` §1, interaction states; `reqs.md` 5.3 (an excluded criterion is absent downstream), 8.2 and Q82.

**Shared mechanism:** one held look for every held control, and one padlock drawing for both locks.

**Structural guards:** the held-control test helper fails when no held rule in the stylesheet matches the control; a browser test reads the computed opacity and cursor of each kind of held control; the optional lint rule against native `disabled` (D29).

**Files likely changed:** `ui/src/styles.css`; `ui/src/testing/keyboard.ts`; a new `ui/src/routes/configure/LockIcon.tsx`; `pillars/PillarWeightsPanel.tsx`; `criteria/` (`CriteriaPanel.tsx`, `CriterionRuleFields.tsx`, `criterionReading.ts`); `ui/src/routes/rank/pillarFilter.ts` and `pillarCompleteness.ts`; Acquire's history button; the backend's locked-weights refusal; `docs/design-brief.md`.

**What you will see change:** held controls look held, after a short delay (D28); both locks show a padlock, shut or open, with hover and pressed states; unscored criteria say "Not scored, matching only", and "Required" appears only where it is true, on Configure and on Rank; the locked-weights refusal names the locks and clears when they change; pillar rows show their unsourced share.

**Risks and undesired consequences (from the UI and history maps):** every slider release dims about 22 controls for the length of the save (D28); about 90 assertions come to depend on the stylesheet; two held looks exist today and must become one (D27); an SVG without a size draws at 300 by 150 px, which only a browser can see; the design file still draws a disc, and a later design sync could bring it back (D30).

**Alternatives (from the maps):** one generic held rule (rejected: it stacks on looks chosen on purpose); scanning source text for held markers (rejected: it misses classes built at run time); going back to native `disabled` (rejected: it throws focus away, NEW-34); an emoji, a CSS-drawn padlock or an icon library (rejected in the history map).

**Migrations and contract:** no migration and no contract change. The contract already says the locked-weights refusal carries the blocking locks in its details; the server is made to send them wherever it does not.

**Tests:** the maps' T46-1, T46-2 and T68-1 to T68-4; NEW-58's tests; each finding's test. Browser: hold a pillar write and read the computed styles; the padlock's box lies inside its button.

**Size:** 2 M, 5 S: 11 hours. **Depends on:** C01 and C02.

### C09 Acquire: starting, following, stopping and retrying (phase 2)

**Items (18):** PL-116 to PL-133. UF-076, UI-24, P94, UF-080, UF-081, UF-082, UF-083, UF-084, UF-096 with RN-R1, UF-088, UF-098, UF-099, UF-100, UF-101, UF-102, UF-017, UF-018, UF-023.

**Specification:** README, 2. Acquire: the progress card ("Acquiring now", "Acquisition finished", "Stopped early"), the per-source list, "Stop — keep what completed"; the selection (Select all and Clear all, All and None per group, tri-state boxes, "Retry 2 selected", "Nothing is failing" when there is nothing); the confirmation strip's sentence; "Every acquisition so far" with sequential numbers. README, Round 4 additions: Stop, the amber stopping card with "Stop asked at HH:MM", "halted by you" apart from "halted at the spend cap", "Charged €X of the €Y ceiling". README, Shell, the acquisition progress bar. README, Contract bindings: the in-flight refusal names the run to poll. UX-REVIEW B, C and D. `reqs.md` 5.6 (re-fetching is explicit, per candidate and per attribute), 6.2, 6.3, 6.4 (a retry asks only what failed), 8.3, Q161 (live progress) and Q217.

**Shared mechanisms:** a card poll that never touches the screen's ticket logic; one status vocabulary, words and colour, for every place a run's status appears; a page-level pending-start store; the selection sent as exact pairs (D32).

**Structural guards:** a test that the card poll never claims a ticket or clears a refusal; a test that the status vocabulary covers every status the contract names; an it.each that the armed strip clears on every way the card or the selection can change.

**Files likely changed:** `ui/src/routes/run/` (`RunScreen.tsx`, `useRunScreen.ts`, `useWatchedRun.ts`, a new followed-run hook, a new `pendingStart.ts`, `ItemGroups.tsx`, `runScope.ts`, `sourceReach.ts`, `databaseHolds.ts`); `ui/src/shell/` (`AcquiringBar.tsx`, `useAcquiring.ts`, `acquiringProgress.ts`, `Sidebar.tsx`); `ui/src/test-setup.ts`; backend `api/runs.py`, `data_acquisition/execution.py`; migration 0511; `docs/openapi.yaml`.

**What you will see change:** the card follows a running acquisition without a click and stops at the end; the stopping state is drawn; Start is held while a run is in flight and names it; leaving Acquire during a start keeps the start; an estimate with nothing to ask is refused at once; the refresh card confirms like the others; statuses are words; Retry estimates and asks exactly what is selected, and a picker can ask about one candidate, attribute or pillar (D32); history rows say what each run was for; focus stays where you are reading; the strip says "Stopping…", polls slowly when nothing runs, and looks as designed.

**Risks and undesired consequences (from the runs map):**
- A poll that went through the screen's act path would wipe refusal banners, flicker every held control and re-read the history each tick. The design avoids it and a test guards it.
- A poll that took a ticket would bring an old run back over a new one (UIR-G1, RB-1, NEW-49). The id check prevents it.
- About ten existing tests become timer-sensitive. Two pollers run while Acquire is open; after ST-11 each detail read is one statement.
- A pending-start store that is never cleared would hold every start until a reload. It is cleared in a `finally` and tested.
- A start refused while Acquire is closed needs a rule (D33).
- Selective retry changes what Retry costs and adds a contract shape (D32). A picker can start paid work, so it always estimates first and arms the strip.

**Alternatives (from the map):** lifting the shell's poll into a provider (rejected: it rewires UI-11 and still needs a final read); pressing Refresh on a timer (rejected: see the first risk); holding Start from the shell's poll (rejected: the window is before the run exists); opening the in-flight run from the refusal's text (rejected: an id belongs in the details).

**Migrations and contract:** 0511, a run records its purpose (D34). Contract: plan and retry take exact pairs; the in-flight refusal carries the run's id; an estimate with nothing to ask is refused.

**Tests:** the map's UI-24 and P94 tests (followed to the end without a click; a refusal's banner survives three ticks; the history read once at the end; a held start kept across a tab change); each finding's test. Browser: a variant of the gate-C walk that reaches the end with no Refresh; a held start across a tab change.

**Size:** 1 L, 5 M, 12 S: 35 hours. **Depends on:** C04 and C08.

### C10 Source priority (phase 2)

**Items (4):** PL-134 to PL-137. UF-042, UF-043, UF-044, UF-061.

**Specification:** README, Stage 5 (the switch, the number or "—" when off, the name, the attribute count or "not consulted", arrows and drag); UX-REVIEW P; `reqs.md` 6.6 (priority, per-attribute orders, maximum age) and Q232.

**Shared mechanism:** one reorder operation, atomic, that keeps the stored gaps between priority tiers.

**Structural guard:** a property test over random orders and moves: drag, arrows and a tied swap all go through the one operation, and every gap a move does not cross is kept.

**Files likely changed:** `ui/src/routes/configure/sources/` (`DataSourcesPanel.tsx`, `useDataSources.ts`, `sourceOrder.ts`, `sourceReading.ts`); the backend's data-source API, store and query; `docs/openapi.yaml`.

**What you will see change:** each source says how many attributes it answers, or that it answers nothing yet; switching off a source behind a blocking attribute says what it costs; attributes with their own order are listed with their maximum ages; a move keeps the stored tiers; two tied sources can be swapped.

**Risks and undesired consequences:** a new operation beside the single-source change, so both go through one store function; this repository's lesson that a unique priority makes every reorder impossible (one transaction, no unique constraint); C11 records a reorder as one change, which is why C10 comes first.

**Alternatives:** the client renumbers only the rows a move crosses (D36: no contract change, but a move and its undo can stop half way).

**Migrations and contract:** no migration. Contract: a reorder operation.

**Tests:** the property test; acceptance tests. Browser: drag a source, read back that the tiers kept their gaps, then restore.

**Size:** 3 M, 1 S: 10 hours. **Depends on:** C01.

### C11 The change history (phase 2)

**Items (5):** PL-138 to PL-142. UF-030 with NEW-67 and UF-057; H-S1, H-S3, H-S5, H-S6 and H-S7; UF-038 with H-S4 and P99-S1; UF-055 with H-S2; P99 with P99-S2 and P99-S3.

**Specification:** README, "Change history rail" (the stage in small uppercase teal, the time, "Undo this" withheld with "Held by a later change to the same setting", "↑ Undo all N", the hover preview, no explanatory paragraph). README, Interactions & behaviour, "Undo" (every judgement-level edit recorded; consecutive edits to one target collapse; undo restores the whole state). UX-REVIEW E and R6, and round 3's "Undo direction and single-change undo" and "Rebalancing and undo". DECISIONS 2026-09-20 on the rail. `reqs.md` 8.2. This repository's rule that undo re-issues the real request and never restores local state.

**Shared mechanisms:** screen-level writer hooks own every set write and record it with its reverse request; the history lives for the session, above the routes (D40); a set-write tracker in the shared read path, so no read of a set is accepted while a write to it is in flight (P99).

**Structural guards:** set-changing client calls (and, under D37, household, settings and source writes) may be imported only by the recording hooks, and each of those records the change; an it.each over every recorded writer (one entry; its undo sends the opposite request to the same path); every set-scoped path names `criteriaSetId`; the identifier guard after one change of each kind.

**Files likely changed:** `ui/src/routes/configure/` (`ConfigureScreen.tsx`, `RecentChanges.tsx`, `changeHistory.ts`, `useChangeHistory.ts`, `useCriteriaEditor.ts`, `weights.ts`, a new `pillars/usePillarWeights.ts`, `PillarWeightsPanel.tsx`, a new `rules/useRuleSwitches.ts`, `useRuleToggles.ts`, `RulesPanel.tsx`, `criteria/criterionForm.ts`, `sets/useCriteriaSets.ts`, `household/useHouseholdForm.ts`, `settings/useSettingsForm.ts`, `sources/useDataSources.ts`); `ui/src/api/setWrites.ts` and `client.ts`; the session store in `ui/src/shell/`; `ui/src/test-setup.ts`.

**What you will see change:** every Configure edit in the decided scope appears with its stage and can be undone, alone or all the way back, with a preview; where an undo cannot be exact, the entry says so before you press it; rule switches are held while they save; the history survives a tab change; a deleted set's entries go, with a count; no screen shows a read of a set that a pending change has overtaken.

**Risks and undesired consequences (from the history and UI maps):**
- An undo racing a pillar or switch write. The holds ship in the same commit as the recording.
- An undo answer landing on a panel that has remounted. Lifting the state to screen level prevents it.
- The lift moves code that UI-04, UI-05, NEW-34 and NEW-43 rely on; their tests are the safety net.
- More controls are held, so more of them dim once C08's look exists.
- Under D37's recommendation an undo reaches global settings and can unset the score range, which stops every ranking. The entry warns before you press it. A set's deletion cannot be reversed, and its entry says so.
- P99: a write that never answers keeps its set loading (D44 adds a note). A counting error could loop or hang, so a write's end runs once, in a `finally`, and every way a request can end is tested.

**Alternatives (from the maps):** recording in the panels and reloading the set on undo (rejected: a reload unmounts every stage and drops unsent drafts); one writer for the whole set (D41); a whole-level weights operation (D38); a server-side version number for P99 (rejected: a migration and a contract change that still needs in-flight tracking).

**Migrations and contract:** none, unless D38's second option.

**Tests:** the history map's T67-1 to T67-17 and its browser test; the UI map's T99-1 to T99-6 and the tracker's unit tests; each finding's test. Browser: move a pillar, undo, reload, and read the stored value back.

**Size:** 2 L, 2 M, 1 S: 23 hours. **Depends on:** C01, C02, C03, C08 and C10.

### C12 Saved rankings and the evaluation tree (phase 2)

**Items (6):** PL-143 to PL-148. FU-A3 and FU-A4 with ST-07, G-S7 and G-S9; UF-104 with SV-N3; UF-013; UF-111 and UF-118 with NEW-56, NEW-56-S5 and NEW-56-S6; ST-13 with SV-N6; ST-14 with SV-N7.

**Specification:** README, Shell, sidebar item 7 (each saved ranking as its name over "<leader> led, <date>", a ×, the empty state); README, 3. Rank, header ("Save this ranking" opens a note field with Save, Cancel and a hint that weights, locks and every value behind the scores are frozen with it); UX-REVIEW A; `docs/design-brief.md`, "a saved ranking opens rather than restores"; `reqs.md` 3.4a and 5.5; CLAUDE.md's rule of full provenance on every displayed number.

**Shared mechanisms:** immutable evidence referenced by key (gate-answer versions, the judged value's id); the saved read returns the same shapes as the live one; composite foreign keys pin every evidence row to its candidate, attribute and frozen criterion.

**Structural guards:** every foreign key into the evaluation tree cascades (G-S9); the "live equals saved" test extended to evidence and provenance; a schema test that every evidence column is pinned to a value of its own candidate and attribute.

**Files likely changed:** migrations 0512 and 0513; `storage/queries/evaluation.sql` and `criteria.sql`; `storage/evaluation_store.py`, `storage/match_rule_result_store.py`; `evaluation/rules.py`, `evaluation/store.py`; `data/rules.py`; `api/evaluations.py`, `api/rankings.py`, `api/rules.py`; `docs/openapi.yaml`; `ui/src/routes/rank/` (`SaveControl.tsx`, `useSavedRankings.ts`, `SavedRankingView.tsx`, `SavedRankingsPanel.tsx`, `savedRanking.ts`, `RankScreen.tsx`); `ui/src/shell/Sidebar.tsx`; the storage, acceptance and boot-sweep tests; `docs/reqs.md` (Q218 revised in Q237).

**What you will see change:** opening a saved ranking brings it into view with its set, level, date and note, its pillars and Δ home, and a drill-down whose figures show their source and dates and the gate answer each refusal read; saved rankings show their leader and can be deleted (D47); the save control appears only when there is something to save, keeps focus, and says what it saved.

**Risks and undesired consequences (from the gates and saved-rankings maps):**
- Versions depart from the approved plan and revise Q218 (D45).
- An old container on the migrated database fails every gate write and every save, and the boot check does not catch a database that is ahead. Migrate and rebuild together.
- Every reader must still see one live answer per pair; one query does all the reads, and a test pins it.
- A proposal declined over a person's answer would leave a version behind unless a savepoint discards it.
- New tables leak rows between tests unless the test truncation lists them.
- Rankings saved before 0512 carry no evidence; you have none.
- An evidence rule belongs in the writer, never in a read-time check, or reopening a ranking answers 500 (R-1's class).
- Values cited by saved rankings can no longer be deleted, which more rollbacks will trip on (C16 explains them).
- Freezing a level's criteria without their anchors would break every multi-level save; an INNER JOIN would drop a contribution silently. One storage test already saves an unfrozen contribution and will fail by design.
- Exposing the evidence departs from your 2026-10-14 ruling (D46).

**Alternatives (from the maps):** a jsonb copy of the answer (the approved plan); a pointer table, or one table with superseded rows; the approved plan's single input table; a child table per reason; triggers; validation in the store only.

**Migrations and contract:** 0512, gate-answer versions with the version a refusal read and the value a threshold judged (FU-A3 and FU-A4 together); 0513, contributions, evidence inputs and frozen criteria pinned, last in the cluster (ST-13 and ST-14). Contract: a refusal's gate answer and judged figure, a warning's inputs, each contribution's used value with its provenance (already declared in the target contract), the saved scale, the summary's leader, and a delete operation for saved rankings.

**Tests:** the gates map's section 3.9 and the saved map's FU-A3, ST-13 and ST-14 tests, with their mutations; the UI map's T56-1 to T56-7; each finding's test. Browser: save a ranking on the copy, open it, read its pillars and one figure's provenance, then delete it.

**Size:** 2 L, 3 M, 1 S: 26 hours. **Depends on:** C01, C05 and C08.

### C13 Gates and research (phase 2)

**Items (14):** PL-149 to PL-162. NEW-64 with G-S3, NEW-66 with G-S2, NEW-65 with G-S4, UI-29, BE-36 with G-S5, UF-109, UF-039, UF-040, UF-041, UF-056, UF-058, UF-059, UF-060, UF-069.

**Specification:** README, Stage 4 (the callout; each rule row with its switch, name, description, a cost line such as "Removes United Kingdom." or "Flags 3 countries: …" ending "— not while this is off.", and a gate or warning select); README, Interactions & behaviour, "Match rules really apply"; `docs/design-brief.md`, gate research one question at a time (2026-10-19); UX-REVIEW O; `reqs.md` 3.7 ("the reference period lets the interface mark an expired judgement and prompt a re-check"), 3.7a, 6.10, 7.3 and 8.2 ("named match rules with their results, sources and overrides"); the household policy of 2026-10-13 (a confirmed answer is never auto-expired and never silently overwritten); Q218 and Q236.

**Shared mechanisms:** one shared read of gate answers for the answers area, the proposals, the rule effects and Rank's detail; the gate-names hook from C01; one module that reads a period and an age.

**Structural guards:** the identifier guard sees real gate ids; a test that every rendered link to a page passes the web-address check, so no `javascript:` link can reach the screen; a policy test that an answer whose period has ended still applies.

**Files likely changed:** a new `ui/src/routes/configure/answers/` folder (form, hook, panel) and `gateAnswerReading.ts`; `proposals/` (`ProposalsPanel.tsx`, `useProposals.ts`, `useResearchPass.ts`, `researchPass.ts`, `proposalReading.ts`); `rules/` (`RulesPanel.tsx`, `ruleEffect.ts`, `useRuleToggles.ts`); `ConfigureScreen.tsx`; `ui/src/mocks/handlers.ts`; `ui/src/routes/rank/CandidateDetail.tsx` and `RankingTable.tsx`; backend `data_acquisition/research.py`, `api/rules.py`, `evaluation/rules.py`, `storage/match_rule_result_store.py`, `storage/queries/criteria.sql` and `catalog.sql`; migrations 0514, 0515 and 0516; `docs/openapi.yaml`; `docs/reqs.md` (3.7, 3.7a, 7.3, Q237).

**What you will see change:** names, never ids, in the proposals and in research refusals; the research panel names its level and stays on it; a "Gate answers" area to record, correct, rule out or re-check an answer, showing its period, its age and an "ended, still applied" note; Rank's detail shows each gate answer and marks an override; rule rows say what they test, whom they flag, and are coloured by their effect; a rule can act as a gate or a warning in each set (D56); research states the cap and counts only what it will ask.

**Risks and undesired consequences (from the gates map):**
- Your set enforces all five gates, so one wrong answer saved as "not matching" removes a country from the live ranking at once. The form shows the effect and asks before it saves a "not matching".
- The override date is re-stamped on every correction today (D51).
- No operation deletes an answer (D52 offers "withdraw" as a new version).
- The mock never refuses today, so the sad-path tests teach it to.
- A re-check spends money. It is estimated and armed like any paid act, tested with fakes, and `make live-llm` is never run without your go-ahead.
- The gate or warning choice changes evaluation, and must be frozen with saved rankings, so 0516 also extends 0507's frozen rule lists.
- About 54 assertions change for names and level wording.
- A gate with no level can no longer list concerned candidates (D55); none does today.

**Alternatives (from the map):** the form inside the set-keyed rules panel (rejected: a set switch would discard a half-typed answer); editing a proposal in place (rejected: it covers neither unproposed answers nor ruling out by hand); expiring an answer when its period ends (rejected by the household policy); a trigger for NEW-64 (rejected: a first trigger for a rule a foreign key can hold).

**Migrations and contract:** 0514, a gate's candidates sit at its level; 0515, gate descriptions as catalog data; 0516, a rule's outcome per set, frozen with saved rankings (if D56 builds it). Contract: the re-check scope on research and its estimate; the pending proposal beside a confirmed answer; gate descriptions; the per-set outcome; the override date's behaviour.

**Tests:** the gates map's sections 4.9, 5.9, 6.9, 7.9 and 8.9; each finding's test. Browser: record an answer on the copy, see Rank's gate block, then withdraw it, putting it back only after a successful read (the NEW-32 rule).

**Size:** 3 L, 3 M, 8 S: 41 hours. **Depends on:** C01, C08 and C12.

### C14 The household (phase 2)

**Items (4):** PL-163 to PL-166. UF-028, UF-029 with G-S6, UF-049, UF-050.

**Specification:** README, Stage 2 (the fields, adults and children as segments, € and "per month", "edits flow to the sidebar card, and citizenship really does drive the gates"); README, Shell, sidebar item 2 (one household, one vocabulary); README, Interactions & behaviour, "Citizenship drives the citizenship gates"; UX-REVIEW I and R5; `reqs.md` 1.4, 3.9, 7.3 (EU free movement is "automatic while that citizenship is EU") and 7.4.

**Shared mechanism:** the household's citizenships become an input to gate evaluation through catalog rows, never through code.

**Structural guard:** an it.each over the catalog: every gate that names clearing citizenships is evaluated against the household, and EU free movement applies with no recorded answer at all.

**Files likely changed:** `ui/src/routes/configure/household/`, `ui/src/format/vocabulary.ts`, `ui/src/shell/Sidebar.tsx`; backend `household/`, `evaluation/rules.py`, `evaluation/ranking.py`, `api/rankings.py`, `data_acquisition/research.py`; migration 0517; `docs/openapi.yaml`; `docs/reqs.md` (3.7, 7.3, Q237); `docs/arch.md` 6.1 if evaluation's import table must name the household.

**What you will see change:** income is monthly; the words match the design; adults and children have a "more" choice; a British or Irish passport clears the UK skilled-worker gate, and a Swiss one the EU/EFTA quota gate; EU free movement is derived; answers recorded for a different household are flagged for a re-check.

**Risks and undesired consequences:** the stored income figure changes meaning (D58: you re-enter it before deploy); a citizenship change moves the live ranking at once (intended); evaluation starts reading the household, which the import table must allow, and BE-31's guard checks it; the re-check flag needs C12's versions and C13's re-check.

**Alternatives:** making stage 2's lead true and leaving the gates to recorded answers (D59); writing citizenship rules in code (rejected: nothing is hardcoded).

**Migrations and contract:** 0517, the citizenships that clear each gate, and the citizenships each answer assumed. Contract: an answer's "needs a re-check" flag; rule effects that name citizenship.

**Tests:** evaluation tests per gate; an acceptance test that a British citizenship brings the United Kingdom back into the ranking. Browser: change citizenship on the copy, see stage 4's cost line and Rank change, then restore.

**Size:** 1 L, 3 S: 11 hours. **Depends on:** C02, C12 and C13.

### C15 Data integrity in SQL, and the contract (phase 3)

**Items (6):** PL-167 to PL-172. ST-16 with IN-NAN, ST-15, ST-17 with IN-LABEL, ST-18 with P10 and BE-35, ST-10, and NEW-61 with NEW-62, IN-D1 and IN-D2.

**Specification:** `docs/arch.md` 3.3b ("they need no triggers"), 7.4, 9.5 and 10.7; `reqs.md` 3.5a (older editions are kept and shown as history; Q148), 3.6 (Monetary's rate as rate, date and publisher) and 5.5; CLAUDE.md (a conversion names a rate the ECB published, 0112); the target contract's types.

**Shared mechanisms:** the database refuses impossible values (finite checks, completeness triggers per D60, one bound per criterion); a drift guard that compares the target and generated contracts for null in both directions.

**Structural guards:** a schema test that every numeric column the domain reads carries a finite check, with a named list of exemptions; the drift guard; the migration hygiene tests extended to triggers and functions.

**Files likely changed:** migrations 0518 to 0522; `storage/value_store.py`, `storage/criteria_store.py`, `storage/queries/values.sql`; `data/payloads.py`, `data/fx.py`, `data/external_score.py`; a new ECB source under `data_sources/` (D63); `api/values.py`, `api/bodies.py`, `api/errors.py`, `api/household.py`, `api/evaluations.py`, `api/rules.py`, `main.py`; `docs/openapi.yaml`, `docs/openapi.implemented.yaml`, `ui/src/api/schema.ts`; `ui/src/routes/rank/CandidateDetail.tsx`; `ui/src/format/figure.ts`; `docs/arch.md`, `docs/reqs.md`, `docs/datasources.md`, `docs/known-issues.md`.

**What you will see change:** nothing, for valid data; a non-euro amount works end to end and shows its rate, the rate's date and its publisher (D63); earlier editions of an outside opinion are labelled; the API refuses null where the design gives it no meaning, and leaves absent fields out.

**Risks and undesired consequences (from the integrity map):** the first triggers and functions in the schema (D60); the 0478 and 0492 race tests break unless they change in the same commit; the share tolerance would live in SQL and in Python, so the boundary test imports the Python constant; ST-16's full scope is L; a new Monetary payload key must land with its SQL, or every Monetary read fails; an ECB source is a new network dependency, tested live only under `make live`; the household's request and response bodies must be split, or a naive change answers 500; which index an outside opinion belongs to is a design question (D64); whether the schema diagram reads triggers is not checked; a kill during `make migrate` can leave yoyo's lock row behind.

**Alternatives (from the map):** checks on read only (rejected: the bad state stays stored); a SQL function as the only write path (rejected: unenforceable here); deriving the publisher on read (D63); a schema hint on each field (rejected: easy to forget on the next one).

**Migrations and contract:** 0518 finite numbers; 0519 completeness triggers; 0520 one bound per criterion; 0521 the rate's publisher; 0522 an outside opinion's series. Contract: FxRate served; the nested manual-entry shape; an outside opinion's series and current flag; null removed where the design types a field without it, or admitted where D65 says.

**Tests:** the integrity map's tests for each item, with pre-check replays; the drift guard. Browser: all five migrations rehearsed on a copy of the newest backup; an earlier edition labelled on Rank.

**Size:** 2 L, 3 M, 1 S: 26 hours. **Depends on:** C04, C06 and C12.

### C16 Tooling and rollbacks (phase 3)

**Items (7):** PL-173 to PL-179. P100 with TL-N4, P98, P96, P97, P95 with TL-N1, TL-N2 with SV-N1, TL-N5 with TL-N6. P100 comes first.

**Specification:** `docs/arch.md` 7.4 (migrations never automatic) and 9.5 (backups); Gate D; the decisions of 2026-10-22 (a rollback that would delete recorded history refuses, and locks before it counts); CLAUDE.md's rules for the e2e copy; `docs/known-issues.md` P95 to P100.

**Shared mechanisms:** the e2e copy's URL is built by a script that reads `.env` as compose does; the migration runner explains integrity errors; the hygiene guard fails closed.

**Structural guards:** the fail-closed hygiene test; a check that every criterion copy carries `weight_locked` and `is_scored`; a race test for each refusing rollback; sandbox tests of the Makefile on make 3.81.

**Files likely changed:** `Makefile`; a new `tools/e2e_copy.py`; `tools/migrate.py`; `compose.yaml`; `backend/tests/storage/` (`test_migration_hygiene.py`, `test_rollback_races.py`) and the make and migrate tooling tests; the applied migrations 0442, 0445 and 0488; the rollbacks of 0441, 0444, 0461, 0463, 0467, 0471, 0476, 0477, 0478, 0483, 0486, 0487, 0492, 0493, 0500, 0501, 0504 and 0507; `docs/known-issues.md`.

**What you will see change:** `make e2e` works with any password and never prints it; the containers work with any password; a rollback that cannot proceed refuses with a reason and a remedy, not a database error; locks survive a criterion's replacement on a restored dump; no rollback deletes recorded history or overwrites your weights without refusing.

**Risks and undesired consequences (from the tooling map):** editing an applied rollback changes what your live database's next rollback does; each edited rollback must still complete on an empty database at its own revision, which needs private databases and adds test time; under P95's widest option, deep rollbacks refuse on any used database (D69); four make tests change; the script must read the file first and the environment second, or an exported port no longer matches; P97 cannot repair the live database, only check it read-only; P96's refusal option would refuse a name that works today.

**Alternatives (from the map):** cascading foreign keys (rejected: silent deletion); rollbacks that delete the blocking rows first (rejected: they destroy configuration); parsing `.env` inside make (rejected); capturing the URL from the script's output (rejected: a malformed URL would leak the password); a real SQL parser for the guard (rejected: a compiled dependency).

**Migrations and contract:** no new migration numbers. Edits to the applied forward files 0442, 0445 and 0488 affect only databases that apply them later; edits to rollbacks affect every database, yours included. No contract change.

**Tests:** the tooling map's section 9 tests; a sandbox `make e2e` with passwords containing `@`, `%`, `#` and quotes.

**Size:** 5 M, 2 S: 17 hours. **Depends on:** nothing functionally.

### C17 Docs, dead code and trackers (phase 3)

**Items (3):** PL-180 to PL-182. UF-022; UF-024 with E2E-1; G-S8 with TL-N3.

**Also in this cluster:** the trackers' closing state; the corrections the earlier draft owed in my trackers (two misleading "finished" sentences and a stale totals line); the relay to the other agent of every CLAUDE.md fact that changed (section 8); and the final convergence review over every commit of the round.

**Files likely changed:** `docs/design-brief.md`; the dead code the review names; `ui/e2e/minimum-end-to-end.spec.ts`; `docs/copilot-remediation-plan/ui-configure.md`; the trackers.

**Size:** 1 M, 2 S: 5 hours. **Depends on:** every other cluster.

## 4. Phases and order

### 4.1 The order

| Order | Cluster | Phase | Why it sits here |
|---:|---|---:|---|
| 1 | C01 The shell and truthful states | 1 | A Critical item, and the read, error, name and session mechanisms every screen needs |
| 2 | C02 Forms | 1 | A Critical item (UF-026), and the one parser every typed number needs |
| 3 | C03 Criteria-set management | 1 | A Critical item (delete in one click) |
| 4 | C04 Runs: accounting, evidence and the diff | 1 | Two Critical items; FU-A1 lands before ST-12 inside it |
| 5 | C05 Rank | 1 | A Critical item (UI-18); it builds the signed-number formatter Compare uses |
| 6 | C06 Hand entry | 1 | A Critical item (UF-071); needs C02's parser and C05's Rank |
| 7 | C07 Compare | 1 | A Critical item (UF-124); needs C01's session store and C05's formatter |
| 8 | C08 Weights, locks and held controls | 2 | The held look and the padlock (NEW-46 and NEW-68 in one commit) that C09, C11 and C12 rely on |
| 9 | C09 Acquire: starting, following, stopping and retrying | 2 | A High item that can start an unseen paid scope; needs C04 and C08 |
| 10 | C10 Source priority | 2 | Its atomic reorder makes a source move undoable as one change in C11 |
| 11 | C11 The change history | 2 | A High item; NEW-67 lands before P99 inside it |
| 12 | C12 Saved rankings and the evaluation tree | 2 | A High item; FU-A3 and FU-A4 share a migration, ST-13 and ST-14 come last |
| 13 | C13 Gates and research | 2 | A High item (UI-29) that needs C12's answer versions |
| 14 | C14 The household | 2 | Two High items; citizenship-driven gates need C12 and C13 |
| 15 | C15 Data integrity in SQL, and the contract | 3 | Low items only; new constraints land after the code that writes the data is settled |
| 16 | C16 Tooling and rollbacks | 3 | Low items, plus PL-178, a Medium only a deliberate rollback can reach; P100 first. No earlier migration depends on this cluster: the new ones are written in the shapes today's guards already read |
| 17 | C17 Docs, dead code and trackers | 3 | Closes the round, then the final convergence review |

### 4.2 Migrations, numbered in landing order

Every migration locks what it checks in its first statement, names the migration it follows, refuses with a named reason rather than changing anything, and has a rollback that refuses wherever it would delete recorded history. Each one is rehearsed by `make e2e` on a copy of your newest backup before `make migrate` touches the live database. If an optional one is not chosen, the numbers after it close up.

| Number | Cluster | Item | What it does | Its pre-check refuses when |
|---|---|---|---|---|
| 0508 | C03 | PL-036 | Set names are unique, ignoring case | Two live sets share a name |
| 0509 | C04 | PL-048 | A run's values, failures and reuse rows are pinned to its items; its items to its scope lists; its scope lists to its level | Any row lies outside its run's items, or any item outside its run's lists or level |
| 0510 | C04 | PL-055, PL-056 | A run records each source's planned items, its estimate's ceiling and the cap | Nothing: new columns; older runs show "not recorded" |
| 0511 | C09 | PL-127 | A run records its purpose (if D34 says so) | Nothing: older runs show "not recorded" |
| 0512 | C12 | PL-143 | Gate answers become immutable versions; a saved refusal pins the version and the figure it judged | Nothing to refuse going forward; its rollback refuses once any history or saved evidence exists |
| 0513 | C12 | PL-147, PL-148 | Saved contributions, evidence inputs and frozen criteria are pinned to their candidate, attribute, criterion and level | Any saved row would break a pin |
| 0514 | C13 | PL-149 | A gate's concerned candidates sit at its level | An offending pair, or a candidate listed for a gate with no level |
| 0515 | C13 | PL-155 | Gate descriptions become catalog data | Nothing |
| 0516 | C13 | PL-157 | A rule's outcome per set, frozen with saved rankings (if D56 builds it) | Nothing |
| 0517 | C14 | PL-164 | The citizenships that clear each gate; each answer records the citizenships it assumed | Nothing |
| 0518 | C15 | PL-167 | Real finite checks on every numeric column the domain reads | Any stored non-finite number, named by table, column and id |
| 0519 | C15 | PL-168 | Payload completeness and share sums enforced by deferred triggers (if D60 says so) | An accepted figure without its payload, or a composition outside 100 ± 0.5 |
| 0520 | C15 | PL-169 | One share bound and one label threshold per criterion | A criterion with two; the migration will not choose |
| 0521 | C15 | PL-170 | A converted amount stores its rate's publisher | A converted amount whose publisher cannot be derived |
| 0522 | C15 | PL-171 | An outside opinion names its series (if D64 says so) | A row that cannot be given a series |

A soft delete for criteria sets would add one more in C03, if D9 chooses it.

### 4.3 What is deployed, and when

Each cluster is deployed when it closes, so a regression stays local to the cluster that caused it. The deploy is always the same four steps, in this order:
1. `make e2e`, which restores the newest backup into the `_e2e` copy, applies the new migrations to it, and runs the browser suite;
2. `make migrate`, which backs up the live database first;
3. `make docker-build` and `make docker-up`, straight after the migration, because a container built before a migration cannot work against it (gate writes and saves fail after 0512 and 0513, and the backend refuses to boot on a schema it does not know);
4. `docker compose restart schema-diagram`.

**At the end of phase 1** (0508 to 0510 applied): every screen tells the truth when a read is slow, fails or finds nothing, and when the server is down; no error shows a code, an id or database text; typed numbers are refused rather than rewritten; deleting a set asks first, and a new set can be ranked; runs count only what they were asked, and Acquire's panels describe the database; Rank draws scores on the scale they were computed on, in words, at every desktop width; a hand-entered score counts on its own scale; Compare's cards read the right way round.

**At the end of phase 2** (0511 to 0517 applied): held controls look held and locks are padlocks; Acquire follows a running acquisition, keeps a pending start and retries only what you select; source tiers survive a move; every Configure edit is in Recent changes with a true undo; saved rankings open in view with their evidence and can be deleted; gate answers can be recorded, corrected, aged and re-checked; citizenship drives the gates.

**At the end of phase 3** (0518 to 0522 applied): the database refuses impossible values; a non-euro amount converts with its rate's provenance; outside opinions show which edition is current; the contract and the server agree about null; `make e2e` and every rollback are safe with any password and any history; the trackers are closed, and the final convergence review has found nothing new at Medium or above.

## 5. The process for every cluster

This is the causal-change protocol you adopted on 2026-10-22, with the new definition of done added as step 5.

1. **A consequence map, read-only, before any code.** It names the rule each item protects, then lists the paths in, the paths out, and state and time (a database with data, rollback, kill -9, requests in flight, a second client, tool versions). The seven existing maps already cover the round-3 items; for the review's findings, the cluster's map is new. Every undesired or uncertain consequence is reported to you before code, together with any decision of section 6 still open for the cluster.
2. **Tests first, including browser tests, and mutation-checked.** Each test runs the real thing rather than matching text. It must fail before the fix; after the fix, a named mutation (undoing the fix, or the trap the map names) must make it fail again. Wherever a rule cuts across the code, a structural test guards it.
3. **One commit per item or per tight group**, with the plan id and the source ids in the message.
4. **`make check` on every commit**, and `make e2e` for interface, infrastructure and migration work. A claim of "green" names the command, the commit and the counts.
5. **A hands-on walkthrough in a real browser, on a copy of your data.** An agent drives the feature in headless Chromium at 1560 by 1000 px (and at 1440 and 1280 px where a cluster touches layout), on the `_e2e` copy restored from your newest backup, with every other host blocked and no AI key, so nothing can spend money. It ticks every item of the feature's design section, from a checklist written in the cluster's map, and saves a screenshot for each. **A feature is done only when every item is confirmed.** Anything that cannot be exercised safely is simulated in the browser and marked as such, as the review did.
6. **An independent review by a model other than Claude**, given the map and the diff and asked what the map missed. Its findings are fixed inside the cluster, under the same steps.
7. **The trackers carry the commit hashes:** this plan's master list, `docs/findings-review-comparison.md`, `docs/copilot-remediation-plan.md` section 7, `docs/known-issues.md` and `docs/copilot-cross-model-review.md`.

The next cluster starts only when the current one is merged, deployed and verified.

**Money.** Nothing in this plan spends money. Paid paths (gate research, re-checks) are tested with fakes, and `make live-llm` is never run without your explicit go-ahead. The ECB source, if chosen, is free; its live test runs only under `make live`.

**The stopping rule.** The round is done when:
- no Critical, High or Medium item is open;
- every Low and Nit item is fixed, or recorded in `docs/known-issues.md` with its reason, visibly;
- the identifier guard's ledger is empty;
- a final convergence review over every commit of the round finds nothing new at Medium or above.

A finding in that final review reopens only its own cluster.

### 5.1 Two lanes (decided 2026-10-24)

The work runs in two lanes at once. A cluster is split by layer, and each lane owns its files.

| Lane | Owns | Works in |
|---|---|---|
| **Backend** | `backend/`, `storage/`, `tools/`, the `Makefile`, `compose.yaml`, `docs/openapi.yaml`, `docs/openapi.implemented.yaml` | its own git worktree and branch |
| **UI** | `ui/`, including `ui/e2e/` and the regenerated `ui/src/api/schema.ts` | its own git worktree and branch |
| **Integrator (Copilot)** | `master`, every merge, the trackers, every other doc, the walkthroughs and the reviews | the main checkout |

**The rules:**
- **The contract comes first.** A cluster's contract change reaches `master` from the backend lane before the UI lane builds on it. The UI lane regenerates `schema.ts` only from a contract that is already on `master`.
- **Each lane checks its own half on every commit:**
  - the backend lane runs lint, boundaries, coverage and the audits;
  - the UI lane runs `ui-check`.
- **The integrator runs the whole gate after every merge:** `make check`, then `make e2e`. Only one `make e2e` runs at a time, because it has one copy and fixed ports.
- **A lane never edits a file it does not own.** A change it needs in the other lane is asked for through the integrator.
- **One tracker covers both lanes.** This plan's master list carries the commit for each item, so no item can fall between them, as FU-A1 to FU-A4 once did.
- **No overlap with the other agent,** which works only on the v2 planning documents (`docs/devplan-v2.md`, `docs/research/`).

## 6. Decisions

Seventy decisions, grouped by the cluster that needs them, with the recommendation first. **Nine are major**: they change architecture or scope, or depart from a recorded decision or from `reqs.md`. They are D2, D32, D37, D45, D46, D56, D59, D60 and D63. Each cluster needs its decisions before its consequence map is finished; D2 and D46 are needed before phase 1.

Where a finding offered "build it, or record the divergence", the plan builds it (D1). Where it offered two equivalent ways to build, the plan picks one and names it in the master list; those are not repeated here.

### 6.1 Across the round

**D1. Build to the specification where the review offered "or record the divergence"** (UF-014, UF-020, UF-048, UF-049, UF-050, UF-097, UF-122 and others; UF-013, UF-041 and UF-088 have decisions of their own, D47, D56 and D32).
- *Recommended:* build it. Your rule is that every built feature works, and the design is its specification.
- *Alternative:* record a divergence in the design brief wherever the review allowed it.
- *Why it cannot be defaulted:* it sets the round's scope, and the estimate assumes the recommendation.

**D2. Major. The unsaved-changes model** (UF-022; README, Stage 1 and Interactions; `reqs.md` Q168).
- *Recommended:* keep Q168. Edits write straight to the set, Recent changes undoes them, and Duplicate stays the way to experiment on a copy, as Q168 reasons. The divergence is recorded in the design brief (PL-180). If you want a one-click "Experiment on a copy" as well, it is a small addition to C03.
- *Alternative:* adopt the design's working copy: an "unsaved changes" pill, Save and Discard, and a guard on every route that would replace the working weights.
- *Why it cannot be defaulted:* the design asks for the alternative, while Q168 and `arch.md` decided the recommendation. Either way one recorded source is departed from, and the alternative is a second representation of every criteria set.

### 6.2 C01 The shell and truthful states

**D3. When the server comes back** (UF-002).
- *Recommended:* Try again on each card, plus one automatic re-read when the shell's run poll succeeds again.
- *Alternative:* Try again only.
- *Why:* an automatic re-read changes the screen without a click.

**D4. When an acquisition ends** (UF-005).
- *Recommended:* an open ranking, its open rows and a drawn comparison refresh by themselves, keeping what is open.
- *Alternative:* a line saying the figures changed, with a Refresh.
- *Why:* rows can move under the reader.

**D5. Where view state lives** (UF-006, UF-007).
- *Recommended:* a session store above the routes, with the set and level also in the address so that a reload keeps them.
- *Alternatives:* everything in the address (linkable, but every link changes); local storage (survives a restart, and must detect a set that has gone).
- *Why:* it decides what a reload and a shared link keep.

**D6. Times** (UF-010).
- *Recommended:* the browser's local time; dates without a time stay dates.
- *Alternative:* UTC, labelled.
- *Why:* every time on screen changes.

### 6.3 C02 Forms

**D7. What a number field accepts** (UF-026).
- *Recommended:* digits with at most one point for decimals. A comma, a space, a sign where none is allowed, or an exponent is refused with a message saying what to type.
- *Alternative:* accept a comma as a thousands separator in money fields ("72,000"), refusing it elsewhere.
- *Why:* the sidebar prints "€72,000.00", and "1,5" is a decimal in much of Europe. Any reading of a comma is a guess.

**D8. Drafts and refusals in forms** (UF-033, UF-054, NEW-55).
- *Recommended:* keep the explicit Save. A draft says "Not saved yet"; any edit clears "Saved."; leaving Configure with a draft asks first; typing in a field clears that field's refusal, as hand entry already does.
- *Alternative:* save each field as it changes, as the design does.
- *Why:* saving as you type moves Rank and the sidebar on every keystroke and replaces the save behaviour built for UI-06 and UI-10. The leave warning is new behaviour either way.

### 6.4 C03 Criteria-set management

**D9. Deleting a set** (UF-025).
- *Recommended:* an armed confirmation that names the set, what goes with it and whether it is in use, and offers "Duplicate first". Recent changes lists the deletion as one that cannot be undone.
- *Alternative:* a soft delete with a real undo: a migration, a restore operation, and every set read filtering deleted sets.
- *Why:* the design says a deleted set can be brought back. Only the alternative does that, at the cost of a schema and contract change.

**D10. What "Create set" makes** (UF-027).
- *Recommended:* the server seeds the set from the catalog: each attribute's default criterion, even pillar weights and the default rules.
- *Alternatives:* the interface duplicates a named default set and renames it (it fails once that set is gone); relabel "Create" and point to Duplicate.
- *Why:* it changes what the create operation means in the contract.

**D11. Unique set names** (UF-032).
- *Recommended:* unique, ignoring case, enforced by a constraint whose pre-check names any duplicates.
- *Alternative:* checked in the form only.
- *Why:* the constraint refuses at `make migrate` if your live sets already share a name, which has not been checked.

**D12. Where the shared held button and focus helper live** (NEW-56 and its siblings).
- *Recommended:* the shell folder, shared by Configure, Rank and Acquire.
- *Alternative:* each screen writes its own.
- *Why:* the move touches three Acquire files, and the UI map asked you.

### 6.5 C04 Runs: accounting, evidence and the diff

**D13. Borrows outside a retry's exact pairs** (FU-A1).
- *Recommended:* a retry refreshes only the borrows inside its pairs; the next sweep refreshes the rest.
- *Alternative:* a retry adds its dependent stand-in pairs to its items, which raises its total.
- *Why:* today's docstring promises the borrow is lent on in the same pass.

**D14. A retry with nothing it can ask** (FU-A2).
- *Recommended:* keep the 409 `nothing_to_fetch`, with a true message.
- *Alternative:* a new 409 `nothing_to_retry`.
- *Why:* a code is visible in the API and in the wording table.

**D15. Evidence the rehearsal finds outside its run's items** (ST-12).
- *Recommended:* record those pairs as items of their runs: an honest record of what each run wrote, which raises those runs' totals.
- *Alternatives:* constraints marked `NOT VALID`, which leave old rows unchecked; or restore a backup.
- *Why:* if such rows exist, the migration refuses and the backend cannot boot until you choose. How many exist is not checked yet.

**D16. A re-read that contradicts the stored figure** (NEW-23).
- *Recommended:* "the same observation" means the same payload and verdict, not the same quote, citations or confidence (which keeps NEW-33). A row removed from a transcribed table is reported as "no longer published", and its stored figure stands.
- *Alternatives:* compare everything (about fourteen re-quoted rows would fail every run); keep removed rows silently.
- *Why:* it decides what a run reports as a failure.

**D17. A run records its plan** (UF-085, UF-093).
- *Recommended:* at start, each source's planned items, the estimate's ceiling and the cap (0510).
- *Alternative:* derive what can be derived, and drop "not reached" per source.
- *Why:* a migration and a contract change on the run.

**D18. What the remedy cards are based on** (UF-078).
- *Recommended:* what is still outstanding: the latest outcome for each pair, across runs.
- *Alternative:* the newest full run.
- *Why:* it changes which gaps Acquire offers to fix.

### 6.6 C05 Rank

**D19. The scale travels with the scores** (UI-18).
- *Recommended:* Ranking, CandidateScoreDetail and Comparison carry the scale; the saved half follows D46.
- *Alternative:* each screen reads the settings.
- *Why:* a contract change, and a settings read can disagree with the scores it labels.

**D20. One source for freshness** (KT-A4).
- *Recommended:* the active-value view's flag, read through the value store. `make rank` uses the API's ranking assembly. The Python mirror reads the same flag instead of counting days.
- *Alternative:* keep the mirror on day counts, documented as approximate.
- *Why:* a new method on a port that every fake implements, and `make rank` is outside coverage.

**D21. The basis of "Weight" and "Weight used"** (UF-103).
- *Recommended:* both as shares of the whole level, so they differ only where weight was redistributed.
- *Alternative:* both as shares of their pillar.
- *Why:* every figure in one column changes.

### 6.7 C06 Hand entry

**D22. How hand entry takes labels** (NEW-59, UF-089).
- *Recommended:* one label per line, previewed as chips, so a label may contain a comma. Recorded in the design brief.
- *Alternatives:* the design's comma-separated field, with quotes around a label that contains a comma; or refuse commas.
- *Why:* the design specifies a comma-separated field, and an employer's name can contain a comma.

**D23. Hand entry while "Manual entry" is switched off** (UF-062).
- *Recommended:* refused, with the reason and a route to stage 5.
- *Alternative:* accepted, with a warning that the figure will not count until the source is switched back on.
- *Why:* it changes what the API accepts.

### 6.8 C07 Compare

**D24. One sign convention** (UF-124).
- *Recommended:* the cards follow the matrix, as the design draws them: comparator minus focus, with "Ahead on" describing the card's country. Raw mode keeps its labelled "focus minus comparator" (UI-19).
- *Alternatives:* also turn raw mode to comparator minus focus, which revisits UI-19; or keep the server's focus minus comparator and title each card from the focus ("Portugal against Malta").
- *Why:* the server's synthesis changes for API clients, and UI-19 was your decision.

**D25. Synthesis lines** (UF-133).
- *Recommended:* one line per pillar, tagged by the pillar's rank among the heaviest, as the matrix tags it.
- *Alternative:* keep attribute lines, tagged by their pillar's rank.
- *Why:* it changes what the cards list.

**D26. What Compare opens with** (UF-136).
- *Recommended:* the home country as focus (rank 1 if there is none), no comparators chosen, the first pillar open.
- *Alternative:* open empty and say what to choose.
- *Why:* a default focus can surprise.

### 6.9 C08 Weights, locks and held controls

**D27. One held look** (NEW-46, NEW-68).
- *Recommended:* 45% opacity and a not-allowed cursor for every held control, both locks included.
- *Alternative:* the criterion lock's 55% and default cursor, for both locks.
- *Why:* two looks exist today, and one must go.

**D28. When the held look shows** (NEW-46).
- *Recommended:* after a short delay, about 120 ms, so a quick save does not dim twenty controls.
- *Alternative:* at once.
- *Why:* the design never said; the design brief asked and got no answer.

**D29. A lint rule against native `disabled`** (the UI map).
- *Recommended:* yes, with a reasoned exception at each legitimate site.
- *Alternative:* no rule; rely on reviews.
- *Why:* it makes every native disable a reviewed decision, at about an M in size.

**D30. The padlock** (NEW-68).
- *Recommended:* drawn inside the bordered square; recorded in the design brief as a deliberate divergence; the carets and arrows stay as they are.
- *Alternatives:* a bare padlock; or replace the other glyphs too.
- *Why:* the design file draws a disc, and a later design sync could bring it back.

**D31. Criteria that are not scored** (UF-034, NEW-58).
- *Recommended:* "Not scored, matching only", the slider held, "Required" only where a criterion is scored and blocks (on Configure and Rank alike), and the "blocks scoring" box saying it takes effect once the criterion is scored.
- *Alternative:* show the share that would count, and keep the slider live.
- *Why:* the design has no control for exclusion (P90), so how an excluded row reads is a choice.

### 6.10 C09 Acquire

**D32. Major. Selective retry and scoped acquisition from the interface** (RN-R1, UF-096, UF-088).
- *Recommended:* the plan and retry operations take exact pairs. Retry estimates and asks exactly the selected items, and a picker estimates one candidate, attribute or pillar.
- *Alternative:* keep rectangles from the interface, and record that Retry asks every switched-on source about the rectangle, paid sources included.
- *Why:* a contract change that changes what Retry costs. `reqs.md` 6.4 says a retry asks only what failed, and the design's button reads "Retry 2 selected".

**D33. A start refused while Acquire is closed** (P94).
- *Recommended:* report it once when you come back, and show the newest run on the card.
- *Alternative:* drop it.
- *Why:* the report can arrive minutes later, out of context.

**D34. A run records its purpose** (UF-099).
- *Recommended:* yes (sweep, retry, ask again, scoped), in migration 0511.
- *Alternative:* derive it where possible and leave the rest unlabelled.
- *Why:* a migration for the history's wording.

**D35. The in-flight refusal names its run** (UF-080).
- *Recommended:* the run's id in the refusal's details, so the screen can link to it.
- *Alternative:* hold the controls only, with no link from the refusal.
- *Why:* a contract change.

### 6.11 C10 Source priority

**D36. How sources are reordered** (UF-044).
- *Recommended:* one batch operation, atomic, that keeps the gaps between tiers.
- *Alternative:* the interface renumbers only the rows a move crosses. No contract change, but a move and its undo can stop half way.
- *Why:* a new contract operation.

### 6.12 C11 The change history

**D37. Major. What Recent changes covers** (UF-030, NEW-67).
- *Recommended:* every Configure edit the design lists: pillar and criterion weights and locks, rules, gates and compound rules, set create, rename, duplicate and delete, the household, the settings and the sources. Where an undo cannot be exact, the entry says so.
- *Alternatives:* criteria-set edits only, with the rail saying so (the history map's recommendation); or pillar weights only.
- *Why:* the recommendation lets an undo reach global settings, where it can unset the score range and stop every ranking; a deletion cannot be reversed; and it roughly doubles the history work.

**D38. Undo after a move that emptied the other weights** (NEW-67).
- *Recommended:* the entry says, before you press it, that the others come back evenly shared, as criteria already do (UI-09).
- *Alternatives:* a whole-level weights operation (contract and backend); or a restore from the interface with temporary locks (not recommended).
- *Why:* an exact restore needs a new operation.

**D39. Entries from a deleted set** (H-S5).
- *Recommended:* dropped when the set goes, with a count.
- *Alternatives:* kept and marked as impossible to undo; or left as now, where they block every older undo.
- *Why:* it changes what "Back to where I started" reaches.

**D40. How long the history lives** (H-S1).
- *Recommended:* the browser session, above the routes, as its own "in this session" says.
- *Alternative:* each visit to Configure, with the panel saying "since you opened Configure".
- *Why:* the recommendation is larger, because undo must not depend on a mounted screen.

**D41. What waits for what** (NEW-67).
- *Recommended:* an undo waits for any recorded write, and every recorded write waits for an undo. Writers do not wait for each other.
- *Alternative:* one writer for the whole set, so every write holds every control.
- *Why:* the alternative dims every control on every release.

**D42. The entries' wording** (UF-038, H-S2, H-S4, P99-S1).
- *Recommended:* labels composed when drawn, from the original before, the latest after, formatted numbers and the set's current name, in the history map's words: "Pillar weight for Economy: 40.0% to 50.0%, in Default"; "Locked the Economy pillar, in Default"; "Enforced UK Skilled Worker, in Default"; and its two caveat sentences.
- *Alternative:* your own wording.
- *Why:* about twenty test strings change, and the words are yours to approve.

**D43. An undo that fails half way** (H-S3).
- *Recommended:* remove the entries that were undone; keep the failing one and everything older.
- *Alternative:* keep all of them listed.
- *Why:* today the panel then lists changes that are no longer in effect.

**D44. Stale set reads everywhere** (P99).
- *Recommended:* the complete fix, in the shared read path for every read that names a set, with a note ("Waiting for a change to this set to be answered…") while a write is outstanding.
- *Alternative:* the Configure editor only.
- *Why:* the complete fix makes Rank, the sidebar and Compare wait for a pending Configure write.

### 6.13 C12 Saved rankings and the evaluation tree

**D45. Major. How a saved refusal keeps its evidence** (FU-A3, FU-A4).
- *Recommended:* gate answers become immutable versions, referenced by key, and a refusal keeps the id of the figure it judged. Q218 ("one row per gate and candidate") is revised in a new Q237.
- *Alternative:* the approved plan's shapes: a jsonb copy of the answer on the refusal, and one pinned input table.
- *Why:* on 2026-10-22 you said both are finished "as the approved plan says", and the recommendation departs from that plan. The alternative leaves "a correction destroys the previous answer" open, which C13's answer form would make routine, and it blocks BE-36's re-check.

**D46. Major. Show saved evidence in the contract** (FU-A3, FU-A4, SV-N3, UF-104, UI-18).
- *Recommended:* yes. A refusal's gate answer and judged figure, a warning's inputs, each contribution's used value with its source and dates (already declared in the target contract), and the frozen scale. The saved view gains pillars, Δ home and a drill-down.
- *Alternative:* storage only, and the saved view keeps showing no evidence.
- *Why:* on 2026-10-14 you said "the rest stays out of the contract". The design, and the rule that every displayed number carries its provenance, ask for it.

**D47. Saved rankings can be deleted** (UF-013, UF-031).
- *Recommended:* yes, behind a confirmation.
- *Alternative:* no; a set used by a saved ranking then can never be deleted.
- *Why:* a new contract operation, and deleted evidence cannot come back.

**D48. The save control's failure path** (NEW-56).
- *Recommended:* on failure the note box stays open with focus on Save, and Cancel is held while a save runs.
- *Alternative:* close the box and move focus to "Save this ranking".
- *Why:* either is defensible, and the UI map asked you.

**D49. How far ST-13's pins reach** (ST-13, SV-N6).
- *Recommended:* every evidence input (contributions, warning inputs, non-match inputs and the new refusal columns), plus a key from each non-match input to its reason.
- *Alternative:* contributions only, recording the asymmetry.
- *Why:* more constraints, and more saved rows that make values impossible to delete.

**D50. ST-14's writer and the frozen rule lists** (ST-14, SV-N7).
- *Recommended:* the store freezes only the level's slice; the rule lists are pinned where their level is set, and the rest recorded in known issues.
- *Alternative:* the store refuses a whole-set argument.
- *Why:* refusing would reject a call that is legitimate today.

### 6.14 C13 Gates and research

**D51. The override date on a correction** (UI-29).
- *Recommended:* kept when the override reason does not change.
- *Alternative:* re-stamped on every write, as now.
- *Why:* it changes the write's behaviour and its contract text.

**D52. The gate-answers area** (UI-29).
- *Recommended:* keyed by level, outside the set's rules panel. It offers every candidate at the gate's level (the list of concerned candidates stays unexposed, Q236). "Withdraw" records "unknown" as a new version. A manual exclusion's "why" goes in the reason, and the override reason is used only for an override.
- *Alternatives:* inside the rules panel; offering only the candidates a gate concerns (a contract change); a delete operation.
- *Why:* each choice changes what the form lets you do, or the contract.

**D53. BE-36's scope this round.**
- *Recommended:* both stages: the recorded answers with their age now, and the explicit re-check once versions exist.
- *Alternative:* stage 1 only, leaving BE-36 partly open.
- *Why:* stage 2 adds a contract change and a paid path.

**D54. Where age and "period ended" are computed** (BE-36).
- *Recommended:* in the browser, as a presentation of dates the server sends.
- *Alternative:* fields computed by the server.
- *Why:* it touches the rule that every number on screen is the server's.

**D55. Gates with no level** (NEW-64).
- *Recommended:* such a gate lists no concerned candidates, enforced by a foreign key.
- *Alternative:* a trigger that lets it list candidates at any level.
- *Why:* the alternative would be the schema's first trigger.

**D56. Major. A rule as a gate or a warning, per set** (UF-041).
- *Recommended:* build the select. Each set may hold a rule as a gate or as a warning, stored with the set's rule (only for rules that are on, as the sparse model requires), read by evaluation and frozen with saved rankings. `reqs.md` 3.7 and 3.7a are amended.
- *Alternative:* record the divergence, and stop drawing the fixed text like a control.
- *Why:* it departs from `reqs.md` 3.7a, where a rule's outcome is catalog data, and it changes evaluation.

**D57. Gate descriptions** (UF-039).
- *Recommended:* catalog data, seeded from `reqs.md` 7.3's "Matches when" column.
- *Alternative:* text written in the interface.
- *Why:* a migration, against "nothing hardcoded".

### 6.15 C14 The household

**D58. Monthly income, and the stored figure** (UF-028).
- *Recommended:* monthly, as the requirements, the domain model and the design say. You check and re-enter the stored figure before the change is deployed.
- *Alternative:* a migration that divides the stored figure by 12.
- *Why:* only you know whether the stored figure is a yearly one.

**D59. Major. Citizenship drives the gates** (UF-029, G-S6).
- *Recommended:* catalog rows name the citizenships that clear each gate; evaluation reads the household's citizenships; EU free movement is derived from an EU citizenship; each answer records the citizenships it assumed, and is flagged for a re-check when they change.
- *Alternative:* make stage 2's lead true: gates read only recorded answers, and EU free movement is answered by hand.
- *Why:* `reqs.md` 7.3 and the design (UX-REVIEW R5) ask for the recommendation. It adds a catalog table, makes evaluation read the household, and extends the answer versions.

### 6.16 C15 Data integrity in SQL, and the contract

**D60. Major. The schema's first triggers** (ST-15).
- *Recommended:* deferred constraint triggers for payload completeness and share sums, accepted or rejected, deletes included; `arch.md` 3.3b and 10.7 amended; the sibling rules (blank labels, the euro identity, the conversion tolerance) added as plain checks.
- *Alternative:* leave completeness to the domain, and record it.
- *Why:* `arch.md` says the schema needs no triggers, and triggers bring new failure modes (hand-written SQL, data-only restores).

**D61. How far the finite checks reach** (ST-16).
- *Recommended:* every numeric column the domain reads (an L).
- *Alternative:* the payload tables only (an S), recording the rest.
- *Why:* size.

**D62. The label-threshold table** (ST-17).
- *Recommended:* included; the contract's `labels` stays a one-entry array.
- *Alternative:* narrow the contract to a single label.
- *Why:* a contract question.

**D63. Major. An ECB exchange-rate source** (ST-18).
- *Recommended:* build it. A free ECB reference-rate source writes published rates; each converted amount stores its rate's publisher and is served with rate, date and publisher; Rank shows the rate's provenance; hand entry accepts the contract's nested shape; an unpublished rate is refused with a sentence.
- *Alternative:* provenance only. A non-euro amount is refused with a sentence, and the gap is recorded.
- *Why:* a new data source and network dependency, for a conversion no current attribute uses yet.

**D64. Which index an outside opinion belongs to** (ST-10).
- *Recommended:* a series column. "Current" means the latest by period end, then period start, then retrieval, then id; re-reads of one edition collapse; a switched-off publisher's edition is not shown as current.
- *Alternatives:* the publisher alone (its second index then reads as history of the first); a proxy on the published scale.
- *Why:* a migration, a contract change, and a design question about identity.

**D65. Null in the contract** (NEW-61, NEW-62, IN-D1, IN-D2).
- *Recommended:* a request field the design types without null refuses it, and a response leaves an absent field out. The design admits null for `score_delta` ("no comparable score") and for `CompoundRule.level`, and documents "null removes it" for `reducer_mode`.
- *Alternative:* admit null in the design wherever it is sent today.
- *Why:* either way the contract changes.

### 6.17 C16 Tooling and rollbacks

**D66. How `make e2e` builds its URL** (P100).
- *Recommended:* the script replaces itself with npm, and the two names that no longer exist leave the e2e guard.
- *Alternative:* the script prints the URL and the shell captures it.
- *Why:* the alternative can leak the password through a malformed URL.

**D67. A `#` in the database name** (P96).
- *Recommended:* keep it accepted, and add a test that proves the copy's name stays safe.
- *Alternative:* refuse it through the e2e script.
- *Why:* the refusal stops a name that works today.

**D68. Check your live locks** (P97).
- *Recommended:* yes, read-only, against the dumps taken before each migration.
- *Alternative:* skip it.
- *Why:* it reads your backups.

**D69. How far P95's refusals reach** (P95).
- *Recommended:* the runner explains every integrity error, and the four recorded rollbacks get refusals of their own; 0444 carries its anchors and thresholds across, as RE-3 does; 0493 refuses while another set enforces its gate.
- *Alternatives:* the runner only; or refusals in all seventeen rollbacks, after which deep rollbacks refuse on any used database.
- *Why:* editing an applied rollback changes what your live database's next rollback does.

**D70. Rollbacks that delete history or overwrite weights** (TL-N2, SV-N1, TL-N5, TL-N6).
- *Recommended:* each refuses, locking first, as 0503, 0506 and 0507 do. A rollback that would overwrite weights you changed refuses and names the sets, and every rollback addresses every set.
- *Alternative:* record them in known issues.
- *Why:* the same as D69, for up to fifteen more files.

## 7. The sections the planning rule requires

### 7.1 What I'm going to do

Fix all 182 open items in built functionality, one feature cluster at a time, until each feature matches its specification, under the causal-change protocol and the new definition of done.

### 7.2 Files changed or added

The exact files are listed in each cluster in section 3. In summary:
- **Interface (`ui/src/`):** the shared read, error and name layer in `api/` and `shell/` (C01); one numeric field and parser (C02); every screen folder: `routes/configure/` (C02, C03, C08, C10, C11, C13, C14), `routes/run/` (C04, C06, C09), `routes/rank/` (C05, C06, C12, C13) and `routes/compare/` (C07); `format/`; `styles.css`; the guards in `testing/` and `app/architecture.test.ts`; the mocks; the browser specs, plus a new failure-sweep spec.
- **Backend (`backend/src/starnest/`):** `api/`, `evaluation/`, `data/`, `data_acquisition/`, `storage/`, `comparison/`, `household/`, `criteria/`, `data_sources/` (a new ECB source if D63 says so), `main.py`, and `backend/scripts/rank.py`.
- **SQL (`storage/`):** the queries for runs, values, evaluations, criteria and the catalog; new migrations 0508 to 0522, each with a rollback; edits to the applied migrations 0442, 0445 and 0488 and to eighteen applied rollbacks (C16).
- **Contract:** `docs/openapi.yaml` first, in thirteen of the seventeen clusters, then the regenerated `docs/openapi.implemented.yaml` and `ui/src/api/schema.ts`.
- **Tooling:** `Makefile`, a new `tools/e2e_copy.py`, `tools/migrate.py` and `compose.yaml` (C16); the interface container's start script (C01).
- **Docs:** `docs/reqs.md` (Q237 onwards, and the sections each cluster names), `docs/arch.md` (3.3b, 6.1, the run text, 10.7), `docs/datasources.md` (the ECB source), `docs/design-brief.md` (divergences), `docs/known-issues.md`, my trackers, and this plan, whose master list carries the commit for each item.

### 7.3 Files left unchanged

- **The other agent's files:** `docs/devplan-v2.md`, `docs/research/`, `docs/findings-remediation.md` and the `docs/kt-handoff-*.md` files.
- **CLAUDE.md.** Its narrative belongs to the other agent; the facts this round changes are relayed (section 8).
- **The design handoff in `docs/design/`.** It is the specification, and it is yours and untracked. Departures from it are recorded in `docs/design-brief.md`, which is the code's return channel to the design.
- **`docs/ui-functional-review.md`.** It is the record of the review; each finding's status is tracked in this plan's master list.
- **Anything at the city level.** That is v2.
- **The live database**, except through `make migrate`. The walkthroughs and the browser suite touch only the `_e2e` copy.
- **Paid paths.** Nothing runs them, and `make live-llm` is not run.

### 7.4 Behaviour changes

- **Every screen:** slow, failed and empty reads are shown as such, never as zeros or "not set"; errors are worded, without codes or ids; a stopped server shows one card and recovers; state survives tab changes and reloads; times are local; titles are the page's h1.
- **Configure:** typed numbers are refused rather than rewritten; drafts say whether they are saved; deleting a set asks first; a new set can be ranked; held controls look held, and locks are padlocks; unscored criteria are marked; source moves keep their tiers; Recent changes records every edit in the decided scope, with single undo and a preview; a "Gate answers" area records, corrects, ages and re-checks answers; rules say what they test and whom they flag, and can be gates or warnings per set (D56); income is monthly, and citizenship drives the gates (D59).
- **Acquire:** runs count only what they were asked; "What the database holds" describes the database and includes research spend; the diff counts re-confirmed figures as unchanged; the card follows a running acquisition and draws stopping; a pending start survives leaving the screen; Retry asks only what you select (D32); hand-entered scores count on their own scale.
- **Rank:** scores on the scale they were computed on; one weight basis; reasons in words; aged figures marked; a saved ranking opens in view with its evidence, and can be deleted.
- **Compare:** cards agree with the matrix; the limit blocks rather than drops; gaps are precise; the comparison redraws as you choose.
- **API:** new fields and operations, new refusal codes and details, changed meanings (Create set, the synthesis's sign, retry with pairs), null handled as the design says. All of it is written into the contract first.
- **Data:** the database refuses non-finite numbers, incomplete payloads and compositions that do not sum to 100 (D60); non-euro amounts convert with their rate's provenance (D63); a corrected table under an old date is reported, not silently ignored.

**Side effects on other features:** C01's union type touches every screen at once. C05's scale reaches Compare and saved rankings. C11's holds dim more controls during an undo. C14 moves the live ranking when citizenship changes. C12's migrations need the containers rebuilt in the same step. Values cited by saved rankings can no longer be deleted.

### 7.5 Risks and consequences

- **Size.** About 706 agent-hours, about 14 working weeks; about 9 if the faster pace holds. Reviews will find regressions inside clusters; the 20% allowance is for those.
- **Fifteen migrations on your live database.** Each pre-check refuses with a named reason rather than changing anything; each is rehearsed on a copy of your newest backup; `make migrate` backs up first; migrate and rebuild together, because an old container cannot work on a migrated database.
- **Contract changes in thirteen clusters.** The generated client, the mocks and the conformance tests follow each one. You are the only API client.
- **Departures from recorded decisions or from `reqs.md`:** the nine major decisions.
- **Live data that may refuse a migration or change a result:** duplicate set names (D11), run evidence outside its items (D15), the meaning of the stored income (D58), the ranking moving with citizenship (D59) and with a gate softened to a warning (D56).
- **Coordination.** `docs/reqs.md` and `docs/arch.md` are shared with the other agent's v2 work (section 8).
- **No money is spent**, by design and by test.

### 7.6 Alternatives considered

- **Severity first across all findings, not by feature.** Rejected: each file would be opened many times, and a feature would be half fixed for weeks.
- **Critical and High now, the rest later.** Rejected: your rule is that every built feature works.
- **Splitting the work between the two agents again.** Rejected: that is how FU-A1 to FU-A4 were lost.
- **One large branch merged at the end.** Rejected: a cluster at a time keeps each regression local.
- **Fixing states, errors and names inside each feature, without shared mechanisms.** Rejected: the review's five patterns would come back; the shared mechanisms and their guards make the rules enforceable.
- **Recording divergences instead of building what the design specifies.** D1's alternative.

### 7.7 How to verify

- **Per commit:** the new tests fail before the fix and pass after it; the named mutation makes them fail again; `make check` passes, and `make e2e` for interface, infrastructure and migrations, with the counts reported.
- **Per migration:** its pre-check replayed in a test; its rollback's refusal tested, including a race; the rehearsal on a copy of your newest backup.
- **Per cluster:** the walkthrough checklist fully ticked, with screenshots; the independent review with nothing unresolved at Medium or above; the containers rebuilt and smoke-checked; read-only API checks on the live data.
- **End of round:** every structural guard green; the identifier guard's ledger empty; each master-list item carries a commit, or a reason in `docs/known-issues.md` if it is a Low or a Nit; the final convergence review finds nothing new at Medium or above; the counts reported.

## 8. Coordination with the other agent

The other agent works only on v2 planning documents: `docs/devplan-v2.md` and `docs/research/`, and its own hand-off files. I never edit them. Its uncommitted work in the working tree (the modified `docs/devplan-v2.md`, the untracked `docs/research/` and `docs/kt-handoff-to-reviewer-2026-10-22.md`), and your untracked design handoff in `docs/design/`, are never staged by me: I stage files by path, never with `git add -A`.

**Files we could both touch:**

| File | What I change | What the other agent might change | How we avoid a clash |
|---|---|---|---|
| `docs/reqs.md` | New decision rows from Q237; sections 3.5a, 3.6, 3.7, 3.7a, 3.8 and 7.3 | City-level requirements and their decision rows | I reserve Q237 to Q259 for this round and tell the other agent; we edit different sections; I pull before every docs commit |
| `docs/arch.md` | 3.3b (triggers, if D60), 6.1 (if evaluation must name the household), the run text, 10.7 | The post-MVP revision | I relay each change before I make it; the later commit rebases |
| `docs/datasources.md` | The ECB source (D63) | City-level sources from its research | Different sections |
| `docs/known-issues.md` | Closing P10 and P93 to P100; new entries | v2 issues, if any | Append only |
| `docs/openapi.yaml` | Contract-first changes in thirteen clusters | A v2 contract draft, if it plans one | v2 drafts live in its own documents until v2 is built |
| `docs/todos.md`, `docs/devplan.md` | Status lines only, if at all | Possibly | Pull before each commit |
| `CLAUDE.md` | Nothing | Its narrative | I relay the facts below |

**What the v2 plan depends on.** The v2 draft's first workstream, "W0 — Prerequisite: v1 works", names FU-A1 to FU-A4 and FU-A6; they are PL-042, PL-043, PL-061 and PL-143 here. Three choices in this round shape v2 work, so the other agent should see them before it revises `arch.md`:
- D59 makes evaluation read the household for the first time. v2's derived attributes (the household-salary tax rate, Q84, Q204 and Q205) take the same route.
- D56 adds a per-set outcome to rules. v2.1's `relocation_window` rule would inherit it.
- D46 decides how a frozen record exposes its evidence. v2.1's saved comparisons, "frozen at the values held when saved", would follow the same pattern.

**Facts to relay for CLAUDE.md** (the other agent writes them; I do not):
- An exported `DATABASE_URL` is ignored by `make`, not refused (TL-N3).
- The e2e copy's URL is built by `tools/e2e_copy.py`, which reads `.env` as compose does (C16).
- A run's scope is its exact pairs, and every count is over them (C04).
- Gate answers are immutable versions; Q218 is revised in Q237 (C12).
- Migrations run to 0522; the schema has triggers if D60 says so (C15).
- Recent changes covers every Configure edit in the decided scope (C11).
- The interface's shared states, errors, names and parser, and the guards that enforce them (C01, C02).
- The narrow-desktop layout is built (C05); citizenship drives the gates (C14); the ECB source exists (C15).
- The new test counts, after each cluster.

## 9. Completeness check

Every id from the three sources appears in the master list, merged or excluded with a reason. A script built the table and the CSV from one data file and checked the coverage; it is in the session folder's `plan-work/`.

| Source | In the master list | Excluded |
|---|---:|---:|
| UI review findings, UF-001 to UF-144 | 144 of 144 | 0 |
| Round-3 items (FU-A1 to FU-A4, FU-A6, UI-18, UI-24, UI-29, BE-36, ST-10 to ST-18, KT-A4, NEW-23, NEW-46, NEW-55, NEW-56, NEW-58, NEW-59, NEW-61, NEW-62, NEW-64, NEW-65, NEW-66, P93 to P100, NEW-67, NEW-68). The earlier draft's scope table said 38; its clusters list these 40 | 40 of 40 | 0 |
| Mapping finds: UI map 14, gates 9, saved rankings 10, runs 4, integrity 5, tooling 6, history 10 | 58 of 58 | 0 |
| The tracker's open items: 13 NOT_FIXED (UI-18, UI-24, UI-29, BE-36, ST-10 to ST-18) and 2 PARTIAL (BE-11, now FU-A1 and FU-A2; ST-07, now FU-A3 and FU-A4) | 15 of 15 | 0 |
| Other tracker ids named with their items: P10, BE-35 | 2 of 2 | 0 |
| Excluded on purpose: NEW-21 (a design choice), NEW-25 (the city level) | 0 | 2 |

**242 sources (144 + 40 + 58) became 182 plan items.** By cluster:

| Cluster | Items | Critical | High | Medium | Low | Nit | S | M | L | Item hours |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| C01 The shell and truthful states | 23 | 1 | 1 | 13 | 8 | 0 | 9 | 12 | 2 | 61 |
| C02 Forms: what is typed, refused and saved | 9 | 1 | 0 | 4 | 3 | 1 | 4 | 4 | 1 | 24 |
| C03 Criteria-set management | 9 | 1 | 1 | 2 | 4 | 1 | 5 | 4 | 0 | 17 |
| C04 Runs: accounting, evidence and the diff | 20 | 2 | 2 | 7 | 9 | 0 | 8 | 11 | 1 | 49 |
| C05 Rank: the table, the drill-down and the score scale | 21 | 1 | 1 | 6 | 10 | 3 | 13 | 8 | 0 | 37 |
| C06 Hand entry | 8 | 1 | 0 | 1 | 5 | 1 | 5 | 3 | 0 | 14 |
| C07 Compare | 18 | 1 | 2 | 7 | 7 | 1 | 12 | 6 | 0 | 30 |
| C08 Weights, locks and held controls | 7 | 0 | 0 | 2 | 3 | 2 | 5 | 2 | 0 | 11 |
| C09 Acquire: starting, following, stopping and retrying | 18 | 0 | 1 | 9 | 5 | 3 | 12 | 5 | 1 | 35 |
| C10 Source priority | 4 | 0 | 0 | 3 | 1 | 0 | 1 | 3 | 0 | 10 |
| C11 The change history | 5 | 0 | 1 | 4 | 0 | 0 | 1 | 2 | 2 | 23 |
| C12 Saved rankings and the evaluation tree | 6 | 0 | 1 | 3 | 2 | 0 | 1 | 3 | 2 | 26 |
| C13 Gates and research | 14 | 0 | 1 | 5 | 6 | 2 | 8 | 3 | 3 | 41 |
| C14 The household | 4 | 0 | 2 | 0 | 2 | 0 | 3 | 0 | 1 | 11 |
| C15 Data integrity in SQL, and the contract | 6 | 0 | 0 | 0 | 6 | 0 | 1 | 3 | 2 | 26 |
| C16 Tooling and rollbacks | 7 | 0 | 0 | 1 | 6 | 0 | 2 | 5 | 0 | 17 |
| C17 Docs, dead code and trackers | 3 | 0 | 0 | 0 | 3 | 0 | 2 | 1 | 0 | 5 |
| **Total** | **182** | **8** | **13** | **67** | **80** | **14** | **92** | **75** | **15** | **437** |

Item hours use S = 1, M = 3 and L = 8. The total in section 1 adds the protocol's 136 hours, 15 hours of migration rehearsal and a 20% allowance.
