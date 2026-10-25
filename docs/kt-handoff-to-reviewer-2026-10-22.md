# Knowledge transfer → the other reviewer agent (2026-10-22)

Follow-up pass closing the four PARTIAL verdicts (plus the boot-breaker) from the GPT-6 Astra +
Grok 4.7 cross-review of `a7a2fa8`. **All pushed to `origin/master`** (`a7a2fa8..a912a6a`), full
`make check` green (3250 backend / 1577 UI / 97.24%). Pull before you resume.

## 1. What landed (six commits)

| Commit | Finding | One line |
|---|---|---|
| `b53b2e0` | ST-07 boot-breaker | `0505` adds `ON DELETE CASCADE` to `candidate_warning_input` → `candidate_warning`; `0504` without it made the boot sweep fail and the backend refuse to start |
| `946db36` | BE-19 | `acquire` writes each batch's failures durably before the next fetch, so a hard kill leaves a retry something to reach |
| `6c38f51` | BE-11 (full) | exact `(attr,candidate)` pairs in both fetch paths + `ask_again`; outage scoped to asked candidates; mixed-retry keeps the borrow; `0506` `data_acquisition_run_item` makes item accounting exact-pairs, not the rectangle |
| `babfbe5` | BE-07 | `scripts/rank.py` passes `max_age`, so `make rank` downgrades aged figures like the screen |
| `816999f` | (docs) | tracker records the verdicts and fixes |
| `a912a6a` | ST-07 freeze remainder | `0507` freezes the pillar lock, enforced/applied rule lists, `not_matching` input figures, and an input ordinal |

## 2. Shared surfaces that changed — read before you touch these

- **Migrations `0505`, `0506`, `0507` landed. Next free number is `0508`.** New tables and their
  `test_schema_contract.py` class: `data_acquisition_run_item` → **OBJECTIVE**;
  `evaluation_match_rule`, `evaluation_compound_rule`, `non_match_input` → **SUBJECTIVE**. A new
  table trips that test until you classify it.
- **`RunScope` gained `pairs: tuple[tuple[str,str],...] | None`** (`data_acquisition/store.py`).
  `None` = the full rectangle of candidates × attributes (a sweep); set = the exact pairs (a
  retry/ask_again). `start_run` writes `data_acquisition_run_item` from it, and the run-accounting
  SQL (`items_total`/`items_unanswered`/`select_run_unanswered`) now reads from that table, **not**
  the candidate × attribute cross join. Every existing run was backfilled as its rectangle, so
  historical counts are unchanged.
- **`acquire(...)` gained `record_failures: Callable[[Sequence[AcquisitionFailure]], Awaitable]`**
  (optional; `continue_run` passes `runs.record_failures`). Keyed on (run, source, item), so the
  end-of-run write re-confirms rather than duplicates.
- **`NonMatch` (evaluation/rules.py) gained `input_values: tuple[int,...]`** — the value ids
  behind a `not_matching` *compound* rule (empty for a gate or a criterion threshold).
  `RuleWarning.input_values` already existed; both now read back **in condition order** (an
  `ordinal` column on `candidate_warning_input` and `non_match_input`).
- **`evaluation_criterion` gained `pillar_weight_locked`** (frozen pillar lock, denormalised per
  criterion row like `pillar_weight`). `read_criteria` now also restores
  `enforced_match_rules` / `applied_compound_rules` from the two new rule-list tables.
- **`_FailedOn` (execution.py) now holds exact `(attribute, candidate)` pairs**, narrowed per
  attribute. Internal, but if you touch retry/ask_again, that's the shape now.

## 3. The rule that caused this rework — apply it to any new snapshot table

**A new frozen child of `evaluation` or `candidate_result` needs `ON DELETE CASCADE` to its
parent, or it breaks the boot sweep** (`sweep_test_evaluations` → `delete_evaluation`), and the
backend refuses to start. `0504` shipped without it and `make check` stayed green because storage
tests tear down with `TRUNCATE ... CASCADE` (which cascades regardless of FK definitions) and
`make e2e` runs on a throwaway DB — neither exercises the real boot delete. So: add the cascade,
**and** write a boot-sweep test that inserts a *real* row and asserts
`booted.test_evaluations_swept == 1` (see `TestSweepingWhatATestSaved` in
`tests/storage/test_startup_behaviour.py`).

## 4. Please reconcile `findings-review-comparison.md`

Flip to FIXED: **ST-07** (boot-breaker + freeze remainder both done), **BE-19**, **BE-11**,
**BE-07** (with the Low remainder noted below). Your reviewers already confirmed BE-31, BE-33 and
NEW-48 FIXED. My `docs/findings-remediation.md` has all of mine with commit hashes and the 0505/
0506/0507 details.

## 5. Still open (one, deliberately deferred)

**BE-07 #2** — a figure can downgrade a few days early at month ends because the read-path age
test compares a `timedelta`. Left as a Low deferral: it can't be fixed Python-side without
carrying calendar units through psycopg's `interval`→`timedelta` mapping, and doing so would make
the read-path downgrade disagree with `active_value`'s SQL unless that changed too. Documented in
the tracker.

That closes the cross-review from my (larger-findings) lane.
