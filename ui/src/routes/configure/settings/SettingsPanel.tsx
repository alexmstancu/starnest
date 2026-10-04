import { useCallback } from "react";
import { fetchSettings, type Settings } from "../../../api/endpoints";
import { useResource } from "../../../api/useResource";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { onlyNumberCharacters } from "../numericInput";
import { SETTING_FIELDS, isBlocked, unsetFields } from "./settingsForm";
import { useSettingsForm } from "./useSettingsForm";

/**
 * The five tuning values (`reqs.md` 3.10).
 *
 * **Every one may be empty, and empty is the shipped state.** An empty field is a decision not
 * yet made, so it is sent as null rather than filled in with something plausible.
 *
 * **Markup only.** The text-to-record conversion is `settingsForm.ts` and the state is
 * `useSettingsForm.ts`.
 */
export function SettingsPanel() {
  const { resource, reload } = useResource(
    useCallback((signal: AbortSignal) => fetchSettings({ signal }), []),
  );

  if (resource.status === "loading" || resource.status === "idle") {
    return <p className="screen__note">Loading settings…</p>;
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={reload} />;
  }
  return <SettingsFields settings={resource.data} />;
}

function SettingsFields({ settings }: { settings: Settings }) {
  const form = useSettingsForm(settings);
  // Read off the draft rather than off what was loaded, so clearing a field says what that
  // costs immediately instead of after a save.
  const unset = unsetFields(form.draft);
  const blocked = isBlocked(form.draft);

  return (
    <section className="stage" aria-labelledby="settings-heading">
      <header className="stage__head">
        {/* The numeral is a CSS counter on `.stage__number`, so a stage cannot claim a
            position it does not hold -- nothing fails when a hard-coded 4 sits fifth. */}
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h3 id="settings-heading" className="stage__title">
            Acquisition limits
          </h3>
          <p className="stage__lead">
            The floor and the ceilings an acquisition respects. Below the coverage floor a
            candidate shows no score rather than a wrong one. All five are provisional by
            design: leave one empty and it stays undecided.
          </p>
        </div>
      </header>
      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. */}
      {form.failure !== null && <ErrorNotice error={form.failure} />}
      {form.saved && <p className="panel__hint">Saved.</p>}

      {/* The one blank that stops the product working, said once and loudly. The design's own
          prototype stated this rule and then ranked anyway (R3), which is worse than saying
          nothing -- it teaches that the warnings here are decoration. */}
      {blocked && (
        <div className="notice notice--error" role="alert">
          <p className="notice__message">
            Nothing can be ranked or compared until the score scale maximum is
            set. It has no default, because the scale is a judgement rather
            than a fact.
          </p>
        </div>
      )}

      {!blocked && unset.length > 0 && (
        <div className="notice notice--warning">
          <p className="notice__message">
            {unset.length === 1
              ? "One setting is not set, so the rule behind it is not in force."
              : `${unset.length} settings are not set, so the rules behind them are not in force.`}
          </p>
        </div>
      )}

      <form onSubmit={form.save}>
        {/* Five short numbers across, as the design has them: a column of them reads as five
            decisions to make in order, and they are independent. */}
        <div className="field-grid">
        {SETTING_FIELDS.map(
          ({ name, label, unit, description, consequence, severity, whole }) => {
          const blank = form.draft[name].trim() === "";
          return (
          <div
            key={name}
            className={
              blank ? `field field--unset field--unset-${severity}` : "field"
            }
          >
            {/* The hint is a description, not part of the name. Inside the label it would
                become one -- "Score scale maximum The top of every score" -- which is what a
                screen reader announces and what a test has to match. */}
            <label className="field__label" htmlFor={`setting-${name}`}>
              {label}
            </label>
            {/* The unit sits beside the box rather than inside the label: a label is the
                field's name, and "Spend cap per acquisition €" is not what it is called --
                it is what a screen reader would then announce and what a test would have to
                match. */}
            <div className="field__row">
              <input
                id={`setting-${name}`}
                className="field__control"
                value={form.draft[name]}
                placeholder="Not set"
                inputMode={whole === true ? "numeric" : "decimal"}
                aria-describedby={`setting-${name}-unit setting-${name}-hint`}
                // **Filtered, not merely hinted at.** `inputMode` picks a keyboard on a
                // phone and refuses nothing anywhere: this field accepted "abc12x" until
                // now, and `Number()` made it NaN, which the form rendered as empty.
                onChange={(event) =>
                  form.change(
                    name,
                    onlyNumberCharacters(event.target.value, { whole }),
                  )
                }
              />
              {/* Described by, not hidden: the unit is what the number means, and a reader
                  who cannot see it beside the box needs it announced with the field. */}
              <span className="field__affix" id={`setting-${name}-unit`}>
                {unit}
              </span>
            </div>
            <span className="field__note" id={`setting-${name}-hint`}>
              {description}
              {/* What is true *while it is blank*. A description says what the setting is
                  for; this says what leaving it empty costs, which is the question somebody
                  looking at an empty field is actually asking. */}
              {blank && (
                <span className="field__consequence"> {consequence}</span>
              )}
            </span>
          </div>
          );
        })}
        </div>
        <button type="submit" className="button button--primary">
          Save settings
        </button>
      </form>
    </section>
  );
}
