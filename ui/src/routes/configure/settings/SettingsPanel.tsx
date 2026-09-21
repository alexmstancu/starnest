import { useCallback } from "react";
import { fetchSettings, type Settings } from "../../../api/endpoints";
import { useResource } from "../../../api/useResource";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { SETTING_FIELDS, isBlocked, unsetFields } from "./settingsForm";
import { useSettingsForm } from "./useSettingsForm";

/**
 * The four tuning values (`reqs.md` 3.10).
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
    <section className="panel" aria-labelledby="settings-heading">
      <h3 id="settings-heading" className="panel__heading">
        Settings
      </h3>
      <p className="panel__hint">
        All four are provisional by design. Leave one empty and it stays
        undecided.
      </p>

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
        {SETTING_FIELDS.map(({ name, label, description, consequence, severity }) => {
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
            <input
              id={`setting-${name}`}
              className="field__control"
              value={form.draft[name]}
              placeholder="Not set"
              inputMode="decimal"
              aria-describedby={`setting-${name}-hint`}
              onChange={(event) => form.change(name, event.target.value)}
            />
            <span className="panel__hint" id={`setting-${name}-hint`}>
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
        <button type="submit" className="button">
          Save settings
        </button>
      </form>
    </section>
  );
}
