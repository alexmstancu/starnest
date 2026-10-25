import { ApiError, CLIENT_ERROR_CODES, isApiError } from "../../api/ApiError";

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
 * A write whose answer was lost and whose read-back could not say either -- it failed, or never
 * answered. **What it did is still unknown**, so the writer lists it unconfirmed with `check`,
 * which reads back again: true when it took effect, false when it did not, throwing while the
 * server still cannot say.
 */
export class UnconfirmedWrite extends Error {
  readonly check: () => Promise<boolean>;

  constructor(check: () => Promise<boolean>) {
    super("The write's answer was lost, and reading it back could not say whether it took effect.");
    this.name = "UnconfirmedWrite";
    this.check = check;
  }
}

/** A read-back of what a write did: what it would have answered, or null if it did not land. */
export type ReadBack<Answer> = (signal: AbortSignal) => Promise<Answer | null>;

/**
 * Sends a write, and **reads back what actually happened when its answer is lost**: the answer
 * the write would have given when the read-back shows it took effect, so the screen and the
 * history record it; the original failure when it did not. When the read-back cannot say
 * either, `UnconfirmedWrite` -- never a guess.
 */
export async function settled<Answer>(
  send: () => Promise<Answer>,
  readBack: ReadBack<Answer>,
): Promise<Answer> {
  try {
    return await send();
  } catch (error) {
    if (!outcomeUnknown(error)) throw error;
    let landed: Answer | null;
    try {
      landed = await withPatience(readBack);
    } catch {
      throw new UnconfirmedWrite(async () => (await withPatience(readBack)) !== null);
    }
    if (landed === null) throw error;
    return landed;
  }
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
