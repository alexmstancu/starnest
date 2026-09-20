import type { StoredValue } from "../../api/endpoints";

/**
 * A payload as one line. **The shape follows the value type**, which is the server's word for
 * what the figure is; nothing here converts, rounds or rescales it.
 */
export function describeFigure(value: StoredValue): string {
  const payload = value.payload as Record<string, unknown>;
  if ("magnitude" in payload)
    return `${String(payload["magnitude"])} ${String(payload["unit"])}`;
  if ("amount_eur" in payload)
    return `${String(payload["amount"])} ${String(payload["currency"])}`;
  // **An index carries its bounds, because the bounds are what make it mean anything** (P57).
  // `reqs.md` reserves `Index` for figures whose scale does the work -- a World Bank governance
  // figure of 1.07 sits on -2.5 to 2.5, and printed bare it reads like a percentage. This
  // branch and the next were duplicates, so both types lost everything but the number.
  if ("value" in payload && "provider" in payload)
    return (
      `${String(payload["value"])} on ${String(payload["scale_min"])}` +
      `–${String(payload["scale_max"])} (${String(payload["provider"])})`
    );
  // An assigned score carries its range and who assigned it: a 7 out of 10 from a model is a
  // different claim from a 7 out of 10 somebody wrote down (`reqs.md` 3.3a).
  if ("value" in payload && "assigned_by" in payload)
    return (
      `${String(payload["value"])} on ${String(payload["range_min"])}` +
      `–${String(payload["range_max"])} (assigned by ${String(payload["assigned_by"])})`
    );
  if ("value" in payload) return String(payload["value"]);
  if ("count" in payload) return String(payload["count"]);
  if ("labels" in payload) return (payload["labels"] as string[]).join(", ");
  if ("body" in payload) return String(payload["body"]);
  if ("shares" in payload)
    return (payload["shares"] as { label: string; share: number }[])
      .map((share) => `${share.label} ${share.share}%`)
      .join(", ");
  return "—";
}
