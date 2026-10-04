import { useId, useState } from "react";
import { useAttributeNames } from "../../api/useAttributeNames";
import { useCandidateNames } from "../../api/useCandidateNames";
import { formatCount } from "../../format/display";
import { groupLabel, groupMeta, itemDetail, itemPhrase } from "./itemNames";
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
  detailKind,
  busy,
  onPropose,
}: {
  items: readonly Item[];
  groupedBy: "data_source" | "attribute";
  caption: string;
  level: string;
  /** Which of the two details each row carries -- see `itemDetail`. */
  detailKind: "failed" | "unanswered";
  /** What the button will be called, e.g. "Retry". */
  act: string;
  busy: boolean;
  onPropose: (
    scope: ReturnType<typeof scopeFor>,
    describedAs: string,
  ) => void;
}) {
  const headingId = useId();
  // **Nothing picked to begin with, as the design has it** (`selFail:{}` in its own state).
  // The card's own action already covers the whole bucket -- "Retry 12 failed" -- so a list
  // that opened with everything ticked made the selection say nothing: picking is how a reader
  // narrows, and it cannot narrow from a state that is already everything.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // In the component that renders the names, not threaded from a parent. One shared promise
  // serves every caller on the page.
  const names = {
    attributes: useAttributeNames(),
    candidates: useCandidateNames(),
  };

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
                  {/* **"▸ oecd  12 items, 3 picked".** The design puts the count and the
                      selection in one meta string beside the name rather than in a column of
                      its own, so a collapsed list reads as a list and not as a table. */}
                  <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>{" "}
                  {groupLabel(names, groupedBy, group.key)}{" "}
                  {groupMeta(group.items.length, picked)}
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
                            aria-label={itemPhrase(names, item)}
                            checked={selected.has(key)}
                            onChange={(event) =>
                              toggle([key], event.target.checked)
                            }
                          />
                          <span aria-hidden="true">
                            {itemPhrase(names, item)}
                          </span>
                          {/* The design gives every row a right-hand detail: why this one
                              failed, or that nothing anywhere had a row. */}
                          <span className="toggle__detail">
                            {itemDetail(item, detailKind)}
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
