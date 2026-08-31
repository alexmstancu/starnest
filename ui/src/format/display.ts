/**
 * How a number becomes text. This is the client's business (`arch.md` §8.1) -- the API sends
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
  return `${new Intl.NumberFormat(DISPLAY_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value)}%`;
}

/** A score: an integer 0-100, or `—` when the candidate has insufficient data. */
export function formatScore(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return ABSENT;
  return new Intl.NumberFormat(DISPLAY_LOCALE, { maximumFractionDigits: 0 }).format(value);
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
