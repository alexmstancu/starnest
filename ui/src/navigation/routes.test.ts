/**
 * That `RoutePath` is still a union of literals, and not `string`.
 *
 * **A type test, because the failure is invisible at runtime until it is catastrophic.**
 * `App` maps `Record<RoutePath, ComponentType>` and its docstring promises that a tab added
 * without a screen fails to compile. When `RoutePath` is `string` that map requires nothing,
 * the build stays green, and the tab renders `SCREENS[path]` as `undefined` -- React's
 * "Element type is invalid... got: undefined", which `CLAUDE.md` records as having cost this
 * project twice.
 *
 * It widened because `routes.ts` wrote both an annotation and `as const satisfies`. The
 * annotation wins, and `satisfies` only checks -- it never narrows. Writing both defeats the
 * purpose of each, and nothing could tell.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE, ROUTES, type RoutePath } from "./routes";

/**
 * Resolves to `RoutePath` while it is a literal union, and to an unassignable marker the
 * moment it widens -- so the assignment below stops compiling.
 */
type MustNotBeWidenedToString<T> = string extends T
  ? { "RoutePath has widened to string": never }
  : T;

/** Exported so the compiler keeps it and lint does not call it unused. */
export const A_ROUTE_PATH_IS_A_LITERAL: MustNotBeWidenedToString<RoutePath> =
  "/configure";

describe("the route table", () => {
  it("still types its paths as literals", () => {
    // The assertion is the declaration above, which `tsc` checks. This asserts the value is
    // real, so the type test cannot be satisfied by a path that does not exist.
    expect(ROUTES.map((route) => route.path)).toContain(A_ROUTE_PATH_IS_A_LITERAL);
  });

  it("lands somewhere it actually routes", () => {
    expect(ROUTES.map((route) => route.path)).toContain(DEFAULT_ROUTE);
  });

  it("gives every route a label and a summary, and no path twice", () => {
    expect(ROUTES.every((route) => route.label && route.summary)).toBe(true);
    expect(new Set(ROUTES.map((route) => route.path)).size).toBe(ROUTES.length);
  });
});
