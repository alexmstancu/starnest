# minE2E — the thinnest thing that runs end to end

**Goal, stated as the only acceptance test that counts:** open a browser, adjust a criterion
weight, and see at least one real European country in a ranked table with a score, a coverage
percentage and a match status — served by the real backend, from the real database, over the
real contract.

**Incomplete is fine. Buggy is fine. Fake is not.** The one rule this plan does not bend is
`reqs.md`'s: never fabricate a number. A country may be `insufficient_data`, a score may be
crude, a screen may be ugly — but no figure appears that did not come from a real source with a
real reference date.

---

## 0. Where we actually are

| Layer | State |
|---|---|
| `candidates/`, `data/`, `household/`, `criteria/`, `storage/` | **Built.** 956 tests, ~99.8% coverage |
| Catalog in the database | **Seeded.** 32 countries, 41 attributes, 41 criteria, 11 pillars, 34 sources |
| **Measured values** | **Zero rows.** Nothing has ever been fetched |
| **Household** | **Zero rows** |
| `evaluation/` | Empty. Nothing turns a value into a score |
| `api/` | Empty. `openapi.yaml` designs 40 operations; none exists |
| `main.run()` | Raises `NotImplementedError` |
| `ui/` | Shell only. Every route renders `PlaceholderScreen`, against a mock |

**Five gaps, and only five.** Everything below the API is done.

### The fact that shapes this whole plan

The shipped `local_employment` criteria set **cannot produce a score today, even with perfect data**:

- **26 of its 41 criteria normalise `fixed`, and zero scale anchors ship.** A fixed scale with
  no anchors maps nothing — deliberately, because the anchors are Alex's to set against real
  figures and `devplan.md` 0.3 forbids inventing them.
- **15 normalise `as_is`**, which requires the measured value to already be on the score scale.
- **7 carry `blocks_if_missing`**, so with no values every country is `insufficient_data`.

**So minE2E does not use the shipped set.** It uses a small dedicated one, and the choice that
makes that cheap is **`percentile` normalisation, which needs no anchors at all** — it ranks a
candidate within the current candidate set, so real values alone are enough configuration.

> This is not a workaround. It is `reqs.md` 5.1's third method doing exactly what it is for,
> and it means minE2E needs no invented number anywhere.

---

## 1. The five tasks

### M1 — `evaluation/`, cut to the bone

**In:** `percentile` and `as_is` normalisation; `minimise` / `maximise` goals; weight
redistribution across criteria that *have* a value; coverage as a percentage; `blocks_if_missing`
and a minimum-coverage floor producing `insufficient_data`; the weighted total; rank.

**Out, explicitly:** `fixed` interpolation and band labels, `target_range` with falloff, the
three compound-rule shapes, match rules, evaluation snapshots, `parent_not_matching`.

Pure functions over values and a `CriteriaSet`. No store, no clock, no network — so it stays
fully unit-testable and none of the deferred work invalidates it.

> **Why `fixed` is deferrable although 26 criteria use it:** with no anchors it cannot run
> regardless. Implementing it would produce code nothing could exercise against real data.

### M2 — Real values, and a household

A dev-only seeder — `tools/seed_minimal_values.py`, **not a migration** — writing through the
existing `ValueStore`.

**In:** a handful of genuinely published figures for a handful of countries, on 2–3 attributes,
carrying honest provenance: real `data_source`, real reference period, real retrieval date. Plus
one `Household` record.

**Out:** any source adapter, any acquisition run, any fetch.

> **Every figure must be real and traceable.** Manual entry is a first-class source
> (`reqs.md` Q11, Q19), so this is a supported path rather than a hack — but the moment a number
> is invented to make a screen look populated, this project has become the thing it exists to
> replace. **Deliberately leave some countries with no data**, so the first ranking we ever see
> also proves `insufficient_data` renders.

### M3 — `api/` and the composition root

**In:** `main.run()` actually wiring the pool and the stores; the `/v1` prefix; the single
exception→status map and one error shape (`arch.md` 7.6); and **four endpoints**:

| Endpoint | Why it is in the minimum |
|---|---|
| `GET /v1/settings` | The compose healthcheck already calls it |
| `GET /v1/criteria-sets/{id}` | "Define some criteria" needs them shown |
| `PATCH /v1/criteria-sets/{id}/criteria/{attribute}` | The weight drag — and the server-side rebalance is already built |
| `GET /v1/rankings` | The payoff |

**Out:** the other 36 operations, data acquisition, comparison, evaluations, values drill-down.

Each of the four must match `openapi.yaml` exactly — the contract is already written, and a
divergence here is a bug in the slice rather than a shortcut through it.

### M4 — Two real screens

**In:** a **Rank** table (country, score, coverage, match status, non-matching still visible per
`reqs.md` 5.4) and a **Configure** screen listing criteria with an editable weight. The generated
client pointed at the real backend instead of the mock.

**Out:** drill-down, provenance panels, comparison, pillar tree, locks, sliders. A number input
is a slider for this purpose.

### M5 — The e2e test

One Playwright spec against the real stack: open the app → change a weight → assert the ranking
re-renders → assert at least one country shows a score, and at least one shows
`insufficient_data`. **Owned by the master agent**, not by whoever wrote the screen.

---

## 2. Sequencing, two agents at a time

```
Round 1   A: M1 evaluation/            B: M2 seeder + household
                     └────────┬───────────────┘
Round 2   A: M3 api/ + composition root
          B: M4 screens (against the mock until M3 lands, then repointed)
                              │
Round 3   master: M5 e2e, then fix what it finds
```

M1 and M2 share nothing. M3 depends on M1; M4 depends only on the contract, which already
exists, so it can start before M3 finishes.

**Definition of done for every task:** `make check` green — lint, the four boundary contracts,
the 75% coverage floor and both structural audits. Bare-minimum scope does not mean bare-minimum
rigour; the whole point of the gate is that it holds when we are in a hurry.

---

## 3. What this buys, and what it does not

**Buys:** the first real feedback loop. Every number in this application is provisional pending a
look at real output — the weights, the thresholds, the anchors, the budget guideline. None of
that can be judged from a document. It also proves the contract is a real boundary, because the
interface and the acceptance suite will both be clients of it.

**Does not buy:** a usable product. After minE2E there is still no data acquisition, no LLM path,
no comparison, no drill-down, no provenance display, and 36 unimplemented operations.

**Expect it to be wrong in interesting ways.** Percentile over five countries is a crude ranking.
That is the point: a crude ranking of real countries tells us more about what to build next than
another pass over the plan would.

---

## 4. Reassessing `devplan.md` afterwards

minE2E cuts across P2 and P3 rather than replacing them. Once it lands, cross off:

- **W2-A** partially — normalisation and ranking exist; compound-rule shapes and `fixed` do not
- **W3-A** partially — the composition root and 4 of 40 operations
- **W3-B / W6-x** partially — two screens exist in skeleton
- **Gate A** — reachable for the first time, against the minE2E set rather than the shipped one

What minE2E does **not** touch, and what the revised plan must still carry in full: data
acquisition and its spend cap, the source adapters, comparison, the drill-down and provenance
surfaces, `fixed` normalisation and the anchors themselves, match rules and compound rules.
