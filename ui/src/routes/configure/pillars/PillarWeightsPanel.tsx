import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { usePillarNames, type PillarNames } from "../../../api/usePillarNames";
import {
  updatePillarLock,
  updatePillarWeight,
  type CriteriaSet,
} from "../../../api/endpoints";
import type { components } from "../../../api/schema";
import { formatPercentage, pillarName } from "../../../format/display";
import type { ChangeHistory } from "../useChangeHistory";
import { useNotePillarChange } from "./useNotePillarChange";
import type { PillarAnswers } from "./usePillarAnswers";
import { ActRefusal } from "../../../shell/ActRefusal";
import { useWeightDrag } from "../useWeightDrag";
import {
  comesToAHundred,
  PILLAR_CEILING_FLOOR,
  PILLAR_SLIDER,
  previewedTotal,
  sliderCeiling,
  weightedPillars,
  weightFrom,
  weightReading,
  lockTitle,
  describePillarCount,
} from "../weights";
import { LockIcon } from "../LockIcon";
import { ReadFailureCard } from "../../../shell/ReadFailureCard";
import type { AttributeCatalogRead } from "../useAttributeCatalog";

type PillarWeight = components["schemas"]["PillarWeight"];

/**
 * The outer half of the two-level weighting: what each pillar is worth within a level.
 *
 * **The rebalance is the server's** (`arch.md` 8.3). One weight is sent; every weight at that
 * level comes back, and this prints them. The running total is shown because a set that does
 * not sum to 100 is a broken score, and the server refuses one -- so the number beside the list
 * is a fact about what is stored rather than a client-side sum of what is typed.
 *
 * **While a pointer is down, the rows show a preview** (`useWeightDrag`), because the server is
 * asked once and a gesture lasts longer than that. It is drawn from the same rule the server
 * applies and replaced by the server's own answer when the pointer lifts; a figure on this
 * screen is still never one the interface decided.
 */
