# Detailed plan: Backend data acquisition, sources and the paid AI path

> Written on 2026-10-14 by a read-only planning agent against `c943761`, before the scope rule of 2026-10-15. It is the step-by-step detail behind [copilot-remediation-plan.md](../copilot-remediation-plan.md). Where the two differ (scope, decisions, order), the main plan wins.

Planned against HEAD `c943761`. I re-checked every citation at that commit. Nothing was run and no file was written. Path shorthand: `S/` = `backend/src/starnest/`, `T/` = `backend/tests/`.

### BE-10 [High] A narrowed retry source never receives the run's cost meter
- **Still present at HEAD?** Yes.
  - `S/data_acquisition/execution.py:570-602` (`_AskedOnlyAbout`) forwards `data_source`, `costs_money`, `estimate_for`, `attributes` and `fetch`, but not `meter_with`. It therefore inherits the no-op at `S/data_acquisition/adapter.py:101`.
  - `S/data_acquisition/run.py:84-85` calls `meter_with` on the wrapper.
  - The LLM adapters keep `_meter` on instances that live as long as the app (`S/data_sources/llm/employers.py:103-104`, `fallback.py:124-125`).
  - Since UI-02, this is reachable only through `POST …/retry`.
- **Root cause:** P41 made the wrapper forward members one at a time. P91 later added a hook with a default to the base class, and nothing checks that a delegating subclass overrides every member that has a default.
- **Fix:** In `execution.py`, give `_AskedOnlyAbout` a `meter_with(self, meter)` that calls `self._adapter.meter_with(meter)`, and update the class docstring.
- **Tests first:**
  - Fails today: `T/unit/data_acquisition/test_retry.py::TestTheNarrowedSource::test_it_hands_the_running_meter_to_the_source_it_wraps`. The wrapped stub must receive the same meter object the wrapper was given.
  - `::test_it_overrides_every_member_the_base_class_defines`: every public name in `vars(SourceAdapter)` must also be in `vars(_AskedOnlyAbout)`. This would have caught BE-10, and it will catch BE-19's new property.
  - `TestWhatARetryMaySpend::test_a_retry_stops_a_per_candidate_sweep_at_the_cap`: three failed candidates, a paid stub at 1.00 per candidate, cap 1.00 → only one candidate is asked.
  - `::test_a_meter_exhausted_by_an_earlier_run_does_not_refuse_a_retry`: the stub already holds `CostMeter(cap 1, spent 1)`; a retry with cap 5 still asks the candidate.
- **Migration / contract / docs:** none.
- **Files touched:** `S/data_acquisition/execution.py`; `T/unit/data_acquisition/test_retry.py`.
- **Behaviour change & risks:**
  - A paid retry now stops at the cap after each candidate instead of after the whole attribute.
  - A retry is no longer refused by the exhausted meter of an earlier run.
  - Spend can only go down.
- **Depends on / conflicts with:**
  - Must land before BE-11, because ask-again will start wrapping adapters.
  - Must land before BE-19, because the wrapper has to forward BE-19's new property.
- **Effort:** S.
- **Needs a user decision?** No.

### BE-17 [High] A billed empty research answer is metered as free
- **Still present at HEAD?** Yes; `gates.py` is unchanged since the baseline.
  - `S/data_sources/llm/client.py:164-167` raises `LlmUnavailableError(cost_eur=cost, calls=1)`.
  - `S/data_sources/llm/gates.py:76-81` builds `Researched` without that cost, so the defaults at `S/data_acquisition/research.py:63-64` (zero cost, zero calls) are what gets metered at `research.py:143`.
- **Root cause:** P71 attached the bill to the exception. The employers and fallback adapters read it (`employers.py:149-157`, `fallback.py:173-181`); the gate researcher was never updated.
- **Fix:** In `gates.py`, in the `except LlmUnavailableError` branch of `LlmGateResearcher.research`, pass `cost_eur=unavailable.cost_eur, calls=unavailable.calls`. Both are zero when the call never reached the provider.
- **Tests first:** all in `T/unit/data_sources/llm/test_the_three_uses.py`.
  - Fails today: `TestResearchingAGate::test_an_answer_with_no_text_still_reports_what_it_billed`. With `an_answer("", input_tokens=1_000_000, output_tokens=0)`, expect `UNKNOWN`, `cost_eur == Decimal("1.01")` at the conftest prices, and `calls == 1`. Today it reports 0 and 0.
  - Control: `::test_a_model_that_cannot_be_reached_bills_nothing` (a RuntimeError gives 0 and 0).
  - `::test_a_pass_of_billed_empty_answers_halts_at_the_cap`: `research_gates` with the real researcher, four empty answers and a cap of 1.50 → halted on the cap, 2 calls, 2.02 EUR, no proposals. Today it makes 4 calls, reports 0.00 and does not halt.
- **Migration / contract / docs:** none.
- **Files touched:** `S/data_sources/llm/gates.py`; `T/unit/data_sources/llm/test_the_three_uses.py`.
- **Behaviour change & risks:**
  - Research responses now report what empty answers cost.
  - A misbehaving model stops at the per-request cap, overshooting by at most one call.
  - The UI will show higher, true costs (UI-14).
- **Depends on / conflicts with:** BE-34 records these costs durably. How to bound a whole pass is answered under BE-34.
- **Effort:** S.
- **Needs a user decision?** No.

### BE-19 [High] Paid answers wait in memory until the whole candidate sweep returns (also closes BE-33)
- **Still present at HEAD?** Yes.
  - `employers.py:126-176` and `fallback.py:145-206` collect values and failures for every candidate and return once.
  - `run.py:90` awaits that return and only then appends, at `:122`.
  - Failures reach the database only at `execution.py:227`, `:342` and `:348`; spend only per source, at `:285`.
  - A kill while asking candidate k loses the paid figures, failures and cost of candidates 1 to k-1.
