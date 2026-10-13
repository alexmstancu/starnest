# Third adjudication: BE-11 and BE-13

**Date:** 2026-10-12
**Baseline:** `7182d376ebb1d59cfff984b9f3d2a646303d23c3` (no tracked changes)
**Adjudicator:** Claude Opus 5, maximum reasoning effort, fresh context
**Scope:** BE-11 and BE-13 only. BE-36 is the parent's; it is not reviewed here.

**Method.** Independent adversarial synthesis, not majority voting and not a restatement of
either verification report. For each finding I read the original allegation in
`copilot-review.md`, both verification arguments, the authoritative documents
(`reqs.md`, `arch.md`, the handwritten `openapi.yaml`), the current implementation, the current
registry composition, the storage queries and migrations, the relevant tests, and the repository's
own defect record (`known-issues.md`). Where the two reports rest on conflicting readings of
intent, I dated the conflicting texts with read-only `git blame`/`git log -S`, because several of
them were written on either side of the day the first paid source existed.

**No execution.** No test, build, lint, typecheck, generator, migration, service, database,
publisher or paid call was run; no application code was imported or executed. Nothing was staged
or committed. Test citations state **what a test asserts**, never that it currently passes. No
live configuration, `.env`, secret or database content was inspected, so every reachability claim
below is stated with its configuration precondition. The only file this review writes is this one;
`copilot-review.md`, `gpt-6-astra-findings-review.md`, `claude-opus-5-findings-review.md` and
`findings-review-comparison.md` are unchanged.

| finding_id | original_severity | verdict |
|---|---|---|
| BE-11 | Medium | REAL |
| BE-13 | Medium | UNREAL |

---

## BE-11 — selective retries expand exact items into Cartesian products

### The original claim

`copilot-review.md:378-386`. Failures `(source A, candidate X, attribute 1)` and
`(source B, candidate Y, attribute 2)` become two global sets — all failed candidates, all failed
attributes — and the retry asks their product. The wrappers narrow **attributes** per source and
never candidates, so pairs that succeeded or were never requested are fetched as well; the
unanswered retry expands the same way. Claimed consequences: extra successful/unrequested work,
possible paid work, and a mismatch with the intended selective scope. Remedy proposed: preserve
per-source/per-attribute candidate sets and exact unanswered pairs, "as required by `reqs.md` 6.4".

### Astra's counterargument (UNREAL)

`gpt-6-astra-findings-review.md:632-642`. The handwritten target deliberately defines the
supported approximation: `openapi.yaml:789-792` says the failed retry's scope is "the smallest
covering the failures — every failed candidate against every failed attribute", with source-specific
attribute narrowing. That is an explicit design statement, not a generated restatement of
accidental code, so the implementation is conformant; `ask_again` is "consistent with the two-list
scope model, though the target is less explicit about that subcase"; and the outdated
"free bulk source" rationale is a design revision to consider, not proof of a violation.

### Prior Opus argument (REAL)

`claude-opus-5-findings-review.md:1181-1207`. `reqs.md` 6.4's "only what failed" governs; the
expansion is proven from `execution.py:495-505` and `:601-606`; where the expanded source charges
per candidate the extra pairs are billed, and `retry_run`'s own docstring rationale (extra pairs
are free because each source answers a whole indicator per request) is true of the structured
adapters and false of the paid per-candidate ones.

### Authoritative evidence that resolves their conflict

The dispute is entirely about whether one sentence in the handwritten contract is an informed
permission. Four facts decide it, and the first three are independent of either report.

**1. The contract sentence is outnumbered, not isolated-but-authoritative.** Four authorities
describe the retry scope as the exact failures:

- `reqs.md:1922-1926` (§6.4, requirements authority): "a single action retries **only what failed**".
- `arch.md:710`: "`/data-acquisition-runs/{id}/retry` | create | Retries only what failed".
- `arch.md:846-848`: the retry "creates a **new run** whose scope is **exactly the failures** of
  the referenced one", immediately after `arch.md:834-835`, "Selective retry then knows exactly
  what is missing without comparing anything".
