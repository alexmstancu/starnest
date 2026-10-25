/**
 * The four tabs of `reqs.md` 8, in workflow order: configure the criteria, run acquisition,
 * read the ranking, compare candidates.
 *
 * One table, so the sidebar navigation and the router can never disagree about which routes
 * exist.
 */

export interface RouteDefinition {
  path: string;
  label: string;
}

// **No type annotation, deliberately.** An annotation on a `const` wins over the `as const`
// after it, so `ROUTES: readonly RouteDefinition[]` widened every `path` back to `string` and
// `RoutePath` below evaluated to `string` -- which made `App`'s `Record<RoutePath, …>` a
// `Record<string, …>` that accepts anything and requires nothing. `satisfies` does the
// checking an annotation would, and alone it keeps the literals (P77).
export const ROUTES = [
  {
    path: "/configure",
    label: "Configure",
  },
  {
    path: "/acquire",
    label: "Acquire",
  },
  {
    path: "/rank",
    label: "Rank",
  },
  {
    path: "/compare",
    label: "Compare",
  },
] as const satisfies readonly RouteDefinition[];

/** Every path the shell routes, as literals, so `App` must name a screen for each of them. */
export type RoutePath = (typeof ROUTES)[number]["path"];


/**
 * The fragment that leads to Acquire's "Every acquisition so far" (PL-127): the sidebar links to
 * the table itself, and Acquire takes the reader there.
 */
export const HISTORY_ANCHOR = "every-acquisition";

/** Where `/` lands. The household is configured first on a fresh installation (`reqs.md` 8.2). */
export const DEFAULT_ROUTE = ROUTES[0].path;

export function findRouteByPath(path: string): RouteDefinition | undefined {
  return ROUTES.find((route) => route.path === path);
}
