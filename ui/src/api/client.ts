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
import { isUnreachable, noteAnswered } from "./reachability";
import {
  beginSetWrite,
  EVERY_SET,
  noteLateSettlement,
  readWhenSettled,
  untilSettled,
  WRITE_PATIENCE_MS,
} from "./setWrites";

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
 * **Both forms, because the contract has both.** Some operations mark their body optional --
 * `POST /data-acquisition-runs/{runId}/retry` defaults to the failures when sent nothing -- and
 * `openapi-typescript` renders that as `requestBody?`. Matching only the required form typed it
 * `never`, so a call that needed an optional body could not be written.
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
  const read = () =>
    request<GetResult<Path>>(
      buildUrl(
        path,
        query,
        options.pathParams as PathValues | undefined,
      ),
      {
        method: "GET",
        signal: options.signal,
      },
    );
  // **A read of a set is shown only if no write to it overlapped it** (PL-142): see `setWrites`.
  const key = setReadKey(path, query, options.pathParams as PathValues | undefined);
  return key === null ? read() : readWhenSettled(key, read, options.signal);
}

/**
 * The set a read is of, if any: named in the path or, for a ranking or a comparison, in the
 * query; the list of sets is read under every set at once.
 */
function setReadKey(
  path: string,
  query: QueryValues | undefined,
  pathParams: PathValues | undefined,
): string | null {
  const named = pathParams?.["criteriaSetId"] ?? query?.["criteria_set"];
  if (typeof named === "string" || typeof named === "number") return String(named);
  return path === "/criteria-sets" ? EVERY_SET : null;
}

/** The set verbs, which change the list of sets as well as the set they name. */
const SET_VERBS = new Set([
  "/criteria-sets",
  "/criteria-sets/{criteriaSetId}",
  "/criteria-sets/{criteriaSetId}/restore",
  "/criteria-sets/{criteriaSetId}/duplicate",
]);

/**
 * The sets a write changes (PL-142): the one its path names, the one a create or a copy makes,
 * and -- for a set verb -- the list of sets.
 */
function setWriteKeys(path: string, pathParams: PathValues | undefined, body?: unknown): string[] {
  const keys: string[] = [];
  const named = pathParams?.["criteriaSetId"];
  if (named !== undefined) keys.push(String(named));
  if (SET_VERBS.has(path)) {
    keys.push(EVERY_SET);
    const made = (body as { id?: unknown } | undefined)?.id;
    if (typeof made === "string") keys.push(made);
  }
  return keys;
}

/**
 * A write the client stopped waiting for after `WRITE_PATIENCE_MS` (PL-033). **Its outcome is
 * unknown, not failed**: the request was left running and may still land, and `late` settles as
 * it does -- answered, refused or lost.
 */
export class OverdueWrite extends ApiError {
  readonly late: Promise<unknown>;

  constructor(path: string, late: Promise<unknown>) {
    super({
      code: CLIENT_ERROR_CODES.unreachable,
      message: `${path} has not answered yet, so whether it took effect is not known.`,
    });
    this.name = "OverdueWrite";
    this.late = late;
  }
}

/**
 * Sends a write, **counted as in flight under every set it changes until it settles**, however
 * it settles (PL-142): a refused write changed nothing, but the read it overlapped is read again
 * all the same, which costs one request and decides nothing.
 *
 * **Waited for `WRITE_PATIENCE_MS` at the latest** (PL-033): past it, the caller is answered
 * with `OverdueWrite` -- its outcome unknown -- and reads of its sets are no longer held, rather
 * than for ever. The request itself is left to run: abandoning it would not stop the server
 * committing it, only stop anyone hearing that it had. When it does settle, reads taken
 * meanwhile are read again.
 */
