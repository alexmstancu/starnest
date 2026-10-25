# What the interface needs from the design

**For Claude Design.** This project's design lives at `claude.ai/design` in the project
**"Starnest design"**, and Claude Design reads this repository directly -- the design's own
`github.md` maps each screen to the `.tsx` file it was built from. This file is the return
channel: what the implementation needs that the current design cannot express.

**`Starnest Product.dc.html` is the design being implemented** -- a white ground with green
accents. Its palette, type scale, spacing and column widths are complete and are being followed
exactly:

| | |
|---|---|
| Accent | `#0f766e`, with `#115e56` one step darker |
| Accent tints | `#f0fdfa` fill, `#99f6e4` border |
| Ground / surfaces | `#fcfcfd`, `#ffffff`, `#f9fafb`, `#f2f4f7` |
| Text | `#101828`, `#344054`, `#475467`, muted `#667085` |
| Borders | `#eaecf0`, `#d0d5dd` |
| Status | success `#067647` on `#ecfdf3`; warning `#fffaeb`/`#fedf89`; danger `#fecdca` |
| Type | Public Sans 500/600/700, `font-feature-settings: 'tnum' 1, 'cv05' 1` |
| Radius | 4px |

## 1. Interaction states

**Three hover states are already specified and are being implemented as given** -- they are in
`style-hover` attributes rather than CSS, which is why they are easy to miss:

| Element | Hover |
|---|---|
| Primary button (`#0f766e` fill, white text) | `background:#115e56;border-color:#115e56` |
| Secondary button (white fill, `#d0d5dd` border, `#344054` text) | `background:#f9fafb` |
| Link | `color:#115e56` plus underline |

What is missing is everything else. There is no `:focus-visible`, no pressed state, no disabled
state, and nothing for the native controls. This interface is keyboard navigable and has 24
buttons, 5 selects and 5 checkboxes, so each needs a state somebody decided rather than one I
invented.

Please specify, in the palette above and with no new hues:

| Element | States needed |
|---|---|
| Sidebar nav item | default, hover, `aria-current="page"` |
| Button, primary / secondary | **focus-visible, active, disabled** (hover is done) |
| Button, ghost / text-only, if the system has one | all states |
| `<select>`, text input, number input | default, hover, focus-visible, disabled, invalid |
| Checkbox | unchecked, checked, hover, focus-visible, disabled |
| Table row | default, hover, and the expanded "Show figures" row |
| Link | default, hover, focus-visible |

For focus, name the ring colour, width and offset. Say whether any transition is intended and
its duration, or that none is.

## 2. Behaviour below the design's width -- desktop only

**Scope decided 2026-09-20: web and desktop widths only. Mobile is post-MVP** and should not be
designed for now -- this is a local, single-user decision tool opened on a laptop, and a phone
layout would be effort spent on a case nobody has.

### What is needed

The tables are fixed-pixel grids -- the Rank table is
`minmax(230px,1.5fr) minmax(130px,0.9fr) 62px 66px 76px 74px 86px 92px`. A browser is not a
fixed canvas. Please say what happens below roughly 1100px: which columns collapse or drop and
in what order, whether the sidebar becomes a drawer, and the narrowest width worth supporting.

## What is deliberately not being asked for

**Nothing about markup.** The design lays its tables out as CSS Grid; this interface uses real
`<table>` elements, because 272 tests and every screen reader depend on those semantics. The
same pixels are reproduced with `table-layout: fixed` and the design's own column widths. That
is fidelity to how it looks, which is what the grid in the mockup was standing in for.

**No new features.** Everything the design shows already exists in the code -- external scores
in `CandidateDetail.tsx`, deltas and contributions in `CompareScreen.tsx`, run history and
"ask again" in `RunScreen.tsx`.

## Where the implementation has got to

**The design is implemented across all four tabs** (2026-09-20) -- chrome, the ranking table,
the drill-down, Configure's two columns, Acquire and Compare. `ui/src/styles.css` carries every
token, and the whole interface is styled from that one block, so a value changed there reaches
every screen.

**Both gaps above are now answered, and neither needed this file in the end.** The interaction
states were taken from the rule the same designer wrote into the Nocturne system's own readme
-- a hover tint, a pressed step past the accent, `outline: 2px solid <accent>; outline-offset:
2px` for `:focus-visible`, disabled at 45% -- so nothing was invented. Narrow-desktop behaviour
was decided by the household: **1280px, mobile post-MVP**, with `Δ home` giving way at 1440 and
`Pillars` at 1280, and the sidebar narrowing to 200px rather than collapsing, because the
active criteria set is what every number on screen is relative to.

