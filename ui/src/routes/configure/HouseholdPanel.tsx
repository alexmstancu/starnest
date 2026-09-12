import { useCallback } from "react";
import { isApiError } from "../../api/ApiError";
import { fetchHousehold, type Household } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { NOTHING_RECORDED, type HouseholdDraft } from "./householdForm";
import { useHouseholdForm } from "./useHouseholdForm";

/**
 * The one record describing the user (`reqs.md` 3.9). Configured first, because several gates
 * and criterion defaults read it.
 *
 * **Written whole, never field by field.** A household half changed -- an income that moved
 * without the target spend it was chosen against -- would be scored as though it were somebody
 * real, so the API takes a PUT and this panel sends the whole record or none of it.
 *
 * **Markup only.** What the form holds and how text becomes a record live in
 * `useHouseholdForm.ts` and `householdForm.ts`; this file renders and nothing else.
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
      <HouseholdFields
        household={NOTHING_RECORDED}
        note="Nothing has been recorded about the household yet. It is the first thing to fill in: several gates and criterion defaults read it."
      />
    );
  }
  return <HouseholdFields household={resource.data} />;
}

const HOUSEHOLD_NOT_CONFIGURED = "household_not_configured";

function isNotConfigured(error: unknown): boolean {
  return isApiError(error) && error.code === HOUSEHOLD_NOT_CONFIGURED;
}

function HouseholdFields({
  household,
  note,
}: {
  household: Household;
  note?: string;
}) {
  const form = useHouseholdForm(household);

  return (
    <section className="panel" aria-labelledby="household-heading">
      <h3 id="household-heading" className="panel__heading">
        Household
      </h3>
      <p className="panel__hint">
        Income, size and citizenship. The free-movement, UK and Swiss gates all
        read the citizenships, so at least one is required.
      </p>

      {note !== undefined && <p className="screen__note">{note}</p>}

      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does
          not perform. */}
      {form.failure !== null && <ErrorNotice error={form.failure} />}
      {form.saved && <p className="panel__hint">Saved.</p>}

      <form onSubmit={form.save}>
        <Field label="Net annual income" name="net_income" form={form} />
        <Field label="Adults" name="number_adults" form={form} />
        <Field label="Children under 18" name="number_children" form={form} />
        <Field
          label="Target monthly spend"
          name="target_monthly_spend"
          form={form}
        />
        <Field label="Maximum rent" name="max_rent" form={form} />
        <Field
          label="Home country candidate"
          name="home_country_candidate"
          form={form}
        />
        <Field
          label="Home city candidate"
          name="home_city_candidate"
          form={form}
        />
        <Field
          label="Citizenships"
          name="citizenships"
          form={form}
          hint="Country candidate ids, separated by commas."
        />

        <button type="submit" className="button" disabled={form.incomplete}>
          Save household
        </button>
        {form.incomplete && (
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
  form,
  hint,
}: {
  label: string;
  name: keyof HouseholdDraft;
  form: ReturnType<typeof useHouseholdForm>;
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
        value={form.draft[name]}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(event) => form.change(name, event.target.value)}
      />
      {hint !== undefined && (
        <span className="panel__hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}
