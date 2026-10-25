/**
 * Where Compare opens (PL-102, D26): the household's home, where it is a candidate at this
 * level, else the top of the ranking. **No level is named**: whichever of the household's home
 * candidates the level's roster holds is home here.
 */
export function homeIn(
  roster: ReadonlySet<string>,
  household: { home_country_candidate?: string | null; home_city_candidate?: string | null } | null,
): string | null {
  const homes = [household?.home_country_candidate, household?.home_city_candidate];
  return homes.find((home): home is string => typeof home === "string" && roster.has(home)) ?? null;
}

/** The first candidate the ranking lists that the roster holds, or null. */
export function topOfRanking(
  roster: ReadonlySet<string>,
  ranking: { candidates?: readonly { candidate: string }[] } | null,
): string | null {
  return ranking?.candidates?.find((each) => roster.has(each.candidate))?.candidate ?? null;
}