- `storage/migrations/0004-data-acquisition.sql:48-49`, on the failure table: "the
  `(candidate, attribute)` pair is **exactly the unit selective retry needs**" — the storage was
  shaped to make exact-pair retry expressible, and the failure table does store the pair
  (`:50-54`, both columns `NOT NULL`).

Against these, one paragraph — `openapi.yaml:789-792` — sanctions the rectangle. No decision record
sanctions it: `reqs.md` Appendix B has no Q-number for it, and Q217 (`reqs.md:3243`), which created
the unanswered act, speaks of "a record of the unanswered **items** so they can be asked again".

**2. The sanction predates the first per-candidate paid source by about four hours, and its
companion rationale says so explicitly.** `git blame` dates `openapi.yaml:787-797` to `808c970`,
2026-09-12 **14:34**; the LLM path landed in `4746d2a`, 2026-09-12 **18:33** (`808c970` is an
ancestor of `4746d2a`). The same design's rationale in code, `execution.py:481-485` (from
`f37947e`, 2026-09-11), states the premise outright: "Asking a source about a candidate that did
not fail **costs nothing extra — every source here answers a whole indicator in one request** — and
stores one more observation of a figure already held." That premise was true when written and false
the same evening.

**3. The one later decision that did examine retry spending did not revisit it.** P42
(`3642322`, 2026-09-17; `known-issues.md:402`) reviewed this exact function for money, added
`spend_cap_eur`/`uncapped_is_accepted` and the contract's `accept_uncapped_spend`
(`openapi.yaml:810-818`), and edited `execution.py:511-519` — the lines **immediately below** the
falsified premise, which it left standing. So the rectangle has never been affirmed by anyone who
knew a source could bill per candidate. An omission in a later review is not ratification.

**4. The structural defence does not bind what is asked.** `freshness.py:7-12` records the real
constraint — "A run's scope is a rectangle: a list of candidates and a list of attributes" — and
that is a constraint on the **recorded scope** (`data_acquisition_run_candidate` and
`data_acquisition_run_attribute`, migration `0004:32-46`). It is not a constraint on what each
source is asked: `_AskedOnlyAbout` (`execution.py:532-564`) already narrows one axis per source
while the recorded scope stays a rectangle. "The scope is recorded as two lists"
(`openapi.yaml:791-792`) therefore explains the record, not the asking.

### Independently traced code

- `api/runs.py:344-387` — the retry endpoint reads the whole level catalog and the whole roster
  (`:346-347`), filters to switched-on sources (`:360`), and hands both to `ask_again` (`:363-373`)
  or `retry_run` (`:376-386`). It passes **no** `refetch_older_than`, unlike `start_run:281`.
- `execution.py:495-497` — `failed_on` is keyed by source; `wanted_candidates` and
  `wanted_attributes` are two independent unions over **all** failures.
- `execution.py:498-505` — `attributes` and `candidates` are filtered by those unions separately;
  the pairing is discarded here and nowhere reconstructed.
- `execution.py:532-564` — the wrapper forwards `data_source`, `costs_money`, `estimate_for`,
  a narrowed `attributes` (`:559-561`) and `fetch` (`:563-564`). `fetch` forwards the **candidate
  list it is given**, unfiltered.
- `execution.py:601-606` — `ask_again` does the same over `run.unanswered`: two unions, two filters.
- `run.py:67` — `acquire` filters attributes to `adapter.attributes` (so per-source attribute
  narrowing works) and `run.py:87-90` calls `adapter.fetch(attribute, candidates)` with the full
  candidate list for every attribute.
- `storage/queries/runs.sql:217-239` — `select_run_unanswered` returns **exact pairs**: every scope
  pair with no value row and no failure row. The expansion in `ask_again` therefore destroys
  information the database had already computed exactly.
