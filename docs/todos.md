# Alex Stancu's notes

## TODOs for AI
- [x] Visual SQL Diagram. Check online if there's a tool we can use to generate a visual representation (graph-like) based on the tables and relations we have.
      Done: **Liam ERD** (github.com/liam-hq/liam, Apache-2.0), wired up as `make schema-diagram` / `make schema-diagram-open`.
      Generated from a dump of the live database, so the diagram shows what is actually running.
      Output lands in `docs/schema/` and is gitignored — regenerate rather than commit.
      Runner-up if search across many tables ever matters more than a picture: Azimutt (MIT).
      Not adopted, still available: `tbls`, which adds a `diff` that fails CI when docs drift from the schema.

## Open after the design pass (2026-09-20)

The design (`claude.ai/design`, project **Starnest design**, file `Starnest Product.dc.html`)
is implemented across all four tabs. Two things it does not specify are still outstanding, and
`docs/design-brief.md` is the request sitting in the repo for Claude Design's next sync.

- [x] **Interaction states.** Done 2026-09-20. The mockup carries one hover rule and no `:focus-visible`, no
      pressed state, and nothing for the native controls -- so the application still ships the
      browser's default focus ring, which is an accessibility gap rather than a cosmetic one.
      **Nocturne's `readme.md` already states the rule** ("never leave the default blue focus
      ring": `outline: 2px solid var(--color-accent); outline-offset: 2px`, a pressed step one
      past the base, disabled at 45%), so this can be applied from a decision the same designer
      already made rather than invented. Disabled at 45% is done.
- [x] **Responsive behaviour, desktop only.** Decided 2026-09-20 and built: the floor is
      **1280px** -- every MacBook, any 1440 or 1920 monitor, and a half-screen window on a 2560
      one. Mobile stays post-MVP.
      Columns give way in order of how far they sit from the question: `Delta home` at 1440,
      `Pillars` at 1280, and `Confidence`, `Coverage` and `Match status` would follow if it ever
      came to that. `Rank`, `Candidate` and `Score` never go. Nothing is lost -- both dropped
      columns are on the candidate's own row in the drill-down. The sidebar narrows to 200px
      rather than collapsing, because the active criteria set is what every number on screen is
      relative to.

- [x] **The pillar cards filter the values below them.** Done 2026-09-20, the last thing the
      design offered that the code did not do. The map from attribute to pillar comes from the
      **active criteria set**, not the catalog: a set that does not score an attribute has no
      pillar for it, and a descriptive attribute belongs to no pillar's contribution at all --
      showing it under one would imply it counted.

- [x] **The browser suite was order-coupled.** `gate-c.spec.ts` and
      `minimum-end-to-end.spec.ts` both moved the same criterion in the same criteria set
      (`minimal`) and then asserted on the whole ranking, so each could land inside the other's
      before-and-after -- about one full run in three.
      Done: each spec now duplicates `minimal` into a set it owns (`e2e_gate_c`, `e2e_min`) in
      `beforeAll` and deletes it in `afterAll`. A set is a full copy, never a sparse overlay
      (Q191), so a duplicate is a complete and independent opinion about the same attributes.
      Also: one worker rather than parallel, restores of what each test found, and a weight
      target computed from the current value instead of a fixed one.
      Six consecutive clean runs, and the suite went from ~48s to ~14s -- the tests had been
      waiting on each other's writes.

## The second design sync (2026-09-21)

The design grew from 114KB to 197KB between syncs, and **the palette barely moved** -- almost
all of it was new structure. Seventeen items, A to Q, built in five waves. The whole thing is
UI: **no backend change, no migration, no contract change.**

The sharpest tool was not the design file. Enumerating the 41 operations FastAPI serves against
every function in `ui/src/api/endpoints.ts` found **seven with no client at all**, and all
seven landed on three design items. The design was not asking for new capability; it was
noticing capability already built and never surfaced. Worth repeating before any future UI
wave.

- [x] **A** saved rankings, **J** duplicate a set, **H** the unsourced-attribute card -- the
      seven unused operations, now called.