- **Root cause:** `acquire` commits once per `fetch`. That fits bulk free sources (one request per attribute), but one `fetch` of a per-candidate paid source is 32 billed calls.
- **Fix:**
  1. `adapter.py`: add a property `SourceAdapter.asks_per_candidate`, default `False`. Docstring: a source that makes one call per candidate is asked one candidate at a time, so each answer is kept before the next is paid for.
  2. `employers.py` and `fallback.py`: return `True`. Their fetch loops are unchanged; a one-element list works.
  3. `execution.py`: `_AskedOnlyAbout` forwards the new property.
  4. `run.py`: change `acquire` to take `runs: RunStore | None = None` and drop the `collecting` parameter.
     - For each attribute, ask one question per candidate when `asks_per_candidate` is set, otherwise one question for all candidates.
     - Move the per-question work into a new helper `_ask_and_keep`, in this order:
       - fetch;
       - the existing meter reconciliation;
       - if a run and a store are given, `add_spend` for this question first (the call is billed whatever happens next);
       - stamp the run on the values and append them;
       - stamp the source on the failures;
       - spread candidate-less failures over this question's candidates (`_item_by_item` moves here from `execution.py`);
       - `record_failures`.
     - `RunOutcome.failures` stays unspread, so the CLI report and the logs read as today.
     - The cap check between attributes stays.
  5. `execution.py`, `continue_run`:
     - pass `runs=runs`;
     - delete the per-source `add_spend`, which would otherwise count spend twice, but keep its log line;
     - `_halt` and the `except` path now only close the run;
     - after `stand_in`, record `borrowed.failures`.
- **Tests first:**
  - Fails today: `T/unit/data_acquisition/test_run.py::TestEachPaidAnswerIsKeptBeforeTheNextIsBought::test_an_answer_is_stored_before_the_next_candidate_is_asked`. A per-candidate paid stub answers Portugal, then raises `ProcessKilled(BaseException)` on Spain. A `BaseException` skips every `except Exception`, as a real kill would. Portugal's value must already be appended.
  - In the same class:
    - `::test_its_cost_and_failures_are_written_before_the_next_candidate_is_asked`: a recording RunStore sees `add_spend(1, 0.10)` and Portugal's failure before the kill.
    - `::test_such_a_source_is_handed_one_candidate_at_a_time`.
    - Control: `::test_a_bulk_source_is_still_asked_once_per_attribute`.
    - `::test_a_whole_source_failure_is_written_against_the_candidates_it_was_asked_about`.
    - `::test_a_runs_spend_is_written_once_not_twice`: through `execute_run`, two candidates at 0.10 each record 0.20 in total.
  - Storage, new file: `T/storage/test_acquisition_durability.py::test_a_paid_answer_its_failure_and_its_cost_survive_a_kill_on_the_next_candidate`.
    - After the kill: the run is still `running`, holds candidate 1's value, and shows `cost_eur` 0.05 and `llm_call_count` 1.
    - After `sweep_abandoned_runs`: the run is `failed` with `items_completed` 1.
  - Acceptance, fails today: `T/acceptance/test_gate_d.py::TestAProcessThatDiedMidRun::test_a_paid_answer_already_bought_survives_a_death_on_the_next_candidate`, driven through the API.
  - The existing P66 Gate D tests must stay green.
- **Migration / contract / docs:** no schema or contract change. In `docs/known-issues.md`, mark P36 fixed. In `docs/arch.md`, add one sentence under "Committing, one item at a time" about per-candidate sources.
- **Files touched:** `S/data_acquisition/adapter.py`, `run.py`, `execution.py`; `S/data_sources/llm/employers.py`, `fallback.py`; `T/unit/data_acquisition/test_run.py`, `test_retry.py`; `T/storage/test_acquisition_durability.py` (new); `T/acceptance/test_gate_d.py`; `docs/known-issues.md`, `docs/arch.md`.
- **Behaviour change & risks:**
  - Same calls and same money. A kill now loses only the call in flight.
  - For every source, failures appear in polls as they happen rather than at the end.
  - About three small transactions per paid call, negligible next to a web-search call. The fallback logs one line per candidate.
  - Risk: forgetting to remove `continue_run`'s `add_spend` doubles the recorded spend; a test guards it.
  - Risk: more writes during a run make ST-11's mixed-snapshot polls more likely.
  - A paid adapter that forgets the new property keeps today's per-attribute window; nothing regresses.
- **Depends on / conflicts with:**
  - BE-10 lands first.
  - BE-08 and BE-33 use the same helper.
  - ST-09 (storage agent) hooks into the append in `run.py`: land BE-19 first and give ST-09 the single append call inside `_ask_and_keep`.
  - BE-11 and BE-25 also edit `execution.py`.
- **Effort:** M.
- **Needs a user decision?** No.

### BE-11 [Medium] Retries ask a cross product instead of the exact failed or unanswered pairs
- **Still present at HEAD?** Yes.
  - `execution.py:534-543` takes two separate unions (candidates, attributes) over all failures.
  - `_AskedOnlyAbout` (`:570-602`) narrows attributes but passes every candidate through.
  - `ask_again` (`:643-648`) does the same over the unanswered pairs.
  - `storage/queries/runs.sql:117,172,202,217-239` derives `items_total` and the unanswered list as the cross product of the two scope lists.
- **Root cause:**
  - The scope (`0004`) is two lists, so it can only express rectangles.
  - The docstring's premise that extra pairs "cost nothing extra" (`execution.py:519-523`) predates sources that bill per candidate.
  - Asking exactly can stay inside the retry code; recording exactly cannot. If the run records the rectangle, its derived `unanswered` lists pairs nobody asked (breaking Q217), and an ask-again on that run re-expands the scope.
