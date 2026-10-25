/**
 * Whether what a form shows is what is stored (PL-025, D8). Pure: no React, no markup.
 *
 * One answer for the household, the settings and the rule editor, so the three cannot drift
 * apart again: "Saved." outlived an edit in one of two near-copies (NEW-55).
 */

import { readNumber, type NumberRule } from "../../format/typedNumber";

export type SaveStatus = "saving" | "refused" | "unconfirmed" | "unsaved" | "saved" | "none";

export interface SaveFacts {
  saving: boolean;
  refused: boolean;
  /** What is shown differs from what is stored. */
  dirty: boolean;
  /** A save landed and nothing has been typed since. */
  savedSinceEdit: boolean;
  /**
   * A save was sent and its answer lost, and reading it back could not say whether it was
   * stored (PL-033): neither saved nor refused until Recent changes checks it.
   */
  unconfirmed?: boolean;
}

/**
 * In this order: an answer pending beats a refusal, which beats a save nobody can confirm, which
 * beats an edit, which beats a save.
 */
export function saveStatusOf({
  saving,
  refused,
  dirty,
  savedSinceEdit,
  unconfirmed = false,
}: SaveFacts): SaveStatus {
  if (saving) return "saving";
  if (refused) return "refused";
  if (unconfirmed) return "unconfirmed";
  if (dirty) return "unsaved";
  if (savedSinceEdit) return "saved";
  return "none";
}

/**
 * Whether two drafts say the same thing. **A number field compares what it reads**, so
 * `72000.0` is the stored 72000; anything else compares its trimmed text.
 */
export function sameDrafts<D extends Record<keyof D, string>>(
  one: D,
  other: D,
  rules: Partial<Record<keyof D, NumberRule>>,
): boolean {
  return (Object.keys(one) as (keyof D)[]).every((field) => {
    const rule = rules[field];
    return readingOf(one[field], rule) === readingOf(other[field], rule);
  });
}

function readingOf(text: string, rule: NumberRule | undefined): string {
  if (rule === undefined) return text.trim();
  const reading = readNumber(text, rule);
  if (reading.kind === "number") return `number:${String(reading.value)}`;
  if (reading.kind === "blank") return "blank";
  return `text:${text.trim()}`;
}
