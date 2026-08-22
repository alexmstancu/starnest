# Data sources and market analysis

Research artifact feeding `arch.md`. Two questions: **what can we actually fetch**, and
**who else is already in this space**.

Findings marked **[verified]** were tested directly against the live API on 2026-08-22.
Everything else is from published documentation and should be re-checked before relying on it.

---

## 1. Headline findings

1. **WhereNext is a competitor, not a data source.** The spec listed it under "reference
   sources". It is in fact the closest existing product to Starnest — weighted multi-dimension
   country scoring, user-adjustable weights, confidence adjustment for sparse data. It is also
   *unusable as a primary source* for reasons in §2.3.
2. **The country/city divide is the whole problem.** the country level is served by excellent free
   official APIs. the city level is thin, and for small localities it collapses.
3. **The fix is a source-selection principle, not more sources** — prefer *coordinate-bound*
   sources over *registry-bound* ones (§3). This is what makes Cassis tractable.
4. **Two sources named in `reqs.md` are dead** and must be replaced (§6.1).
5. **One criterion has no city-level source at all** — `local_openness_to_foreigners` (§6.2).

---

## 2. Market analysis

### 2.1 WhereNext — the near-neighbour

`getwherenext.com`. What it is, verified hands-on:

| | |
|---|---|
| Coverage | 95 countries, 380 cities. **31 of our 32 in-scope countries** (missing Liechtenstein) **[verified]** |
| Dimensions | 7, fixed weights: cost 25, safety 60, healthcare 60, education 50, career 55, lifestyle 50, infrastructure 55 |
| Sources | Claims 27 institutional datasets — World Bank ICP, UNDP HDI, IEP Global Peace Index, OECD PISA, EF EPI, WHO, ILO, ITU, UNESCO, UNODC, Eurostat, Open-Meteo, national statistics |
| Normalisation | Confidence scores 0.50–0.92 from coverage and recency; low confidence is **shrunk toward the distribution middle** |
| API | `GET /api/data/relocation-index` → HTTP 200, 21,814 bytes, JSON. Also `/csv` and `/api/data/cost-of-living` **[verified]** |
| Limits | 100 requests/hour, 24-hour caching |
| Licence | **CC BY 4.0** — free redistribution with attribution |
| Updates | Quarterly; payload declared `updated: 2026-08-19` |

**It already does much of what Starnest does.** Its `/quiz` and `/find` let a user customise
dimension weights for a personalised ranking. Its confidence adjustment is the same problem
our coverage percentage solves. This is worth sitting with before building.

**Where Starnest genuinely differs:**

| Starnest | WhereNext |
|---|---|
| Two-level country → city pipeline | Countries and cities as separate flat lists |
| Full provenance per number: source, two dates, all competing values retained | Composite scores only, no per-indicator provenance |
| Any locality, including a village of 7,000 | A fixed set of 380 cities |
| Criteria personal to *this* household — tax vs Romania, flights to Romania, RO double-taxation treaty, naturalisation, children | Generic dimensions for a generic mover |
| Head-to-head comparison with weighted-contribution deltas | Ranking only |
| Multi-source resolution with configurable priority | Single blended figure |
| Named weight profiles per person and per work-format scenario | One weight set per session |
| Uncertainty **disclosed** as coverage % | Uncertainty **absorbed** by shrinking toward the mean |

That last row is a real philosophical split. WhereNext hides low confidence by pulling the
score toward average; `reqs.md` §5.3 discloses it and leaves the number alone. For a public
ranking their choice is defensible. For a decision you will live inside, ours is better.

### 2.2 Data-quality problems found in the WhereNext payload **[verified]**

Testing the live API surfaced three issues:

- **`rent_index` equals `utilities_index` in 88 of 95 rows.** These are presented as
  independent sub-indices. They are almost certainly derived from one underlying figure.
- **Sub-index direction is inverted and undocumented.** The ten cheapest countries average
  `rent_index` 89.1; the ten dearest average 19.1. Higher means *cheaper*. Nothing in the
  payload says so — a naive integration would rank backwards.
- **The `provenance_endpoint` is inert.** `meta` advertises
  `?provenance=1`; calling it returns a **byte-identical** 21,814-byte response. There is no
  per-indicator provenance available.

Also worth noting: their published methodology cites **World Bank Doing Business** for the
career dimension. That product was discontinued in September 2021 (§6.1).

### 2.3 Verdict on using WhereNext as a source

**Usable as a cross-check. Not usable as a primary source.** Three reasons:

1. **It returns pre-normalised scores, not raw values.** `cost: 47` is WhereNext's number
   after WhereNext's weighting. Ingesting it imports their weights — a direct violation of
   *nothing hardcoded* and of "the criteria are yours".
2. **No provenance.** Every value would enter our store with one source ("WhereNext"), one
   date, and no reference period — breaking the two-dates invariant and the
   full-provenance rule.
3. **They aggregate sources we can query ourselves.** World Bank, WHO, OECD, Eurostat,
   UNODC, Open-Meteo are all free and direct. Going through WhereNext adds a lossy layer.

The one genuinely useful field is `monthly_estimate_usd` from `/api/data/cost-of-living` — an
absolute figure rather than an index — worth carrying as a **low-priority comparison source**
under the §6.6 priority mechanism.

### 2.4 The rest of the landscape

| Tool | Approach | Relevance |
|---|---|---|
| **Numbeo** | Crowdsourced, largest city coverage | Our best city-level cost source. API reportedly **$50–500/month** |
| **Nomad List** | Community + data for nomads | City-level, subscription, remote-work oriented |
| **Expatistan** | Crowdsourced, pairwise city comparison | Narrow; comparison only |
| **MoveHub** | Editorial guides + cost comparison | Content, not data |
| **whereTOemigrate** | Cost + **visa eligibility against 2,500+ programmes** | The only one taking eligibility seriously — closest to our hard filters |
| **AffordWhere** | Net salary after tax, official statistics, neighbourhood rent | Closest to our "official sources over crowdsourced" stance |
| **Teleport Cities** | Open city data platform | Listed in the spec; **status unverified, treat as unreliable** |
| **InterNations** | Annual expat survey | Country-level only; good for settling-in and openness |

**Nobody occupies our exact position.** The market splits into cost calculators (Numbeo,
Expatistan), lifestyle communities (Nomad List), visa-eligibility tools (whereTOemigrate), and
institutional rankings (WhereNext). None combines a two-level funnel, arbitrary localities,
per-number provenance, and criteria personal to one household. That is a real gap — and,
given `MVP is a personal iteration baseline`, a gap we're filling for two people rather than a
market to enter.

---

## 3. The structural finding: registry-bound vs coordinate-bound

This is the most useful distinction for `arch.md`.

**Registry-bound sources** answer "what do you know about *this named place*?" They hold a
fixed list of places and know nothing outside it.

> Numbeo · Eurostat Urban Audit (~794 EU cities) · WhereNext (380 cities) · EF EPI · MIPEX

They have a **population floor**. Cassis (7,265) and Saint-Tropez (4,103) are below every one
of them. For these sources, a small town isn't sparse — it is simply absent.

**Coordinate-bound sources** answer "what is true at *this latitude and longitude*?" They work
anywhere on earth, at any settlement size.

> Open-Meteo (climate, 1–11 km grid) · Ookla Open Data (internet, ~610 m tiles) · OpenAQ and
> EEA (air quality, nearest station) · OpenStreetMap Overpass (POIs) · elevation and coastline
> datasets · GeoNames

**Design consequence.** Wherever a criterion can be answered from coordinates, prefer that
source — it degrades gracefully as a locality shrinks, whereas registry sources fail
completely. Applied across the the city level catalog, this converts a large part of the small-town
coverage problem from "no data" into "data, at slightly coarser resolution".

It also predicts *which* criteria will stay hard: anything requiring a human institution to
have surveyed the specific town — local bureaucracy, local job market, city-level attitudes.

---

## 4. Source catalog

### Tier 1 — free, open, no key required