- `execution.py:372-391` (`_item_by_item`) — a failure with no candidate (a whole source
  unreachable; `catalog-blockers.md` item 5 records OECD's Cloudflare challenge as routine) is
  recorded against **every candidate in the run**. This is the ordinary way `wanted_candidates`
  becomes the entire roster.
- `execution.py:116-120, 157-162` — the new run's `answerable`/scope, and so its `items_total`, are
  the expanded rectangle.
- Paid, per-candidate billing: `employers.py:106,132` and `fallback.py:127,149` loop candidates
  inside one `fetch`; `employers.py:77-79`, `fallback.py:99-100` declare `costs_money = True`;
  `employers.py:81-87`, `fallback.py:102-108` price **one call per item**.
- Registry: `main.py:396-405` registers `LlmEmployersAdapter` whenever the LLM path is configured;
  `main.py:356-393` registers `LlmFallbackAdapter` for attributes nothing else covers.

### Tests (what they assert only)

- `test_retry.py:157-198` — every retry fixture is one candidate (`PORTUGAL`) and one attribute
  (`THE_SCOPE`), so the union cannot differ from the pairs. The suite **cannot** observe expansion.
- `test_retry.py:281-287` — `test_it_still_narrows_the_attributes_to_what_failed` asserts the
  wrapper's `attributes` narrowing. There is no candidate-side counterpart.
- `test_retry.py:290-342` — asserts that a retry and an ask-again of a paid source are refused
  without a cap, proceed under one, and may be accepted uncapped. These assert **ceilings**, never
  which pairs are asked.
- `test_ask_again.py:189-202, 242-249` — `test_only_the_items_nobody_answered` passes two candidates
  and two attributes, supplies **one** unanswered pair, and asserts the opened scope is that pair.
  Its docstring states the intended property — "Portugal answered and overcrowding answered;
  neither is asked about again" — which the code satisfies only in this degenerate single-pair case.
- `test_ask_again.py:251-261` — asserts every capable source is asked (the branch's intended
  source-side behaviour, not its pair-side behaviour).

### Proof

1. Let the earlier run's failures be `(A, X, a)` and `(B, Y, b)` with `X ≠ Y`, `a ≠ b`.
2. `execution.py:495-497` yields `failed_on = {A: {a}, B: {b}}`, `wanted_candidates = {X, Y}`,
   `wanted_attributes = {a, b}`.
3. `execution.py:498-505` opens a run over candidates `{X, Y}` and attributes `{a, b}`.
4. `acquire` (`run.py:67,87-90`) asks `A` about `a` for `[X, Y]` and `B` about `b` for `[X, Y]`.
5. Pairs `(Y, a)` and `(X, b)` are fetched although neither failed. The expansion is therefore
   proven from the code, independently of either report; both reports agree on this step.
6. The same argument applies verbatim to `ask_again` at `:601-606`, where step 1's inputs are
   *unanswered* pairs. There the complement of the diagonal consists of pairs that **did** produce
   a value or a failure in the earlier run — so the act described as "asking again about the items
   that produced neither a figure nor a failure" (`openapi.yaml:794-795`;
   `execution.py:585`) demonstrably re-asks items that produced one or the other.

**Counterexample with money, in the current registry.** Precondition: the LLM path configured
(`ANTHROPIC_API_KEY`, prices and `LLM_INPUT_TOKENS_PER_CALL` set — `main.py:408-441`), which is an
explicitly supported configuration. The run must name attributes, which is what makes the paid
adapter eligible at all (`execution.py:412-427`).

1. `POST /data-acquisition-runs {"level":"country","attributes":["country.international_employers",
   "<an OECD attribute>"], "accept_uncapped_spend": true}` over the 32-country roster.
2. OECD is Cloudflare-challenged and fails as a whole source (candidate `None`), which
   `_item_by_item` (`execution.py:372-391`) records as 32 failure rows.
3. The employers adapter answers 31 countries and fails on one — an ordinary outcome:
   `employers.py:149-164` (provider unavailable), `:170-174` with `_the_employers_named`
   (`:183-206`: ungrounded answer, unreadable JSON, wrong shape) all produce a **per-candidate**
   failure.
