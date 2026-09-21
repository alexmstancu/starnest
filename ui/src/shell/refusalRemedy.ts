import { type RoutePath, findRouteByPath } from "../navigation/routes";

/**
 * A refusal the shipped state produces rather than a mistake: `score_scale_max` is provisional
 * by design and has no default (`reqs.md`), so nothing can be ranked until somebody sets it.
 * Named here because it is the one refusal a reader meets before they have done anything.
 */
export const SCORE_SCALE_NOT_SET = "score_scale_not_set";

export interface Remedy {
  label: string;
  path: RoutePath;
}

/**
 * Where to go to lift a refusal, when going somewhere is what lifts it.
 *
 * **This lives in `shell/`, not in `api/`.** `errorPresentation` turns a code into a sentence
 * and may not know a screen exists -- the layering says so in as many words, and the moment
 * the port to the contract knows about routes, "the interface renders what the API returns"
 * has a hole in it. Which screen fixes a refusal is navigation's question, so it is answered
 * here.
 *
 * Only refusals a *setting* clears appear below. A 404 and a lock are not remedied by going
 * anywhere, and offering a button that leads nowhere useful is worse than offering none.
 */
const REMEDIES: Record<string, Remedy> = {
  [SCORE_SCALE_NOT_SET]: { label: "Set it in Configure", path: "/configure" },
  invalid_comparison: { label: "Change it in Configure", path: "/configure" },
};

export function remedyFor(code: string): Remedy | null {
  const remedy = REMEDIES[code];
  // A remedy pointing at a route the shell does not have would render a dead link.
  if (!remedy || !findRouteByPath(remedy.path)) return null;
  return remedy;
}
