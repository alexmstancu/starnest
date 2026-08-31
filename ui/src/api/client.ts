/**
 * A thin typed fetch wrapper over the client generated from `docs/openapi.yaml`.
 *
 * Two rules it exists to enforce:
 *
 * 1. **Every request uses a relative path.** `nginx.conf` in the container and the Vite dev
 *    proxy both forward `/v1`, so the browser only ever makes same-origin requests, no CORS
 *    configuration exists anywhere, and moving the backend never rebuilds the bundle.
 * 2. **Every failure arrives as an `ApiError`** carrying the contract's machine-readable
 *    `code`. Callers branch on that code; nothing branches on an HTTP status or on prose.
 *
 * It holds no domain logic (`arch.md` §8.1) -- it moves bytes and types them.
 */

import { ApiError, CLIENT_ERROR_CODES, apiErrorFromResponse } from "./ApiError";
import type { paths } from "./schema";

/** Matches the `/v1` prefix that nginx and the Vite dev server both proxy. */
export const API_PREFIX = "/v1";

type ApiPaths = paths;

type JsonBody<Response> = Response extends { content: { "application/json": infer Body } }
  ? Body
  : never;

/** The first of 200/201/202 an operation actually declares. */
type SuccessBody<Operation> = Operation extends { responses: infer Responses }
  ? Responses extends { 200: infer Ok }
    ? JsonBody<Ok>
    : Responses extends { 201: infer Created }
      ? JsonBody<Created>
      : Responses extends { 202: infer Accepted }
        ? JsonBody<Accepted>
        : never
  : never;

type QueryOf<Operation> = Operation extends { parameters: { query?: infer Query } }
  ? Query
  : never;

type RequestBodyOf<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

export type GetPath = {
  [Path in keyof ApiPaths]: ApiPaths[Path] extends { get: unknown } ? Path : never;
}[keyof ApiPaths];

export type PostPath = {
  [Path in keyof ApiPaths]: ApiPaths[Path] extends { post: unknown } ? Path : never;
}[keyof ApiPaths];

type GetOperation<Path extends GetPath> = ApiPaths[Path] extends { get: infer Operation }
  ? Operation
  : never;

type PostOperation<Path extends PostPath> = ApiPaths[Path] extends { post: infer Operation }
  ? Operation
  : never;

export type GetResult<Path extends GetPath> = SuccessBody<GetOperation<Path>>;
export type GetQuery<Path extends GetPath> = QueryOf<GetOperation<Path>>;
export type PostResult<Path extends PostPath> = SuccessBody<PostOperation<Path>>;
export type PostBody<Path extends PostPath> = RequestBodyOf<PostOperation<Path>>;

export type QueryValues = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: QueryValues): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) parameters.set(name, String(value));
  }
  const search = parameters.toString();
  return search === "" ? `${API_PREFIX}${path}` : `${API_PREFIX}${path}?${search}`;
}

export async function getJson<Path extends GetPath>(
  path: Path,
  query?: GetQuery<Path> & QueryValues,
  options: RequestOptions = {},
): Promise<GetResult<Path>> {
  return request(buildUrl(path as string, query), { method: "GET", signal: options.signal });
}

export async function postJson<Path extends PostPath>(
  path: Path,
  body: PostBody<Path>,
  options: RequestOptions = {},
): Promise<PostResult<Path>> {
  return request(buildUrl(path as string), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

/**
 * An abort is the caller changing its mind, not a failure worth reporting to anyone.
 *
 * Matched by name rather than by class: an abort arrives as a `DOMException`, and whether that
 * happens to extend `Error` differs between the browser and the test environment.
 */
function isAbort(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

async function request<Result>(url: string, init: RequestInit): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Accept: "application/json", ...init.headers } });
  } catch (cause) {
    if (isAbort(cause)) throw cause;
    throw new ApiError({
      code: CLIENT_ERROR_CODES.unreachable,
      message: `${url} could not be reached.`,
      details: { cause: String(cause) },
    });
  }

  if (!response.ok) throw await apiErrorFromResponse(response);

  if (response.status === 204) return undefined as Result;

  try {
    return (await response.json()) as Result;
  } catch {
    throw new ApiError({
      code: CLIENT_ERROR_CODES.malformedBody,
      message: `${url} answered HTTP ${response.status} with a body that is not JSON.`,
      status: response.status,
    });
  }
}