4. `POST /data-acquisition-runs/{id}/retry` → `wanted_candidates` = all 32,
   `failed_on[llm] = {country.international_employers}`.
5. `acquire` asks the employers adapter that attribute for all 32 candidates
   (`run.py:87-90`; `employers.py:132`): **31 billed calls for candidates that did not fail**, each
   producing a second low-confidence observation of a `LabelSet` already stored.

**No effective prevention exists.**
- The cap bounds the **total** of a run; it does not restrict a run to the work asked for
  (`spend.py:77-93`, `execution.py:185-189, 288-296`). Accepting an uncapped retry removes even
  that bound.
- The freshness filter — the one mechanism that would skip a just-answered attribute — is not
  wired into this path: `api/runs.py:344-387` passes no `refetch_older_than`, so `open_run` takes
  its `None` default and `still_fresh_everywhere` (`freshness.py:38-39`) returns an empty set.
  Independently, it is whole-attribute, so it could not express the per-pair skip anyway.
- No estimate exists for a retry: there is no retry plan operation in the contract, and
  `planRun` (`api/runs.py:161-203`) prices a *requested* scope, not a derived one.
- The two-list storage shape is not a prevention, per authoritative evidence (4) above.

### Partial validity, and what this verdict does not say

Astra's reading of `openapi.yaml:789-792` is **correct as text**, and I adopt it for one
configuration: with the shipped all-free registry (no Anthropic key — `main.py:411-413`), the
`failed`-branch rectangle is explicitly permitted protocol, every adapter answers a whole indicator
per request, and the only cost is a duplicate stored observation and a larger `items_total`. In
that configuration this finding should **not** be read as a defect, and the original report's
"possible paid work" wording is appropriately conditional rather than overstated.

What the single sanctioning sentence cannot carry is the rest of the allegation:

- it was written before any source billed per candidate, and its own companion rationale conditions
  its harmlessness on bulk fetching that the LLM adapters do not do;
- it is contradicted by the requirements document, by the architecture document twice, and by the
  storage design comment that exists to make exact-pair retry possible;
- it does not cover the `unanswered` branch at all. `openapi.yaml:794-797` names *the items that
  produced neither a figure nor a failure*; the database computes exactly those items
  (`runs.sql:217-239`); the function's own docstring and the test named
  `test_only_the_items_nobody_answered` both state the exact-item property; and the code expands
  them anyway. Astra conceded this subcase ("the target is less explicit about that subcase") and
  still labelled the whole allegation UNREAL — which is using a fragment that covers one branch to
  dismiss a claim that spans two.

Residual uncertainty, stated plainly: whether the `failed`-branch rectangle should be **re-decided**
or merely **re-scoped to free sources** is a product choice this review does not make, and the
verdict does not depend on it. The verdict rests on the expansion being real on both branches,
unsanctioned on one of them, and materially costly on a configuration the product supports.

**Verdict:** REAL — Medium. Scoped: with an all-free registry the `failed`-branch rectangle is
contract-sanctioned and near-harmless; with the LLM path configured the expansion bills calls for
candidate/attribute pairs that never failed, and the `unanswered` branch re-asks pairs that were
answered in no configuration's sanction at all.

---

## BE-13 — unanswered retry loses the original paid-source eligibility decision

### The original claim

`copilot-review.md:394-402`. All enabled adapters are passed to ask-again without retaining the
original free sweep's exclusion of paid sources. The report itself qualifies the claim twice: the
current registry **cannot** bill the LLM on a free sweep's unanswered attributes, and its
demonstrated effect is an erroneous cap eligibility/refusal that **overlaps BE-14**; unexpected
billing is conditional on a future or custom overlapping registry.

### Astra's counterargument (UNREAL)

