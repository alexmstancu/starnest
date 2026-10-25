import { describe, expect, it } from "vitest";
import { emptyDraft, readDraft, type GateAnswerDraft } from "./gateAnswerForm";

const FILLED: GateAnswerDraft = {
  ...emptyDraft(),
  matchRule: "uk_skilled_worker",
  candidate: "country.united_kingdom",
  answer: "not_matching",
};

function problemsOf(draft: GateAnswerDraft): string[] {
  const reading = readDraft(draft);
  return reading.ok ? [] : reading.problems.map((problem) => problem.field);
}

describe("a gate answer as typed", () => {
  it("is always sent as manual", () => {
    const reading = readDraft(FILLED);

    expect(reading.ok && reading.input.data_source).toBe("manual");
  });

  it("needs a gate and a candidate", () => {
    expect(problemsOf(emptyDraft())).toEqual(["matchRule", "candidate"]);
  });

  it("needs both days of a period, or neither", () => {
    expect(problemsOf({ ...FILLED, periodStart: "2026-01-01" })).toEqual(["period"]);
    expect(problemsOf({ ...FILLED, periodEnd: "2026-12-31" })).toEqual(["period"]);
    const reading = readDraft(FILLED);
    expect(reading.ok && reading.input.reference_period).toBeNull();
  });

  it("leaves the order of the days to the server, which refuses a period ending first", () => {
    const reading = readDraft({ ...FILLED, periodStart: "2026-12-31", periodEnd: "2026-01-01" });

    expect(reading.ok && reading.input.reference_period).toEqual({
      start: "2026-12-31",
      end: "2026-01-01",
    });
  });

  it("refuses a page that is not a full web address, naming its line", () => {
    const reading = readDraft({
      ...FILLED,
      pages: "https://www.gov.uk/a\njavascript:alert(1)\n\nhttps://",
    });

    expect(reading.ok).toBe(false);
    expect(!reading.ok && reading.problems).toEqual([
      {
        field: "pages",
        message:
          "Lines 2, 4 are not full web addresses: each page starts with http:// or https://.",
      },
    ]);
  });

  it("sends each page on its own line, blank lines dropped", () => {
    const reading = readDraft({ ...FILLED, pages: " https://www.gov.uk/a \n\nHTTP://example.org/b" });

    expect(reading.ok && reading.input.citations).toEqual([
      "https://www.gov.uk/a",
      "HTTP://example.org/b",
    ]);
  });

  it("refuses an override with no reason, a blank one included", () => {
    expect(problemsOf({ ...FILLED, overriding: true, overrideReason: "  " })).toEqual([
      "overrideReason",
    ]);
  });

  it("sends no override when it is not ticked, whatever reason was typed before", () => {
    const reading = readDraft({ ...FILLED, overriding: false, overrideReason: "old" });

    expect(reading.ok && reading.input.override_reason).toBeNull();
  });

  it("sends a blank reason as none", () => {
    const reading = readDraft({ ...FILLED, reason: "   " });

    expect(reading.ok && reading.input.reason).toBeNull();
  });
});
