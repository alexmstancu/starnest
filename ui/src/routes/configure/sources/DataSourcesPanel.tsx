import { ActRefusal } from "../../../shell/ActRefusal";
import { SOURCE_PRIORITY } from "../../../navigation/highlight";
import { LoadedRegion } from "../../../shell/LoadedRegion";
import { Stage } from "../Stage";
import { describeOrderRefusal, inPriorityOrder, positionsOf } from "./sourceOrder";
import {
  attributesWithOwnOrder,
  describeMaxAge,
  describeReach,
  howItAnswers,
  onlySourceOf,
  soleSourceOf,
  type ReachedAttribute,
} from "./sourceReading";
import { sourceName } from "../../../format/display";
import type { AttributeCatalogRead } from "../useAttributeCatalog";
import { useDataSources } from "./useDataSources";
import { useArrowFocus } from "./useArrowFocus";
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
export function DataSourcesPanel({
  catalog,
  required = NONE_REQUIRED,
}: {
  /** What each source can answer, and which attributes name their own order (PL-134, 135). */
  catalog?: AttributeCatalogRead;
  /**
   * The attributes the set on screen requires: scored, and blocking when missing. `null` while
   * the set is not read -- pending, failed or switching -- which is not a set requiring nothing.
   */
  required?: ReadonlySet<string> | null;
}) {
  const sources = useDataSources();
  // Only from a catalog that was read: a count from nothing would say "answers nothing yet".
  const attributes = catalog?.read.state === "ready" ? catalog.attributes : null;
  const names = new Map(sources.sources.map((source) => [source.id, source.name]));
  const positions = positionsOf(sources.sources);
  // Every control is held until a change has been written and read back (UI-07): a gesture
  // started meanwhile would be computed from the order before it. **Held, never disabled** (NEW-34): Chromium throws focus off
  // a control the moment it is disabled, so a switch or arrow pressed from the keyboard put the
  // reader back on the page. A held one keeps focus, says so, and the hook refuses the press.
  const held = sources.held;
  const drag = useSourceDrag(sources.sources, sources.reorder, held);
  const arrows = useArrowFocus(sources.sources, !held);

  return (
    <Stage
      id="data-sources"
      landsOn={[SOURCE_PRIORITY]}
      title="Source priority"
      lead={
        <>
          The order sources are asked in, and which figure is preferred when two are equally
          fresh — unless the attribute names its own order, listed below. A lower number comes
          first. Drag a row to reorder, or use the arrows. Switching one off stops its figures
          being scored and stops a run asking it — every figure it has already produced is
          kept, and comes back if you switch it on again.
        </>
      }
    >
      {/* No "try again" here: a change is retried by making it again. */}
      <ActRefusal act="The change to the sources" error={sources.failure}>
        <OrderRefusal error={sources.failure} nameOf={(id) => sourceName(names, id)} />
      </ActRefusal>

      {sources.read.state !== "idle" && (
        <LoadedRegion
          read={sources.read}
          what="The source priority"
          skeleton="lines"
          onRetry={sources.reload}
          prominence="region"
        >
          {() => (
            <>
        <ul className="source-list" aria-label="Every configured source, in priority order">
          {inPriorityOrder(sources.sources).map((source) => {
            const position = positions.get(source.id) ?? null;
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
                draggable={!held}
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
                  aria-disabled={held || undefined}
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
                {attributes !== null && position !== null && (
                  <span className="source-row__reach">
                    {describeReach(source.id, attributes)}
                  </span>
                )}
                <span className="source-row__meta">
                  {howItAnswers(
                    source.source_kind,
                    source.reliability_tier,
                    position !== null,
                  )}
                </span>

                <span className="source-row__move">
                  {/* Disabled outright only where there is no neighbour to swap with. */}
                  <button
                    type="button"
                    className="arrow"
                    ref={arrows.arrowRef(source.id, "up")}
                    disabled={sources.moveTo(source.id, "up") === null}
                    aria-disabled={held || undefined}
                    title="Higher priority"
                    onClick={() => {
                      if (!held) arrows.pressed(source.id, "up");
                      sources.move(source.id, "up");
                    }}
                  >
                    <span className="visually-hidden">
                      Move {source.name} up
                    </span>
                    <span aria-hidden="true">▲</span>
                  </button>
                  <button
                    type="button"
                    className="arrow"
                    ref={arrows.arrowRef(source.id, "down")}
                    disabled={sources.moveTo(source.id, "down") === null}
                    aria-disabled={held || undefined}
                    title="Lower priority"
                    onClick={() => {
                      if (!held) arrows.pressed(source.id, "down");
                      sources.move(source.id, "down");
                    }}
                  >
                    <span className="visually-hidden">
                      Move {source.name} down
                    </span>
                    <span aria-hidden="true">▼</span>
                  </button>
                </span>
                {attributes !== null && position !== null && (
                  <SwitchingOffCosts sourceId={source.id} attributes={attributes} required={required} />
                )}
              </li>
            );
          })}
        </ul>
              {attributes !== null && (
                <OwnOrders
                  orders={attributesWithOwnOrder(attributes, sources.sources)}
                  nameOf={(id) => sourceName(names, id)}
                />
              )}
            </>
          )}
        </LoadedRegion>
      )}
    </Stage>
  );
}

const NONE_REQUIRED: ReadonlySet<string> = new Set();

/** The sources an order refusal names, beneath the code's own sentence (P1-07). */
function OrderRefusal({ error, nameOf }: { error: unknown; nameOf: (id: string) => string }) {
  const named = describeOrderRefusal(error, nameOf);
  return named === null ? null : <p>{named}</p>;
}

/**
 * What switching a source off costs, where it is the only one that can fetch a required figure.
 *
 * **While the set is not read, the cost is not known**, and saying nothing would say it is
 * nothing: a source that is the only one for any attribute says so, and that whether any of
 * them is required waits for the set.
 */
function SwitchingOffCosts({
  sourceId,
  attributes,
  required,
}: {
  sourceId: string;
  attributes: readonly ReachedAttribute[];
  required: ReadonlySet<string> | null;
}) {
  if (required === null) {
    const only = onlySourceOf(sourceId, attributes);
    if (only.length === 0) return null;
    return (
      <span className="source-row__cost">
        Only source of {only.join(", ")}; what switching it off costs cannot be known until
        the criteria set is read.
      </span>
    );
  }
  const only = soleSourceOf(sourceId, attributes, required);
  if (only.length === 0) return null;
  const named = only.join(", ");
  const it = only.length === 1 ? "that figure" : "those figures";
  return (
    <span className="source-row__cost">
      Only source of {named}, which {only.length === 1 ? "is" : "are"} required: switched
      off, a candidate without {it} gets no score.
    </span>
  );
}

/**
 * The attributes that name their own order (PL-135), read-only: the order is catalog, set by a
 * developer, and the global order above applies to each only after the sources it puts first.
 */
function OwnOrders({
  orders,
  nameOf,
}: {
  orders: readonly { id: string; name: string; leading: string[]; maxAgeMonths: number | null }[];
  nameOf: (id: string) => string;
}) {
  if (orders.length === 0) return null;
  return (
    <>
      <h3 className="panel__heading" id="own-orders-heading">
        Attributes that name their own order
      </h3>
      <ul className="lock-list" aria-label="Attributes that name their own source order">
        {orders.map((order) => (
          <li key={order.id}>
            {order.name}: {order.leading.map(nameOf).join(", ")} first, then the order above;{" "}
            {describeMaxAge(order.maxAgeMonths)}
          </li>
        ))}
      </ul>
    </>
  );
}
