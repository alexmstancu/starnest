import { describe, expect, it } from "vitest";
import { type Item, groupBy, keyOf, questionsIn, scopeFor } from "./runScope";

const failure = (
  candidate: string,
  attribute: string,
  data_source: string,
): Item => ({ candidate, attribute, data_source });

describe("naming one item", () => {
  it("distinguishes two items that share a candidate", () => {
    expect(keyOf(failure("country.portugal", "a", "eurostat"))).not.toBe(
      keyOf(failure("country.portugal", "b", "eurostat")),
    );
  });

  it("distinguishes the same attribute refused by two sources", () => {
    expect(keyOf(failure("country.portugal", "a", "eurostat"))).not.toBe(
      keyOf(failure("country.portugal", "a", "oecd")),
    );
  });

  it("names an item with no source at all", () => {
    expect(keyOf({ candidate: "country.malta", attribute: "a" })).toBe(
      "country.malta|a|",
    );
  });
});

describe("grouping what a run could not answer", () => {
  /** A failure is a source refusing, so the useful question is what that source refused. */
  it("groups failures by source", () => {
    const groups = groupBy(
      [
        failure("country.portugal", "a", "eurostat"),
        failure("country.spain", "b", "oecd"),
        failure("country.malta", "c", "eurostat"),
      ],
      "data_source",
    );
    expect(groups.map((group) => group.key)).toEqual(["eurostat", "oecd"]);
    expect(groups[0]?.items).toHaveLength(2);
  });

  /** Nothing refused an unanswered item -- no source covers it -- so the attribute is the question. */
  it("groups unanswered items by attribute", () => {
    const groups = groupBy(
      [
        { candidate: "country.portugal", attribute: "sunshine" },
        { candidate: "country.spain", attribute: "sunshine" },
        { candidate: "country.malta", attribute: "elevation" },
      ],
      "attribute",
    );
    expect(groups.map((group) => group.key)).toEqual(["sunshine", "elevation"]);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("calls a missing source unknown rather than dropping the item", () => {
    const groups = groupBy(
      [{ candidate: "country.malta", attribute: "a" }],
      "data_source",
    );
    expect(groups).toEqual([
      { key: "unknown", items: [{ candidate: "country.malta", attribute: "a" }] },
    ]);
  });

  it("has nothing to group when there is nothing", () => {
    expect(groupBy([], "data_source")).toEqual([]);
  });
});

describe("the scope a selection becomes", () => {
  it("collects the distinct candidates and attributes", () => {
    expect(
      scopeFor("country", [
        failure("country.portugal", "rent", "eurostat"),
        failure("country.portugal", "tax", "oecd"),
        failure("country.spain", "rent", "eurostat"),
      ]),
    ).toEqual({
      level: "country",
      candidates: ["country.portugal", "country.spain"],
      attributes: ["rent", "tax"],
    });
  });

  it("scopes an empty selection to nothing, never to everything", () => {
    // `null` in `RunScope` means "every one at this level", so an empty list must stay an
    // empty list -- turning it into null would sweep the whole level by accident.
    expect(scopeFor("country", [])).toEqual({
      level: "country",
      candidates: [],
      attributes: [],
    });
  });

  /**
   * The honest number. `RunScope` holds candidates and attributes as separate lists, so it
   * asks their product -- and a reader about to spend money gets the real size rather than
   * the flattering one.
   */
  it("reports the product, not the count of items picked", () => {
    const scope = scopeFor("country", [
      failure("country.portugal", "rent", "eurostat"),
      failure("country.spain", "tax", "eurostat"),
    ]);
    expect(questionsIn(scope)).toBe(4);
  });

  it("reports a full rectangle at its face value", () => {
    const scope = scopeFor("country", [
      failure("country.portugal", "rent", "eurostat"),
      failure("country.portugal", "tax", "eurostat"),
    ]);
    expect(questionsIn(scope)).toBe(2);
  });

  it("asks nothing for an empty scope", () => {
    expect(questionsIn({ candidates: [], attributes: [] })).toBe(0);
  });
});
