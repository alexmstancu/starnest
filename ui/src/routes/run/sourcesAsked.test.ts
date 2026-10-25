import { describe, expect, it } from "vitest";
import { describeSourcesAsked } from "./sourcesAsked";

describe("the sources an armed acquisition would ask (PL-124)", () => {
  const NAMES = new Map([
    ["eurostat", "Eurostat"],
    ["oecd", "OECD"],
  ]);

  it("names each source as the catalog does, with its items", () => {
    expect(
      describeSourcesAsked(
        {
          by_source: [
            { data_source: "eurostat", items: 2 },
            { data_source: "oecd", items: 1 },
            { data_source: "llm", items: 1 },
          ],
        },
        NAMES,
      ),
    ).toBe("It asks Eurostat about 2 items, OECD about 1 item and Llm about 1 item.");
  });

  it("says nothing when the plan names no source", () => {
    expect(describeSourcesAsked({ by_source: [] }, NAMES)).toBe("");
    expect(describeSourcesAsked({}, NAMES)).toBe("");
  });
});
