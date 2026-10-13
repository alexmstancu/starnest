# Defect-prevention plan — stop the silent backlog

**Date:** 2026-10-13. **Status: draft, to refine, then implement once most of the
[findings](findings-remediation.md) are fixed.**

## The diagnosis this plan is built on

A cold, adversarial, whole-codebase review found ~90 real findings that months of build-time
reviews and a green `make check` never surfaced. The reason is one sentence:

> **Every finding lives on a surface `make check` never exercises.** The gate runs exactly one
> path — fresh database, default configuration, valid input, the LLM path off, one request at a
> time — and anything off that path rots silently alongside passing tests.

Enumerate the surfaces the backlog actually lives on, and the plan writes itself:

| Untested surface | Findings that rot there |
|---|---|
| Invalid / out-of-bounds / malformed input | BE-05, BE-06, BE-18, BE-21, BE-22, BE-23, BE-24, BE-30; ST-15, ST-16, ST-17 |
| Concurrency (two tabs, double-submit, interleaved writes) | ST-01, ST-02, ST-11; UI-04, UI-05, UI-06, UI-07, UI-08, UI-11 |
| Migrating / rolling back a **populated, customized** DB | ST-03, ST-04, ST-05, ST-06, ST-08, ST-19 |
| The paid LLM path (excluded from `make check` by design) | BE-10, BE-12, BE-14, BE-16, BE-17, BE-19; UI-01, UI-02, UI-14 |
| "Claims completeness" but truncates / drops provenance | BE-39; UI-13, UI-16, UI-17, UI-20, UI-21, UI-30 |
| Logic the happy-path test names but never *asserts the failing question* | BE-01, BE-02, BE-03, BE-04; UI-09, UI-19 |
| The safety net's own holes | BE-31, BE-32, BE-38 |