export function PillarWeightsPanel({
  criteriaSet,
  criteriaCounts,
  unsourcedShares,
  criteriaFor,
  history,
  catalog,
  answers,
}: {
  /** Where an undo's answer is shown: the panel on screen then, which may not be this one. */
  answers?: PillarAnswers;
  criteriaSet: CriteriaSet;
  /**
   * The attribute catalog the rows inside each pillar read. When it could not be read the
   * stage says so (PL-014): no chip can then tell a sourced attribute from an unsourced one.
   */
  catalog?: AttributeCatalogRead;
  /** Where each answered change is noted with the request that reverses it (PL-138a). */
  history?: ChangeHistory;
  /** How many criteria each pillar holds, for the line under its name. */
  criteriaCounts?: ReadonlyMap<string, number>;
  /**
   * How much of each pillar's weight no source can fetch, where any is (PL-113); `"unknown"`
   * while the catalog that answers it is not read.
   */
  unsourcedShares?: ReadonlyMap<string, number> | "unknown";
  /**
   * The attributes inside one pillar, rendered under it when it is opened.
   *
   * **A render prop, because which pillar is open is this panel's business.** A criterion's
   * weight is a share of its pillar's, so the two are one decision at two depths -- and the
   * way to see the second is to open the first.
   */
  criteriaFor?: (pillar: string) => ReactNode;
}) {
  const names = usePillarNames();
  const [weights, setWeights] = useState<PillarWeight[]>(
    criteriaSet.pillar_weights ?? [],
  );
  const [failure, setFailure] = useState<unknown>(null);
  // **One write at a time** (UI-04): every answer is the whole level rebalanced, so two in
  // flight can land in either order and the older answer would be shown over the newer one.
  // The state holds the rows still; the ref refuses what arrives before they have re-rendered.
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  // Destructured, because `ended` is listed as a dependency below and `react-hooks` reads a
  // name rather than a member expression. `useWeightDrag` keeps it stable for exactly that.
  const { preview, previewFor, moveTo, ended } = useWeightDrag();
  const undoing = history?.undoing === true;
  // Held too while any other write in Configure is in flight: one at a time (PL-033).
  const held = saving || undoing || history?.busy === true;
  useEffect(() => answers?.listen(criteriaSet.id, setWeights), [answers, criteriaSet.id]);
  const showAnswer = useCallback(
    (setId: string, answer: PillarWeight[]) => {
      if (answers !== undefined) answers.deliver(setId, answer);
      else if (setId === criteriaSet.id) setWeights(answer);
    },
    [answers, criteriaSet.id],
  );
  const note = useNotePillarChange(criteriaSet, names, showAnswer, history);

  const move = useCallback(
    async (pillar: string, weight: number) => {
      if (inFlight.current || undoing) return;
      // The one write in Configure's flight (D41, PL-033), given back by the write itself,
      // which outlives this panel when a set switch remounts it.
      const done = history?.begin();
      if (done === null) return;
      inFlight.current = true;
      setSaving(true);
      setFailure(null);
      try {
        const rebalanced = await updatePillarWeight(criteriaSet.id, pillar, weight);
        setWeights(rebalanced.items);
        note.weight(pillar, weights, rebalanced.items, weight);
      } catch (error) {
        setFailure(error);
      } finally {
        inFlight.current = false;
        setSaving(false);
        done?.();
        // **Here rather than on release**, so the preview stands until the answer that replaces
        // it. A refusal ends the gesture too: the weights it previewed are not the stored ones
        // and never will be, so the rows go back to what is stored and the notice says why.
        ended();
      }
    },
    [criteriaSet.id, ended, undoing, note, weights, history],
  );

  // **Its own request, carrying no weight** (P68). See `updatePillarLock`: a lock sent with a
  // weight can be set and never released, because the move is refused before the flag is read.
  const lock = useCallback(
    async (pillar: string, locked: boolean) => {
      if (inFlight.current || undoing) return;
      // The one write in Configure's flight (D41, PL-033), given back by the write itself,
      // which outlives this panel when a set switch remounts it.
      const done = history?.begin();
      if (done === null) return;
      inFlight.current = true;
      setSaving(true);
      setFailure(null);
      try {
        const rebalanced = await updatePillarLock(criteriaSet.id, pillar, locked);
        setWeights(rebalanced.items);
        note.lock(pillar, locked);
      } catch (error) {
        setFailure(error);
      } finally {
        inFlight.current = false;
        setSaving(false);
        done?.();
      }
    },
    [criteriaSet.id, undoing, note, history],
  );

  // The weights as a rebalance sees them: what the drag snapshots, and what the total is read
  // from so that it counts the preview the rows are showing rather than the stored figures.
  const items = weightedPillars(weights);
  const total = previewedTotal(items, preview);
  const ceiling = sliderCeiling(weights.length, PILLAR_CEILING_FLOOR);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      {catalog?.read.state === "failed" && (
        <ReadFailureCard
          what="The attribute catalog"
          error={catalog.read.error}
          onRetry={catalog.reload}
          prominence="region"
        />
      )}
      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does not
          perform. */}
      <ActRefusal act="The weight change" error={failure} />

      <div className="stage__summary">
        {/* The design's own line, verbatim. It reads oddly beside a pillar total -- the rule
            it states is about the hundred *inside* a pillar -- but stage 3 is where a pillar
            opens to its attributes, and this is the sentence the design puts here. Changed to
            the pillar rule once on the reasoning above; the live design says otherwise. */}
        <span>Attribute weights sum to 100 inside each pillar</span>
        <span className="stage__summary-total">
          Total
          <span
            className={
              comesToAHundred(total) ? "chip chip--matching" : "chip chip--not_matching"
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
              names={names}
              weight={weight}
              previewed={previewFor(weight.pillar)}
              ceiling={ceiling}
              saving={held}
              count={criteriaCounts?.get(weight.pillar)}
              unsourcedShare={
                unsourcedShares === "unknown" ? "unknown" : unsourcedShares?.get(weight.pillar)
              }
              open={open === weight.pillar}
              onOpen={
                criteriaFor === undefined
                  ? undefined
                  : () => setOpen(open === weight.pillar ? null : weight.pillar)
              }
              onDrag={(asked) => moveTo(items, weight.pillar, asked)}
              onDragEnd={ended}
              onMove={move}
              onLock={lock}
            >
              {criteriaFor?.(weight.pillar)}
            </PillarRow>
          ))}
        </div>
      )}
    </>
  );
}

