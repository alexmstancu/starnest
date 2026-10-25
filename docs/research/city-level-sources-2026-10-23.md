# City level — what the data can actually answer (research, 2026-10-23)

> **Status: research input to `devplan-v2.md`, not a decision.** Every coverage number below was
> **fetched live on 2026-10-23**, not read from a source's description. Scripts and raw output
> were kept in the session scratchpad, not the repo. This is the "found by fetching it" method
> that caught Q228 and the Adzuna gap at country level, applied before a line of city code exists.

## 0. Headline findings

1. **The country screen currently filters nothing.** All 32 countries are `matching` under
   `local_employment` (`make rank`, 2026-10-23). "Cities only for matching countries" therefore
   nominates for all 32, so top-5-by-population means **160 cities** before any manual add.
2. **The city catalog has no national factors, and `reqs.md` 4 assumes it does.** It says a
   city's score never includes its country's score because "national factors are already
   represented by city-level criteria". The catalog in `reqs.md` 7.2 has no tax rate, health
   system, rule of law, political stability, English proficiency, openness or work-life balance.
   Ranked on it, Cluj and Zurich would differ on rent and climate, and **tax and governance would
   count for nothing.** This is the largest design gap found, and it is architectural (section 3).
3. **Numbeo can no longer be scraped.** Its terms now say: "Automated data collection methods
   (such as scraping or crawling) are strictly prohibited" without prior written permission.
   `datasources.md` 9.1 decided "scrape, do not subscribe", and the city plan's cost of living,
   rent, safety and public transport all rested on that. Personal use of Numbeo data is still
   free, so typing a figure in by hand is allowed; fetching it automatically is not.
4. **Eurostat Urban Audit is richer than assumed, but its gaps fall on whole countries.** It has
   ICT jobs, murders, apartment prices, rent per m², foreign-born share and transit ticket prices.
   But **Austria, Denmark, Greece, Ireland, Iceland and Liechtenstein report nothing since 2015**,
   Cyprus and Luxembourg stop at 2016, and the UK is frozen at 2018. Scoring on it would compare
   cities from different countries on different evidence, which is the Adzuna lesson (`0487`)
   again.
5. **Regional (NUTS) statistics are the missing middle tier, and their coverage is even.**
   Member states are legally required to report them, unlike Urban Audit. Unemployment, high-tech
   employment and life expectancy by region answer **31 of 32 countries at 2024-25**. Police-recorded
   robbery by NUTS 3 region answers 31 of 32 at 2024, Liechtenstein included.
6. **The EU's own city survey covers 79 cities in 31 of our 32 countries.** The *Quality of Life
   in European Cities* survey (2023, about 850 interviews per city, DG REGIO) covers every country
   except Liechtenstein, including Reykjavík, Oslo, Geneva and Zurich. It asks about victimisation
   ("was money or property stolen from you", "were you assaulted") as well as perception, and it
   asks about local administration (speed, simplicity, fees, corruption). **That replaces the
   uncitable `city.admin_ease` AssignedScore with a measurement.**
7. **Most of the plan works from coordinates, and that holds up.** Open-Meteo (already an
   adapter), Ookla (Q1 2026, CC BY-NC-SA, fine for personal use), the CAMS air-quality reanalysis
   (10 km grid, 2013-2025), OpenStreetMap, WDPA and the geometry attributes all work for a village
   as readily as a capital. **Two exceptions:** Open-Meteo's sunshine is already known to run
   30-68% high (`0497`), and OpenFlights' routes are from 2017.
8. **Two current, official replacements exist for the weak spots.** The **WMO 1991-2020 climate
   normals** (NCEI accession 0253808) publish total sunshine hours per station: 6,625 stations,
   one edition, measured. **Eurostat's airport-pair tables** (`avia_par_*`) give 2024 passenger
   counts per route (for example Bucharest–Zurich), which answers `city.flights_to_home` from the
   adapter we already run.