- **Fix:**
  1. `execution.py`: `_AskedOnlyAbout(adapter, asked: Mapping[AttributeId, frozenset[str]])`.
     - `attributes` = what the source declares ∩ the mapping's keys.
     - `fetch` passes the wrapped source only that attribute's candidates; if there are none, it makes no call.
     - It spreads a candidate-less failure over exactly those candidates.
  2. `retry_run` builds `{attribute: candidates}` per source from `failed.failures`.
     - Items are the pairs whose source is switched on and declares the attribute, plus the pairs of `stand_in` failures.
     - Drop `may_borrow_alone`; the items replace it.
  3. `ask_again` wraps every switched-on adapter with `{attribute: candidates}` taken from `run.unanswered`; the items are exactly those pairs.
  4. Both pass `items=` to `open_run(..., items=None)`, which:
     - keeps only items whose attribute is answerable or borrowable;
     - sets `in_scope` to those attributes;
     - keeps only stand-in declarations whose pair is an item;
     - records `RunScope(items=…)`.
  5. `S/data_acquisition/store.py`: add `RunScope.items: tuple[tuple[str, str], ...] | None = None`. `None` means every candidate against every attribute. Validate that items lie inside the two lists.
  6. Storage:
     - `runs.sql` gains `insert_run_items`.
     - `items_total` and `items_unanswered` in `select_run` and `select_runs`, and all of `select_run_unanswered`, read the new view.
     - `S/storage/run_store.py::start_run` writes the items in the same transaction.
- **Tests first:**
  - Fails today: `T/unit/data_acquisition/test_retry.py::TestWhatARetryAsks::test_each_source_is_asked_only_about_the_candidates_it_failed_for`. Failures (A, Portugal, a1) and (B, Spain, a2); A must be asked only `(a1, [Portugal])` and B only `(a2, [Spain])`. Today each is asked about both candidates.
  - More retry tests in the same class:
    - `::test_the_retry_records_exactly_the_failed_pairs`
    - `::test_a_whole_source_failure_is_itemised_against_the_candidates_asked`
    - `::test_a_stand_in_failure_is_retried_beside_a_source_failure` (see adjacent defect 2)
    - `::test_a_source_switched_off_since_contributes_no_items`
  - Ask-again: `T/unit/data_acquisition/test_ask_again.py::TestWhatItAsks::test_only_the_exact_unanswered_pairs_are_asked`.
  - Storage: `T/storage/test_run_store.py::TestAScopeOfExactItems`:
    - `test_only_the_listed_items_are_counted` (2×2 lists with 2 items → `items_total` 2, and the unanswered list names those 2)
    - `test_a_scope_without_items_is_still_the_cross_product`
    - `test_an_item_outside_the_scope_lists_is_refused`
    - `test_the_history_row_counts_the_same_items`
  - Acceptance:
    - `T/acceptance/test_runs_api.py::TestRetryingARun::test_a_retry_asks_again_only_about_the_pairs_that_failed`: no value or failure row outside the failed pairs, `items_total == 2`, and the response is validated against `docs/openapi.yaml`.
    - `TestAskingAgain::test_it_asks_only_the_exact_unanswered_pairs`.
- **Migration / contract / docs:**
  - New migration plus `.rollback.sql`, with a `-- depends:` line and a header explaining that a retry's items need not form a rectangle and that counts stay derived. Contents:
    - Table `data_acquisition_run_item (data_acquisition_run, candidate, attribute)`, primary key on all three columns.
    - Composite foreign keys to `data_acquisition_run_candidate(data_acquisition_run, candidate)` and `data_acquisition_run_attribute(data_acquisition_run, attribute)`, so an item always lies inside the listed scope.
    - View `data_acquisition_run_scope_item`: the run's item rows if it has any, otherwise the cross product.
    - The rollback drops the view, then the table.
  - Contract wording you approved, replacing `docs/openapi.yaml:789-797`:
    > `items: failed` (the default) asks again exactly what failed: each source that failed is asked only about the attributes it failed on, and for each of those only about the candidates it failed for -- a source is never asked about a pair it did not fail on. The new run's items are exactly those pairs, and `items_total` counts them; its `scope` still lists the candidates and attributes involved, so the two lists can describe more pairs than the run asks.
    >
    > `items: unanswered` asks again about exactly the items that produced neither a figure nor a failure, and no others. There is no source to narrow to, because no source failed: every source that can answer an item's attribute is asked about that item. For a country a dataset simply does not cover this will change nothing, which is why it is a separate request rather than part of a retry.
  - Not yet approved: `openapi.yaml:1644` `Run.items_total` → "The planned items: every attribute in scope for every candidate in scope -- or, for a run made by retryRun, exactly the pairs it asks again."
  - Then run `make openapi`, because the retry docstring at `S/api/runs.py:335-347` changes.
  - Then run `make ui-client`, because `ui/src/api/schema.ts` embeds both texts and `generatedClient.test.ts` fails otherwise.
  - Docs:
    - `docs/reqs.md` §3.8, both ER diagrams and the relationship table (checked by `audit_ontology.py`).
    - Comments in `runs.sql`.
    - `freshness.py` docstring: say "an ordinary run's scope is a rectangle".
    - The `retry_run` and `ask_again` docstrings.
