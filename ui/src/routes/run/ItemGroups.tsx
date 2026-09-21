import { useId, useState } from "react";
import { formatCount } from "../../format/display";
import { type Item, groupBy, keyOf, questionsIn, scopeFor } from "./runScope";

/**
 * The items a run could not answer, grouped and selectable, with a scoped re-ask.
 *
 * **Grouped by what the question actually is.** A failure is a source refusing, so failures
 * group by source: "what did OECD refuse?". Nothing refused an unanswered item -- no source
 * covers it -- so those group by attribute: "which attribute does nobody answer?". Treating
 * them alike would put the wrong question at the top of each list.
 *
 * **A narrow selection is a new run, not a retry.** `POST /{runId}/retry` takes only
 * `failed | unanswered` over a whole run, so anything narrower goes through `/plan` and then
 * `POST /data-acquisition-runs` with a scope.
 */
export function ItemGroups({
  items,
  groupedBy,
  caption,
  level,
  act,
  busy,
  onPropose,
}: {
  items: readonly Item[];
  groupedBy: "data_source" | "attribute";
  caption: string;
  level: string;
  /** What the button will be called, e.g. "Retry". */
  act: string;
  busy: boolean;
  onPropose: (
    scope: ReturnType<typeof scopeFor>,
    describedAs: string,
  ) => void;
}) {
  const headingId = useId();
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(items.map(keyOf)),
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const groups = groupBy(items, groupedBy);
  const chosen = items.filter((item) => selected.has(keyOf(item)));
  const scope = scopeFor(level, chosen);
  const questions = questionsIn(scope);

  function toggle(keys: readonly string[], on: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  return (
    <section className="panel panel--nested" aria-labelledby={headingId}>
      <h4 id={headingId} className="panel__heading">
        {caption}
      </h4>

      <div className="group__actions">
        <button
          type="button"
          className="button"
          onClick={() => toggle(items.map(keyOf), true)}
        >
          Select all
        </button>
        <button
          type="button"
          className="button"
          onClick={() => toggle(items.map(keyOf), false)}
        >
          Clear all
        </button>
      </div>

      <ul className="group__list">
        {groups.map((group) => {
          const keys = group.items.map(keyOf);
          const picked = keys.filter((key) => selected.has(key)).length;
          const expanded = open.has(group.key);
          return (
            <li key={group.key} className="group">
              <div className="group__head">
                <button
                  type="button"
                  className="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen((current) => {
                      const next = new Set(current);
                      if (expanded) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                >
                  {group.key} ({formatCount(group.items.length)})
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => toggle(keys, true)}
                >
                  All
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => toggle(keys, false)}
                >
                  None
                </button>
                <span className="group__count">
                  {formatCount(picked)} selected
                </span>
              </div>

              {expanded && (
                <ul className="group__items">
                  {group.items.map((item) => {
                    const key = keyOf(item);
                    return (
                      <li key={key}>
                        <label className="toggle toggle--item">
                          <input
                            type="checkbox"
                            aria-label={`${item.candidate} ${item.attribute}`}
                            checked={selected.has(key)}
                            onChange={(event) =>
                              toggle([key], event.target.checked)
                            }
                          />
                          <span aria-hidden="true">
                            {item.candidate} {item.attribute}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* **The honest number.** `RunScope` carries candidates and attributes as separate
          lists, so a selection that is not a full rectangle asks more questions than it has
          items -- and somebody about to spend money gets the real size, not the flattering
          one. */}
      {questions > chosen.length && (
        <p className="panel__hint">
          {formatCount(chosen.length)} selected, but a run is scoped by
          candidate and by attribute, so this would ask about{" "}
          {formatCount(questions)} pairs.
        </p>
      )}

      <button
        type="button"
        className="button"
        disabled={busy || chosen.length === 0}
        onClick={() =>
          onPropose(scope, `${act} ${formatCount(chosen.length)} selected`)
        }
      >
        {act} {formatCount(chosen.length)} selected
      </button>
    </section>
  );
}
