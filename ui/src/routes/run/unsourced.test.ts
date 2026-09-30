import { describe, expect, it } from "vitest";
import { unsourcedAttributes } from "./unsourced";

const sourced = {
  id: "country.rent",
  name: "Rent",
  pillar: "housing",
  effective_source_priority: ["eurostat"],
};
const unsourced = {
  id: "country.tech_product_jobs",
  name: "Product jobs",
  pillar: "career",
  effective_source_priority: [],
};

describe("attributes with nobody to ask", () => {
  it("keeps only the attributes no source covers", () => {
    expect(
      unsourcedAttributes([sourced, unsourced], []).map((each) => each.id),
    ).toEqual(["country.tech_product_jobs"]);
  });

  it("treats a missing priority list as no source", () => {
    expect(
      unsourcedAttributes([{ id: "a", name: "A", pillar: "career" }], []),
    ).toHaveLength(1);
  });

  it("says what each one is worth in the active set", () => {
    const [found] = unsourcedAttributes(
      [unsourced],
      [
        {
          attribute: "country.tech_product_jobs",
          pillar: "career",
          weight: 24.45,
        },
      ],
    );
    expect(found?.weight).toBe(24.45);
  });

  /** An attribute the active set does not score is not worth nothing -- it is not weighed. */
  it("says nothing rather than zero when the set does not score it", () => {
    expect(unsourcedAttributes([unsourced], [])[0]?.weight).toBeNull();
  });

  /** Heaviest first: 45% of a pillar is a different problem from 5%. */
  it("puts the costliest gap first", () => {
    const order = unsourcedAttributes(
      [
        { ...unsourced, id: "light", effective_source_priority: [] },
        { ...unsourced, id: "heavy", effective_source_priority: [] },
      ],
      [
        { attribute: "light", pillar: "career", weight: 5 },
        { attribute: "heavy", pillar: "career", weight: 45 },
      ],
    ).map((each) => each.id);
    expect(order).toEqual(["heavy", "light"]);
  });

  /**
   * The honest framing. Retrying and refreshing cannot conjure an adapter, so the remedy
   * depends on whether the catalog permits a figure typed in by hand.
   */
  it("offers hand entry only where the catalog permits it", () => {
    const [allowed] = unsourcedAttributes(
      [{ ...unsourced, manual_entry: true, value_type: "LabelSet" }],
      [],
    );
    expect(allowed?.manualEntry).toBe(true);
    expect(allowed?.manualKind).toBe("LabelSet");
    expect(allowed?.remedy).toBe("Enter a value by hand");

    const [barred] = unsourcedAttributes([unsourced], []);
    expect(barred?.manualEntry).toBe(false);
    expect(barred?.manualKind).toBeNull();
    expect(barred?.remedy).toMatch(/not permitted/i);
  });

  it("names the two types an editor exists for", () => {
    // Five attributes declare `manual_entry` and their types are LabelSet, AssignedScore and
    // one Quantity that a source already answers. Monetary, Count and Ratio have no attribute
    // that would accept one, so an editor for them would be a form nobody can open.
    const kinds = unsourcedAttributes(
      [
        { ...unsourced, id: "a", manual_entry: true, value_type: "LabelSet" },
        { ...unsourced, id: "b", manual_entry: true, value_type: "AssignedScore" },
      ],
      [],
    ).map((gap) => gap.manualKind);

    expect(kinds).toEqual(["LabelSet", "AssignedScore"]);
  });

  it("says so rather than offering a form that cannot submit", () => {
    // Permitted by the catalog, but no editor built for that type. A button leading to a form
    // with no fields is worse than a sentence saying why there is no button.
    const [gap] = unsourcedAttributes(
      [{ ...unsourced, manual_entry: true, value_type: "Monetary" }],
      [],
    );

    expect(gap?.manualKind).toBeNull();
    expect(gap?.remedy).toMatch(/no editor is built for a Monetary/);
  });

  it("names a pillar even when the attribute has none", () => {
    expect(
      unsourcedAttributes(
        [{ id: "a", name: "A", effective_source_priority: [] }],
        [],
      )[0]?.pillar,
    ).toBe("no pillar");
  });

  it("finds nothing when every attribute has a source", () => {
    expect(unsourcedAttributes([sourced], [])).toEqual([]);
  });
});
