/**
 * One name per household field, for every screen that shows one.
 *
 * **Shared so the two cannot drift.** The design's review found the sidebar and Configure
 * calling the same field by two names (UX review I), which makes a reader wonder whether they
 * are the same field. A constant is what makes "one vocabulary" a fact rather than a
 * convention somebody has to remember.
 *
 * **It lives in `format/`, which is where the wire's vocabulary becomes prose** --
 * `formatMatchStatus` is the same job. The layering settled it: `shell/` may not import from
 * `routes/`, so a constant both need cannot live inside a feature folder, and `format/` is
 * the nearest place both can reach.
 */
export const HOUSEHOLD_LABELS = {
  net_income: "Net income",
  number_adults: "Adults",
  number_children: "Children",
  target_monthly_spend: "Comfortable monthly spend",
  max_rent: "Rent ceiling",
  home_country_candidate: "Moving from",
  home_city_candidate: "Moving from (city)",
  citizenships: "Passports held",
} as const;

export type HouseholdField = keyof typeof HOUSEHOLD_LABELS;
