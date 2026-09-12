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
 * It holds no domain logic (`arch.md` 8.1) -- it moves bytes and types them.
 */

import { ApiError, CLIENT_ERROR_CODES, apiErrorFromResponse } from "./ApiError";
import type { paths } from "./schema";

/** Matches the `/v1` prefix that nginx and the Vite dev server both proxy. */
export const API_PREFIX = "/v1";

type ApiPaths = paths;

type JsonBody<Response> = Response extends {
  content: { "application/json": infer Body };
}
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

type QueryOf<Operation> = Operation extends {
  parameters: { query?: infer Query };
}
  ? Query
  : never;

/**
 * The `{name}` placeholders a templated path declares, e.g. `{ criteriaSetId: string }`.
 * `never` for a path that has none, which is why `pathParams` may simply be omitted there.
 */
type PathValuesOf<Operation> = Operation extends {
  parameters: { path?: infer Params };
}
  ? Params
  : never;

/**
 * The JSON body an operation takes, whether the contract marks it required or optional.
 *
 * **Both forms, because the contract has both.** `retryRun` takes an optional body -- which
 * part of the run to go over again, defaulting to the failures so a client that sends nothing
 * keeps working -- and `openapi-typescript` renders that as `requestBody?`. Matching only the
 * required form typed it `never`, so the one call that needed a body could not be written.
 */
type RequestBodyOf<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : Operation extends {
        requestBody?: { content: { "application/json": infer Body } };
      }
    ? Body
    : never;

export type GetPath = {
  [Path in keyof ApiPaths]: ApiPaths[Path] extends { get: unknown }
    ? Path
    : never;
}[keyof ApiPaths];

export type PostPath = {
  [Path in keyof ApiPaths]: ApiPaths[Path] extends { post: unknown }
    ? Path
    : never;
}[keyof ApiPaths];

export type PatchPath = {
  [Path in keyof ApiPaths]: ApiPaths[Path] extends { patch: unknown }
    ? Path
    : never;
}[keyof ApiPaths];

export type PutPath = {
  [Path in keyof ApiPaths]: ApiPaths[Path] extends { put: unknown }
    ? Path
    : never;
}[keyof ApiPaths];

export type DeletePath = {
  [Path in keyof ApiPaths]: ApiPaths[Path] extends { delete: unknown }
    ? Path
    : never;
}[keyof ApiPaths];

type GetOperation<Path extends GetPath> = ApiPaths[Path] extends {
  get: infer Operation;
}
  ? Operation
  : never;

type PostOperation<Path extends PostPath> = ApiPaths[Path] extends {
  post: infer Operation;
}
  ? Operation
  : never;

type PatchOperation<Path extends PatchPath> = ApiPaths[Path] extends {
  patch: infer Operation;
}
  ? Operation
  : never;

type PutOperation<Path extends PutPath> = ApiPaths[Path] extends {
  put: infer Operation;
}
  ? Operation
  : never;

type DeleteOperation<Path extends DeletePath> = ApiPaths[Path] extends {
  delete: infer Operation;
}
  ? Operation
  : never;

export type PutResult<Path extends PutPath> = SuccessBody<PutOperation<Path>>;
export type PutBody<Path extends PutPath> = RequestBodyOf<PutOperation<Path>>;

export type GetResult<Path extends GetPath> = SuccessBody<GetOperation<Path>>;
export type GetQuery<Path extends GetPath> = QueryOf<GetOperation<Path>>;
export type PostResult<Path extends PostPath> = SuccessBody<
  PostOperation<Path>
>;
export type PostBody<Path extends PostPath> = RequestBodyOf<
  PostOperation<Path>
>;
export type PatchResult<Path extends PatchPath> = SuccessBody<
  PatchOperation<Path>
>;
export type PatchBody<Path extends PatchPath> = RequestBodyOf<
  PatchOperation<Path>
>;

export type QueryValues = Record<
  string,
  string | number | boolean | readonly string[] | undefined
>;
export type PathValues = Record<string, string | number>;

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * Path parameters travel in the same options bag as the signal, so a call site has one
 * optional argument rather than two positional ones it has to keep in order.
 */
