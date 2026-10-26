# Knowledge transfer → the building agent (2026-10-26)

From Copilot, which ran the review and remediation programme, to the agent that builds v2.0.
**Everything below is on `origin/master`**: the code at `ef8c3ea`, this handoff in the commit
after it. Pull before you start. Section 0 is the whole of it in five points, section 5 is what
you need before any v2 work, and the appendices list every fix with the commits that made it.

## 0. Read this first

1. **v1 is finished and its review programme is closed.** Round 3 merged 242 source findings
   into 182 plan items and landed all of them by 25 Oct (330 commits, `7a5d8e6..1077465`). The
   seven found after it, P101-P107, closed by 26 Oct. **4,825 backend, 3,467 interface and 47
   browser tests**; the contract's 50 operations are all served. The gate is unchanged:
   `make check`, plus `make e2e` for interface, infrastructure and migration work.
2. **v2.0 is designed and planned, not started, and not yet approved.** `docs/arch.md` section
   12 is new, `docs/devplan-v2.md` was rewritten from your draft into a phased plan, and the
   decisions are `reqs.md` Q241-Q252. **Write no city code until Alex approves the plan.** Its
   first phase, P0, writes no feature code either: the contract additions, the diagrams, and the
   four gates as failing tests.
3. **Your draft took one thing as built that is not**: `parent_not_matching` was specified and
   never built -- `evaluation/ranking.py` says so, and the evaluation store writes `False`.
   Reading the code against the city level found three more leaks: a criterion's level and
   identity come from its attribute, everything after scoring reads only the candidate's own
   stored value, and nomination has no state (arch 12.1). Each now has a design (section 4.3).
4. **v1's rules moved under you in round 3** (section 3). The ones most likely to bite: a gate
   answer is never overwritten, only versioned; a set holds each rule as a gate *or a warning*;
   a deleted criteria set keeps its id; a run is scoped to exact pairs and records its plan;
   weights are kept to ten decimal places; and every Configure write *and every Undo* reads back
   what it did.
5. **How Alex works** (section 7): a plan he approves before code; questions as a short
   questionnaire with a recommended default; one review per slice, a critical finding capped at
   two rounds; no bug filed as dormant; the design followed 1:1 unless a divergence is agreed and
   recorded. **Never run a destructive git command in the main checkout** -- his uncommitted
   work lives there.

## 1. Where things stand

| | |
|---|---|
| Code | `master` = `origin/master`. Round 3 closed at `1077465`; P101-P107, the Compare cells and the v2 documents follow it, up to `ef8c3ea` (Appendix B) |
| Live app | Docker: database, backend, the interface on `127.0.0.1:5173`, the schema diagram on `127.0.0.1:4174`. Backend image built at `8680e7a` -- nothing in `backend/` changed since -- and the interface image at `ef8c3ea` |
| Database | Live at migration `0526`. **The next free number is `0527`** |
| Tests | 4,825 backend (last full run 25 Oct, after P107), 3,467 interface, 47 browser. The coverage floors and per-package audits are unchanged |
| Contract | 50 operations in `docs/openapi.yaml`, all served; `openapi.implemented.yaml` matches |
| Branches | `master`, and `integrate`: Copilot's integration worktree at `../starnest-lanes/integrate`, level with master. Remove it with `git worktree remove ../starnest-lanes/integrate` if it is in your way. The 30 lane branches and 25 lane and review worktrees were deleted on 25 Oct, each checked to have every commit on master |
| Local only | `docs/design/` is a snapshot of the design handoff, taken 23 Oct, and **gitignored**: the repository is public and the handoff carries the household's figures. Read it locally; the live `.dc.html` still wins. `report.20261024.*.json` at the root is a Node crash report, Alex's to delete |

- **Docker Desktop does not start at login.** The machine rebooted on 26 Oct and the stack was
  down until `open -a Docker`; the containers restart by themselves.
- **`make e2e` runs from the main checkout**: it needs Docker and the newest backup in
  `backups/`, and a worktree has neither.
- **After a UI container rebuild a browser can keep the old bundle** until a hard reload. Say so
  when you hand Alex something to look at; it cost one round of "this is not fixed".

## 2. What happened since your handoff of 22 Oct

### 2.1 The programme in one table

| Stage | When | What | Record |
|---|---|---|---|
| Round 1 | 12-13 Oct | Implementation review, 91 findings (14 High, 48 Medium, 29 Low), each verified by GPT-6 Astra and Claude Opus 5, with a third adjudication of BE-11 and BE-13 | `copilot-review.md`, the two `*-findings-review.md`, `findings-review-comparison.md`, `claude-opus-5-third-review.md` |
| Remediation | 13-22 Oct | Two lanes: yours (`findings-remediation.md`) and Copilot's (`copilot-remediation-plan.md` and its folder). A cross-model review of Copilot's 109 commits (GPT-6 Astra, Grok 4.7) found 22 problems | `copilot-cross-model-review.md`; your handoffs of 21 and 22 Oct |
| Round 3 | 23-25 Oct | A functional review of the interface against the design (UF-001 to UF-144, 151 browser checks), the open round-3 items and seven consequence maps: 242 sources merged into **182 plan items** in 17 clusters, with 70 decisions. **All landed** | `ui-functional-review.md`, `copilot-round3-plan.md` |
| After round 3 | 25-26 Oct | P101-P106 (the last review of PL-033, and a mock note), P107 (found in use), the Compare cells to the design, the v2 architecture and plan | `known-issues.md`, `design-brief.md`, Appendix B |

**Round 3's definition of done** is the bar v2's slices inherit: tests written first and
mutation-checked; `make check` on every commit and `make e2e` for interface, infrastructure and
migration work; a walkthrough in a real browser on a copy of the data; and a review by a model
other than the one that wrote it, with nothing left at Medium or above.

### 2.2 Round 3 by cluster

| Cluster | Items | Critical | High | Medium | Low | Nit | The Critical and High items |
|---|---:|---:|---:|---:|---:|---:|---|
| **C01** The shell and truthful states | 23 | 1 | 1 | 13 | 8 | 0 | PL-001, PL-002 |
| **C02** Forms: what is typed, refused and saved | 9 | 1 | 0 | 4 | 3 | 1 | PL-024 |
| **C03** Criteria-set management | 9 | 1 | 1 | 2 | 4 | 1 | PL-033, PL-034 |
| **C04** Runs: accounting, evidence and the diff | 20 | 2 | 2 | 7 | 9 | 0 | PL-049, PL-050, PL-051, PL-052 |
| **C05** Rank: the table, the drill-down and the score scale | 21 | 1 | 1 | 6 | 10 | 3 | PL-062, PL-063 |
| **C06** Hand entry | 8 | 1 | 0 | 1 | 5 | 1 | PL-083 |
| **C07** Compare | 18 | 1 | 2 | 7 | 7 | 1 | PL-091, PL-092, PL-093 |
| **C08** Weights, locks and held controls | 7 | 0 | 0 | 2 | 3 | 2 | -- |
| **C09** Acquire: starting, following, stopping and retrying | 18 | 0 | 1 | 9 | 5 | 3 | PL-116 |
| **C10** Source priority | 4 | 0 | 0 | 3 | 1 | 0 | -- |
| **C11** The change history | 5 | 0 | 1 | 4 | 0 | 0 | PL-138 |
| **C12** Saved rankings and the evaluation tree | 6 | 0 | 1 | 3 | 2 | 0 | PL-144 |
| **C13** Gates and research | 14 | 0 | 1 | 5 | 6 | 2 | PL-152 |
| **C14** The household | 4 | 0 | 2 | 0 | 2 | 0 | PL-163, PL-164 |
| **C15** Data integrity in SQL, and the contract | 6 | 0 | 0 | 0 | 6 | 0 | -- |
| **C16** Tooling and rollbacks | 7 | 0 | 0 | 1 | 6 | 0 | -- |
| **C17** Docs, dead code and trackers | 3 | 0 | 0 | 0 | 3 | 0 | -- |
| **Total** | **182** | **8** | **13** | **67** | **80** | **14** | |

Every item, with the commits that cite it, is in Appendix A; `copilot-round3-plan.md` has each
item's fix direction and the 70 decisions with their reasons.

## 3. What changed under you -- read before touching these

