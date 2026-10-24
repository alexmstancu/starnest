/**
 * How a number becomes text. This is the client's business (`arch.md` 8.1) -- the API sends
 * numbers, dates and currency codes and never a pre-formatted string.
 *
 * **Nothing here rescales anything.** Weights and coverage arrive as percentages, 0-100, and
 * are printed as percentages; scores arrive as integers 0-100 and are printed as they are.
 * A conversion in this file would be arithmetic on a domain number, which belongs to the
 * backend.
 */

/**
 * One locale for the whole interface, stated rather than inherited from the browser, so the
 * same value renders identically in a test, in a screenshot and on Alex's machine.
 */
export const DISPLAY_LOCALE = "en-GB";

/** What is printed where a number is genuinely absent. Never a zero, never a guess. */
export const ABSENT = "—";

/**
 * A percentage already expressed 0-100 (`docs/openapi.yaml`: weights and coverage).
 * `formatPercentage(62.5)` is `"62.5%"`.
 */
export function formatPercentage(value: number | null | undefined, fractionDigits = 1): string {
  if (!isFiniteNumber(value)) return ABSENT;
  // **The decimal is kept, never dropped.** The design writes every percentage to one place --
  // "100.0%", "14.0%", "93.8% covered" -- and a total that reads "100%" beside weights reading
  // "14.0%" looks like a different kind of number rather than the same one summed.
  return `${new Intl.NumberFormat(DISPLAY_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)}%`;
}

/** A score: an integer 0-100, or `—` when the candidate has insufficient data. */
export function formatScore(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return ABSENT;
  return new Intl.NumberFormat(DISPLAY_LOCALE, { maximumFractionDigits: 0 }).format(value);
}

/**
 * How many decimals a figure is read to: two, with trailing zeros dropped (`format/figure`).
 * A gap between two figures is printed to the same, or it claims a precision they never had.
 */
export const FIGURE_FRACTION_DIGITS = 2;

/** A fixed number of decimals, or `"figure"`: a figure's own precision, as above. */
export type SignedPrecision = number | "figure";

/** U+2212. A hyphen is narrower than a plus, so a column of signed numbers would not line up. */
const MINUS = "\u2212";

/**
 * A signed number: a delta, a gap, a contribution. **Every signed number on every screen goes
 * through here** (PL-080), because a signed number reads as a direction and two screens that
 * spell a direction differently look like two different kinds of number.
 *
 * **Never a signed zero.** The sign is decided after rounding: a gap that prints as zero is
 * neither direction, and "+0.0" beside "0.0" claims a lead the figure cannot show.
 */
export function formatSigned(
  value: number | null | undefined,
  precision: SignedPrecision = 1,
): string {
  if (!isFiniteNumber(value)) return ABSENT;
  const [minimum, maximum] =
    precision === "figure" ? [0, FIGURE_FRACTION_DIGITS] : [precision, precision];
  const magnitude = new Intl.NumberFormat(DISPLAY_LOCALE, {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
  }).format(Math.abs(value));
  if (!/[1-9]/.test(magnitude)) return magnitude;
  return `${value > 0 ? "+" : MINUS}${magnitude}`;
}

