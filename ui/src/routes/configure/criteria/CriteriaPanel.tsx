import { useId } from "react";
import { usePillarNames, type PillarNames } from "../../../api/usePillarNames";
import { NavLink } from "react-router-dom";
import type { Criterion, CriterionRule } from "../../../api/endpoints";
import { lockedAttributes } from "../../../api/errorPresentation";
import { formatPercentage, pillarName } from "../../../format/display";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { useEffect, useRef, useState } from "react";
import type { CriteriaEditor } from "../useCriteriaEditor";
import { useWeightDrag } from "../useWeightDrag";
import {
  CRITERION_CEILING_FLOOR,
  CRITERION_SLIDER,
  previewedCriteria,
  sliderCeiling,
  totalsByPillar,
  weightedCriteria,
  weightFrom,
  weightReading,
} from "../weights";
import {
  chipsFor,
  titleOf,
  describeValueType,
  hasNoSource,
  weightBarWidth,
  type AttributeCatalog,
  type CatalogAttribute,
  type ChipTone,
} from "./criterionReading";
import { CriterionRuleFields } from "./CriterionRuleFields";
import { useCriterionRule } from "./useCriterionRule";

/**
 * The inner half of the two-level weighting: what each criterion is worth within its pillar.
 *
 * **The screen sends one weight and re-renders from the response.** Weights sum to 100 within
 * a pillar, and which siblings absorb a change depends on which are locked -- that arithmetic
 * is the server's (`arch.md` 8.3), and the figure a row keeps is always the one that came back.
 * While a pointer is down the rows show a preview of it (`useWeightDrag`), because one request
 * goes and a gesture lasts longer than one request: it is drawn from the same rule, it is
 * stored nowhere, and the response overwrites it when the pointer lifts.
 *
 * A refusal is shown rather than absorbed. `409 weights_all_locked` means the weight was not
 * set; a screen that stayed silent would leave the user believing it had been.
 *
 * **A block per attribute, not a table row.** A criterion is a rule with half a dozen parts,
 * and a table forces each part into a column of its own -- which makes the goal, the threshold
 * and the method look like three independent facts rather than one sentence about one
 * attribute. The block says the name, then the rule, then the weight, in that order.
 */
