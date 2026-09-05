# D6 — how the shipped criteria set becomes scoreable

**Prepared 2026-09-05.** `devplan.md` 7 D6, and the only thing standing between the application
and Gate A step 6.

**The problem in one line:** `local_employment` — the criteria set that ships — cannot produce a
score for any candidate, with or without perfect data, and every ranking so far has run on
`minimal` instead.

It turns out to be **three separate problems** wearing one label. Two are decisions; one is a
defect. They are independent, and the cheapest is worth taking first.

---

## The shape of it

All 41 criteria in the shipped set, by what stands in their way:

| | Criteria | Weight they carry | Blocked by |
|---|---|---|---|
| `as_is` over an **Index** | 10 | — | **(A)** a design question, answerable today |
| `as_is` over a **LabelSet** | 3 | 68 points across 3 pillars | **(B)** a catalog defect |
| `as_is` over an **AssignedScore** | 2 | — | Nothing structural; needs figures |
| `fixed`, needing anchors | 26 | — | **(C)** your judgement, and mostly needs data first |

---

## (A) May `as_is` rescale an Index from its declared bounds?

**Ten criteria turn on this, and it costs nothing to answer.**

An `Index` payload carries `scale_min` and `scale_max` — the bounds its publisher declares.
Numbeo's safety index is 0–100; the World Bank's governance indicators run −2.5 to 2.5. Today
`as_is` refuses any figure outside `0..score_scale_max`, so a World Bank figure of `0.72` scores
as 0.72 out of 100 and Numbeo's `72` scores as 72 — two numbers meaning similar things, scored
forty-fold apart.

**The question:** should `as_is` map a published figure from its own declared bounds onto the
score scale?

**The case for yes.** `data/payloads.py` already says the bounds exist so that a value can be
"rescaled deterministically, with no anchors anyone has to invent" — and that is exactly right.
Rescaling from bounds the *publisher* declared invents nothing. It is not `fixed` wearing a
disguise: `fixed` interpolates between anchor points **you** choose, and this reads a mapping
the source already published.

**The case for no.** It quietly changes what a stored figure means on screen, and two indices on
different scales become comparable in a way their publishers never claimed.

**Recommendation: yes**, with the goal applied afterwards as it is now. A published index is a
0-to-1 position dressed in the publisher's units, and refusing to read it that way is what makes
ten criteria unscoreable for no benefit. Where an index declares no bounds we refuse, as now.

> This is a code change of perhaps twenty lines in `evaluation/normalisation.py`, plus tests,
> and it unblocks 10 of the 41 criteria **without a single band being chosen**.

---

## (B) Three criteria are asking to be scored and cannot be

**Not a decision. `reqs.md` 3.3a is already clear and the catalog disagrees with it.**

| Criterion | Type | `is_scored` | Weight in its pillar |
|---|---|---|---|
| `country.climate_zone` | LabelSet | **true** | 30 |
| `country.remote_work_tax_treaty` | LabelSet | **true** | 20 |
| `country.international_employers` | LabelSet | **true** | 18 |

A `LabelSet` is a set of words — Köppen codes, treaty partners, firm names. **There is no
arithmetic that puts `Cfb` above `Dfb`**, which is why `evaluation/magnitudes.py` refuses to read
one and why `reqs.md` 3.3a says a LabelSet is matched against a threshold, never scored.

So these three carry 68 weight-points that can never become a contribution. Their weight would
redistribute away on every candidate, and coverage would report it as *missing data* — when the
figure is not missing at all, it is simply not a number.

**The fix is `is_scored = false` on all three**, which is not a downgrade: an excluded criterion
still matches, still gates, and still appears in the drill-down. What changes is that the
application stops claiming it can score a climate zone.

Worth noticing that this defect is invisible until something tries to score them, which nothing
had until `evaluation/` existed. It is a migration.

---

## (C) The 26 `fixed` criteria — and why most of them cannot be answered yet

**26 criteria need scale anchors, and 23 of them have no data to calibrate against.**

| Value type | Criteria | Have figures today |
|---|---|---|
| Quantity | 13 | 1 |
| Ratio | 8 | 2 |
| Count | 4 | 0 |
| Monetary | 1 | 0 |

**Choosing anchors for an attribute nobody has fetched is guessing.** What counts as a high
overcrowding rate is a judgement about a *distribution* — and until the distribution exists, the
judgement has nothing to rest on. `devplan.md` 7 wanted this answered at Gate A; the honest
answer is that it is answered **per attribute, as its data lands**, and Gate A does not need all
26.

### The three you can calibrate today

Real figures, 31 European countries, fetched from Eurostat:

| Attribute | Unit | Lowest | 25th | Median | 75th | Highest |
|---|---|---|---|---|---|---|
| `housing_cost_overburden_rate` | % of households | 2.4 | 5.2 | **6.4** | 9.8 | 26.4 |
| `overcrowding_rate` | % of households | 2.2 | 8.2 | **11.7** | 26.1 | 40.4 |
| `life_satisfaction` | 0–10 ladder | 6.3 | 7.3 | **7.4** | 7.7 | 8.1 |

Two things stand out, and both are arguments about anchors rather than facts about Europe.

**Overcrowding is enormously spread** — 2.2% to 40.4%, with the top quarter starting at 26.1.
Anchors placed evenly across that range would put almost every country in the same band.

**Life satisfaction is barely spread at all** — 6.3 to 8.1, and half of Europe sits between 7.3
and 7.7. Anchors that treated 0–10 as the meaningful range would score every country identically,
and the criterion would discriminate nothing. This is the clearest illustration of why
`percentile` needs no anchors and `fixed` needs good ones: **`fixed` is only worth having when
you have an opinion the data does not already contain** — that 7.4 is *fine* rather than merely
average.

---

## What I suggest

1. **Answer (A).** Ten criteria, no bands, one code change. This is the whole of the cheap half.
2. **Do (B).** A migration setting `is_scored = false` on three criteria, because the catalog
   currently contradicts `reqs.md`.
3. **Defer most of (C)**, and reframe it in `devplan.md`: anchors are chosen per attribute as
   its data arrives, not as one sitting before Gate A. Set the three above if you want them
   `fixed`; leave the rest until P4 brings their figures.

**Gate A step 6 does not need all of this.** It asks that the shipped set return
`insufficient_data` naming the required attributes it lacks — which becomes true and testable as
soon as (B) is done, because the remaining criteria then honestly have no figures rather than
being unscoreable by construction.

---

## What I need from you

- **(A)** — may `as_is` rescale an Index from its published bounds? My recommendation is yes.
- **(B)** — confirm the three LabelSet criteria become `is_scored = false`. I believe this is
  a defect rather than a choice, but it changes what the shipped set weighs and is yours to
  confirm.
- **(C)** — whether to set anchors for the three attributes that have data, or leave all 26 to
  be answered as figures arrive.