| Source | Provides | Access | Notes |
|---|---|---|---|
| **World Bank Open Data** | 29,000+ indicators, 200+ countries, from 1960 | REST v2, JSON/XML | **No key, no rate limits.** `api.worldbank.org/v2/...` |
| **Eurostat** | EU statistics incl. **Cities (Urban Audit)** | REST, JSON-stat 2.0 / SDMX 3.0 / CSV | Free, CORS-enabled. The single most valuable European source |
| **Open-Meteo** | Weather and climate from 1940, hourly/daily | REST, JSON | **No key.** 10,000 calls/day non-commercial. 1–11 km grid. **Coordinate-bound** |
| **OpenAQ** | PM2.5, PM10, SO₂, NO₂, CO, O₃ | REST, JSON | Free. Also mirrored on AWS Open Data |
| **EEA Air Quality** | European monitoring, current and historic Airbase | Download service API | Free, public |
| **OpenStreetMap / Overpass** | Hospitals, schools, museums, transit stops, parks | Overpass QL | Free. **Coordinate-bound.** The free alternative to Google Places |
| **Ookla Open Data** | Fixed and mobile speeds | Parquet/Shapefile via AWS | **Zoom-16 tiles ≈ 610 m.** Quarterly. **Coordinate-bound** |
| **GeoNames** | Population, elevation, coordinates, timezone, admin hierarchy | REST + dumps, CC BY | Backbone for `CandidateProfile` |
| **Wikidata** | Subdivisions, admin parents, heritage, arbitrary facts | SPARQL | Excellent for arrondissement-style subdivisions |
| **UNESCO World Heritage** | Inscribed sites with coordinates | XML/CSV list | Feeds `heritage_and_culture_density` |
| **WHO Global Health Observatory** | Health system indicators | REST (OData) | Replaces the dead EHCI (§6.1) |
| **UNdata** | Aggregator across UN agencies — demography, education, environment | Web + downloads | Convenient, but **largely a mirror** of upstream agencies — see §6.4 |
| **UNODC** | Homicide, violent crime, prisons, justice | **Portal download** (ZIP: CSV + JSON metadata) | **Not a REST API** — expect a scheduled download, not a live call |

### Tier 2 — free, with registration or meaningful limits

| Source | Provides | Limit |
|---|---|---|
| **IMF Data** | IFS, WEO, Fiscal Monitor, BOP | SDMX 3.0 / JSON. **10 calls per 5 seconds** |
| **OECD** | **Tax database**, health, education, pensions | SDMX REST, JSON/XML/CSV. Free, rate-limited |
| **Copernicus CDS** | Climate reanalysis and projections | Free, registration required |
| **Protected Planet (WDPA)** | Protected areas, national parks | Free, registration for bulk |

### Tier 3 — paid

| Source | Provides | Cost |
|---|---|---|
| **Numbeo** | City cost of living, rent, safety, healthcare, pollution indices | **$250/month for 200k requests.** No small tier — see §9.1 |
| **Google Places** | POIs, ratings, opening hours | The pooled $200 monthly credit was **retired March 2025**. Now per-SKU free tiers — 10,000 Essentials, 5,000 Pro, 1,000 Enterprise, monthly, **no rollover, no pooling** |
| **Flight data** (Amadeus etc.) | Routes, frequency, price | Free tiers exist, generally too thin for repeated use |

> **Google Places is largely avoidable.** Every POI need in our catalog — hospitals, schools,
> museums, cinemas, transit stops — is answerable from OpenStreetMap Overpass for free, and
> Overpass is coordinate-bound so it also works for villages.

### Tier 4 — no API: scrape, manual, or LLM

EF English Proficiency Index · MIPEX · Eurobarometer · InterNations · national tax authorities ·
national land registries · immigration and naturalisation law · EU pension coordination rules

These map onto the **manual entry as first-class source** decision (`reqs.md` §6.5) and the
LLM + `web_search` path.

---

## 5. Criterion → source mapping

### the country level — country

| Criterion | Primary | Secondary | Confidence |
|---|---|---|---|
| `cost_of_living_index_country` | Eurostat price level indices | World Bank ICP PPP; WhereNext `monthly_estimate_usd` | **High** |
| `income_tax_effective` | **OECD Tax Database** | National tax authorities | **High** |
| `remote_work_tax_treaty` | OECD treaty database | Manual / LLM | Medium — treaty text needs interpretation |
| `tech_employment_share` | Eurostat (ICT/high-tech employment) | ILO | **High** |
| `international_employer_presence` | — | LLM + search | **Low** — no structured source |
| `crime_safety_index_national` | UNODC homicide | World Bank `VC.IHR.PSRC.P5`; Eurostat crime | **High** (note: WB mirrors UNODC — not independent) |
| `political_economic_stability` | World Bank Governance Indicators | — | **High** |
| `healthcare_system_quality` | **WHO GHO** + OECD Health Statistics | Numbeo healthcare index | **High** (EHCI is dead — §6.1) |
| `residency_admin_ease` | — | LLM / manual | **Low** (Doing Business is dead — §6.1) |
| `climate_zone` | Köppen classification dataset | — | **High** |
| `avg_annual_temperature` | **Open-Meteo** archive | National met services | **High**, coordinate-bound |
| `annual_sunshine_hours` | **Open-Meteo** (derive from radiation) | National met services | **High**, coordinate-bound |
| `climate_trajectory_national` | Copernicus CDS projections | IPCC regional | Medium — needs a scenario choice |
| `naturalisation_pathway` | — | Manual / LLM | **Low** — legal text, no dataset |
| `pension_portability` | EU coordination rules | Manual / LLM | **Low** |

