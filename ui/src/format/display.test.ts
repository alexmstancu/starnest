import { describe, expect, it } from "vitest";
import {
  ABSENT,
  deltaTone,
  formatCount,
  formatDate,
  formatDateTime,
  formatIdentifier,
  formatMatchStatus,
  formatMoney,
  formatMoneyPerMonth,
  formatCountInWords,
  formatPercentage,
  formatScore,
  formatSigned,
  attributeName,
  candidateName,
  pillarName,
  criteriaSetName,
  safeHttpUrl,
  sourceName,
} from "./display";

describe("formatPercentage", () => {
  it("prints a 0-100 percentage without rescaling it", () => {
    expect(formatPercentage(92.4)).toBe("92.4%");
    expect(formatPercentage(100)).toBe("100.0%");
    expect(formatPercentage(0)).toBe("0.0%");
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

describe("formatCountInWords", () => {
  it("writes a small count in words, and zero as the caller names it", () => {
    expect(formatCountInWords(2)).toBe("Two");
    expect(formatCountInWords(0, "None")).toBe("None");
    expect(formatCountInWords(0)).toBe("Zero");
  });

  it("falls back to the figure past ten or for a fraction, and to the absent mark", () => {
    expect(formatCountInWords(12)).toBe("12");
    expect(formatCountInWords(1.5)).toBe(formatCount(1.5));
    expect(formatCountInWords(null)).toBe(formatCount(null));
  });
});

describe("formatMoneyPerMonth", () => {
  it("writes whole euros and the period", () => {
    expect(formatMoneyPerMonth(7400, "EUR")).toBe("€7,400 / month");
    expect(formatMoneyPerMonth(2799.6, "EUR")).toBe("€2,800 / month");
  });

  it("shows the absent mark for a missing amount or currency", () => {
    expect(formatMoneyPerMonth(null, "EUR")).toBe(formatMoneyPerMonth(undefined, "EUR"));
    expect(formatMoneyPerMonth(7400, null)).not.toContain("month");
    expect(formatMoneyPerMonth(Number.NaN, "EUR")).not.toContain("month");
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
  /**
   * **The suite runs in Europe/Bucharest** (`vite.config.ts`), three hours east of UTC in
   * summer, so a formatter that went back to UTC prints a different minute and a different
   * day here, rather than passing by coincidence on a machine that happens to be in UTC.
   */
  it("prints an instant to the minute on the reader's clock", () => {
    expect(formatDateTime("2026-08-29T18:02:00Z")).toBe("29 Aug 2026, 21:02");
  });

  it("prints an instant past the reader's midnight as the reader's day", () => {
    expect(formatDate("2026-10-01T22:30:00Z")).toBe("2 Oct 2026");
  });

  it("prints a bare date as the day it names, whatever the reader's clock", () => {
    expect(formatDate("2026-08-29")).toBe("29 Aug 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
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

describe("a link out to a publisher", () => {
  it("keeps an https URL", () => {
    expect(safeHttpUrl("https://rsf.org/en/index")).toBe(
      "https://rsf.org/en/index",
    );
  });

  it("keeps a plain http URL, because some publishers still serve one", () => {
    expect(safeHttpUrl("http://example.org/a")).toBe("http://example.org/a");
  });

  /** The reason this function exists rather than the value going straight into `href`. */
  it("refuses a scheme that would run something", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("refuses a relative path, which would point back into this app", () => {
    expect(safeHttpUrl("/configure")).toBeNull();
    expect(safeHttpUrl("rsf.org")).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
  });
});

describe("what to call a pillar", () => {
  it("uses the catalog's name", () => {
    // `economics` reads "Economy" and `connectivity` reads "Transport". Title-casing the id
    // gives neither, and the difference is a decision somebody made versus a screen guessing.
    const names = new Map([
      ["economics", "Economy"],
      ["connectivity", "Transport"],
    ]);

    expect(pillarName(names, "economics")).toBe("Economy");
    expect(pillarName(names, "connectivity")).toBe("Transport");
  });

  it("falls back to the id made readable when the catalog has not answered", () => {
    // The names are a label; the weights and bars beside them do not wait for it. An empty map
    // is what a failed or in-flight read looks like, and it must not blank the column heads.
    expect(pillarName(new Map(), "governance")).toBe("Governance");
    expect(pillarName(new Map(), "rule_of_law")).toBe("Rule of law");
  });

  it("falls back for a pillar the catalog does not have", () => {
    expect(pillarName(new Map([["housing", "Housing"]]), "nowhere")).toBe(
      "Nowhere",
    );
  });
});

describe("what to call a data source", () => {
  /**
   * RB-4. **The fixture has to be one the fallback cannot produce.** `eurostat` reads
   * "Eurostat" either way, so it would pass with the lookup deleted; the catalog calls
   * `world_bank` "World Bank" and `llm` "LLM with web search", which no title-casing reaches.
   */
  it("uses the catalog's name, which the id cannot be read into", () => {
    const names = new Map([
      ["world_bank", "World Bank"],
      ["llm", "LLM with web search"],
    ]);

    expect(sourceName(names, "world_bank")).toBe("World Bank");
    expect(sourceName(names, "llm")).toBe("LLM with web search");
  });

  it("falls back to the id made readable, never the id, when the catalog has not answered", () => {
    // An empty map is what a failed or in-flight read looks like, and the column beside a
    // figure must still say something a person would write.
    expect(sourceName(new Map(), "world_bank")).toBe("World bank");
    expect(sourceName(new Map(), "eurostat_estimate")).toBe("Eurostat estimate");
  });

  it("falls back for a source the catalog does not have", () => {
    expect(sourceName(new Map([["eurostat", "Eurostat"]]), "oecd")).toBe("Oecd");
  });
});

describe("which way a difference goes", () => {
  it("calls a positive difference ahead and a negative one behind", () => {
    expect(deltaTone(3)).toBe("ahead");
    expect(deltaTone(-3)).toBe("behind");
  });

  it("calls no difference level rather than ahead", () => {
    // **The case Compare got wrong** (P83): a null delta fell into the `else` and rendered
    // "—" in green, the screen claiming a lead it has nothing to support.
    expect(deltaTone(0)).toBe("level");
    expect(deltaTone(null)).toBe("level");
    expect(deltaTone(undefined)).toBe("level");
    expect(deltaTone(Number.NaN)).toBe("level");
  });
});

describe("a delta, signed", () => {
  // **One formatter for every signed number on every screen** (PL-080): the true minus sign,
  // the figure's own precision, and never a signed zero.
  it.each([
    // value, precision, printed
    [3.5, 1, "+3.5"],
    [-3.5, 1, "\u22123.5"],
    [4, 1, "+4.0"],
    [4, 2, "+4.00"],
    [11, 0, "+11"],
    [-8, 0, "\u22128"],
    [1234.5, 1, "+1,234.5"],
    // Zero, and anything that rounds to it, reads as neither direction.
    [0, 1, "0.0"],
    [0, 0, "0"],
    [-0, 0, "0"],
    [-0.04, 1, "0.0"],
    [0.04, 1, "0.0"],
    [-0.3, 0, "0"],
    // Half away from zero on both sides, so a gain and a loss of one size read alike.
    [0.25, 1, "+0.3"],
    [-0.25, 1, "\u22120.3"],
    // A figure's own precision: up to two decimals, trailing zeros dropped, as a figure reads.
    [130, "figure", "+130"],
    [13.4, "figure", "+13.4"],
    [-0.03, "figure", "\u22120.03"],
    [1.036, "figure", "+1.04"],
    [-0.004, "figure", "0"],
  ] as const)("prints %s at %s as %s", (value, precision, printed) => {
    expect(formatSigned(value, precision)).toBe(printed);
  });

  it("takes one decimal when no precision is named", () => {
    expect(formatSigned(-3.5)).toBe("\u22123.5");
  });

  it("never uses the hyphen-minus, which is narrower than the plus", () => {
    expect(formatSigned(-2, 0)).not.toContain("-");
  });

  it("marks an absent delta rather than printing a zero for it", () => {
    // A zero here would sit in a column of real differences looking like one.
    expect(formatSigned(null)).toBe(ABSENT);
    expect(formatSigned(undefined)).toBe(ABSENT);
    expect(formatSigned(Number.NaN)).toBe(ABSENT);
    expect(formatSigned(Number.POSITIVE_INFINITY)).toBe(ABSENT);
  });
});

describe("a catalog identifier as a name", () => {
  it("capitalises and unpicks the underscores", () => {
    expect(formatIdentifier("local_employment")).toBe("Local employment");
    expect(formatIdentifier("country")).toBe("Country");
  });

  it("capitalises only the first word, because this is a name and not a title", () => {
    expect(formatIdentifier("rule_of_law")).toBe("Rule of law");
  });

  it("leaves an already readable word alone", () => {
    expect(formatIdentifier("Housing")).toBe("Housing");
  });

  it("does not throw on an empty identifier", () => {
    expect(formatIdentifier("")).toBe("");
  });
});

describe("naming an attribute", () => {
  /** The design's rule: "No programmatic identifiers in rendered text." */
  /**
   * **The fixture has to be one the fallback cannot produce.** This test was written with
   * `country.average_working_hours` → "Average working hours", which is exactly what
   * `formatIdentifier` makes of the id — so it passed with the lookup stubbed to always miss,
   * and proved only that the fallback works. The catalog calls
   * `country.total_tax_rate_effective` **"Total effective tax rate"**: the same five words in a
   * different order, which no title-casing of the id can reach.
   */
  it("uses the catalog's name, which the id cannot be read into", () => {
    const names = new Map([
      ["country.total_tax_rate_effective", "Total effective tax rate"],
    ]);

    expect(attributeName(names, "country.total_tax_rate_effective")).toBe(
      "Total effective tax rate",
    );
    // What the fallback would have said, so the two are visibly different.
    expect(attributeName(new Map(), "country.total_tax_rate_effective")).toBe(
      "Total tax rate effective",
    );
  });

  /**
   * **The fallback is the whole reason this is not `formatIdentifier`.** An attribute id
   * carries its level, so title-casing the whole string gives "Country.average working hours"
   * -- worse than the id it set out to improve on, and the kind of thing that ships because
   * nobody looked at the fallback path.
   */
  it("drops the level prefix when the catalog has not answered", () => {
    expect(attributeName(new Map(), "country.average_working_hours")).toBe(
      "Average working hours",
    );
    expect(attributeName(new Map(), "city.rent_one_bedroom")).toBe(
      "Rent one bedroom",
    );
  });

  it("falls back for an attribute the catalog does not have", () => {
    const names = new Map([["country.homicide_rate", "Homicide rate"]]);

    expect(attributeName(names, "country.nothing_here")).toBe("Nothing here");
  });

  /** An empty name is the same absence as a missing one, and reads worse: a blank cell. */
  it("falls back when the catalog holds an empty name", () => {
    expect(attributeName(new Map([["country.rent", ""]]), "country.rent")).toBe(
      "Rent",
    );
  });

  it("copes with an id carrying no level at all", () => {
    expect(attributeName(new Map(), "rent")).toBe("Rent");
  });
});

describe("naming a candidate", () => {
  /** Same hole, same fix: "Malta" is what the fallback produces too. "United Kingdom" is not. */
  it("uses the catalog's name, which the id cannot be read into", () => {
    const names = new Map([["country.united_kingdom", "United Kingdom"]]);

    expect(candidateName(names, "country.united_kingdom")).toBe(
      "United Kingdom",
    );
    // The fallback title-cases only the first word, so the K is the difference.
    expect(candidateName(new Map(), "country.united_kingdom")).toBe(
      "United kingdom",
    );
  });

  it("drops the level prefix when the catalog has not answered", () => {
    expect(candidateName(new Map(), "country.united_kingdom")).toBe(
      "United kingdom",
    );
  });

  it("falls back when the catalog holds an empty name", () => {
    expect(candidateName(new Map([["country.malta", ""]]), "country.malta")).toBe(
      "Malta",
    );
  });
});

/** PL-070. A criteria set by the name the list gives it, never its id. */
describe("a criteria set's name", () => {
  it("reads the name the set list holds, so a rename is followed", () => {
    expect(criteriaSetName(new Map([["default", "Everyday life"]]), "default")).toBe(
      "Everyday life",
    );
  });

  /** The list can be loading, or the set deleted since; the id then reads as words. */
  it("falls back to the id made readable, hyphens and underscores alike", () => {
    expect(criteriaSetName(new Map(), "remote-only")).toBe("Remote only");
    expect(criteriaSetName(new Map(), "local_employment")).toBe("Local employment");
  });

  it("does not take an empty name for a name", () => {
    expect(criteriaSetName(new Map([["default", ""]]), "default")).toBe("Default");
  });
});
