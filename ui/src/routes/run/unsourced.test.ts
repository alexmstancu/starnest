import { describe, expect, it } from "vitest";
import { handEnterable, unsourcedAttributes } from "./unsourced";

/**
 * Every source in every attribute's priority, as the server resolves it since BE-39: an
 * attribute's own overrides lead and every other source follows, `manual` and `llm` included.
 * **So the order says nothing about who can fetch an attribute** -- `answerable_by` does
 * (`reqs.md` Q235), and these fixtures carry both so a test can tell which one was read.
 */
const EVERY_SOURCE = ["eurostat", "oecd", "manual", "llm"];

const fetchable = {
  id: "country.rent",
  name: "Rent",
  pillar: "housing",
  effective_source_priority: EVERY_SOURCE,
  answerable_by: ["eurostat"],
};
const unfetchable = {
  id: "country.tech_product_jobs",
  name: "Product jobs",
  pillar: "career",
  effective_source_priority: EVERY_SOURCE,
  answerable_by: [] as string[],
};

describe("attributes with nobody to ask", () => {
  it("lists an attribute nothing can fetch even though every source is in its priority", () => {
    expect(
      unsourcedAttributes([fetchable, unfetchable], []).map((each) => each.id),
    ).toEqual(["country.tech_product_jobs"]);
  });

  it("leaves out an attribute a source can fetch", () => {
    expect(unsourcedAttributes([fetchable], [])).toEqual([]);
  });

  /**
   * **Absent is "not said", never "nothing".** A catalog that left the field out has made no
   * claim, and reading one into it would report a gap in the answer as a gap in the data.
   */
  it("claims nothing when the catalog does not say", () => {
    expect(
      unsourcedAttributes([{ id: "a", name: "A", pillar: "career" }], []),
    ).toEqual([]);
  });

  it("says what each one is worth in the active set", () => {
    const [found] = unsourcedAttributes(
      [unfetchable],
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
    expect(unsourcedAttributes([unfetchable], [])[0]?.weight).toBeNull();
  });

  /** Heaviest first: 45% of a pillar is a different problem from 5%. */
  it("puts the costliest gap first", () => {
    const order = unsourcedAttributes(
      [
        { ...unfetchable, id: "light" },
        { ...unfetchable, id: "heavy" },
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
      [{ ...unfetchable, manual_entry: true, value_type: "LabelSet" }],
      [],
    );
    expect(allowed?.manualEntry).toBe(true);
    expect(allowed?.manualKind).toBe("LabelSet");
    expect(allowed?.remedy).toBe("Enter a value by hand");

    const [barred] = unsourcedAttributes([unfetchable], []);
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
        { ...unfetchable, id: "a", manual_entry: true, value_type: "LabelSet" },
        { ...unfetchable, id: "b", manual_entry: true, value_type: "AssignedScore" },
      ],
      [],
    ).map((gap) => gap.manualKind);

    expect(kinds).toEqual(["LabelSet", "AssignedScore"]);
  });

  it("says so rather than offering a form that cannot submit", () => {
    // Permitted by the catalog, but no editor built for that type. A button leading to a form
    // with no fields is worse than a sentence saying why there is no button.
    const [gap] = unsourcedAttributes(
      [{ ...unfetchable, manual_entry: true, value_type: "Monetary" }],
      [],
    );

    expect(gap?.manualKind).toBeNull();
    expect(gap?.remedy).toMatch(/no editor is built for a Monetary/);
  });

  it("names a pillar even when the attribute has none", () => {
    expect(
      unsourcedAttributes([{ id: "a", name: "A", answerable_by: [] }], [])[0]
        ?.pillar,
    ).toBe("no pillar");
  });
});

describe("attributes a person may answer", () => {
  const employers = {
    id: "country.international_employers",
    name: "International employers",
    pillar: "career",
    value_type: "LabelSet",
    manual_entry: true,
    effective_source_priority: ["llm", "company_website", "eurostat", "manual"],
    answerable_by: ["llm"],
  };
  const residency = {
    id: "country.residency_admin_ease",
    name: "Residency admin ease",
    pillar: "governance",
    value_type: "AssignedScore",
    manual_entry: true,
    effective_source_priority: ["national_law", "world_bank", ...EVERY_SOURCE],
    answerable_by: [] as string[],
  };

  /**
   * **What can fetch it, not who is ranked.** The order names every source -- `manual` among
   * them, which is this very form, and `company_website`, a catalog row no adapter stands
   * behind -- so printing it offered typing by hand as the alternative to typing by hand.
   */
  it("names what can fetch it, not the whole priority order", () => {
    expect(handEnterable([employers])[0]?.otherwise).toBe("Otherwise: llm");
  });

  it("says plainly when nothing else would answer it", () => {
    expect(handEnterable([residency])[0]?.otherwise).toBe(
      "Nothing else would answer it",
    );
  });

  it("claims nothing about other sources when the catalog does not say", () => {
    const { answerable_by: _unsaid, ...unsaid } = residency;
    expect(handEnterable([unsaid])[0]?.otherwise).toBe("");
  });

  /** Only where a form can open: permitted by the catalog, and an editor built for the type. */
  it("offers only what a form exists for, by name", () => {
    const listed = handEnterable([
      residency,
      employers,
      { ...employers, id: "barred", manual_entry: false },
      { ...employers, id: "no_editor", value_type: "Quantity" },
    ]).map((each) => each.id);

    expect(listed).toEqual([
      "country.international_employers",
      "country.residency_admin_ease",
    ]);
  });
});