- **Files touched:** `S/data_acquisition/execution.py`, `store.py`, `freshness.py`; `S/storage/run_store.py`; `storage/queries/runs.sql`; the new migration pair; `S/api/runs.py`; `docs/openapi.yaml`, `docs/openapi.implemented.yaml`, `ui/src/api/schema.ts` (generated), `docs/reqs.md`; `T/unit/data_acquisition/test_retry.py`, `test_ask_again.py`; `T/storage/test_run_store.py`; `T/acceptance/test_runs_api.py`.
- **Behaviour change & risks:**
  - Retries and ask-again ask fewer pairs and pay for fewer calls.
  - A retry's `items_total` is now the failed pairs. The scope lists are unchanged, so the UI's "N candidates over M attributes" stays true.
  - Runs made before the migration have no item rows and read exactly as before.
  - A rollback turns retries made after the migration back into rectangle counts, which overstates their unanswered items.
  - All three queries must use the one view, so the counts cannot drift.
- **Depends on / conflicts with:**
  - BE-10 first; without it, ask-again loses the meter once it wraps adapters.
  - Land after BE-19 and before BE-25; all three edit `open_run` or `execution.py`.
  - The storage agent's ST-09, ST-11 and ST-12 edit the same `runs.sql` queries and add migrations, so one owner should hold `runs.sql`.
- **Effort:** L.
- **Needs a user decision?** Yes. Do you approve recording a retry's exact pairs in storage, and the `items_total` wording?
  - (a) Item rows only for retries, plus one view. Recommended.
  - (b) Item rows for every run, with all counts derived from them. One representation, but it means backfilling all history.
  - (c) Ask exactly but keep recording the rectangle. Rejected, because its `unanswered` would list pairs nobody asked.

### BE-08 [Medium] A figure rejected by its credible range leaves no failure for a retry to find
- **Still present at HEAD?** Yes.
  - `run.py:114-138` appends every returned value, rejected ones included, but stamps and keeps only `acquired.failures`.
  - `S/data/measurements.py:90` sets `rejection_reason`.
  - `docs/reqs.md:1082-1083` requires the run to record such a figure as a failure.
- **Root cause:** the rejection is stored on the `Value` (`data/`), failures belong to the run (`data_acquisition/`), and nothing turns one into the other.
- **Fix:** in `run.py`, inside `_ask_and_keep` from BE-19 (or at `:124-138` if BE-19 has not landed), after the append: for each returned value that `is_rejected`, add `AcquisitionFailure(attribute, candidate, "the figure was stored and rejected: <reason>")`, stamped with the source and recorded like the adapter's own failures.
- **Tests first:**
  - Fails today: `T/unit/data_acquisition/test_run.py::TestWhatARunKeeps::test_a_rejected_figure_is_kept_and_recorded_as_a_failure`. Expect one failure stamped `eurostat` that names the reason, with the value still appended.
  - Control: `::test_an_accepted_figure_records_no_failure`.
  - Acceptance: `T/acceptance/test_runs_api.py::TestWhatAFailureRecords::test_a_figure_outside_its_credible_range_can_be_retried`. A 62 °C figure for `country.avg_annual_temperature` (credible range −20..40, already in the catalog) is listed as a failure, and `POST …/retry` answers 202 instead of 409 `nothing_to_retry`.
- **Migration / contract / docs:** none. In `docs/arch.md`, "Validation happens on the way in": add that the run also records a failure for that pair (reqs 3.3a).
- **Files touched:** `S/data_acquisition/run.py`; `T/unit/data_acquisition/test_run.py`; `T/acceptance/test_runs_api.py`; `docs/arch.md`.
- **Behaviour change & risks:**
  - Rejected figures appear in the run's failures and can be retried.
  - The pair still counts in `items_completed`, as the contract defines it, and not in `items_failed`.
  - A rejected transcribed figure will show as a failure on every run until the table is corrected.
- **Depends on / conflicts with:** BE-19 (same helper; land after it). BE-09 feeds it.
- **Effort:** S.
- **Needs a user decision?** No for the fix. Optional follow-up: should a pair whose only figure was rejected count as failed rather than completed?
  - (a) Keep today's definition. Recommended for now.
  - (b) Change `runs.sql` and the `items_completed` wording, which is a contract change in the storage agent's queries.

### BE-09 [Low] WHO builds its values by hand and skips the credible range
- **Still present at HEAD?** Yes, latent. `S/data_sources/who/adapter.py:164-194` constructs `Value(...)` directly; it is the only adapter that does not go through `Measurements`. No credible range is declared for its attribute today.
- **Root cause:** P59 moved every other adapter onto `Measurements`.
- **Fix:** in `who/adapter.py`, build one `Measurements(attribute, data_source=WHO, retrieved, confidence_level=HIGH)` per fetch and have `_a_value` return `measuring.figure(...)`. Keep the `ValidationError` catch for WHO's own scale.
- **Tests first:**
  - Fails today: `T/unit/data_sources/who/test_adapter.py::TestWhatComesBack::test_a_figure_outside_the_attributes_credible_range_is_stored_rejected`. With a credible range of 20–100 and a WHO row of 8, the value comes back rejected with the range in the reason.
  - Control: `::test_a_figure_inside_the_credible_range_is_accepted`.
- **Migration / contract / docs:** none.
- **Files touched:** `S/data_sources/who/adapter.py`; `T/unit/data_sources/who/test_adapter.py`.
- **Behaviour change & risks:** none today. With BE-08, a future rejection becomes a failure a retry can reach.
- **Depends on / conflicts with:** BE-08.
- **Effort:** S.
- **Needs a user decision?** No.

### BE-25 [Medium] The plan counts attributes the run will skip as still fresh
- **Still present at HEAD?** Yes.
  - `S/api/runs.py:163-204` reads neither the settings nor the run store.
  - `execution.py:142-155` drops fresh attributes, and `:163-175` refuses a run where everything is fresh.
