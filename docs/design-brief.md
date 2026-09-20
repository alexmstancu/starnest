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

`ui/src/styles.css` carries the design's tokens; the whole interface is styled from that one
block of custom properties and nothing else, so a value changed there reaches every screen.
Wave 1 (tokens, Public Sans vendored into `ui/public/fonts/`) is done. Wave 2 (tables, controls,
sidebar) is waiting on the states above.