### 3.1 Storage

Migrations `0498`-`0526` landed after your last handoff; each one's header says why.

| Migration | What it does |
|---|---|
| `0498` | At most one acquisition run is `running` at once (reqs.md 10, ST-01). |
| `0499` | Repair any criteria set 0487 left with an unbalanced `career` pillar (ST-03). |
| `0500` | Freeze three more parts of a criterion in the evaluation snapshot (ST-07, ST-08). |
| `0501` | Record the figures a run re-confirmed but did not need to store again (ST-09). |
| `0502` | Research asks only the gates it can answer, about only the candidates they concern (NEW-01). |
| `0503` | Every billed gate-research call is on record, written as it happens (BE-34, revisiting Q224). |
| `0504` | Freeze the value rows behind each saved warning, so its source/date chain can be reopened (ST-07). |
| `0505` | A saved warning's input figures die with the warning (ST-07, repairing 0504). |
| `0506` | A run records the exact (candidate, attribute) pairs it asked about (BE-11). |
| `0507` | Freeze the rest of what a ranking was computed with (ST-07). |
| `0508` | A criteria set is deleted in place, its name is its own among live sets, and one set is the default (PL-033, PL-035, PL-036, PL-034; decisions P1-27 to P1-29 and P1-35). |
| `0509` | The comparator limit is a whole number from 1 to 20, here as well as in the API (PL-030). |
| `0510` | A gate answer is kept once written, and a saved refusal pins the evidence it read (PL-143: FU-A3, FU-A4; reqs.md Q237, revising Q218). |
| `0511` | A re-confirmation names the stored figure it restated (PL-049: UF-073; C04-N5). |
| `0512` | A run records its plan once: what each source will be asked, what it may cost and the cap it is held to (PL-055, PL-056; PL-050's markers; D17, C04-N6). |
| `0513` | A run's evidence is pinned to its items, its items to its scope, and its scope to its level (PL-048: ST-12, SV-N10). |
| `0514` | A gate concerns only candidates at its own level (PL-149, NEW-64). |
| `0515` | Every gate says what it tests, in words: when a candidate matches it (PL-155, UF-039, D57). |
| `0516` | A set holds each rule it turns on as a gate or as a warning (PL-157, UF-041, D56). |
| `0517` | A citizenship clears the gates it names, and EU free movement is derived from one (PL-164, UF-029, G-S6, D59). |
| `0518` | Every number the domain reads is finite, in the database as well as in Python (PL-167: ST-16, IN-NAN; decision D61). |
| `0519` | An accepted figure carries its payload, and a share composition sums to 100 (PL-168: ST-15; decision D60). |
| `0520` | A criterion carries one share bound and one label threshold at most (PL-169: ST-17, IN-LABEL; decision D62). |
| `0521` | A converted amount names who published its rate (PL-170: ST-18, P10, BE-35; decision D63). |
| `0522` | An outside opinion names which of its publisher's indices it is an edition of (PL-171: ST-10; decision D64). |
| `0523` | A saved ranking cites only its own candidate's evidence, and sits at its own level (PL-147: ST-13, SV-N6; PL-148: ST-14, SV-N7). |
| `0524` | A run records what it was for: a sweep, a retry, an ask-again or a scoped run (PL-127, D34). |
| `0525` | A day without a reference rate remembers which day's rate the ECB answered it with (PL-170). |
| `0526` | A clearing citizenship may name the candidates it clears a gate in, and a British one clears free movement in Ireland (PL-164 review, Medium). |

The rules they leave behind:

- **A frozen child of `evaluation` or `candidate_result` cascades with its parent** (`0482`, and
  your note of 22 Oct), or the boot sweep fails and the backend refuses to start. **A foreign key
  into `value` never cascades.** Both hold for the evidence rows v2's evaluated figure adds.
- **`0523` is the constraint v2 revises first.** A frozen criterion must judge an attribute at
  its evaluation's level (`evaluation_criterion_judges_an_attribute_at_that_level`), and a frozen
  score must cite a value of its own candidate (`candidate_attribute_score_cites_its_own_measurement`).
  A national figure read through the parent breaks both. P2a replaces them (arch 12.7).
- **Gate answers are append-only** (`0510`, Q237). Recording adds a version; nothing updates or
  deletes one; a saved refusal pins the answer and the figure it read.
- **A set's rule rows are sparse and carry an outcome** (`0516`, Q238). A row exists only for a
  rule the set turns on, with `outcome` `not_matching` or `warning`. A migration that turns a
  rule on **upserts** the row with its outcome; off is the absence of a row.
- **A deleted criteria set keeps its id** (`0508`). An explicit id a deleted set holds answers
  409 `criteria_set_exists`; `POST /criteria-sets/{id}/restore` brings it back. A name is unique
  among live sets only.
- **One run at a time** (`0498`). A run records its exact pairs (`0506`), its plan (`0512`), its
  evidence pinned to its items (`0513`) and its purpose (`0524`).
- **Every number the domain reads is finite** (`0518`); an accepted figure carries its payload
  (`0519`); a converted amount names the ECB rate it used (`0521`, `0525`).
- **Every new table is classified** objective or subjective in
  `tests/storage/test_schema_contract.py`, which fails on an unclassified one.
  `test_migration_hygiene.py` holds every migration to a `depends:` line, a rollback and an
  existing predecessor, and refuses a shape its lock checks cannot read (P98).

### 3.2 Backend

- **Weights are kept to ten decimal places** (P107, Q240). `criteria/rebalancing.py` quantizes
  every share to `WEIGHT_PLACES` (1e-10) and places the residue at `EXACT` precision; the set
  sums exactly (`_exact_sum`) and accepts a total within `SUM_TOLERANCE` (1e-20) of 100.
  Python's 28-digit context had made a sum depend on its order: a drag stored
  `100.000000000000000000000000004`, and the set then refused every read. **Any new weight
  arithmetic, city pillar weights included, goes through these.**
- **A run is scoped to exact pairs** (`RunScope.pairs`) and asks each source only about what it
  declares (`answerable_by`, Q235); a retry asks only the sources that failed about only what they
  failed on. `RunDetail.by_source` is derived from the value and failure rows, never stored.
- **A gate concerns only candidates at its own level** (`0514`) and says in words what it tests
  (`0515`). **A household citizenship clears the gates it names** (`0517`, `0526`, Q239): rows in
  `match_rule_clearing_citizenship`, never code.
- **Gate research asks only what it can answer**, and every billed call is ledgered as it
  happens (`0502`, `0503`, Q236).
- **The LLM fallback leaves hand-entry attributes alone**, so a run cannot be billed to re-learn
  an uncitable score.
- **`tools/migrate.py`** reads only `.env`'s `DATABASE_URL` and turns every refusal into a
  sentence with a remedy (P95). **`tools/e2e_copy.py`** builds the e2e copy's URL, so make never
  holds the password (P100).

### 3.3 Interface

- **One read state for every panel** (C01; `api/read.ts`, `api/useRead.ts`): pending, ready,
  refreshing, failed. **Never show a default as a fact while a read is pending or failed.** A
  server that does not answer reads as "not reachable", with Try again, and is read again when it
  next answers.
- **Errors go through `presentError`** (`api/errorPresentation.ts`): every code the contract
  names, in words, with names and never ids.
- **Names, never identifiers.** `src/testing/identifiers.ts`, and its copy `e2e/identifiers.ts`
  kept identical by `src/app/identifiers.test.tsx`, fail a page that shows its reader an internal
  id. The Candidates panel will need name lookups for everything it shows.
- **Configure keeps a session above the routes** (`ConfigurationSessionProvider`, PL-033): the
  change history, its one write in flight, and where an answer goes. A write keeps its slot until
  it settles, whichever screen is showing.
- **Recent changes records every stored Configure edit, with an Undo that re-sends the opposite
  request.** A new recorded writer -- the Candidates panel will be one -- follows this protocol,
  which P101-P105 finished:
  1. `history.begin(setId?)` takes the one slot. Null means held: the control stays *held*, not
     disabled, so focus stays on it (NEW-34).
  2. Send through `settled(send, readBack)`. The read-back answers what the write would have
     answered if the stored state shows it landed, and `null` if it did not.
  3. Landed: show the answer through the session (`answers.deliver`, `noteSourcesChanged`,
     `noteRecordsChanged`) -- **never only through the local hook**, which may have unmounted
     (P102) -- then `history.note(entry)`.
  4. Unknown (`UnconfirmedWrite`): `history.note({ ...entry, ...pendingEntry(error, show) })`. It
     is listed "Not confirmed" with Check again and holds its set (`history.waitsFor`). A writer
     outside any set needs its own hold, as `useDataSources` and `useRecordForm` have.
  5. **The entry's `reverse` goes through `settledUndo(send, readBack, show)`**, with a read-back
     of the value it restores, never a bare request (P105). An undo whose answer is lost leaves
     the change "Undo not confirmed", holding its set, instead of failing.
  6. Give the slot back in `finally`.
- **The architecture guards** (`src/app/architecture.test.ts`): no barrels, no loose files under
  `routes/`, folders by feature, a base CSS rule before its modifiers, no undeclared custom
  property, every class in markup either styled or in the ledger, and the e2e recipes pinned as
  text (with `backend/tests/unit/test_migration_tooling.py`). eslint forbids inline styles, and
  `Number`, `parseInt`, `parseFloat` and `toFixed` in a `.tsx` under `routes/` or `shell/`.
- **Browser tests.** A spec's own set is a fresh copy per worker (`e2e/ownedSet.ts`), because a
  deleted set keeps its id and a re-run `beforeAll` collided with it. Pick rows with role filters,
  never a `hasText` pattern: a row's text runs its cells together. Compare whole rankings, not one
  score: Finland scores 66 in two sets. `make e2e` runs on a throwaway copy of the newest backup
  and never touches the live database.
- **CSS.** `.table--matrix > tbody > tr > td` zeroes padding and border and outranks
  `.matrix__cell`, so a matrix cell's box is set on `.table--matrix .matrix__cell`.
- **The test mock lists every source an attribute declares or a figure cites** (P106) and treats
  an unlisted source as off. A new fixture attribute naming a source must add that source to
  `DATA_SOURCES`.

## 4. Design problems found and fixed

### 4.1 In the domain: the decisions of the programme

| # | Decision |
|---|---|
| Q229 | The shared vocabulary registry is dropped, and the per-attribute one is finally used |
| Q230 | A publisher's table is transcribed and stored under that publisher |
| Q231 | MIPEX: the 2025 edition for the EU, the 2020 edition for Iceland, Norway, Switzerland and the UK |
| Q232 | A source can be switched off and reordered on screen |
| Q233 | A run does not re-fetch what is still fresh |
| Q234 | The second tab is "Acquire", not "Run" |
| Q235 | An attribute says which sources can fetch it: `answerable_by` |
| Q236 | Gate research asks only what it can answer, and every billed call is ledgered |
| Q237 | A gate answer is kept once written, and a saved refusal pins what it read |
| Q238 | A rule's outcome is per set: each set holds each rule it applies as a gate or as a warning |
| Q239 | The household's citizenships drive the gates that name them |
| Q240 | Weights are kept to ten decimal places, and a sum is exact to the twentieth |

### 4.2 In the interface, against the design

- **Round 3 measured the interface against the design** (UF-001 to UF-144) and fixed it to
  match. Where the product deliberately differs, the divergence is recorded in
  `design-brief.md`, agreed with Alex. Two were added in round 3 and after: **edits write
  straight to the set and Recent changes undoes them** (D2, keeping Q168; PL-180), and **a
  Compare cell's tint deepens with its bar** over a wider range than the design's (`96f845f`).
  The design's tint saturates at a gap of 30% of the focus's figure, so large gaps of different
  sizes drew one colour. Everything else in a Compare cell is the design's own formulas
  (`ec74185`).
- **A saved ranking shows its evidence** (D46): each refusal's gate answer and figure, a
  warning's inputs, each contribution's figure with its source and dates, and the frozen scale.
  The saved view gained pillars, Δ home and a drill-down.

### 4.3 In the v2 design, found before any code

Revising the architecture against the code, then two rounds of independent review against the
code, found these. Each is now in arch 12 and the plan.

| Problem | Where it lived | Now |
|---|---|---|
| `parent_not_matching` never built | `evaluation/ranking.py`; the store writes `False` | The parent's match status in the one vocabulary, judged by the same set at country level (12.8, Q248) |
| A criterion's level is its attribute's, and a set holds one criterion per attribute | `criterion_natural_key`, `CriteriaSet._reject_a_second_rule_on_one_attribute`, the criterion route keyed by attribute | `criterion.level` in the criterion's identity, checked against the level hierarchy (12.5, Q242) |
| The snapshot, thresholds, compound rules and comparison read only the candidate's own stored value | `0523`, `evaluation/rules.py`, `api/comparisons.py` | The evaluated figure, with its evidence (12.7, Q252), landed first as a country-only refactor that moves no number (P2a) |
| The first revision scoped the evaluated figure to criteria, without a figure's published bounds | a rule reads attributes no criterion scores (`ranking.py`, P46); `PublishedFigure` carries bounds | Every attribute a criterion judges or a rule reads, carrying the published figure |
| Percentile would weight a national figure by how many cities a country has | `evaluation/normalisation.py` counts every candidate beaten | An ancestor's figure is normalised over the distinct ancestors (12.5) |
| Nomination as fields on the candidate would overwrite its history | -- | An append-only `candidate_nomination` history, like gate answers (12.2, Q241) |
| A stand-in copies its substitute's measured distance | `data_acquisition/stand_in.py` copies the value whole | No stand-in at a point or region footprint until the distance is measured again (12.4) |
| Gates needing a network or a bill would have joined `make check` | the draft's gates | Live halves in `make live`, billed halves in `make live-llm` (plan 1.4) |
| Geography and footprint came after the slice that needs them | the first ordering | Both in P1 |
| LLM use 1 at the city level: permitted by `reqs.md` 6.10, contradicted by the revision | `reqs.md` 6.10 | Permitted, not planned; an open decision |
| Two compound-rule shapes silently unimplemented | `evaluation/rules.py` `_holds` | `ShareOfHouseholdField` built for `rent_vs_spend` (12.6); `SumBelowFloor` stays silent, its inputs retired (`0487`) |

## 5. v2.0 -- the plan as it stands

### 5.1 What happened to your draft

Your draft of 12 Oct, with your edits of 24 Oct, is committed unchanged as `3833184`, so
`git diff 3833184 -- docs/devplan-v2.md` shows every change since. **Kept**: section 0.0, the
research and the household's decisions, with decision numbers added and a table of the 25 Oct
decisions; and section 0, the thesis, with two rows corrected. **Replaced**: sections 1-7. The
workstreams W0-W9 became phases P0-P7 with gates A2-D2, and the open questions became decisions.
Nothing was dropped: W1 is in P1; W2 in P1 (footprint), P2b (a criterion's level) and P3 (derived
figures); W3 and W4 in P4; W5 in P1 (the API) and P5 (the panel and proposals); W6 in P2b and P5;
W7 in P5 and P6; W9 in P7; and W8 moved to v2.1. W0 ("v1 works") is met.

### 5.2 The decisions, Q241-Q252

| # | Decision |
|---|---|
| Q241 | The city roster is seeded from the 79 cities of the EU Quality of Life survey; a manual add enters `approved` and an LLM proposal waits as `proposed`; top N by population is not built in v2.0 |
| Q242 | A city criterion may judge its parent country's attribute, read through the parent and never copied, and a criterion carries its own level |
| Q243 | The city cost of living is derived at scoring time from stored figures and the household; Numbeo is not used |
| Q244 | The country screen narrows by hand with `not_manually_excluded`; there is no score cutoff |
| Q245 | Survey answers are scored and labelled as a resident survey; homicide by NUTS 3 is scored; recorded robbery, burglary and vehicle theft are displayed only |
| Q246 | Both shipped criteria sets carry the city level, and the interface features deferred from the MVP move to v2.1 |
| Q247 | A footprint is a property of the attribute, and every figure records the place it was measured for |
| Q248 | Evaluating a set at the city level evaluates the same set at the country level first; a city records its parent's match status, is flagged `parent_not_matching` whenever that status is not `matching`, and a city run leaves out only the cities of a `not_matching` country by default |
| Q249 | City geography is resolved once, from vendored datasets processed offline, and there is no PostGIS |
| Q250 | v2.0 is built in vertical slices, each gated and reviewed on its own, and its four gates are written as failing tests before any feature code |
| Q251 | Numbeo is not fetched |
| Q252 | What evaluation read for a candidate and an attribute -- for any criterion or rule -- is an evaluated figure, carrying the published figure and its bounds and frozen with its evidence; matching thresholds, compound rules, the snapshot and comparison read it rather than a stored value |

### 5.3 The phases

| Phase | Delivers | Exit |
|---|---|---|
| **P0** | The target contract for v2.0, the four gates as failing tests, the diagrams | Every gate red for the right reason; Alex approves the contract additions |
| **P1** | Cities exist: the nomination history, place, footprint, the geometry library, two sources at city level | Gate A2's nomination and figure assertions green |
| **P2a** | The evaluated figure, at the country level only | A refactor that moves no number: every v1 suite and gate still green |
| **P2b** | Cities rank: a criterion's level, figures read through the parent, the parent's status | Gate A2's ranking assertions green |
| **P3** | Derived figures, and the household-share rule shape | **Gate A2 green** |
| **P4a-d** | Sources by tier -- region, city, point -- then the city catalog and both shipped sets' city levels | **Gate B2 green**, its live half in `make live` |
| **P5** | The Candidates panel, LLM proposals, city Compare | **Gate C2 green** |
| **P6** | Employer lists at the city level | Gate D2's spend assertions green |
| **P7** | Durability, scale and the caching measurement | **Gate D2 green: v2.0 done** |

The slice rules (plan 1.2): a slice is the smallest change that moves a gate's tests from red to
green end to end; one slice at a time on master, at most two lanes inside it on disjoint
folders; a slice lands with its gate tests passing, `make check` and `make e2e` green, and one
review of the whole slice diff with its findings fixed.

### 5.4 P0, concretely

1. **The contract** (`docs/openapi.yaml`): candidates listed with their nomination state and
   history; resolve a name to the places it could mean; add a candidate; propose candidates,
   estimated first; approve or reject a proposal; a candidate's place. Criterion operations
   keyed by level and attribute. Footprint and `measured_for` in a figure's provenance. The
   evaluated figure's evidence and the parent's match status in the ranking detail and the
   comparison. `tools/audit_api.py` holds it, and **Alex approves the additions**: the contract
   changes only by decision.
2. **The ontology diagrams** of `reqs.md` 3 gain the nomination history, place, footprint, a
   criterion's level, the evaluated figure's evidence and the derivation inputs;
   `tools/audit_ontology.py` holds them.
3. **The four gates as failing tests**: `backend/tests/acceptance/test_gate_a2.py`,
   `test_gate_b2.py`, `test_gate_d2.py`, `ui/e2e/gate-c2.spec.ts`, and the live halves beside
   `backend/tests/live/test_gate_b.py`. Each is marked as a v2 gate and kept out of `make check`
   and `make e2e`; a new `make gates-v2` runs them and reports what is still red. **Read every
   failure**: each must fail for the right reason, a missing operation, row or field, never a
   typo. A new make target leaves the pinned e2e recipes alone.
4. **The gates are the master agent's**, written from `reqs.md`, arch 12 and the target contract,
   not by whoever builds the slice that turns them green.

### 5.5 Open, none blocking P0

From plan section 5: the ride-alongs (intercity connectivity, pillar expansions, time-series
reducers; default v2.1); LLM use 1 at the city level (default: not built); the household's
dwelling size and non-housing spend (set from real figures in P3); the shipped sets' city
weights and anchors (derived from real figures in P4d and reviewed by Alex, as Q209); the
contract additions (approved at P0's exit); caching (decided on the P7 measurement); and
two added with this handoff. **Breakdown reduction, NEW-25**: arch 7.2 step 3 is not built,
round 3 deferred it to the v2 plan and the plan had not carried it; no active attribute has a
breakdown today, so v2 needs it only if a city attribute keeps one, now that rent is per m² and
the cost of living is derived -- decide with the catalog (P4d). **What Undo means for a
nomination**: Recent changes records every stored Configure edit, and the nomination history is
append-only, so undoing an approval cannot delete the step that recorded it. Whether it adds a
reversing step, or nomination stays out of Recent changes, is decided before P5.

### 5.6 Traps for the city build

- **A `city` branch in scoring, matching, active-value selection or comparison is a design
  failure** (plan 0). Fix the leak in the module where it appears, and say which module it was.
- **The criterion's identity is spread across four places**: `criterion_natural_key`,
  `CriteriaSet._reject_a_second_rule_on_one_attribute`, the contract's
  `/criteria-sets/{criteriaSetId}/criteria/{attributeId}`, and the interface's keys. All four
  gain the level together.
- **P2a must move no number.** It touches what every ranking reads and freezes; land it alone,
  before any city criterion exists, and let the v1 suites and Gates A-D prove it.
- **A derived figure is computed at scoring time and never stored**, whether or not it reads the
  household. Its provenance is its inputs', its confidence the lowest of theirs, its reference
  date the oldest; a candidate missing an input has no figure, and coverage says so.
- **Footprint is the attribute's**; every point or region figure names the place it was measured
  for, and the database refuses one that does not. No stand-in at a point or region footprint yet.
- **Never a network or a bill in `make check`.** Measured coverage belongs in `make live`, a real
  model's bill in `make live-llm`.
- **Seed `NULL`, never invent a number**: every city weight and anchor is derived from real
  figures and reviewed by Alex.
- **The data facts from your research still hold**: Numbeo is never fetched (its terms; Q251);
  the public Overpass server refuses a run, so OpenStreetMap comes from Geofabrik extracts;
  Open-Meteo's sunshine runs 30-68% high, so sunshine comes from the WMO normals; Urban Audit is
  patchy by whole countries and Deloitte covers 22; police-recorded crime is not comparable across
  countries, homicide excepted; Liechtenstein is not in the survey, so Vaduz is a manual add.
- **No PostGIS** (Q249). The geometry library is chosen and added with `uv add` in P1.

## 6. Documents changed

| Document | What changed | Commit |
|---|---|---|
| `CLAUDE.md` | Current counts and facts: 50 operations, eleven adapters with the ECB, nine Configure panels, gate answers kept once written, citizenship clearing gates, exact-pair runs, Recent changes. The review programme closed, v2's status, `docs/design/` local only | `bc7d959`, `ef8c3ea`, this commit |
| `docs/arch.md` | Header; 6.1's `data_sources` row; a note in 10.5 on what v2 starts from; 10.6; 11 (PostGIS closed, derived attributes settled, caching and household fields open); **section 12, new** | `98a5b27` |
| `docs/reqs.md` | Section 4 (national factors through the parent; the LLM's scope); 6.1 (v2 builds three of four ways in); 6.10 use 4 is v2.0; 7.2's status note and struck sources; 7.3 and 7.4's `two_role_feasibility`; **Q240** (with P107) and **Q241-Q252** | `8680e7a`, `98a5b27` |
| `docs/datasources.md` | Numbeo superseded: its terms forbid automated collection | `98a5b27` |
| `docs/devplan-v2.md` | Your version committed as it stood, then rewritten (5.1); W0 met; NEW-25 added to the open decisions | `3833184`, `98a5b27`, `ef8c3ea`, this commit |
| `docs/known-issues.md` | P101-P107 filed and closed | `1077465`, `9f7f870`, `8680e7a`, `ef8c3ea` |
| `docs/design-brief.md` | Compare cells: the design's formulas, and the tint divergence | `e2a310c`, `ec74185`, `96f845f` |
| `docs/research/city-level-sources-2026-10-23.md`, `docs/kt-handoff-to-reviewer-2026-10-22.md` | Committed; they were untracked | `3833184` |
| `.gitignore` | `docs/design/` | `bc7d959` |
| `docs/copilot-round3-plan.md` | Its status line said "awaiting approval, no code written"; it now says done | this commit |

## 7. How Alex wants the work done

- **Plan before code** for anything beyond a trivial fix: what, which files, behaviour changes,
  risks, an alternative rejected, how to verify. Wait for an explicit approval; silence is not one.
- **Ask with a short questionnaire**: options, your recommendation as the default, and why. He
  answers those quickly and well.
- **The quality bar**: every built feature must work whether or not he uses it today. Never
  downgrade a bug as dormant, unreachable or "no data yet".
- **Reviews**: one review of each slice's whole diff, by a different model; a critical finding
  gets at most two review rounds, then he decides. The rounds of findings before this cost him
  days and a great deal of money, and he said so plainly.
- **The design 1:1.** Where a cell, a colour or a spacing differs from `docs/design/` without a
  divergence he agreed to and `design-brief.md` records, he will notice, and he will ask why.
- **Agents**: parallelise freely, but split work by folder so no two agents edit one file, and
  keep each agent's scope small; do it yourself when handing over the context costs more.
- **Replies**: short; numbers when he asks for a status.
- **Git**: never `reset --hard`, `checkout --` or `clean` in the main checkout. On 25 Oct a reset
  there wiped his uncommitted `devplan-v2.md` edits, recovered only by replaying your Edit calls
  from the Claude Code transcripts. Move master with `merge --ff-only`; prefer a new commit to an
  amend.
- **Compose**: never pass a variable compose reads (`DATABASE_PORT` and the like) on the make
  command line; make exports it to compose, which recreates the live database container.
- **Reading the live database**, read-only:
  `docker compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' database sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`

## 8. Still open

Everything else in `known-issues.md` is closed. Trust the rows, not the summary table at the top
of the file, which listed D14-D22 and P41-P62 as open long after they closed (corrected with this
handoff). These are open, and none blocks P0:

| # | What | State |
|---|---|---|
| P4 | The household's income, target spend and rent ceiling are stored and never used | Open by scope. v2's derived figures read household fields (arch 12.6), and the household-salary tax will read the income |
| P23 | The criteria store's `Boolean` and `ShareComposition` threshold branches are untested | Partly fixed, on purpose: no attribute of either type exists, and a test may not invent one. **The first city attribute of either type brings their tests with it** -- land cover shares are a likely one |
| P6 | OECD's API is intermittently behind a Cloudflare challenge | Watched; stored figures untouched; the family attributes were transcribed instead |
| P38 | The LLM fallback can report a previous edition's figure under the current one's date | Mitigated: published tables are transcribed under their publisher (Q230) |
| P58 | Confirming a gate proposal drops its reference period | Latent: research records no period today. **Fix it in the slice where research first records one** |
| P93 | A value or reuse row commits a moment before its rejection failure | By decision, low: only a kill lands in the window |
| P94 | A start in flight is forgotten if Acquire is left before the run exists | By decision: the window is one round trip |
| P99 | A stale set read that lands before a save's answer reaches the pillar and rules panels | By decision, low: needs two set switches within one save |
| D24 | `react-hooks/set-state-in-effect` warns at five call sites that follow an asynchronous answer: half of the ten lint warnings `make ui-check` prints. The other five are `react-refresh/only-export-components` (a file exporting more than components, which only costs hot reload), tracked nowhere | Low, warnings only: each has a derived-state rewrite, none is a bug today |

## Appendix A -- the 182 round-3 items and their commits

Generated from the plan's master list and `git log 7a5d8e6..ef8c3ea`: every commit whose message cites the item, oldest first. The fix direction and the decisions are in `copilot-round3-plan.md`.

### C01 The shell and truthful states -- 23 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-001 | Critical | Reads still loading or failed are shown as facts: zeros, "not set", "no figure stored" | `3aac090` `0536ca9` `96307f0` `df943ac` and 11 more |
| PL-002 | High | When the server is down every screen says the response "has a shape this interface does not recognise", with no Try again and no recovery | `3aac090` `c694ea6` `b170058` `ad8a47f` and 1 more |
| PL-003 | Medium | Error notices print codes, the server's raw sentences and database text, in monospace, without the round-4 title or reassurance | `bb2dd54` `eb75764` `bcc167c` `b19ff01` and 4 more |
| PL-004 | Medium | Refusal banners cannot be dismissed, and their "Try again" retries nothing | `3aac090` `362341d` `6a2cb6a` |
| PL-005 | Medium | An unset score range is half handled: the sidebar loses Total and shows red, Compare keeps its picker, Rank keeps Save | `685ef15` `b0d3881` `e30eafe` `228a005` and 2 more |
| PL-006 | Medium | Legitimate states leave Rank on a red error made of ids, with no way out | `7b708a4` `14eb50b` `b41989c` `d8e16ec` and 5 more |
| PL-007 | Low | Every comparison refusal offers "Change it in Configure", even when no setting is to blame, and prints raw ids | `f632b59` `d8e16ec` `5b73007` |
| PL-008 | Medium | The sidebar's household card says "Nothing has been recorded" when it simply could not read | `685ef15` |
| PL-009 | Low | A criteria-set list that is loading or has failed reads as "no sets", with instructions that cannot be followed | `685ef15` |
| PL-010 | Medium | Every re-read blanks what it re-reads, so content jumps under the pointer | `3aac090` `685ef15` `d609307` `0536ca9` and 4 more |
| PL-011 | Medium | Empty states are missing or misleading on all four tabs | `226d98b` `95d0739` `768a7ab` `4a0c056` |
| PL-012 | Medium | Loading is a plain "Loading…" line: no skeletons, no busy flag, content pops in | `3aac090` `d12d722` `95d0739` `4a0c056` |
| PL-013 | Low | Configure stages lose their card and heading while loading or after a failure, so the stage numbers shift | `d609307` `bf8259c` |
| PL-014 | Low | A failed attribute-catalog read is silent, so unsourced attributes look sourced | `d609307` |
| PL-015 | Medium | When an acquisition ends, the sidebar updates but an open Rank or a drawn comparison does not | `68f06c4` `768a7ab` |
| PL-016 | Medium | Compare and Rank forget their state on every tab change, criteria-set switch and reload | `eedbd18` |
| PL-017 | Medium | The active criteria set is forgotten on reload; the app reopens on whichever set id sorts first | `eedbd18` |
| PL-018 | Low | Routes to a setting or section land at the top of the page, thousands of pixels from the target | `776a28b` `95d0739` |
| PL-019 | Medium | An unset comparator limit, the shipped state, is a red error naming a settings key and a screen that does not exist | `5b73007` |
| PL-020 | Medium | Times are shown in UTC with no label, while Recent changes uses local time | `bfcd992` `277ff8c` |
| PL-021 | Low | Every saved-ranking link, and several sidebar links, claim to be the current page | `35983d1` |
| PL-022 | Low | Each screen's title is an h2; the brand is the page's only h1 | `35983d1` `bf8259c` |
| PL-023 | Low | The product name has two sources, and APP_DISPLAY_NAME never reaches the interface | `a9c286c` |

### C02 Forms: what is typed, refused and saved -- 9 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-024 | Critical | Number fields silently rewrite what is typed and report "Saved.": "72,000" is stored as 72 | `66e9500` `d9eadff` `34ccd36` `d886dd5` and 3 more |
| PL-025 | Medium | Forms do not say truthfully whether what is on screen is saved: drafts vanish silently, "Saved." outlives an edit, a first-save note outlives the save, and "Save rule" confirms nothing | `30ccada` `6294118` |
| PL-026 | Medium | A refused rule save is reported out of view, with ids and a code, and the form snaps back | `d5df021` `c927764` `7b1fc36` |
| PL-027 | Medium | The rule editor and the "Accept an uncapped spend" checkbox have no layout styles: fields sprawl, and a click anywhere on a line ticks the consent | `7b1fc36` |
| PL-028 | Medium | An out-of-range limit is refused with a generic sentence that names no field and no rule | `6baf9dc` `4581376` `c7bd063` `a20453b` and 1 more |
| PL-029 | Low | Stage 3 prints programmatic identifiers: units, goals and methods | `7b1fc36` |
| PL-030 | Low | The comparator limit has no 1–20 range, and leaving it unset blocks Compare while looking advisory | `6baf9dc` `4581376` `c7bd063` |
| PL-031 | Low | Stage 6 wording: a raw "insufficient_data", two names for one field, and a cap that seems not to cover research | `d9628ed` |
| PL-032 | Nit | The spend cap reads "5" after a save, not "5.00" | `c7bd063` |

### C03 Criteria-set management -- 9 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-033 | Critical | Delete removes a criteria set, even the one in use, in one click: no confirmation, no history entry, no way back | `3cefeb5` `1f78c12` `c8b8bd1` `675a599` and 19 more |
| PL-034 | High | "Create set" makes an empty set that nothing can fill, and moves the whole app onto it | `675a599` `c99f730` |
| PL-035 | Medium | A set used by a saved ranking can never be deleted, and the refusal is database text | `1f78c12` `675a599` `da01509` |
| PL-036 | Medium | Rename accepts a name another set already has | `1f78c12` `22af431` `8706ccc` `64e1333` and 1 more |
| PL-037 | Low | Set actions throw keyboard focus to the page, and a double press sends twice and shows a refusal after a success | `9748534` `65789ee` |
| PL-038 | Low | Rename is not keyboard-complete | `65789ee` |
| PL-039 | Low | "Create set" stays disabled, with no reason, for a name with no Latin letters or digits | `3cefeb5` `22af431` `64e1333` |
| PL-040 | Low | Set rows do not show their heaviest pillar | `22af431` `64e1333` `e4b2468` |
| PL-041 | Nit | A long set name runs under the row's buttons and past the sidebar | `22af431` `8706ccc` `64e1333` `989f237` and 1 more |

### C04 Runs: accounting, evidence and the diff -- 20 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-042 | Medium | Stand-in borrowing ignores a retry's exact pairs, and a run's counts can exceed its total ("3 of 2") | `84f2ca7` |
| PL-043 | Medium | A retry records pairs from failures of sources nobody will ask | `84f2ca7` |
| PL-044 | Low | One run read combines several database snapshots, so its counts can disagree with its lists | `7d7d35e` |
| PL-045 | Low | A rejected figure's failure commits after the figure, so a kill can lose the failure | `24f7074` |
| PL-046 | Medium | A re-read that contradicts the stored figure under the same date is silently kept and counted as re-confirmed | `33de481` `9f21a56` `db0b940` `f1d8a1f` and 1 more |
| PL-047 | Low | A run's generic abort drops the item in flight | `e8747c4` |
| PL-048 | Low | SQL does not pin a run's evidence to its items, its scope and its level | `ebde9e1` `626bfe0` |
| PL-049 | Critical | The acquisition diff calls re-confirmed figures "went missing" and leaves them out of "Unchanged" | `0694f44` `b490854` `6b81a07` `5fd6464` and 2 more |
| PL-050 | High | Items nobody was asked are reported as "unanswered: every source answered, none had a row. Retrying changes nothing" | `8dcf231` `6a4df21` `6457b4a` `6fd8a57` and 1 more |
| PL-051 | High | "What the database holds" shows the last acquisition's accounting, not the database, and lacks "countries scored" and the ageing count | `e30d9b0` `57f6b4e` `56ebeba` `6fd8a57` and 1 more |
| PL-052 | Critical | Money spent on gate research is left out of "Spent this month" and disappears from every screen once the pass ends | `e30d9b0` `57f6b4e` `56ebeba` `4220889` and 6 more |
| PL-053 | Medium | The failed card counts failures rather than failed items, so it disagrees with the run and the three cards do not add up | `f791338` |
| PL-054 | Medium | The remedy cards follow whichever run is on the card, so outstanding gaps disappear | `e30d9b0` `56ebeba` `f791338` |
| PL-055 | Medium | The source-by-source bars show a success rate rather than progress, and never say "not reached" | `8dcf231` `6a4df21` `6457b4a` `2db4a96` |
| PL-056 | Low | The card's spend line omits the ceiling and the cap | `8dcf231` `6a4df21` `6457b4a` `2db4a96` |
| PL-057 | Low | Spend and cap wording disagree: a retry is not called a new acquisition, "refuses" sits beside "uncapped", a monthly total is captioned with a per-run cap | `4220889` `440c466` |
| PL-058 | Low | The failed card says each message is listed once; it is listed once per item | `f791338` |
| PL-059 | Low | Empty failed and unanswered cards disappear instead of reading "Nothing is failing" | `f791338` |
| PL-060 | Medium | The acquisition diff misreads scope and picks: everything outside a small run "went missing", reversed and identical picks are accepted, and its notes overclaim | `3043d76` `10d2152` |
| PL-061 | Low | The contract, SQL comments, docstrings and reqs still describe a run's scope as a rectangle, under-list its 409 codes and omit a run status | `be351e9` `626bfe0` |

### C05 Rank: the table, the drill-down and the score scale -- 21 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-062 | Critical | Scores are drawn and labelled as if the scale were 0–100: at a scale of 150, a pillar score of 128 prints "100" | `dc65f51` `2731a1d` `d8e16ec` `90a5a59` and 3 more |
| PL-063 | High | In the drill-down, "Weight" and "Weight used" are on different bases, so every row seems to have lost most of its weight | `080bc6f` `2d4d73c` `95c6fbc` |
| PL-064 | Low | Month-based maximum ages are compared as day counts, so a figure's grade drops a day or two early or late | `c25b33d` `d98afde` |
| PL-065 | Low | A ranking reads active values once per candidate: 32 statements and 32 snapshots | `c25b33d` |
| PL-066 | Medium | Candidates outside the ranking are listed alphabetically, not by score | `2d999c2` |
| PL-067 | Medium | "Why this status" explains exclusions in machine text (raw attribute and gate ids, `not_matching`), and the band blames a gate for every exclusion | `0d7d05d` `4fe380a` |
| PL-068 | Medium | The drill-down counts missing attributes but never names them | `d6212fe` |
| PL-069 | Medium | Each figure's confidence chip ignores the age downgrade that the row's confidence split applies | `78dbe1e` `d98afde` `df1a5dd` `d6212fe` |
| PL-070 | Medium | The criteria set is shown by its database id in Rank's header and in the saved-rankings list | `4fe380a` |
| PL-071 | Low | A figure whose source is switched off is labelled "Superseded", though nothing replaced it | `78dbe1e` `df1a5dd` `d6212fe` |
| PL-072 | Low | A rejected figure never shows why it was rejected | `0d7d05d` `d6212fe` |
| PL-073 | Low | "Weight used" is never tinted, and no tooltip says how a figure was scored | `95c6fbc` |
| PL-074 | Low | Stored values are listed in attribute-id order, with descriptive attributes mixed in | `d6212fe` |
| PL-075 | Low | The open-row and not-matching row backgrounds never show | `9b784e2` `5ba0802` `0df0036` |
| PL-076 | Low | Rank rows cost 12 tab stops each, and the row toggle does not say whether it is open | `6b7a34c` `9b784e2` |
| PL-077 | Low | The attribute panel miscounts, and says a weight redistributes when it does not | `7e51e29` |
| PL-078 | Nit | Every row shows a fourth confidence reading, "absolute 0%" | `7e51e29` |
| PL-079 | Nit | Small wording and colour differences on Rank | `7e51e29` `0d7d05d` `9bb10ac` |
| PL-080 | Nit | Two kinds of minus sign on one screen | `e93c19d` |
| PL-081 | Low | The home country's Δ home reads "—" instead of "baseline", and an all-dash column is unexplained | `4fe380a` |
| PL-082 | Medium | The narrow-desktop rule was adopted but never built, and at 1440 px or less Rank's rows outgrow their table | `a298548` `91ac411` |

### C06 Hand entry -- 8 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-083 | Critical | A hand-entered score is scored without its scale: "7 on 0–10" counts as 7 out of 100 | `3833b8a` `cfe2773` `0171815` |
| PL-084 | Medium | After storing a hand-typed figure there is no "See it in the Rank drill-down", and Rank cannot be opened at a candidate | `98ff22a` `0171815` |
| PL-085 | Low | The hand-entry form lacks the designed bands, chip preview, retrieval date and marked fields, and its "Stored…" line is never announced | `a6ceaa5` |
| PL-086 | Low | The hand-entry Link field accepts text that will never be shown as a link | `d6a1e5a` `319510b` `1ffa5e1` |
| PL-087 | Low | The one measured attribute that permits hand entry appears in neither card | `ad8b6ef` |
| PL-088 | Low | The "no data source" card lacks the attribute's type, its remedy is plain text, and its weights are wrong while the set loads | `ad8b6ef` `0c36f20` `4a0c056` |
| PL-089 | Low | Switching off "Manual entry" does not stop hand entry, and the stored figure then silently stops counting | `d6a1e5a` `319510b` `1ffa5e1` |
| PL-090 | Nit | A label containing a comma reads as two labels in the diff's exact view, and cannot be typed by hand | `82b3386` `a6ceaa5` |

### C07 Compare -- 18 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-091 | Critical | The synthesis cards are signed backwards: each card's number and lists describe the focus but sit under the comparator's name | `0ffbac6` `eb75764` `b8b9092` `29a79d9` |
| PL-092 | High | At the comparator limit a new tick silently drops the oldest choice, which stays hidden and can come back by itself | `e440983` |
| PL-093 | High | Gaps are printed less precisely than their figures, so real differences read "+0" or "−0" beside a coloured bar | `e93c19d` |
| PL-094 | Medium | The comparison waits for a Compare press, and an old result stays on screen when the selection changes | `415cab4` |
| PL-095 | Medium | Compare never says that a candidate is not matching or lacks the data to score | `685eb83` |
| PL-096 | Medium | Raw figures are shown without a source, period, retrieval date or confidence | `685eb83` `277ff8c` |
| PL-097 | Medium | The weighted contribution of each attribute's gap is never shown | `087e3a2` |
| PL-098 | Medium | Attribute rows have an empty weight cell and no "#N in pillar" tags | `2ff3865` `eb75764` `087e3a2` |
| PL-099 | Medium | The synthesis never says when a comparison is partial: the "Not comparable" footnote is missing | `2ff3865` `eb75764` `1f1b27f` |
| PL-100 | Medium | The synthesis lists attributes, not pillars, and its "#1" tags mean something different from the matrix's | `2ff3865` `eb75764` `1f1b27f` |
| PL-101 | Low | Missing values read "—" instead of "No score", and card gaps have no "points" | `1f1b27f` `ff0c2b6` |
| PL-102 | Low | Compare opens empty, its Compare button is disabled without a reason, and "Raw figures" seems to do nothing | `415cab4` |
| PL-103 | Low | Comparator columns follow the order of the clicks, not the scores | `415cab4` |
| PL-104 | Low | Pillar weights are whole percentages on the left, and the priority tags move when only the focus changes | `1f1b27f` |
| PL-105 | Low | The Raw note and the attribute notes leave out what the design says | `ff0c2b6` |
| PL-106 | Low | The limit note does not say how many are chosen | `e440983` |
| PL-107 | Low | An empty "Ahead on" or "Behind on" list still shows its label | `1f1b27f` |
| PL-108 | Nit | Column headers are not styled as designed | `ff0c2b6` |

### C08 Weights, locks and held controls -- 7 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-109 | Low | A held slider, the pillar lock, the "blocks scoring" box and Acquire's history "Open" look unchanged while they are held | `3c99ac4` |
| PL-110 | Low | The lock draws a disc, not a padlock; neither lock has a hover or pressed state; dead lock CSS; titles duplicated | `3c99ac4` |
| PL-111 | Medium | Criteria that are not scored look like scored ones: live sliders, the usual chips, "Required" on Configure and on Rank, and a "blocks scoring" box that does nothing | `ecab393` |
| PL-112 | Medium | The "every other weight is locked" refusal is wrong in three of its four cases, names no pillar, and outlives its cause | `21ba15e` `277ff8c` `43c246c` |
| PL-113 | Low | Pillar rows omit the unsourced share, and unsourced attributes omit "Weight redistributed" | `d007671` |
| PL-114 | Nit | Stage 3 colours differ from the design: the open pillar is not tinted, and the totals use amber and teal | `d2269ae` |
| PL-115 | Nit | Two explanatory paragraphs, with "backend" jargon, open inside every pillar | `d2269ae` |

### C09 Acquire: starting, following, stopping and retrying -- 18 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-116 | High | An armed "Yes, start it" goes stale and starts a scope that is no longer on screen | `47d0ed5` `0ffdaa7` `fd0f3ef` |
| PL-117 | Medium | Acquire does not follow the run it shows; its history and "What the database holds" stay stale too | `0b15c8b` |
| PL-118 | Medium | A start in flight is forgotten when Acquire is left and opened again | `d526cdb` |
| PL-119 | Medium | Starting is offered while a run is in flight, and the refusal gives no way to that run | `301bb51` `50e83a5` `c3c8279` `11b181b` |
| PL-120 | Medium | With every source switched off, Acquire offers a zero-item acquisition and refuses only after it is confirmed | `917a29c` `207f5a1` |
| PL-121 | Medium | The refresh-everything card starts at once after its estimate, has no counts, and says it re-asks everything when the refetch age narrows it | `44268ad` `ceba8d8` `c25c92a` |
| PL-122 | Medium | Run outcomes print raw status ids, and a stop by the reader looks like a halt at the spend cap | `2f2e37c` `e115090` |
| PL-123 | Medium | The stopping state is not drawn | `4fe7e29` |
| PL-124 | Medium | Retry is not selective (it asks every switched-on source about the rectangle, paid ones too), and the selection controls are only partly built | `71ba9b7` `04525d4` `2068c98` `fd0f3ef` and 1 more |
| PL-125 | Medium | There is no way to acquire one candidate, one attribute or one pillar | `6bf871e` `84f10bb` |
| PL-126 | Low | Opening an acquisition from the history changes the card 2,000 px above and leaves the reader at the bottom | `178333d` |
| PL-127 | Low | History rows and links say less than the design, and a pair-scoped run is worded as a rectangle | `47e8c9c` `04525d4` `ea88d9a` |
| PL-128 | Low | Keyboard focus falls to the page when the pressed control disappears, Stop included | `d3b9bac` |
| PL-129 | Nit | Acquire's visual details differ from the design | `ed9d3d1` |
| PL-130 | Nit | "Estimating…" shows on the refresh card while a retry is being estimated | `9656c1b` `0ffdaa7` |
| PL-131 | Low | The progress strip never says "Stopping…", counts only completed items, and announces every poll | `d1ba1c5` |
| PL-132 | Low | The shell asks for the run list every 2 seconds for as long as a tab is open | `e32157a` `7523ef2` |
| PL-133 | Nit | The progress strip draws a black bar, an ungrouped count, and slides 3 px under the tab bar | `22a9c97` |

### C10 Source priority -- 4 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-134 | Medium | Source rows show no attribute count, several name the wrong kind, and nothing says what switching one off costs | `ccc1dba` |
| PL-135 | Medium | Source priority hides per-attribute orders and maximum ages, and its lead overstates what the order decides | `ccc1dba` |
| PL-136 | Medium | One drag renumbers every source 1 to n and erases the stored priority tiers | `8a10825` `1c4bf05` `bcd25ca` `4a0c056` |
| PL-137 | Low | The arrows refuse to swap two sources that share a priority, and give no reason | `8a10825` `1c4bf05` `eecb194` |

### C11 The change history -- 5 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-138 | High | Recent changes records only a criterion's weight and lock: pillar weights and locks, rules, gates, compound rules, sets, household, sources and limits leave no entry, and "Back to where I started" leaves them changed | `52e9651` `90b1fe1` `e3ed552` `8b790b8` and 4 more |
| PL-139 | Medium | Recent changes forgets, blocks and misstates its own entries: it empties on leaving Configure, a deleted set's entries block every older undo, a half-finished undo stays listed, a pillar answer overwrites other levels, and two comments state false rules | `5ed84a1` |
| PL-140 | Medium | Recent changes is not the design's rail: no single-change undo, no preview, the withdrawn "after it" wording, raw numbers and a renamed set's old name | `c283830` |
| PL-141 | Medium | A merged entry shows only its last step while its undo goes back to the first, and lock-then-unlock leaves an entry whose undo does nothing | `7d46cc3` |
| PL-142 | Medium | A stale set read that lands before a write's answer still reaches the panels, and Rank, the sidebar, Compare and the drill-down can read a set before a Configure write lands | `4e5190c` `a813ed7` `a88ef44` |

### C12 Saved rankings and the evaluation tree -- 6 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-143 | Medium | A saved refusal keeps neither the figure a threshold judged nor the gate answer it read, and a new gate answer destroys the one it replaces | `b7ad557` `0694f44` `60eb955` |
| PL-144 | High | An opened saved ranking appears out of sight, says nothing about itself, has lost its pillars and Δ home, and no saved figure's provenance is served | `b7ad557` `adad752` `8706ccc` `3cc3c04` and 1 more |
| PL-145 | Medium | Saved rankings show no leader and cannot be deleted | `056bd6b` `8706ccc` `0fb303e` `02bfe3f` |
| PL-146 | Medium | Rank's save control is offered with nothing to save, drops keyboard focus while saving, lacks its hint, still says "Nothing is kept" after a save, and its "Try again" only dismisses | `8d51ab5` |
| PL-147 | Low | Saved contributions and evidence inputs are not pinned to their candidate, attribute and frozen criterion | `3c228d5` |
| PL-148 | Low | Frozen criteria are not constrained to their evaluation's level, nor are the frozen rule lists | `3c228d5` |

### C13 Gates and research -- 14 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-149 | Nit | A gate's concerned candidates are not checked to sit at its level, and the API's level refusal is untested | `ef236fa` `a876dc9` |
| PL-150 | Low | The Proposals panel prints raw ids, and links its pages without the URL safety check | `64c0036` `96ebcc1` |
| PL-151 | Low | The research panel never says which level a pass researches, and the proposals and rule sentences mix levels | `a968abe` `389ace1` `a4b93ba` |
| PL-152 | High | No screen lets a person record, override, correct or rule out a gate answer | `e07e132` `1403db1` |
| PL-153 | Medium | Confirmed answers keep applying whatever their period, invisibly, with no way to re-check them | `73decbb` `d2a69cc` `1e192cb` `cb846db` and 3 more |
| PL-154 | Medium | The candidate detail shows no gate answers, and the reason cell no override mark | `df37805` |
| PL-155 | Medium | Rule rows do not say what a rule tests: compound rules print raw enums, gates say only "Asked at country level." | `e53faae` `a876dc9` `4a2a32c` `9534eb4` |
| PL-156 | Medium | A rule's cost line never names whom a compound rule flags, and is red even when a rule costs nothing or is switched off | `482aeda` `636f184` |
| PL-157 | Medium | There is no gate/warning selector, so a gate cannot be softened to a warning or a warning made a gate | `9e52b32` `8730d6d` `5895a32` `ab93da2` |
| PL-158 | Low | A compound rule's kind label ignores its outcome (latent) | `ab93da2` |
| PL-159 | Low | Gate research counts every gate in its progress, while its estimate counts only the ones it will ask | `a968abe` |
| PL-160 | Low | Gate research offers "Accept an uncapped spend" even when a cap is set, never states the cap, and a missing-cap refusal loses the estimate | `9a6886b` |
| PL-161 | Low | Gate proposals show no retrieval date | `7750a52` |
| PL-162 | Nit | Stage 4 says the same thing twice, nests a heading wrongly, and its switch has no tooltip | `4a2a32c` `132a258` |

### C14 The household -- 4 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-163 | High | Net income is labelled annual; the requirements, the domain model and the design all say monthly | `0c5c736` |
| PL-164 | High | Household edits reach no gate: citizenship does not clear the citizenship gates, and nothing derives EU free movement, so that enforced gate never fires | `4522706` `95f6022` `60eb955` `1e192cb` and 11 more |
| PL-165 | Low | The household words, and the sidebar's household values, are not the design's | `9b777a0` |
| PL-166 | Low | Adults stop at 4 and children at 3, and the design documents still say "number fields" | `0c8b8a8` `6294118` |

### C15 Data integrity in SQL, and the contract -- 6 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-167 | Low | SQL checks named "finite" accept ±Infinity, and about twenty other numeric columns accept NaN or Infinity | `5bb5eba` `6917ae4` |
| PL-168 | Low | An accepted figure can lack its payload, and a share composition need not sum to 100 | `39ba551` |
| PL-169 | Low | Several share bounds collapse silently to the first, and two label thresholds make a set unreadable | `c646a1c` `6917ae4` |
| PL-170 | Low | A converted amount's rate provenance is not served, and conversion is not built end to end | `00286b8` `a566781` `1a4fdf4` |
| PL-171 | Low | External scores have no current edition, an incomplete order, and nothing that says which index a row belongs to | `b91f508` `a566781` `0069ae7` |
| PL-172 | Low | Request and response bodies, and the generated contract, disagree with the design about null | `5570515` `884c6be` |

### C16 Tooling and rollbacks -- 7 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-173 | Low | make e2e builds the copy's URL from values make read from .env, so a quoted or special password breaks it or can be printed, and compose builds its URLs from the raw password | `4834a51` `da0d969` |
| PL-174 | Low | The migration lock guards skip two SQL shapes | `0bc5c02` `51a5c98` |
| PL-175 | Low | make reads POSTGRES_DB=app#db as app | `2f5711b` |
| PL-176 | Low | Replacing an attribute's criterion drops its weight lock | `caac858` `51a5c98` |
| PL-177 | Low | Rollbacks stop on PostgreSQL's foreign-key error instead of a refusal, in seventeen places rather than the four recorded | `6171e71` `5895a32` |
| PL-178 | Medium | Eight rollbacks delete or rewrite recorded history without refusing: 0500, 0501, 0504, 0486, 0461, 0483, and 0507's frozen columns | `35734f2` `51a5c98` |
| PL-179 | Low | Rollbacks assume only the shipped sets exist, and seven overwrite user weights with literals | `41fe014` |

### C17 Docs, dead code and trackers -- 3 items

| Item | Severity | What was wrong | Commits |
|---|---|---|---|
| PL-180 | Low | Divergences the code made are not recorded in design-brief.md, and some recorded ones are out of date | `4a0c056` |
| PL-181 | Low | Dead code, and comments that mislead, including the e2e helper's claim that it waits for the server | `02bfe3f` |
| PL-182 | Low | Plan texts rely on a hook that was never built, and CLAUDE.md is wrong about an exported DATABASE_URL | `40ea960` |

## Appendix B -- after round 3

Every commit from round 3's close (`1077465`, which filed P101-P106) to `ef8c3ea`.

| Commit | Date | What |
|---|---|---|
| `1d6f0fa` | 25 Oct | test(e2e): a pillar weight moved is listed in Recent changes, and its Undo puts it back (PL-138) |
| `9f7f870` | 25 Oct | fix(ui): undoing a gate made a warning restores the gate in storage, not only on screen (P104) |
| `1a14f35` | 25 Oct | test(e2e): a spec's own set is a fresh copy per worker, and switching sets compares the whole ranking |
| `8680e7a` | 25 Oct | fix(criteria): a rebalance sums to exactly 100, and a set with an arithmetic residue reads again (P107, Q240) |
| `b429fc3` | 25 Oct | fix(ui): a Compare cell is one rounded box whose tint wraps both the figure and its bar, as designed |
| `e2a310c` | 25 Oct | fix(ui): a Compare cell's tint grows with its bar, so colour and length tell the same size |
| `ac6b020` | 25 Oct | fix(ui): a Compare gap below the noise floor draws its bar softer, however far it reaches |
| `cdc5030` | 25 Oct | test(ui): a short-versus-long bar test uses a focus both gaps clear the noise floor of |
| `ec74185` | 25 Oct | fix(compare): draw matrix cells exactly as the design does |
| `96f845f` | 25 Oct | fix(compare): deepen a cell's tint with its bar, over a visible range |
| `3833184` | 25 Oct | docs: commit the v2 planning inputs as they stood |
| `bc7d959` | 25 Oct | docs(claude): bring the repository guide up to date |
| `98a5b27` | 25 Oct | docs(arch): revise the architecture and plan for v2.0, the city level |
| `7f5b2f5` | 26 Oct | test(mocks): list every source the fixtures declare or cite (P106) |
| `efceab9` | 26 Oct | fix(configure): read an undo back as its write is read back (P101-P105) |
| `ef8c3ea` | 26 Oct | docs(known-issues): close P101-P106 |

Then this handoff, which also corrects `copilot-round3-plan.md`'s status line, adds NEW-25 and nomination Undo to the plan's open decisions, and says in `CLAUDE.md` and `devplan-v2.md` exactly what in `known-issues.md` stays open.