- **Root cause:** Q233's freshness rule was added to `open_run` only, so two functions compute "the work".
- **Fix:**
  1. In `execution.py`, extract `async attributes_still_fresh(*, runs, level, attributes, candidates, refetch_older_than, now=None) -> frozenset[str]` from `:142-155`. It reads nothing when the age is null. `open_run` uses it; export it from `S/data_acquisition/__init__.py`.
  2. `S/api/runs.py::plan_run` takes `runs: Runs` and `households: Households`, reads the refetch age through `_refetch_age`, and removes fresh attributes from `wanted` before counting `by_source`, the estimate and `items_total`. Update its docstring.
- **Tests first:**
  - Fails today: `T/acceptance/test_runs_api.py::TestPlanningARun::test_an_attribute_fresh_for_every_candidate_is_not_planned`. With a refetch age of 30 days and one run over overburden, a plan over overburden and overcrowding counts roster × 1, the same as the started run. Today it counts roster × 2.
  - `::test_a_plan_of_nothing_but_fresh_attributes_plans_nothing_and_the_run_refuses`: 0 items and 0 EUR, and start answers 409 `nothing_to_fetch`.
  - `::test_a_fresh_paid_attribute_is_not_priced`.
  - Control: `::test_with_no_refetch_age_the_plan_counts_everything`.
  - Unit: `T/unit/data_acquisition/test_freshness.py::test_a_null_age_reads_nothing_from_the_store`.
- **Migration / contract / docs:** none; the `RunPlan` shape is unchanged. Run `make openapi` for the docstring.
- **Files touched:** `S/data_acquisition/execution.py`, `__init__.py`; `S/api/runs.py`; `docs/openapi.implemented.yaml`; `T/unit/data_acquisition/test_freshness.py`; `T/acceptance/test_runs_api.py`.
- **Behaviour change & risks:**
  - The confirmed estimate now matches the work that runs, which also fixes UI-02's bucket estimates.
  - An all-fresh plan shows zero work; the UI agent may want to explain why.
- **Depends on / conflicts with:** land after BE-11. The API agent also edits `S/api/runs.py` (BE-23).
- **Effort:** S.
- **Needs a user decision?** No.

### BE-27 [Low] An unquoted comma silently cuts a transcribed table's notes short
- **Still present at HEAD?** Yes, and in more places than reported. `S/data_sources/published_tables/table.py:117-146` never checks how many fields a row has. Rows with extra fields at HEAD:
  - `protected_planet_protected_land.csv`: CH, GB, IS, NO;
  - `statutory_paid_leave.csv`: GB;
  - `wri_coastline_access.csv`: AT, CH, CZ, HU, LI, LU, SK.
- **Root cause:** `DictReader` puts extra fields under its `restkey`, and the loader reads only the named columns.
- **Fix:**
  - In `table.py`, `_rows_of` refuses any row that does not have exactly 5 fields. The error names the file, the row and the field count, and says to quote a field containing a comma.
  - Quote the `workings` field in those 12 rows.
  - Bump `transcribed_on` in the three files. `values.sql:245` documents that a corrected transcription is a new row, never an edit.
- **Tests first:**
  - Fails today: `T/unit/data_sources/published_tables/test_table.py::TestWhatATableRefuses::test_a_row_with_more_fields_than_columns_is_refused`.
  - `::test_a_row_with_fewer_fields_than_columns_is_refused`.
  - `TestWhatATableSays::test_a_quoted_workings_keeps_its_commas`.
  - The existing `test_every_shipped_table_reads_cleanly` then fails until the 12 rows are quoted.
  - `test_the_shipped_tables.py::test_no_workings_is_cut_short_at_a_comma`: Norway keeps "excludes Svalbard/Jan Mayen", and the landlocked rows keep "so no coast".
- **Migration / contract / docs:** none; add the quoting rule to the `table.py` docstring.
- **Files touched:**
  - `S/data_sources/published_tables/table.py`.
  - `S/data_sources/published_tables/tables/`: `protected_planet_protected_land.csv`, `statutory_paid_leave.csv`, `wri_coastline_access.csv`.
  - `T/unit/data_sources/published_tables/test_table.py`, `test_the_shipped_tables.py`.
- **Behaviour change & risks:**
  - A malformed table now stops the boot, so the data fix must be in the same commit.
  - After the bump, the next acquisition writes new rows with the full notes. The figures, and therefore scores, do not change.
- **Depends on / conflicts with:** ST-09; after the bump these are new rows, not re-reads.
- **Effort:** S.
- **Needs a user decision?** Yes: bump `transcribed_on` in the three files?
  - (a) Bump. Recommended: it is the documented convention, and existing databases get the full notes.
  - (b) Leave it. Only fresh databases get the full notes.

### BE-28 [Low] The fallback can be asked for an AssignedScore it can never build
- **Still present at HEAD?** Yes, latent.
  - `S/data_sources/llm/fallback.py:61` includes `ASSIGNED_SCORE` in `ANSWERABLE`.
  - `:322-325` builds an `AssignedScore` without `range_min`, `range_max` or `assigned_by` (see `S/data/payloads.py:337-364`).
  - Only the manual-entry exclusion at `S/main.py:386` keeps the two shipped AssignedScore attributes out.
- **Root cause:** an assigned score is a judgement with no range declared in the catalog. reqs 6.10 use 1 allows a cited number for a measurable attribute, not a score assigned by the model.
- **Fix:** in `fallback.py`, remove `ASSIGNED_SCORE` from `ANSWERABLE`, delete its branch and the related imports, and say why in the docstring. `main.py` follows automatically because it filters by `ANSWERABLE`.
- **Tests first:**
  - Fails today: `T/unit/data_sources/llm/test_the_three_uses.py::TestTheFallbackFigure::test_an_assigned_score_is_never_asked_about`. Expect no request to the model, one whole-attribute failure and cost 0.
  - Fails today: `T/unit/test_composition_root.py::TestTheFallbackDeclaration::test_a_judgement_score_is_never_declared_even_when_not_manual`.
