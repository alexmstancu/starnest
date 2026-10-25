import { ActRefusal } from "../../../shell/ActRefusal";
import { ReadFailureCard } from "../../../shell/ReadFailureCard";
import { HeldButton } from "../../../shell/HeldButton";
import { useSelection } from "../../../shell/SelectionContext";
import type { CriteriaSetsForm } from "./useCriteriaSets";
import { useSetFocus } from "./useSetFocus";

/**
 * The sets of priorities themselves: make one, use one, rename one, copy one, discard one
 * (`reqs.md` 3.4).
 *
 * **A list with four fixed actions, not four forms.** The panel used to be a stack of forms,
 * one per verb, each asking for an identifier and a name; the design puts every set on a row
 * and every verb in the same place on it. That is what makes the stage readable at a glance --
 * three sets and which one is in use -- and it is why the four slots never change position
 * even when one of them is unavailable: a button that moves is a button you have to find
 * again.
 *
 * **Held, never disabled** (PL-037). A control whose own press makes it unavailable -- "In use",
 * "Create set" once its name is cleared, the last set's Delete -- keeps focus and says so with
 * `aria-disabled`; Chromium throws focus off a disabled one.
 *
 * **Delete deletes at once, as the design does** (PL-033, P1-27): the server keeps the set
 * restorably, and Recent changes lists the deletion with the undo that brings it back exactly.
 *
 * **Markup only.** What each action does is `useCriteriaSets.ts`, called once by the screen so
 * its writes and its history outlive a remount; where focus goes after it is `useSetFocus.ts`.
 */
export function CriteriaSetsPanel({ form }: { form: CriteriaSetsForm }) {
  const { criteriaSets, criteriaSetId, selectCriteriaSet } = useSelection();
  const only = criteriaSets.length === 1;
  const { renameField, newName, buttonId, renameClosed, deleted } = useSetFocus(
    criteriaSets,
    form.renaming,
    form.listFailure !== null,
  );
  const saveRename = async (criteriaSetId: string) => {
    await form.saveRename();
    renameClosed(criteriaSetId);
  };
  const cancelRename = (criteriaSetId: string) => {
    form.cancelRename();
    renameClosed(criteriaSetId);
  };
  const discard = async (criteriaSetId: string) => {
    if (await form.discard(criteriaSetId)) deleted(criteriaSetId);
  };

  return (
    <section className="stage" aria-labelledby="criteria-sets-heading">
      <header className="stage__head">
        {/* The numeral is a CSS counter on `.stage__number`, so a stage cannot claim a
            position it does not hold -- nothing fails when a hard-coded 4 sits fifth. */}
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h2 id="criteria-sets-heading" className="stage__title">
            Criteria set
            <span className="stage__count">
              {criteriaSets.length === 1
                ? "1 set"
                : `${criteriaSets.length} sets`}
            </span>
          </h2>
          <p className="stage__lead">
            Which set of judgements you are editing. Changing a weight edits the
            set in place — duplicate it first if you want to keep the original.
          </p>
        </div>
      </header>

      <ActRefusal act="The change to the criteria sets" error={form.failure} />
      {/* Every set action waits until the list shows it, so a read that failed says so and
          offers the way on, rather than leaving the stage held with no reason (PL-033). */}
      {form.listFailure !== null && (
        <ReadFailureCard
          what="The criteria sets"
          error={form.listFailure}
          onRetry={form.retryList}
          prominence="region"
        />
      )}

      <ul className="set-list">
        {criteriaSets.map((set) => {
          const inUse = set.id === criteriaSetId;
          const renaming = form.renaming === set.id;

          return (
            // Named, so a reader and a test both reach "Default" rather than "the first
            // row" -- and so the four verbs can repeat on every row without being ambiguous.
            <li
              key={set.id}
              aria-label={set.name}
              className={inUse ? "set-row set-row--in-use" : "set-row"}
            >
              {renaming ? (
                <input
                  ref={renameField}
                  className="set-row__rename"
                  aria-label={`New name for ${set.name}`}
                  value={form.renameDraft}
                  onChange={(event) => form.typeRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveRename(set.id);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename(set.id);
                    }
                  }}
                />
              ) : (
                <span className="set-row__name">{set.name}</span>
              )}

              {inUse && <span className="chip chip--accent">in use</span>}


              {/* **Four slots, always in the same order.** Unavailable is drawn as
                  unavailable rather than as absent: "Use" on the set already in use, and
                  "Delete" on the only set there is, would both leave a hole that shifts
                  every other button one place left. */}
              <span className="set-row__actions">
                {/* Keyed, so Save and Cancel are taken away rather than reused as Use and
                    Rename -- focus left on a reused button would sit on a different verb. */}
                {renaming ? (
                  <>
                    <HeldButton
                      key="save"
                      className="action"
                      held={form.heldFor(set.id) || !form.canSaveRename}
                      onClick={() => void saveRename(set.id)}
                    >
                      Save
                    </HeldButton>
                    <HeldButton
                      key="cancel"
                      className="action"
                      held={form.busy}
                      onClick={() => cancelRename(set.id)}
                    >
                      Cancel
                    </HeldButton>
                  </>
                ) : (
                  <>
                    <HeldButton
                      key="use"
                      className="action"
                      held={inUse}
                      title="Edit and rank with this set"
                      onClick={() => selectCriteriaSet(set.id)}
                    >
                      {inUse ? "In use" : "Use"}
                    </HeldButton>
                    <HeldButton
                      id={buttonId(set.id, "rename")}
                      className="action"
                      held={form.heldFor(set.id)}
                      title="Rename this set"
                      onClick={() => form.beginRename(set.id, set.name)}
                    >
                      Rename
                    </HeldButton>
                    <HeldButton
                      className="action"
                      held={form.heldFor(set.id)}
                      title="Copy it before experimenting"
                      onClick={() => void form.duplicate(set.id, set.name)}
                    >
                      Duplicate
                    </HeldButton>
                    <HeldButton
                      id={buttonId(set.id, "delete")}
                      className="action action--danger"
                      held={form.heldFor(set.id) || only}
                      title={
                        only
                          ? "The only set there is cannot be deleted"
                          : inUse
                            ? "Delete and fall back to another set"
                            : "Delete this set"
                      }
                      onClick={() => void discard(set.id)}
                    >
                      Delete
                    </HeldButton>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <form
        className="set-create"
        onSubmit={(event) => {
          event.preventDefault();
          void form.create();
        }}
      >
        <label className="visually-hidden" htmlFor="new-criteria-set">
          Name a new set
        </label>
        <input
          ref={newName}
          id="new-criteria-set"
          className="field__control set-create__name"
          placeholder="Name a new set…"
          value={form.newName}
          onChange={(event) => form.typeNewName(event.target.value)}
        />
        <button
          type="submit"
          className="button button--primary"
          aria-disabled={form.busy || form.createRefusal !== null || undefined}
          aria-describedby={form.createRefused ? "new-criteria-set-refusal" : undefined}
        >
          Create set
        </button>
        {form.createRefused && form.createRefusal !== null && (
          <p id="new-criteria-set-refusal" className="panel__hint" role="status">
            {form.createRefusal}
          </p>
        )}
      </form>
    </section>
  );
}