`gpt-6-astra-findings-review.md:656-666`. `openapi.yaml:794-797` defines ask-again as asking every
source that can answer, not the original subset; `:811-817` requires fresh uncapped agreement;
Q220 forbids remembering uncapped permission. The current fallback excludes every
structured-declared attribute (`main.py:379-387`) and the employers adapter does not overlap a free
sweep's answerable scope, so the asserted billing path does not exist. The remaining cap refusal is
BE-14's registry-membership test.

### Prior Opus argument (REAL)

`claude-opus-5-findings-review.md:1234-1263`. Q220 says a paid source is asked only when a run names
its attributes; start applies it (`api/runs.py:259-260`), the unanswered branch does not
(`:360-365`), and nothing persisted could reconstruct the decision. Demonstrated effect: a 409
`spend_cap_not_set` on an ask-again over a free sweep, or accounting against a cap it should not be
subject to. Billing risk conditional, as the report says.

### Authoritative evidence that resolves their conflict

**1. The repository's own defect record already raised this exact observation and answered it
deliberately.** `known-issues.md:402` (P42) states the problem as: "Neither retry nor ask-again is
ever given the spend cap … **It also skips `asked_this_run`, so 'a paid source is asked only when a
run names its attributes' is not applied on this path.**" It then names the very symptom BE-13
demonstrates: "with a cap unset (its shipped state) `POST .../retry {"items":"unanswered"}` dies
with 409 `spend_cap_not_set` and `RetryBody` carries no `accept_uncapped_spend` to get past it —
**the feature is unreachable**". The recorded remedy is **not** to re-apply `asked_this_run`: it is
to give both acts the cap, read settings as `start` does, and add per-request acceptance. The harm
identified was the dead end, not the paid source's admission. `docs/todos.md:96` confirms the
closure. This is an explicit, informed decision about precisely this code path.

**2. It is chronologically later than the paid path, unlike BE-11's sanction.** The comment at
`execution.py:612-613` — "It asks *every* source that can answer rather than the one that failed,
so **if anything it reaches a paid source more readily than a retry does**" — is blamed to
`3642322`, 2026-09-17, five days after the LLM path (`4746d2a`, 2026-09-12 18:33). The author who
wrote it was reasoning about paid retries at that moment. This is the opposite situation to
BE-11, where the sanction predates the first paid source by four hours and its premise was
falsified the same evening.

**3. The handwritten contract says the same thing, and pairs it with renewed consent.**
`openapi.yaml:794-796`: "There is no source to narrow to, because no source failed: **every source
that can answer those attributes is asked**." `openapi.yaml:810-818` requires
`accept_uncapped_spend` per request because a retry "takes the same acceptance a first run takes
rather than inheriting the one already given".

**4. Q220 is satisfied on its own terms, and its *refusal* clause points the other way.**
`reqs.md:3246`: an uncapped acceptance is "a sentence about one run", and "remembering it would turn
a deliberate act into a default". Q220's paid-source clause conditions asking on *a run naming its
attributes*; an ask-again run does name them — `execution.py:605` narrows the catalog to the earlier
unanswered attributes, and that narrowed list is what `open_run` records as the run's scope
(`:157-162`). The finding's proposed remedy — inherit the earlier request's unscoped-ness — is the
inheritance of a financial decision across runs that Q220 explicitly declines for its sibling case.

**5. No requirement anywhere persists the original eligibility.** `reqs.md` §6.2-6.4
(`:1914-1926`), §6.10's LLM inventory, `arch.md:846-849`, and the contract contain no statement that
a derived run inherits the eligibility of the run it derives from. `data_acquisition_run`
(migration `0004:5-22`) has no column recording whether a request named attributes, and the scope
tables record the *answerable* attributes, not the request's shape — so the remedy would require new
persistence to serve a rule no document states.

### Independently traced code and the current registry

- `api/runs.py:259-260` — start applies `asked_this_run(consulted, attributes_named=scope.attributes
  is not None)`. `api/runs.py:360-365` — the unanswered branch passes `consulted` directly. The
  report's factual observation is **confirmed**.
