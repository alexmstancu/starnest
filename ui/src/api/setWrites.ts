/**
 * The writes to each criteria set that are in flight, for the life of the page (PL-142).
 *
 * **A read of a set is shown only if no write to that set overlapped it** (UIC-A3, RD-2, P99).
 * A read taken before a write committed but answered after it holds the set as it used to be;
 * shown, it put a pillar back at 60 that had just been stored at 70, and a Configure opened
 * again showed a rule off that the server had just switched on. So every write the client
 * sends under a set counts as in flight from the moment it is sent until it settles, whichever
 * way -- answered, refused or lost -- and every read of the set waits while one is, and is
 * read again if one began or settled while it was out.
 *
 * **The page's, not a component's.** A write outlives the panel that sent it -- the set switched
 * away from, the screen left -- and the read it outdates is outdated all the same.
 *
 * A write from another tab is invisible here; nothing in the browser can see it.
 */

import { ApiError, CLIENT_ERROR_CODES } from "./ApiError";

interface Ledger {
  inFlight: number;
  /** Moves whenever a write to the set starts or settles. */
  epoch: number;
  settled: Set<() => void>;
}

/** The key the list of sets is read under: it moves with every set made, renamed or deleted. */
export const EVERY_SET = "*";

const ledgers = new Map<string, Ledger>();

function ledgerOf(key: string): Ledger {
  let ledger = ledgers.get(key);
  if (ledger === undefined) {
    ledger = { inFlight: 0, epoch: 0, settled: new Set() };
    ledgers.set(key, ledger);
  }
  return ledger;
}

/** Counts a write as in flight under each key, until the returned call says it has settled. */
export function beginSetWrite(keys: readonly string[]): () => void {
  const touched = [...new Set(keys)].map(ledgerOf);
  for (const ledger of touched) {
    ledger.inFlight += 1;
    ledger.epoch += 1;
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const ledger of touched) {
      ledger.inFlight -= 1;
      ledger.epoch += 1;
      if (ledger.inFlight === 0) {
        const waiting = [...ledger.settled];
        ledger.settled.clear();
        waiting.forEach((wake) => wake());
      }
    }
  };
}

/** Resolves once no write is in flight under `key`; rejects as the signal aborts. */
export function untilSettled(key: string, signal?: AbortSignal): Promise<void> {
  const ledger = ledgerOf(key);
  if (ledger.inFlight === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const wake = () => {
      signal?.removeEventListener("abort", abandon);
      resolve();
    };
    const abandon = () => {
      ledger.settled.delete(wake);
      const reason: unknown = signal?.reason;
      reject(reason instanceof Error ? reason : new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      abandon();
      return;
    }
    ledger.settled.add(wake);
    signal?.addEventListener("abort", abandon, { once: true });
  });
}

/** How often a read is taken again while writes keep overlapping it, before it fails. */
export const MAX_REREADS = 3;

/**
 * How long a write is waited for before its outcome counts as unknown (PL-033). **Waiting stops;
 * the request does not**: it may still land, so nothing read meanwhile can say it did not, and
 * its own settlement, whenever it comes, decides. A write that never settles would otherwise
 * hold every read of its set for ever.
 */
export const WRITE_PATIENCE_MS = 10_000;

/**
 * Reads `key` once no write to it is in flight, and **again while a write overlapped the read**:
 * one began or settled while it was out, or is still in flight -- begun in the very turn the
 * read was waiting to be sent in. **At most `MAX_REREADS` times**: under a steady stream of
 * writes the loop would be a storm of requests against a backend with one pooled connection,
 * so it fails instead, and the reader offers Try again.
 */
export async function readWhenSettled<Answer>(
  key: string,
  read: () => Promise<Answer>,
  signal?: AbortSignal,
): Promise<Answer> {
  for (let reread = 0; ; reread += 1) {
    if (reread > MAX_REREADS) {
      throw new ApiError({
        code: CLIENT_ERROR_CODES.keptChanging,
        message: `${key} kept changing while it was read, ${String(MAX_REREADS)} times over.`,
      });
    }
    await untilSettled(key, signal);
    const ledger = ledgerOf(key);
    if (ledger.inFlight > 0) continue;
    const begun = ledger.epoch;
    let answer: Answer;
    try {
      answer = await read();
    } catch (error) {
      // **A failure a write overlapped is as stale as an answer would be**: a 404 for a set
      // restored meanwhile is read again, not passed on. An abort is the caller's, and final.
      if (isAbort(error) || ledgerOf(key).epoch === begun) throw error;
      continue;
    }
    // In flight now means begun since `begun`, which the epoch already says.
    if (ledgerOf(key).epoch === begun) return answer;
  }
}

/**
 * A write the client stopped waiting for has settled after all (PL-033): whatever it did, a read
 * of its sets taken while it could still land is read again.
 */
export function noteLateSettlement(keys: readonly string[]): void {
  beginSetWrite(keys)();
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Every test is a page of its own. */
export function forgetSetWrites(): void {
  ledgers.clear();
}
