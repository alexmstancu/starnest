import { useSyncExternalStore } from "react";
import { ApiError, CLIENT_ERROR_CODES, isApiError } from "./ApiError";

/**
 * The reads that failed because the server did not answer, for the life of the page (PL-002).
 *
 * **Once anything is answered again, each of them is read again, once** (D3): the server came
 * back, and nobody should have to reload the page to see it. The client notes every answer
 * (`client.ts`); the read hooks register here when their read failed that way, and take the
 * registration back when it is read again or unmounted, so no stale read fires.
 *
 * **Recovery fires on an answer, never on a failure**, so a read that fails again simply waits
 * again: there is no loop. While the server is gone, the shell's poll is the request most
 * likely to see it return.
 *
 * The page's, not a component's, like `setWrites`: the screen draws one card for all of them
 * (P1-06), and its Try again reads every one of them again.
 */

type Retry = () => void;

const waiting = new Set<Retry>();
const listeners = new Set<() => void>();

export function isUnreachable(error: unknown): boolean {
  return isApiError(error) && error.code === CLIENT_ERROR_CODES.unreachable;
}

/** Registers a failed read to be retried once something is answered. Returns its take-back. */
export function whenAnswered(retry: Retry): () => void {
  waiting.add(retry);
  notify();
  return () => {
    if (waiting.delete(retry)) notify();
  };
}

/** Called by the client for every response that came from the server. */
export function noteAnswered(): void {
  retryEveryFailed();
}

/** The screen card's Try again: every read that failed because the server did not answer. */
export function retryEveryFailed(): void {
  if (waiting.size === 0) return;
  const retries = [...waiting];
  waiting.clear();
  notify();
  retries.forEach((retry) => retry());
}

export function hasFailedReads(): boolean {
  return waiting.size > 0;
}

export function subscribeToFailedReads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether any read on the page is waiting for the server, kept current. */
export function useWaitingForServer(): boolean {
  return useSyncExternalStore(subscribeToFailedReads, hasFailedReads);
}

/** What a screen-level card stands for: the server did not answer. */
export const SERVER_DID_NOT_ANSWER = new ApiError({
  code: CLIENT_ERROR_CODES.unreachable,
  message: "The server did not answer.",
});

/** Every test is a page of its own. */
export function forgetFailedReads(): void {
  waiting.clear();
  listeners.clear();
}

function notify(): void {
  listeners.forEach((listener) => listener());
}
