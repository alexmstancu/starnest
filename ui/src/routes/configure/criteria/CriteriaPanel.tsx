import type { Criterion } from "../../../api/endpoints";
import { lockedAttributes } from "../../../api/errorPresentation";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CriteriaEditor } from "../useCriteriaEditor";
import { weightAsText, weightFrom } from "../weights";

/**
 * The inner half of the two-level weighting: what each criterion is worth within its pillar.
 *
 * **The screen sends one weight and re-renders from the response.** Weights sum to 100 within
 * a pillar, and which siblings absorb a change depends on which are locked -- that arithmetic
 * is the server's (`arch.md` 8.3), and duplicating it here would put a second, quietly
 * different answer in front of the user.
 *
 * A refusal is shown rather than absorbed. `409 weights_all_locked` means the weight was not
 * set; a screen that stayed silent would leave the user believing it had been.
 */
export function CriteriaPanel({ editor }: { editor: CriteriaEditor }) {
  return (
    <section className="panel" aria-labelledby="criteria-heading">
      <h3 id="criteria-heading" className="panel__heading">
        Criteria
      </h3>
      <p className="panel__hint">
        Weights are percentages within a pillar. Changing one rebalances the
        others, which the backend computes and this panel reports.
      </p>

      {editor.saveError !== null && <SaveFailure error={editor.saveError} />}

      {editor.criteria.length === 0 ? (
        <p className="screen__note">This criteria set has no criteria.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              <th scope="col">Pillar</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {editor.criteria.map((criterion) => (
              <CriterionRow
                key={criterion.attribute}
                criterion={criterion}
                saving={editor.savingAttribute === criterion.attribute}
                onSave={editor.setWeight}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CriterionRow({
  criterion,
  saving,
  onSave,
}: {
  criterion: Criterion;
  saving: boolean;
  onSave: (attribute: string, weight: number) => void;
}) {
  const stored = weightAsText(criterion.weight);
  const [draft, setDraft] = useState(stored);
  const [notANumber, setNotANumber] = useState(false);

  // A rebalance changes this row's weight without the row having been edited, so the input
  // follows the stored value rather than keeping whatever was last typed into it.
  useEffect(() => setDraft(stored), [stored]);

  // A refused change leaves the stored weight exactly where it was, so the input goes back to
  // it once the attempt is over. Leaving the typed number on screen would have the same screen
  // reporting the refusal in one place and showing the weight it refused in another -- and the
  // number in the input is the one a reader takes for the weight being scored.
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving) setDraft(stored);
    wasSaving.current = saving;
  }, [saving, stored]);

  function submit(event: FormEvent) {
    event.preventDefault();

    const weight = weightFrom(draft);
    if (weight === null) {
      setNotANumber(true);
      return;
    }

    setNotANumber(false);
    onSave(criterion.attribute, weight);
  }

  return (
    <tr className="table__row">
      <th scope="row">{criterion.attribute}</th>
      <td>{criterion.pillar}</td>
      <td>
        <form className="weight-form" onSubmit={submit}>
          <input
            className="field__control weight-form__input"
            type="number"
            min={0}
            max={100}
            step="any"
            value={draft}
            aria-label={`Weight for ${criterion.attribute}`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="button"
            disabled={saving || draft === stored}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {notANumber && (
            <p className="weight-form__problem" role="alert">
              A weight must be a number.
            </p>
          )}
        </form>
      </td>
    </tr>
  );
}

/**
 * A refused weight change, with the locks that refused it. `details.locked` names them
 * (`openapi.yaml`, `updateCriterion` 409) and they are the only thing the user can act on --
 * "it is locked somewhere" would be a dead end.
 */
function SaveFailure({ error }: { error: unknown }) {
  const locked = lockedAttributes(error);

  return (
    <div className="save-failure">
      <ErrorNotice error={error} />
      {locked.length > 0 && (
        <>
          <p className="screen__note" id="lock-list-heading">
            Locked, so unable to absorb the change:
          </p>
          {/* Named, because these attribute ids also appear in the table above: a reader
              arriving at the list out of context needs to be told which one it is. */}
          <ul className="lock-list" aria-labelledby="lock-list-heading">
            {locked.map((attribute) => (
              <li key={attribute}>
                <code>{attribute}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
