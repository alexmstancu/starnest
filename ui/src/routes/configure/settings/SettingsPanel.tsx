import { useCallback } from "react";
import { fetchSettings, type Settings } from "../../../api/endpoints";
import { useRead } from "../../../api/useRead";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import { Stage } from "../Stage";
import { NumberField } from "../../../shell/NumberField";
import { SETTING_FIELDS, describeUnset, isBlocked, unsetFields } from "./settingsForm";
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
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchSettings({ signal }), []),
  );

  return (
    <Stage
      id="settings"
      title="Acquisition limits"
      lead={
        <>
          The floor and the ceilings an acquisition respects. Below the coverage floor a
          candidate shows no score rather than a wrong one. All five are provisional by
          design: leave one empty and it stays undecided.
        </>
      }
    >
      {/* `useRead` with no `enabled` is never idle; the guard keeps the type honest. */}
      {read.state !== "idle" && (
        <LoadedRegion
          read={read}
          what="The acquisition limits"
          skeleton="configure-stage"
          onRetry={reload}
          prominence="region"
        >
          {(settings) => <SettingsFields settings={settings} />}
        </LoadedRegion>
      )}
    </Stage>
  );
}

function SettingsFields({ settings }: { settings: Settings }) {
  const form = useSettingsForm(settings);
  // Read off the draft rather than off what was loaded, so clearing a field says what that
  // costs immediately instead of after a save.
  const unset = unsetFields(form.draft);
  const blocked = isBlocked(form.draft);

  return (
    <>
      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. */}
      {form.failure !== null && <ErrorNotice error={form.failure} />}
      {/* **A live region, always there and empty until a save lands** (NEW-42): a screen reader
          announces a change to a region it already knows, so one that appeared already saying
          "Saved." was never read out. */}
      <p className="panel__hint" role="status">
        {form.saved ? "Saved." : null}
      </p>

      {/* The one blank that stops the product working, said once and loudly. The design's own
          prototype stated this rule and then ranked anyway (R3), which is worse than saying
          nothing -- it teaches that the warnings here are decoration. */}
      {blocked && (
        <div className="notice notice--error" role="alert">
          <p className="notice__message">
            Nothing can be ranked or compared until the top of the score range
            is set. It has no default, because the scale is a judgement rather
            than a fact.
          </p>
        </div>
      )}

      {!blocked && unset.length > 0 && (
        <div className="notice notice--warning">
          <p className="notice__message">{describeUnset(unset)}</p>
        </div>
      )}

      {/* **Said on the fields, and once above them** (PL-028): the server named what it
          refused, so the form marks those fields rather than printing one sentence that names
          none of them. */}
      {Object.keys(form.problems).length > 0 && (
        <div className="notice notice--error" role="alert">
          <p className="notice__message">Not saved: the marked fields were refused.</p>
        </div>
      )}

      <form onSubmit={form.save}>
        {/* Five short numbers across, as the design has them: a column of them reads as five
            decisions to make in order, and they are independent. */}
        <div className="field-grid">
          {SETTING_FIELDS.map(({ name, label, unit, description, consequence, severity, rule }) => (
            <NumberField
              key={name}
              id={`setting-${name}`}
              label={label}
              value={form.draft[name]}
              onChange={(text) => form.change(name, text)}
              rule={rule}
              problem={form.problems[name] ?? null}
              placeholder="Not set"
              unset={severity}
              // **The unit beside the box, described by**: what the number means, which a
              // reader who cannot see it needs announced with the field -- and not the label,
              // because "Spend cap per acquisition €" is not what the field is called.
              suffix={unit}
              note={
                <>
                  {description}
                  {/* What is true *while it is blank*: the question somebody looking at an
                      empty field is actually asking. */}
                  {form.draft[name].trim() === "" && (
                    <span className="field__consequence"> {consequence}</span>
                  )}
                </>
              }
            />
          ))}
        </div>
        {/* **Disabled while nothing can be sent; held while a save is in flight** (NEW-34).
            Disabled under the keyboard, Chromium would throw its focus to the page; held, it
            keeps focus and the form refuses the submit until the answer is in. */}
        <button
          type="submit"
          className="button button--primary"
          disabled={form.invalid.length > 0}
          aria-disabled={form.saving || undefined}
        >
          {form.saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </>
  );
}
