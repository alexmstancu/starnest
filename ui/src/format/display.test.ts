import { describe, expect, it } from "vitest";
import {
  ABSENT,
  formatCount,
  formatDate,
  formatDateTime,
  formatMatchStatus,
  formatMoney,
  formatPercentage,
  formatScore,
} from "./display";

describe("formatPercentage", () => {
  it("prints a 0-100 percentage without rescaling it", () => {
    expect(formatPercentage(92.4)).toBe("92.4%");
    expect(formatPercentage(100)).toBe("100%");
    expect(formatPercentage(0)).toBe("0%");
  });

  it("rounds to the requested number of fraction digits", () => {
    expect(formatPercentage(81.55, 1)).toBe("81.6%");
    expect(formatPercentage(81.55, 0)).toBe("82%");
  });

  it("shows an absent marker rather than a zero when there is no number", () => {
    expect(formatPercentage(null)).toBe(ABSENT);
    expect(formatPercentage(undefined)).toBe(ABSENT);
    expect(formatPercentage(Number.NaN)).toBe(ABSENT);
    expect(formatPercentage(Number.POSITIVE_INFINITY)).toBe(ABSENT);
  });
});

describe("formatScore", () => {
  it("prints an integer score", () => {
    expect(formatScore(78)).toBe("78");
    expect(formatScore(0)).toBe("0");
  });

  it("prints the absent marker for a candidate with insufficient data", () => {
    expect(formatScore(null)).toBe(ABSENT);
    expect(formatScore(undefined)).toBe(ABSENT);
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(0)).toBe("0");
  });

  it("prints the absent marker for no number", () => {
    expect(formatCount(null)).toBe(ABSENT);
    expect(formatCount(Number.NaN)).toBe(ABSENT);
  });
});

describe("formatMoney", () => {
  it("prints an amount with its currency", () => {
    expect(formatMoney(2.5, "EUR")).toBe("€2.50");
    expect(formatMoney(0, "EUR")).toBe("€0.00");
  });

  it("refuses to guess a currency", () => {
    expect(formatMoney(2.5, null)).toBe(ABSENT);
    expect(formatMoney(2.5, "")).toBe(ABSENT);
    expect(formatMoney(null, "EUR")).toBe(ABSENT);
  });
});

describe("formatDateTime and formatDate", () => {
  it("prints an ISO instant to the minute in UTC", () => {
    expect(formatDateTime("2026-08-29T18:02:00Z")).toBe("29 Aug 2026, 18:02");
  });

  it("prints an ISO date as a day", () => {
    expect(formatDate("2026-08-29")).toBe("29 Aug 2026");
  });

  it("prints the absent marker for empty and unparseable input", () => {
    expect(formatDateTime(null)).toBe(ABSENT);
    expect(formatDateTime("")).toBe(ABSENT);
    expect(formatDateTime("not a date")).toBe(ABSENT);
    expect(formatDate(undefined)).toBe(ABSENT);
    expect(formatDate("nonsense")).toBe(ABSENT);
  });
});

describe("formatMatchStatus", () => {
  it("turns the wire vocabulary into a sentence-cased label", () => {
    expect(formatMatchStatus("matching")).toBe("Matching");
    expect(formatMatchStatus("not_matching")).toBe("Not matching");
    expect(formatMatchStatus("insufficient_data")).toBe("Insufficient data");
  });

  it("survives an empty status without throwing", () => {
    expect(formatMatchStatus("")).toBe("");
  });
});