/** An unsigned number to a fixed number of decimals, such as an impact on the total. */
export function formatDecimal(value: number | null | undefined, fractionDigits: number): string {
  if (!isFiniteNumber(value)) return ABSENT;
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatCount(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return ABSENT;
  return new Intl.NumberFormat(DISPLAY_LOCALE).format(value);
}

/** An amount plus its ISO currency code, as the contract sends money. */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (!isFiniteNumber(amount) || !currency) return ABSENT;
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** An ISO date-time, shown to the minute. Seconds are noise in every place this appears. */
export function formatDateTime(value: string | null | undefined): string {
  const parsed = parseDate(value);
  if (!parsed) return ABSENT;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(parsed);
}

/** An ISO date. Used for reference and retrieval dates, which are days, not instants. */
export function formatDate(value: string | null | undefined): string {
  const parsed = parseDate(value);
  if (!parsed) return ABSENT;
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
}

/** `not_matching` reads as "Not matching" wherever a status is shown. */
/**
 * A link out to a publisher, or nothing.
 *
 * **Only `http` and `https`.** `methodology_url` and a value's `citations` are strings the
 * backend stored from a source, and rendering an arbitrary one into `href` would put whatever
 * scheme it carries -- `javascript:` above all -- behind a click. The interface never renders
 * a URL it has not looked at, and a URL it will not vouch for becomes plain text instead of a
 * link that lies about where it goes.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Not absolute, so there is nowhere to send a reader. A relative link here would point
    // back into this app, which is never what a publisher's citation means.
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? parsed.href
    : null;
}

export function formatMatchStatus(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A catalog identifier as a name: `country` reads "Country", `local_employment` reads
 * "Local employment".
 *
 * **The catalog ships ids, not display names.** `GET /levels` returns `country` and `city`
 * and nothing else, so capitalising here is the alternative to either printing a wire
 * identifier at the reader or inventing a lookup table that would have to be kept in step
 * with the migrations -- which is the "nothing hardcoded" invariant applied to names.
 */
export function formatIdentifier(identifier: string): string {
  const spaced = identifier.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One pillar's name, or its id made readable.
 *
 * **The catalog's name, not the id title-cased.** A ranking and a criteria set both carry
 * pillar *ids* -- `economics`, `connectivity` -- and capitalising one gives "Economics" and
 * "Connectivity" where the catalog says "Economy" and "Transport". The difference is not
 * cosmetic: a name is a decision somebody made and a title-cased id is this screen guessing.
 *
 * **A plain function, taking the map rather than fetching it**, so a screen that already has
 * the names does not ask for them again, and so this is testable without React.
 */
export function pillarName(names: ReadonlyMap<string, string>, pillar: string): string {
  return names.get(pillar) ?? formatIdentifier(pillar);
}

/**
 * One data source's name, or its id made readable.
 *
 * **The catalog's name, not the id** (RB-4). A plan, a run, a stored value and an outside
 * opinion all carry a source *id* -- `world_bank`, `llm` -- where the catalog has said "World
 * Bank" and "LLM with web search" since `0100`, and the design allows no programmatic
 * identifier in rendered text.
 *
 * **Falls back to the id made readable, as `pillarName` does**: the names are a label read once
 * per page, and nothing that shows a source should wait for them, or go blank if they fail.
 */
export function sourceName(names: ReadonlyMap<string, string>, source: string): string {
  return names.get(source) ?? formatIdentifier(source);
}

/**
 * One attribute's name, or its id made readable.
 *
 * **The design states this as a rule**: "No programmatic identifiers in rendered text -- no
 * attribute keys, rule ids or settings field names." A screen showing
 * `country.average_working_hours` is showing a database key to someone who never chose one,
 * and the catalog has held "Average working hours" for that row since `0101`.
 *
 * **The fallback drops the level prefix**, which `formatIdentifier` alone does not: an id is
 * `country.average_working_hours`, and title-casing that whole string gives
 * "Country.average working hours" -- worse than the id it was trying to improve on. The level
 * is already the thing the whole screen is about, so it says nothing here.
 */
export function attributeName(
  names: ReadonlyMap<string, string>,
  attribute: string,
): string {
  const named = names.get(attribute);
  if (named !== undefined && named !== "") return named;
  const withoutLevel = attribute.slice(attribute.indexOf(".") + 1);
  return formatIdentifier(withoutLevel);
}

/**
 * One candidate's name, or its id made readable.
 *
 * The ranking table never needed this -- a `Ranking` carries `name` beside every candidate --
 * but a stored value, an acquisition failure and a comparison row all carry the id alone, and
 * those three screens were printing `country.malta`.
 */
export function candidateName(
  names: ReadonlyMap<string, string>,
  candidate: string,
): string {
  const named = names.get(candidate);
  if (named !== undefined && named !== "") return named;
  return formatIdentifier(candidate.slice(candidate.indexOf(".") + 1));
}


/**
 * Which way a difference goes, for the colour the design gives it.
 *
 * **Three states, because an absent difference is not a small one.** A null delta coloured as
 * an advantage is the screen claiming a lead it cannot support, which is the failure this app
 * exists to avoid; `level` is the honest third answer and a zero takes it too.
 *
 * **In `format/` because two screens need it.** It lived in `routes/rank/`, and Compare
 * reimplemented it with two states and got the null case wrong (P83). `rank/` and `compare/`
 * are siblings, so their nearest shared home is this leaf -- the layering has no loose file
 * directly under `routes/`.
 */
export function deltaTone(
  delta: number | null | undefined,
): "ahead" | "behind" | "level" {
  if (typeof delta !== "number" || Number.isNaN(delta) || delta === 0) {
    return "level";
  }
  return delta > 0 ? "ahead" : "behind";
}