### the city level — city

**R** = registry-bound (fails below a population floor) · **C** = coordinate-bound (works anywhere)

| Criterion | Primary | Type | Small-town outlook |
|---|---|---|---|
| `tech_software_jobs` | Job-posting counts **(source unresolved, §11)** | — | Poor; postings concentrate in large cities |
| `major_employer_presence` | LLM + search | — | Poor |
| `tech_product_jobs` | Job-posting counts **(source unresolved, §11)** | — | Poor; product roles are scarce everywhere |
| `cost_of_living_2p_monthly` | Numbeo | **R** | **Fails** — fall back to regional figure + LLM |
| `rent_2br_city_centre` | Numbeo; national listing sites | **R** | **Fails** — LLM + local listings |
| `property_purchase_price_m2` | National land registries; Eurostat | **R** | Partial — regional averages exist |
| `safety_local` | Eurostat Urban Audit; Numbeo | **R** | **Fails** — regional police data or LLM |
| `healthcare_access_local` | **Overpass** (hospital POIs + distance) | **C** | **Works** — distance to nearest hospital is computable anywhere |
| `air_quality` | **OpenAQ / EEA** (nearest station) | **C** | **Works**, with station-distance caveat |
| `local_climate` | **Open-Meteo** | **C** | **Works** — full resolution |
| `internet_quality` | **Ookla Open Data** tiles | **C** | **Works** — 610 m tiles beat any city registry |
| `public_transport` | **Overpass** (stops, routes) + Urban Audit | **C**+R | **Works** at reduced fidelity |
| `flights_to_romania` | Manual / LLM; flight APIs | — | Works via `profile.nearest_airport` |
| `proximity_to_hub` | Computed from coordinates | **C** | **Works** — pure geometry |
| `heritage_and_culture_density` | **UNESCO + Overpass + Wikidata** | **C** | **Works** — count monuments, museums, cinemas by radius |
| `local_openness_to_foreigners` | MIPEX, Eurobarometer, InterNations | **country only** | **Gap — see §6.2** |
| `landscape_access` | WDPA, coastline, elevation | **C** | **Works** |
| `english_proficiency` | EF EPI | **country only** | Country value applied to city |
| `expat_community_size` | **Eurostat Urban Audit** (foreign-born) | **R** | Fails for small towns; national fallback |
| `local_admin_ease` | LLM / manual | — | Poor |
| `schooling_options` | **Overpass** + national registries | **C**+R | **Works** for counts; quality needs registries |
| `paediatric_healthcare_access` | **Overpass** + national | **C** | **Works** for access; quality does not |
| `childcare_cost_availability` | Eurostat; national | **R** | Thin everywhere |

### Eurostat Urban Audit — the key the city level asset

Worth its own note. **794 EU cities, plus 171 UK, 10 Swiss, 6 Norwegian, 1 Icelandic.**
**300+ indicators** derived from 336 variables: demography, housing, health, labour market,
education, environment, transport, tourism. Also covers Functional Urban Areas (commuting
zones), which is useful for the "proximity to a hub" idea.

**Its catch is exactly our problem.** Collection is **voluntary** — there is no EU legislation
mandating it. Coverage therefore varies sharply by domain: **over 90% of cities for
demography, under half for environment.** It is a registry source with a population floor, and
patchy above that floor.

This is direct empirical support for `reqs.md` §5.3: weight redistribution plus a displayed
coverage percentage is not a nicety, it is the only honest way to consume this dataset.

---

## 6. Corrections and gaps

### 6.1 Two sources in `reqs.md` are dead

- **World Bank Doing Business** — discontinued **September 2021** after data irregularities and
  ethics breaches. Successor **B-READY** launched October 2024 covering only 50 countries,
  planned to reach 180 by 2026. `reqs.md` cites Doing Business for `residency_admin_ease`;
  replace with B-READY where coverage allows, otherwise manual/LLM.
- **Euro Health Consumer Index** — last published **2018**, discontinued. `reqs.md` cites it
  for `healthcare_system_quality`; replace with **WHO GHO** plus **OECD Health Statistics**.

### 6.2 A criterion with no source at the required level

**`local_openness_to_foreigners`** was added as a city-level criterion. Every source that
measures it — MIPEX, Eurobarometer, InterNations — is **country-level only**. Three options:

