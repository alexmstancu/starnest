import { useId } from "react";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { HeldButton } from "../../shell/HeldButton";
import { type PickKind, pickedLabel } from "./scopePicker";
import type { ScopePickerState } from "./useScopePicker";

const KINDS: { value: PickKind; label: string }[] = [
  { value: "candidate", label: "One candidate" },
  { value: "attribute", label: "One attribute" },
  { value: "pillar", label: "One pillar" },
];

/**
 * Acquire one candidate, one attribute or one pillar (PL-125, `reqs.md` 5.6: re-fetching is
 * explicit, per candidate and per attribute). **It can start paid work, so it only ever
 * estimates**: the estimate arms the same strip as every other remedy.
 */
export function ScopePickerPanel({
  picker,
  held,
  onEstimate,
}: {
  picker: ScopePickerState;
  /** An act is in flight, so Estimate waits for it (NEW-44). */
  held: boolean;
  onEstimate: () => void;
}) {
  const id = useId();
  return (
    <div className="field-grid">
      <div className="field">
        <label className="field__label" htmlFor={`${id}-kind`}>
          What to acquire
        </label>
        <select
          id={`${id}-kind`}
          className="field__control"
          value={picker.kind}
          onChange={(event) => picker.choose(event.target.value as PickKind)}
        >
          {KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-which`}>
          Which
        </label>
        <LoadedRegion
          read={picker.catalog}
          what="What can be picked"
          skeleton="lines"
          prominence="region"
          onRetry={picker.reload}
        >
          {() => (
            <select
              id={`${id}-which`}
              className="field__control"
              value={picker.picked}
              onChange={(event) => picker.pick(event.target.value)}
            >
              <option value="">Choose one</option>
              {picker.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </LoadedRegion>
      </div>
      <HeldButton
        className="button"
        held={held}
        disabled={picker.pairs.length === 0}
        onClick={onEstimate}
      >
        {pickedLabel(picker.pairs.length)}
      </HeldButton>
    </div>
  );
}