function PillarRow({
  names,
  weight,
  previewed,
  ceiling,
  saving,
  count,
  unsourcedShare,
  open,
  onOpen,
  onDrag,
  onDragEnd,
  onMove,
  onLock,
  children,
}: {
  names: PillarNames;
  weight: PillarWeight;
  /**
   * What this pillar would weigh if the drag in progress were let go -- and nothing when there
   * is no drag, when the locks leave it no room, or when this is the row being dragged, which
   * shows the pointer instead.
   */
  previewed?: number;
  ceiling: number;
  /** A pillar write is in flight, so this row may start none of its own. */
  saving: boolean;
  count?: number;
  unsourcedShare?: number | "unknown";
  open: boolean;
  onOpen?: () => void;
  /** The pointer has moved this weight, to the value the slider now holds. */
  onDrag: (asked: string) => void;
  /** Nothing is being sent, so no answer is coming to end the gesture. */
  onDragEnd: () => void;
  onMove: (pillar: string, weight: number) => Promise<void>;
  onLock: (pillar: string, locked: boolean) => Promise<void>;
  children?: ReactNode;
}) {
  const stored = String(weight.weight);
  // What the row shows: a preview while another pillar is being dragged, the stored weight the
  // rest of the time. **The stored weight is still what `commit` compares against** -- a guard
  // measured against the preview would find the pointer already there and send nothing.
  const shown = previewed === undefined ? stored : String(previewed);
  const [typed, setTyped] = useState(stored);
  // True only between this row's first move and letting go. **The reading follows what the row
  // is shown the rest of the time** -- the stored weight, or a preview while another row is
  // being dragged: a range input snaps its value to the step, and a rebalance produces 29.17,
  // so a readout taken from the slider would print 29.0 for a weight that is 29.17 -- the
  // screen contradicting the figure it was given.
  const [moving, setMoving] = useState(false);

  // **Released once, and only after it moved** (UI-05, NEW-43). A gesture ends with up to four
  // events, and each used to send the weight again while the first answer was on its way. And a
  // release with nothing moved before it -- focus arriving by Tab, a thumb clicked and let go --
  // used to send what the slider holds, which is the stored weight snapped to its step (Chromium
  // reads a rebalanced 29.17 back as 29): a weight nobody chose. Set by a movement and spent by
  // the release that follows it. A ref, because the four can arrive in one tick.
  const unreleased = useRef(false);

  // A rebalance moves this row's weight without this row having been dragged -- the server's
  // on the way back, and the preview's while another row's pointer is down -- so the slider
  // follows it. Without this, the pillars absorbing a change would keep showing the weights
  // they had before it: the screen contradicting the total printed above it.
  useEffect(() => setTyped(shown), [shown]);

  // A refused weight leaves the stored one where it was, so `shown` never changes and the
  // effect above never fires: the thumb would sit where the server refused it, and the next
  // blur would send it again. It goes back once the write is over, as a criterion's does.
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving) setTyped(shown);
    wasSaving.current = saving;
  }, [saving, shown]);

  /**
   * **Dragging shows the whole rebalance; letting go sends one weight.** A range input has no
   * "committed" event -- `change` fires on every pixel of the drag -- so a naive binding would
   * PUT forty times for one gesture, and every answer would rebalance the other ten pillars
   * under the thumb. One request still goes, when the pointer lifts; what the siblings would
   * become is worked out here meanwhile (`previewRebalance`), because a set that visibly sums
   * to 97 for the length of a gesture reads as the rule being broken rather than as a request
   * not yet made. The server's answer then replaces the preview, and is the only thing any of
   * it is ever scored from.
   */
  /**
   * **The value comes from the input, never from state.** The DOM node always holds what the
   * pointer left there, whatever React has rendered -- so a release that lands before the
   * re-render after the drag still sends the weight the reader chose, rather than the one the
   * previous render saw and deciding nothing moved.
   */
  function commit(asked: string) {
    // A release with no movement before it, or the same release arriving again -- its answer
    // ends the gesture, so this does not -- or one while a write is in flight, which no gesture
    // can have started: the slider takes no movement then.
    if (!unreleased.current || saving) return;
    unreleased.current = false;
    setMoving(false);
    // A range input always holds a number, so this never fires -- it is here because
    // `weightFrom` is honest about text that might not be one, and silently sending `NaN`
    // would be worse than doing nothing.
    const moved = weightFrom(asked);
    if (moved === null || moved === weight.weight) {
      // Nothing is sent, so no answer is coming to replace the preview: this is the one
      // release that has to end the gesture itself.
      onDragEnd();
      return;
    }
    void onMove(weight.pillar, moved);
  }

  /**
   * The four ways a weight gesture ends: a pointer lifts, a mouse lifts, a key comes up after
   * the arrow keys moved it, or focus leaves with the drag unfinished. One handler, because
   * they are one event -- "the reader has stopped moving this" -- and four inline arrows would
   * be four functions saying the same sentence.
   */
  const release = (event: { currentTarget: { value: string } }) =>
    commit(event.currentTarget.value);

  const meta =
    count === undefined
      ? weight.weight_locked
        ? "held at this weight"
        : "moves on a rebalance"
      : describePillarCount(count, unsourcedShare);

  return (
    <>
      {/* **A group, named for its pillar.** The row holds three controls that are all about
          one pillar -- the slider, the reading, the lock -- and saying so is what lets a
          reader and a test find "economics" rather than "the fifth row". */}
      <div
        className="weight-row"
        role="group"
        aria-label={pillarName(names, weight.pillar)}
        // An attribute, as the source rows' drag states are: state a test can read (PL-114).
        data-open={open ? "true" : undefined}
      >
        {/* **The name is the way in.** A criterion's weight is a share of its pillar's, so
          opening the pillar is what reveals the attributes it is shared among. */}
        {onOpen === undefined ? (
          <span className="weight-row__name">
            <span className="weight-row__label">
              {pillarName(names, weight.pillar)}
            </span>
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
              {pillarName(names, weight.pillar)}
            </span>
            <span className="weight-row__meta">{meta}</span>
          </button>
        )}

        {/* **Held while a write is in flight, never disabled** (NEW-34). Chromium throws focus
            off a control the moment it is disabled and does not give it back, so a keyboard
            user nudging a weight was put back on the page after every step. Held, the slider
            keeps focus, says so, and ignores the keys: React puts the thumb back. */}
        <input
          className="weight-row__slider"
          type="range"
          min={PILLAR_SLIDER.min}
          max={ceiling}
          step={PILLAR_SLIDER.step}
          value={typed}
          aria-disabled={saving || undefined}
          aria-label={`${pillarName(names, weight.pillar)} weight`}
          onChange={(event) => {
            if (saving) return;
            unreleased.current = true;
            setMoving(true);
            setTyped(event.target.value);
            // The panel is told as well as this row, because it is the only thing that knows
            // what the other ten weights are and which of them are locked.
            onDrag(event.target.value);
          }}
          onPointerUp={release}
          onMouseUp={release}
          onKeyUp={release}
          onBlur={release}
        />

        <span className="weight-row__value">
          {weightReading(moving ? typed : shown)}
        </span>

        {/* **A button, not a checkbox.** A padlock, shut or open (NEW-68), and a native
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
          aria-label={`Lock ${pillarName(names, weight.pillar)}`}
          aria-pressed={weight.weight_locked}
          // Held, not disabled, for the slider's reason; `lock` refuses the press meanwhile.
          aria-disabled={saving || undefined}
          title={lockTitle(weight.weight_locked)}
          onClick={() =>
            void onLock(weight.pillar, !weight.weight_locked)
          }
        >
          <LockIcon locked={weight.weight_locked} />
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
