import { useCallback, useState } from "react";
import { hasErrorCode } from "../api/ApiError";
import { deleteEvaluation } from "../api/endpoints";

/** Where a deletion stands: not asked, asked and waiting for a yes, or sent. */
export type DiscardStep = "idle" | "confirming" | "deleting";

/**
 * Deleting one saved ranking behind a confirmation (D47), kept out of its markup.
 *
 * **A 404 is the outcome asked for, not a fault.** The ranking is gone either way -- deleted
 * from another tab since the list was read -- so the list catches up and says so, rather than
 * offering to try again something that can never succeed.
 */
export function useDiscardSaved(
  evaluationId: number,
  onGone: (alreadyGone: boolean) => void,
) {
  const [step, setStep] = useState<DiscardStep>("idle");
  const [failure, setFailure] = useState<unknown>(null);

  const ask = useCallback(() => {
    setFailure(null);
    setStep("confirming");
  }, []);

  const callOff = useCallback(() => {
    setFailure(null);
    setStep("idle");
  }, []);

  const discard = useCallback(async () => {
    // One deletion per press: a second press while the first is in flight is held.
    if (step === "deleting") return;
    setStep("deleting");
    setFailure(null);
    try {
      await deleteEvaluation(evaluationId);
      onGone(false);
    } catch (error) {
      if (hasErrorCode(error, "not_found")) {
        onGone(true);
        return;
      }
      setFailure(error);
      setStep("confirming");
    }
  }, [evaluationId, onGone, step]);

  return { step, failure, ask, callOff, discard };
}
