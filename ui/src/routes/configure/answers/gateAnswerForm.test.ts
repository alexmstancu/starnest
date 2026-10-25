import { describe, expect, it } from "vitest";
import type { MatchRuleResult } from "../../../api/endpoints";
import {
  draftFrom,
  draftFromProposal,
  emptyDraft,
  readDraft,
  type GateAnswerDraft,
} from "./gateAnswerForm";

const FILLED: GateAnswerDraft = {
  ...emptyDraft(),
  matchRule: "uk_skilled_worker",
  candidate: "country.united_kingdom",
  answer: "not_matching",
};

const STORED: MatchRuleResult = {
  match_rule: "uk_skilled_worker",
  candidate: "country.united_kingdom",
  match_result: "not_matching",
  data_source: "llm",
  retrieval_date: "2026-09-12T09:00:00Z",
  reason: "No sponsor in the local market.",
  reference_period: { start: "2026-01-01", end: "2026-12-31" },
  citations: ["https://www.gov.uk/skilled-worker-visa", "https://www.gov.uk/sponsors"],
  override_reason: "Checked with an employer.",
  override_date: "2026-09-13T09:00:00Z",
  is_proposal: false,
};

function problemsOf(draft: GateAnswerDraft): string[] {
  const reading = readDraft(draft);
  return reading.ok ? [] : reading.problems.map((problem) => problem.field);
}

describe("a gate answer as typed", () => {
  it("is always sent as manual, whatever it was prefilled from", () => {
    const reading = readDraft(draftFrom(STORED));

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

describe("a correction", () => {
  it("starts from everything the stored answer holds, so the PUT drops nothing unseen", () => {
    const reading = readDraft(draftFrom(STORED));

    expect(reading.ok && reading.input).toEqual({
      match_result: "not_matching",
      reason: "No sponsor in the local market.",
      data_source: "manual",
      reference_period: { start: "2026-01-01", end: "2026-12-31" },
      override_reason: "Checked with an employer.",
      citations: ["https://www.gov.uk/skilled-worker-visa", "https://www.gov.uk/sponsors"],
    });
  });

  it("takes a re-check's proposal without the override it would replace", () => {
    const draft = draftFromProposal(STORED, {
      match_result: "matching",
      reason: "A sponsor list now includes local employers.",
      data_source: "llm",
      reference_period: null,
      retrieval_date: "2026-10-20T09:00:00Z",
      recorded_at: "2026-10-20T09:00:00Z",
      citations: ["https://www.gov.uk/sponsors"],
    });
    const reading = readDraft(draft);

    expect(reading.ok && reading.input).toEqual({
      match_result: "matching",
      reason: "A sponsor list now includes local employers.",
      data_source: "manual",
      reference_period: null,
      override_reason: null,
      citations: ["https://www.gov.uk/sponsors"],
    });
  });
});