- [x] **G** per-attribute weight locks, **K** settings that say "not set", **M** several Rank
      rows open, **N** provenance that links, **F** raw figures in Compare, **L** the
      comparator ceiling, **B** a progress bar, **C** grouped selectable failures with a
      scoped re-ask, **D** a confirmation before anything spends, **E** change history with
      undo, **I** one household vocabulary, **O** what each rule costs.
- [x] **R3** the unset score range now names the setting and offers the way to it. **R7**
      needed no work: our confidence readout always gave all three bands.

**Three things the sanity suite earned its keep on**, none visible to 469 unit tests:

1. **A lock was readable and unclickable.** `.toggle` takes its width from a flex parent and
   has none standing alone, so a lock whose only child was a `visually-hidden` span collapsed
   to nothing. It affected the **pillar** locks too, which had shipped that way.
2. **The mock was kinder than the server.** A locked criterion's weight cannot be moved even
   to the value it already holds, so a lock must travel **alone**. The mock accepted both
   together and certified a protocol the backend rejects.
3. **`setChecked()` cannot drive a server-backed toggle.** It asserts the new state the moment
   it has clicked, while a controlled checkbox flips only when the PATCH resolves. `click()`
   then `toBeChecked()` polls, which is the right shape.

**Deliberate divergences from the design, both for the same reason:**

- **Opening a saved ranking shows it; it does not restore it.** The design loads a saved
  weight vector back over the live set. Our contract freezes the criteria *and* the score
  scale and returns a whole `Ranking`, so there is a real thing to look at -- and restoring
  would be the very act the design's own R6 calls most in need of an undo.
- **R5 and R2 do not apply to us.** Our country-level gates are answered per candidate rather
  than derived from the household, and our runs genuinely store values. Both were faults in
  the prototype's own fake logic.

**`known-issues.md` P42 is stale in the review.** It was fixed 2026-09-16: `retry_run` and
`ask_again` both take `spend_cap_eur` and `uncapped_is_accepted`. The confirmation step is
still worth having; it is not the only ceiling.

### Still open, and deliberately

- [x] **P, the per-source enable toggle.** Done: `0480` added the column and the panel
      switches a source off.
- [x] **Q, the acquisition diff.** Done, client side from `/values?include_superseded=true` as
      predicted. Extended 2026-09-23 with the Earlier and Later figures, which is what let
      "refreshed" split from "unchanged" -- one word that meant both *the figure moved* and
      *the same figure came back*.
- [x] **"Refetch data older than N days."** **Decided 2026-10-08: deferred, and the
      per-attribute model kept.** The design's stage 6 offers a global "older than N days" knob;
      our staleness is already per-attribute `max_age` (`reqs.md` 7.1), derived from each source's
      publication interval -- which is the more honest model, because an annual index and a daily
      weather figure go stale on different clocks and one global N would either re-fetch fresh
      annual data or leave daily data stale. A run already re-asks exactly what has aged past its
      own `max_age`, so the global knob is a worse model of a thing we already do and is not built.
      Revisit only for a *force a re-fetch of still-fresh data* feature, which is manual refresh --
      a different thing, and post-MVP.
- [x] **The hand-entry form behind "Enter a value by hand."** Done in the second design sync
      (2026-09-21) and verified still complete 2026-10-07. `RunScreen` -> `OpenToHandEntry` ->
      `ManualEntryPanel`, with the pure builder in `manualEntry.ts`. **Not "a payload editor per
      value type" after all** -- it has editors for the two types any `manual_entry` attribute
      actually declares, `LabelSet` and `AssignedScore`. The catalog's five manual-entry
      attributes are two of each plus `naturalisation_pathway`, a `Quantity` that already carries
      32 sourced figures and so is never hand-typed. An editor for the other eight types would be,
      in the module's own words, a form nobody can open. 18 + 95 tests cover it.
