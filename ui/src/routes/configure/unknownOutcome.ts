import { ApiError, CLIENT_ERROR_CODES, isApiError } from "../../api/ApiError";
import { OverdueWrite } from "../../api/client";

/** How long a read is waited for before it counts as not having answered (PL-033). */
export const READ_PATIENCE_MS = 10_000;

/**
 * A write whose answer never came back (PL-033): the server may have committed it or not, and
 * nothing in the failure says which.
 */
export function outcomeUnknown(error: unknown): boolean {
  return isApiError(error) && error.code === CLIENT_ERROR_CODES.unreachable;
}

/**
 * A write whose outcome is still unknown (PL-033): its answer was lost and reading it back could
 * not say, or it was still running when the client stopped waiting for it. The writer lists it
 * unconfirmed; `readAgain` says what it did -- what it would have answered if it took effect,
 * null if it did not, throwing while that still cannot be said -- and `settles`, when the request
 * is still running, settles as it does, so the entry can be resolved then.
 */
export class UnconfirmedWrite extends Error {
  readonly readAgain: () => Promise<unknown>;
  readonly settles: Promise<unknown> | undefined;

  constructor(readAgain: () => Promise<unknown>, settles?: Promise<unknown>) {
    super("Whether the write took effect is not known yet.");
    this.name = "UnconfirmedWrite";
    this.readAgain = readAgain;
    this.settles = settles;
  }
}

/** What an unconfirmed change carries into Recent changes. */
export interface Pending {
  unconfirmed: () => Promise<boolean>;
  settles?: Promise<unknown>;
}

/**
 * How an unconfirmed change is resolved (PL-033): reading back again and, **when the write took
 * effect, showing it as an answered write would** -- to whatever shows its set now -- so a
 * confirmation never leaves the screen showing the state before it. With `settles`, the history
 * resolves it by itself once the request does.
 */
export function pendingEntry<Answer>(
  error: UnconfirmedWrite,
  show: (answer: Answer) => void,
): Pending {
  const unconfirmed = async () => {
    const landed = (await error.readAgain()) as Answer | null;
    if (landed !== null) show(landed);
    return landed !== null;
  };
  return error.settles === undefined ? { unconfirmed } : { unconfirmed, settles: error.settles };
}

/**
 * An undo whose outcome is not known yet (P105): its answer was lost and could not be read back,
 * or it was still running when the client stopped waiting for it. `pending` is what the history
 * lists the change with meanwhile -- its read-back answers whether **the change is still in
 * force**, which is the question the history asks of every unconfirmed entry.
 */
export class UnconfirmedUndo extends Error {
  readonly pending: Pending;

  constructor(pending: Pending) {
    super("Whether the undo took effect is not known yet.");
    this.name = "UnconfirmedUndo";
    this.pending = pending;
  }
}

/**
 * Sends a change back, as an undo does (P105): **an undo's answer can be lost as a write's can**,
 * so it is read back the same way (`settled`) and shown only once it is known to have landed.
 * When nobody can yet say, `UnconfirmedUndo` -- never a failure, which would leave the change
 * listed as in force while its undo may still land, and its set free to be written over.
 */
export async function settledUndo<Answer>(
  send: () => Promise<Answer>,
  readBack: ReadBack<Answer>,
  show: (answer: Answer) => void,
): Promise<void> {
  let answer: Answer;
  try {
    answer = await settled(send, readBack);
  } catch (error) {
    if (!(error instanceof UnconfirmedWrite)) throw error;
    const stillInForce = async () => {
      const landed = (await error.readAgain()) as Answer | null;
      if (landed !== null) show(landed);
      return landed === null;
    };
    throw new UnconfirmedUndo(
      error.settles === undefined
        ? { unconfirmed: stillInForce }
        : { unconfirmed: stillInForce, settles: error.settles },
    );
  }
  show(answer);
}

/** A read-back of what a write did: what it would have answered, or null if it did not land. */
export type ReadBack<Answer> = (signal: AbortSignal) => Promise<Answer | null>;

/**
 * Sends a write, and **reads back what actually happened when its answer is lost**: the answer
 * the write would have given when the read-back shows it took effect, so the screen and the
 * history record it; the original failure when it did not. When the read-back cannot say
 * either, `UnconfirmedWrite` -- never a guess.
 *
 * **A write still running is never read back** (`OverdueWrite`): it may land after any read, so
 * no read taken meanwhile can say it did not. It is unconfirmed until its own request settles.
 */
export async function settled<Answer>(
  send: () => Promise<Answer>,
  readBack: ReadBack<Answer>,
): Promise<Answer> {
  try {
    return await send();
  } catch (error) {
    if (!outcomeUnknown(error)) throw error;
    if (error instanceof OverdueWrite) {
      throw new UnconfirmedWrite(onceSettled(error.late, readBack), error.late);
    }
    let landed: Answer | null;
    try {
      landed = await withPatience(readBack);
    } catch {
      throw new UnconfirmedWrite(() => withPatience(readBack));
    }
    if (landed === null) throw error;
    return landed;
  }
}

/**
 * What a write still running did, **decided only once it has settled**: refused, it did nothing;
 * answered, or lost after all, a read taken after it settled says what it did.
 */
function onceSettled<Answer>(late: Promise<unknown>, readBack: ReadBack<Answer>) {
  let outcome: { settled: false } | { settled: true; refusal: unknown } = { settled: false };
  late.then(
    () => (outcome = { settled: true, refusal: null }),
    (error: unknown) =>
      (outcome = { settled: true, refusal: outcomeUnknown(error) ? null : error }),
  );
  return async (): Promise<Answer | null> => {
    if (!outcome.settled) {
      throw new ApiError({
        code: CLIENT_ERROR_CODES.unreachable,
        message: "It has still not answered, so whether it took effect is still not known.",
      });
    }
    if (outcome.refusal !== null) return null;
    return withPatience(readBack);
  };
}

/**
 * A read that is given up on after `READ_PATIENCE_MS`, as one that failed: a read-back that never
 * answered would otherwise hold Configure's one write in flight for ever.
 */
export async function withPatience<Answer>(
  read: (signal: AbortSignal) => Promise<Answer>,
): Promise<Answer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const givenUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new ApiError({
          code: CLIENT_ERROR_CODES.unreachable,
          message: "Reading back what a change did was asked for and did not come back.",
        }),
      );
    }, READ_PATIENCE_MS);
  });
  try {
    return await Promise.race([read(controller.signal), givenUp]);
  } finally {
    clearTimeout(timer);
  }
}
