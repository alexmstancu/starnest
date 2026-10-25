import { describe, expect, it } from "vitest";
import { type Item, type RemedyKind, groupBy, keyOf, levelOf, pairsOf, proposalFor } from "./runScope";

const failure = (
  candidate: string,
  attribute: string,
  data_source = "eurostat",
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

describe("the proposal a selection becomes (PL-124)", () => {
  const SEVEN = new Map<string, number | null>([
    ["country.portugal|rent", 7],
    ["country.portugal|tax", 7],
    ["country.spain|rent", 6],
    ["country.malta|rent", null],
  ]);

  it("names each pair once, however many sources failed on it", () => {
    expect(
      pairsOf([
        failure("country.portugal", "tax", "oecd"),
        failure("country.portugal", "tax", "eurostat_estimate"),
        failure("country.portugal", "rent", "eurostat"),
      ]),
    ).toEqual([
      { candidate: "country.portugal", attribute: "tax" },
      { candidate: "country.portugal", attribute: "rent" },
    ]);
  });

  it("retries the one run a selection belongs to, over exactly its pairs", () => {
    const proposal = proposalFor(
      "country",
      "failed",
      [failure("country.portugal", "rent", "eurostat"), failure("country.portugal", "tax", "oecd")],
      SEVEN,
    );

    expect(proposal).toEqual({
      via: "retry",
      level: "country",
      runId: 7,
      items: "failed",
      pairs: [
        { candidate: "country.portugal", attribute: "rent" },
        { candidate: "country.portugal", attribute: "tax" },
      ],
    });
    expect(levelOf(proposal)).toBe("country");
  });

  it("asks unanswered items again through their run's retry", () => {
    const proposal = proposalFor("country", "unanswered", [failure("country.spain", "rent")], SEVEN);

    expect(proposal).toMatchObject({ via: "retry", runId: 6, items: "unanswered" });
  });

  it.each<[string, RemedyKind, Item[]]>([
    ["a selection spanning two runs", "failed", [failure("country.portugal", "rent"), failure("country.spain", "rent")]],
    ["a pair no run has asked about", "unanswered", [failure("country.malta", "rent")]],
    ["what was never reached", "not_reached", [failure("country.portugal", "rent")]],
  ])("scopes %s to its exact pairs", (_, kind, items) => {
    const proposal = proposalFor("city", kind, items, SEVEN);

    expect(proposal).toEqual({ via: "scoped", scope: { level: "city", pairs: pairsOf(items) } });
    expect(levelOf(proposal)).toBe("city");
  });

  it("scopes an empty selection to no pair, never to the whole level", () => {
    expect(proposalFor("country", "failed", [], SEVEN)).toEqual({
      via: "scoped",
      scope: { level: "country", pairs: [] },
    });
  });
});
