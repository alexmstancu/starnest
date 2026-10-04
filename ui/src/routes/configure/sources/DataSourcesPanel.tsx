import { ErrorNotice } from "../../../shell/ErrorNotice";
import { inPriorityOrder, positionsOf } from "./sourceOrder";
import { howItAnswers } from "./sourceReading";
import { useDataSources } from "./useDataSources";
import { advertiseMove, useSourceDrag } from "./useSourceDrag";

/**
 * Which sources are consulted, and in what order.
 *
 * **Editable since Q232.** `reqs.md` 2 keeps the catalog -- what exists, in what unit, of what
 * type -- a developer action in config, and that still holds. What is editable here is
 * narrower and different in kind: whether a source already declared is consulted, and where it
 * stands. That is a judgement about which evidence to trust, not a change to what is measured,
 * and it cannot put the catalog into an inconsistent state.
 *
 * **Switching one off keeps every figure it produced.** The values stay stored, stay visible
 * in the drill-down with their provenance, and come back to the ranking the moment it is
 * switched on again (`reqs.md` 3.6). What changes is which figure scores.
 *
 * **A lower number wins**, which is stated rather than left to be inferred from the sort.
 *
 * **Two ways to reorder, and the arrows are not a fallback that may be dropped.** Dragging is
 * what the design asks for and the quicker gesture by far over a list this long; the arrows are
 * the only route to this control that does not need a pointer, and accessibility being
 * deferred elsewhere is a reason to keep the one keyboard path that exists rather than to
 * remove it.
 */
export function DataSourcesPanel() {
  const sources = useDataSources();
  const positions = positionsOf(sources.sources);
  // A reorder writes several rows one at a time, so any save in flight blocks a new gesture --
  // not just a save on the row being dragged, which is what disables that row's own arrows.
  const anySaving = sources.saving !== null;
  const drag = useSourceDrag(sources.sources, sources.reorder, anySaving);

  return (
    <section className="stage" aria-labelledby="data-sources-heading">
      <header className="stage__head">
        {/* The numeral is a CSS counter on `.stage__number`, so a stage cannot claim a
            position it does not hold -- nothing fails when a hard-coded 4 sits fifth. */}
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h3 id="data-sources-heading" className="stage__title">
            Source priority
          </h3>
    <p className="stage__lead">
            Which source wins when two answer the same attribute. A lower number
            wins. Drag a row to reorder, or use the arrows. Switching one off
            stops its figures being scored and stops a run asking it — every
            figure it has already produced is kept, and comes back if you switch
            it on again.
          </p>
        </div>
      </header>
      {sources.error != null && (
        <ErrorNotice error={sources.error} onRetry={sources.reload} />
      )}
      {sources.status === "loading" && (
        <p className="screen__note">Loading…</p>
      )}

      {sources.status === "ready" && (
        <ul className="source-list" aria-label="Every configured source, in priority order">
          {inPriorityOrder(sources.sources).map((source) => {
            const position = positions.get(source.id) ?? null;
            const busy = sources.saving === source.id;
            return (
              <li
                key={source.id}
                aria-label={source.name}
                className={
                  source.is_enabled ? "source-row" : "source-row source-row--off"
                }
                /* **The two drag states are attributes rather than class modifiers**, and the
                   stylesheet selects on them. A modifier would say the same thing, but only a
                   browser reading computed styles could then tell whether it was ever
                   applied -- while an attribute is state a unit test can read, which is what
                   keeps the indicator from silently disappearing in a refactor. The
                   stylesheet already does this for the switch's `aria-checked`. */
                data-dragging={drag.draggedId === source.id ? "true" : undefined}
                data-landing={drag.edgeFor(source.id) ?? undefined}
                /* **A switched-off source is draggable too.** It keeps its place in the
                   order rather than sinking to the bottom, because the order is the one it
                   would take if it were switched back on -- so where it stands is still a
                   decision worth making, and the row that shows no number is exactly the one
                   whose number somebody is setting for later. */
                draggable={!anySaving}
                onDragStart={(event) => {
                  advertiseMove(event.dataTransfer, source.id);
                  drag.start(source.id);
                }}
                onDragOver={(event) => {
                  // Without this the browser treats the row as refusing the drop, and no
                  // `drop` event is ever delivered.
                  event.preventDefault();
                  drag.over(source.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  drag.drop(source.id);
                }}
                /* Fires whether or not a drop landed, which is what returns the list to rest
                   after a release over nothing. */
                onDragEnd={drag.end}
              >
                {/* Decorative: the row is what carries the drag, and the arrows beside it are
                    what a reader without a pointer uses. A grip announced to a screen reader
                    would be a third control that does nothing it can operate. */}
                <span
                  className="source-row__grip"
                  aria-hidden="true"
                  title="Drag to reorder"
                >
                  ⁙
                </span>

                {/* **A switch, not a checkbox.** Consulting a source is a state it is in, and
                    the design draws it as one; `role="switch"` is what says so to a screen
                    reader, which a styled checkbox behind a label could not (P52). */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={source.is_enabled}
                  aria-label={`Consult ${source.name}`}
                  className="switch"
                  disabled={busy}
                  title="Consult this source at all"
                  onClick={() =>
                    sources.setEnabled(source.id, !source.is_enabled)
                  }
                >
                  <span className="switch__knob" aria-hidden="true" />
                </button>

                {/* No number for a source that is not consulted: showing one would say it is
                    next in line when it is not in the contest at all. */}
                <span className="source-row__priority">
                  {position ?? "—"}
                </span>
                <span className="source-row__name">{source.name}</span>
                <span className="source-row__meta">
                  {howItAnswers(source.source_kind, position !== null)}
                </span>

                <span className="source-row__move">
                  <button
                    type="button"
                    className="arrow"
                    disabled={busy || sources.moveTo(source.id, "up") === null}
                    title="Higher priority"
                    onClick={() => sources.move(source.id, "up")}
                  >
                    <span className="visually-hidden">
                      Move {source.name} up
                    </span>
                    <span aria-hidden="true">▲</span>
                  </button>
                  <button
                    type="button"
                    className="arrow"
                    disabled={busy || sources.moveTo(source.id, "down") === null}
                    title="Lower priority"
                    onClick={() => sources.move(source.id, "down")}
                  >
                    <span className="visually-hidden">
                      Move {source.name} down
                    </span>
                    <span aria-hidden="true">▼</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