**Loading, empty and error states are drawn and built** (2026-10-25). The design's Round 4
additions draw them for every tab, and round 3 built them: one read state for every panel,
whose error card offers Try again and never shows a default value as a fact (PL-001), the
designed empty cards with their one action (PL-011), and skeletons with `aria-busy` and the page
title drawn at once (PL-012). `useResource`, which this paragraph used to cite, is retired.

---

# The third pass, built against the file itself (2026-09-22)

**The two passes before this one were built from a summary of the design rather than from the
design.** `UX-REVIEW.md` is a changelog, and a changelog says what moved, not what it looks
like; the palette was inferred from a token diff and the layout from character counts. The
result was a product that carried the colours and almost none of the structure.

This pass was built with `Starnest Product.dc.html` rendered in one browser tab and the running
application in another, screen by screen. Everything below is either reproduced from that file
or is a divergence with a reason.

## Divergences, and why each one is deliberate

**No flag beside a candidate.** The design draws a 24x17 chip carrying an ISO code
(`ui/flags/nl.svg`). `GET /rankings` carries no ISO code and the catalog holds none, so the
column is left out rather than a country-to-ISO table being written into the client -- which
would be exactly the hardcoding `reqs.md` bars, for decoration.

**Source rows have the design's grip and its arrows** (updated 2026-10-25). This entry once
recorded the grip as missing because the contract had no operation to place a source at a
position. It has one now, `reorderDataSources` (PL-136, D36): every move sends the whole order
in one atomic request that keeps the stored priority tiers instead of renumbering them 1 to n,
and the arrows swap two sources that share a priority (PL-137). A row is dragged
(`useSourceDrag.ts`), and the arrows stay as the route for a keyboard. Nothing here diverges
from the design any more.

**Adults and children are the design's segments, 1-4 and none-3, plus a "More" segment.** The
segments are one click for almost every household; "More" opens a whole-number field for the
rest, because a segmented control alone caps the count at whatever the design drew and the
domain has no such ceiling. A stored count above the segments presses "More" with its number in
the field, so a household of five adults is neither unenterable nor shown as nothing pressed.

**The pillar slider's ceiling scales with how many weights share the hundred.** The design fixes
it at 40, which is four and a half times an even share of eleven pillars -- right for eleven and
wrong for three, where it silently clamps a weight the server would accept. The floor is still
40, so the eleven-pillar case is drawn exactly as designed.

**Cell tints in the comparison matrix are the design's continuous ramp** (updated 2026-10-25).
This entry once recorded three bands, because a continuous alpha seemed to need an inline style.
Since 2026-09-23 the tint is an SVG layer: its hue is a class in `styles.css` and its alpha is
the `fill-opacity` attribute (`divergingBar.ts`), ramping from 0.09 at 5% to 0.42 at 30%, as
the design draws it. Nothing here diverges from the design any more.

**A level is offered as soon as it holds a candidate.** The design disables City outright.
Which levels exist and which hold candidates are catalog rows, so the condition is read off
them: today that draws exactly what the design draws, and the day cities are nominated the
level enables itself.

**A saved ranking opens rather than restores**, as recorded above, and the list of them lives
in the sidebar while the act of saving lives on Rank.

**A deleted criteria set is one undo away for the session** (PL-033, P1-27, D-C03-7). Delete
acts at once with no confirmation, as in the design; on the set in use it is titled "Delete and
fall back to another set" and the selection moves to another set. Recent changes lists "Deleted
<name>", and undoing it restores the set exactly, back in use if it was and nobody has chosen
another set since. The history is session state, as the design's is, but it now lives above the
routes (PL-033): leaving Configure keeps it, and a write still in flight keeps its place and its
entry while another screen is showing. A reload still loses the way back in the interface,
while the set stays stored and `POST /criteria-sets/{id}/restore` still brings it back.
Configure sends one write at a time, so Delete is held while another change is being saved; a
deletion whose answer was lost is listed "Not confirmed" with Check again, never dropped, so its
restore is always kept; and an older entry for a deleted set says "Its set was deleted: restore
it to undo this." The design records "Switched to X"; switching is not a stored change, so it
is not listed here.

