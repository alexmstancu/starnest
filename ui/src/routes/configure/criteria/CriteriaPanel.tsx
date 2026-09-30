import { useId } from "react";
import { NavLink } from "react-router-dom";
import type { Criterion, CriterionRule } from "../../../api/endpoints";
import { lockedAttributes } from "../../../api/errorPresentation";
import { formatPercentage } from "../../../format/display";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { useEffect, useRef, useState } from "react";
import type { CriteriaEditor } from "../useCriteriaEditor";
import {
  CRITERION_CEILING_FLOOR,
  CRITERION_SLIDER,
  sliderCeiling,
  totalsByPillar,
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
 * is the server's (`arch.md` 8.3), and duplicating it here would put a second, quietly
 * different answer in front of the user.
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
  const headingId = useId();
  const shown =
    pillar === undefined
      ? editor.criteria
      : editor.criteria.filter((criterion) => criterion.pillar === pillar);
  const ceiling = sliderCeiling(shown.length, CRITERION_CEILING_FLOOR);

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

      <PillarTotals criteria={shown} />

      {editor.saveError !== null && <SaveFailure error={editor.saveError} />}

      {shown.length === 0 ? (
        <p className="screen__note">This criteria set has no criteria.</p>
      ) : (
        <div className="criterion-rows">
          {shown.map((criterion) => (
            <CriterionRow
              key={criterion.attribute}
              criterion={criterion}
              attribute={catalog?.get(criterion.attribute)}
              ceiling={ceiling}
              saving={editor.savingAttribute === criterion.attribute}
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
function PillarTotals({ criteria }: { criteria: readonly Criterion[] }) {
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
          {each.pillar} {formatPercentage(each.total)}
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
  attribute,
  ceiling,
  saving,
  onSave,
  onSetLock,
  onSaveRule,
}: {
  criterion: Criterion;
  /** The catalog's entry, or undefined while the catalog is still in flight. */
  attribute?: CatalogAttribute;
  ceiling: number;
  saving: boolean;
  onSave: (attribute: string, weight: number) => void;
  onSetLock: (attribute: string, weightLocked: boolean) => void;
  onSaveRule: (attribute: string, rule: CriterionRule) => void;
}) {
  // Zero where the server sent no weight at all, which it never does -- `weight` is required
  // on `Criterion` and optional only in the generated type. A slider has no way to show
  // "unset", so the fallback is the one value that moves nothing until it is dragged.
  const stored = String(criterion.weight ?? 0);
  const [typed, setTyped] = useState(stored);
  // True only between the first move and letting go. **The reading follows the stored weight
  // the rest of the time**: a range input snaps its value to the step, and a rebalance
  // produces 29.17, so a readout taken from the slider would print 29.0 for a weight the
  // server holds at 29.17 -- the screen contradicting the response it just rendered.
  const [moving, setMoving] = useState(false);
  // Closed by default: forty-one criteria with their scales open at once is a screen nobody
  // can read. Local state, because which row is open is this component's own business and
  // nothing outside it needs to know.
  const [editingRule, setEditingRule] = useState(false);
  const rule = useCriterionRule(criterion, saving, onSaveRule);

  // A rebalance moves this row's weight without this row having been dragged, and a refused
  // change leaves it exactly where it was. Either way the slider follows the stored weight --
  // without this, the criteria that absorbed a change would keep showing the weights they had
  // before it, the screen contradicting the response it just rendered the total from.
  useEffect(() => setTyped(stored), [stored]);

  // A refused change leaves the stored weight exactly where it was, so `stored` never
  // changes and the effect above never fires -- the slider would sit at the position the
  // server refused. It goes back once the attempt is over, because the position of the thumb
  // is what a reader takes for the weight being scored.
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving) setTyped(stored);
    wasSaving.current = saving;
  }, [saving, stored]);

  /**
   * **Dragging shows; letting go sends.** A range input has no "committed" event -- `change`
   * fires on every pixel of the drag -- so a naive binding would PATCH the server forty times
   * for one gesture, and every answer would rebalance the rest of the pillar under the thumb.
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
    if (moved === null || moved === criterion.weight) return;
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

  const typeLine = describeValueType(attribute?.value_type, attribute?.unit);
  const title = titleOf(criterion.attribute, attribute);
  const locked = criterion.weight_locked ?? false;

  return (
    <div className="criterion-row" role="group" aria-label={criterion.attribute}>
      <div className="criterion-row__head">
        <span className="criterion-row__what">
          <span className="criterion-row__name">{title.name}</span>
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
            disabled={saving}
            aria-label={`Weight for ${criterion.attribute}`}
            onChange={(event) => {
              setMoving(true);
              setTyped(event.target.value);
            }}
            onPointerUp={release}
            onMouseUp={release}
            onKeyUp={release}
            onBlur={release}
          />

          <span className="criterion-row__value">
            {weightReading(moving ? typed : stored)}
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
            aria-label={`Lock the weight for ${criterion.attribute}`}
            aria-pressed={locked}
            disabled={saving}
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
          width={weightBarWidth(criterion.weight)}
          height="4"
        />
      </svg>

      {/* The rule in words, under the weight it earns. Everything here is stored on the
          criterion or the catalog, and the disclosure below is where it is changed. */}
      <ul className="criterion-row__chips" aria-label={`Rule for ${criterion.attribute}`}>
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
        {editingRule ? "Close" : "Edit"} the rule for {criterion.attribute}
      </button>
      {editingRule && (
        <CriterionRuleFields
          form={rule}
          attribute={criterion.attribute}
          saving={saving}
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
function SaveFailure({ error }: { error: unknown }) {
  const locked = lockedAttributes(error);

  return (
    <div className="save-failure">
      <ErrorNotice error={error} />
      {locked.length > 0 && (
        <>
          <p className="screen__note" id="lock-list-heading">
            Locked, so unable to absorb the change:
          </p>
          {/* Named, because these attribute ids also appear in the rows above: a reader
              arriving at the list out of context needs to be told which one it is. */}
          <ul className="lock-list" aria-labelledby="lock-list-heading">
            {locked.map((attribute) => (
              <li key={attribute}>
                <code>{attribute}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