export function CriteriaPanel({
  editor,
  pillar,
  catalog,
}: {
  editor: CriteriaEditor;
  /**
   * The one pillar to show, when the panel is opened from inside a pillar's row.
   *
   * **Without it the panel is every criterion in the set**, which is how a criteria set is
   * read whole; with it, the panel is the inside of one pillar, which is how a weight is
   * changed. The same rows either way -- the difference is which question is being asked.
   */
  pillar?: string;
  /** The catalog, for what each attribute measures and whether anything would answer it. */
  catalog?: AttributeCatalog;
}) {
  const names = usePillarNames();
  const headingId = useId();
  const shown =
    pillar === undefined
      ? editor.criteria
      : editor.criteria.filter((criterion) => criterion.pillar === pillar);
  const ceiling = sliderCeiling(shown.length, CRITERION_CEILING_FLOOR);
  // Destructured, because `ended` is listed as a dependency below and `react-hooks` reads a
  // name rather than a member expression. `useWeightDrag` keeps it stable for exactly that.
  const { preview, previewFor, moveTo, ended } = useWeightDrag();

  /**
   * **The siblings that absorb a change are the ones in the criterion's own pillar.**
   *
   * A criterion's weight is a share of its pillar's hundred, so a preview taken over the whole
   * set would share one change out across eleven of them. Read from the editor rather than from
   * `shown`, which is one pillar only when the panel was opened inside one.
   */
  const siblingsOf = (criterion: Criterion) =>
    weightedCriteria(
      editor.criteria.filter((each) => each.pillar === criterion.pillar),
    );

  /**
   * **The gesture ends when the save it started does**, not when the pointer lifted: dropping
   * the preview on release would send the siblings back to their stored weights for the length
   * of a round trip and then forward again to nearly the same figures. A refusal ends it too,
   * and then the rows are back where they were with the notice saying why.
   *
   * On the falling edge, so that the one thing this must never do -- clear a preview mid-drag,
   * which would quietly turn the whole feature off -- cannot happen however often it runs.
   */
  const wasSaving = useRef(false);
  useEffect(() => {
    const saving = editor.savingAttribute !== null;
    if (wasSaving.current && !saving) ended();
    wasSaving.current = saving;
  }, [editor.savingAttribute, ended]);

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        {pillar === undefined ? "Criteria" : "Attribute weights inside this pillar"}
      </h3>
      <p className="panel__hint">
        Weights are percentages within a pillar. Changing one rebalances the
        others, which the backend computes and this panel reports. A
        criterion&apos;s rule — its goal, scale and threshold — is edited per
        row, and moves no weight.
      </p>
      <p className="panel__hint">
        A locked weight is held where it is and takes no share of a rebalance.
        Lock everything in a pillar and there is nowhere left for a change to
        go, which the backend refuses rather than silently absorbing.
      </p>

      <PillarTotals
        names={names}
        criteria={previewedCriteria(shown, preview)}
      />

      {editor.saveError !== null && (
        <SaveFailure error={editor.saveError} catalog={catalog} />
      )}

      {shown.length === 0 ? (
        <p className="screen__note">This criteria set has no criteria.</p>
      ) : (
        <div className="criterion-rows">
          {shown.map((criterion) => (
            <CriterionRow
              key={criterion.attribute}
              criterion={criterion}
              previewed={previewFor(criterion.attribute)}
              attribute={catalog?.get(criterion.attribute)}
              ceiling={ceiling}
              savingWeight={editor.savingAttribute === criterion.attribute}
              savingRule={editor.savingRuleFor === criterion.attribute}
              onDrag={(asked) =>
                moveTo(siblingsOf(criterion), criterion.attribute, asked)
              }
              onDragEnd={ended}
              onSave={editor.setWeight}
              onSetLock={editor.setLock}
              onSaveRule={editor.setRule}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * What each pillar's criteria currently come to.
 *
 * **Criterion weights sum to 100 within a pillar** (`reqs.md` 3.4). The server enforces it by
 * rebalancing; showing the total back lets a reader watch the rule hold instead of taking it
 * on trust -- and makes a pillar that has drifted visible rather than merely wrong.
 */
function PillarTotals({
  names,
  criteria,
}: {
  names: PillarNames;
  /** The weights as the rows are showing them, preview and all, or the chip contradicts them. */
  criteria: readonly { pillar: string; weight?: number }[];
}) {
  const totals = totalsByPillar(criteria);
  if (totals.length === 0) return null;

  return (
    <ul className="pillar-totals" aria-label="Weight totals by pillar">
      {totals.map((each) => (
        <li
          key={each.pillar}
          className={
            each.balanced
              ? "chip chip--accent"
              : "chip chip--not_matching"
          }
        >
          {pillarName(names, each.pillar)} {formatPercentage(each.total)}
        </li>
      ))}
    </ul>
  );
}

/** Which chip class each tone is drawn in. The tone is the meaning; this is the tint. */
const CHIP_CLASS: Record<ChipTone, string> = {
  accent: "chip chip--accent",
  neutral: "chip chip--neutral",
  required: "chip chip--required",
  warning: "chip chip--warning",
};

function CriterionRow({
  criterion,
  previewed,
  attribute,
  ceiling,
  savingWeight,
  savingRule,
  onDrag,
  onDragEnd,
  onSave,
  onSetLock,
  onSaveRule,
}: {
  criterion: Criterion;
  /**
   * What this criterion would weigh if the drag in progress were let go -- and nothing when
   * there is no drag, when the locks leave it no room, or when this is the row being dragged,
   * which shows the pointer instead.
   */
  previewed?: number;
  /** The catalog's entry, or undefined while the catalog is still in flight. */
  attribute?: CatalogAttribute;
  ceiling: number;
  /**
   * **Two flags, because two things revert** (P82). The slider goes back to the stored weight
   * when a weight save ends, and the rule fields go back to the stored rule when a *rule*
   * save ends. One flag served both, and `savingAttribute` is set by every save on the row --
   * so dragging a weight silently discarded an unsent rule edit beside it.
   */
  savingWeight: boolean;
  savingRule: boolean;
  /** The pointer has moved this weight, to the value the slider now holds. */
  onDrag: (asked: string) => void;
  /** Nothing is being sent, so no answer is coming to end the gesture. */
  onDragEnd: () => void;
  onSave: (attribute: string, weight: number) => void;
  onSetLock: (attribute: string, weightLocked: boolean) => void;
  onSaveRule: (attribute: string, rule: CriterionRule) => void;
}) {
  // Zero where the server sent no weight at all, which it never does -- `weight` is required
  // on `Criterion` and optional only in the generated type. A slider has no way to show
  // "unset", so the fallback is the one value that moves nothing until it is dragged.
  const stored = String(criterion.weight ?? 0);
  // What the row shows: a preview while another criterion in the pillar is being dragged, the
  // stored weight the rest of the time. **The stored weight is still what `commit` compares
  // against** -- a guard measured against the preview would find the pointer already there and
  // send nothing at all.
  const shown = previewed === undefined ? stored : String(previewed);
  const [typed, setTyped] = useState(stored);
  // True only between this row's first move and letting go. **The reading follows what the row
  // is shown the rest of the time** -- the stored weight, or a preview while another row is
  // being dragged: a range input snaps its value to the step, and a rebalance produces 29.17,
  // so a readout taken from the slider would print 29.0 for a weight that is 29.17 -- the
  // screen contradicting the figure it was given.
  const [moving, setMoving] = useState(false);
  // Closed by default: forty-one criteria with their scales open at once is a screen nobody
  // can read. Local state, because which row is open is this component's own business and
  // nothing outside it needs to know.
  const [editingRule, setEditingRule] = useState(false);
  const rule = useCriterionRule(criterion, savingRule, onSaveRule);

  // A rebalance moves this row's weight without this row having been dragged -- the server's
  // on the way back, the preview's while another row's pointer is down -- and a refused change
  // leaves it exactly where it was. Either way the slider follows what the row shows: without
  // this, the criteria absorbing a change would keep showing the weights they had before it,
  // the screen contradicting the total printed above it.
  useEffect(() => setTyped(shown), [shown]);

  // A refused change leaves the stored weight exactly where it was, so `shown` never
  // changes and the effect above never fires -- the slider would sit at the position the
  // server refused. It goes back once the attempt is over, because the position of the thumb
  // is what a reader takes for the weight being scored.
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !savingWeight) setTyped(shown);
    wasSaving.current = savingWeight;
  }, [savingWeight, shown]);

  /**
   * **Dragging shows the whole rebalance; letting go sends one weight.** A range input has no
   * "committed" event -- `change` fires on every pixel of the drag -- so a naive binding would
   * PATCH the server forty times for one gesture, and every answer would rebalance the rest of
   * the pillar under the thumb. One request still goes, when the pointer lifts; what the rest
   * of the pillar would become is worked out meanwhile (`previewRebalance`), because a pillar
   * that visibly sums to 80 for the length of a gesture reads as the rule being broken rather
   * than as a request not yet made.
   *
   * **The value comes from the input, never from state.** The DOM node always holds what the
   * pointer left there, whatever React has rendered, so a release cannot send the weight the
   * previous render saw.
   */
  function commit(asked: string) {
    setMoving(false);
    // A range input always holds a number, so this never fires -- it is here because
    // `weightFrom` is honest about text that might not be one, and silently sending `NaN`
    // would be worse than doing nothing.
    const moved = weightFrom(asked);
    if (moved === null || moved === criterion.weight) {
      // Nothing is sent, so no answer is coming to replace the preview: this is the one
      // release that has to end the gesture itself.
      onDragEnd();
      return;
    }
    onSave(criterion.attribute, moved);
  }

  /**
   * The four ways a weight gesture ends: a pointer lifts, a mouse lifts, a key comes up after
   * the arrow keys moved it, or focus leaves with the drag unfinished. One handler, because
   * they are one event -- "the reader has stopped moving this" -- and four inline arrows would
   * be four functions saying the same sentence.
   */
  const release = (event: { currentTarget: { value: string } }) =>
    commit(event.currentTarget.value);

  // **The bar and the figure beside it read the same weight**: the pointer's while this row is
  // being dragged, the preview's while another row in the pillar is, the stored one otherwise.
  // A bar left on the stored figure would sit still beside a number that had moved.
  const barWeight = weightFrom(moving ? typed : shown) ?? undefined;
  const typeLine = describeValueType(attribute?.value_type, attribute?.unit);
  const title = titleOf(criterion.attribute, attribute);
  const locked = criterion.weight_locked ?? false;

  return (
    /* **Named for the attribute, never by its id.** The design bars programmatic identifiers
       from rendered text, and an accessible name is rendered text -- it is the only text some
       readers get. `title` is the catalog's name, or the id read as words until it arrives. */
    <div className="criterion-row" role="group" aria-label={title}>
      <div className="criterion-row__head">
        <span className="criterion-row__what">
          <span className="criterion-row__name">{title}</span>
          {/* Empty while the catalog is in flight, and empty for an attribute it has never
              heard of: an empty line is what is true then, and "Unknown type" would not be. */}
          {typeLine !== "" && (
            <span className="criterion-row__type">{typeLine}</span>
          )}
        </span>

        <span className="criterion-row__controls">
          <input
            className="criterion-row__slider"
            type="range"
            min={CRITERION_SLIDER.min}
            max={ceiling}
            step={CRITERION_SLIDER.step}
            value={typed}
            disabled={savingWeight || savingRule}
            aria-label={`Weight for ${title}`}
            onChange={(event) => {
              setMoving(true);
              setTyped(event.target.value);
              // The panel is told as well as this row, because it is the only thing that knows
              // the rest of the pillar and which of it is locked.
              onDrag(event.target.value);
            }}
            onPointerUp={release}
            onMouseUp={release}
            onKeyUp={release}
            onBlur={release}
          />

          <span className="criterion-row__value">
            {weightReading(moving ? typed : shown)}
          </span>

          {/* **A button, not a checkbox.** The design draws a filled or hollow disc, and a
              native checkbox cannot be one without being hidden behind a label -- which is
              the shape that shipped a lock nobody could click (P52). Sent on its own, never
              with the weight: the server refuses to move a locked weight even to the value it
              already holds, so a lock travels alone. */}
          <button
            type="button"
            className={
              locked
                ? "criterion-row__lock criterion-row__lock--on"
                : "criterion-row__lock"
            }
            aria-label={`Lock the weight for ${title}`}
            aria-pressed={locked}
            disabled={savingWeight || savingRule}
            title={
              locked
                ? "Held where it is, and takes no share of a rebalance"
                : "Moves in proportion when another weight changes"
            }
            onClick={() => onSetLock(criterion.attribute, !locked)}
          >
            <span aria-hidden="true">{locked ? "●" : "○"}</span>
          </button>
        </span>
      </div>

      {/* **An SVG, because the geometry is data.** A `<div>` filled to a width would put a
          style attribute in a component, which is what makes a redesign a rewrite; a `rect`
          carries its width as an attribute and its colour as a class. Hidden from the reading
          order because the figure beside it says the same thing in words. */}
      <svg
        className="criterion-row__bar"
        viewBox="0 0 100 4"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect className="criterion-row__track" width="100" height="4" />
        <rect
          className={
            hasNoSource(attribute)
              ? "criterion-row__fill criterion-row__fill--unsourced"
              : "criterion-row__fill"
          }
          width={weightBarWidth(barWeight)}
          height="4"
        />
      </svg>

      {/* The rule in words, under the weight it earns. Everything here is stored on the
          criterion or the catalog, and the disclosure below is where it is changed. */}
      <ul className="criterion-row__chips" aria-label={`Rule for ${title}`}>
        {chipsFor(criterion, attribute).map((chip) => (
          <li key={chip.key} className={CHIP_CLASS[chip.tone]}>
            {/* A chip that names a gap is a link out of it; the rest state the rule and are
                text. A `NavLink` rather than a click handler, so it can be opened in a new
                window and copied -- the gap is worth sending to somebody. */}
            {chip.to === undefined ? (
              chip.text
            ) : (
              <NavLink className="chip__link" to={chip.to}>
                {chip.text}
              </NavLink>
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="action"
        aria-expanded={editingRule}
        onClick={() => setEditingRule((open) => !open)}
      >
        {editingRule ? "Close" : "Edit"} the rule for {title}
      </button>
      {editingRule && (
        <CriterionRuleFields
          form={rule}
          attribute={criterion.attribute}
          title={title}
          saving={savingRule}
        />
      )}
    </div>
  );
}

/**
 * A refused weight change, with the locks that refused it. `details.locked` names them
 * (`openapi.yaml`, `updateCriterion` 409) and they are the only thing the user can act on --
 * "it is locked somewhere" would be a dead end.
 */
function SaveFailure({
  error,
  catalog,
}: {
  error: unknown;
  /** For the names: these ids arrive in the error payload, not from a row on screen. */
  catalog?: AttributeCatalog;
}) {
  const locked = lockedAttributes(error);

  return (
    <div className="save-failure">
      <ErrorNotice error={error} />
      {locked.length > 0 && (
        <>
          <p className="screen__note" id="lock-list-heading">
            Locked, so unable to absorb the change:
          </p>
          {/* Named, because these attributes also appear in the rows above: a reader arriving
              at the list out of context needs to be told which one it is -- by the name those
              rows use, and in the same words. It was `<code>` around the id, which told them
              to go looking for a key that is nowhere on the screen. */}
          <ul className="lock-list" aria-labelledby="lock-list-heading">
            {locked.map((attribute) => (
              <li key={attribute}>{titleOf(attribute, catalog?.get(attribute))}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