- `execution.py:412-427` — `asked_this_run` returns the adapters unchanged when `attributes_named`
  and drops `costs_money` adapters otherwise. Note the consequence for the proposed fix: calling it
  from `ask_again` with `attributes_named=True` — the accurate description of a run whose scope
  names attributes — is a **no-op**. There is no forgotten call here; there is a policy choice.
- `execution.py:498-519` — the `failed` branch needs no such rule: a source that was never asked
  cannot have failed, so it cannot enter `failed_on`. The asymmetry the finding notices is
  structural, and the contract explains it.
- Disjointness of the current registry, traced end to end:
  `open_run:116-120` computes `answerable` from **the adapters it is given**, and `:157-162` records
  exactly those attributes as the run's scope. On an unscoped sweep those adapters exclude every
  paid one. `runs.sql:217-239` derives `unanswered` **from the recorded scope**. Therefore a free
  sweep's unanswered attributes are all free-adapter-declared attributes.
  `country.international_employers` is declared only by `employers.py:44,89-91` — a repository-wide
  search for that identifier outside `data_sources/llm/` returns nothing — and
  `LlmFallbackAdapter` is constructed with attributes **no registered adapter declares**
  (`main.py:379-387`), additionally excluding retired and manual-entry attributes. Hence no paid
  adapter can answer a free sweep's unanswered attribute; `acquire`'s filter (`run.py:67`) leaves
  its `answerable` list empty and `fetch` is never called, so no call is billed.
- The cap gate that governs whatever is admitted: `execution.py:185-189` → `spend.py:77-93`.

### Tests (what they assert only)

- `test_ask_again.py:251-261` asserts that **every capable source is asked** — the behaviour the
  finding calls a loss is the behaviour a test pins as intended.
- `test_retry.py:325-342` asserts that an ask-again through a paid source is refused without a cap
  and proceeds under one — i.e. the design expects ask-again to reach paid sources and governs it
  with the cap.
- `test_llm_path_api.py:203-247` asserts that a retry is refused 409 `spend_cap_not_set` without a
  cap, accepted with `accept_uncapped_spend` in **its own** request, and accepted under a cap the
  household has set — the renewed-consent protocol, end to end.
- `test_llm_path_api.py:126-154` asserts that an unscoped sweep whose only source charges is refused
  `nothing_to_fetch`, and that the plan counts the same sources the run would ask — Q220's rule on
  the path it governs.

### Disproof

1. The factual half is true: `ask_again` receives the full switched-on registry and nothing
   persists the earlier request's shape. Confirmed at `api/runs.py:360-365` and migration `0004:5-22`.
2. The behaviour is **explicitly intended**: stated in the handwritten contract
   (`openapi.yaml:794-796`), stated in code by the commit that introduced paid-retry governance
   (`execution.py:612-613`, 2026-09-17), asserted by a test (`test_ask_again.py:251-261`), and
   recorded in the project's defect log as a path whose spending answer is the cap plus per-request
   acceptance (`known-issues.md:402`). Under the rubric, that is "explicitly permitted intended
   behavior".
3. The billing consequence does **not** follow in the current registry: proven disjoint above, and
   conceded by the original report itself. There is no reachable current-registry trace, so no
   present unplanned billing is claimed here.
