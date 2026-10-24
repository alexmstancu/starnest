import type { ReactNode } from "react";

/**
 * A checkbox and its words, in one label (PL-027). The label wraps both, so the words are the
 * box's name and a click on them ticks it -- and nothing wider does, which a `label.field` in a
 * column did across the whole card. Held, it keeps its focus and refuses the change (NEW-34).
 */
export function CheckboxField({
  id,
  checked,
  onChange,
  held = false,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  held?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="field field--inline" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-disabled={held || undefined}
        onChange={(event) => {
          if (!held) onChange(event.target.checked);
        }}
      />
      {children}
    </label>
  );
}