## What would still help

The mockup's numbers are a full database: twelve failures, sixty-two unanswered values, a month
of spend. The application's cards are the same cards, and currently read zero -- which is the
truth about the last acquisition rather than a rendering fault. **Loading, empty and error
states are no longer undrawn** (2026-10-25): the design's Round 4 additions draw them, and
round 3 built them (PL-001, PL-011, PL-012), as recorded at the top of this file.

## A fourth pass, and two gaps that are the contract's rather than the screen's (2026-09-23)

Rank's header now carries the save control the design puts there, pillar names are capitalised
everywhere, the stored-values table stacks a figure's provenance under the name it belongs to,
Compare asks its two questions before drawing anything, the rules stage is a switch and a
consequence per rule, and the acquisition history opens a run by its own number.

**Two columns the design draws cannot be filled for a live ranking.**

*Score 0–100, weight used and points added, per attribute.* **Closed 2026-09-23** by
`GET /rankings/candidates/{candidateId}`, which takes a criteria set and a level instead of an
evaluation id. It computes the whole level, because redistribution and the score scale are
properties of the pass and not of the row, and stores nothing — like the ranking it drills into.
The acceptance suite asserts that its `attribute_scores` are identical to the saved
evaluation's for the same set and level, so the drill-down reads the same whether or not the
ranking was kept. **The table now draws the design's eight columns.** What follows is why it
could not before. `getCandidateScoreDetail` serves
exactly these -- normalised score, effective weight after redistribution, contribution -- but it
takes an **evaluation id**, and a live ranking has no evaluation. Computing them here is barred
and rightly: normalisation is `evaluation/`'s, and a second answer on the client would be a
second, quietly different one. The table shows the weight the active set gives each attribute,
which is real, and leaves the other three out. **What would close it**: the same shape on
`GET /rankings`, or a per-candidate drill-down that takes a criteria set and a level rather than
an evaluation.

*Scope, values stored and values failed, per row of the acquisition history.* `GET
/data-acquisition-runs` carries id, status, both timestamps, the LLM call count and the cost.
The three the design shows are in `RunDetail`, so filling that column would be one request per
row. **What would close it**: those three counts on the list, where they are cheap -- they are
already derived in SQL for the detail.

Both are noted rather than worked around: a number on this screen is the server's or it is not
shown.

## A fifth pass: the Acquire screen, and the one control the contract has no verb for (2026-09-23)

The acquisition card now leads the screen, as the design has it: a reader arriving mid-run, or
just after one, came for that and was reading past it to standing figures. It carries the
status as a word, the scope as a sentence, the progress bar, **source by source**, what the run
came to, and what it was charged.

**"Source by source" needed the backend, and got it rather than an approximation.** A value row
already names both its run and its source, and so does a failure row, so what each source
contributed is a `GROUP BY` and not a new column: `RunDetail.by_source` gives `items_stored` and
`items_failed` per source, derived and never stored, for the reason Q217 settled for
`items_unanswered` -- a second record of the same arithmetic can disagree with the first. The
two counts are deliberately independent and sum to nothing: OECD may fail on an item the
estimate then answers, and both are true of that run.

**Each remedy's estimate moved inside the card that raised it.** Three remedies stand side by
side and a single panel under them saying "this would cost €0.32" cannot say which of the three
it is about -- a reader who clicked *Retry* was reading the figure for *Ask again*. The
confirmation moved with it, and *Cancel* became *Not yet*.

**The acquisition diff gained a fourth count, and it is the one that was missing.** "Refreshed"
meant both *the figure moved* and *the same figure came back*, which are opposite answers to the
only question the panel asks: a run that re-fetched a thousand values and moved none of them
cost something and changed nothing. Splitting them needed the figures themselves, which the
table now prints in an Earlier and a Later column -- so the verdict in the last column is
checkable rather than trusted. Two figures that could not both be read are called *refreshed*,
never *unchanged*: inventing agreement out of ignorance is the one thing this application exists
not to do.

## The Stop control, built (2026-09-24)

`POST /data-acquisition-runs/{runId}/stop`. The run ends **`halted_by_user`** -- a fifth status
beside `running`, `completed`, `halted_on_spend_cap` and `failed`, because the three ways of not
finishing are three different facts and recording a stop as either of the others would make the
history lie about why the figures stop where they do.

