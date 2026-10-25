/**
 * A gate answer's period and age, read into words. No React and no markup.
 *
 * **Worked out here, from the server's dates** (D54): the server serves `recorded_at` and the
 * period, and computes neither the age nor whether the period has ended. **An ended period
 * expires nothing** -- the household's policy of 2026-10-13: a confirmed answer applies until a
 * person changes it -- so "ended" is something to show, never something to act on.
 */

import type { MatchRuleResult } from "../../api/endpoints";
import { DISPLAY_LOCALE, formatDate } from "../../format/display";

type Period = MatchRuleResult["reference_period"];

/**
 * The period a gate answer holds for -- recorded, proposed or re-checked (UI-13) -- or that
 * nobody recorded one. **Shown so it is not lost unseen**: an answer that holds only until a date
 * must not read the same as one that holds for ever.
 */
export function describePeriod(period: Period): string {
  if (period == null) return "No period recorded";
  return `${formatDate(period.start)} to ${formatDate(period.end)}`;
}

/**
 * The reader's calendar day, as the contract writes a date. A period's `end` is a bare day,
 * so it is compared with the day on the reader's clock rather than with an instant.
 */
export function dayOf(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** Whether the period ended before today. A period ending today still holds today. */
export function periodHasEnded(period: Period, today: string): boolean {
  return period != null && period.end < today;
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365],
  ["month", 30],
  ["week", 7],
  ["day", 1],
];

/** How long ago an instant was, in the largest whole unit: "today", "3 weeks ago". */
export function describeAge(instant: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(instant).getTime()) / 86_400_000);
  const words = new Intl.RelativeTimeFormat(DISPLAY_LOCALE, { numeric: "auto" });
  const [unit, length] = UNITS.find(([, size]) => days >= size) ?? ["day", 1];
  return words.format(-Math.floor(Math.max(days, 0) / length), unit);
}

/**
 * The answers in the order they are reviewed: ended periods first, because those are the ones
 * to look at again, then by gate and by candidate as they are named on screen.
 */
export function inReadingOrder<Answer extends Pick<MatchRuleResult, "reference_period">>(
  answers: readonly Answer[],
  today: string,
  named: (answer: Answer) => [gate: string, candidate: string],
): Answer[] {
  const key = (answer: Answer): [number, string, string] => [
    periodHasEnded(answer.reference_period, today) ? 0 : 1,
    ...named(answer),
  ];
  return [...answers].sort((one, other) => {
    const [a, b] = [key(one), key(other)];
    return a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]);
  });
}
