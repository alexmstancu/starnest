/**
 * A small whole number, offered as the answers people actually give.
 *
 * **Segments for the common range, and the field for everything else.** The design draws
 * adults as 1 to 4 and children as none to 3, which is one click for almost every household
 * -- but the domain has no such ceiling (`number_adults` is any integer above zero), and a
 * control that cannot express five adults would be the interface deciding who is allowed to
 * use this. So the segments are a shortcut, not the whole control: a value outside them keeps
 * the field visible and selected.
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
  const beyond = chosen === undefined && value.trim() !== "";

  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>
      <div className="toggle-group" role="group" aria-labelledby={`${id}-label`}>
        {offered.map((each) => (
          <button
            key={each}
            type="button"
            className={
              chosen === each ? "toggle toggle--chosen" : "toggle"
            }
            aria-pressed={chosen === each}
            onClick={() => onChange(String(each))}
          >
            {each === 0 && noneLabel !== undefined ? noneLabel : each}
          </button>
        ))}
      </div>
      {/* Always reachable: the segments are the quick way in, never the only one.
          **The field keeps the field's name.** `aria-label` rather than a second visible
          label, because the sentence beside it says how to use the control and the control is
          still "Adults" -- which is what a screen reader, and a test, has to hear. */}
      <span className="field__more">
        <span className="field__note">
          {beyond ? "Outside the buttons:" : "Or type another number:"}
        </span>
        <input
          id={id}
          aria-label={label}
          className="field__control field__control--narrow"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </div>
  );
}
