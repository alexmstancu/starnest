import type { Criterion, CriterionRule } from "../../../api/endpoints";
import { lockedAttributes } from "../../../api/errorPresentation";
import { formatPercentage } from "../../../format/display";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CriteriaEditor } from "../useCriteriaEditor";
import { totalsByPillar, weightAsText, weightFrom } from "../weights";
import { CriterionRuleFields } from "./CriterionRuleFields";
import { useCriterionRule } from "./useCriterionRule";

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
        others, which the backend computes and this panel reports. A
        criterion&apos;s rule — its goal, scale and threshold — is edited per
        row, and moves no weight.
      </p>
      <p className="panel__hint">
        A locked weight is held where it is and takes no share of a rebalance.
        Lock everything in a pillar and there is nowhere left for a change to
        go, which the backend refuses rather than silently absorbing.
      </p>

      <PillarTotals criteria={editor.criteria} />

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
              <th scope="col">Locked</th>
              <th scope="col">Goal</th>
              <th scope="col">Rule</th>
            </tr>
          </thead>
          <tbody>
            {editor.criteria.map((criterion) => (
              <CriterionRow
                key={criterion.attribute}
                criterion={criterion}
                saving={editor.savingAttribute === criterion.attribute}
                onSave={editor.setWeight}
                onSetLock={editor.setLock}
                onSaveRule={editor.setRule}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * What each pillar's criteria currently come to.
 *
 * **Criterion weights sum to 100 within a pillar** (`reqs.md` 3.4). The server enforces it by
 * rebalancing; showing the total back lets a reader watch the rule hold instead of taking it
 * on trust -- and makes a pillar that has drifted visible rather than merely wrong.
 */
function PillarTotals({ criteria }: { criteria: readonly Criterion[] }) {
  const totals = totalsByPillar(criteria);
  if (totals.length === 0) return null;

  return (
    <ul className="pillar-totals" aria-label="Weight totals by pillar">
      {totals.map((each) => (
        <li
          key={each.pillar}
          className={
            each.balanced
              ? "chip chip--accent"
              : "chip chip--not_matching"
          }
        >
          {each.pillar} {formatPercentage(each.total)}
        </li>
      ))}
    </ul>
  );
}

function CriterionRow({
  criterion,
  saving,
  onSave,
  onSetLock,
  onSaveRule,
}: {
  criterion: Criterion;
  saving: boolean;
  onSave: (attribute: string, weight: number) => void;
  onSetLock: (attribute: string, weightLocked: boolean) => void;
  onSaveRule: (attribute: string, rule: CriterionRule) => void;
}) {
  const stored = weightAsText(criterion.weight);
  const [draft, setDraft] = useState(stored);
  const [notANumber, setNotANumber] = useState(false);
  // Closed by default: forty-one criteria with their scales open at once is a screen nobody
  // can read. Local state, because which row is open is this component's own business and
  // nothing outside it needs to know.
  const [editingRule, setEditingRule] = useState(false);
  const rule = useCriterionRule(criterion, saving, onSaveRule);

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
    <>
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
        <td>
          {/* Sent with the weight, not separately: the server rebalances the *unlocked*
              siblings, so which of them absorb a change depends on what is locked at the
              moment it is made. Two requests would let their order decide the answer. */}
          {/* **The name is on the input, and the visible word is decorative.** A `.toggle`
              whose only child is a `visually-hidden` span has no width outside a flex row, so
              it collapses to a target nothing can click -- which a component test cannot see,
              because it clicks the element rather than a point on the screen. */}
          <label className="toggle toggle--lock">
            <input
              type="checkbox"
              aria-label={`Lock the weight for ${criterion.attribute}`}
              checked={criterion.weight_locked ?? false}
              disabled={saving}
              onChange={(event) =>
                onSetLock(criterion.attribute, event.target.checked)
              }
            />
            <span aria-hidden="true">
              {criterion.weight_locked ? "Locked" : "Unlocked"}
            </span>
          </label>
        </td>
        <td>{criterion.goal}</td>
        <td>
          <button
            type="button"
            className="button"
            aria-expanded={editingRule}
            onClick={() => setEditingRule((open) => !open)}
          >
            {editingRule ? "Close" : "Edit"} the rule for {criterion.attribute}
          </button>
        </td>
      </tr>
      {editingRule && (
        <tr className="table__row">
          {/* One cell across the row, because the rule is about the criterion the row names
              rather than about any one column of it. */}
          <td colSpan={5}>
            <CriterionRuleFields
              form={rule}
              attribute={criterion.attribute}
              saving={saving}
            />
          </td>
        </tr>
      )}
    </>
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
