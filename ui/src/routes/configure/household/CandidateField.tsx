import { useId, useRef, useState } from "react";
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
 * **Leaving a half-typed name discards it.** When focus leaves the picker the box goes back to
 * showing whatever is actually stored, so the screen never displays a choice that was not made.
 * That is the whole difference between a filter and a field.
 *
 * **The picker is the box and its list together** (UI-26). The options are tab stops, so Tab
 * from the box onto one is not leaving: the list used to close 120 ms after the box lost focus
 * to anything, its own options included, and took the option Tab had just reached off the page
 * with the keyboard on it. Choosing, or Escape, puts focus back in the box before the list goes.
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
  const box = useRef<HTMLInputElement>(null);

  const shown = typed ?? chosenName(options, value);
  const offered = matching(options, typed ?? "");
  const stranger = isAStranger(options, value);
  const listShown = open && options.length > 0;

  function close(): void {
    setTyped(null);
    setOpen(false);
  }

  function choose(option: CandidateOption): void {
    onChange(option.id);
    // Before the list goes: an option chosen from the keyboard holds focus, and closing the list
    // would take it -- and the keyboard -- off the page.
    box.current?.focus();
    close();
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div
        className="combo"
        onBlur={(event) => {
          const stillInside =
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget);
          if (!stillInside) close();
        }}
        onKeyDown={(event) => {
          // From the box or from an option, and either way focus ends in the box.
          if (event.key !== "Escape") return;
          box.current?.focus();
          close();
        }}
      >
        <input
          ref={box}
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
          // A choice leaves focus in the box, so a click on it is what opens the list again.
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            // **While the list is shown, Enter belongs to it** (UIC-G2): it picks the one match
            // or does nothing, and never reaches the form around the picker -- which saved the
            // household, with the previous choice still in it, whenever several or none matched.
            if (event.key !== "Enter" || !listShown) return;
            event.preventDefault();
            if (offered.length === 1 && offered[0]) choose(offered[0]);
          }}
        />
        {listShown && (
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
                    // **The box keeps focus while the mouse chooses**, so a click never leaves the
                    // picker and needs no grace period -- and Safari, which does not focus a
                    // clicked button, is not left closing the list under the click.
                    onMouseDown={(event) => event.preventDefault()}
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