export type CallOptions<Params> = RequestOptions & { pathParams?: Params };

export function buildUrl(
  path: string,
  query?: QueryValues,
  pathParams?: PathValues,
): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    // A list repeats its name, which is how the contract types an array parameter: a
    // comparison names several comparators, and joining them with commas would send one
    // candidate called "country.spain,country.greece".
    if (Array.isArray(value)) {
      for (const item of value) parameters.append(name, String(item));
    } else {
      parameters.set(name, String(value));
    }
  }
  const search = parameters.toString();
  const filled = fillPathParams(path, pathParams);
  return search === ""
    ? `${API_PREFIX}${filled}`
    : `${API_PREFIX}${filled}?${search}`;
}

/**
 * Substitutes `{criteriaSetId}` and friends. A missing value throws rather than sending the
 * literal placeholder to the backend: a request to `/criteria-sets/%7BcriteriaSetId%7D` would
 * come back as a 404 that reads like a missing resource instead of the programming error it is.
 */
function fillPathParams(template: string, values?: PathValues): string {
  return template.replace(/\{([^}]+)\}/g, (_placeholder, name: string) => {
    const value = values?.[name];
    if (value === undefined) {
      throw new Error(
        `${template} needs a value for the path parameter {${name}}.`,
      );
    }
    return encodeURIComponent(String(value));
  });
}

export async function getJson<Path extends GetPath>(
  path: Path,
  query?: GetQuery<Path> & QueryValues,
  options: CallOptions<PathValuesOf<GetOperation<Path>>> = {},
): Promise<GetResult<Path>> {
  return request(
    buildUrl(
      path as string,
      query,
      options.pathParams as PathValues | undefined,
    ),
    {
      method: "GET",
      signal: options.signal,
    },
  );
}

export async function postJson<Path extends PostPath>(
  path: Path,
  body: PostBody<Path>,
  options: CallOptions<PathValuesOf<PostOperation<Path>>> = {},
): Promise<PostResult<Path>> {
  // Path parameters are filled here as they are for GET and PATCH. Until the Run tab needed
  // `/data-acquisition-runs/{runId}/retry`, no POST took one, and the placeholder went to the
  // server verbatim -- which fails as a request that was merely built wrong.
  return request(
    buildUrl(
      path as string,
      undefined,
      options.pathParams as PathValues | undefined,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );
}

/**
 * The one write the interface makes today (`arch.md` 8.3): send one weight, and be told what
 * the server made of it. The response is the whole affected pillar, because the rebalance is
 * the server's arithmetic and the client only renders the outcome.
 */
export async function patchJson<Path extends PatchPath>(
  path: Path,
  body: PatchBody<Path>,
  options: CallOptions<PathValuesOf<PatchOperation<Path>>> = {},
): Promise<PatchResult<Path>> {
  return request(
    buildUrl(
      path as string,
      undefined,
      options.pathParams as PathValues | undefined,
    ),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );
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

async function request<Result>(
  url: string,
  init: RequestInit,
): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
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

/**
 * A whole-record write: settings, the household, one pillar's weight, whether a rule counts.
 *
 * PUT rather than PATCH wherever the design says so, and the reason is the same each time: a
 * partial write would leave a record half in one state and half in another -- a household whose
 * income moved without its target spend, or a score scale changed without the coverage floor.
 */
export async function putJson<Path extends PutPath>(
  path: Path,
  body: PutBody<Path>,
  options: CallOptions<PathValuesOf<PutOperation<Path>>> = {},
): Promise<PutResult<Path>> {
  return request(
    buildUrl(
      path as string,
      undefined,
      options.pathParams as PathValues | undefined,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );
}

/** A discard. Answers 204, so there is nothing to parse and nothing to return. */
export async function deleteResource<Path extends DeletePath>(
  path: Path,
  options: CallOptions<PathValuesOf<DeleteOperation<Path>>> = {},
): Promise<void> {
  await request(
    buildUrl(
      path as string,
      undefined,
      options.pathParams as PathValues | undefined,
    ),
    { method: "DELETE", signal: options.signal },
  );
}
