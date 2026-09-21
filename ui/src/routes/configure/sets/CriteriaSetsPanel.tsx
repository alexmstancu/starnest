import { ErrorNotice } from "../../../shell/ErrorNotice";
import { useSelection } from "../../../shell/SelectionContext";
import { useCriteriaSets } from "./useCriteriaSets";

/**
 * The sets of priorities themselves: make one, rename one, discard one (`reqs.md` 3.4).
 *
 * **Markup only.** What each action does is `useCriteriaSets.ts`.
 */
export function CriteriaSetsPanel() {
  const { criteriaSets, criteriaSetId, reload, selectCriteriaSet } =
    useSelection();
  const form = useCriteriaSets({ reload, select: selectCriteriaSet });
  const chosen = criteriaSets.find((set) => set.id === criteriaSetId);

  return (
    <section className="panel" aria-labelledby="criteria-sets-heading">
      <h3 id="criteria-sets-heading" className="panel__heading">
        Criteria sets
      </h3>
      <p className="panel__hint">
        One set per way of looking at the question. A new set starts empty and
        scores nothing until it has criteria.
      </p>

      {form.failure !== null && <ErrorNotice error={form.failure} />}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          form.create();
        }}
      >
        <label className="field">
          <span className="field__label">Identifier</span>
          <input
            className="field__control"
            value={form.newId}
            onChange={(event) => form.typeNewId(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__control"
            value={form.newName}
            onChange={(event) => form.typeNewName(event.target.value)}
          />
        </label>
        <button type="submit" className="button" disabled={!form.canCreate}>
          Create set
        </button>
      </form>

      {chosen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.renameTo(chosen.id);
          }}
        >
          <label className="field">
            <span className="field__label">Rename {chosen.name}</span>
            <input
              className="field__control"
              value={form.rename}
              onChange={(event) => form.typeRename(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={!form.canRename}>
            Rename
          </button>
          <button
            type="button"
            className="button"
            onClick={() => form.discard(chosen.id)}
          >
            Discard {chosen.name}
          </button>
        </form>
      )}

      {chosen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.duplicate(chosen.id);
          }}
        >
          <p className="panel__hint">
            Editing a weight changes this set in place, so trying an idea out
            without losing what is here means copying it first. A copy is a
            complete set of its own, never a reference to this one.
          </p>
          <label className="field">
            <span className="field__label">
              Identifier for a copy of {chosen.name}
            </span>
            <input
              className="field__control"
              value={form.duplicateId}
              onChange={(event) => form.typeDuplicateId(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Name for the copy</span>
            <input
              className="field__control"
              value={form.duplicateName}
              onChange={(event) => form.typeDuplicateName(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={!form.canDuplicate}>
            Duplicate {chosen.name}
          </button>
        </form>
      )}
    </section>
  );
}
