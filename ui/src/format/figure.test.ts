/**
 * Every one of the ten value types, rendered.
 *
 * **This file had no tests at all**, which is how P57 shipped and how it then shipped again:
 * `Index` and `AssignedScore` were fixed and `Ratio` and `Boolean` were left in the bare
 * branch that drops everything but the number. One test per type is the only thing that makes
 * "all ten are handled" a fact rather than a claim, because the dispatch is a chain of `in`
 * checks whose order decides the answer.
 */

import { describe, expect, it } from "vitest";
import { describeFigure } from "./figure";
import { ABSENT } from "./display";

describe("one payload as one line", () => {
  it("renders a Quantity with its unit made readable", () => {
    // The unit's underscores become spaces; a known token reads better still.
    expect(describeFigure({ payload: { magnitude: 1250, unit: "eur_per_month" } })).toBe(
      "1250 eur per month",
    );
    expect(
      describeFigure({ payload: { magnitude: 0.38, unit: "per_100000_population" } }),
    ).toBe("0.38 per 100,000");
  });

  it("rounds a figure to what a person reads, not the wire's precision", () => {
    // The server sends 30.80604044947752; two decimals, trailing zeros trimmed.
    expect(
      describeFigure({ payload: { value: 30.80604044947752, basis: "labour_cost" } }),
    ).toBe("30.81% of Labour cost");
    expect(
      describeFigure({
        payload: {
          value: 1.036044,
          provider: "World Bank WGI",
          scale_min: -2.5,
          scale_max: 2.5,
        },
      }),
    ).toBe("1.04 on -2.5–2.5 (World Bank WGI)");
    // A whole or already-short number is left alone.
    expect(describeFigure({ payload: { magnitude: 3.8, unit: "percent_per_year" } })).toBe(
      "3.8 % per year",
    );
  });

  it("renders a Monetary with its currency", () => {
    expect(
      describeFigure({ payload: { amount: 1250, amount_eur: 1250, currency: "EUR" } }),
    ).toBe("1250 EUR");
  });

  it("renders a Count", () => {
    expect(describeFigure({ payload: { count: 412 } })).toBe("412");
  });

  it("renders a Count's basis when it has one", () => {
    // 412 protected areas and 412 per capita are different figures.
    expect(describeFigure({ payload: { count: 412, basis: "per_capita" } })).toBe(
      "412 per Per capita",
    );
  });

  it("renders a Ratio as a share of its basis", () => {
    // **The basis is required by the contract** and was dropped (P78): a bare `17.3` reads
    // like a score, a temperature or a percentage of anything at all.
    expect(describeFigure({ payload: { value: 17.3, basis: "land_area" } })).toBe(
      "17.3% of Land area",
    );
  });

  it("renders an Index on its provider's scale", () => {
    expect(
      describeFigure({
        payload: { value: 1.07, scale_min: -2.5, scale_max: 2.5, provider: "World Bank" },
      }),
    ).toBe("1.07 on -2.5–2.5 (World Bank)");
  });

  it("renders an AssignedScore with its range and who assigned it", () => {
    // A 7 of 10 from a model is a different claim from a 7 of 10 somebody wrote down.
    expect(
      describeFigure({
        payload: { value: 7, range_min: 0, range_max: 10, assigned_by: "human" },
      }),
    ).toBe("7 on 0–10 (assigned by human)");
  });

  it("renders a Boolean as an answer, not as the wire word", () => {
    expect(describeFigure({ payload: { value: true } })).toBe("Yes");
    expect(describeFigure({ payload: { value: false } })).toBe("No");
  });

  it("renders a LabelSet as its labels", () => {
    expect(describeFigure({ payload: { labels: ["Siemens", "Critical TechWorks"] } })).toBe(
      "Siemens, Critical TechWorks",
    );
  });

  it("renders a ShareComposition as its shares", () => {
    expect(
      describeFigure({
        payload: {
          shares: [
            { label: "renewable", share: 61 },
            { label: "fossil", share: 39 },
          ],
        },
      }),
    ).toBe("renewable 61%, fossil 39%");
  });

  it("renders Text as its body", () => {
    expect(describeFigure({ payload: { body: "a sentence the source wrote" } })).toBe(
      "a sentence the source wrote",
    );
  });
});

describe("what it does with nothing to render", () => {
  it("marks a payload it does not recognise as absent", () => {
    expect(describeFigure({ payload: { surprising: 1 } })).toBe(ABSENT);
  });

  it("marks an empty payload as absent", () => {
    expect(describeFigure({ payload: {} })).toBe(ABSENT);
  });

  it("does not throw on a null payload", () => {
    // The contract always sends one, so this is about not taking the screen down when the
    // contract is wrong -- a provenance panel is the wrong place to discover a server bug.
    expect(() => describeFigure({ payload: null })).not.toThrow();
  });

  it("renders a Boolean false rather than treating it as missing", () => {
    // The trap in a chain of truthiness checks: `false` is a real answer.
    expect(describeFigure({ payload: { value: false } })).not.toBe(ABSENT);
  });

  it("renders a zero rather than treating it as missing", () => {
    expect(describeFigure({ payload: { count: 0 } })).toBe("0");
    expect(describeFigure({ payload: { value: 0, basis: "workforce" } })).toBe(
      "0% of Workforce",
    );
  });

  it("renders an empty LabelSet without inventing a figure", () => {
    expect(describeFigure({ payload: { labels: [] } })).toBe("");
  });
});
