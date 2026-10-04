import { describe, expect, it } from "vitest";
import type { Candidate } from "../../../api/endpoints";
import {
  candidateOptions,
  chosenName,
  citizenshipIds,
  isAStranger,
  matching,
  onlyPlaceNameCharacters,
  withCitizenship,
  withoutCitizenship,
} from "./candidateOptions";

const ROSTER = [
  { id: "country.portugal", name: "Portugal", level: "country" },
  { id: "country.united_kingdom", name: "United Kingdom", level: "country" },
  { id: "country.austria", name: "Austria", level: "country" },
  { id: "city.porto", name: "Porto", level: "city" },
] as unknown as Candidate[];

const COUNTRIES = candidateOptions(ROSTER, "country");

describe("the roster a place field may choose from", () => {
  it("offers one level at a time", () => {
    expect(COUNTRIES.map((each) => each.id)).toEqual([
      "country.austria",
      "country.portugal",
      "country.united_kingdom",
    ]);
  });

  it("offers them by name, not by id", () => {
    // Sorted "Austria, Portugal, United Kingdom". Sorting by id would put united_kingdom
    // before any country whose name starts later in the alphabet than its id does.
    expect(COUNTRIES.map((each) => each.name)).toEqual([
      "Austria",
      "Portugal",
      "United Kingdom",
    ]);
  });

  it("offers nothing for a level the roster has none of", () => {
    expect(candidateOptions(ROSTER, "region")).toEqual([]);
  });
});

describe("what a reader may type into a place field", () => {
  it("keeps letters, spaces, hyphens and apostrophes", () => {
    expect(onlyPlaceNameCharacters("Bosnia-Herzegovina")).toBe(
      "Bosnia-Herzegovina",
    );
    expect(onlyPlaceNameCharacters("Côte d'Ivoire")).toBe("Côte d'Ivoire");
  });

  /** The owner's complaint: "I could write there my telephone number if I wanted to, a poem." */
  it("drops digits and punctuation, which cannot narrow anything", () => {
    expect(onlyPlaceNameCharacters("+40 721 123 456")).toBe("   ");
    expect(onlyPlaceNameCharacters("Portugal!!")).toBe("Portugal");
  });

  it("keeps an empty field empty rather than refusing it", () => {
    expect(onlyPlaceNameCharacters("")).toBe("");
  });
});

describe("narrowing the list as it is typed", () => {
  it("offers everything before anything is typed", () => {
    expect(matching(COUNTRIES, "")).toHaveLength(3);
  });

  it("ignores case", () => {
    expect(matching(COUNTRIES, "AUSTRIA").map((e) => e.id)).toEqual([
      "country.austria",
    ]);
  });

  /** A reader looking for "United Kingdom" may well type "kingdom". */
  it("matches anywhere in the name, not only the start", () => {
    expect(matching(COUNTRIES, "kingdom").map((e) => e.id)).toEqual([
      "country.united_kingdom",
    ]);
  });

  it("ignores accents, so an unaccented keyboard still finds the place", () => {
    const accented = candidateOptions(
      [{ id: "country.cote", name: "Côte", level: "country" }] as Candidate[],
      "country",
    );

    expect(matching(accented, "cote")).toHaveLength(1);
  });

  it("offers nothing when nothing matches, rather than everything", () => {
    expect(matching(COUNTRIES, "atlantis")).toEqual([]);
  });

  it("treats whitespace alone as nothing typed", () => {
    expect(matching(COUNTRIES, "   ")).toHaveLength(3);
  });
});

describe("showing an id that is already stored", () => {
  it("shows the name", () => {
    expect(chosenName(COUNTRIES, "country.austria")).toBe("Austria");
  });

  it("shows nothing for an unanswered field", () => {
    expect(chosenName(COUNTRIES, "")).toBe("");
  });

  /** Better the id than a blank box: a reader must be able to see what is actually stored. */
  it("falls back to the id for a value the roster does not hold", () => {
    expect(chosenName(COUNTRIES, "country.atlantis")).toBe("country.atlantis");
  });
});

describe("telling a reader their stored value is not a real place", () => {
  it("accuses a value the roster does not hold", () => {
    expect(isAStranger(COUNTRIES, "country.atlantis")).toBe(true);
  });

  it("does not accuse a real one", () => {
    expect(isAStranger(COUNTRIES, "country.austria")).toBe(false);
  });

  /** Unanswered is not wrong; the two have different remedies and read differently. */
  it("does not accuse an empty field", () => {
    expect(isAStranger(COUNTRIES, "")).toBe(false);
  });

  /**
   * **The sad path that would have been a false accusation.** The roster is fetched, so for
   * the first render it is empty — and accusing every stored value during that moment would
   * flash a warning on a perfectly good record every time the panel opened.
   */
  it("accuses nobody while the roster has not arrived", () => {
    expect(isAStranger([], "country.austria")).toBe(false);
  });
});

describe("the passports a household holds", () => {
  it("reads a comma-separated field", () => {
    expect(citizenshipIds("country.romania, country.austria")).toEqual([
      "country.romania",
      "country.austria",
    ]);
  });

  it("reads an empty field as none, not as one blank", () => {
    expect(citizenshipIds("")).toEqual([]);
    expect(citizenshipIds("  ,  ")).toEqual([]);
  });

  it("adds one", () => {
    expect(withCitizenship("country.romania", "country.austria")).toBe(
      "country.romania, country.austria",
    );
  });

  it("adds the first one to an empty field without a leading comma", () => {
    expect(withCitizenship("", "country.romania")).toBe("country.romania");
  });

  /** Dual citizenship is two passports, never the same one twice. */
  it("refuses a duplicate", () => {
    expect(withCitizenship("country.romania", "country.romania")).toBe(
      "country.romania",
    );
  });

  it("removes one, leaving the others", () => {
    expect(
      withoutCitizenship("country.romania, country.austria", "country.romania"),
    ).toBe("country.austria");
  });

  it("removing the only one leaves the field empty", () => {
    expect(withoutCitizenship("country.romania", "country.romania")).toBe("");
  });

  it("removing one that is not there changes nothing", () => {
    expect(withoutCitizenship("country.romania", "country.spain")).toBe(
      "country.romania",
    );
  });
});
