# What is blocked in the catalog rather than at the source

**Prepared 2026-09-09**, after four P4 adapter streams took the ranking from two pillars to
nine. Everything left is blocked, and **none of it is blocked on writing an adapter** — which
is worth stating plainly, because each one looks like an adapter task from the outside.

Five items. Three are catalog modelling questions, one is a decision the plan already names,
one is a fact nobody has checked.

---

## 1. `cost_of_living_index` cannot hold a value at all

**The most consequential, and the smallest to fix.** It is one of the seven `blocks_if_missing`
attributes, so the shipped set cannot score any candidate until it has figures.

| | |
|---|---|
| Value type | `Index` |
| Declared bounds | **none** |
| Description | "Eurostat PLI, EU27 = 100" |

An `Index` payload requires `scale_min` and `scale_max` and refuses any figure outside them.
This attribute declares neither, so **no value of any kind can be stored against it** — not by
Eurostat, not by the World Bank, not by hand.

And the description says why the bounds are missing rather than merely absent: **"EU27 = 100" is
a base, not a range.** A price level index says a country is 12% above the European average; it
has no ceiling, and Switzerland sits around 160. Choosing 0–200 would invent the top, which is
precisely what D6 refused to do for scale anchors.

**It is an attribute, not an `ExternalScore`, and that was worth checking.** The rule in
`data/external_score.py` is "raw indicators become attributes; composite scores become external
scores -- the test is whether someone else has already applied weights to it". A price level
index applies expenditure weights *within one dimension*, which is measurement methodology; the
World Happiness Report weights six different factors, which is somebody's view of what matters.
`reqs.md` 2085 lists this attribute in the country catalog, so the question is settled there
too. **The type is the problem, not the entity.**