- **Migration / contract / docs:** none.
- **Files touched:** `S/data_sources/llm/fallback.py`; `T/unit/data_sources/llm/test_the_three_uses.py`; `T/unit/test_composition_root.py`.
- **Behaviour change & risks:** none today. No paid call can be made for an answer that cannot be stored.
- **Depends on / conflicts with:** BE-19 also edits `fallback.py` (different lines).
- **Effort:** S.
- **Needs a user decision?** No. Model-assigned scores would be a new reqs 6.10 use.

### BE-29 [Low] Publisher and model JSON numbers pass through floats before becoming Decimal
- **Still present at HEAD?** Yes.
  - `S/data_sources/transport.py:87` calls `response.json()`.
  - The parsers then do `Decimal(str(float))`, for example `eurostat/jsonstat.py:136-143`.
  - Model replies go through the same loss at `S/data_sources/llm/reading.py:91`.
- **Root cause:** the decimal-preserving JSON loader (`S/storage/connections.py:25`) is used only for database JSON.
- **Fix:**
  - `transport.py`: `response.json(parse_float=Decimal)` (httpx passes keyword arguments on to `json.loads`).
  - `reading.py`: `json.loads(..., parse_float=Decimal)`.
  - Every parser already calls `Decimal(str(x))`, integers stay `int`, and no parser checks for `float`.
- **Tests first:**
  - Fails today: `T/unit/data_sources/test_transport.py::TestWhatItReturns::test_a_long_decimal_survives_decoding_digit_for_digit`, using raw bytes `{"v": 0.1234567890123456789}`.
  - `::test_integers_stay_integers`.
  - `T/unit/data_sources/eurostat/test_jsonstat.py::test_a_long_figure_keeps_every_digit`.
  - `test_the_three_uses.py::TestTheFallbackFigure::test_a_figure_keeps_every_digit_the_model_gave`.
- **Migration / contract / docs:** none.
- **Files touched:** `S/data_sources/transport.py`, `S/data_sources/llm/reading.py`; the three test files above.
- **Behaviour change & risks:** stored figures equal the publisher's exact digits. Notes may now show trailing zeros as published, and a few string assertions in adapter tests may need updating.
- **Depends on / conflicts with:** none.
- **Effort:** S.
- **Needs a user decision?** No.

### BE-30 [Low] Non-string employer entries become firm names
- **Still present at HEAD?** Yes: `S/data_sources/llm/employers.py:219` turns every element into a string.
- **Root cause:** P72 checked that the container is a list, not what is in it.
- **Fix:** in `_the_employers_named`, refuse the whole answer, naming the type, if any element is not a `str`. Then strip and drop blanks as today.
- **Tests first:**
  - Fails today: `T/unit/data_sources/llm/test_the_three_uses.py::TestNamingTheEmployers::test_a_list_holding_something_other_than_names_is_refused`, parametrised over `[null]`, `[123]`, `[{"name":"Acme"}]`, `[true]` and `["Acme", null]`. Expect no value, one failure, and the cost still counted.
  - Control: blank strings are still dropped.
- **Migration / contract / docs:** none.
- **Files touched:** `S/data_sources/llm/employers.py`; `T/unit/data_sources/llm/test_the_three_uses.py`.
- **Behaviour change & risks:** a malformed answer becomes a failure a retry can reach, instead of fake firm names. It was billed either way.
- **Depends on / conflicts with:** BE-19 edits `employers.py` (the new property only).
- **Effort:** S.
- **Needs a user decision?** No.

### BE-33 [Low] A source's spend reaches the run only after the whole source returns
- **Still present at HEAD?** Yes. `execution.py:281-287` calls `add_spend` after `acquire` returns. The adapters record each call only on the in-memory meter (`employers.py:93-101`, `fallback.py:114-122`).
- **Root cause:** the durable write was placed per source to save a database round trip per call (P36).
- **Fix:** delivered by BE-19 steps 4 and 5: one `add_spend` per paid call, written first, and the per-source write removed.
- **Tests first:** covered by BE-19: `::test_its_cost_and_failures_are_written_before_the_next_candidate_is_asked`, `::test_a_runs_spend_is_written_once_not_twice`, and the storage durability test, which checks `cost_eur` after a kill.
- **Migration / contract / docs:** `docs/known-issues.md`: mark P36 fixed.
- **Files touched:** same as BE-19.
- **Behaviour change & risks:** a killed run reports what it spent up to its last completed call.
- **Depends on / conflicts with:** BE-19, same commit.
- **Effort:** S, inside BE-19.
- **Needs a user decision?** No.

### BE-34 [Low] Gate-research spend has no durable record
- **Still present at HEAD?** Yes, deferred on purpose (Q224 at `docs/reqs.md:3250`; P28 at `docs/known-issues.md:346`). `research.py:127-178` keeps a meter that lives only for the request, and `S/api/rules.py:335-351` only returns it.
- **Root cause:** research writes gate answers, not figures, so it is not a run (reqs 3.8), and the ledger was postponed until a second paid source existed.
- **Fix, if you approve it:**
  1. `research.py`: a `ResearchSpend` record and an optional `ledger` parameter on `research_gates`. Each research call that billed anything is written right after it returns, before the next question.
  2. `store.py`: an abstract `RunStore.record_research_spend`, implemented in `S/storage/run_store.py` through a new `insert_research_spend` query in `runs.sql`.
  3. `S/api/rules.py`: the research endpoint takes the `runs` store and passes it as the ledger.
  4. New migration: table `match_rule_research_spend` with an identity id, `researched_at`, foreign keys to `match_rule`, `candidate` and `data_source`, `llm_call_count ≥ 0` and `cost_eur ≥ 0`. The rollback drops it.
  5. Add the table to `WRITABLE_TABLES` in `T/storage/conftest.py` and `T/acceptance/conftest.py`, and implement the new method on the two `RecordingRunStore` test fakes.