4. The only demonstrated present consequence — 409 `spend_cap_not_set`, or free work accounted
   against a cap — follows from `execution.py:186`'s `any(adapter.costs_money for adapter in
   adapters)` over registry membership. That is BE-14's root cause verbatim. Remedy test: fixing
   BE-14 (compute eligibility from the work actually selected) removes this symptom entirely, since
   the paid adapters overlap none of the unanswered attributes; fixing BE-13 as proposed leaves
   BE-14's explicit-scope refusal standing. The symptom is therefore a **subset** of BE-14, not an
   independent defect.
5. The residual claim — that an ask-again should inherit the earlier run's free-sweep eligibility —
   is a product preference contradicted by (2), unsupported by any requirement (authoritative
   evidence 5), and requiring persistence the schema does not have. Where a future or custom
   registry does put an overlapping paid source in range, the design's answer is already written:
   the run refuses without a cap and the refusal can be accepted past, per request. Whether that
   acceptance should additionally be preceded by an estimate is **UI-02**, not this finding.

### Uncertainty

Low. The one point of genuine interpretive tension is whether "a run names its attributes" (Q220)
means *the request named them* or *the run's scope names them*. The code's start path uses the
first; the ask-again path's scope satisfies the second. I did not need to settle it: under either
reading the behaviour is explicitly documented and consent-gated, and under the first reading the
proposed remedy still requires persistence no document asks for. No live configuration was
inspected, so the disjointness argument is a property of the registry construction in `main.py`,
not an observation of a running system — if a deployment registered a custom paid adapter
overlapping structured attributes, the *intended* behaviour above would apply and spend under cap
or explicit acceptance.

**Verdict:** UNREAL — as a distinct defect. The factual observation is accurate, but the behaviour
is explicitly intended and post-dates the paid path; the billing consequence is unreachable in the
current registry; and the demonstrated cap-refusal symptom is BE-14's, which stands on its own.

---

## Separating the adjacent accepted defects

Both models mark BE-10, BE-12 and BE-14 REAL, and the comparison table records that. None of them
proves or disproves either claim adjudicated here, and the verdicts above do not rest on any of
them.

- **BE-10 (retry wrappers do not forward the running cost meter).** `_AskedOnlyAbout`
  (`execution.py:532-564`) forwards five members and inherits the no-op `meter_with`
  (`adapter.py:101-124`), so `run.py:84-85`'s hand-off never reaches the wrapped adapter. This is
  about whether the cap can **stop** paid work mid-sweep. BE-11 is about **which pairs are asked**.
  They compound — the surplus calls in BE-11's counterexample are additionally unmetered — but each
  is real on its own: fixing BE-10 would still bill the 31 surplus calls up to the cap, and fixing
  BE-11 would still leave an unmetered sweep of the pairs that genuinely failed.
- **BE-12 (retry blocks despite 202 and omits the in-flight guard).** `api/runs.py:362-387` awaits
  `ask_again`/`retry_run` inline and never calls `runs.run_in_flight()`, unlike `:250-287`. That is
  lifecycle and concurrency on the same endpoint; it changes nothing about scope selection or paid
  eligibility, and neither adjudicated claim needs it.
- **BE-14 (unrelated paid adapters make free explicit work require a cap).** `execution.py:185-189`
  asks `any(adapter.costs_money for adapter in adapters)` without intersecting
  `adapter.attributes` with the run's scope, while `plan_run` (`api/runs.py:190-195`) correctly
  prices only overlapping work. This is the **sole** cause of the only present symptom BE-13
  demonstrates, which is why BE-13 is not independently real — and it is **not** evidence for BE-11,
  whose counterexample involves a paid adapter doing genuine, overlapping, billed work rather than a
  mis-set eligibility flag.
- **UI-02 (whole-bucket retry starts without an estimate or confirmation)** owns the
  "the household was not told what this would cost" half of any retry-spending concern
  (`reqs.md:1916-1920`, §6.3). Neither verdict above borrows from it: BE-11's harm is work nobody
  asked for even when the spending is consented to, and BE-13's hypothetical future harm would be
  disclosed or not disclosed by UI-02's mechanism, not by eligibility inheritance.

An adjacent real bug is not transferable evidence. BE-11 stands on the expansion traced in
`execution.py:495-505` and `:601-606` against four authoritative statements of exact-item scope;
BE-13 falls on an explicit, post-paid-path, consent-gated design decision plus a disjoint registry.

---

## Result

| finding_id | original_severity | verdict |
|---|---|---|
| BE-11 | Medium | REAL |
| BE-13 | Medium | UNREAL |

No blockers. Both cases were decidable from the documents, the current code, the current registry
composition and the tests, without executing anything. No remediation is proposed and no code,
test, configuration, data or other documentation was changed.