**It takes effect between sources, not between items.** The loop iterates per adapter, and a
source's fetch is one request over every candidate in most of them -- so that is the finest
grain at which a run can be interrupted without abandoning a request a publisher has already
answered. The design's wording is still exactly right: everything completed is kept, which is
the same guarantee the spend cap gives and the one Gate D proves by killing a process mid-run.

**The request is a column, not a flag in memory.** The loop runs as a background task; an
in-process flag would be invisible to the poll that reports the run's state and lost entirely
the moment anything ran in a second process. `stop_requested_at` is a nullable timestamp rather
than a boolean, for the same reason every value carries two dates: it answers "was it asked for"
and "when" in one column, and the second question is the one a reader has when a stop took a
while to land.

**The screen says `stopping`, which is not a status the server has.** It is the pair (running,
stop asked) said in one word. A run somebody has just stopped is still `running` until the
source in flight finishes, and telling a reader "running" there is true and useless. The button
withdraws once asked, because the first request is the one recorded and a live control after it
invites the thought that it did not work.

**Asking a finished run to stop is not an error and leaves no trace.** The outcome the caller
wanted is already true, and stamping a time would make a run that ended on its own read as one
somebody intervened in.

**The original entry, kept for the record.**

**One control in the design has no verb in the contract: "Stop — keep what completed".** There
is no cancel operation on a run. It is not a screen gap: a run is a background pass, and
stopping it means a cooperative check the acquisition loop does not have. Closing it would be a
`POST /data-acquisition-runs/{runId}/stop`, the loop reading a stop flag between items, and the
run ending `halted_by_user` -- a fifth status beside the four we have. **Not faked in the
meantime**: a Stop button that did nothing would be worse than none, because the spend cap is
the only halt this application currently honours and a reader must not believe there are two.

## The hand-entry form, built past the design's own scope (2026-09-30)

`UX-REVIEW.md` is explicit under *Out of scope by decision*: **"A working hand-entry form behind
'Enter a value by hand' — the button is a signpost."** So this is not a divergence from the
design; it is the codebase going past where the prototype stopped, which the prototype invited
by naming the remedy and binding it to `POST /values/manual`. There was nothing to be 1:1 with.

**One thing the design assumed that the catalog does not bear out.** Item H puts hand entry
inside *"Attributes with no data source at all"*. Against the real catalog those two sets are
**disjoint**: every attribute that declares `manual_entry` also declares sources
(`international_employers` names the LLM path, `residency_admin_ease` names national law), and
no attribute with zero sources permits hand entry. So the card's remedy column honestly reads
"hand entry is not permitted for this attribute", and the form lives in a second card,
*"Figures you can enter by hand"*. **The design's intent is kept and its placement is not** --
if the prototype's seeded data had matched the catalog, item H would have found this too.

**The two lists overlap now** (updated 2026-10-25, PL-088). `residency_admin_ease` is permitted
hand entry and no adapter can fetch it, so it is honestly in both cards: the "no data source"
card's remedy reads "Enter a value by hand" and links to its row in *"Figures you can enter by
hand"*, which opens the form there. The form still lives in one card only, because it is the one
that lists every attribute a person may answer, including those a source can also fetch.

It is built in the design's own idiom — its `.field` markup, its tokens, its notice shapes
— and what follows is the request for the next sync. **Nothing here should be taken as the
design's decision; it is ours, and it is reversible.**

**Two editors, not ten, because two is what the catalog permits.** Five attributes declare
`manual_entry`, and their types are `LabelSet` (`international_employers`,
`remote_work_tax_treaty`), `AssignedScore` (`residency_admin_ease`, `pension_portability`) and
one `Quantity` a source already answers. Monetary, Count and Ratio have no attribute that would
accept a hand-typed figure, so an editor for them would be a form nobody can open. A permitted
type with no editor **says so in its remedy** rather than offering a button that leads nowhere.

**It opens inside the row that reports the gap**, not in a dialog. The table says what each gap
is worth, which is the thing a reader is deciding on, and a dialog would cover it. One form at a
time: two would put two candidate pickers and two date pairs on screen with nothing saying which
belonged to which attribute.

**Three things it refuses to guess**, all the same shape:

- **No default scale.** An `AssignedScore` of 7 means nothing without knowing it is out of 10 or
  out of 2.5. `0–10` is the obvious default and still a guess, so the form asks.
