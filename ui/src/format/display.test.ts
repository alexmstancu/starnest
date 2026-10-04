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
  formatPercentage,
  formatScore,
  formatSigned,
  attributeName,
  candidateName,
  pillarName,
  safeHttpUrl,
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
  it("writes a plus on a gain, because a signed number reads as a direction", () => {
    expect(formatSigned(3.5)).toBe("+3.5");
  });

  it("keeps the minus a negative already has, rather than adding a second", () => {
    expect(formatSigned(-3.5)).toBe("-3.5");
  });

  it("gives zero no sign, because it is neither direction", () => {
    expect(formatSigned(0)).toBe("0.0");
  });

  it("keeps the decimal place, so a column of deltas lines up", () => {
    expect(formatSigned(4)).toBe("+4.0");
    expect(formatSigned(4, 2)).toBe("+4.00");
  });

  it("marks an absent delta rather than printing a zero for it", () => {
    // A zero here would sit in a column of real differences looking like one.
    expect(formatSigned(null)).toBe(ABSENT);
    expect(formatSigned(undefined)).toBe(ABSENT);
    expect(formatSigned(Number.NaN)).toBe(ABSENT);
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