1. **Move it to the country level** as a country criterion, where its sources actually live.
2. **Keep it city-level, populated with the country value**, clearly labelled as inherited —
   honest, but it then adds nothing to the city ranking beyond a constant.
3. **Keep it city-level, LLM-sourced**, accepting weak evidence.

**Recommendation: option 1.** Attitudes toward foreigners are largely national-policy and
national-culture phenomena, and the country level is where the data is.

### 6.3 Criteria that will be LLM-or-nothing

`international_employer_presence` · `residency_admin_ease` · `naturalisation_pathway` ·
`pension_portability` · `major_employer_presence` · `local_admin_ease`

Eight criteria across both levels with no structured source. This is the real scope of the
deferred Q20 question — it was framed as being about *atmosphere*, but the harder cases are
legal and labour-market facts that happen to have no API.

### 6.4 Independence warning

**World Bank homicide data mirrors UNODC.** Treating them as two sources that agree would be
false corroboration. Whichever the source-priority mechanism picks, the other should be
labelled a mirror rather than an independent confirmation.

---

## 7. Recommendations for `arch.md`

1. **Prefer coordinate-bound sources** wherever a criterion allows it. This is the single
   highest-leverage decision for small-locality coverage.
2. **Do not ingest WhereNext composite scores.** Carry `monthly_estimate_usd` as a
   low-priority comparison value; take everything else from the upstream sources directly.
3. **Budget for Numbeo.** It is the only serious city-level cost source, and its absence is
   felt across four criteria. Reportedly $50–500/month — a real decision, not a default.
4. **Skip Google Places.** Overpass covers every POI need for free and works for villages.
5. **Two fetch modes, not one.** UNODC, Ookla and Köppen are bulk downloads on a slow cadence;
   Eurostat, World Bank and Open-Meteo are live per-candidate queries. The acquisition layer
   must support both — a scheduled bulk import and a per-candidate call.
6. **Record source independence** in the `DataSource` entity, so mirrors (World Bank ↔ UNODC)
   can be marked and never counted as corroboration.
7. **Rate limits to design around:** WhereNext 100/hour, IMF 10 per 5 seconds, Open-Meteo
   10,000/day, OECD unspecified but throttled. World Bank has none.

---

## 8. Per-value confidence — **decided**

A `confidence` level on every stored value, distinct from the coverage percentage. Coverage
answers *how much* of the weight is backed by data; confidence answers *how much that data is
worth*. A candidate can have 100% coverage entirely made of low-confidence guesses, and today
nothing would say so.

### 8.1 Proposed levels

| Level | Meaning | Typical origin |
|---|---|---|
| **Absolute** | Definitionally true; not a measurement | ISO codes, coordinates, official language, timezone, area |
| **High** | Official statistic, direct measurement, within `max_age` | Eurostat, World Bank, OECD, WHO, UNODC, Open-Meteo |
| **Medium** | Real measurement, but degraded — stale, a proxy, a coarser geography, or a national figure applied to a city | Past-`max_age` official data; regional average used for a town; crowdsourced Numbeo |
| **Low** | Inferred rather than measured | LLM extrapolation, derivation from a related figure, rough manual estimate |

Note that most `CandidateProfile` attributes are **Absolute**, while almost no `Value` ever is
— the best a measurement achieves is **High**. That asymmetry is itself informative and worth
showing in the UI.

### 8.2 Derived by default, overridable

Confidence should be **computed** from what is already known, not typed in by hand each time:

```
source.reliability_tier            (official / crowdsourced / llm / manual)
  ↓ downgrade if  value age > criterion.max_age
  ↓ downgrade if  geography coarser than the candidate (national → city)
  ↓ downgrade if  derived rather than directly reported
  = confidence, with a manual override retained alongside
```

This reuses machinery that already exists — `max_age` from §6.6, `DataSource.kind` from §3.5 —
rather than adding a field somebody must remember to fill.

### 8.3 The open question: does confidence affect the score?

Four positions, in increasing order of how much they change the numbers:

1. **Display only.** Confidence appears next to every figure and in the candidate summary
   ("64% coverage, 40% of it Low"). The score is untouched.
2. **Affects source priority.** Where two sources compete, higher confidence is promoted —
   an extension of the existing `max_age` promotion rule.
3. **Affects coverage.** Coverage becomes confidence-weighted: a Low value contributes less
   to the coverage percentage than a High one, so the `min_coverage` floor catches candidates
   propped up by guesses.
