import { describe, expect, it } from "vitest";
import { describeProvenance, provenanceMark } from "./provenance";

const NAMES = new Map([["eurostat", "Eurostat"]]);

const MEASURED = {
  data_source: "eurostat",
  reference_period: { start: "2025-01-01", end: "2025-12-31" },
  retrieval_date: "2026-09-11T08:00:00Z",
  confidence_level: "high",
  quote: "Eurostat 2025: 94.5",
};

/** PL-096. Every figure carries where it came from, what it describes and when it was fetched. */
describe("a figure's provenance", () => {
  // 08:00 UTC on the reader's clock, which the tests pin to Europe/Bucharest (PL-020).
  it("names its source, both dates and its confidence", () => {
    expect(describeProvenance(MEASURED, NAMES)).toBe(
      "Source: Eurostat. Describes 1 Jan 2025 to 31 Dec 2025. Fetched 11 Sept 2026, 11:00. High confidence.",
    );
  });

  it("says whose figure a borrowed one is", () => {
    const borrowed = {
      ...MEASURED,
      data_source: "stand_in",
      confidence_level: "low",
      quote: "Switzerland's figure, standing in for Liechtenstein.",
    };

    expect(describeProvenance(borrowed, NAMES)).toBe(
      "Source: Stand in. Describes 1 Jan 2025 to 31 Dec 2025. Fetched 11 Sept 2026, 11:00. " +
        "Low confidence. Switzerland's figure, standing in for Liechtenstein.",
    );
  });

  it("leaves out what the value does not carry rather than printing a blank", () => {
    expect(describeProvenance({ data_source: "eurostat" }, NAMES)).toBe("Source: Eurostat.");
  });
});

describe("a figure's mark", () => {
  it("marks a borrowed figure, whatever its confidence", () => {
    expect(provenanceMark({ data_source: "stand_in", confidence_level: "low" })).toBe("Borrowed");
  });

  it("marks a low-confidence figure", () => {
    expect(provenanceMark({ data_source: "eurostat_estimate", confidence_level: "low" })).toBe(
      "Low confidence",
    );
  });

  it("marks nothing on a measured figure", () => {
    expect(provenanceMark(MEASURED)).toBeNull();
  });
});
