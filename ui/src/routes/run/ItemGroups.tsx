import { useId, useState } from "react";
import { useAttributeNames } from "../../api/useAttributeNames";
import { useCandidateNames } from "../../api/useCandidateNames";
import { useSourceNames } from "../../api/useSourceNames";
import { HeldButton } from "../../shell/HeldButton";
import { failureGroups } from "./failureGroups";
import { groupLabel, groupMeta, itemDetail, itemPhrase, type ItemNames } from "./itemNames";
import { type Item, groupBy, keyOf } from "./runScope";

/**
 * The database's gaps of one kind -- failed, unanswered or not reached -- grouped and
 * selectable. **The card holds the selection** (PL-124), so its one action can follow it.
 *
 * **Grouped by what the question actually is.** A failure is a source refusing, so failures
 * group by source: "what did OECD refuse?". Nothing refused an unanswered item -- no source
 * covers it -- so those group by attribute: "which attribute does nobody answer?". Treating
 * them alike would put the wrong question at the top of each list.
 *
 * **A control that would do nothing is held**, never disabled: Select all once everything is
 * picked, None on a group with nothing picked. Disabled, it would throw focus off as it greyed.
 */
export function ItemGroups({
  items,
  groupedBy,
  caption,
  detailKind,
  selected,
  onToggle,
}: {
  items: readonly Item[];
  groupedBy: "data_source" | "attribute";
  caption: string;
  /** Which detail each row carries -- see `itemDetail`. */
  detailKind: "failed" | "unanswered" | "not_reached";
  selected: ReadonlySet<string>;
  onToggle: (keys: readonly string[], on: boolean) => void;
}) {
  const headingId = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // In the component that renders the names, not threaded from a parent. One shared promise
  // serves every caller on the page.
  const names = {
    attributes: useAttributeNames(),
    candidates: useCandidateNames(),
    sources: useSourceNames(),
  };

  const groups = groupBy(items, groupedBy);
  const every = items.map(keyOf);
  const pickedOf = (keys: readonly string[]) => keys.filter((key) => selected.has(key)).length;
  const allPicked = pickedOf(every);
  const toggle = onToggle;

  return (
    <section className="panel panel--nested" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        {caption}
      </h3>

      <div className="group__actions">
        <HeldButton
          className="button"
          held={allPicked === every.length}
          onClick={() => toggle(every, true)}
        >
          Select all
        </HeldButton>
        <HeldButton className="button" held={allPicked === 0} onClick={() => toggle(every, false)}>
          Clear all
        </HeldButton>
      </div>

      <ul className="group__list">
        {groups.map((group) => {
          const keys = group.items.map(keyOf);
          const picked = keys.filter((key) => selected.has(key)).length;
          const expanded = open.has(group.key);
          return (
            <li key={group.key} className="group">
              <div className="group__head">
                {/* **Tri-state**, as the design has it: ticked when the whole group is picked,
                    mixed when part of it is, and a press picks the rest or clears it. */}
                <GroupBox
                  label={`Every item in ${groupLabel(names, groupedBy, group.key)}`}
                  picked={picked}
                  held={keys.length}
                  onToggle={(on) => toggle(keys, on)}
                />
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
                <HeldButton
                  className="button"
                  held={picked === keys.length}
                  onClick={() => toggle(keys, true)}
                >
                  All
                </HeldButton>
                <HeldButton className="button" held={picked === 0} onClick={() => toggle(keys, false)}>
                  None
                </HeldButton>
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

    </section>
  );
}

/** A group's own box: ticked, mixed or clear by how much of the group is picked. */
function GroupBox({
  label,
  picked,
  held,
  onToggle,
}: {
  label: string;
  picked: number;
  held: number;
  onToggle: (on: boolean) => void;
}) {
  const mixed = picked > 0 && picked < held;
  return (
    <input
      type="checkbox"
      className="group__box"
      aria-label={label}
      checked={picked === held && held > 0}
      ref={(box) => {
        if (box !== null) box.indeterminate = mixed;
      }}
      onChange={() => onToggle(picked < held)}
    />
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
