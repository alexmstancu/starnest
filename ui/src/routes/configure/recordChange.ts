/**
 * A record form's save as Recent changes words it (PL-138): the household's or the settings'.
 * Pure: no React, no markup.
 *
 * **Compared as the form shows them**, field by field from the drafts, so a value reads as it
 * was typed and a field the record left unset reads "unset".
 */

/** How a record's fields are named, and which of them hold identifiers that must not be shown. */
export interface RecordWording<D> {
  labels: Readonly<Record<keyof D, string>>;
  /** Fields whose value is an identifier, said to have changed rather than printed (NEW-07). */
  opaque?: readonly (keyof D)[];
}

/** "Net income 7400 to 8000; Moving from changed" -- every field the save moved. */
export function describeRecordChange<D extends Record<keyof D, string>>(
  before: D,
  after: D,
  { labels, opaque = [] }: RecordWording<D>,
): string {
  const moved = changedFields(before, after);
  if (moved.length === 0) return "Nothing changed";
  return moved
    .map((field) =>
      opaque.includes(field)
        ? `${labels[field]} changed`
        : `${labels[field]} ${shown(before[field])} to ${shown(after[field])}`,
    )
    .join("; ");
}

/**
 * What undoing a save would unset, with what that stops (D37): a field the save set where the
 * record had left it unset. Undefined where the undo unsets nothing.
 */
export function undoUnsets<D extends Record<keyof D, string>>(
  before: D,
  after: D,
  labels: Readonly<Record<keyof D, string>>,
  consequences: Readonly<Partial<Record<keyof D, string>>>,
): string | undefined {
  const unset = changedFields(before, after).filter(
    (field) => before[field].trim() === "" && consequences[field] !== undefined,
  );
  if (unset.length === 0) return undefined;
  return unset
    .map((field) => `Undoing this unsets ${labels[field]}: ${consequences[field] ?? ""}`)
    .join(" ");
}

function changedFields<D extends Record<keyof D, string>>(before: D, after: D): (keyof D)[] {
  return (Object.keys(after) as (keyof D)[]).filter(
    (field) => before[field].trim() !== after[field].trim(),
  );
}

function shown(text: string): string {
  return text.trim() === "" ? "unset" : text.trim();
}
