import { type ReactNode, useCallback, useEffect, useState } from "react";
import { updatePillarWeight, type CriteriaSet } from "../../../api/endpoints";
import type { components } from "../../../api/schema";
import { formatPercentage } from "../../../format/display";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import {
  PILLAR_CEILING_FLOOR,
  PILLAR_SLIDER,
  sliderCeiling,
  totalOf,
  weightFrom,
  weightReading,
} from "../weights";

type PillarWeight = components["schemas"]["PillarWeight"];

/**
 * The outer half of the two-level weighting: what each pillar is worth within a level.
 *
 * **The rebalance is the server's** (`arch.md` 8.3). One weight is sent; every weight at that
 * level comes back, and this prints them. The running total is shown because a set that does
 * not sum to 100 is a broken score, and the server refuses one -- so the number beside the list
 * is a fact about what is stored rather than a client-side sum of what is typed.
 */
export function PillarWeightsPanel({
  criteriaSet,
  criteriaCounts,
  criteriaFor,
}: {
  criteriaSet: CriteriaSet;
  /** How many criteria each pillar holds, for the line under its name. */
  criteriaCounts?: ReadonlyMap<string, number>;
  /**
   * The attributes inside one pillar, rendered under it when it is opened.
   *
   * **A render prop, because which pillar is open is this panel's business.** A criterion's
   * weight is a share of its pillar's, so the two are one decision at two depths -- and the
   * way to see the second is to open the first.
   */
  criteriaFor?: (pillar: string) => ReactNode;
}) {
  const [weights, setWeights] = useState<PillarWeight[]>(
    criteriaSet.pillar_weights ?? [],
  );
  const [failure, setFailure] = useState<unknown>(null);

  const move = useCallback(
    async (pillar: string, weight: number, locked?: boolean) => {
      setFailure(null);
      try {
        const rebalanced = await updatePillarWeight(
          criteriaSet.id,
          pillar,
          weight,
          locked,
        );
        setWeights(rebalanced.items);
      } catch (error) {
        setFailure(error);
      }
    },
    [criteriaSet.id],
  );

  const total = totalOf(weights);
  const ceiling = sliderCeiling(weights.length, PILLAR_CEILING_FLOOR);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="stage" aria-labelledby="pillar-weights-heading">
      <header className="stage__head">
        {/* The numeral is a CSS counter on `.stage__number`, so a stage cannot claim a
            position it does not hold -- nothing fails when a hard-coded 4 sits fifth. */}
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h3 id="pillar-weights-heading" className="stage__title">
            Pillar weights
          </h3>
          <p className="stage__lead">
            What each pillar is worth within the level. They sum to{" "}
            {formatPercentage(total, 0)}; moving one rebalances the rest, which
            the server computes.
          </p>
        </div>
      </header>
      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does not
          perform. */}
      {failure !== null && <ErrorNotice error={failure} />}

      <div className="stage__summary">
        <span>Pillar weights sum to 100 within the level</span>
        <span className="stage__summary-total">
          Total
          <span
            className={
              total === 100 ? "chip chip--matching" : "chip chip--warning"
            }
          >
            {formatPercentage(total, 1)}
          </span>
        </span>
      </div>

      {weights.length === 0 ? (
        <p className="screen__note">This set weighs no pillar yet.</p>
      ) : (
        <div className="weight-rows">
          {weights.map((weight) => (
            <PillarRow
              key={weight.pillar}
              weight={weight}
              ceiling={ceiling}
              count={criteriaCounts?.get(weight.pillar)}
              open={open === weight.pillar}
              onOpen={
                criteriaFor === undefined
                  ? undefined
                  : () => setOpen(open === weight.pillar ? null : weight.pillar)
              }
              onMove={move}
            >
              {criteriaFor?.(weight.pillar)}
            </PillarRow>
          ))}
        </div>
      )}
    </section>
  );
}