## 1. The state the plan starts from

| Fact | Where | Consequence |
|---|---|---|
| The `city` level row exists, nested under `country` | `0100`, `0114` | No schema needed to *hold* a city |
| `parent_not_matching` is computed in ranking | `evaluation/ranking.py` | Already level-agnostic |
| **Zero city attributes, criteria or sets** | catalog | The whole city catalog is migrations |
| **No nomination lifecycle** | `candidates/` | The one genuinely new state machine |
| `population_centre` holds the five largest GeoNames places per country, with coordinates | `0464` | A ready-made first draft of a roster, **but it includes suburbs** (Tallaght, Petržalka) and Malta's five localities of one conurbation. Right for weighting climate, wrong as candidates |
| All 32 countries `matching` | live DB | The country screen filters nothing (finding 1) |
| `country.annual_sunshine_hours` cites Wikipedia as its publisher | `published_tables/tables/national_met_office_sunshine.csv` | The WMO normals would also repair this at country level (separate task, flagged only) |

## 2. Sources, measured

### 2.1 Eurostat Urban Audit (`urb_*`): cities listed with a figure since 2015, by country

Cities with a figure; `@` gives the median latest year, two digits. The population row shows
it everywhere; the other rows show it only where it is before 2022. Of 883-912 cities listed in
our countries.

| Indicator | AT | BE | BG | HR | CY | CZ | DK | EE | FI | FR | DE | EL | HU | IE | IT | LV | LT | LU | MT | NL | NO | PL | PT | RO | SK | SI | ES | SE | CH | UK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Population | – | 15@25 | 18@25 | 7@24 | 1@16 | 18@22 | – | 3@25 | 9@25 | 81@23 | 151@25 | – | 19@24 | 1@16 | 90@25 | 4@25 | 6@25 | 1@16 | 1@24 | 47@24 | 4@23 | 75@24 | 16@25 | 35@18 | 8@22 | 2@24 | 118@24 | 15@25 | 10@25 | 135@18 |
| Foreign-born share | – | 15 | 18 | 7 | – | – | – | 3 | 9 | 81 | 108 | – | 19 | – | 90 | 4 | 6 | – | – | 47 | 4 | – | 16 | – | 8 | 2 | 118 | 15 | 10 | 132@18 |
| Murders | – | 15 | 18 | 7 | – | 18@17 | – | 3 | 9 | 36 | 129 | – | 19 | – | 75 | 4 | 6 | – | 1 | 47 | – | 68@18 | 16 | 35@18 | 8 | 2 | 118 | – | 10 | 127@18 |
| Rent per m² | – | – | 18@22 | 7 | – | 12@17 | – | – | 9 | – | 127@22 | – | – | – | – | 4 | 5 | – | 1@15 | – | – | – | 16 | – | – | – | 95 | – | 10 | – |
| Apartment price per m² | – | – | – | 7 | – | – | – | 3 | 9 | 74 | 144@22 | – | 19 | – | – | 4 | 6 | – | – | – | 4 | – | 16 | – | 8 | 2 | 112 | – | – | – |
| Unemployment rate | – | 15 | 18@22 | 7 | – | – | – | 3 | 9 | 81 | 127@20 | – | 19@22 | – | 90 | 4 | 5 | – | 1 | 47 | – | – | 16@21 | – | – | 2 | 118 | 15 | 9@21 | 133@18 |
| ICT jobs | – | 15 | 17 | 7 | – | – | – | 2 | 9 | 81 | 127@20 | – | 19 | – | 90 | 4 | 6 | – | 1 | 47 | 4 | 25@18 | 16 | – | 8 | 2 | 118 | 13@18 | 10 | 133@18 |

Iceland and Liechtenstein list no cities at all. **Verdict: a supplementary source for display
and for the countries it covers, never the sole source of a scored criterion.**

### 2.2 Eurostat regional (NUTS): regions with a figure, by country

