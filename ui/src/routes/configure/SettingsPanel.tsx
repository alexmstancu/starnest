import { useCallback } from "react";
import { fetchSettings, type Settings } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { SETTING_FIELDS } from "./settingsForm";
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

      <form onSubmit={form.save}>
        {SETTING_FIELDS.map(([name, label, hint]) => (
          <div key={name} className="field">
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
              inputMode="decimal"
              aria-describedby={`setting-${name}-hint`}
              onChange={(event) => form.change(name, event.target.value)}
            />
            <span className="panel__hint" id={`setting-${name}-hint`}>
              {hint}
            </span>
          </div>
        ))}
        <button type="submit" className="button">
          Save settings
        </button>
      </form>
    </section>
  );
}
