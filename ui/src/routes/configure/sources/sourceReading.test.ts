import { describe, expect, it } from "vitest";
import { howItAnswers } from "./sourceReading";

/**
 * What a source's row says beside its name.
 *
 * The column used to print two raw enum values chained with a comma -- "structured,
 * official_international" -- so the tests are mostly about what it must never say again.
 */
describe("how a source answers", () => {
  it("says a published dataset is one", () => {
    expect(howItAnswers("structured", true)).toBe("published dataset");
  });

  /** The reason this column exists: a figure a model read off a page is recognisable as one. */
  it("says when the figure came from a model reading the web", () => {
    expect(howItAnswers("llm", true)).toBe("model with web search");
  });

  it("says when a figure was typed by hand", () => {
    expect(howItAnswers("manual", true)).toBe("typed by hand");
  });

  /**
   * A source nobody consults says so instead: how its figures would be come by does not
   * matter while none of them are scored.
   */
  it("says a switched-off source is not consulted, whatever kind it is", () => {
    expect(howItAnswers("structured", false)).toBe("not consulted");
    expect(howItAnswers("llm", false)).toBe("not consulted");
  });

  /**
   * **A kind this client has no words for leaves the column blank**, rather than falling back
   * to the identifier -- which is the fault the module exists to have fixed. A gap a reader
   * can see is better than `official_international` back on the screen.
   */
  it("says nothing at all for a kind it has no words for", () => {
    expect(howItAnswers("satellite", true)).toBe("");
    expect(howItAnswers("", true)).toBe("");
  });

  /** Still "not consulted": the switch is read before the kind, not after. */
  it("says a switched-off source of an unknown kind is not consulted", () => {
    expect(howItAnswers("satellite", false)).toBe("not consulted");
  });
});
