import { useCallback } from "react";
import { hasErrorCode } from "../../../api/ApiError";
import { fetchHousehold, type Household } from "../../../api/endpoints";
import { useRead } from "../../../api/useRead";
import type { Read } from "../../../api/read";
import { CandidateField } from "./CandidateField";
import { CitizenshipField } from "./CitizenshipField";
import { candidateOptions } from "./candidateOptions";
import { CountField } from "./CountField";
import { useCandidateRosterState } from "../../../api/useCandidateRoster";
import { ActRefusal } from "../../../shell/ActRefusal";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import { ReadFailureCard } from "../../../shell/ReadFailureCard";
import { Stage } from "../Stage";
import { NumberField } from "../../../shell/NumberField";
import {
  HOUSEHOLD_RULES,
  NOTHING_RECORDED,
  type HouseholdDraft,
} from "./householdForm";
import { HOUSEHOLD_LABELS } from "../../../format/vocabulary";
import { useHouseholdForm, type HouseholdForm } from "./useHouseholdForm";

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
  const { read, reload } = useRead(
    useCallback((signal: AbortSignal) => fetchHousehold({ signal }), []),
  );

  return (
    <Stage
      id="household"
      title="Household"
      lead={
        <>
          Who is moving, and what they can spend. Every attribute default, warning and gate
          reads these.
        </>
      }
    >
      {read.state !== "idle" && <HouseholdBody read={read} reload={reload} />}
    </Stage>
  );
}

function HouseholdBody({
  read,
  reload,
}: {
  read: Read<Household>;
  reload: () => Promise<void>;
}) {
  // **Nothing recorded yet is the opening state, not a failure.** This is the screen where the
  // household is first written (`reqs.md` 3.9), so a 404 here means "start here" -- and a
  // failure card with a Try again button would be a dead end on the first thing anyone does.
  if (read.state === "failed" && hasErrorCode(read.error, "household_not_configured")) {
    return (
      <HouseholdFields
        household={NOTHING_RECORDED}
        note="Nothing has been recorded about the household yet. It is the first thing to fill in: several gates and criterion defaults read it."
      />
    );
  }
  return (
    <LoadedRegion
      read={read}
      what="The household"
      skeleton="configure-stage"
      onRetry={reload}
      prominence="region"
    >
      {(household) => <HouseholdFields household={household} />}
    </LoadedRegion>
  );
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
  const roster = useCandidateRosterState();
  const countries = candidateOptions(roster.roster, "country");
  const cities = candidateOptions(roster.roster, "city");

  return (
    <>
      {note !== undefined && <p className="screen__note">{note}</p>}

      {/* **Why the pickers below are empty** (UI-27). Two of them are required, and a list
          offering nothing reads as a database with no places in it. */}
      {roster.status === "loading" && (
        <p className="screen__note">Loading the list of places…</p>
      )}
      {roster.status === "error" && (
        <>
          <p className="screen__note">
            The list of places could not be read, so the home country and
            citizenships cannot be chosen until it is.
          </p>
          <ReadFailureCard
            what="The list of places"
            error={roster.error}
            onRetry={roster.reload}
            prominence="screen"
          />
        </>
      )}

      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does
          not perform. */}
      <ActRefusal act="Saving the household" error={form.failure} />
      {/* **A live region, always there and empty until a save lands** (NEW-42): a screen reader
          announces a change to a region it already knows, so one that appeared already saying
          "Saved." was never read out. */}
      <p className="panel__hint" role="status">
        {form.saved ? "Saved." : null}
      </p>
      <RefusedFields problems={form.problems} />

      <form onSubmit={form.save}>
        {/* **Fields across, not down.** Eight of them in one column is a page of scrolling
            for what is, in substance, one short answer about a household. The track's 190px
            floor is what stops a figure and its currency ever being split across a wrap. */}
        <div className="field-grid">
          <MoneyField name="net_income" form={form} />
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
          <MoneyField name="target_monthly_spend" form={form} />
          <MoneyField name="max_rent" form={form} />
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

        {/* **Disabled while nothing can be sent; held while a save is in flight** (NEW-34).
            Disabled under the keyboard, Chromium would throw its focus to the page; held, it
            keeps focus and the form refuses the submit until the answer is in. */}
        <button
          type="submit"
          className="button button--primary"
          disabled={form.incomplete || form.invalid.length > 0}
          aria-disabled={form.saving || undefined}
        >
          {form.saving ? "Saving…" : "Save household"}
        </button>
        {form.incomplete && (
          <p className="panel__hint">
            Income, adults, children, the home country and one citizenship are
            all required.
          </p>
        )}
      </form>
    </>
  );
}

/**
 * A money field, with the unit around it rather than inside it.
 *
 * **The currency sits beside the box and the period under it**, which is how the design draws
 * a money field: what is typed is a number, so the box holds a number, and everything that says
 * what the number means is outside it. Putting "€" or "per month" in a placeholder would make
 * them disappear the moment anybody typed.
 */
function MoneyField({
  name,
  form,
}: {
  name: "net_income" | "target_monthly_spend" | "max_rent";
  form: HouseholdForm;
}) {
  return (
    <NumberField
      id={`household-${name}`}
      label={HOUSEHOLD_LABELS[name]}
      value={form.draft[name]}
      onChange={(text) => form.change(name, text)}
      rule={HOUSEHOLD_RULES[name]}
      problem={form.problems[name] ?? null}
      prefix="€"
      note="per month."
    />
  );
}

/** The fields drawn as number boxes carry their own refusal; the rest are named here. */
const MARKED_ON_THE_FIELD: ReadonlySet<string> = new Set([
  "net_income",
  "target_monthly_spend",
  "max_rent",
]);

/**
 * **A refusal that names fields is said on them, and once above them** (PL-028): never as one
 * sentence that names none. A field with no box of its own to mark -- a picker, a count -- is
 * named here with its refusal.
 */
function RefusedFields({ problems }: { problems: HouseholdForm["problems"] }) {
  const named = Object.entries(problems);
  if (named.length === 0) return null;
  const elsewhere = named.filter(([field]) => !MARKED_ON_THE_FIELD.has(field));
  return (
    <div className="notice notice--error" role="alert">
      <p className="notice__message">Not saved: the marked fields were refused.</p>
      {elsewhere.length > 0 && (
        <ul className="notice__list">
          {elsewhere.map(([field, sentence]) => (
            <li key={field}>
              {HOUSEHOLD_LABELS[field as keyof HouseholdDraft]}: {sentence}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
