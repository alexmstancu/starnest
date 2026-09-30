import { describe, expect, it } from "vitest";
import {
  buildManualValue,
  NOTHING_TYPED,
  splitLabels,
  type ManualDraft,
} from "./manualEntry";

const NOW = "2026-09-30T10:00:00.000Z";
const A_PERIOD = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

function typed(overrides: Partial<ManualDraft> = {}): ManualDraft {
  return { ...NOTHING_TYPED, candidate: "country.portugal", ...A_PERIOD, ...overrides };
}

describe("a label set typed by hand", () => {
  it("builds the request the contract takes", () => {
    const built = buildManualValue(
      "country.international_employers",
      "LabelSet",
      typed({ labels: "Farfetch, OutSystems", quote: "Careers pages, Sept 2026" }),
      NOW,
    );

    expect(built.problems).toEqual([]);
    expect(built.body).toEqual({
      candidate: "country.portugal",
      attribute: "country.international_employers",
      payload: { labels: ["Farfetch", "OutSystems"] },
      reference_period: { start: "2026-01-01", end: "2026-12-31" },
      retrieval_date: NOW,
      confidence_level: "medium",
      quote: "Careers pages, Sept 2026",
      citations: [],
    });
  });

  it("refuses an empty list rather than storing a figure that says nothing", () => {
    const built = buildManualValue("a", "LabelSet", typed({ labels: "  ,  " }), NOW);

    expect(built.body).toBeNull();
    expect(built.problems).toContain("Name at least one — separate several with commas.");
  });

  it("keeps the order typed, drops blanks and drops repeats", () => {
    // Order is the reader's, not ours: they typed the important one first.
    expect(splitLabels(" Spain , , Spain, Portugal ")).toEqual(["Spain", "Portugal"]);
  });
});

describe("a score somebody assigned", () => {
  it("records that a human assigned it, never the model", () => {
    // The field exists to keep a judgement somebody made apart from one a model produced. A
    // form that could claim the other would make the distinction worthless.
    const built = buildManualValue(
      "country.residency_admin_ease",
      "AssignedScore",
      typed({ value: "7", rangeMin: "0", rangeMax: "10", rationale: "Two visits, both short" }),
      NOW,
    );

    expect(built.body?.payload).toEqual({
      value: 7,
      range_min: 0,
      range_max: 10,
      assigned_by: "human",
      rationale: "Two visits, both short",
    });
  });

  it("leaves the rationale out rather than storing an empty one", () => {
    const built = buildManualValue(
      "a",
      "AssignedScore",
      typed({ value: "3", rangeMin: "1", rangeMax: "5" }),
      NOW,
    );

    expect(built.body?.payload).not.toHaveProperty("rationale");
  });

  it("asks for the scale rather than assuming one", () => {
    // 0-10 is the obvious guess and it is still a guess: the scale is what makes the score mean
    // anything, so an unstated one is a missing fact rather than a default.
    const built = buildManualValue("a", "AssignedScore", typed({ value: "7" }), NOW);

    expect(built.problems).toContain(
      "Give the scale the score sits on — its lowest and highest points.",
    );
  });

  it("refuses a score outside its own scale", () => {
    const built = buildManualValue(
      "a",
      "AssignedScore",
      typed({ value: "12", rangeMin: "0", rangeMax: "10" }),
      NOW,
    );

    expect(built.problems).toContain("The score must sit between 0 and 10.");
  });

  it("refuses a scale that runs backwards or has no width", () => {
    const backwards = buildManualValue(
      "a",
      "AssignedScore",
      typed({ value: "5", rangeMin: "10", rangeMax: "0" }),
      NOW,
    );
    const flat = buildManualValue(
      "a",
      "AssignedScore",
      typed({ value: "5", rangeMin: "5", rangeMax: "5" }),
      NOW,
    );

    expect(backwards.problems).toContain(
      "The scale's lowest point must be below its highest.",
    );
    expect(flat.problems).toContain("The scale's lowest point must be below its highest.");
  });

  it("refuses text where a number belongs", () => {
    const built = buildManualValue(
      "a",
      "AssignedScore",
      typed({ value: "seven", rangeMin: "0", rangeMax: "10" }),
      NOW,
    );

    expect(built.problems).toContain("The score must be a number.");
  });

  it("accepts a negative score on a scale that has one", () => {
    // World Bank governance sits on -2.5 to 2.5, so a negative is an ordinary figure here.
    const built = buildManualValue(
      "a",
      "AssignedScore",
      typed({ value: "-1.2", rangeMin: "-2.5", rangeMax: "2.5" }),
      NOW,
    );

    expect(built.problems).toEqual([]);
    expect(built.body?.payload).toMatchObject({ value: -1.2 });
  });
});

describe("what every hand-typed figure must carry", () => {
  it("asks which candidate it is about", () => {
    const built = buildManualValue(
      "a",
      "LabelSet",
      typed({ candidate: "  ", labels: "Spain" }),
      NOW,
    );

    expect(built.problems).toContain("Choose the candidate this figure is about.");
  });

  it("asks what period it describes, and will not guess it from the clock", () => {
    // The reference date and the retrieval date are different questions, never merged
    // (`reqs.md` 3.6). Typing a figure today says nothing about the year it measures.
    const built = buildManualValue(
      "a",
      "LabelSet",
      typed({ labels: "Spain", periodStart: "", periodEnd: "" }),
      NOW,
    );

    expect(built.problems).toContain(
      "Say what period this figure describes — both dates.",
    );
  });

  it("refuses a period that ends before it starts", () => {
    const built = buildManualValue(
      "a",
      "LabelSet",
      typed({ labels: "Spain", periodStart: "2026-12-31", periodEnd: "2026-01-01" }),
      NOW,
    );

    expect(built.problems).toContain("The period ends before it starts.");
  });

  it("stamps the retrieval date it was given rather than reading a clock", () => {
    const built = buildManualValue("a", "LabelSet", typed({ labels: "Spain" }), NOW);

    expect(built.body?.retrieval_date).toBe(NOW);
  });

  it("carries a citation when there is one, and an empty list when there is not", () => {
    const cited = buildManualValue(
      "a",
      "LabelSet",
      typed({ labels: "Spain", citation: " https://example.gov/page " }),
      NOW,
    );

    expect(cited.body?.citations).toEqual(["https://example.gov/page"]);
    expect(
      buildManualValue("a", "LabelSet", typed({ labels: "Spain" }), NOW).body?.citations,
    ).toEqual([]);
  });

  it("sends a null quote rather than an empty string", () => {
    const built = buildManualValue("a", "LabelSet", typed({ labels: "Spain", quote: "   " }), NOW);

    expect(built.body?.quote).toBeNull();
  });

  it("reports every problem at once rather than one at a time", () => {
    const built = buildManualValue(
      "a",
      "AssignedScore",
      { ...NOTHING_TYPED, value: "x" },
      NOW,
    );

    expect(built.problems.length).toBeGreaterThan(2);
  });
});
