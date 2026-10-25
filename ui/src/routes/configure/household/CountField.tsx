import { useEffect, useRef, useState } from "react";
import type { NumberRule } from "../../../format/typedNumber";
import { NumberField } from "../../../shell/NumberField";

/**
 * A small whole number, offered as the answers people actually give, and "More" for the rest.
 *
 * **Segments for the usual answers** -- adults 1 to 4, children none to 3, as the design draws
 * them. **"More" for everything above** (PL-166, UF-050): the domain has no ceiling
 * (`number_adults` is any whole number from one), and a control that cannot say five adults
 * decides who may use this. The field opens only when asked for, so the usual household never
 * reads it -- and a stored count above the segments opens it, so a stored five says five
 * rather than pressing nothing.
 *
 * What is typed is read by the form's own rule, so a refusal reads as every other field's does.
 */
export function CountField({
  id,
  label,
  offered,
  rule,
  value,
  onChange,
  problem,
  noneLabel,
}: {
  id: string;
  label: string;
  /** The answers worth one click, in order. */
  offered: readonly number[];
  /** How the typed count is read: the same rule the form sends by. */
  rule: NumberRule;
  value: string;
  onChange: (value: string) => void;
  /** The server's refusal of this field, in words. */
  problem?: string;
  /** What zero is called, where zero is one of the offered answers. */
  noneLabel?: string;
}) {
  const offeredOne = offered.find((each) => String(each) === value.trim());
  const [asked, setAsked] = useState(false);
  // A stored count no segment offers is shown in the field, never hidden behind nothing pressed.
  const typing = asked || (value.trim() !== "" && offeredOne === undefined);
  const chosen = typing ? undefined : offeredOne;
  const fieldId = `${id}-more`;
  const justOpened = useRef(false);

  useEffect(() => {
    if (!justOpened.current) return;
    justOpened.current = false;
    document.getElementById(fieldId)?.focus();
  }, [typing, fieldId]);

  return (
    <div className="field">
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>
      {/* **The group carries the field's name**, because the buttons are the control: a screen
          reader, and a test, has to hear "Adults" from somewhere. */}
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
            onClick={() => {
              setAsked(false);
              onChange(String(each));
            }}
          >
            {each === 0 && noneLabel !== undefined ? noneLabel : each}
          </button>
        ))}
        <button
          type="button"
          className={typing ? "toggle toggle--chosen" : "toggle"}
          aria-pressed={typing}
          aria-controls={typing ? fieldId : undefined}
          onClick={() => {
            justOpened.current = !typing;
            setAsked(true);
          }}
        >
          More
        </button>
      </div>
      {typing && (
        <NumberField
          id={fieldId}
          label={`${label}, exact number`}
          labelHidden
          value={value}
          onChange={onChange}
          rule={rule}
          problem={problem ?? null}
        />
      )}
    </div>
  );
}