- **Tests first:**
  - Fails today: `T/unit/data_acquisition/test_research.py::TestMoney::test_every_billed_answer_is_recorded_before_the_next_question`. The stub bills 0.05 and then raises; the ledger must hold the first call.
  - `::test_a_call_that_billed_nothing_is_not_recorded`.
  - Storage: `T/storage/test_run_store.py::test_research_spend_is_written_per_call`.
  - Acceptance: `T/acceptance/test_llm_path_api.py::TestResearchingTheGates::test_what_research_spent_is_on_record_even_when_the_pass_dies`.
- **Migration / contract / docs:** the migration above. No contract change; the ledger is write-only. Add a new decision row in `docs/reqs.md` revisiting Q224, and update P28.
- **Files touched:** `S/data_acquisition/research.py`, `store.py`, `__init__.py`; `S/storage/run_store.py`; `storage/queries/runs.sql`; the migration pair; `S/api/rules.py`; `T/unit/data_acquisition/test_research.py`, `test_retry.py`, `test_ask_again.py`; `T/storage/test_run_store.py`, `conftest.py`; `T/acceptance/conftest.py`, `test_llm_path_api.py`; docs.
- **Behaviour change & risks:**
  - Every billed research call is on record, even when the response is lost (UI-01 timeout) or the process dies.
  - "What did this month cost?" becomes an SQL sum over runs plus this table.
  - One extra write per research call.
- **Bounding a whole pass (your question):**
  - No backend change can bound a multi-request pass without a contract change. The contract defines the cap per request, nothing ties batches together, and this ledger records spend rather than limiting it.
  - The page can bound a pass with today's contract:
    - before each batch, call `planMatchRuleResearch` for that batch;
    - send the batch only if what has been spent so far plus `estimated_cost_eur` stays within the cap;
    - add each response's `cost_eur` to the running total.
  - This needs BE-17, so that response costs are true.
  - A lost response hides that batch's cost from the page; only a read endpoint over the ledger (a contract change) closes that gap.
- **Depends on / conflicts with:** BE-17. The API agent also edits `S/api/rules.py` (BE-21, BE-23). The storage agent edits `runs.sql`, `run_store.py`, migrations and `T/storage/conftest.py`.
- **Effort:** M.
- **Needs a user decision?** Yes, because it reverses Q224:
  - (a) A write-only ledger now. Recommended: small batches multiply requests, and a lost response currently loses the only record.
  - (b) The ledger plus a read endpoint, so the page's total survives lost responses. This is a contract change.
  - (c) Keep it deferred.

---

**(a) Commits, in priority order**
1. `fix(data_acquisition): a narrowed retry source is handed the run's cost meter (BE-10)`
   - `S/data_acquisition/execution.py`
   - `T/unit/data_acquisition/test_retry.py`
2. `fix(llm): an empty research answer the provider billed counts against the cap (BE-17)`
   - `S/data_sources/llm/gates.py`
   - `T/unit/data_sources/llm/test_the_three_uses.py`
3. `fix(data_acquisition): each paid answer, its failures and its cost are stored before the next is bought (BE-19, BE-33)`
   - `S/data_acquisition/adapter.py`, `run.py`, `execution.py`
   - `S/data_sources/llm/employers.py`, `fallback.py`
   - `T/unit/data_acquisition/test_run.py`, `test_retry.py`
   - `T/storage/test_acquisition_durability.py`
   - `T/acceptance/test_gate_d.py`
   - `docs/known-issues.md`, `docs/arch.md`
4. `fix(data_acquisition): retries ask exactly the pairs that failed or went unanswered (BE-11)`
   - `S/data_acquisition/execution.py`, `store.py`, `freshness.py`
   - `S/storage/run_store.py`, `storage/queries/runs.sql`, the migration pair
   - `S/api/runs.py`
   - `docs/openapi.yaml`, `docs/openapi.implemented.yaml`, `ui/src/api/schema.ts` (generated)
   - `docs/reqs.md`
   - tests listed under BE-11
5. `fix(data_acquisition): a rejected figure is also a failure a retry can reach (BE-08)`
   - `S/data_acquisition/run.py`
   - `T/unit/data_acquisition/test_run.py`
   - `T/acceptance/test_runs_api.py`
   - `docs/arch.md`
6. `fix(api): a run plan leaves out what the run would skip as still fresh (BE-25)`
   - `S/data_acquisition/execution.py`, `__init__.py`
   - `S/api/runs.py`
   - `docs/openapi.implemented.yaml`
   - `T/unit/data_acquisition/test_freshness.py`, `T/acceptance/test_runs_api.py`
7. `fix(who): WHO figures pass through the attribute's credible range (BE-09)`
   - `who/adapter.py`, `who/test_adapter.py`
8. `fix(published_tables): a row with a stray comma is refused, and three tables quote their workings (BE-27)`
   - `table.py`, the 3 CSVs, `test_table.py`, `test_the_shipped_tables.py`
9. `fix(llm): the fallback never assigns a score, and employer names must be names (BE-28, BE-30)`
   - `fallback.py`, `employers.py`, `test_the_three_uses.py`, `test_composition_root.py`
