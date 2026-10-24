import { useState, type ReactNode } from "react";
import {
  describeRefusal,
  describeRule,
  readNumber,
  type NumberRule,
} from "../format/typedNumber";

/**
 * The one box that takes a number (PL-024, UF-026). **It keeps what was typed**: `onChange`
 * receives the text exactly, and a figure the grammar cannot read is marked on the box with the
 * sentence that says what to type -- never filtered, rounded or read as "unset". A text box
 * rather than `type="number"`, which reports text it cannot parse as "" and so let "1,000" clear
 * a bound in silence.
 *
 * A half-typed figure ("-", ".") or a required box left blank waits until the reader leaves it.
 * `problem` is a refusal from elsewhere, the server's above all, already in words; the caller
 * clears it when the field is edited.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  rule,
  problem = null,
  note,
  prefix,
  suffix,
  held = false,
  placeholder,
  unset,
  labelHidden = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  rule: NumberRule;
  problem?: string | null;
  note?: ReactNode;
  prefix?: string;
  suffix?: ReactNode;
  /** Held while a write is in flight: read-only and `aria-disabled`, never `disabled` (NEW-34). */
  held?: boolean;
  placeholder?: string;
  /** What leaving it blank costs, for a setting that may be unset. */
  unset?: "advisory" | "blocking";
  labelHidden?: boolean;
}) {
  const [left, setLeft] = useState(false);
  const shown = problem ?? refusalOf(value, rule, left);
  const bounds = describeRule(rule);
  const blank = unset !== undefined && value.trim() === "";

  return (
    <div className={blank ? `field field--unset field--unset-${unset}` : "field"}>
      {!labelHidden && (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="field__row">
        {prefix !== undefined && (
          <span className="field__affix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          className="field__control"
          type="text"
          inputMode={rule.kind === "whole" ? "numeric" : "decimal"}
          autoComplete="off"
          spellCheck={false}
          aria-label={labelHidden ? label : undefined}
          value={value}
          placeholder={placeholder}
          readOnly={held}
          aria-disabled={held || undefined}
          aria-invalid={shown !== null}
          aria-describedby={`${suffix === undefined ? "" : `${id}-unit `}${id}-note`}
          onChange={(event) => {
            if (!held) onChange(event.target.value);
          }}
          onBlur={() => setLeft(true)}
        />
        {suffix !== undefined && (
          <span className="field__affix" id={`${id}-unit`}>
            {suffix}
          </span>
        )}
      </div>
      <span className="field__note" id={`${id}-note`}>
        {note}
        {bounds !== "" && <>{note !== undefined && " "}{bounds}</>}
        {shown !== null && (
          <span className="field__note field__note--warning"> {shown}</span>
        )}
      </span>
    </div>
  );
}

function refusalOf(value: string, rule: NumberRule, left: boolean): string | null {
  const reading = readNumber(value, rule);
  if (reading.kind === "incomplete") {
    return left ? describeRefusal({ code: "not_a_number" }, rule) : null;
  }
  if (reading.kind !== "refused") return null;
  if (reading.refusal.code === "required" && !left) return null;
  return describeRefusal(reading.refusal, rule);
}
