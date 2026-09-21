import { describe, expect, it } from "vitest";
import type { EvaluationSummary } from "../../api/endpoints";
import { describeSaved, detailOf, newestFirst } from "./savedRankings";

function saved(over: Partial<EvaluationSummary> = {}): EvaluationSummary {
  return {
    id: 1,
    criteria_set: "local_employment",
    level: "country",
    computed_at: "2026-09-21T09:00:00Z",
    score_scale_max: 100,
    ...over,
  };
}

describe("the saved rankings list", () => {
  it("puts the newest first", () => {
    const order = newestFirst([
      saved({ id: 1, computed_at: "2026-09-01T09:00:00Z" }),
      saved({ id: 2, computed_at: "2026-09-21T09:00:00Z" }),
      saved({ id: 3, computed_at: "2026-09-10T09:00:00Z" }),
    ]);
    expect(order.map((entry) => entry.id)).toEqual([2, 3, 1]);
  });

  it("does not mutate the list it was given", () => {
    const items = [
      saved({ id: 1, computed_at: "2026-09-01T09:00:00Z" }),
      saved({ id: 2, computed_at: "2026-09-21T09:00:00Z" }),
    ];
    newestFirst(items);
    expect(items.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("sorts an empty list into an empty list", () => {
    expect(newestFirst([])).toEqual([]);
  });

  /** The note is the reason it was kept, so it leads. */
  it("calls a saved ranking by its note", () => {
    expect(describeSaved(saved({ note: "before I raised housing" }))).toBe(
      "before I raised housing",
    );
  });

  it("falls back to the criteria set and level when there is no note", () => {
    expect(describeSaved(saved())).toBe("local_employment, country");
    expect(describeSaved(saved({ note: null }))).toBe(
      "local_employment, country",
    );
  });

  /** A note of spaces is a note that says nothing while looking like one that does. */
  it("treats a blank note as no note", () => {
    expect(describeSaved(saved({ note: "   " }))).toBe(
      "local_employment, country",
    );
  });

  it("states the provenance in words, with no separator character", () => {
    const detail = detailOf(saved());
    expect(detail).toContain("local_employment");
    expect(detail).toContain("country");
    expect(detail).toMatch(/saved /);
    expect(detail).not.toContain("·");
  });
});
