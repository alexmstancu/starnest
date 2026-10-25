/**
 * A stored figure's confidence, as stored, and whether it has aged out (PL-069).
 *
 * **The chip keeps the grade the figure was stored with**; the mark beside it says the
 * active-value view calls the figure stale, which is the same flag that counts it one grade
 * lower in the ranking's confidence split. Only an explicit `false` marks it: the server serves
 * the flag on every value, and a figure without one is not a figure known to be old.
 */
export function ConfidenceChip({
  figure,
}: {
  figure: { confidence_level: string; is_fresh?: boolean };
}) {
  return (
    <span className="confidence">
      <span className={`chip chip--${figure.confidence_level}`}>
        {figure.confidence_level}
      </span>
      {figure.is_fresh === false && (
        <span
          className="confidence__aged"
          title="Counted one grade lower in the confidence split"
        >
          older than its allowed age
        </span>
      )}
    </span>
  );
}