async function sendWrite<Result>(
  path: string,
  pathParams: PathValues | undefined,
  body: unknown,
  signal: AbortSignal | undefined,
  send: (signal: AbortSignal | undefined) => Promise<Result>,
): Promise<Result> {
  const keys = setWriteKeys(path, pathParams, body);
  if (keys.length === 0) return send(signal);
  const settle = beginSetWrite(keys);
  const sending = send(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let overdue = false;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      overdue = true;
      reject(new OverdueWrite(path, sending));
    }, WRITE_PATIENCE_MS);
  });
  try {
    return await Promise.race([sending, bound]);
  } finally {
    clearTimeout(timer);
    settle();
    if (overdue) {
      const landed = () => noteLateSettlement(keys);
      sending.then(landed, landed);
    }
  }
}

export async function postJson<Path extends PostPath>(
  path: Path,
  body: PostBody<Path>,
  options: CallOptions<PathValuesOf<PostOperation<Path>>> = {},
): Promise<PostResult<Path>> {
  // Path parameters are filled here as they are for GET and PATCH. Until the Run tab needed
  // `/data-acquisition-runs/{runId}/retry`, no POST took one, and the placeholder went to the
  // server verbatim -- which fails as a request that was merely built wrong.
  // **A ranking is saved from the set as it stands once its writes have settled** (PL-142).
  const savedFrom = (body as { criteria_set?: unknown } | undefined)?.criteria_set;
  if (typeof savedFrom === "string") await untilSettled(savedFrom, options.signal);
  const pathParams = options.pathParams as PathValues | undefined;
  return sendWrite(path, pathParams, body, options.signal, (signal) =>
    request<PostResult<Path>>(buildUrl(path, undefined, pathParams), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialise(body),
      signal,
    }),
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
  const pathParams = options.pathParams as PathValues | undefined;
  return sendWrite(path, pathParams, body, options.signal, (signal) =>
    request<PatchResult<Path>>(buildUrl(path, undefined, pathParams), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: serialise(body),
      signal,
    }),
  );
}

/**
 * A request body as JSON, refusing any number JSON cannot carry.
 *
 * **`JSON.stringify` writes NaN and the infinities as `null`**, and null means "unset" to this
 * contract: a lone "." typed into a nullable setting went out as null and cleared it (UI-10).
 * A body holding one was already wrong, so it is refused here -- before anything is sent --
 * rather than sent as a different request that the server would accept.
 */
function serialise(body: unknown): string {
  return JSON.stringify(body, (field: string, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new ApiError({
        code: CLIENT_ERROR_CODES.unsendableNumber,
        message: `${field} is ${String(value)}, which a request cannot carry.`,
        details: { field },
      });
    }
    return value;
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

  if (!response.ok) {
    const error = await apiErrorFromResponse(response);
    if (!isUnreachable(error)) noteAnswered();
    throw error;
  }
  noteAnswered();

  if (response.status === 204) return undefined as Result;

  try {
    return (await response.json()) as Result;
  } catch (cause) {
    // **An abort landing mid-body is still an abort.** Reading the body is a second await, so
    // a cancellation arriving between the headers and the end of the stream threw here -- and
    // was reported as "the backend answered with something that is not JSON", which blames the
    // server for the caller walking away. `useRead` hides it by ignoring whatever lands after its
    // request was abandoned; a hook awaiting this directly shows it to the reader.
    if (isAbort(cause)) throw cause;
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
  const pathParams = options.pathParams as PathValues | undefined;
  return sendWrite(path, pathParams, body, options.signal, (signal) =>
    request<PutResult<Path>>(buildUrl(path, undefined, pathParams), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: serialise(body),
      signal,
    }),
  );
}

/** A discard. Answers 204, so there is nothing to parse and nothing to return. */
export async function deleteResource<Path extends DeletePath>(
  path: Path,
  options: CallOptions<PathValuesOf<DeleteOperation<Path>>> = {},
): Promise<void> {
  const pathParams = options.pathParams as PathValues | undefined;
  await sendWrite(path as string, pathParams, undefined, options.signal, (signal) =>
    request(buildUrl(path as string, undefined, pathParams), {
      method: "DELETE",
      signal,
    }),
  );
}