function PillarRow({
  weight,
  ceiling,
  count,
  open,
  onOpen,
  onMove,
  children,
}: {
  weight: PillarWeight;
  ceiling: number;
  count?: number;
  open: boolean;
  onOpen?: () => void;
  onMove: (pillar: string, weight: number, locked?: boolean) => Promise<void>;
  children?: ReactNode;
}) {
  const stored = String(weight.weight);
  const [typed, setTyped] = useState(stored);
  // True only between the first move and letting go. **The reading follows the stored weight
  // the rest of the time**: a range input snaps its value to the step, and a rebalance
  // produces 29.17, so a readout taken from the slider would print 29.0 for a weight the
  // server holds at 29.17 -- the screen contradicting the response it just rendered.
  const [moving, setMoving] = useState(false);

  // A rebalance moves this row's weight without this row having been dragged, so the slider
  // follows the stored weight. Without this, the pillars that absorbed a change would keep
  // showing the weights they had before it -- the screen contradicting the response it just
  // rendered the total from.
  useEffect(() => setTyped(stored), [stored]);

  /**
   * **Dragging shows; letting go sends.** A range input has no "committed" event -- `change`
   * fires on every pixel of the drag -- so a naive binding would PATCH the server forty times
   * for one gesture, and every answer would rebalance the other ten pillars under the thumb.
   * The position is local while the pointer is down and goes to the server when it lifts.
   */
  function commit() {
    setMoving(false);
    // A range input always holds a number, so this never fires -- it is here because
    // `weightFrom` is honest about text that might not be one, and silently sending `NaN`
    // would be worse than doing nothing.
    const asked = weightFrom(typed);
    if (asked === null || asked === weight.weight) return;
    void onMove(weight.pillar, asked);
  }

  const meta =
    count === undefined
      ? weight.weight_locked
        ? "held at this weight"
        : "moves on a rebalance"
      : count === 1
        ? "1 attribute"
        : `${String(count)} attributes`;

  return (
    <>
      {/* **A group, named for its pillar.** The row holds three controls that are all about
          one pillar -- the slider, the reading, the lock -- and saying so is what lets a
          reader and a test find "economics" rather than "the fifth row". */}
      <div className="weight-row" role="group" aria-label={weight.pillar}>
        {/* **The name is the way in.** A criterion's weight is a share of its pillar's, so
          opening the pillar is what reveals the attributes it is shared among. */}
        {onOpen === undefined ? (
          <span className="weight-row__name">
            <span className="weight-row__label">{weight.pillar}</span>
            <span className="weight-row__meta">{meta}</span>
          </span>
        ) : (
          <button
            type="button"
            className="weight-row__name"
            aria-expanded={open}
            onClick={onOpen}
          >
            <span className="weight-row__label">
              <span className="weight-row__caret" aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
              {weight.pillar}
            </span>
            <span className="weight-row__meta">{meta}</span>
          </button>
        )}

        <input
          className="weight-row__slider"
          type="range"
          min={PILLAR_SLIDER.min}
          max={ceiling}
          step={PILLAR_SLIDER.step}
          value={typed}
          aria-label={`${weight.pillar} weight`}
          onChange={(event) => {
            setMoving(true);
            setTyped(event.target.value);
          }}
          onPointerUp={commit}
          onMouseUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />

        <span className="weight-row__value">
          {weightReading(moving ? typed : stored)}
        </span>

        {/* **A button, not a checkbox.** The design draws a filled or hollow disc, and a native
          checkbox cannot be one without being hidden behind a label -- which is the shape
          that shipped a lock nobody could click (P52). `aria-pressed` is what tells a screen
          reader it is a toggle. */}
        <button
          type="button"
          className={
            weight.weight_locked
              ? "weight-row__lock weight-row__lock--on"
              : "weight-row__lock"
          }
          aria-label={`Lock ${weight.pillar}`}
          aria-pressed={weight.weight_locked}
          title={
            weight.weight_locked
              ? "Held where it is, and takes no share of a rebalance"
              : "Moves in proportion when another weight changes"
          }
          onClick={() =>
            void onMove(weight.pillar, weight.weight, !weight.weight_locked)
          }
        >
          <span aria-hidden="true">
            {weight.weight_locked ? "\u25CF" : "\u25CB"}
          </span>
        </button>
      </div>
      {/* Indented under the pillar whose hundred they share, with a rule down the side: the
          indent is what says these weights are inside that one rather than beside it. */}
      {open && children !== undefined && (
        <div className="pillar-attributes">{children}</div>
      )}
    </>
  );
}