- [x] **A saved evaluation cannot be deleted.** Still true, and still on purpose -- a saved
      evaluation is a measurement somebody chose to keep, and the protection is the absent
      operation. Done 2026-09-24: **a test chose nothing**, so the browser suite prefixes its
      notes with `[e2e] ` and the boot sequence discards those (`arch.md` 9.2). Needed `0482`,
      which cascades an evaluation's snapshot, because a delete was not merely refused at the
      API -- it was impossible at all. The two halves of the marker are in different languages
      and cannot share a constant, so `tests/unit/test_architecture.py` reads the spec file and
      pins the literal.

- [x] **Stop a run.** Done 2026-09-24. `POST /data-acquisition-runs/{runId}/stop`, a
      `stop_requested_at` column the loop reads **between sources**, and a fifth status
      `halted_by_user`. See `docs/design-brief.md` for why it is a fifth status and not a reuse
      of one of the four.

## MVP close — remaining actions (2026-10-08)

The seven-item close list, with state. Four are done in-repo; three need a hand that only Alex
can give (a secret key, a live-DB delete the safety classifier guards, and the real heat figures).

- [x] **3. Coverage decisions recorded.** `catalog-blockers.md` opens with the consolidated call;
      housing was already resolved by `0488`.
- [x] **4. Clear the stray Greece gate answer.** *Prepared, needs Alex to run* -- the live-DB
      `DELETE` is guarded by the auto-mode classifier. Run it yourself with the `!` prefix:
      ```
      ! docker exec starnest-database-1 sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "BEGIN; DELETE FROM match_rule_result_citation WHERE match_rule='"'"'not_manually_excluded'"'"' AND candidate='"'"'country.greece'"'"'; DELETE FROM match_rule_result WHERE match_rule='"'"'not_manually_excluded'"'"' AND candidate='"'"'country.greece'"'"'; COMMIT;"'
      ```
      It is runtime dev-DB data (no migration seeds it), so a migration is the wrong tool. A
      `make check` run would also clear it as a side effect, since the suite truncates writable tables.
- [x] **5. "Refetch older than N days" decided** -- deferred, per-attribute `max_age` kept (above).
- [x] **6. Doc drift fixed** -- 45 operations, 85% coverage comment.
- [x] **1. Copernicus.** **Done 2026-10-08.** The key + licence proved the shipped CSV adapter
      was built on a wrong assumption -- the API returns **NetCDF**, nine EURO-CORDEX model runs in
      one zip. Reworked: `netCDF4` dependency added, `response.py` parses the `.nc` and takes an
      equal-weight-per-model ensemble mean over the 2041-2070 horizon, a real nine-model fixture
      pins the values, independently reviewed (four findings fixed), `make check` green. **The
      figures land in the store on the next `make acquire` / run** (a DB write -- run it yourself
      with the `!` prefix when ready, since the classifier guards DB writes).
- [ ] **2. `mild_now_brutal_later`.** The rule already exists (`0103`, `AllConditionsHold`,
      `warning`) with **both** condition thresholds `NULL`: `country.avg_annual_temperature` (a
      comfortable band) **and** `country.projected_summer_heat_days` (above a floor). So this is an
      `UPDATE` of the two `compound_rule_condition` thresholds, not an insert. Needs: (a) the
      projected figures stored (the acquire run above), and (b) a **household decision on both
      bands** against the real joint distribution -- the project reserves these (`reqs.md` 7.4,
      "both bands TBD, meant to meet real figures first"). The projected floor can come from the
      real spread already in hand (Cyprus 62, Spain 54, Greece 34, Romania 31, Italy 28, France 16,
      Germany 9, UK 0.4 hot days/yr); the comfortable-temperature band needs the
      `avg_annual_temperature` distribution, which is a DB read. Best done right after the acquire
      run, then optionally flip `is_applied` to true on `local_employment` (`0104` has it `false`).
- [ ] **7. Rebuild + migrate + smoke.** The running stack predates the last four commits. Run:
      ```
      make docker-build && make docker-migrate && docker compose restart schema-diagram
      ```
      then `make check` (expect green -- only docs/comments changed) and a hands-on walk of all
      four tabs at http://127.0.0.1:5173.

## TODOs for Alex
