import { CLIENT_ERROR_CODES, isApiError } from "../../api/ApiError";

/**
 * A write whose answer never came back (PL-033): the server may have committed it or not, and
 * nothing in the failure says which.
 */
export function outcomeUnknown(error: unknown): boolean {
  return isApiError(error) && error.code === CLIENT_ERROR_CODES.unreachable;
}

/**
 * Sends a write, and **reads back what actually happened when its answer is lost**: the answer
 * the write would have given when the read-back shows it took effect, so the screen and the
 * history record it; the original failure when it did not, or when the read-back cannot say.
 */
export async function settled<Answer>(
  send: () => Promise<Answer>,
  readBack: () => Promise<Answer | null>,
): Promise<Answer> {
  try {
    return await send();
  } catch (error) {
    if (!outcomeUnknown(error)) throw error;
    const landed = await readBack().catch(() => null);
    if (landed === null) throw error;
    return landed;
  }
}