| Dataset | Level | Countries answered | Missing | Latest |
|---|---|---|---|---|
| `lfst_r_lfu3rt` unemployment rate | NUTS 2 | **31** | LI | 2025 (UK 2019) |
| `htec_emp_reg2` high-tech sector employment | NUTS 2 | **31** | LI | 2025 (UK 2019) |
| `demo_r_mlifexp` life expectancy | NUTS 2 | **32** | – | 2024 (UK 2018) |
| `crim_gen_reg` robbery per 100k | NUTS 3 | **31** | UK | 2024 |
| `crim_gen_reg` homicide per 100k | NUTS 3 | 29 | NL, SE, UK | 2024 |
| `crim_gen_reg` burglary per 100k | NUTS 3 | 26 | EE, HU, IT, NO, UK | 2024 |
| `crim_gen_reg` motor vehicle theft | NUTS 3 | 27 | CY, HU, LI, LU, UK | 2024 |
| `nama_10r_2hhinc` household income (PPS per head) | NUTS 2 | 28 | IS, LI, CH, UK | 2023-24 |
| `hlth_rs_physreg` physicians per 100k | NUTS 2 | 21 | DE, IE, EE, LV, CY, LU, MT, IS, LI, UK | 2024 |
| `isoc_r_broad_h` household broadband | NUTS 2 | 26 | DE, EL, PL, LI, UK | **2021** |

**Eurostat's own caveat:** police-recorded crime is **not comparable across countries**
(definitions and reporting rates differ), homicide excepted. A cross-country city ranking on
regional robbery would partly rank police forces. Section 4 proposes how to use it honestly.

### 2.3 The Quality of Life in European Cities survey, 2023

79 cities in our countries: AT 2, BE 3, BG 2, HR 1, CY 1, CZ 2, DK 2, EE 1, FI 2, FR 6, DE 7,
EL 2, HU 2, IE 1, IT 6, LT 1, LU 1, LV 1, MT 1, NL 3, PL 4, PT 2, RO 3, SK 2, SI 1, ES 4, SE 2,
UK 6, IS 1, NO 1, CH 2. **Liechtenstein absent.** Earlier editions 2019, 2015, 2012 (on Eurostat).

Questions that map onto the catalog: feeling safe walking alone at night (city and
neighbourhood); theft and assault in the last 12 months; confidence in the police; satisfaction
with public transport, health care, schools, green spaces, air quality, noise and cleanliness;
public transport affordable, frequent, reliable; "easy to find a good job"; "easy to find good
housing at a reasonable price"; a good place for immigrants and for families with young
children; and local administration (time to resolve, straightforward procedures, reasonable
fees, information online, corruption).

**Each is a single question's share of answers, not a composite**, so Q223 does not bar it.
It is a perception or self-report measure from a standardised method, and it is labelled as such.

### 2.4 Coordinate-bound sources

| Source | Verified | Notes |
|---|---|---|
| Open-Meteo | Already an adapter | Temperature, precipitation, humidity by point. **Not sunshine** (`0497`) |
| WMO 1991-2020 normals | Exists, composite CSV per parameter | Sunshine, precipitation, temperature per station. Nearest-station distance must be recorded |
| CAMS European air-quality reanalysis | ADS, 0.1°, 2013-2025, validated a year behind | Gridded PM2.5 for any point; heavy NetCDF, one-off processing. EEA station statistics as a lighter alternative |
| Ookla Open Data | CC BY-NC-SA 4.0, quarterly, Q1 2026, ~610 m tiles, Parquet on public S3 | Non-commercial: fits a personal tool |
| OpenStreetMap / Overpass | Free, rate-limited | Hospitals, schools, stops, culture, trails. Counts depend on how completely OSM is mapped locally |
| Eurostat `avia_par_*` | 2024 passengers per airport pair | Flights home from the nearest airport(s); replaces OpenFlights 2017 for this attribute |
| GISCO Urban Audit boundaries (`URAU_2021`) | GeoJSON for cities and functional urban areas | Gives each city its official shape and NUTS 3 code |
| Copernicus `sis-ecde-climate-indicators` | NUTS aggregation exists; the NUTS 3 layer name is still to confirm on first fetch | Projected heat days per region, the same adapter as `country.projected_summer_heat_days` |

