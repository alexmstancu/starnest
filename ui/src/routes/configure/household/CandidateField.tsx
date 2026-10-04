import { useEffect, useId, useRef, useState } from "react";
import {
  type CandidateOption,
  chosenName,
  isAStranger,
  matching,
  onlyPlaceNameCharacters,
} from "./candidateOptions";

/**
 * A place, chosen from the ones the database holds.
 *
 * **It commits an id, never what was typed.** The value behind this field is a foreign key to
 * `candidate`, and it was a free text box: a telephone number, a poem or `country.atlantis`
 * all went in, and the save either failed at the server or recorded a country that does not
 * exist. Typing now only narrows the list; the stored value changes when an option is chosen.
 *
 * **Leaving a half-typed name discards it.** On blur the box goes back to showing whatever is
 * actually stored, so the screen never displays a choice that was not made. That is the whole
 * difference between a filter and a field.
 */
export function CandidateField({
  id,
  label,
  options,
  value,
  onChange,
  hint,
  nothingOffered,
}: {
  id: string;
  label: string;
  /** The roster this field may choose from, already narrowed to one level. */
  options: readonly CandidateOption[];
  /** The stored candidate id, or "" for unanswered. */
  value: string;
  onChange: (id: string) => void;
  hint?: string;
  /** What to say when the roster is empty, which is a different thing from no match. */
  nothingOffered?: string;
}) {
  const listId = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const blurring = useRef<number | undefined>(undefined);

  // **The blur timer has to be cancelled when this unmounts.** It calls `setState` 120ms later,
  // and nothing stopped it: in a test that fires blur and asserts, the update lands outside
  // `act` and React says so; in a full suite it fires after jsdom has been torn down and
  // crashes with `ReferenceError: window is not defined`, which vitest reports as "this might
  // cause false positive tests". Both were already happening and scrolling past a green build.
  // In a browser it is a smaller fault of the same kind -- a state update on a component the
  // reader has navigated away from.
  useEffect(
    () => () => {
      if (blurring.current !== undefined) window.clearTimeout(blurring.current);
    },
    [],
  );

  const shown = typed ?? chosenName(options, value);
  const offered = matching(options, typed ?? "");
  const stranger = isAStranger(options, value);

  function choose(option: CandidateOption): void {
    onChange(option.id);
    setTyped(null);
    setOpen(false);
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="combo">
        <input
          id={id}
          className="field__control"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={shown}
          placeholder={options.length === 0 ? nothingOffered : undefined}
          disabled={options.length === 0 && nothingOffered !== undefined}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          onChange={(event) => {
            setTyped(onlyPlaceNameCharacters(event.target.value));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // **A click on an option is a blur first.** Closing the list on blur alone would
          // unmount the option before its click landed, so the list stays up for a tick.
          onBlur={() => {
            blurring.current = window.setTimeout(() => {
              setTyped(null);
              setOpen(false);
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setTyped(null);
              setOpen(false);
            }
            if (event.key === "Enter" && offered.length === 1 && offered[0]) {
              event.preventDefault();
              choose(offered[0]);
            }
          }}
        />
        {open && options.length > 0 && (
          <ul className="combo__list" id={listId} role="listbox" aria-label={label}>
            {offered.length === 0 ? (
              <li className="combo__empty">Nothing here matches that.</li>
            ) : (
              offered.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className={
                      option.id === value
                        ? "combo__option combo__option--chosen"
                        : "combo__option"
                    }
                    role="option"
                    aria-selected={option.id === value}
                    onMouseDown={() => {
                      // Before the blur timer, so choosing survives the focus leaving.
                      window.clearTimeout(blurring.current);
                    }}
                    onClick={() => choose(option)}
                  >
                    {option.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {stranger && (
        <span className="field__note field__note--warning">
          Nothing in the database is called that. Choose one from the list.
        </span>
      )}
      {hint !== undefined && !stranger && (
        <span className="field__note" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}
