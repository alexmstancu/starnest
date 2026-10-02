-- Career's two biggest criteria counted job postings, and no source can count them.
--
-- `country.tech_software_jobs` and `country.tech_product_jobs` have carried 6.84 of the
-- `local_employment` level's 100 points since the catalog was seeded, with no figure for any
-- country and no source declared. `datasources.md` section 11 recorded the search and left one
-- question open: whether Adzuna, the only candidate with a vacancy-count endpoint and real
-- credibility, covers the countries this household cares about.
--
-- **It does not.** Adzuna serves 19 countries, 10 of ours: Austria, Belgium, Switzerland,
-- Germany, Spain, France, Italy, the Netherlands, Poland and the UK. The 22 it misses include
-- Ireland, which ranks third today, and Portugal, Denmark, Sweden, Finland and Norway. Scoring
-- a 6.8-point criterion for under a third of the roster would compare two groups on different
-- evidence, so the attribute is retired rather than partly answered. The other candidates were
-- already ruled out in section 11: EURES forbids extraction, LinkedIn and Indeed block it, and
-- 27 national employment services are 27 adapters.
--
-- **The weight moves to the attribute that measures the same thing and has figures.**
-- `country.tech_employment_share` is Eurostat `isoc_sks_itspt` -- employed ICT specialists as a
-- share of total employment -- and it answers 30 of the 32 directly. It is a *stock* where a
-- posting count is a *flow*: it says how much of a country's workforce does this work, rather
-- than how many openings happened to be advertised on the day somebody looked. Section 11's
-- own fourth open question was about exactly that volatility.
--
-- **What is lost is the software/product split.** Eurostat has one ICT occupation class and
-- cannot separate an engineer from a product manager. The two attributes are retired rather
-- than dropped, so the distinction is recoverable the day a source can make it -- the same
-- shape as `crime_safety_index` (`0442`) and `income_tax_effective` (`0445`), both of which
-- asked a question no source answered.
--
-- `minimal` is untouched: it never weighed the posting counts.
-- depends: 0486-a-saved-ranking-keeps-its-reason-and-its-confidence-split

-- `local_employment`: 14.44 + 24.44 + 24.45 = 63.33, leaving international_employers at 20.00
-- and average_working_hours at 16.67. The pillar still sums to 100.
UPDATE criterion SET weight = 63.33
WHERE  criteria_set = 'local_employment' AND attribute = 'country.tech_employment_share';

-- `remote_only`: 21.05 + 15.79 + 15.79 = 52.63, leaving 42.11 and 5.26.
UPDATE criterion SET weight = 52.63
WHERE  criteria_set = 'remote_only' AND attribute = 'country.tech_employment_share';

DELETE FROM criterion
WHERE  attribute IN ('country.tech_software_jobs', 'country.tech_product_jobs');

-- Retired, never deleted: the rows keep their pillar, their type and any value ever stored
-- against them, and a catalog that forgets what it used to ask cannot explain an old ranking.
UPDATE attribute SET lifecycle_status = 'retired'
WHERE  id IN ('country.tech_software_jobs', 'country.tech_product_jobs');
