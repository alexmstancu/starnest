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
 * How long a write is waited for before its outcome counts as unknown (PL-033): its request is
 * abandoned, and the writer reads back what it did. A write that never settles would otherwise
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
    const answer = await read();
    const now = ledgerOf(key);
    // In flight now means begun since `begun`, which the epoch already says.
    if (now.epoch === begun) return answer;
  }
}

/** Every test is a page of its own. */
export function forgetSetWrites(): void {
  ledgers.clear();
}
