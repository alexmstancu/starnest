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

- [ ] **Interaction states.** The mockup carries one hover rule and no `:focus-visible`, no
      pressed state, and nothing for the native controls -- so the application still ships the
      browser's default focus ring, which is an accessibility gap rather than a cosmetic one.
      **Nocturne's `readme.md` already states the rule** ("never leave the default blue focus
      ring": `outline: 2px solid var(--color-accent); outline-offset: 2px`, a pressed step one
      past the base, disabled at 45%), so this can be applied from a decision the same designer
      already made rather than invented. Disabled at 45% is done.
- [ ] **Responsive behaviour, desktop only.** Decided 2026-09-20: the interface should reflow
      across **web and desktop widths, not mobile** -- mobile is post-MVP. The design has no
      `@media` rules at all and lays its tables out as fixed-pixel grids (the ranking is
      1210px). What is needed is the order in which columns give way as a desktop window
      narrows. Proposed, pending confirmation: never drop Rank, Candidate or Score; drop
      Delta home, Pillars and Confidence first; Match status and Coverage last; Reason
      collapses under its row.

- [ ] **Three things the ranking could still show.** Not blocked -- these have data now
      (`pillar_scores`, `delta_vs_home`) -- but the drill-down's pillar cards do not yet filter
      the figures below them, which the design's own caption offers ("select one to filter the
      figures below").

- [ ] **The browser suite is order-coupled, and it always was.** `gate-c.spec.ts` and
      `minimum-end-to-end.spec.ts` both mutate **the same criterion**
      (`country.housing_cost_overburden_rate`) in **the same criteria set** (`minimal`), and
      both assert on the whole ranking afterwards. Each now restores what it found and picks a
      target different from the current value, which fixed the common case -- but roughly one
      full-suite run in three still fails on one of the two, because a gate answer and a weight
      edit are both global and the assertions are about a global ranking.

      Fixed already: parallelism (one worker, in order), non-idempotent targets, and missing
      restores. What remains is **isolation**, and the clean answer is to give each mutating
      spec its own criteria set rather than sharing `minimal` -- a set is a full copy (Q191),
      so this is cheap and would remove the coupling at its source rather than sequencing
      around it.

      `sanity.spec.ts` is unaffected and stable: it mutates only one setting and puts it back.

## TODOs for Alex
