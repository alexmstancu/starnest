import { useCallback } from "react";
import { isApiError } from "../../../api/ApiError";
import { fetchHousehold, type Household } from "../../../api/endpoints";
import { useResource } from "../../../api/useResource";
import { CandidateField } from "./CandidateField";
import { CitizenshipField } from "./CitizenshipField";
import { candidateOptions } from "./candidateOptions";
import { CountField } from "./CountField";
import { useCandidateRoster } from "../../../api/useCandidateRoster";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import {
  NOTHING_RECORDED,
  onlyMoneyCharacters,
  type HouseholdDraft,
} from "./householdForm";
import { HOUSEHOLD_LABELS } from "../../../format/vocabulary";
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
  // **One fetch for all three pickers.** Home country, home city and every citizenship come
  // from the same roster; three reads of 32 rows would be three chances to disagree.
  const roster = useCandidateRoster();
  const countries = candidateOptions(roster, "country");
  const cities = candidateOptions(roster, "city");

  return (
    <section className="stage" aria-labelledby="household-heading">
      <header className="stage__head">
        {/* The numeral is a CSS counter on `.stage__number`, so a stage cannot claim a
            position it does not hold -- nothing fails when a hard-coded 4 sits fifth. */}
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h3 id="household-heading" className="stage__title">
            Household
          </h3>
          <p className="stage__lead">
            Who is moving, and what they can spend. Every attribute default, warning and gate
            reads these.
          </p>
        </div>
      </header>
      {note !== undefined && <p className="screen__note">{note}</p>}

      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does
          not perform. */}
      {form.failure !== null && <ErrorNotice error={form.failure} />}
      {form.saved && <p className="panel__hint">Saved.</p>}

      <form onSubmit={form.save}>
        {/* **Fields across, not down.** Eight of them in one column is a page of scrolling
            for what is, in substance, one short answer about a household. The track's 190px
            floor is what stops a figure and its currency ever being split across a wrap. */}
        <div className="field-grid">
          <Field
            label={HOUSEHOLD_LABELS.net_income}
            name="net_income"
            form={form}
            numeric
            prefix="€"
            suffix="per year"
          />
          {/* One click for almost every household, and the field for the rest. */}
          <CountField
            id="household-number_adults"
            label={HOUSEHOLD_LABELS.number_adults}
            offered={[1, 2, 3, 4]}
            value={form.draft.number_adults}
            onChange={(value) => form.change("number_adults", value)}
          />
          <CountField
            id="household-number_children"
            label={HOUSEHOLD_LABELS.number_children}
            offered={[0, 1, 2, 3]}
            noneLabel="None"
            value={form.draft.number_children}
            onChange={(value) => form.change("number_children", value)}
          />
          <Field
            label={HOUSEHOLD_LABELS.target_monthly_spend}
            name="target_monthly_spend"
            form={form}
            numeric
            prefix="€"
            suffix="per month"
          />
          <Field
            label={HOUSEHOLD_LABELS.max_rent}
            name="max_rent"
            form={form}
            numeric
            prefix="€"
            suffix="per month"
          />
          <CandidateField
            id="household-home_country_candidate"
            label={HOUSEHOLD_LABELS.home_country_candidate}
            options={countries}
            value={form.draft.home_country_candidate}
            onChange={(id) => form.change("home_country_candidate", id)}
          />
          {/* **Empty until the city level exists** (`reqs.md` 1.3). The roster holds no city
              candidate, so the box says so rather than offering an empty list to search. */}
          <CandidateField
            id="household-home_city_candidate"
            label={HOUSEHOLD_LABELS.home_city_candidate}
            options={cities}
            value={form.draft.home_city_candidate}
            onChange={(id) => form.change("home_city_candidate", id)}
            nothingOffered="City level arrives after v1"
          />
          <CitizenshipField
            id="household-citizenships"
            label={HOUSEHOLD_LABELS.citizenships}
            options={countries}
            value={form.draft.citizenships}
            onChange={(value) => form.change("citizenships", value)}
          />
        </div>

        <button type="submit" className="button button--primary" disabled={form.incomplete}>
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

/**
 * One field, with the unit around it rather than inside it.
 *
 * **The currency sits beside the box and the period under it**, which is how the design
 * draws a money field: what is typed is a number, so the box holds a number, and everything
 * that says what the number means is outside it. Putting "€" or "per month" in a placeholder
 * would make them disappear the moment anybody typed.
 */
function Field({
  label,
  name,
  form,
  hint,
  prefix,
  suffix,
  numeric,
}: {
  label: string;
  name: keyof HouseholdDraft;
  form: ReturnType<typeof useHouseholdForm>;
  hint?: string;
  prefix?: string;
  suffix?: string;
  /** Digits and one decimal point only, filtered as it is typed. */
  numeric?: boolean;
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
      <span className="field__row">
        {prefix !== undefined && (
          <span className="field__affix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          className="field__control"
          value={form.draft[name]}
          aria-describedby={
            hint === undefined && suffix === undefined
              ? undefined
              : `${id}-hint`
          }
          inputMode={numeric === true ? "decimal" : undefined}
          onChange={(event) =>
            form.change(
              name,
              numeric === true
                ? onlyMoneyCharacters(event.target.value)
                : event.target.value,
            )
          }
        />
      </span>
      {(hint ?? suffix) !== undefined && (
        <span className="field__note" id={`${id}-hint`}>
          {hint ?? suffix}
        </span>
      )}
    </div>
  );
}
