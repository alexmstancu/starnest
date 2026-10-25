import { useCallback, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { isApiError } from "../../api/ApiError";
import { fetchCandidates, type StoredValue } from "../../api/endpoints";
import { useRead } from "../../api/useRead";
import { useSourceNames } from "../../api/useSourceNames";
import { ActRefusal } from "../../shell/ActRefusal";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { NumberField } from "../../shell/NumberField";
import { remedyFor } from "../../shell/refusalRemedy";
import { alwaysAsked } from "./alwaysAsked";
import { candidateName, formatDateTime, sourceName } from "../../format/display";
import { describeFigure } from "../../format/figure";
import {
  problemFor,
  SCORE_RULE,
  splitLabels,
  type ManualField,
  type ManualKind,
} from "./manualEntry";
import { HeldButton } from "./HeldButton";
import { useManualEntry, type ManualEntryState } from "./useManualEntry";

/** The source a typed figure is stored under: a catalog row, named by the catalog. */
const MANUAL = "manual";

/**
 * A figure typed by hand, for an attribute no source covers.
 *
 * **The only route for a value that cannot be fetched at any price**, which is why Gate D's
 * `pg_restore` test exists to prove one survives a restore. It is offered only where the catalog
 * says the attribute permits it (`reqs.md` 6.5); the server's `409 manual_entry_not_permitted`
 * is the authority and appears here when the two disagree.
 *
 * **As the design's round 4 draws it** (PL-085): two bands, "The figure" and "Where it came
 * from"; the retrieval date shown before it is sent; labels previewed as the chips that will be
 * stored; every problem marking the field it is about.
 */
export function ManualEntryPanel({
  attribute,
  attributeName,
  kind,
  level,
  onClose,
}: {
  attribute: string;
  attributeName: string;
  kind: ManualKind;
  level: string;
  /** Closes the form, from a button beside Store. */
  onClose?: () => void;
}) {
  const headingId = useId();
  const entry = useManualEntry(attribute, kind);
  const sources = useSourceNames();
  const candidates = useRead(
    useCallback(
      (signal: AbortSignal) => fetchCandidates(level, { signal }),
      [level],
    ),
  );
  const roster = alwaysAsked(candidates.read);
  const focusedOnOpen = useRef(false);

  // **Read off the list this panel already fetched**, rather than asking `useCandidateNames`
  // for the same rows a second time: the select below needs every candidate anyway, and the
  // confirmation underneath needs one of their names. Empty while that request is in flight,
  // which makes the name fall back to the id made readable rather than to the id.
  const named =
    roster.state === "ready"
      ? new Map(roster.data.items.map((candidate) => [candidate.id, candidate.name]))
      : new Map<string, string>();
  const manual = sourceName(sources, MANUAL);

  return (
    <section className="manual-entry" aria-labelledby={headingId}>
      <h3 id={headingId} className="manual-entry__heading">
        Enter a value for {attributeName} by hand
      </h3>
      <p className="panel__hint">
        Stored under <strong>{manual}</strong>, which ranks last, so a published
        figure supersedes it the moment one arrives — and this one stays visible
        underneath.
      </p>

      <fieldset className="manual-entry__band">
        <legend className="manual-entry__band-label">The figure</legend>
        <div className="field-grid">
          <div className="field">
            <label className="field__label" htmlFor={`${headingId}-candidate`}>
              Candidate
            </label>
            {/* **No list until the candidates are read** (UI-27, PL-001): an empty select said
                there was nobody to give a figure to, which a list not yet read cannot say. */}
            <LoadedRegion
              read={roster}
              what="The candidates"
              skeleton="lines"
              prominence="region"
              onRetry={candidates.reload}
            >
              {({ items }) => (
                <select
                  id={`${headingId}-candidate`}
                  // **Focus moves into the form when it opens** (N8), once: to the first
                  // thing it asks.
                  ref={(select) => {
                    if (select === null || focusedOnOpen.current) return;
                    focusedOnOpen.current = true;
                    select.focus();
                  }}
                  className="field__control"
                  value={entry.draft.candidate}
                  {...marked(`${headingId}-candidate`, problemFor(entry.problems, "candidate"))}
                  onChange={(event) => entry.change("candidate", event.target.value)}
                >
                  <option value="">Choose one</option>
                  {items.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              )}
            </LoadedRegion>
            <Problem id={`${headingId}-candidate`} problem={problemFor(entry.problems, "candidate")} />
          </div>

          {kind === "LabelSet" ? (
            <Labels id={headingId} entry={entry} />
          ) : (
            <>
              <ScoreField id={headingId} name="value" label="Score" entry={entry} />
              <ScoreField
                id={headingId}
                name="rangeMin"
                label="Scale, lowest"
                note="Asked rather than assumed. A score means nothing without its scale."
                entry={entry}
              />
              <ScoreField id={headingId} name="rangeMax" label="Scale, highest" entry={entry} />
              <Field id={headingId} name="rationale" label="Why this score" entry={entry} />
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="manual-entry__band">
        <legend className="manual-entry__band-label">Where it came from</legend>
        <div className="field-grid">
          {/* **Both dates, and neither guessed.** What the figure describes is a different
              question from when we learned it, and the second is stamped for you. */}
          <Field id={headingId} name="periodStart" label="Describes, from" type="date" entry={entry} />
          <Field id={headingId} name="periodEnd" label="Describes, to" type="date" entry={entry} />
          <div className="field">
            <label className="field__label" htmlFor={`${headingId}-retrieved`}>
              Retrieved
            </label>
            <input
              id={`${headingId}-retrieved`}
              className="field__control"
              readOnly
              value={formatDateTime(entry.retrievedAt)}
              aria-describedby={`${headingId}-retrieved-note`}
            />
            <span className="field__note" id={`${headingId}-retrieved-note`}>
              Stamped for you.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={`${headingId}-confidence`}>
              Confidence
            </label>
            <select
              id={`${headingId}-confidence`}
              className="field__control"
              value={entry.draft.confidence}
              aria-describedby={`${headingId}-confidence-note`}
              onChange={(event) => entry.change("confidence", event.target.value)}
            >
              <option value="absolute">Absolute</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <span className="field__note" id={`${headingId}-confidence-note`}>
              Starts at medium: a source tier says nothing useful about a figure somebody typed.
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
      </fieldset>

      {entry.problems.length > 0 && (
        <div className="notice notice--warning" role="alert">
          <ul className="notice__list">
            {[...new Set(entry.problems.map((problem) => problem.message))].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <ActRefusal act="Storing the figure" error={entry.failure}>
        <Remedy error={entry.failure} />
      </ActRefusal>

      {/* **Mounted before it speaks** (NEW-55-S2): a status region that arrives already holding
          its text is not announced, so the region is always here and only its words change. */}
      <p
        className={
          entry.saved === null ? "manual-entry__status" : "manual-entry__status notice notice--good"
        }
        role="status"
      >
        {entry.saved !== null && (
          <ReadBack saved={entry.saved} candidate={candidateName(named, entry.saved.candidate)} source={sourceName(sources, entry.saved.data_source)} />
        )}
      </p>

      <div className="manual-entry__actions">
        {/* **Held while a figure is stored, never disabled** (NEW-44): disabled under the
            keyboard, Chromium would throw its focus to the page. */}
        <HeldButton
          className="button button--primary"
          held={entry.saving}
          onClick={entry.submit}
        >
          {entry.saving ? "Storing…" : "Store this figure"}
        </HeldButton>
        {onClose !== undefined && (
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The way out of a refusal a setting lifts: Manual entry switched off after the form opened,
 * which the server refuses (PL-089) and the card would have said had it known.
 */
function Remedy({ error }: { error: unknown }) {
  const remedy = isApiError(error) ? remedyFor(error.code, error.details) : null;
  return remedy === null ? null : (
    <Link className="button" to={remedy.path}>
      {remedy.label}
    </Link>
  );
}

/**
 * **What it stored, not "done".** A figure written into the corpus is worth reading back once,
 * because a typo is invisible in a success message. A label set reads back as the same chips
 * the preview showed (D22), since only chips show where one label ends.
 */
function ReadBack({
  saved,
  candidate,
  source,
}: {
  saved: StoredValue;
  candidate: string;
  source: string;
}) {
  const labels = labelsOf(saved.payload);
  return (
    <>
      Stored{" "}
      {labels === null ? describeFigure(saved) : <Chips labels={labels} />} for{" "}
      {candidate}, under {source}.
    </>
  );
}

function labelsOf(payload: unknown): readonly string[] | null {
  if (typeof payload !== "object" || payload === null || !("labels" in payload)) return null;
  const { labels } = payload;
  return Array.isArray(labels) && labels.every((label) => typeof label === "string")
    ? labels
    : null;
}

function Chips({ labels }: { labels: readonly string[] }) {
  return (
    <span className="manual-entry__chips" role="list">
      {labels.map((label) => (
        <span key={label} role="listitem" className="chip chip--neutral">
          {label}
        </span>
      )).flatMap((chip, index) => (index === 0 ? [chip] : [" ", chip]))}
    </span>
  );
}

/**
 * The values, one per line (D22), previewed as the chips that will be stored: a comma stays
 * part of the name, and repeats and blanks are dropped before anything is sent.
 */
function Labels({ id, entry }: { id: string; entry: ManualEntryState }) {
  const fieldId = `${id}-labels`;
  const labels = splitLabels(entry.draft.labels);
  const problem = problemFor(entry.problems, "labels");
  return (
    <div className="field manual-entry__labels">
      <label className="field__label" htmlFor={fieldId}>
        Values
      </label>
      <textarea
        id={fieldId}
        className="field__control"
        rows={3}
        value={entry.draft.labels}
        {...marked(fieldId, problem, `${fieldId}-hint`)}
        onChange={(event) => entry.change("labels", event.target.value)}
      />
      <span className="field__note" id={`${fieldId}-hint`}>
        One per line. A comma stays part of the name.
      </span>
      <Problem id={fieldId} problem={problem} />
      {labels.length > 0 && (
        <div className="manual-entry__preview" role="group" aria-label="Will store">
          <span className="manual-entry__preview-label">Will store</span>
          <Chips labels={labels} />
        </div>
      )}
    </div>
  );
}

function ScoreField({
  id,
  name,
  label,
  note,
  entry,
}: {
  id: string;
  name: "value" | "rangeMin" | "rangeMax";
  label: string;
  note?: ReactNode;
  entry: ManualEntryState;
}) {
  return (
    <NumberField
      id={`${id}-${name}`}
      label={label}
      value={entry.draft[name]}
      onChange={(text) => entry.change(name, text)}
      rule={SCORE_RULE}
      problem={problemFor(entry.problems, name)}
      note={note}
      held={entry.saving}
    />
  );
}

function Field({
  id,
  name,
  label,
  hint,
  type = "text",
  entry,
}: {
  id: string;
  name: Exclude<ManualField, "confidence">;
  label: string;
  hint?: string;
  type?: "text" | "date";
  entry: ManualEntryState;
}) {
  const fieldId = `${id}-${name}`;
  const problem = problemFor(entry.problems, name);
  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        type={type}
        className="field__control"
        value={entry.draft[name]}
        {...marked(fieldId, problem, hint === undefined ? undefined : `${fieldId}-hint`)}
        onChange={(event) => entry.change(name, event.target.value)}
      />
      {hint !== undefined && (
        <span className="field__note" id={`${fieldId}-hint`}>
          {hint}
        </span>
      )}
      <Problem id={fieldId} problem={problem} />
    </div>
  );
}

/** A field a problem is about is invalid, and described by the problem as well as its hint. */
function marked(
  fieldId: string,
  problem: string | null,
  hint?: string,
): { "aria-invalid"?: true; "aria-describedby"?: string } {
  const describedBy = [hint, problem === null ? undefined : `${fieldId}-problem`]
    .filter((each) => each !== undefined)
    .join(" ");
  return {
    ...(problem === null ? {} : { "aria-invalid": true }),
    ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
  };
}

function Problem({ id, problem }: { id: string; problem: string | null }) {
  if (problem === null) return null;
  return (
    <span className="field__note field__note--warning" id={`${id}-problem`}>
      {problem}
    </span>
  );
}