4. **Affects the score itself.** Low-confidence values are discounted or shrunk toward the
   mean — **this is what WhereNext does** (§2.1), and it is the option that contradicts our
   stated preference for disclosing uncertainty rather than absorbing it.

**Decided: positions 1 and 2.** Confidence is displayed everywhere and breaks ties in source
priority; it does not touch the score arithmetic. Position 3 (confidence-weighted coverage) was
considered and left out for now; position 4 is rejected on the same grounds as WhereNext's
approach. Recorded in `reqs.md` §5.7.

---

## 9. Numbeo — coverage and pricing

### 9.1 The pricing mismatch

**$250/month buys 200,000 requests.** Realistic usage here is a few hundred requests for an
initial load, then a refresh every few months — plausibly under 10,000 requests *per month*
even being generous, because values are stored once and scoring never re-fetches (§5.6).

That is roughly **5% of the tier being paid for**. The objection is not the money in the
abstract, it is that there is no tier matching the shape of this usage; a ~$25 tier at 10k
requests would be bought without hesitation. Absent that, the value is not there.

**Decision: scrape, do not subscribe.** Personal, non-commercial use. Revisit only if usage
ever justifies the tier, which on current projections it will not.

### 9.2 Coverage — measured **[verified]**

Tested 2026-08-22 against live pages, French cities by population:

| City | Population | Numbeo |
|---|---|---|
| Lyon | ~520k | **55 price cells** |
| Nice | ~340k | **55 price cells** |
| Bordeaux | ~260k | **55 price cells** |
| Grenoble | ~160k | **55 price cells** |
| Annecy | ~130k | **empty** (11.8 KB template) |
| Perpignan | ~120k | **empty** |
| La Rochelle | ~75k | **empty** |
| Cassis | ~7k | **empty** |

**The practical floor is around 150,000 population** — and it is not really about population,
it is about crowdsourced submission volume. Lisbon and Porto both return exactly 55
`priceValue` cells; every city below the floor returns an identical empty template.

**Consequences:**

- **Scraping and the paid API buy the same data.** The subscription question is far smaller
  than it appears: it would cover Lyon and Bordeaux and give nothing for Annecy, let alone
  Cassis. **Decision: scrape first, revisit the API only if coverage above the floor proves
  worth it.**
- Where data exists, extraction is straightforward — server-rendered HTML, one stable table,
  55 `priceValue` cells. `robots.txt` disallows only `/heavy_crawling.any`; the
  `/cost-of-living/in/*` paths are not restricted. Crawl politely and cache aggressively.
- **This promotes the coordinate-bound strategy (§3) from preferable to load-bearing.** For any
  candidate under ~150k, Open-Meteo, Ookla, Overpass and OpenAQ are not a fallback — they are
  the only city-level fact available.

---

## 10. Pillar benchmarks — how reputable indices structure this

Four established frameworks, chosen for methodological transparency and standing. Compared
against the Starnest catalog (`reqs.md` §7) to find gaps.

### 10.1 The four references

| Index | Structure | Weighting | Notes |
|---|---|---|---|
| **OECD Better Life Index** | 11 dimensions, 24 indicators | **User-set at dimension level; indicator weights fixed and equal** | The closest structural precedent to Starnest. Users score each dimension 0–5, weight = score ÷ sum of scores |
| **EIU Global Liveability Index** | 5 pillars, 30 indicators | Fixed: Stability 25%, Culture & Environment 25%, Infrastructure 20%, Healthcare 20%, Education 10% | 173 cities. Indicators rated acceptable → unbearable, scored 1–100 |
| **Mercer Quality of Living** | 10 pillars, 39 factors | Not published | 450+ cities. The corporate relocation standard; largely paywalled |
| **Eurostat Quality of Life** | 8+1 dimensions, sub-dimensions, indicators | None — a reporting framework, not an index | Official EU framework. Its data is directly fetchable |

**Their pillars, verbatim:**

- **OECD:** Housing · Income · Jobs · Community · Education · Environment · Civic Engagement ·
  Health · Life Satisfaction · Safety · Work–Life Balance
- **EIU:** Stability · Healthcare · Culture & Environment · Education · Infrastructure
- **Mercer:** Political & social environment · Economic environment · Socio-cultural
  environment · Medical & health · Schools & education · Public services & transportation ·
  Recreation · Consumer goods · Housing · Natural environment
- **Eurostat:** Material living conditions · Productive/main activity · Health · Education ·
  Leisure & social interactions · Economic & physical safety · Governance & basic rights ·
  Natural & living environment · **+1** Overall experience of life

### 10.2 Coverage against the Starnest catalog

