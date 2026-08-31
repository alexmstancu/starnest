import type { components } from "./schema";

/**
 * The one error shape the API uses (`arch.md` §7.6): a stable machine-readable `code`, a
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
  /** The request never completed: the backend is down, or the network is gone. */
  unreachable: "client.unreachable",
  /** A non-2xx response whose body was not the documented error shape. */
  malformedError: "client.malformed_error_body",
  /** A 2xx response whose body was not JSON. */
  malformedBody: "client.malformed_response_body",
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

/**
 * Turns an unsuccessful response into an `ApiError`.
 *
 * A backend that answers with something other than the documented shape is itself an error
 * worth naming, rather than one to paper over -- hence `client.malformed_error_body` instead
 * of a generic "something went wrong".
 */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError({
      code: CLIENT_ERROR_CODES.malformedError,
      message: `The API answered HTTP ${response.status} with a body that is not JSON.`,
      status: response.status,
    });
  }

  if (!isErrorBody(body)) {
    return new ApiError({
      code: CLIENT_ERROR_CODES.malformedError,
      message: `The API answered HTTP ${response.status} without a code and message.`,
      status: response.status,
      details: { body },
    });
  }

  return new ApiError({
    code: body.code,
    message: body.message,
    status: response.status,
    details: body.details,
  });
}

function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Partial<ErrorBody>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}
