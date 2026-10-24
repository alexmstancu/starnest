import type { Idle, Read } from "../../api/read";

/**
 * A read that waits on nothing selected is never idle, and this says so to the type rather
 * than drawing an idle read as anything at all.
 */
export function alwaysAsked<T>(read: Read<T> | Idle): Read<T> {
  if (read.state === "idle") throw new Error("A read that waits on nothing was idle.");
  return read;
}
