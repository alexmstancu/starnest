import { describe, expect, it } from "vitest";
import { handEnterable, unsourcedAttributes, WEIGHTS_PENDING } from "./unsourced";

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

  /**
   * PL-088 (UF-092). **A criterion the set keeps but does not score claims no share** of its
   * pillar: its stored weight is what it would carry, not what it carries.
   */
  it("reads a criterion the set does not score as not scored here", () => {
    const [found] = unsourcedAttributes(
      [unfetchable],
      [{ attribute: "country.tech_product_jobs", pillar: "career", weight: 20, is_scored: false }],
    );
    expect(found?.weight).toBeNull();
  });

  it("states each one's type in words", () => {
    const [found] = unsourcedAttributes(
      [{ ...unfetchable, value_type: "Quantity", unit: "weeks" }],
      [],
    );
    expect(found?.type).toBe("Measured in weeks");
  });

  it("says no weight, in name order, while the set is still being read", () => {
    const gaps = unsourcedAttributes(
      [
        { ...unfetchable, id: "b", name: "Beta" },
        { ...unfetchable, id: "a", name: "Alpha" },
      ],
      WEIGHTS_PENDING,
    );
    expect(gaps.map((gap) => [gap.name, gap.weight])).toEqual([
      ["Alpha", WEIGHTS_PENDING],
      ["Beta", WEIGHTS_PENDING],
    ]);
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
    expect(gap?.remedy).toBe("Permitted, but there is no form for money yet");
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
  const NAMES = new Map([
    ["llm", "LLM with web search"],
    ["world_bank", "World Bank"],
  ]);

  /** PL-084. Its pillar is the catalog's, so a link to Rank never carries a made-up one. */
  it("keeps the catalog's pillar, and none where the catalog files it under none", () => {
    const { pillar: _pillar, ...unfiled } = employers;

    expect(handEnterable([employers], NAMES)[0]?.pillar).toBe("career");
    expect(handEnterable([unfiled], NAMES)[0]?.pillar).toBeNull();
  });

  it("names what can fetch it, not the whole priority order", () => {
    expect(handEnterable([employers], NAMES)[0]?.otherwise).toBe(
      "Otherwise: LLM with web search",
    );
  });

  /** UIR-G3. A source's id is never the words: unnamed, it is said to exist, not spelled out. */
  it("says another source would answer it, rather than print an id, before the names arrive", () => {
    expect(handEnterable([employers], new Map())[0]?.otherwise).toBe(
      "Another source would answer it",
    );
  });

  it("says plainly when nothing else would answer it", () => {
    expect(handEnterable([residency], NAMES)[0]?.otherwise).toBe(
      "Nothing else would answer it",
    );
  });

  it("claims nothing about other sources when the catalog does not say", () => {
    const { answerable_by: _unsaid, ...unsaid } = residency;
    expect(handEnterable([unsaid], NAMES)[0]?.otherwise).toBe("");
  });

  /**
   * PL-087 (UF-091), guard G6. **Every attribute the catalog permits is listed**, form or not:
   * listing only those with an editor left a permitted measured quantity in neither card.
   */
  it("lists every attribute the catalog permits, saying so where no form exists", () => {
    const TYPES = [
      "Monetary",
      "Quantity",
      "Count",
      "Ratio",
      "Index",
      "LabelSet",
      "ShareComposition",
      "Boolean",
      "AssignedScore",
      "Text",
    ];
    const catalog = [
      ...TYPES.map((type) => ({ ...employers, id: type, name: type, value_type: type })),
      { ...employers, id: "barred", name: "Barred", manual_entry: false },
    ];

    const listed = handEnterable(catalog, NAMES);

    expect(listed.map((each) => each.id).sort()).toEqual([...TYPES].sort());
    for (const each of listed) {
      if (each.id === "LabelSet" || each.id === "AssignedScore") {
        expect(each.kind).toBe(each.id);
      } else {
        expect(each.kind).toBeNull();
        expect(each.noForm).toMatch(/^Permitted, but there is no form for .+ yet$/);
      }
    }
    expect(listed.find((each) => each.id === "Quantity")?.noForm).toBe(
      "Permitted, but there is no form for a measured quantity yet",
    );
  });

  it("states each one's type in words", () => {
    expect(handEnterable([employers, residency], NAMES).map((each) => each.type)).toEqual([
      "A set of labels",
      "An assigned score",
    ]);
  });
});
