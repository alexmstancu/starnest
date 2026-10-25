/**
 * A start in flight, kept by the page rather than by the screen that sent it (P94, PL-118).
 *
 * **A start outlives the screen that sent it.** The request goes on when the reader leaves
 * Acquire, and a screen mounted again knew nothing of it: it offered Start beside the previous
 * run, and the server refused the second start as in flight. Kept here, every Acquire mounted in
 * this page holds every way to start until the start has ended, however it ends -- the screen
 * that sent it clears it in a `finally`.
 *
 * **An outcome nobody was there to see is left here** for the next Acquire mounted: the run
 * that began, to show, or the refusal, to report once (D33). Per tab, as module state is: the
 * database's one-run-at-a-time guard still decides between two tabs. Module state follows
 * `api/setWrites.ts`, and is forgotten between tests in `test-setup.ts`.
 */

export type StartOutcome = { started: number } | { refused: unknown };

let inFlight = false;
let left: StartOutcome | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

export function subscribeToStarts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a start has been sent and has not yet ended. */
export function startInFlight(): boolean {
  return inFlight;
}

/** Whether an outcome is waiting for an Acquire to take it. */
export function startOutcomeLeft(): boolean {
  return left !== null;
}

export function beginStart(): void {
  inFlight = true;
  changed();
}

export function endStart(): void {
  inFlight = false;
  changed();
}

/** Leaves what became of a start whose screen had gone, for the next one to take. */
export function leaveStartOutcome(outcome: StartOutcome): void {
  left = outcome;
  changed();
}

/** Takes the outcome left, once: whoever takes it is the one who reports it. */
export function takeStartOutcome(): StartOutcome | null {
  const outcome = left;
  left = null;
  if (outcome !== null) changed();
  return outcome;
}

export function forgetPendingStart(): void {
  inFlight = false;
  left = null;
}
