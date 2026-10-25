import type { ReactNode, RefObject } from "react";
import { candidateName, formatMatchStatus } from "../../../format/display";
import { CheckboxField } from "../../../shell/CheckboxField";
import type { DraftField, DraftProblem } from "./gateAnswerForm";
import type { GateAnswers } from "./useGateAnswers";

const ANSWERS = ["matching", "not_matching", "unknown"] as const;

/**
 * The form that records, corrects or rules out one gate answer. **Markup only**: the draft, its
 * checks and the write are `useGateAnswers.ts` and `gateAnswerForm.ts`.
 */
export function GateAnswerFormPanel({
  answers,
  researching,
  firstField,
}: {
  answers: GateAnswers;
  /** A research pass is asking: a person's answer waits for it rather than racing it. */
  researching: boolean;
  /** Where "Change" and "Take the proposal" put focus, so the form they filled is next. */
  firstField: RefObject<HTMLSelectElement | null>;
}) {
  const { draft, change } = answers;
  const held = answers.saving || researching;
  const problem = (field: DraftField) => problemAt(answers.problems, field);
  const gates = answers.gates.state === "ready" ? answers.gates.data.items : [];
  const roster = answers.candidates.roster;
  const candidate = candidateName(
    new Map(roster.map((each) => [each.id, each.name])),
    draft.candidate,
  );

  return (
    <form
      className="gate-answer-form"
      aria-label="Record a gate answer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!held) answers.save();
      }}
    >
      <div className="field-grid">
        <Field id="gate-answer-gate" label="Gate" problem={problem("matchRule")}>
          <select
            ref={firstField}
            id="gate-answer-gate"
            className="field__control"
            value={draft.matchRule}
            aria-invalid={problem("matchRule") !== null}
            aria-describedby="gate-answer-gate-note"
            onChange={(event) => change({ matchRule: event.target.value })}
          >
            <option value="">Choose a gate</option>
            {gates.map((gate) => (
              <option key={gate.id} value={gate.id}>
                {gate.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="gate-answer-candidate" label="Candidate" problem={problem("candidate")}>
          <select
            id="gate-answer-candidate"
            className="field__control"
            value={draft.candidate}
            aria-invalid={problem("candidate") !== null}
            aria-describedby="gate-answer-candidate-note"
            onChange={(event) => change({ candidate: event.target.value })}
          >
            <option value="">
              {answers.candidates.status === "loading" ? "Reading the candidates…" : "Choose a candidate"}
            </option>
            {roster.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="gate-answer-answer" label="Answer" problem={null}>
          <select
            id="gate-answer-answer"
            className="field__control"
            value={draft.answer}
            aria-describedby="gate-answer-answer-note"
            onChange={(event) =>
              change({ answer: event.target.value as (typeof ANSWERS)[number] })
            }
          >
            {ANSWERS.map((answer) => (
              <option key={answer} value={answer}>
                {formatMatchStatus(answer)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {answers.candidates.status === "error" && (
        <p className="field__note field__note--warning">
          The candidates could not be read, so none can be chosen.{" "}
          <button type="button" className="button" onClick={answers.candidates.reload}>
            Try again
          </button>
        </p>
      )}
      {draft.answer === "not_matching" && draft.candidate !== "" && (
        <p className="notice notice--warning">
          Saved as not matching, this rules {candidate} out of every ranking whose set
          enforces the gate, at once.
        </p>
      )}

      <Field id="gate-answer-reason" label="Reason" problem={null}>
        <textarea
          id="gate-answer-reason"
          className="field__control"
          rows={2}
          value={draft.reason}
          aria-describedby="gate-answer-reason-note"
          onChange={(event) => change({ reason: event.target.value })}
        />
      </Field>

      <fieldset className="gate-answer-form__period" aria-describedby="gate-answer-period-note">
        <legend className="field__label">Holds for</legend>
        <div className="field-grid">
          <Field id="gate-answer-from" label="From" problem={null}>
            <input
              id="gate-answer-from"
              type="date"
              className="field__control"
              value={draft.periodStart}
              aria-invalid={problem("period") !== null}
              onChange={(event) => change({ periodStart: event.target.value })}
            />
          </Field>
          <Field id="gate-answer-until" label="Until" problem={null}>
            <input
              id="gate-answer-until"
              type="date"
              className="field__control"
              value={draft.periodEnd}
              aria-invalid={problem("period") !== null}
              onChange={(event) => change({ periodEnd: event.target.value })}
            />
          </Field>
        </div>
        <span className="field__note" id="gate-answer-period-note">
          Both days, or neither for an answer with no period.
          {problem("period") !== null && (
            <span className="field__note field__note--warning"> {problem("period")}</span>
          )}
        </span>
      </fieldset>

      <CheckboxField
        id="gate-answer-overriding"
        checked={draft.overriding}
        held={held}
        onChange={(overriding) => change({ overriding })}
      >
        This overrides what the sources say
      </CheckboxField>
      {draft.overriding && (
        <Field id="gate-answer-override" label="Override reason" problem={problem("overrideReason")}>
          <input
            id="gate-answer-override"
            type="text"
            className="field__control"
            value={draft.overrideReason}
            aria-invalid={problem("overrideReason") !== null}
            aria-describedby="gate-answer-override-note"
            onChange={(event) => change({ overrideReason: event.target.value })}
          />
        </Field>
      )}

      <Field id="gate-answer-pages" label="Pages" problem={problem("pages")}>
        <textarea
          id="gate-answer-pages"
          className="field__control"
          rows={2}
          value={draft.pages}
          aria-invalid={problem("pages") !== null}
          aria-describedby="gate-answer-pages-note"
          onChange={(event) => change({ pages: event.target.value })}
        />
      </Field>

      <div className="rule-form__actions">
        <button
          type="submit"
          className="button button--primary"
          aria-disabled={held || undefined}
        >
          {answers.saving ? "Saving…" : "Save the answer"}
        </button>
      </div>
    </form>
  );
}

/** A label, its control and its note, where a refused field says what was wrong. */
function Field({
  id,
  label,
  problem,
  children,
}: {
  id: string;
  label: string;
  problem: string | null;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      <span className="field__note" id={`${id}-note`}>
        {problem !== null && <span className="field__note field__note--warning">{problem}</span>}
      </span>
    </div>
  );
}

function problemAt(problems: readonly DraftProblem[], field: DraftField): string | null {
  return problems.find((each) => each.field === field)?.message ?? null;
}
