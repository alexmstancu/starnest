import { useCallback, useState, type FormEvent } from "react";
import { isApiError } from "../../api/ApiError";
import {
  fetchHousehold,
  replaceHousehold,
  type Household,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";

/**
 * The one record describing the user (`reqs.md` 3.9). Configured first, because several gates
 * and criterion defaults read it.
 *
 * **Written whole, never field by field.** A household half changed -- an income that moved
 * without the target spend it was chosen against -- would be scored as though it were somebody
 * real, so the API takes a PUT and this panel sends the whole record or none of it.
 */
export function HouseholdPanel() {
  const { resource, reload } = useResource(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
  );

  if (resource.status === "loading" || resource.status === "idle") {
    return <p className="screen__note">Loading the household…</p>;
  }
  // **Nothing recorded yet is the opening state, not a failure.** This is the screen where the
  // household is first written (`reqs.md` 3.9), so a 404 here means "start here" -- and an
  // error notice with a Try again button would be a dead end on the first thing anyone does.
  if (resource.status === "error") {
    if (!isNotConfigured(resource.error)) {
      return <ErrorNotice error={resource.error} onRetry={reload} />;
    }
    return (
      <HouseholdForm
        household={NOTHING_RECORDED}
        note="Nothing has been recorded about the household yet. It is the first thing to fill in: several gates and criterion defaults read it."
      />
    );
  }
  return <HouseholdForm household={resource.data} />;
}

const HOUSEHOLD_NOT_CONFIGURED = "household_not_configured";

function isNotConfigured(error: unknown): boolean {
  return isApiError(error) && error.code === HOUSEHOLD_NOT_CONFIGURED;
}

/**
 * An empty record to fill in, which is not a default household: every field is blank, so
 * nothing here is a number somebody would have to notice and correct.
 */
const NOTHING_RECORDED: Household = {
  net_income: Number.NaN,
  number_adults: Number.NaN,
  number_children: Number.NaN,
  home_country_candidate: "",
  home_city_candidate: null,
  citizenships: [],
};

/**
 * The typed form, as text.
 *
 * Every field is held as the string that was typed rather than as a number, so a half-typed
 * "1." or an emptied field is still exactly what the user put there. The conversion happens
 * once, on submit.
 */
interface Draft {
  net_income: string;
  number_adults: string;
  number_children: string;
  target_monthly_spend: string;
  max_rent: string;
  home_country_candidate: string;
  home_city_candidate: string;
  citizenships: string;
}

function draftOf(household: Household): Draft {
  return {
    net_income: numberAsText(household.net_income),
    number_adults: numberAsText(household.number_adults),
    number_children: numberAsText(household.number_children),
    target_monthly_spend: numberAsText(household.target_monthly_spend),
    max_rent: numberAsText(household.max_rent),
    home_country_candidate: household.home_country_candidate ?? "",
    home_city_candidate: household.home_city_candidate ?? "",
    citizenships: (household.citizenships ?? []).join(", "),
  };
}

/**
 * **The PUT answers with the record, so nothing is re-fetched after a save.** Reloading would
 * unmount this form mid-flight and lose the confirmation with it, to be told what the response
 * already said.
 */
function HouseholdForm({
  household,
  note,
}: {
  household: Household;
  note?: string;
}) {
  const [draft, setDraft] = useState<Draft>(draftOf(household));
  const [failure, setFailure] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const citizenships = splitList(draft.citizenships);

  function change(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSaved(false);
    try {
      const stored = await replaceHousehold({
        net_income: Number(draft.net_income),
        number_adults: Number(draft.number_adults),
        number_children: Number(draft.number_children),
        target_monthly_spend: optionalNumber(draft.target_monthly_spend),
        max_rent: optionalNumber(draft.max_rent),
        home_country_candidate: draft.home_country_candidate.trim(),
        // Null rather than an empty string: not living in a city is a fact, and a city called
        // "" is not (`reqs.md` 3.9).
        home_city_candidate: draft.home_city_candidate.trim() || null,
        citizenships,
      });
      setDraft(draftOf(stored));
      setSaved(true);
    } catch (error) {
      setFailure(error);
    }
  }

  // The five the contract requires. Sending without them would earn a refusal about a missing
  // field, which tells the user less than the form already can.
  const incomplete =
    draft.net_income.trim() === "" ||
    draft.number_adults.trim() === "" ||
    draft.number_children.trim() === "" ||
    draft.home_country_candidate.trim() === "" ||
    citizenships.length === 0;

  return (
    <section className="panel" aria-labelledby="household-heading">
      <h3 id="household-heading" className="panel__heading">
        Household
      </h3>
      <p className="panel__hint">
        Income, size and citizenship. The free-movement, UK and Swiss gates all
        read the citizenships, so at least one is required.
      </p>

      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does not
          perform. */}
      {note !== undefined && <p className="screen__note">{note}</p>}

      {failure !== null && <ErrorNotice error={failure} />}
      {saved && <p className="panel__hint">Saved.</p>}

      <form onSubmit={(event) => void save(event)}>
        <Field
          label="Net annual income"
          name="net_income"
          draft={draft}
          onChange={change}
        />
        <Field
          label="Adults"
          name="number_adults"
          draft={draft}
          onChange={change}
        />
        <Field
          label="Children under 18"
          name="number_children"
          draft={draft}
          onChange={change}
        />
        <Field
          label="Target monthly spend"
          name="target_monthly_spend"
          draft={draft}
          onChange={change}
        />
        <Field
          label="Maximum rent"
          name="max_rent"
          draft={draft}
          onChange={change}
        />
        <Field
          label="Home country candidate"
          name="home_country_candidate"
          draft={draft}
          onChange={change}
        />
        <Field
          label="Home city candidate"
          name="home_city_candidate"
          draft={draft}
          onChange={change}
        />
        <Field
          label="Citizenships"
          name="citizenships"
          draft={draft}
          onChange={change}
          hint="Country candidate ids, separated by commas."
        />

        <button type="submit" className="button" disabled={incomplete}>
          Save household
        </button>
        {incomplete && (
          <p className="panel__hint">
            Income, adults, children, the home country and one citizenship are
            all required.
          </p>
        )}
      </form>
    </section>
  );
}

function Field({
  label,
  name,
  draft,
  onChange,
  hint,
}: {
  label: string;
  name: keyof Draft;
  draft: Draft;
  onChange: (field: keyof Draft, value: string) => void;
  hint?: string;
}) {
  // The hint describes the field rather than naming it: wrapped inside the label it would be
  // read out as part of the name, so "Citizenships" would become "Citizenships Country
  // candidate ids, separated by commas".
  const id = `household-${name}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__control"
        value={draft[name]}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(event) => onChange(name, event.target.value)}
      />
      {hint !== undefined && (
        <span className="panel__hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

function splitList(typed: string): string[] {
  return typed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** A blank field, for anything that is not a number -- including the not-yet-recorded case. */
function numberAsText(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value)
    ? ""
    : String(value);
}

/** An empty optional field is absent, not zero -- a target spend of 0 would be a decision. */
function optionalNumber(typed: string): number | undefined {
  return typed.trim() === "" ? undefined : Number(typed);
}
