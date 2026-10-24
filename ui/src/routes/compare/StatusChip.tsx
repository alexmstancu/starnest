import { statusTag, type HasStatus } from "./statusTag";

/**
 * A candidate's status where Compare names it, or nothing for a matching one (PL-095).
 *
 * **The reason reaches every reader**: on hover as a title, to a screen reader as hidden text,
 * and to a keyboard as a stop that reveals it, since a title alone is mouse-only. It sits
 * beside a heading, never inside one, so the heading still reads as the candidate's name.
 */
export function StatusChip({ result }: { result: HasStatus }) {
  const tag = statusTag(result);
  if (tag === null) return null;
  return (
    <span
      className={`chip chip--${tag.status} compare-status`}
      title={tag.reason ?? undefined}
      tabIndex={tag.reason === null ? undefined : 0}
    >
      {tag.label}
      {tag.reason !== null && <span className="compare-status__reason">{tag.reason}</span>}
    </span>
  );
}
