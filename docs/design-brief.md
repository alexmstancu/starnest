# What the interface needs from the design

**For Claude Design.** This project's design lives at `claude.ai/design` ("Starnest analyst
dark design"), and Claude Design reads this repository directly -- the design's own `github.md`
maps each screen to the `.tsx` file it was built from. This file is the return channel: what
the implementation needs that the current design cannot express.

`Starnest Product.dc.html` is being implemented now. Its palette, type scale, spacing and
column widths are complete and are being followed exactly. Two things are missing, and both are
things a static mockup cannot show rather than oversights.

## 1. Interaction states

The mockup contains one interaction rule in total -- `a:hover{color:#115e56}`. There is no
`:focus-visible`, no `:active`, no `:disabled`, and no row hover. This interface is keyboard
navigable and has 24 buttons, 5 selects and 5 checkboxes, so every one of those needs a state
that somebody decided rather than one I invented.

Please specify, in the existing palette and with no new hues:

| Element | States needed |
|---|---|
| Sidebar nav item | default, hover, `aria-current="page"` |
| Button, primary / secondary / ghost | default, hover, focus-visible, active, disabled |
| `<select>`, text input, number input | default, hover, focus-visible, disabled, invalid |
| Checkbox | unchecked, checked, hover, focus-visible, disabled |
| Table row | default, hover, and the expanded "Show figures" row |
| Link | default, hover, focus-visible |

For focus, name the ring colour, width and offset. Say whether any transition is intended and
its duration, or that none is.

## 2. Behaviour below the design's width

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
