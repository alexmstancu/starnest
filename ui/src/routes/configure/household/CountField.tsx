/**
 * A small whole number, offered as the answers people actually give.
 *
 * **Segments, and only segments** -- adults 1 to 4, children none to 3, which is what the
 * design draws and what `adultOptions` / `childOptions` in the prototype enumerate. There was
 * a "Or type another number" field beside them, on the reasoning that the domain has no
 * ceiling (`number_adults` is any integer above zero) and a control that cannot express five
 * adults decides who may use this. **That reasoning was wrong about where the decision
 * belongs**: the range is a catalog-shaped choice, and widening it means adding a segment, not
 * asking every household to read a sentence about an escape hatch it will never take. The
 * field appeared on every render, held the same number as the button already pressed, and was
 * the only thing on the panel asking to be read twice.
 *
 * A value outside the offered range still renders -- no segment is pressed, which is honest --
 * and the way to support it is to offer it.
 */
export function CountField({
  id,
  label,
  offered,
  value,
  onChange,
  noneLabel,
}: {
  id: string;
  label: string;
  /** The answers worth one click, in order. */
  offered: readonly number[];
  value: string;
  onChange: (value: string) => void;
  /** What zero is called, where zero is one of the offered answers. */
  noneLabel?: string;
}) {
  const chosen = offered.find((each) => String(each) === value.trim());

  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>
      {/* **The group carries the field's name**, because the buttons are now the whole
          control: a screen reader, and a test, has to hear "Adults" from somewhere. */}
      <div
        className="toggle-group"
        role="group"
        id={id}
        aria-labelledby={`${id}-label`}
      >
        {offered.map((each) => (
          <button
            key={each}
            type="button"
            className={chosen === each ? "toggle toggle--chosen" : "toggle"}
            aria-pressed={chosen === each}
            onClick={() => onChange(String(each))}
          >
            {each === 0 && noneLabel !== undefined ? noneLabel : each}
          </button>
        ))}
      </div>
    </div>
  );
}
