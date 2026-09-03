/**
 * The one place that turns an API failure into something a person reads.
 *
 * `arch.md` 7.6: the client branches on `code`, never on prose. So this module is a lookup
 * keyed by code, and everything else in the interface renders whatever it returns rather than
 * inspecting an error itself.
 *
 * **The code vocabulary is not enumerated in `docs/openapi.yaml`** -- `Error.code` is a bare
 * string with one example. Only `weights_all_locked` and `manual_entry_not_permitted` are
 * named anywhere in the contract, so those are the only two known entries here. Every other
 * code falls back to the server's `message`, which is correct behaviour rather than a
 * placeholder: an unrecognised code still shows the server's own words, and adding a code to
 * the table below never becomes urgent.
 */

import { ApiError, CLIENT_ERROR_CODES, isApiError } from "./ApiError";

/**
 * The refusal a weight change can meet: every other weight in the pillar is locked, so there
 * is nothing to rebalance into. Named here because two modules branch on it -- the table below
 * and `lockedAttributes` -- and a code spelled twice is a code that can be spelled wrong once.
 */
export const WEIGHTS_ALL_LOCKED = "weights_all_locked";

export interface PresentedError {
  /** The machine-readable code, shown so a report can name it exactly. */
  code: string;
  /** What to put on screen. */
  message: string;
  /** True when retrying the same request could plausibly succeed. */
  retryable: boolean;
}

/**
 * Codes this client recognises, and what it says about them. A code absent here is not an
 * error in itself -- see the fallback in `presentError`.
 */
const KNOWN_CODES: Record<string, { message: string; retryable: boolean }> = {
  [CLIENT_ERROR_CODES.unreachable]: {
    message: "The backend did not answer. Check that it is running, then try again.",
    retryable: true,
  },
  [CLIENT_ERROR_CODES.malformedError]: {
    message: "The backend reported an error in a shape this interface does not recognise.",
    retryable: false,
  },
  [CLIENT_ERROR_CODES.malformedBody]: {
    message: "The backend answered with something that is not JSON.",
    retryable: false,
  },
  [WEIGHTS_ALL_LOCKED]: {
    message: "Every other weight in this pillar is locked, so there is nothing to rebalance into.",
    retryable: false,
  },
  manual_entry_not_permitted: {
    message: "This attribute does not accept a manually entered value.",
    retryable: false,
  },
};

export function presentError(error: unknown): PresentedError {
  if (!isApiError(error)) {
    return {
      code: "client.unexpected",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }

  const known = KNOWN_CODES[error.code];
  if (known) return { code: error.code, ...known };

  return { code: error.code, message: error.message, retryable: isRetryableStatus(error) };
}

function isRetryableStatus(error: ApiError): boolean {
  return error.status !== null && error.status >= 500;
}

/**
 * The attributes whose locks blocked a weight change.
 *
 * `docs/openapi.yaml` types `Error.details` as a free-form object, and its one example for
 * this code carries `details.locked` as a list of attribute ids. So this reads that shape
 * defensively and returns nothing when it is absent: showing which locks are in the way is
 * worth doing, and guessing at them is not.
 */
export function lockedAttributes(error: unknown): string[] {
  if (!isApiError(error) || error.code !== WEIGHTS_ALL_LOCKED) return [];

  const locked = error.details?.["locked"];
  if (!Array.isArray(locked)) return [];

  return locked.filter((entry): entry is string => typeof entry === "string");
}
