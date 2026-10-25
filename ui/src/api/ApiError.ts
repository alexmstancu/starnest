import type { components } from "./schema";

/**
 * The one error shape the API uses (`arch.md` 7.6): a stable machine-readable `code`, a
 * human-readable `message`, and optional `details` naming the offending field.
 *
 * **Clients branch on `code`, never on prose.** `message` is for showing a person, not for
 * deciding anything.
 */
export type ErrorBody = components["schemas"]["Error"];

/**
 * Codes this client produces itself, for failures that never reached the API and therefore
 * have no server code. The `client.` prefix keeps them from ever colliding with a backend
 * code, so `code` stays a single flat vocabulary a caller can switch on.
 */
export const CLIENT_ERROR_CODES = {
  /**
   * The server did not answer: the request never completed, or a proxy answered for a backend
   * it could not reach (a 502, 503 or 504 not in the documented shape, or an empty 500).
   */
  unreachable: "client.unreachable",
  /** The server answered a 5xx that is not the documented shape: it failed while answering. */
  serverFault: "client.server_fault",
  /** Any other non-2xx response whose body was not the documented error shape. */
  malformedError: "client.malformed_error_body",
  /** A 2xx response whose body was not JSON. */
  malformedBody: "client.malformed_response_body",
  /**
   * A request body holding NaN or an infinity, refused before it was sent: JSON would carry it
   * as null, which this contract reads as "unset".
   */
  unsendableNumber: "client.unsendable_number",
  /**
   * A read of a set that writes kept overlapping, read again as often as is reasonable and
   * still not one no write overlapped (PL-142).
   */
  keptChanging: "client.kept_changing",
} as const;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(args: {
    code: string;
    message: string;
    status?: number | null;
    details?: Record<string, unknown>;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.status = args.status ?? null;
    this.details = args.details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A code the server declares (`ErrorCode`), so a misspelt one fails to compile. */
export type ErrorCode = components["schemas"]["ErrorCode"];

/** Whether the server refused with this code: what a screen branches on, never the prose. */
export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  return isApiError(error) && error.code === code;
}

/**
 * Turns an unsuccessful response into an `ApiError` (PL-002).
 *
 * **A body in the documented shape is the server's own word, whatever the status.** Otherwise
 * the status decides, because what answered may not have been the backend at all: a proxy's
 * 502, 503 or 504, and the empty 500 Vite's proxy sends for a backend it cannot reach, mean the
 * server did not answer. Any other 5xx is the server failing while it answered, and only what
 * is left -- a 4xx in a shape nobody documented -- is named as malformed.
 */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => "");
  const body = parsed(text);
  const status = response.status;

  if (isErrorBody(body)) {
    return new ApiError({ code: body.code, message: body.message, status, details: body.details });
  }
  if (PROXY_STATUSES.has(status) || (status === 500 && text.trim() === "")) {
    return new ApiError({
      code: CLIENT_ERROR_CODES.unreachable,
      message: `HTTP ${status} came from something answering for the API, not from the API.`,
      status,
    });
  }
  if (status >= 500) {
    return new ApiError({
      code: CLIENT_ERROR_CODES.serverFault,
      message: `The API answered HTTP ${status} without a code and message.`,
      status,
    });
  }
  return new ApiError({
    code: CLIENT_ERROR_CODES.malformedError,
    message: `The API answered HTTP ${status} without a code and message.`,
    status,
    details: body === undefined ? undefined : { body },
  });
}

const PROXY_STATUSES = new Set([502, 503, 504]);

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Partial<ErrorBody>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}
