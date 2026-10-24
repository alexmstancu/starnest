import { describe, expect, it } from "vitest";
import {
  attributesWithOwnOrder,
  describeMaxAge,
  describeReach,
  howItAnswers,
  soleSourceOf,
} from "./sourceReading";

/**
 * What a source's row says beside its name.
 *
 * The column used to print two raw enum values chained with a comma -- "structured,
 * official_international" -- so the tests are mostly about what it must never say again.
 */
describe("how a source answers", () => {
  it("says a published dataset is one", () => {
    expect(howItAnswers("structured", "official_international", true)).toBe("published dataset");
  });

  /** The reason this column exists: a figure a model read off a page is recognisable as one. */
  it("says when the figure came from a model reading the web", () => {
    expect(howItAnswers("llm", "llm", true)).toBe("model with web search");
  });

  it("says when a figure was typed by hand", () => {
    expect(howItAnswers("manual", "manual", true)).toBe("typed by hand");
  });

  /** PL-134. The kind alone named an estimate a published dataset, and a transcribed index typed. */
  it("says a derived source works its figures out, whatever its kind", () => {
    expect(howItAnswers("structured", "derived", true)).toBe("worked out from other figures");
  });

  it("says a manual source that is not the household's own copies a publication", () => {
    expect(howItAnswers("manual", "research_index", true)).toBe("copied from a publication");
  });

  /**
   * A source nobody consults says so instead: how its figures would be come by does not
   * matter while none of them are scored.
   */
  it("says a switched-off source is not consulted, whatever kind it is", () => {
    expect(howItAnswers("structured", "official_international", false)).toBe("not consulted");
    expect(howItAnswers("llm", "llm", false)).toBe("not consulted");
  });

  /**
   * **A kind this client has no words for leaves the column blank**, rather than falling back
   * to the identifier -- which is the fault the module exists to have fixed. A gap a reader
   * can see is better than `official_international` back on the screen.
   */
  it("says nothing at all for a kind it has no words for", () => {
    expect(howItAnswers("satellite", "", true)).toBe("");
    expect(howItAnswers("", "", true)).toBe("");
  });

  /** Still "not consulted": the switch is read before the kind, not after. */
  it("says a switched-off source of an unknown kind is not consulted", () => {
    expect(howItAnswers("satellite", "", false)).toBe("not consulted");
  });
});

const ATTRIBUTES = [
  {
    id: "a.tax",
    name: "Tax rate",
    answerable_by: ["oecd"],
    effective_source_priority: ["oecd", "eurostat", "llm"],
    max_age_months: 24,
    manual_entry: false,
  },
  {
    id: "a.rent",
    name: "Rent",
    answerable_by: ["eurostat", "oecd"],
    effective_source_priority: ["eurostat", "oecd", "llm"],
    max_age_months: null,
    manual_entry: true,
  },
  {
    id: "a.jobs",
    name: "Employers",
    answerable_by: ["llm"],
    effective_source_priority: ["llm", "eurostat", "oecd"],
    max_age_months: 12,
    manual_entry: false,
  },
];
const SOURCES = [
  { id: "eurostat", default_priority: 10 },
  { id: "oecd", default_priority: 11 },
  { id: "llm", default_priority: 80 },
];

/** PL-134. What each source can answer, from the catalog. */
describe("what a source answers", () => {
  it("counts the attributes it can fetch", () => {
    expect(describeReach("oecd", ATTRIBUTES)).toBe("2 attributes");
    expect(describeReach("llm", ATTRIBUTES)).toBe("1 attribute");
  });

  it("counts hand entry for the manual source", () => {
    expect(describeReach("manual", ATTRIBUTES)).toBe("1 attribute");
  });

  it("says when it answers nothing yet", () => {
    expect(describeReach("numbeo", ATTRIBUTES)).toBe("answers nothing yet");
  });

  it("names the required attributes only it can fetch", () => {
    expect(soleSourceOf("oecd", ATTRIBUTES, new Set(["a.tax", "a.rent"]))).toEqual(["Tax rate"]);
    expect(soleSourceOf("oecd", ATTRIBUTES, new Set(["a.rent"]))).toEqual([]);
    expect(soleSourceOf("eurostat", ATTRIBUTES, new Set())).toEqual([]);
  });
});

/** PL-135. Attributes whose order is their own, not the global one. */
describe("attributes with their own source order", () => {
  it("lists only the attributes whose order departs from the global one, with their own lead", () => {
    // Rent follows the global order; tax puts OECD ahead of Eurostat, and employers the model.
    expect(attributesWithOwnOrder(ATTRIBUTES, SOURCES)).toEqual([
      { id: "a.tax", name: "Tax rate", leading: ["oecd"], maxAgeMonths: 24 },
      { id: "a.jobs", name: "Employers", leading: ["llm"], maxAgeMonths: 12 },
    ]);
  });

  it("ignores sources it has no priority for", () => {
    expect(
      attributesWithOwnOrder(
        [{ ...ATTRIBUTES[1]!, effective_source_priority: ["company", "eurostat", "llm"] }],
        SOURCES,
      ),
    ).toEqual([]);
  });

  it("finds none in an empty catalog", () => {
    expect(attributesWithOwnOrder([], SOURCES)).toEqual([]);
  });

  it("words a maximum age, and its absence", () => {
    expect(describeMaxAge(1)).toBe("refetched after 1 month");
    expect(describeMaxAge(24)).toBe("refetched after 24 months");
    expect(describeMaxAge(null)).toBe("no maximum age");
    expect(describeMaxAge(undefined)).toBe("no maximum age");
  });
});