| Concern | OECD | EIU | Mercer | Eurostat | Starnest |
|---|---|---|---|---|---|
| Income, cost, housing cost | ✓ | ✓ | ✓ | ✓ | `economics` |
| Employment | ✓ | — | — | ✓ | `career` |
| Physical safety | ✓ | ✓ | ✓ | ✓ | `safety` |
| Healthcare | ✓ | ✓ | ✓ | ✓ | `health` |
| Natural environment, climate | ✓ | ✓ | ✓ | ✓ | `climate` |
| Transport, utilities, telecoms | — | ✓ | ✓ | — | `connectivity` |
| Culture, leisure, recreation | ✓ | ✓ | ✓ | ✓ | `culture` |
| Education | ✓ | ✓ | ✓ | ✓ | `family` |
| Administrative procedure | — | — | ✓ | — | `admin` |
| **Work–life balance** | **✓** | — | — | ✓ | **absent** |
| **Subjective wellbeing** | **✓** | — | — | **✓ (+1)** | **absent** |
| **Governance, rule of law, rights** | **✓** | ✓ | ✓ | **✓** | **partial** |
| Social connection | ✓ | — | — | ✓ | partial |
| Visa eligibility, naturalisation | — | — | — | — | **`admin` — unique to us** |
| Connection to a specific home country | — | — | — | — | **`connectivity` — unique to us** |

### 10.3 Three gaps worth closing

**1. Work–life balance.** A full dimension in OECD, present in Eurostat under productive
activity, absent from ours. Measurable at country level: average usual weekly hours,
employees working very long hours, statutory paid leave. For two people in tech considering a
permanent move, working-hours culture is one of the sharper differences between, say, the
Netherlands and Greece — and it is invisible in the current catalog.
*Sources: OECD Employment Database, Eurostat `lfsa_ewhun2`.*

**2. Subjective wellbeing.** A headline dimension in OECD (Life Satisfaction) and the entire
"+1" of Eurostat's framework. This is not the deferred `general_atmosphere` question — it is a
hard number, collected by official statistical agencies on a standard 0–10 Cantril ladder.
*Sources: Eurostat `ilc_pw01`, World Happiness Report.*

**3. Governance and rights, as distinct from administrative ease.** Our `admin` pillar is
procedural — how hard is it to register a residence or open a bank account. Three of the four
references also cover **rule of law, corruption, press freedom, and discrimination**. For an
open-ended move to a country where children may grow up, that is arguably weightier than queue
length, and it is currently only implicit inside `political_economic_stability`.
*Sources: World Bank Governance Indicators (rule of law, control of corruption), V-Dem,
Reporters Without Borders Press Freedom Index, EU Justice Scoreboard.*

### 10.4 What the comparison confirms

- **Pillar count.** EIU 5, Starnest 8/9, Eurostat 9, Mercer 10, OECD 11. We sit mid-range;
  nothing suggests we are too coarse or too fine.
- **Weight distribution.** EIU's spread is 25% down to 10%. Ours is 22% down to 4%. Comparable,
  with no single pillar dominating.
- **Two of our pillars have no counterpart anywhere** — visa eligibility and naturalisation,
  and connection to a specific home country. That is expected: these indices rank *places* for
  a generic reader, while Starnest evaluates *eligibility and fit* for one household. It is the
  clearest statement of what the app is actually for.

### 10.5 Two methodological lessons

**OECD deliberately locks indicator weights.** Users weight the 11 dimensions but cannot touch
the 24 indicators beneath them, which stay equal-weighted. Starnest currently allows both
levels to be adjusted (`reqs.md` §3.3). OECD's restraint is defensible — indicator-level
weighting demands that the user understand each indicator, and it invites tuning weights until
a favoured answer appears. Worth a deliberate decision rather than a default.

**Numbeo's published formula is an un-normalised weighted sum:**

```java
index = max(0, 100
  + purchasingPowerInclRentIndex / 2.5
  - housePriceToIncomeRatio * 1.0
  - costOfLivingIndex / 10
  + safetyIndex / 2.0
  + healthIndex / 2.5
  - trafficTimeIndex / 2.0
  - pollutionIndex * 2.0 / 3.0
  + climateIndex / 3.0)
```

The coefficients are **not** weights. `housePriceToIncomeRatio` ranges roughly 2–30 while the
other terms are 0–100 indices, so its coefficient of 1.0 contributes far less than it appears
to, and nothing in the formula corrects for that. This is precisely the failure mode that the
per-criterion normalisation decision (`reqs.md` §5.1) exists to prevent — a useful confirmation
that the decision was the right one.

