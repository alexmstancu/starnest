import { describe, expect, it } from "vitest";
import { tagByImpact } from "./synthesisImpact";

const worth = (name: string, points: string) =>
  `${name}: 82 against 41, worth ${points} points`;

describe("marking the lines that move the total most", () => {
  /**
   * The point of merging the two lists. Each arrives ordered on its own, so the largest
   * disadvantage can sit second overall while both lists call it first.
   */
  it("ranks an advantage and a disadvantage against each other", () => {
    const tagged = tagByImpact(
      [worth("Cost of living", "+4.9"), worth("Coastline access", "+0.2")],
      [worth("Broadband coverage", "-1.8")],
    );

    expect(tagged.advantages.map((line) => line.tag)).toEqual(["#1", "#3"]);
    expect(tagged.disadvantages.map((line) => line.tag)).toEqual(["#2"]);
  });

  it("hands every sentence back unchanged", () => {
    const advantages = [worth("Cost of living", "+4.9")];
    const disadvantages = [worth("Broadband coverage", "-1.8")];

    const tagged = tagByImpact(advantages, disadvantages);

    expect(tagged.advantages.map((line) => line.line)).toEqual(advantages);
    expect(tagged.disadvantages.map((line) => line.line)).toEqual(disadvantages);
  });

  it("marks three lines at most, however many there are", () => {
    const tagged = tagByImpact(
      [
        worth("A", "+9"),
        worth("B", "+8"),
        worth("C", "+7"),
        worth("D", "+6"),
      ],
      [],
    );

    expect(tagged.advantages.map((line) => line.tag)).toEqual([
      "#1",
      "#2",
      "#3",
      null,
    ]);
  });

  it("marks what there is when there are fewer than three", () => {
    const tagged = tagByImpact([worth("A", "+9")], []);

    expect(tagged.advantages[0]?.tag).toBe("#1");
  });

  /** Five points behind moves the total exactly as far as five points ahead. */
  it("ranks on the size of the gap, not on its direction", () => {
    const tagged = tagByImpact(
      [worth("Small gain", "+0.4")],
      [worth("Large loss", "-7.2")],
    );

    expect(tagged.disadvantages[0]?.tag).toBe("#1");
    expect(tagged.advantages[0]?.tag).toBe("#2");
  });

  /** The server breaks its own ties deterministically; a tie here must not undo that. */
  it("keeps the server's order between two lines worth the same", () => {
    const tagged = tagByImpact(
      [worth("First named", "+3.0"), worth("Second named", "+3.0")],
      [],
    );

    expect(tagged.advantages.map((line) => line.tag)).toEqual(["#1", "#2"]);
  });
});

describe("when a sentence cannot be read", () => {
  /**
   * The unreadable line could be the largest of them all, so a "#1" anywhere else would be
   * this screen's invention rather than the server's arithmetic.
   */
  it("marks nothing at all rather than ranking what it could read", () => {
    const tagged = tagByImpact(
      [worth("Cost of living", "+4.9"), "A sentence in some other shape"],
      [worth("Broadband coverage", "-1.8")],
    );

    expect(tagged.advantages.every((line) => line.tag === null)).toBe(true);
    expect(tagged.disadvantages.every((line) => line.tag === null)).toBe(true);
  });

  it("still hands the sentences through", () => {
    const tagged = tagByImpact(["Something else entirely"], []);

    expect(tagged.advantages[0]?.line).toBe("Something else entirely");
  });
});

describe("when there is no synthesis to mark", () => {
  it("answers with two empty lists rather than throwing", () => {
    expect(tagByImpact(undefined, undefined)).toEqual({
      advantages: [],
      disadvantages: [],
    });
    expect(tagByImpact(null, [])).toEqual({ advantages: [], disadvantages: [] });
  });
});
