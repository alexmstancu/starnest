# Knowledge transfer → the other reviewer agent (2026-10-21)

From the "larger findings" lane. My lane is **complete**; this is what landed, what it changed
that touches your lane, and what you still own. Current master: `a7a2fa8`, tree clean, `make
check` green (3,220 backend / 1,577 UI / 97.20% as of my last run).

## 1. What I shipped (all TDD, each test verified to have teeth, pushed)

| Finding | Commit | One line |
|---|---|---|
| ST-02 | `5358c3c` | concurrent criteria-set edits serialise via a server-side transactional lock |
| BE-19 | `d7a1263` | paid LLM answers commit per candidate; a mid-sweep death keeps them |
| ST-09 | `608919f` | a re-confirmed transcribed figure counts answered, not unanswered |
| ST-07 remainder | `bf47645` | a saved warning freezes the value rows behind it |
| BE-07 | `4188571` | a figure aged past its `max_age` drops one confidence grade at read |
| BE-11 + NEW-48 | `27add01` | a retry asks each source only about its own failed candidates |
| BE-31 | `a9d7929` | `arch.md` 6.1's exact import table enforced on direct imports |
| BE-33 | `a7a2fa8` | a run's spend is written per batch, so a mid-sweep death keeps it |

Plus earlier clusters (validation, weather, presenter, ST-07/08): `bf2145e`, `25c83b9`,
`f30c661`, `c943761`.

## 2. Contract/interface changes that ripple into your lane — read before you touch these

These are the places where my work changes a shared surface. If you add a fake, an adapter, a
migration or an endpoint near one of these, it must account for the change.

- **`ValueStore.record_reuse(run, data_source, pairs)` is now abstract** (ST-09). Every
  `ValueStore` fake needs it — I updated the 5 existing fakes; a *new* fake will fail to
  instantiate until it implements this. (You already amended its signature in NEW-54 to carry
  `data_source` — this is the same method.)
- **`SourceAdapter.fetch_in_batches(attribute, candidates)` exists** (BE-19), default yields
  `await self.fetch(...)` once. New adapters inherit it free. If you write a per-candidate paid
  adapter, override it to yield per candidate so a death loses one batch, not the sweep.
- **`acquire(...)` gained `record_spend: Callable[[int, Decimal], Awaitable[None]] | None`**
  (BE-33). Optional; `continue_run` passes `runs.add_spend`. Callers that don't pass it are
  unaffected.
- **`rank_candidates(..., max_age={}, as_of=None)`** (BE-07). Both optional with inert defaults;
  the ranking endpoint supplies `max_age` from the catalog. If you call `rank_candidates`
  elsewhere and want age-downgrade, pass both.
- **`RuleWarning.input_values: tuple[int,...]`** and **`judgements_of(..., value_ids)`** (ST-07
  remainder). If you construct `RuleWarning` or call `judgements_of`, supply the value ids.
- **New migrations `0500`, `0501`, `0504`** (next free number is **`0505`** — you've already used
  `0502`/`0503`). Schema-contract classifications I added:
  `data_acquisition_run_reuse` → **OBJECTIVE**, `candidate_warning_input` → **SUBJECTIVE**. A new
  table trips `test_schema_contract` until you classify it in `test_schema_contract.py`.
- **`evaluation_criterion` gained `value_type`, `weight_locked`, `matching_threshold` (jsonb)**
  and the snapshot now carries its own `value_type` (ST-07/08) — it no longer joins the live
  attribute. Raw-insert test helpers must supply the new NOT-NULL columns (I fixed
  `evaluation_rows.py` and `test_criteria_constraint_behaviour.py`).
- **`errors.py` has reusable `absent(named, known)` and `unknown_scope_refusal(level, **groups)`**
  (BE-24, 422 `unknown_scope`). Use these for any new "unknown id" refusal instead of a bespoke
  one.
- **Edit a criteria set through `criteria_store.edit_criteria_set(criteria_set, mutate)`** (ST-02),
  not a raw read-then-`replace_criteria_set`. It locks (`SELECT … FOR UPDATE` via
  `lock_criteria_set`), reads, mutates and writes in one transaction. The 5 API edit endpoints
  already route through it; a 6th edit path must too, or it reintroduces last-writer-wins.

## 3. Your shared tracker needs reconciling

In `findings-review-comparison.md` (yours), please flip to FIXED when you next run:
**ST-07, BE-07, BE-11, BE-31, BE-33** (ST-02, BE-19, ST-09 already read FIXED there). My own
`findings-remediation.md` has all of mine with commit hashes; I deliberately did not edit your
comparison doc.

Also note: four High/Medium rows in *my* doc that still read `wave-N` are in fact fixed by **your**
waves — I verified and marked them `FIXED-ELSEWHERE` on 2026-10-21: **BE-02**
(`normalisation.py:55-57`), **BE-12** (`api/runs.py:283-287,395`), **BE-22**
(`api/criteria.py:416-456`), **ST-03** (forward migration `0499`). If your doc still shows those
open, they're done.

## 4. What remains — your lane (I did not start any of these)

Per the division of labour (you: small/UI; me: larger/backend/architectural), the open backlog is
yours. From my snapshot, still open or needing your confirmation:

- **BE-36** — policy is set (a confirmed gate answer is never auto-expired; add a user-triggered,
  non-destructive re-research path and surface the answer's age). Backend already serves what the
  panel needs; stage 1 is the UI you planned. No commit yet references it.
- **Low SQL constraints:** ST-10, ST-11, ST-12, ST-13, ST-14, ST-15, ST-16, ST-17, ST-18 — most
  latent/raw-ingestion guards (a CHECK, a narrowed query). ST-04/05/06/19 (Medium, populated-
  upgrade safety) also show no commit in my view — confirm against your doc.
- **UI:** UI-18, UI-24, UI-29 and any remaining `wave-2/3` UI rows not yet in `git log`.
- **The NEW-xx tail** you were tracking.

I did **not** re-audit these — re-verifying your lane would be intersecting your work, which the
household asked us both to avoid. Defer to your comparison doc + `git log` for live status.

## 5. Gotchas I hit (so you don't)

- `make check` exit code is unreliable under zsh (empty `PIPESTATUS`); grep the log for
  `make: ***` and the pass markers instead.
- import-linter `forbidden` contracts are **transitive** — they false-positive a legitimate
  `comparison → evaluation → criteria` reach. That's why BE-31 is a direct-edge grimp test
  (`test_architecture.py`), not a contract. Don't try to express an exact-edge rule as a
  `forbidden` contract.
- A new abstract method on any store ABC (`ValueStore`/`RunStore`/`CriteriaStore`) breaks every
  fake at once — update them in the same commit.
- Criteria-set rules are **sparse (ON only)**: a migration turning a rule on must `UPSERT`, never
  bare `UPDATE`, and must not seed a false-flag row.
