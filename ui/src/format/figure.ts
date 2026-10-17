/**
 * Anything carrying a value's payload.
 *
 * **Structural, not the contract's own type.** `format/` is a leaf: the layering forbids it
 * from importing `api/`, and the rule is right -- a formatting helper that knows the wire
 * types gets dragged along by the next contract change. Callers pass their `StoredValue`
 * unchanged; this only ever reads the payload.
 */
import { ABSENT, formatIdentifier } from "./display";

export interface HasPayload {
  payload: unknown;
}

/**
 * What a reader is shown for each unit, rather than the catalog's token.
 *
 * The payload carries the unit as the key it is stored under -- `per_100000_population`,
 * `eu27_average_100` -- and printing that is the "no programmatic identifiers in rendered text"
 * rule broken one field deeper than the attribute name. The units that ship are listed below; a
 * token with no entry falls back to its words rather than its underscores, so a new one reads
 * tolerably until it is given a line here.
 */
const READABLE_UNIT: Record<string, string> = {
  celsius: "°C",
  days_per_year: "days/year",
  eu27_average_100: "EU27 = 100",
  index_eu27_100: "EU27 = 100",
  hours_per_week: "hours/week",
  hours_per_year: "hours/year",
  km_per_1000_km2: "km per 1,000 km²",
  ladder_points: "ladder points",
  metre: "m",
  pct_of_average_wage: "% of average wage",
  per_100000_population: "per 100,000",
  percent_per_year: "% per year",
  pisa_points: "PISA points",
  weeks: "weeks",
  years: "years",
};

function readableUnit(unit: unknown): string {
  const token = String(unit);
  return READABLE_UNIT[token] ?? token.replace(/_/g, " ");
}

/**
 * A figure at a precision a person reads, not the fourteen decimals the wire carries.
 *
 * The server sends `30.80604044947752`, which is correct and unreadable; the design rounds
 * every figure before it draws it. Two decimals, trailing zeros trimmed, so `0.38` stays
 * `0.38`, `1.036044` becomes `1.04` and `30.806…` becomes `30.81`. A value already whole or
 * already short is left as it is.
 */
export function readableNumber(raw: unknown): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return String(raw);
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toFixed(2));
  return String(rounded);
}

/** A figure exactly as the wire carries it: every digit, nothing rounded. */
function exactNumber(raw: unknown): string {
  return String(raw);
}

/** The currency every amount is converted into, and so the one that needs no conversion. */
const EURO = "EUR";

export interface FigureOptions {
  /**
   * The figure exactly as stored: every digit the wire carries, instead of the two decimals a
   * person reads, and a converted amount's euro equivalent beside it. **Only where the usual
   * line would hide a difference**: two figures that moved by less than the displayed
   * precision, or in euros alone, read the same, and a screen calling them different has to
   * show why.
   */
  exact?: boolean;
}

/**
 * A payload as one line. **The shape follows the value type**, which is the server's word for
 * what the figure is; nothing here converts, rounds or rescales it.
 */
export function describeFigure(
  value: HasPayload,
  options: FigureOptions = {},
): string {
  const digits = options.exact === true ? exactNumber : readableNumber;
  // **A missing payload is absent, not a thrown error.** `"magnitude" in null` raises, and a
  // provenance panel is the wrong place to discover that the server sent something the
  // contract says it never sends. The screen says it has nothing and stays up.
  if (typeof value.payload !== "object" || value.payload === null) return ABSENT;
  const payload = value.payload as Record<string, unknown>;
  if ("magnitude" in payload)
    return `${digits(payload["magnitude"])} ${readableUnit(payload["unit"])}`;
  // **Shown exactly, a converted amount carries its euro equivalent** (UI-22): converted again
  // at a fresher ECB rate, the same 1000 CHF has a new euro figure and reads the same without
  // it. A euro amount is its own equivalent -- the server refuses one that is not.
  if ("amount_eur" in payload) {
    const currency = String(payload["currency"]);
    const amount = `${digits(payload["amount"])} ${currency}`;
    return options.exact === true && currency !== EURO
      ? `${amount} (${digits(payload["amount_eur"])} ${EURO})`
      : amount;
  }
  // **An index carries its bounds, because the bounds are what make it mean anything** (P57).
  // `reqs.md` reserves `Index` for figures whose scale does the work -- a World Bank governance
  // figure of 1.07 sits on -2.5 to 2.5, and printed bare it reads like a percentage. This
  // branch and the next were duplicates, so both types lost everything but the number.
  if ("value" in payload && "provider" in payload)
    return (
      `${digits(payload["value"])} on ${digits(payload["scale_min"])}` +
      `–${digits(payload["scale_max"])} (${String(payload["provider"])})`
    );
  // An assigned score carries its range and who assigned it: a 7 out of 10 from a model is a
  // different claim from a 7 out of 10 somebody wrote down (`reqs.md` 3.3a).
  if ("value" in payload && "assigned_by" in payload)
    return (
      `${digits(payload["value"])} on ${digits(payload["range_min"])}` +
      `–${digits(payload["range_max"])} (assigned by ${String(payload["assigned_by"])})`
    );
  // **A ratio is a share *of* something, and the something is required** (P78). The contract
  // makes `basis` mandatory on `RatioPayload` -- `land_area`, `workforce`, `households` -- and
  // this fell through to the bare branch below, printing `17.3` where the figure means 17.3%
  // of the country's land area. Same argument as the index above: the number alone is not the
  // measurement. P57 made it for `Index` and `AssignedScore` and stopped there.
  if ("value" in payload && typeof payload["basis"] === "string")
    return `${digits(payload["value"])}% of ${formatIdentifier(payload["basis"])}`;
  // **A boolean reads as an answer, not as a wire word.** `true` is what JSON carries; it is
  // not what anybody calls the state of a visa agreement.
  if ("value" in payload && typeof payload["value"] === "boolean")
    return payload["value"] ? "Yes" : "No";
  if ("value" in payload) return digits(payload["value"]);
  // A count's basis is optional and means the same thing when it is there: 412 protected areas
  // is a different figure from 412 per capita.
  if ("count" in payload) {
    const basis = payload["basis"];
    return typeof basis === "string" && basis !== ""
      ? `${digits(payload["count"])} per ${formatIdentifier(basis)}`
      : digits(payload["count"]);
  }
  if ("labels" in payload) return (payload["labels"] as string[]).join(", ");
  if ("body" in payload) return String(payload["body"]);
  if ("shares" in payload)
    return (payload["shares"] as { label: string; share: number }[])
      .map((share) => `${share.label} ${share.share}%`)
      .join(", ");
  // The one mark for an absent figure, shared with every other formatter rather than written
  // out again here -- two spellings of "nothing" is one too many.
  return ABSENT;
}
