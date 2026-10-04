import {
  type CandidateOption,
  chosenName,
  citizenshipIds,
  withCitizenship,
  withoutCitizenship,
} from "./candidateOptions";
import { CandidateField } from "./CandidateField";

/**
 * The passports the household holds, chosen one at a time.
 *
 * **More than one, because dual citizenship is a real answer** -- `household_citizenship` is a
 * table keyed on (household, candidate) rather than a column, precisely so it can hold two.
 * The field stored them as a comma-separated list of ids typed by hand, which meant a stray
 * space or a misremembered id was a save the server refused.
 *
 * Each passport is a chip with a way to take it off; adding one goes through the same picker
 * as the home country, so the two cannot disagree about what a country is called.
 */
export function CitizenshipField({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly CandidateOption[];
  /** The stored field: candidate ids, comma separated. */
  value: string;
  onChange: (value: string) => void;
}) {
  const held = citizenshipIds(value);

  return (
    <div className="field">
      <CandidateField
        id={id}
        label={label}
        options={options}
        // **Always empty.** This picker adds rather than replaces, so showing the last choice
        // in the box would read as "this is your citizenship" when it is one of several.
        value=""
        onChange={(chosen) => onChange(withCitizenship(value, chosen))}
        hint={
          held.length === 0
            ? "Choose at least one."
            : "Choose another to add a second passport."
        }
      />
      {held.length > 0 && (
        <ul className="chip-list" aria-label={`${label} held`}>
          {held.map((each) => (
            <li key={each}>
              <span className="chip chip--accent">
                {chosenName(options, each)}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`Remove ${chosenName(options, each)}`}
                  onClick={() => onChange(withoutCitizenship(value, each))}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
