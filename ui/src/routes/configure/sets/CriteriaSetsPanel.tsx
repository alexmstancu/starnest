import { ErrorNotice } from "../../../shell/ErrorNotice";
import { useSelection } from "../../../shell/SelectionContext";
import { useCriteriaSets } from "./useCriteriaSets";

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
 * **Markup only.** What each action does is `useCriteriaSets.ts`.
 */
export function CriteriaSetsPanel() {
  const { criteriaSets, criteriaSetId, reload, selectCriteriaSet } =
    useSelection();
  const form = useCriteriaSets({
    names: criteriaSets.map((set) => set.name),
    reload,
    select: selectCriteriaSet,
  });
  const only = criteriaSets.length === 1;

  return (
    <section className="stage" aria-labelledby="criteria-sets-heading">
      <header className="stage__head">
        {/* The numeral is a CSS counter on `.stage__number`, so a stage cannot claim a
            position it does not hold -- nothing fails when a hard-coded 4 sits fifth. */}
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h3 id="criteria-sets-heading" className="stage__title">
            Criteria set
            <span className="stage__count">
              {criteriaSets.length === 1
                ? "1 set"
                : `${criteriaSets.length} sets`}
            </span>
          </h3>
          <p className="stage__lead">
            Which set of judgements you are editing. Changing a weight edits the
            set in place — duplicate it first if you want to keep the original.
          </p>
        </div>
      </header>

      {form.failure !== null && <ErrorNotice error={form.failure} />}

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
                  className="set-row__rename"
                  aria-label={`New name for ${set.name}`}
                  value={form.renameDraft}
                  onChange={(event) => form.typeRenameDraft(event.target.value)}
                />
              ) : (
                <span className="set-row__name">{set.name}</span>
              )}

              {inUse && <span className="chip chip--accent">in use</span>}
              <span className="set-row__meta">{set.id}</span>

              {/* **Four slots, always in the same order.** Unavailable is drawn as
                  unavailable rather than as absent: "Use" on the set already in use, and
                  "Delete" on the only set there is, would both leave a hole that shifts
                  every other button one place left. */}
              <span className="set-row__actions">
                {renaming ? (
                  <>
                    <button
                      type="button"
                      className="action"
                      disabled={!form.canSaveRename}
                      onClick={form.saveRename}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="action"
                      onClick={form.cancelRename}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="action"
                      disabled={inUse}
                      title="Edit and rank with this set"
                      onClick={() => selectCriteriaSet(set.id)}
                    >
                      {inUse ? "In use" : "Use"}
                    </button>
                    <button
                      type="button"
                      className="action"
                      title="Rename this set"
                      onClick={() => form.beginRename(set.id, set.name)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="action"
                      title="Copy it before experimenting"
                      onClick={() => form.duplicate(set.id, set.name)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="action action--danger"
                      disabled={only}
                      title={
                        only
                          ? "The only set there is cannot be deleted"
                          : "Delete this set"
                      }
                      onClick={() => form.discard(set.id)}
                    >
                      Delete
                    </button>
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
          form.create();
        }}
      >
        <label className="visually-hidden" htmlFor="new-criteria-set">
          Name a new set
        </label>
        <input
          id="new-criteria-set"
          className="field__control set-create__name"
          placeholder="Name a new set…"
          value={form.newName}
          onChange={(event) => form.typeNewName(event.target.value)}
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={!form.canCreate}
        >
          Create set
        </button>
      </form>
    </section>
  );
}
