/**
 * The four tabs of `reqs.md` §8, in workflow order: configure the criteria, run acquisition,
 * read the ranking, compare candidates.
 *
 * One table, so the sidebar navigation and the router can never disagree about which routes
 * exist.
 */

export interface RouteDefinition {
  path: string;
  label: string;
  /** Shown under the heading until P6 replaces the placeholder with the real screen. */
  summary: string;
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    path: "/configure",
    label: "Configure",
    summary:
      "Criteria and weights, criteria sets, matching thresholds and match rules, source priority, candidates, household and settings.",
  },
  {
    path: "/run",
    label: "Run",
    summary:
      "Scope selector, dry-run estimate, spend cap, live progress, failures with one-click retry, and run history.",
  },
  {
    path: "/rank",
    label: "Rank",
    summary:
      "The ranking table, the non-matching section, attribute drill-down, candidate detail with full provenance, and external scores.",
  },
  {
    path: "/compare",
    label: "Compare",
    summary:
      "One focus candidate against its comparators: aggregate deltas, the per-attribute table with weighted contributions, and the templated synthesis.",
  },
] as const;

/** Where `/` lands. The household is configured first on a fresh installation (`reqs.md` §8.2). */
export const DEFAULT_ROUTE = ROUTES[0]!.path;

export function findRouteByPath(path: string): RouteDefinition | undefined {
  return ROUTES.find((route) => route.path === path);
}