**Options** (a first draft of this recommended `Ratio`, which is wrong: `Ratio` is constrained
`0 <= value <= 100`, so Switzerland's ~160 is refused exactly as `Index` refuses it.)

- **(a) Retype it as a `Quantity`**, unit `eu27_average_100`. `Quantity` is the only payload
  whose magnitude is unbounded, and the unit carries the base. `life_satisfaction` sets the
  precedent: a Cantril ladder 0-10 is a `Quantity`, not an `Index`, even though it has a
  published range -- **this ontology reserves `Index` for figures whose bounds do the work**.
  Scoring would be `percentile`. My recommendation.
- **(b) Keep `Index` and declare bounds** wide enough to hold Europe, say 0-250. Cheapest, and
  it puts an invented ceiling into the catalog where a reader will take it for a published one,
  and silently refuses any country above it.
- **(c) Leave it.** The shipped set stays unscoreable indefinitely.

---

## 2. `crime_safety_index` names two sources that are not the same measurement

| | |
|---|---|
| Declared bounds | **Numbeo 0..100** |
| Source priority | `unodc` rank 1, `eurostat` rank 2 |

The bounds describe Numbeo's crime index; the rank-1 source is UNODC, which publishes homicide
rates per 100,000 — a different quantity on a different scale. **Storing a UNODC rate under
Numbeo's bounds would be wrong in a way nothing downstream could detect**, and Numbeo's own API
is $50–500/month (`datasources.md` 2.4), so the rank-1 and the bounds cannot both stand.

Also `blocks_if_missing`, so the shipped set waits on it too.

**Options**

- **(a) Retype as a `Ratio`** (homicides per 100,000) and take UNODC. Honest raw indicator,
  matches the priority order, and drops the Numbeo dependency. It narrows the attribute from
  "safety" to "lethal violence", which is a real narrowing and should be renamed if taken.
- **(b) Keep the Numbeo scale and pay for Numbeo.**
- **(c) Split into two attributes** — a UNODC homicide rate and a Numbeo composite — and let
  source priority pick. The most correct and the most work.

---

## 3. `house_price_to_income_ratio` has no Eurostat series behind it

Its priority is `eurostat` rank 1, `oecd` rank 2. **Eurostat publishes a house price *index*,
not a price-to-income ratio** — `prc_hpi_a` and its quarterly siblings are all indices rebased
to 2015 or 2025. The ratio is OECD's, and OECD is rank 2 here.

Also `blocks_if_missing`.

**Options**

- **(a) Swap the priority** so OECD is rank 1, and fetch it there. Depends on item 5.
- **(b) Derive it** from Eurostat's house price level and median income, both of which exist.
  More work, no new dependency, and the derivation would be ours rather than a publisher's.

---

## 4. Climate is blocked on D4, which the plan already names

`devplan.md` 7 D4: Open-Meteo is coordinate-bound and `avg_annual_temperature` is a national
figure. The recorded answer is **population-weighted mean over the country's largest cities** —
and that needs city data, which is v2 scope (`reqs.md` 1.3). So climate's four attributes wait
on something outside the MVP boundary, not on an adapter.

---

## 5. The OECD API is behind a bot challenge, and W4-B is planned around it

Three family attributes plus `income_tax_effective` and `house_price_to_income_ratio` are
OECD's — five in all, two of them `blocks_if_missing`.

**`sdmx.oecd.org` does not answer a script.** Two probes on 2026-09-09, one plain and one with
a descriptive user agent, both returned **403** carrying Cloudflare's `Just a moment...`
interstitial rather than a permissions error. That is a bot challenge, and a scheduled
acquisition run is exactly the thing it is built to stop. **No adapter written against that API
will work**, however well written.

This is worth separating from a question I got wrong on the way here, because the wrong version
is easy to repeat: I first recorded that "OECD does not cover six of the 32, including
Romania". That conflated OECD *membership* with OECD *dataset coverage*, which are different —
OECD routinely publishes for non-members, accession candidates and key partners. The membership
claim may well be true and is not the obstacle. **The obstacle is that we cannot reach the data
to find out.**

It matters more than it looks, because Romania is both the household's home country and the
comparison anchor every delta is measured against (`reqs.md` Q30).

**Options**

- **(a) Bulk download instead of API.** OECD publishes CSV extracts through its data explorer.
  A scheduled download is the shape `datasources.md` already anticipates for UNODC, so this
  fits the plan rather than bending it.
- **(b) Find a different source per attribute.** `income_tax_effective` has
  `national_tax_authority` at rank 2; `house_price_to_income_ratio` could be derived from
  Eurostat (item 3, option b). The family three have no alternative recorded.
- **(c) Drop the family pillar from the MVP** and say so, rather than leaving three attributes
  that look pending but are not.

---

## A rule that is not being applied consistently

Worth deciding separately, because it decides how the next ten attributes are typed.

By the test above -- *has someone already applied weights?* -- three attributes ingested during
P4 are composites and would belong as `ExternalScore` rather than as scored values:

| Attribute | What it actually is |
|---|---|
| `rule_of_law`, `control_of_corruption`, `political_economic_stability` | An unobserved-components model over ~30 expert surveys |
| `healthcare_system_quality` | WHO's composite of 14 tracer indicators |

`reqs.md` 7.1 names both sources explicitly, so these are recorded exceptions rather than
accidents, and no comparable pan-European raw measure exists to prefer instead. But the test as
written would classify them the other way, which means **the rule cannot currently be applied by
reading it** -- and the next person to type an attribute will either import a composite or
exclude a usable one, depending on which document they read first.

Either `reqs.md`'s named sources override the test, or the test narrows to say what it really
means. It should say which.

---

## What I would do, in order

1. **Item 1**, option (a) — retype `cost_of_living_index` as a Ratio. One migration, unblocks
   one of four remaining `blocks_if_missing` attributes, invents nothing.
2. **Item 5** — answered on the way to writing this: the OECD API is unreachable from a
   script. W4-B needs option (a) or (b), and either is a change of plan rather than a task.
3. **Item 2**, option (a) — UNODC homicide rate as a Ratio, renamed to say what it measures.
4. **Item 3**, whichever of (a)/(b) item 5 makes cheaper.
5. **Item 4** stays where it is until the city level exists.
