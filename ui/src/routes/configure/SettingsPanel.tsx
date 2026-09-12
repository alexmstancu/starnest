import { useCallback, useState, type FormEvent } from "react";
import {
  fetchSettings,
  replaceSettings,
  type Settings,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";

/**
 * The four tuning values (`reqs.md` 3.10).
 *
 * **Every one may be empty, and empty is the shipped state.** They are provisional by design:
 * the documents propose numbers and the household chooses them. An empty field is a decision
 * not yet made, so it is sent as null rather than filled in with something plausible -- which
 * is also why a ranking refuses to compute until the score scale is set, instead of assuming
 * 100 (`devplan.md` 0.3).
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
  return <SettingsForm settings={resource.data} />;
}

const FIELDS = [
  [
    "score_scale_max",
    "Score scale maximum",
    "The top of every score. Nothing assumes 100.",
  ],
  [
    "min_coverage",
    "Minimum coverage",
    "Below this, a candidate is insufficient_data.",
  ],
  [
    "comparator_limit",
    "Comparator limit",
    "How many comparators one comparison may hold.",
  ],
  [
    "run_spend_cap_eur",
    "Run spend cap (EUR)",
    "A run halts here, keeping what it fetched.",
  ],
] as const;

type SettingName = (typeof FIELDS)[number][0];

/**
 * **The PUT answers with the record, so nothing is re-fetched after a save.** A reload here
 * would unmount this form while the second GET was in flight, taking the confirmation with it
 * -- to be told what the response had already said.
 */
function SettingsForm({ settings }: { settings: Settings }) {
  const [typed, setTyped] = useState(asDraft(settings));
  const [failure, setFailure] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSaved(false);
    try {
      const stored = await replaceSettings({
        score_scale_max: asNumber(typed["score_scale_max"]),
        min_coverage: asNumber(typed["min_coverage"]),
        comparator_limit: asNumber(typed["comparator_limit"]),
        run_spend_cap_eur: asNumber(typed["run_spend_cap_eur"]),
      });
      setTyped(asDraft(stored));
      setSaved(true);
    } catch (error) {
      setFailure(error);
    }
  }

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
          there. A second control that only cleared the message would offer a retry it does not
          perform. */}
      {failure !== null && <ErrorNotice error={failure} />}
      {saved && <p className="panel__hint">Saved.</p>}

      <form onSubmit={(event) => void save(event)}>
        {FIELDS.map(([name, label, hint]) => (
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
              value={typed[name]}
              inputMode="decimal"
              aria-describedby={`setting-${name}-hint`}
              onChange={(event) =>
                setTyped((current) => ({
                  ...current,
                  [name]: event.target.value,
                }))
              }
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

function asText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** The four values as the text of four inputs, which is what a half-typed number has to be. */
function asDraft(settings: Settings): Record<SettingName, string> {
  return Object.fromEntries(
    FIELDS.map(([name]) => [name, asText(settings[name])]),
  ) as Record<SettingName, string>;
}

/** An empty field is null, never zero: "not decided" and "decided to be nothing" differ. */
function asNumber(typed: string): number | null {
  return typed.trim() === "" ? null : Number(typed);
}
