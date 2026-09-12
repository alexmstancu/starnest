import { THE_GOALS, THE_METHODS } from "./criterionForm";
import type { RuleForm } from "./useCriterionRule";

/**
 * The fields that say how one criterion judges its attribute.
 *
 * **Markup only.** What a field means, what it parses to and why it cannot be saved are in
 * `useCriterionRule.ts` and `criterionForm.ts`; this renders a form and reports what it is
 * told (`CLAUDE.md`, markup and behaviour in different files).
 *
 * **It offers no opinion about which combinations are legal.** A band under `percentile` is
 * refused by the server, and reproducing that rule here would put a second, quietly different
 * answer in front of the reader -- the same argument as the weight rebalancing. So every
 * control is always available and the refusal is shown when it comes.
 */
export function CriterionRuleFields({
  form,
  attribute,
  saving,
}: {
  form: RuleForm;
  attribute: string;
  saving: boolean;
}) {
  const problemsId = `rule-problems-${attribute}`;

  return (
    <form
      className="rule-form"
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      <div className="rule-form__row">
        <label className="field" htmlFor={`goal-${attribute}`}>
          Goal
          <select
            id={`goal-${attribute}`}
            className="field__control"
            value={form.draft.goal}
            onChange={(event) => form.set("goal", event.target.value)}
          >
            {THE_GOALS.map((goal) => (
              <option key={goal} value={goal}>
                {goal}
              </option>
            ))}
          </select>
        </label>

        <label className="field" htmlFor={`method-${attribute}`}>
          Normalisation
          <select
            id={`method-${attribute}`}
            className="field__control"
            value={form.draft.normalisation_method}
            onChange={(event) =>
              form.set("normalisation_method", event.target.value)
            }
          >
            {THE_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline" htmlFor={`blocks-${attribute}`}>
          <input
            id={`blocks-${attribute}`}
            type="checkbox"
            checked={form.draft.blocks_if_missing}
            onChange={(event) =>
              form.set("blocks_if_missing", event.target.checked)
            }
          />
          Missing figure blocks scoring
        </label>
      </div>

      <fieldset className="rule-form__group">
        <legend>Target band</legend>
        {/* Outside the legend, because a hint inside one is read out as part of every field's
            name. The same reason the household panel moved its hints out. */}
        <p className="panel__hint" id={`band-hint-${attribute}`}>
          Only used by the target_range goal. The score is full inside the band
          and falls to zero at the points outside it.
        </p>
        <div
          className="rule-form__row"
          aria-describedby={`band-hint-${attribute}`}
        >
          <NumberField
            attribute={attribute}
            name="target_range_min"
            label="Band minimum"
            form={form}
          />
          <NumberField
            attribute={attribute}
            name="target_range_max"
            label="Band maximum"
            form={form}
          />
          <NumberField
            attribute={attribute}
            name="zero_score_below"
            label="Zero below"
            form={form}
          />
          <NumberField
            attribute={attribute}
            name="zero_score_above"
            label="Zero above"
            form={form}
          />
        </div>
      </fieldset>

      <fieldset className="rule-form__group">
        <legend>Scale anchors</legend>
        <p className="panel__hint" id={`anchor-hint-${attribute}`}>
          Used by the fixed method: a figure, the score it maps to, and an
          optional word the band displays as. Two or more, or none.
        </p>
        {form.draft.anchors.length === 0 ? (
          <p className="screen__note">
            No anchors, so this criterion has no fixed scale.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Value</th>
                <th scope="col">Score</th>
                <th scope="col">Label</th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {form.draft.anchors.map((anchor, index) => (
                <tr key={index} className="table__row">
                  <td>
                    <input
                      className="field__control"
                      type="number"
                      step="any"
                      value={anchor.input_value}
                      aria-label={`Anchor ${index + 1} value for ${attribute}`}
                      onChange={(event) =>
                        form.setAnchor(index, "input_value", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="field__control"
                      type="number"
                      step="1"
                      value={anchor.score}
                      aria-label={`Anchor ${index + 1} score for ${attribute}`}
                      onChange={(event) =>
                        form.setAnchor(index, "score", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="field__control"
                      type="text"
                      value={anchor.label}
                      aria-label={`Anchor ${index + 1} label for ${attribute}`}
                      onChange={(event) =>
                        form.setAnchor(index, "label", event.target.value)
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button"
                      onClick={() => form.removeAnchor(index)}
                    >
                      Remove anchor {index + 1}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="button" onClick={form.addAnchor}>
          Add an anchor
        </button>
      </fieldset>

      <fieldset className="rule-form__group">
        <legend>Matching threshold</legend>
        <p className="panel__hint" id={`threshold-hint-${attribute}`}>
          A candidate outside these bounds stops matching, keeping its score.
          Leave both empty for no threshold.
        </p>
        <div
          className="rule-form__row"
          aria-describedby={`threshold-hint-${attribute}`}
        >
          <NumberField
            attribute={attribute}
            name="threshold_min"
            label="Threshold minimum"
            form={form}
          />
          <NumberField
            attribute={attribute}
            name="threshold_max"
            label="Threshold maximum"
            form={form}
          />
        </div>
      </fieldset>

      {form.problems.length > 0 && (
        <ul className="rule-form__problems" id={problemsId} role="alert">
          {form.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <div className="rule-form__actions">
        <button
          type="submit"
          className="button"
          disabled={saving || !form.changed}
        >
          {saving ? "Saving…" : "Save rule"}
        </button>
        <button
          type="button"
          className="button"
          disabled={saving || !form.changed}
          onClick={form.revert}
        >
          Discard changes
        </button>
      </div>
    </form>
  );
}

/** One numeric field of the rule, labelled for a test and for a screen reader alike. */
function NumberField({
  attribute,
  name,
  label,
  form,
}: {
  attribute: string;
  name:
    | "target_range_min"
    | "target_range_max"
    | "zero_score_below"
    | "zero_score_above"
    | "threshold_min"
    | "threshold_max";
  label: string;
  form: RuleForm;
}) {
  const id = `${name}-${attribute}`;

  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        className="field__control"
        type="number"
        step="any"
        value={form.draft[name]}
        onChange={(event) => form.set(name, event.target.value)}
      />
    </label>
  );
}
