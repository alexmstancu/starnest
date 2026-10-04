import { useCallback, useId } from "react";
import { fetchCandidates } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { candidateName } from "../../format/display";
import { describeFigure } from "../../format/figure";
import type { ManualDraft, ManualKind } from "./manualEntry";
import { useManualEntry } from "./useManualEntry";

/**
 * A figure typed by hand, for an attribute no source covers.
 *
 * **The only route for a value that cannot be fetched at any price**, which is why Gate D's
 * `pg_restore` test exists to prove one survives a restore. It is offered only where the catalog
 * says the attribute permits it (`reqs.md` 6.5); the server's `409 manual_entry_not_permitted`
 * is the authority and appears here when the two disagree.
 *
 * **No design to match.** `docs/todos.md` records this form as parked by the design, so it is
 * built in the design's own idiom -- its field markup, its tokens, its notice shapes -- and
 * `docs/design-brief.md` carries the request for the next sync rather than this inventing a
 * shape and calling it the design's.
 */
export function ManualEntryPanel({
  attribute,
  attributeName,
  kind,
  level,
}: {
  attribute: string;
  attributeName: string;
  kind: ManualKind;
  level: string;
}) {
  const headingId = useId();
  const entry = useManualEntry(attribute, kind);
  const candidates = useResource(
    useCallback(
      (signal: AbortSignal) => fetchCandidates(level, { signal }),
      [level],
    ),
  );

  // **Read off the list this panel already fetched**, rather than asking `useCandidateNames`
  // for the same rows a second time: the select below needs every candidate anyway, and the
  // confirmation underneath needs one of their names. Empty while that request is in flight,
  // which makes the name fall back to the id made readable rather than to the id.
  const named =
    candidates.resource.status === "ready"
      ? new Map(
          candidates.resource.data.items.map((candidate) => [
            candidate.id,
            candidate.name,
          ]),
        )
      : new Map<string, string>();

  return (
    <section className="manual-entry" aria-labelledby={headingId}>
      <h4 id={headingId} className="manual-entry__heading">
        Enter a value for {attributeName} by hand
      </h4>
      <p className="panel__hint">
        Stored under the <strong>manual</strong> source, which ranks last, so a
        published figure supersedes it the moment one arrives — and this one
        stays visible underneath.
      </p>

      <div className="field-grid">
        <div className="field">
          <label className="field__label" htmlFor={`${headingId}-candidate`}>
            Candidate
          </label>
          <select
            id={`${headingId}-candidate`}
            className="field__control"
            value={entry.draft.candidate}
            onChange={(event) => entry.change("candidate", event.target.value)}
          >
            <option value="">Choose one</option>
            {candidates.resource.status === "ready" &&
              candidates.resource.data.items.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </div>

        {kind === "LabelSet" ? (
          <Field
            id={headingId}
            name="labels"
            label="Values"
            hint="Separate several with commas."
            entry={entry}
          />
        ) : (
          <>
            <Field id={headingId} name="value" label="Score" entry={entry} />
            <Field
              id={headingId}
              name="rangeMin"
              label="Scale, lowest"
              hint="The scale is what makes the score mean anything, so it is asked rather than assumed."
              entry={entry}
            />
            <Field id={headingId} name="rangeMax" label="Scale, highest" entry={entry} />
            <Field
              id={headingId}
              name="rationale"
              label="Why this score"
              entry={entry}
            />
          </>
        )}

        {/* **Both dates, and neither guessed.** What the figure describes is a different
            question from when we learned it, and the second is stamped for you. */}
        <DateField
          id={headingId}
          name="periodStart"
          label="Describes, from"
          entry={entry}
        />
        <DateField id={headingId} name="periodEnd" label="Describes, to" entry={entry} />

        <div className="field">
          <label className="field__label" htmlFor={`${headingId}-confidence`}>
            Confidence
          </label>
          <select
            id={`${headingId}-confidence`}
            className="field__control"
            value={entry.draft.confidence}
            onChange={(event) => entry.change("confidence", event.target.value)}
          >
            <option value="absolute">absolute</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <span className="field__note">
            A source tier says nothing useful about a figure somebody typed.
          </span>
        </div>

        <Field
          id={headingId}
          name="quote"
          label="Where this came from"
          hint="In words. Shown beside the figure wherever it appears."
          entry={entry}
        />
        <Field id={headingId} name="citation" label="Link" entry={entry} />
      </div>

      {entry.problems.length > 0 && (
        <div className="notice notice--warning" role="alert">
          <ul className="notice__list">
            {entry.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {entry.failure !== null && <ErrorNotice error={entry.failure} />}

      {entry.saved !== null && (
        /* **What it stored, not "done".** A figure written into the corpus is worth reading
           back once, because a typo is invisible in a success message. */
        <p className="notice notice--good" role="status">
          Stored {describeFigure(entry.saved)} for{" "}
          {candidateName(named, entry.saved.candidate)}, under{" "}
          {entry.saved.data_source}.
        </p>
      )}

      <button
        type="button"
        className="button button--primary"
        disabled={entry.saving}
        onClick={entry.submit}
      >
        {entry.saving ? "Storing…" : "Store this figure"}
      </button>
    </section>
  );
}

function Field({
  id,
  name,
  label,
  hint,
  entry,
}: {
  id: string;
  name: keyof ManualDraft;
  label: string;
  hint?: string;
  entry: ReturnType<typeof useManualEntry>;
}) {
  const fieldId = `${id}-${name}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className="field__control"
        value={entry.draft[name]}
        aria-describedby={hint === undefined ? undefined : `${fieldId}-hint`}
        onChange={(event) => entry.change(name, event.target.value)}
      />
      {hint !== undefined && (
        <span className="field__note" id={`${fieldId}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

function DateField({
  id,
  name,
  label,
  entry,
}: {
  id: string;
  name: keyof ManualDraft;
  label: string;
  entry: ReturnType<typeof useManualEntry>;
}) {
  const fieldId = `${id}-${name}`;
  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        type="date"
        className="field__control"
        value={entry.draft[name]}
        onChange={(event) => entry.change(name, event.target.value)}
      />
    </div>
  );
}
