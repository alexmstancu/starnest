import { isApiError } from "./ApiError";

/**
 * A refusal's field problems, in words, by the body field each is about (PL-028, UF-045).
 *
 * The server lists every offending field in `details.errors` as a `FieldProblem`: where it is,
 * the validator's `kind`, and the bound that refused it. A form marks those fields with these
 * sentences rather than printing one generic line that names none of them.
 *
 * **Worded from `kind` and `limit`, never from `problem` or the code.** `problem` is the
 * validator's own sentence, for a developer; a reader gets "At most 20." A kind this table does
 * not know -- a validator upgrade can rename one -- falls back to the field's own range, which
 * the caller states because the range is a screen's business rather than the contract's port.
 *
 * Keyed by `location[1]`, the top-level body field, so a list's items (`citizenships`, index 2)
 * are said once on the list. The first problem a field is named in is kept.
 */
export function fieldProblems(
  error: unknown,
  ranges: Readonly<Record<string, string>> = {},
): Map<string, string> {
  const problems = new Map<string, string>();
  if (!isApiError(error)) return problems;
  const errors = error.details?.["errors"];
  if (!Array.isArray(errors)) return problems;
  for (const entry of errors) {
    const problem = asFieldProblem(entry);
    if (problem === null || problems.has(problem.field)) continue;
    problems.set(
      problem.field,
      sentenceFor(problem.kind, problem.limit) ?? ranges[problem.field] ?? NOT_ACCEPTED,
    );
  }
  return problems;
}

const NOT_ACCEPTED = "Not accepted as typed.";

interface BodyFieldProblem {
  field: string;
  kind: string;
  limit: number | undefined;
}

function asFieldProblem(entry: unknown): BodyFieldProblem | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { location, kind, limit } = entry as Record<string, unknown>;
  if (!Array.isArray(location) || location[0] !== "body") return null;
  const field: unknown = location[1];
  if (typeof field !== "string" || typeof kind !== "string") return null;
  return { field, kind, limit: typeof limit === "number" ? limit : undefined };
}

function sentenceFor(kind: string, limit: number | undefined): string | undefined {
  if (limit !== undefined) {
    const bounded = BOUNDS[kind];
    if (bounded !== undefined) return `${bounded} ${String(limit)}.`;
  }
  return SENTENCES[kind];
}

const BOUNDS: Record<string, string> = {
  less_than_equal: "At most",
  greater_than_equal: "At least",
  less_than: "Less than",
  greater_than: "More than",
};

const SENTENCES: Record<string, string> = {
  int_from_float: "A whole number.",
  int_parsing: "A whole number.",
  float_parsing: "A number.",
  finite_number: "A finite number.",
  missing: "Required.",
  too_short: "At least one is required.",
};