10. `fix(data_sources): publisher and model JSON numbers are read as decimals, never floats (BE-29)`
    - `transport.py`, `llm/reading.py`, `test_transport.py`, `test_jsonstat.py`, `test_the_three_uses.py`
11. `fix(data_acquisition): every billed gate-research call is recorded as it happens (BE-34)`, only if you approve it.
    - files listed under BE-34

**(b) Every file the plans touch** (★ = also planned by another agent)
- `backend/src/starnest/data_acquisition/run.py`: BE-19, BE-33, BE-08 ★ ST-09
- `backend/src/starnest/data_acquisition/execution.py`: BE-10, BE-19, BE-33, BE-11, BE-25 ★ ST-09 (if it touches `continue_run`)
- `backend/src/starnest/data_acquisition/adapter.py`: BE-19
- `backend/src/starnest/data_acquisition/store.py`: BE-11, BE-34
- `backend/src/starnest/data_acquisition/research.py`: BE-34
- `backend/src/starnest/data_acquisition/freshness.py`: BE-11
- `backend/src/starnest/data_acquisition/__init__.py`: BE-25, BE-34
- `backend/src/starnest/data_sources/llm/gates.py`: BE-17
- `backend/src/starnest/data_sources/llm/employers.py`: BE-19, BE-30
- `backend/src/starnest/data_sources/llm/fallback.py`: BE-19, BE-28
- `backend/src/starnest/data_sources/llm/reading.py`: BE-29
- `backend/src/starnest/data_sources/transport.py`: BE-29
- `backend/src/starnest/data_sources/who/adapter.py`: BE-09
- `backend/src/starnest/data_sources/published_tables/table.py` and `tables/{protected_planet_protected_land,statutory_paid_leave,wri_coastline_access}.csv`: BE-27
- `backend/src/starnest/storage/run_store.py`: BE-11, BE-34 ★ ST-09, ST-11
- `storage/queries/runs.sql`: BE-11, BE-34 ★ ST-09, ST-11, ST-12
- `storage/migrations/` (two new pairs): BE-11, BE-34 ★ migration numbering
- `backend/src/starnest/api/runs.py`: BE-11, BE-25 ★ API agent (BE-23)
- `backend/src/starnest/api/rules.py`: BE-34 ★ API agent (BE-21, BE-23)
- `docs/openapi.yaml`: BE-11 ★
- `docs/openapi.implemented.yaml` (generated): BE-11, BE-25, BE-34 ★ every endpoint change
- `ui/src/api/schema.ts` (generated): BE-11 ★ UI agent
- `docs/reqs.md`: BE-11, BE-34
- `docs/arch.md`: BE-19, BE-08
- `docs/known-issues.md`: BE-33, BE-34
- `backend/tests/unit/data_acquisition/test_retry.py`: BE-10, BE-11, BE-19, BE-34
- `backend/tests/unit/data_acquisition/test_ask_again.py`: BE-11, BE-34
- `backend/tests/unit/data_acquisition/test_run.py`: BE-19, BE-33, BE-08
- `backend/tests/unit/data_acquisition/test_freshness.py`: BE-25
- `backend/tests/unit/data_acquisition/test_research.py`: BE-34
- `backend/tests/unit/data_sources/llm/test_the_three_uses.py`: BE-17, BE-28, BE-29, BE-30
- `backend/tests/unit/data_sources/test_transport.py` and `eurostat/test_jsonstat.py`: BE-29
- `backend/tests/unit/data_sources/who/test_adapter.py`: BE-09
- `backend/tests/unit/data_sources/published_tables/test_table.py` and `test_the_shipped_tables.py`: BE-27
- `backend/tests/unit/test_composition_root.py`: BE-28
- `backend/tests/storage/test_acquisition_durability.py` (new): BE-19, BE-33
- `backend/tests/storage/test_run_store.py`: BE-11, BE-34 ★ storage agent
- `backend/tests/storage/conftest.py`: BE-34 ★ storage agent
- `backend/tests/acceptance/conftest.py`: BE-34
- `backend/tests/acceptance/test_gate_d.py`: BE-19
- `backend/tests/acceptance/test_runs_api.py`: BE-11, BE-08, BE-25
- `backend/tests/acceptance/test_llm_path_api.py`: BE-34
- Unchanged: `backend/scripts/acquire.py` (its call to `acquire` still works; BE-08 adds rejected figures to its printed report) and `S/main.py`.

**(c) Real defects next to these findings that are not in the review**
1. **BE-27 affects two more shipped tables.** Besides WDPA, 8 more rows are cut short at a comma: `statutory_paid_leave.csv` GB loses "which may absorb bank holidays", and `wri_coastline_access.csv` AT, CH, CZ, HU, LI, LU, SK lose ", so no coast". Making the loader strict without quoting these rows would stop the boot.
2. **A mixed retry silently drops a stand-in failure.** `execution.py:157` (with `:557`) keeps borrowable attributes only when the retry contains nothing but borrows. So a retry of a source failure plus a `stand_in` failure on an attribute none of the failing sources declares never retries the borrow. BE-11's items fix this.
3. **A source that hits the spend cap loses its failure log lines.** `execution.py:288-296` returns before the logging loop at `:298`, against arch 9.4. Moving the logging above the halt check is a one-line change; fold it into BE-19.
4. **`start_run`'s docstring is out of date.** `S/api/runs.py:233-241` still says "It runs inline today, and the response carries a finished run", but `:290` sends the work to the background. This text is published in `openapi.implemented.yaml`.
5. **Research refusals give the wrong reason.** `research.py:148-151` reports an unreachable model or a billed empty answer as "the model cited nothing", which hides the researcher's real reason. Passing `found.reason` into the refusal fixes it; UI-14 shows these refusals.