---

## 11. Job-posting counts — source unresolved

Two criteria at both levels (`tech_software_jobs`, `tech_product_jobs`) need counts of open
roles by role family and location. **No source is settled.** Candidates, with what is and is
not confirmed:

| Source | Status |
|---|---|
| **Adzuna** | Documented self-serve API, free tier ~1,000 calls/month, with endpoints that return **vacancy counts by region and category** — exactly the query shape needed. Credibility is genuine: it is the **exclusive data partner to the UK Office for National Statistics**, powering the official real-time job vacancy index in the ONS "faster indicators" report from 36M+ adverts. ⚠️ **EU coverage unconfirmed.** The docs publish no country list; "16+ countries" is the only figure found, and the historical footprint skews UK/US/AU. **This must be verified before committing.** |
| **EURES** | Official EU portal, 30+ countries. ❌ **Not usable for extraction** — terms explicitly forbid "screen scraping or any other automated or manual system to extract job vacancy data"; bulk download decommissioned October 2023; the only API is a reverse-engineered community spec with no stability guarantees. Its **published aggregate statistics** have download buttons and remain legitimate, but give vacancy totals, not tech-specific counts. |
| **Eurostat job vacancy statistics** | Official, free, complete EU coverage. ⚠️ Sector-level at best — no split between software and product roles. Useful as a denominator or sanity check, not as the criterion value. |
| **National public employment services** | Every EU state runs one, many with open APIs. ✓ Authoritative and complete per country. ⚠️ 27 different APIs, 27 schemas, 27 languages — the highest-fidelity and highest-effort option. Fits the plug-in model (`reqs.md` §6.7): one adapter per country, added incrementally. |
| **LinkedIn / Indeed** | Best raw coverage. ❌ No usable free API; both actively block automated access. |

### Open questions before this can be built

1. **Does Adzuna cover the EU member states we care about?** One lookup settles it and decides
   whether this is one adapter or twenty-seven.
2. **How are role families defined?** "Software engineer" and "product manager" need a query
   definition — keyword sets, or a standard taxonomy such as **ESCO**, the EU's own
   occupation classification, which would travel across languages and countries.
3. **Absolute counts or per-capita?** Absolute measures whether enough openings exist at all;
   per-capita measures concentration. Absolute is probably right — three product roles in a
   city is a hard constraint regardless of population — but it makes the criterion partly a
   proxy for city size.
4. **Volatility.** Posting counts swing with hiring cycles, so a single-day snapshot is not
   representative. This criterion wants a short `max_age` and ideally a rolling average rather
   than a point reading.

---

## Sources consulted

WhereNext [index](https://getwherenext.com/data/global-relocation-index-2026) ·
[alternatives](https://getwherenext.com/alternatives) ·
[Numbeo comparison](https://getwherenext.com/blog/free-numbeo-alternative-cost-of-living) ·
[Eurostat API](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction) ·
[Eurostat Cities/Urban Audit](https://ec.europa.eu/eurostat/cache/metadata/en/urb_esms_fr.htm) ·
[World Bank Indicators API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation) ·
[IMF SDMX 3.0](https://apis.io/apis/imf/imf-sdmx-30-data-api/) ·
[OECD API](https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html) ·
[UNODC Data Portal](https://data.unodc.org/) ·
[Open-Meteo](https://open-meteo.com/) ·
[OpenAQ](https://docs.openaq.org/about/about) ·
[EEA air quality](https://openair-project.github.io/euroaq/) ·
[Ookla Open Data](https://github.com/teamookla/ookla-open-data) ·
[Numbeo API](https://www.numbeo.com/common/api.jsp) ·
[Google Places billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing) ·
[Doing Business discontinuation](https://www.worldbank.org/en/businessready/about-us) ·
[Euro Health Consumer Index](https://en.wikipedia.org/wiki/Euro_Health_Consumer_Index) ·
[OECD Better Life Index](https://en.wikipedia.org/wiki/OECD_Better_Life_Index) ·
[EIU Global Liveability Index](https://en.wikipedia.org/wiki/Global_Liveability_Index) ·
[Mercer Quality of Living 2024](https://www.mercer.com/en-ie/about/newsroom/2024-quality-of-living-city-ranking/) ·
[Eurostat Quality of Life indicators](https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Quality_of_life_indicators_-_measuring_quality_of_life) ·
[Numbeo indices explained](https://www.numbeo.com/quality-of-life/indices_explained.jsp)
