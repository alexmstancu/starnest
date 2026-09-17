import { useCallback, useEffect, useState, type FormEvent } from "react";
import { updatePillarWeight, type CriteriaSet } from "../../../api/endpoints";
import type { components } from "../../../api/schema";
import { formatPercentage } from "../../../format/display";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { totalOf, weightFrom } from "../weights";

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
}: {
  criteriaSet: CriteriaSet;
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

  return (
    <section className="panel" aria-labelledby="pillar-weights-heading">
      <h3 id="pillar-weights-heading" className="panel__heading">
        Pillar weights
      </h3>
      <p className="panel__hint">
        What each pillar is worth within the level. They sum to{" "}
        {formatPercentage(total, 0)}; moving one rebalances the rest, which the
        server computes.
      </p>

      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does not
          perform. */}
      {failure !== null && <ErrorNotice error={failure} />}

      {weights.length === 0 ? (
        <p className="screen__note">This set weighs no pillar yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Pillar</th>
              <th scope="col">Weight</th>
              <th scope="col">Locked</th>
            </tr>
          </thead>
          <tbody>
            {weights.map((weight) => (
              <PillarRow key={weight.pillar} weight={weight} onMove={move} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PillarRow({
  weight,
  onMove,
}: {
  weight: PillarWeight;
  onMove: (pillar: string, weight: number, locked?: boolean) => Promise<void>;
}) {
  const stored = String(weight.weight);
  const [typed, setTyped] = useState(stored);
  const [notANumber, setNotANumber] = useState(false);

  // A rebalance moves this row's weight without this row having been edited, so the input
  // follows the stored weight. Without this, the two pillars that absorbed a change would keep
  // showing the weights they had before it -- the screen contradicting the response it just
  // rendered the total from.
  useEffect(() => setTyped(stored), [stored]);

  function submit(event: FormEvent) {
    event.preventDefault();
    // A weight that is not a number is not sent: the server would refuse it, and the refusal
    // would be about parsing rather than about weights (`weights.ts`). **But it is reported**
    // (P56): this used to `return` in silence, so typing `ten` and pressing Set did nothing
    // at all, with nothing on screen saying the value had been rejected. The criterion rows
    // beside these already say it, in these words.
    const asked = weightFrom(typed);
    setNotANumber(asked === null);
    if (asked === null) return;
    void onMove(weight.pillar, asked);
  }

  return (
    <tr>
      <th scope="row">{weight.pillar}</th>
      <td>
        <form onSubmit={submit}>
          <label>
            <span className="visually-hidden">{weight.pillar} weight</span>
            <input
              className="field__control field__control--narrow"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <button type="submit" className="button">
            Set
          </button>
          {notANumber && (
            <p className="weight-form__problem" role="alert">
              A weight must be a number.
            </p>
          )}
        </form>
      </td>
      <td>
        <label className="toggle">
          <input
            type="checkbox"
            checked={weight.weight_locked}
            onChange={(event) =>
              void onMove(weight.pillar, weight.weight, event.target.checked)
            }
          />
          <span className="visually-hidden">Lock {weight.pillar}</span>
        </label>
      </td>
    </tr>
  );
}
