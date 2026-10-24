/**
 * One read, in the only states it can be in (C01 M1).
 *
 * **There is no `data` outside `ready`**, so nothing can draw a figure the server never sent:
 * the type has no slot for one. And deliberately no `dataOr(read, fallback)` -- a default is
 * how a zero gets drawn (PL-001).
 */

/** A re-read of data already on screen: none, under way, or failed with the data kept (N3). */
export type Refresh = "idle" | "running" | { readonly failed: unknown };

export type Read<T> =
  | { readonly state: "pending"; readonly waitingFor?: "a-write" }
  | { readonly state: "failed"; readonly error: unknown }
  | { readonly state: "ready"; readonly data: T; readonly readAt: Date; readonly refresh: Refresh };

/** Nothing is being read, because a prerequisite is missing. Not a kind of loading. */
export interface Idle {
  readonly state: "idle";
}

/**
 * Two reads drawn as one: failed over pending over ready. Ready together, they are as fresh as
 * the older of the two, and as settled as the less settled.
 */
export function combine<A, B>(a: Read<A>, b: Read<B>): Read<readonly [A, B]> {
  if (a.state === "failed") return a;
  if (b.state === "failed") return b;
  if (a.state === "pending" || b.state === "pending") {
    const waitingForAWrite = [a, b].some((read) => read.state === "pending" && read.waitingFor);
    return waitingForAWrite ? { state: "pending", waitingFor: "a-write" } : { state: "pending" };
  }
  return {
    state: "ready",
    data: [a.data, b.data],
    readAt: a.readAt < b.readAt ? a.readAt : b.readAt,
    refresh: combineRefresh(a.refresh, b.refresh),
  };
}

function combineRefresh(a: Refresh, b: Refresh): Refresh {
  if (typeof a === "object") return a;
  if (typeof b === "object") return b;
  return a === "running" || b === "running" ? "running" : "idle";
}

export function map<A, B>(read: Read<A>, transform: (data: A) => B): Read<B> {
  return read.state === "ready" ? { ...read, data: transform(read.data) } : read;
}
