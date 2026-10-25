import type { RunPlan } from "../../api/endpoints";
import { formatCount, sourceName } from "../../format/display";

/**
 * Which sources an armed acquisition would ask, in words, for its confirmation strip (PL-124).
 *
 * **Named before anything is agreed to**, because which sources a retry reaches is what it costs:
 * a retry asks only the sources that failed, a scoped run every source switched on, and a paid
 * one among them is the reason the strip exists. Empty when the plan names none.
 */
export function describeSourcesAsked(
  plan: Pick<RunPlan, "by_source">,
  names: ReadonlyMap<string, string>,
): string {
  const asked = (plan.by_source ?? []).flatMap(({ data_source, items }) =>
    data_source === undefined
      ? []
      : [`${sourceName(names, data_source)} about ${formatCount(items ?? 0)} ${items === 1 ? "item" : "items"}`],
  );
  if (asked.length === 0) return "";
  const last = asked.pop()!;
  return `It asks ${asked.length === 0 ? last : `${asked.join(", ")} and ${last}`}.`;
}