The repo already proves the cure works: `tools/audit_*.py` and `ui/src/app/architecture.test.ts`
are structural guards that "found the most," and CLAUDE.md records the lessons ("a test can name
the right example and still not ask the question that fails"; "compare two artifacts that ought to
agree"; "break the code and watch the test fail"). We applied them **reactively, after each bug**.
This plan applies them **proactively and uniformly**, as runnable checks.

**Principle:** prefer a check a build *fails on* over a habit a person must remember. Every item in
Part A is runnable and verifiable. Part B (rituals) is deliberately smaller and each ritual
produces an artifact, not a feeling.

---

## Part A — Automated, runnable checks (the bulk)

Each item: what it catches (finding IDs), the concrete tool, where it runs, and rough effort.
Speed matters, so A-items are tagged **gate** (every `make check`), **nightly**, or **milestone**.

### A1. API boundary property-fuzz from the OpenAPI contract — **gate** (fast subset) + **nightly** (full)
**Catches:** BE-21, BE-22, BE-23, BE-24, BE-18 (and surfaces BE-05/BE-06 at the edge).
**Tool:** [`schemathesis`](https://schemathesis.readthedocs.io/) driven by `docs/openapi.yaml`. It
auto-generates out-of-bounds, missing-field, wrong-type and extra-field requests for every
operation and asserts two invariants: **(1) never a 500** — a domain-invalid body must return a
clean 4xx; **(2) every response conforms to the declared schema.**
**Why it would have caught the cluster:** BE-21/BE-22 are literally "bad body → 500"; schemathesis
hits that on the first malformed request.
**Effort:** medium. Add as a pytest target `make fuzz-api` against the test app; run a bounded
subset in the gate, the full stateful suite nightly.

### A2. Request-DTO ⇄ domain validation-parity guard — **gate**
**Catches:** BE-05, BE-06, BE-21, BE-22, BE-23 (root cause: the domain rejects what the API accepts).
**Tool:** a structural pytest (like `architecture.test.ts`) that enumerates every request body
model under `api/` and asserts: (a) `model_config` has `extra="forbid"`; (b) each field that maps
to a domain field carries at least as tight a bound as the domain model (or the endpoint
constructs the domain object inside the request-validation boundary so its `ValidationError`
becomes a 422, never a 500). Pair with **A2b**: a single error-mapping test asserting that for a
curated set of domain-invalid bodies, **no endpoint returns 500** and all return the uniform
`{code,message}` body (fixing the BE-21 error-shape half too).
**Effort:** low-medium. This is the highest-leverage structural guard — it turns a 7-site cluster
into one invariant.

### A3. Mutation testing on the critical pure modules — **nightly**
**Catches the *class* of** BE-01, BE-02, BE-03, UI-09, UI-19 (tests that name the right example but
never assert the thing that fails).
**Tool:** [`mutmut`](https://mutmut.readthedocs.io/) (Python) on `evaluation/`,
`data_acquisition/spend.py`, `criteria/` weighting/rebalancing; [`Stryker`](https://stryker-mutator.io/)
(TS) on the pure UI modules (`weights.ts`, `rebalancing` mirror, `attributeRows.ts`,
`divergingBar.ts`). Set a **minimum mutation score** per module and fail nightly below it.
**Why it is the precise tool:** BE-01 is "`matching_threshold` is parsed but never read." A mutant
that deletes the threshold *would-be* check survives because no test asserts a candidate flips on
the threshold — mutation testing reports exactly that surviving mutant. It measures whether tests
*ask the failing question*, which is the root cause in #2 of the discussion.
**Effort:** medium; slow to run, hence nightly, scoped to the modules where a wrong number is
worst.

### A4. Property-based invariant tests for the domain — **gate** (bounded) + **nightly** (deep)
**Catches:** BE-02, BE-04, UI-09 (and hardens the whole scoring path).
**Tool:** [`Hypothesis`](https://hypothesis.readthedocs.io/) (Python), [`fast-check`](https://fast-check.dev/) (TS).
Assert invariants over generated inputs, e.g.: rebalancing always sums to 100 and is reversible
where the UI claims undo (kills UI-09); excluding a criterion never moves weight *between* pillars;
normalisation is monotonic in the goal direction; **no intermediate rounding changes order**
(kills BE-02 by generating two candidates whose int-rounded-then-weighted order differs from the
exact order).
**Effort:** medium; the invariants are already written in prose in `reqs.md` 5.1/5.2 and CLAUDE.md
— this encodes them as executable properties.

### A5. Populated + customized-DB migration & rollback test — **gate** (one scenario) + **milestone** (matrix)
**Catches:** ST-03, ST-04, ST-05, ST-06, ST-08, ST-19.
**Tool:** a pytest harness that (1) migrates a fresh DB to version N−k, (2) seeds a **customized**
state — a duplicated criteria set, edited weights, a locked criterion, a `target_range` criterion,
a user anchor/threshold child, and a saved evaluation, (3) applies the remaining migrations, and
asserts the customized state survives and no migration blocks; then (4) runs each new migration's
`.rollback.sql` on that populated state and asserts it completes. Today `make check` migrates a
*fresh* DB, which is exactly why ST-03/19 (unscoped DELETE; rollback vs run-scope FK) never fire.
**Effort:** medium-high; the single most valuable new suite, because the migration hazards are the
findings most likely to bite *you* on a real upgrade.

### A6. Concurrency tests — **gate**
**Catches:** ST-01, ST-02, ST-11; the server half of UI-07.
**Tool:** `asyncio.gather` two conflicting operations against the real test DB and assert the
invariant: two concurrent `POST /runs` → at most one running run; two concurrent set edits →
detected conflict, not silent last-writer-wins; polling `read_run` mid-write → counts consistent
with their lists. (These also validate the fixes for ST-01/02's remediation — an advisory lock /
version token.)
**Effort:** low-medium.

### A7. LLM-path replay harness inside `make check` — **gate**
**Catches:** BE-10, BE-14, BE-16, BE-17, BE-19 (and the metering/cap logic generally).
**Tool:** a recorded-response fixture layer (the shapes `make live-llm` already captures) so the
**paid-path control logic runs in the free gate**: meter forwarding on retry (BE-10), cap=0 halt
(BE-16), billed-empty answers advancing the cap (BE-17), per-candidate death durability (BE-19),
the unrelated-paid-adapter cap decision (BE-14). `make live-llm` stays the only thing that spends;
this exercises the *logic* for free. The paid path being excluded from the gate is precisely why
its cluster is the largest.
**Effort:** medium; much of the recording machinery exists.

### A8. Arch-boundary enforcement generated from the arch.md table — **gate**
**Catches:** BE-31 (and prevents future boundary erosion).
**Tool:** replace the coarse `import-linter` *layers* contract with **per-module forbidden
contracts derived from the `arch.md` 6.1 dependency table**, plus a test that the `import-linter`
config matches the table (so they cannot drift). BE-31 exists because the layers ordering permits
`comparison → criteria` even though the table forbids it; a forbidden-contract per disallowed pair
closes it and makes "exhaustive" true.
**Effort:** low-medium.

### A9. Semantic contract assertions (not just schema validity) — **gate**
**Catches:** BE-39; UI-16, UI-17, UI-20, UI-21, UI-30 (the "schema-valid but semantically wrong/
incomplete" class).
**Tool:** extend the acceptance suite so it asserts **resolved, complete** shapes, not merely
schema conformance: `effective_source_priority` returns the *full* resolved order (BE-39 slipped
because an empty array is schema-valid); any response whose prose claims "every/all" must either
return all rows or expose pagination (UI-16/17); a figure's row must carry its provenance fields
(UI-20). Encode as explicit assertions keyed to the contract's own wording.
**Effort:** medium.

### A10. Patch the safety net's own holes — **gate**
**Catches:** BE-32, BE-38 (these are guards that don't guard).
**Tool:** (a) fix `tools/audit_coverage.py` to enforce **line and branch floors separately** per
package (BE-38 is itself this bug); (b) a guard test that a bare `uv run pytest` collects **zero**
`live`/`live_llm` items (BE-32); (c) adopt the principle **"every guard has a test that it fails
when the thing it guards is broken"** — the mutation suite (A3) partly enforces this for logic.
**Effort:** low. Do these first; they are small and they restore trust in the gate.

### A11. Frontend stale-state & provenance lint/test discipline — **gate**
**Catches:** UI-04, UI-05, UI-06, UI-07, UI-08, UI-11 (concurrency/stale) and UI-13/20/21/30
(provenance in keys/display).
**Tool:** (a) a shared `useMutation`-style wrapper carrying a **request/selection generation
guard**, plus an `architecture.test.ts` rule that mutation `.then` handlers in `routes/` go through
it (so a raw unguarded `.then(setState)` fails the build); (b) a lint/test that a React list `key`
and a displayed-provenance block include the full identity (period end, retrieval date) wherever a
figure is shown. Extends the existing proven `architecture.test.ts` pattern.
**Effort:** medium; the backend A6 covers the persisted half, this covers the client half.

---

## Part B — Workflow rituals (smaller, each produces an artifact)

These are the "do it differently" changes, made concrete so they are checkable, not mental.

### B1. Milestone cold adversarial review — **at each gate close, not only the end**
A full-codebase, spec-based, independent review (like the one that produced
`findings-remediation.md`), run at each milestone rather than accumulating to the end. **Capped at
2 parallel agents** per the standing credit rule; the lead adjudicates sequentially. **Artifact:** a
dated verdict file in `docs/`. This is the single biggest process lever — had it run at each gate
close, the backlog would have surfaced in tens, not ~90.

### B2. Non-author, spec-based test pass per module
For each module, a deliberate sad-path/boundary/concurrency test pass written **against `reqs.md`/
`arch.md`, by a different agent than the one that built it.** The author's tests encode the
author's assumptions; the spec is the independent oracle. **Artifact:** the tests themselves, plus
a one-line note in the module of who wrote the adversarial pass.

### B3. Definition-of-done checklist additions (enforced in review)
Add to `devplan.md` 0.4's definition of done, as explicit checklist items: **"break the code and
watch the test fail"** (a fix without a test that fails before it is not done), **"compare two
artifacts that must agree"** (any two things that must stay in lockstep get a structural guard),
and **"name the trigger surface"** (which of the untested surfaces above does this touch, and is
it exercised?).

### B4. A living latent-gap ledger
Keep `known-issues.md` as the authoritative ledger of accepted latent/deferred gaps, each with its
trigger and the decision to defer. A latent finding that is *recorded* is a decision; an unrecorded
one is a surprise. **Artifact:** the ledger, referenced from `findings-remediation.md`.

---

## Part C — How it plugs in (speed-aware)

| Runs on | Checks |
|---|---|
| **Every `make check` (fast)** | A2, A8, A10, A6 (bounded), A4 (bounded), A9, A11; plus a bounded A1 subset |
| **Nightly / pre-push (slow)** | A1 (full stateful fuzz), A3 (mutation), A4 (deep), A5 (full matrix), A7 full |
| **Each milestone** | A5 matrix, B1 cold review |

Rationale: mutation testing and stateful fuzzing are slow, so they do not belong in the inner loop;
the structural guards (A2, A8, A10) are near-instant and belong in every gate. This mirrors how
`make live` is already separated from `make check`.

## Part D — What each check would have caught (proof it addresses *this* backlog)

| Check | Findings it would have caught before they shipped |
|---|---|
| A1 API fuzz | BE-21, BE-22, BE-23, BE-24, BE-18 |
| A2 DTO parity | BE-05, BE-06, BE-21, BE-22, BE-23 |
| A3 mutation | BE-01, BE-02, BE-03, UI-09, UI-19 (as surviving mutants) |
| A4 property | BE-02, BE-04, UI-09 |
| A5 populated migration | ST-03, ST-04, ST-05, ST-06, ST-08, ST-19 |
| A6 concurrency | ST-01, ST-02, ST-11, UI-07 (server half) |
| A7 LLM replay | BE-10, BE-14, BE-16, BE-17, BE-19 |
| A8 arch boundary | BE-31 |
| A9 semantic contract | BE-39, UI-16, UI-17, UI-20 |
| A10 safety-net | BE-32, BE-38 |
| A11 FE discipline | UI-04, UI-05, UI-06, UI-08, UI-11, UI-30 |

That accounts for the large majority of the 91 directly, and the *classes* of the rest.

## Suggested order of implementation (after the fixes land)

1. **A10 + A8 + A2** — cheap structural guards; restore trust in the gate and close three clusters.
2. **A1 + A9** — API boundary fuzz and semantic contract; close the validation/completeness clusters.
3. **A6 + A5** — concurrency and populated-migration; close the two highest-real-risk surfaces.
4. **A7** — LLM-path replay; bring the paid path into the free gate.
5. **A4 + A3** — property and mutation; the deepest, slowest, run nightly.
6. **A11**, then **B1-B4** as standing rituals.

Everything here is a draft to refine with Alex; the finding-ID mappings are grounded in
`findings-remediation.md` at baseline `7182d37`.