### 2.5 Published tables

| Source | Coverage | Notes |
|---|---|---|
| Deloitte Property Index 2026 | 75 cities, 22 of our countries, 2025 figures | Rent per m² and new-dwelling price per m². Missing CY, EE, IS, LV, LT, LI, MT, SI, SE, CH. Transcribed like RSF and MIPEX |

### 2.6 Ruled out or demoted

| Source | Why |
|---|---|
| **Numbeo, automatically** | Terms forbid scraping. The API is $250/month for 200k requests; we would use about 5% of it. Manual entry for personal use stays possible, at `low` confidence, above its ~150k population floor |
| **Numbeo's indices** (safety, purchasing power, public transport) | Composites that trade goods against each other (`datasources.md` 10.5): barred by Q223 regardless of access |
| **Job-posting counts** | Retired at country level for coverage (`0487`). City coverage can only be thinner |
| **Open-Meteo sunshine** | 30-68% high, unevenly (`0497`) |

## 3. The structural proposal: four footprints

A city figure is measured at one of four **footprints**, and the plan should say which, per
attribute:

| Footprint | Example | Coverage behaviour |
|---|---|---|
| **Point** | Temperature, internet speed, distance to the sea | Works for any city, any size |
| **City** | Urban Audit, the QoL survey, Deloitte | Large cities only; patchy by country |
| **Region** (NUTS 2 or 3) | Unemployment, tech employment, recorded crime | Even across 31-32 countries; every city in a region shares the figure |
| **Nation** | Tax, health system, rule of law, English | The country's value; every city shares it |

**Two consequences for the architecture revision:**

1. **The footprint belongs in the provenance.** A city showing its region's unemployment rate
   must say so, for the reason a stand-in names Switzerland for Liechtenstein: a proxy that says
   so is honest, one that hides is fabrication with the paperwork filled in. Whether this is a
   column on `value`, a property of the attribute, or a declared mapping like `stand_in` is the
   first ontology question of v2.0.
2. **National factors need a way into the city score** (finding 2). The options are in
   section 6, question B. `reqs.md` Q165 already lets a *compound rule* read the parent country's
   attribute, so the parent chain exists.

**Within one region, a regional figure cannot separate two cities**: Lyon and Villeurbanne
share NUTS 3. That is correct, not a defect. It only means regional criteria rank regions, and
the point and city tiers do the separating.

## 4. Attribute by attribute, against `reqs.md` 7.2

Verdicts: **keep** (source as planned works), **replace** (the planned source fails, another
answers), **derive**, **retire**, **new**.

