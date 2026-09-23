/**
 * The two questions to answer before a comparison can be read.
 *
 * **They sit above the lists, not under the table.** What a cell shows and what a difference
 * is measured in decide how every number below reads, so answering them afterwards means
 * re-reading everything; and each carries the sentence that says what the choice means,
 * because "weighted impact" is not self-explaining to somebody who has not met it.
 */
export function ViewChoices({
  shownAs,
  onShownAs,
  measure,
  onMeasure,
}: {
  shownAs: "score" | "raw";
  onShownAs: (how: "score" | "raw") => void;
  measure: "points" | "impact";
  onMeasure: (how: "points" | "impact") => void;
}) {
  return (
    <>
      <div className="choice">
        <fieldset className="field">
          <legend className="field__label">Show attribute values as</legend>
          <div className="toggle-group">
            <label className="toggle">
              <input
                type="radio"
                name="shown-as"
                checked={shownAs === "score"}
                onChange={() => onShownAs("score")}
              />
              Score 0–100
            </label>
            <label className="toggle">
              <input
                type="radio"
                name="shown-as"
                checked={shownAs === "raw"}
                onChange={() => onShownAs("raw")}
              />
              Raw figures
            </label>
          </div>
        </fieldset>
        <p className="choice__meaning">
          {shownAs === "score"
            ? "Everything on one 0–100 scale, so pillars and attributes can be read side by side."
            : "Each figure as its publisher issued it, in its own unit — which is what a source can be checked against."}
        </p>
      </div>

      <div className="choice">
        <fieldset className="field">
          <legend className="field__label">Measure differences in</legend>
          <div className="toggle-group">
            <label className="toggle">
              <input
                type="radio"
                name="measure"
                checked={measure === "points"}
                onChange={() => onMeasure("points")}
              />
              Score points
            </label>
            <label className="toggle">
              <input
                type="radio"
                name="measure"
                checked={measure === "impact"}
                onChange={() => onMeasure("impact")}
              />
              Weighted impact
            </label>
          </div>
        </fieldset>
        <p className="choice__meaning">
          {measure === "points"
            ? "Raw pillar scores on 0–100, ignoring how much each pillar is weighted."
            : "What each difference is worth to the total, which is the gap times the pillar's weight — a large gap on a small pillar moves little."}
        </p>
      </div>
    </>
  );
}
