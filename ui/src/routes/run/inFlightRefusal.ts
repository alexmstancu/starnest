import { isApiError } from "../../api/ApiError";

/**
 * The run a start was refused for, from the refusal's details (D35, PL-119): the id the screen
 * opens with "Open acquisition N". Null for any other refusal, and for one that names no run --
 * left out when the run ended between the refusal and the read that names it.
 */
export function runRefusedFor(error: unknown): number | null {
  if (!isApiError(error) || error.code !== "run_already_in_flight") return null;
  const run = error.details?.["run"];
  return typeof run === "number" && Number.isInteger(run) ? run : null;
}
