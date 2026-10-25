import { useId, useState } from "react";
import { useAttributeNames } from "../../api/useAttributeNames";
import { useCandidateNames } from "../../api/useCandidateNames";
import { useSourceNames } from "../../api/useSourceNames";
import { formatCount } from "../../format/display";
import { HeldButton } from "./HeldButton";
import { failureGroups } from "./failureGroups";
import { groupLabel, groupMeta, itemDetail, itemPhrase, type ItemNames } from "./itemNames";
import { type Item, groupBy, keyOf, questionsIn, scopeFor } from "./runScope";

/**
 * The database's gaps of one kind -- failed, unanswered or not reached -- grouped and
 * selectable, with a scoped re-ask.
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
  onSelectionChange,
  onPropose,
}: {
  items: readonly Item[];
  groupedBy: "data_source" | "attribute";
  caption: string;
  level: string;
  /** Which detail each row carries -- see `itemDetail`. */
  detailKind: "failed" | "unanswered" | "not_reached";
  /** What the button will be called, e.g. "Retry". */
  act: string;
  /** An estimate is being read, so the button is held until it answers (NEW-44). */
  busy: boolean;
  /** Any change to what is picked, so a start armed for the old selection is put away (PL-116). */
  onSelectionChange: () => void;
  onPropose: (scope: ReturnType<typeof scopeFor>) => void;
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
    sources: useSourceNames(),
  };

  const groups = groupBy(items, groupedBy);
  const chosen = items.filter((item) => selected.has(keyOf(item)));
  const scope = scopeFor(level, chosen);
  const questions = questionsIn(scope);

  function toggle(keys: readonly string[], on: boolean): void {
    onSelectionChange();
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
      <h3 id={headingId} className="panel__heading">
        {caption}
      </h3>

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
                  className="group__toggle"
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
                  {/* **"▸ OECD  12 items, 3 picked".** The design puts the count and the
                      selection in one meta string beside the name rather than in a column of
                      its own, so a collapsed list reads as a list and not as a table. */}
                  <span className="group__caret" aria-hidden="true">
                    {expanded ? "▾" : "▸"}
                  </span>
                  <span className="group__name">
                    {groupLabel(names, groupedBy, group.key)}
                  </span>
                  <span className="group__meta">
                    {groupMeta(group.items.length, picked)}
                  </span>
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
                  {detailKind === "failed"
                    ? failureGroups(group.items).map((problem) =>
                        problem.items.length === 1 ? (
                          <ItemRow
                            key={problem.key}
                            item={{ ...problem.items[0]!, data_source: problem.source }}
                            names={names}
                            detail={problem.headline}
                            selected={selected}
                            onToggle={toggle}
                          />
                        ) : (
                          // **A message several items share is one problem, written once**
                          // (PL-058), with the items it hit under it.
                          <li key={problem.key} className="group__message">
                            <p className="group__message-text">{problem.headline}</p>
                            <ul className="group__items">
                              {problem.items.map((item) => (
                                <ItemRow
                                  key={keyOf({ ...item, data_source: problem.source })}
                                  item={{ ...item, data_source: problem.source }}
                                  names={names}
                                  detail={null}
                                  selected={selected}
                                  onToggle={toggle}
                                />
                              ))}
                            </ul>
                          </li>
                        ),
                      )
                    : group.items.map((item) => (
                        <ItemRow
                          key={keyOf(item)}
                          item={item}
                          names={names}
                          detail={itemDetail(item, detailKind)}
                          selected={selected}
                          onToggle={toggle}
                        />
                      ))}
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

      {/* Held while an estimate is read, never disabled (NEW-44); disabled while nothing is
          picked, where there is nothing to wait for. */}
      <HeldButton
        className="button"
        held={busy}
        disabled={chosen.length === 0}
        onClick={() => onPropose(scope)}
      >
        {act} {formatCount(chosen.length)} selected
      </HeldButton>
    </section>
  );
}

/** One pickable pair, with its right-hand detail where it has one of its own. */
function ItemRow({
  item,
  names,
  detail,
  selected,
  onToggle,
}: {
  item: Item;
  names: ItemNames;
  /** Null where the message is written once above the items it hit. */
  detail: string | null;
  selected: ReadonlySet<string>;
  onToggle: (keys: readonly string[], on: boolean) => void;
}) {
  const key = keyOf(item);
  return (
    <li>
      <label className="toggle toggle--item">
        <input
          type="checkbox"
          aria-label={itemPhrase(names, item)}
          checked={selected.has(key)}
          onChange={(event) => onToggle([key], event.target.checked)}
        />
        <span aria-hidden="true">{itemPhrase(names, item)}</span>
        {/* The design gives every row a right-hand detail: why this one failed, or that
            nothing anywhere had a row. */}
        {detail !== null && <span className="toggle__detail">{detail}</span>}
      </label>
    </li>
  );
}
