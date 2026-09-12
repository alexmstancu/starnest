import { useState, type FormEvent } from "react";
import {
  createCriteriaSet,
  deleteCriteriaSet,
  renameCriteriaSet,
} from "../../api/endpoints";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";

/**
 * The sets of priorities themselves: make one, rename one, discard one (`reqs.md` 3.4).
 *
 * **A new set is empty**, which the API decides and this screen says plainly: copying one would
 * mean starting from somebody else's priorities without being asked.
 *
 * **Discarding a set does not touch a saved evaluation**, which froze its own copy of the
 * criteria (`reqs.md` Q193). That is the difference between an opinion and a measurement.
 */
export function CriteriaSetsPanel() {
  const { criteriaSets, criteriaSetId, reload, selectCriteriaSet } =
    useSelection();
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
  const [failure, setFailure] = useState<unknown>(null);

  const chosen = criteriaSets.find((set) => set.id === criteriaSetId);

  async function act(action: () => Promise<void>) {
    setFailure(null);
    try {
      await action();
      reload();
    } catch (error) {
      setFailure(error);
    }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    void act(async () => {
      const created = await createCriteriaSet(newId.trim(), newName.trim());
      setNewId("");
      setNewName("");
      selectCriteriaSet(created.id);
    });
  }

  return (
    <section className="panel" aria-labelledby="criteria-sets-heading">
      <h3 id="criteria-sets-heading" className="panel__heading">
        Criteria sets
      </h3>
      <p className="panel__hint">
        One set per way of looking at the question. A new set starts empty and
        scores nothing until it has criteria.
      </p>

      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does not
          perform. */}
      {failure !== null && <ErrorNotice error={failure} />}

      <form onSubmit={create}>
        <label className="field">
          <span className="field__label">Identifier</span>
          <input
            className="field__control"
            value={newId}
            onChange={(event) => setNewId(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__control"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button"
          disabled={!newId.trim() || !newName.trim()}
        >
          Create set
        </button>
      </form>

      {chosen && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await renameCriteriaSet(chosen.id, rename.trim());
              setRename("");
            });
          }}
        >
          <label className="field">
            <span className="field__label">Rename {chosen.name}</span>
            <input
              className="field__control"
              value={rename}
              onChange={(event) => setRename(event.target.value)}
            />
          </label>
          <button type="submit" className="button" disabled={!rename.trim()}>
            Rename
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void act(() => deleteCriteriaSet(chosen.id))}
          >
            Discard {chosen.name}
          </button>
        </form>
      )}
    </section>
  );
}
