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

**What would still help**, if the design is revised again: loading, empty and error states.
`useResource` distinguishes idle, loading, ready and error on every screen, and the mockup
draws only the last.

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

**Source rows have arrows and no drag grip.** The design has both. The arrows are implemented
and are what a keyboard reaches; dragging would need an operation the contract does not have
("place this source at that position" rather than "swap it with its neighbour"). Worth adding
to the contract if the gesture matters.

**Adults and children are number fields, not segments of 1-4 and none-3.** A segmented control
caps the count at whatever the design drew, and the domain has no such ceiling.

**The pillar slider's ceiling scales with how many weights share the hundred.** The design fixes
it at 40, which is four and a half times an even share of eleven pillars -- right for eleven and
wrong for three, where it silently clamps a weight the server would accept. The floor is still
40, so the eleven-pillar case is drawn exactly as designed.

**Cell tints in the comparison matrix are three bands rather than a continuous alpha ramp.** A
background colour is design, and design lives in `styles.css` (the lint rule says so); a
continuous alpha would have to be an inline style. The bands are the design's own thresholds --
nothing below 5%, full at 30%.

**A level is offered as soon as it holds a candidate.** The design disables City outright.
Which levels exist and which hold candidates are catalog rows, so the condition is read off
them: today that draws exactly what the design draws, and the day cities are nominated the
level enables itself.

**A saved ranking opens rather than restores**, as recorded above, and the list of them lives
in the sidebar while the act of saving lives on Rank.

## What would still help

The mockup's numbers are a full database: twelve failures, sixty-two unanswered values, a month
of spend. The application's cards are the same cards, and currently read zero -- which is the
truth about the last acquisition rather than a rendering fault. **Loading, empty and error
states remain undrawn**, as noted above, and are now the largest remaining gap between the file
and what a reader actually meets.

## A fourth pass, and two gaps that are the contract's rather than the screen's (2026-09-23)

Rank's header now carries the save control the design puts there, pillar names are capitalised
everywhere, the stored-values table stacks a figure's provenance under the name it belongs to,
Compare asks its two questions before drawing anything, the rules stage is a switch and a
consequence per rule, and the acquisition history opens a run by its own number.

**Two columns the design draws cannot be filled for a live ranking.**

*Score 0–100, weight used and points added, per attribute.* `getCandidateScoreDetail` serves
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