- **No period inferred from the clock.** Typing a figure today says nothing about the year it
  measures. The reference period and the retrieval date are different questions and are never
  merged (`reqs.md` 3.6), so both dates are required and the retrieval date is stamped for you.
- **`assigned_by` is always `human`.** The field exists to keep a judgement somebody made apart
  from one a model produced; a form that could send `llm` would make the distinction worthless.

**It reads back what it stored**, not "done" — a typo is invisible in a success message, and a
hand-typed value is the one kind that cannot be re-fetched at any price (Gate D).

**What the design could still rule on:** whether the two editors should look alike at all (a
comma-separated text field and four numeric fields are very different shapes), whether the
confidence picker belongs in the form or should default silently, and whether the success line
should link to the value in the Rank drill-down.

**Answered 2026-10-25.** The design's Round 4 additions drew the form, the confidence picker
and "See it in the Rank drill-down", and round 3 built the link (PL-084). The label editor is
one label per line rather than the drawn comma-separated field (D22), recorded with round 3's
other divergences at the end of this file.

## A sixth pass: the return channel for the next sync (2026-10-12)

A review read the running application and the UI code against this file (the live `.dc.html` was
not re-fetched in that pass). Nothing in the application regressed from the design; what follows
is the consolidated request for the next design revision, so it is one list rather than scattered
through the passes above.

**Please draw these -- they are built and shipping, but the mockup does not show them:**

- **The hand-entry form** (the 2026-09-30 pass). The mockup has only the signpost button
  (`UX-REVIEW.md`: "the button is a signpost"); the implementation has two editors in the
  design's own `.field` idiom -- a `LabelSet` comma field and an `AssignedScore` numeric set --
  with a required scale, a required reference period beside the stamped retrieval date, a
  confidence picker, and a success line that reads back what it stored. The three open rulings
  are listed at the end of that pass.
- **The Stop control's states** (the 2026-09-24 pass). The mockup draws the control; the
  implementation adds the `stopping` micro-state (the pair "running, stop asked" said in one
  word), the button withdrawing once asked, and the two distinct halt statuses `halted_by_user`
  and `halted_on_spend_cap`. Each is a state somebody should draw rather than one we invented.
- **The acquisition diff's fourth count** (the third pass, "Earlier and Later"). The mockup's
  diff has three verdicts; the implementation splits "refreshed" into *moved* and *unchanged* and
  prints the two figures in an Earlier and a Later column so the verdict is checkable.

**All three are drawn now** (2026-10-25): the design's Round 4 additions draw the hand-entry
form, Stop with both halt outcomes, and the four-count diff. The comma field named above has
since become one label per line (D22).

**One divergence to rule on:** the **country-code chip**. The design draws a flag (a 24x17 chip
carrying an ISO code from `ui/flags/*.svg`). The catalog holds no ISO code and writing a
country-to-ISO table into the client is the hardcoding `reqs.md` bars, so the earlier passes left
the column out. It is now filled a different way: `GET /rankings` carries a `country_code`, and
the Rank table renders it as a bordered two-letter chip in the design's own placeholder slot (BG,
MT, CY). **Please decide** whether that two-letter chip is the official treatment, or whether the
flag stays the intent for the day an ISO/flag source is added to the catalog. (This supersedes
the "No flag beside a candidate" note in the third pass, which recorded the column as omitted.)
The design's Round 4 additions answered: the flag remains the intent, and the two-letter chip
stands in until the catalog carries flag images.

**The loading, empty and error states are no longer owed** (2026-10-25). This was the standing
ask; the design's Round 4 additions draw them for every tab, and round 3 built them (PL-001,
PL-011, PL-012).

**Two notes above are now stale (implementation caught up, nothing to add):** the Acquire history
list now carries the per-row *Stored* and *Failed* counts the fourth pass flagged as a contract
gap, and the run-summary progress meter now renders its three segments in colour (completed teal,
failed red, unanswered grey) -- it had regressed to a single black bar for want of a CSS rule per
segment kind, fixed 2026-10-12. Both match what the design already specified.

## Gate research, one question at a time: progress, Stop and outcome have no design (2026-10-19)

UI-01 and UI-14. Gate research went as one request for the whole level, which no proxy ceiling
could hold; it is now a **pass the Configure screen sends one gate per request**, held to the
spend cap by the page, because the server's meter starts again with every request. What a pass
shows after the press is new, and three things are built and shipping with no design to follow:

- **Progress.** A status line, always on the page and empty until a pass starts, that names the
  gate being asked and the level the pass researches ("Asking UK Skilled Worker route at the
  Country level"), with the questions asked so far beside the estimate's count ("1 of 3
  questions") and the spend beside its "at most" ceiling (PL-151, PL-159). Estimate, Research and every Confirm are held -- `aria-disabled`, focus kept --
  while it runs.
- **Stop.** "Stop after this question", beside the held Research button while a pass runs. It
  takes effect once the request in flight answers, because the server finishes a call it has
  begun and keeps what it found, and it holds as "Stopping after this question…" once pressed,
  as the run's Stop does.
- **Outcome.** How the last pass ended, in the same line: finished; stopped at the spend cap,
  with the cap, the spend and the questions asked; stopped by you; refused, which spent nothing;
  failed, whose spend is not known; or not started, because the cap or the gates could not be
  read. Every end the reader did not ask for takes the amber warning band, and one that came
  from an error also shows its error notice. The pass spends the estimate that allowed it, so
  the next pass needs a fresh one -- and focus moves to Estimate when Research leaves the page
  under it.

They are built in the design's own idiom -- `.panel__hint` for the line, `.notice--warning` for
an end nobody asked for, a held `.button` -- with no new class and no new token. **Please draw
the three states**, and say whether the outcome belongs in the line or in a card of its own:
it is the one place on this screen that reports money already spent.

**The outcome now stays until it is dismissed** (PL-052, 2026-10-25). It is kept above the
screen, so a visit to another tab and a reload within the tab keep it, and a **Dismiss** under
the line removes it (focus goes to Estimate). A pass the page stopped running -- the reader
left Configure or reloaded mid-pass -- is a seventh ending, **abandoned**, said with what it
had spent and, when a question was in flight, that what that question spent is not known; it
takes the amber band. The money itself is also in Acquire's "Spent this month", which includes
research. **Please draw the Dismiss** with the line.

## The lock is a padlock, and held controls have one look (2026-10-24)

**The lock draws a padlock, not a disc** (NEW-68, D30) -- a deliberate divergence. The design
draws a filled or hollow disc in a 26px square, which reads as a radio button rather than a lock.
Both locks, pillar (26px) and criterion (24px), now draw one inline-SVG padlock inside the same
bordered square: **shut and filled when the weight is held, open when it is free**, coloured by
the button's text colour so the teal tint still says "on". It has a hover state (teal border)
and a pressed state (the tint one step deeper). The carets and arrows stay as they are. **Please
draw the padlock in the design file**: a later sync that brings the disc back would undo this.

**A held control looks held, the same way everywhere** (NEW-46, D27, D28): 45% opacity and a
not-allowed cursor, faded only after 120ms so a quick save does not make twenty controls blink.
This now covers the weight sliders, both locks, the "Missing figure blocks scoring" box and the
acquisition numbers in Acquire's history, which looked unchanged while held.

## Round 3: what was built against the design, and why (2026-10-25)

**Every decision round 3 took against `Starnest Product.dc.html` and its README, in one place**
(PL-180, UF-022). Each entry was checked against the code at `738a3ec` before it was written,
and names the plan item or decision behind it (`docs/copilot-round3-plan.md`). Where the README
and the live file disagree, the file wins, as it always has. **Nothing here is the design's
decision; each is ours and reversible**, and the next sync should rule on it rather than undo
it by accident.

### Configure

**Edits write straight to the set; there is no working copy** (D2, `reqs.md` Q168). The design
keeps working weights apart from the stored set, with an "unsaved changes" pill, Save and
Discard, and a guard on every route that would replace them. Q168 and `arch.md` decided the
other way: a weight moved is stored, Recent changes undoes it, and Duplicate is the way to
experiment on a copy. Building the design's model would make a second representation of every
criteria set.

**A number field takes digits and at most one point, and nothing else** (D7, PL-024). The design
shows `7,400` in the box. A comma is refused with a sentence saying what to type, because the
sidebar prints "€72,000.00" while "1,5" is a decimal in much of Europe, and any reading of a
comma is a guess; a filter that once read "72,000" as 72 and said "Saved." is why. Money takes at
most two decimals, so "72.000" cannot become 72 through the point either (`format/typedNumber.ts`).

**Forms keep an explicit Save** (D8, PL-025). The design saves each field as it changes; doing
that would move Rank and the sidebar on every keystroke. What is built: Save, "Saving…",
"Saved." only after a save the reader has not typed past, and a field's refusal cleared when
that field is edited. D8's "Not saved yet" line and a prompt before leaving with a draft are not
built at `738a3ec`, so they are not recorded here as done.

**The rule editor has a layout the design never drew** (PL-026, PL-027). It sits on the stage
grid (`.rule-form__row`, `minmax(190px, 1fr)` like stage 6), with legends in the field-label
style, Save rule and Discard changes held, never disabled, while nothing has changed. A refused
rule is reported inside its own form: the fields marked, the stored rule back in them (P55), and
"You asked for: …" with "Put my values back".

**The comparator limit's 1–20 is a contract bound** (PL-028, PL-030, D-C02-A). The design's
DECISIONS called twenty "not a contract one". It is now stated in `openapi.yaml`, enforced by the
server and held by a database check, and every numeric field's bounds are read from the contract
(a test holds them to it). Leaving the limit unset says that Compare refuses every comparison,
rather than the design's "default 5" (UI-31).

**A criterion that is not scored reads "Not scored, matching only"** (D31, PL-111). The design
has no control for exclusion, so how such a row reads was ours to choose: the chip, the slider
held, and "Required" only where a criterion is scored and blocks.

**An enforced gate's cost line is the live ranking's** (PL-164, PL-156). The design's prototype
derives it from its own data. Here it lists the candidates whose reasons for not matching, or
warnings, name the gate in the ranking the server computed, because a citizenship that clears a
gate removes a recorded refusal and free movement rules out without one, so the recorded
answers alone would contradict the ranking. It may therefore read "Applies to no country right
now." while answers are recorded.

**A switched-off gate's "would remove" comes from the recorded answers** (PL-164). A gate that is
off is not evaluated, so its line reads the confirmed answers, with "— not while this is off."
as the design has it; where one of the household's citizenships clears the gate, it reads
"Removes nobody: your citizenship clears it." instead.

**A switched-off compound rule reads "Not applied, so it flags nobody."** (PL-156), or "removes
nobody" when the set holds it as a gate, without the design's "— not while this is off." A
compound rule reads figures rather than recorded answers, and a rule that is off is not
evaluated, so there is nothing to say it would do.

**A compound rule's description reads "Applies when …" whatever its outcome** (PL-155, PL-158).
The design's descriptions are prose ("Comfortable today, projected heat days above 35 °C by
2050."). Ours is written by the server from the rule's own conditions, naming attributes and
bands, so it cannot disagree with them; and each set holds a rule as a gate or a warning, so a
description that said what the rule does would contradict every set that holds it the other
way. The row's select says which it is.

**A gate row reads "Cleared by citizenship of Ireland or United Kingdom."** (PL-164). The
design says "a British or Irish passport". The catalog names countries and has no nationality
adjectives, and an adjective table in the client would be the hardcoding `reqs.md` bars.

**The gate proposals' heading is an `h3`** (PL-162). The proposals review is not designed; the
panel sits inside stage 4, whose heading is the `h2`, beside the Gates and Compound rules `h3`s.

**Gate answers have an area the design does not draw** (PL-152, PL-153, D52, D53). Below the
rules in stage 4, keyed by level and outside the set's rules panel, because an answer is
objective and belongs to no set: a form to record, override, correct or rule out an answer, and
the recorded answers with their period and age, an ended period said as "Ended, still applied"
rather than expired. Each recorded row has Change and Re-check; a proposal has Take the proposal
and "Answer … differently", which fills the form. None of these has a design.

**Recent changes saves one change at a time** (PL-033, D41). While a write is in flight every
other change and undo waits, and the rail says "A change is being saved; the next waits until it
is stored." A change whose answer was lost on the way is listed with "Not confirmed: the server
did not answer, so whether this took effect is not known yet." and Check again, never dropped.
The design draws neither state.

**An undo after a move that left the rest at 0 says so before it is pressed** (D38). The design's
undo restores the whole snapshot. Ours re-sends the real request, and the server cannot put back
weights a move left at 0, so the entry reads "Undo cannot restore the rest of this pillar: this
change left them all at 0, so undoing it shares their weight out evenly."

### Acquire

**The acquisition diff keeps a Source column** (C04-N8, PL-060). The design's table is Country ·
Attribute · Earlier · Later · What happened, because its prototype has one source per pair. The
real data has two for the total tax rate, so the unit compared is the pair and its source, and
two sources answering one pair are two rows. A rejected figure is no usable figure: its cell
reads "rejected", so a later rejection over a stored figure "went missing".

**Two holdings tiles are labelled differently** (PL-051). "Candidates scored", not "Countries
scored", because the panel is drawn for whichever level is chosen and no code may assume the
level is countries (`reqs.md` 3.1); it is counted from the ranking the sidebar tallies, "under"
the set's name (C04-N4). "Past their allowed age", not the file's "Older than 365 days" (C04-N3):
the design labels the tile by the refetch setting and explains it by the attribute's maximum
age; the tile counts the latter, the fact Rank lowers confidence on, and the refetch count moved
to the refresh card.

**A fourth remedy card, "not reached"** (C04-N7, PL-050). The design has three, and a stopped
run's never-asked items fit none of them; calling them "unanswered" was UF-074's defect. Drawn
only when there are any, "No source was asked yet. Worth asking.", with "Ask N not reached"
through the same estimate and strip as the others.

**The cap caption reads "the cap is €X per acquisition and per research pass"** (C04-N9,
PL-057). The file says "cap is €5.00 per acquisition", under a monthly total that includes
research; the position is kept and the sentence completed, in stage 6's words (PL-031).

**The run card's spend line adds the cap after a run ends** (PL-056). The design reads "Charged
€X of the €Y ceiling."; ours adds ", held to the €Z cap." or ", with no cap.", from the ceiling
and cap the run started with, because a cap edited later did not change that run's meter.

**The halted headings are "Stopped by you" and "Halted at the spend cap"** (PL-122), from the
file's Round 4 state, in place of the README's single "Stopped early", which cannot tell a stop
somebody asked for from a halt at the cap. A failed run reads "Acquisition did not finish",
which neither draws.

**The refresh card keeps its heading and puts its counts in the lead** (PL-121). Its heading
names what it starts, "An acquisition over every country candidate", where the design has a
26px count beside "refresh everything". The lead says how many values it re-asks, worded from
the refetch setting, and how many in use are past their allowed age.

**A retry that spans several runs becomes a run scoped to its exact pairs** (PL-124, D32). The
design's "Retry 2 selected" assumes one retry, and the server's retry belongs to one run. A
selection from one run is retried through it and asks only the sources that failed; one spanning
several runs, or pairs no run asked about, is a scoped run over exactly those pairs, which asks
every switched-on source. The strip names the sources it asks before anything is agreed to.

**Hand entry takes one label per line** (D22, PL-090). The design draws one comma-separated
field. An employer's name can contain a comma ("Booking Holdings, Inc."), so a comma stays part
of the name, and the chips preview the labels that will be stored.

**The read-back names the source "Manual entry"** (C06 N6, RB-4). The design reads "under
manual."; ours is the catalog's name for the source, never its id.

**The form takes focus when it opens** (C06 N8). Focus moves to Candidate, departing from the
disclosure pattern, and Close returns it to the row's toggle. A stored figure clears the form
(C06 N5, UI-06), where the prototype keeps it, so a second identical row is not one click away.

**The hand-entry and no-source cards overlap** (PL-088). Recorded under the 2026-09-30 pass:
an attribute only a person can answer is in both, and the no-source card links to its form.

### Rank

**An address that names what cannot be opened says so** (PL-084, C06 N4). The design's
"See it in the Rank drill-down" opens a candidate and pillar. Ours adds that row and keeps the
reader's other open rows, where the prototype replaces them; and when the address names a
level that does not exist, a candidate the ranking does not hold, or a pillar the candidate is
not scored on, a notice says what was not opened rather than opening nothing silently.

**The candidate detail has a Gates block** (PL-154, `reqs.md` 8.4). Gate · Answer · Holds for ·
Recorded · Source and pages, with an override's date and reason, and an override mark in the
reason cell. The design draws no gate answers in the drill-down.

**Outside opinions are grouped by publisher and series** (PL-171, D64). The design lists them
one row per figure. Two indices from one publisher are two groups, and an earlier edition is
labelled "Earlier edition, kept as history", only where the server marks it not current.