| Attribute | Planned source | Verdict | Proposed source, footprint, coverage |
|---|---|---|---|
| `city.cost_of_living_monthly` | Numbeo | **derive** | City rent (below) plus the household's non-housing spend scaled by the national price level excluding housing (`prc_ppp_ind`, categories A01 less A0104). City and nation. The first real derived attribute (devplan-v2 W5) |
| `city.purchasing_power` | Numbeo index | **replace** | Regional disposable household income per head in PPS (`nama_10r_2hhinc`), NUTS 2, 28/32 (CH, UK, IS, LI need national offices) |
| `city.rent_centre` | Numbeo | **replace** | Deloitte (22 countries) + Urban Audit rent per m² (11) + national offices for the rest. **Per m², not per bedroom**: the bedroom key was Numbeo's shape. Large cities only |
| `city.property_purchase_price_m2` | Registries, Eurostat | **keep, re-sourced** | Deloitte + Urban Audit apartment price per m² (13 countries) |
| `city.rooms_per_person`, `city.overcrowding_rate` | Urban Audit | **demote** | Urban Audit covers 11 countries. Display only, or national by degree of urbanisation (to verify) |
| `city.tech_software_jobs`, `city.tech_product_jobs` | Unresolved | **retire** | As at country level (`0487`) |
| (new) `city.tech_employment_share` | – | **new** | High-tech sector employment share, NUTS 2, 31/32. The regional twin of `country.tech_employment_share` |
| (new) `city.unemployment_rate` | – | **new** | NUTS 2, 31/32 |
| `city.international_employers` | LLM | **keep** | Permitted LLM use 2 (`reqs.md` 6.10). The one city attribute that spends money per city |
| `city.safety` | Numbeo index | **replace, split** | Feeling safe at night and victimisation (QoL, 79 cities, comparable across countries); homicide by NUTS 3 (29/32). Recorded robbery, burglary and vehicle theft **displayed rather than scored**, unless a within-country method is chosen (section 6, question D) |
| `city.healthcare_access` | OSM distance | **keep, but weak** | Every city is close to a hospital. Pair with regional life expectancy (32/32) and QoL health-care satisfaction (79) |
| `city.paediatric_healthcare_access` | OSM | **retire** | OSM paediatric tagging is too sparse (Annecy: one object within 15 km, section 7). Returns if a national registry answers it |
| `city.temperature` | Open-Meteo | **keep** | Seasonal, as at country level (Q213 daytime highs) |
| `city.sunshine_hours` | Open-Meteo | **replace** | WMO 1991-2020 normals, nearest station |
| `city.air_quality` | OpenAQ, EEA | **keep, re-sourced** | CAMS reanalysis by point, or EEA station annual means |
| (new) `city.projected_summer_heat_days` | – | **new** | Copernicus at NUTS 3. `mild_now_brutal_later` then works at city level |
| `city.internet_quality` | Ookla | **keep** | Verified |
| `city.public_transport` | Numbeo index | **replace** | QoL public-transport frequency and reliability (79), OSM stop density (any city) |
| `city.flights_to_home` | Flight APIs | **replace** | Eurostat `avia_par_*`, 2024 |
| `city.proximity_to_hub` | Geometry | **keep** | |
| Nature, all nine | Coordinate datasets | **keep** | All computed offline from vendored geometry (coastline, DEM, OSM trails and water, WDPA, EEA bathing water, the 2016 night-sky atlas, Corine). The largest *engineering* item in v2.0, but free and the same for every city |
| `city.heritage_and_culture_density` | OSM, UNESCO, Wikidata | **keep** | Any city |
| `city.expat_community_size` | Urban Audit | **replace** | Census 2021 foreign-born share by NUTS 3 (`cens_21cob_r3`), 31/32; UK from its own census. Urban Audit (20 countries) beside it for city precision |
| `city.admin_ease` | Uncitable AssignedScore | **replace** | QoL local-administration questions (79) |
| `city.schooling_options` | OSM | **keep** | Count from OSM; QoL school satisfaction beside it |
| `city.childcare_cost_availability` | Eurostat | **split** | Availability: Urban Audit enrolment 0-4 (17 countries). Cost: national figure (OECD net childcare costs) |
| **National factors** (tax, health system, rule of law, stability, English, openness, press freedom, work-life, family policy) | **absent** | **new mechanism** | The country's value, read through the parent (section 6, question B) |

## 5. What this corrects in the existing documents

- `datasources.md` 9.1, "scrape, do not subscribe": **no longer permitted** by Numbeo's terms.
- `datasources.md` 5, city table: Numbeo is the primary for four attributes; none can be fetched.
- `reqs.md` 4, "national factors are already represented by city-level criteria": **not true of
  the 7.2 catalog**.
- `reqs.md` 7.2: three Numbeo composites (safety, purchasing power, public transport) are barred
  by Q223, which was decided after 7.2 was written.
- `reqs.md` 7.2, `city.sunshine_hours` from Open-Meteo: contradicted by `0497`.
- `reqs.md` 7.3 and 7.4, `two_role_feasibility` derived from job counts: the counts are retired, so
  it stays a manual gate permanently unless a regional tech-employment floor is accepted as its
  input.

## 6. Decisions that are the household's

**Decided 2026-10-24** (questionnaire, all four on the recommended option):

| | Decision |
|---|---|
| **A** | **Seed the 79 QoL-survey cities**; add any other place by hand (it enters `approved`); LLM proposals are names only and wait as `proposed` for approval. Liechtenstein's Vaduz is a manual add |
| **B** | **A city criterion may judge its parent country's attribute** through the parent link. One stored national figure, shared by every city in that country, labelled as national in the drill-down |
| **C** | **Cost of living is derived**: city rent per m² times the household's dwelling size, plus the household's non-housing spend scaled by the national price level excluding housing. No Numbeo |
| **E** | **The country screen narrows by hand** with `not_manually_excluded`; no score cutoff |

**Decided 2026-10-24, second round:** **D** survey answers are scored and labelled as a resident
survey; homicide (NUTS 3) is scored, and robbery, burglary and vehicle theft are displayed only.
Both city criteria sets mirror the country ones. The deferred UI features move to v2.1.

The options as first posed:

- **A. The roster.** Top 5 by population per matching country (the `reqs.md` 6.1 default, 160
  cities, suburbs and conurbation fragments included), the 79 QoL cities (well measured,
  2-7 per country), Urban Audit cities above a population (official city boundaries, ~880 in
  total), or a mix with manual adds and LLM proposals on top.
- **B. National factors.** (1) A city criterion may judge a parent-country attribute through the
  parent chain; (2) copy national values into city attributes; (3) keep the city score
  city-only and show the country score beside it (the current text, which drops tax and
  governance from the ranking).
- **C. Cost of living without Numbeo.** Derived (rent plus national non-housing prices), Numbeo by
  hand at `low` confidence, or ask Numbeo for written permission.
- **D. Safety.** Survey and homicide scored, recorded crime displayed; or score recorded crime as
  well, accepting that it partly ranks police forces.
- **E. Narrowing the country screen.** Prune by hand with `not_manually_excluded` (the designed
  mechanism), enforce more gates, or accept all 32.

## 7. Verified on 2026-10-24, and still to verify

**Verified:**

- **Copernicus `regional_layer` offers `nuts_level_3`** (the CDS process description lists
  `nuts_level_0` to `nuts_level_3`). The same dataset also has `tropical_nights`,
  `heatwave_days` and `high_utci_days` (heat stress), all relevant to living in a city.
- **Census 2021 country of birth by NUTS 3 (`cens_21cob_r3`, `c_birth=FOR`) answers 31 of 32**,
  all but the UK (whose own 2021 census publishes it by local authority).
  `city.expat_community_size` therefore moves from Urban Audit (20 countries) to the census:
  **replace**, region footprint.
- **The public Overpass server is not a source a run can depend on.** It refuses requests
  without a descriptive User-Agent (HTTP 406) and throttles repeated queries: most of a
  12-query sample failed even with 8-second pauses. **OpenStreetMap should be read from
  country extracts (Geofabrik) processed offline**, which is also what makes a figure
  repeatable: it names the extract date it was counted from.
- **OSM paediatric tagging is too sparse to score.** Annecy (about 130k people, with a regional
  hospital) shows one `healthcare:speciality=paediatrics` object within 15 km.
  `city.paediatric_healthcare_access` becomes **retire** unless a national registry answers it.

**Still to verify:**

- The CAMS download size per year, and whether EEA station statistics suffice instead.
- The national rent sources for CY, EE, IS, SI, SE (Deloitte and Urban Audit both miss them).
- The Deloitte city tables themselves: text extraction recovered the country list and the
  75-city count, but the figures sit in charts.
