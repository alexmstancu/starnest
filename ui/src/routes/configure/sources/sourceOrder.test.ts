import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api/ApiError";
import {
  describeOrderRefusal,
  inPriorityOrder,
  landingEdge,
  orderAfterDrop,
  orderAfterMove,
  positionsOf,
} from "./sourceOrder";

const sources = [
  { id: "eurostat", default_priority: 10, is_enabled: true },
  { id: "oecd", default_priority: 11, is_enabled: true },
  { id: "numbeo", default_priority: 60, is_enabled: true },
];

describe("the order sources are read in", () => {
  it("sorts by priority, lowest first", () => {
    expect(
      inPriorityOrder([sources[2]!, sources[0]!, sources[1]!]).map((s) => s.id),
    ).toEqual(["eurostat", "oecd", "numbeo"]);
  });

  it("does not mutate the list it was given", () => {
    const given = [sources[2]!, sources[0]!];
    inPriorityOrder(given);
    expect(given[0]?.id).toBe("numbeo");
  });
});

describe("moving a source", () => {
  /** The whole order, never a number: the server hands the stored priorities back out. */
  it("puts it above the source that was above it", () => {
    expect(orderAfterMove(sources, "oecd", "up")).toEqual(["oecd", "eurostat", "numbeo"]);
  });

  it("puts it below the source that was below it", () => {
    expect(orderAfterMove(sources, "oecd", "down")).toEqual(["eurostat", "numbeo", "oecd"]);
  });

  it("cannot move the first one up, or the last one down", () => {
    expect(orderAfterMove(sources, "eurostat", "up")).toBeNull();
    expect(orderAfterMove(sources, "numbeo", "down")).toBeNull();
  });

  /**
   * Priorities are not unique -- two sources share 16 in the shipped catalog -- so a move
   * against an equal neighbour would change nothing, and a button that appears to act and
   * does not is worse than one that is disabled.
   */
  it("will not move a source that is already level with its neighbour", () => {
    const tied = [
      { id: "ecb", default_priority: 16 },
      { id: "unodc", default_priority: 16 },
    ];
    expect(orderAfterMove(tied, "unodc", "up")).toBeNull();
  });

  it("knows nothing about a source that is not in the list", () => {
    expect(orderAfterMove(sources, "nowhere", "up")).toBeNull();
    expect(orderAfterMove(sources, "nowhere", "down")).toBeNull();
  });

  it("does not mutate the list it was given", () => {
    const given = [...sources];
    orderAfterMove(given, "oecd", "up");
    expect(given.map((source) => source.id)).toEqual(["eurostat", "oecd", "numbeo"]);
  });
});

describe("the position shown beside a source", () => {
  it("numbers them from one, in order", () => {
    const positions = positionsOf(sources);
    expect(positions.get("eurostat")).toBe(1);
    expect(positions.get("oecd")).toBe(2);
    expect(positions.get("numbeo")).toBe(3);
  });

  /** A switched-off source is not in the contest, so it has no place in the order. */
  it("gives a switched-off source no position, and closes the numbering up", () => {
    const positions = positionsOf([
      { id: "eurostat", default_priority: 10, is_enabled: true },
      { id: "oecd", default_priority: 11, is_enabled: false },
      { id: "numbeo", default_priority: 60, is_enabled: true },
    ]);
    expect(positions.get("eurostat")).toBe(1);
    expect(positions.get("oecd")).toBeNull();
    expect(positions.get("numbeo")).toBe(2);
  });

  it("treats a source with no switch recorded as switched on", () => {
    expect(positionsOf([{ id: "a", default_priority: 1 }]).get("a")).toBe(1);
  });
});

describe("dropping a source onto another's row", () => {
  /**
   * **A splice, not a swap.** Exchanging two places would put the dragged row where it was
   * dropped and leave every row between untouched, which is a different order from the one
   * the gesture described.
   */
  it("puts a row dragged downwards below the row it was dropped on", () => {
    expect(orderAfterDrop(sources, "eurostat", "numbeo")).toEqual(["oecd", "numbeo", "eurostat"]);
  });

  /** Dragging upwards lands the row before the target, which is where the line is drawn. */
  it("puts a row dragged upwards above the row it was dropped on", () => {
    expect(orderAfterDrop(sources, "numbeo", "eurostat")).toEqual(["numbeo", "eurostat", "oecd"]);
  });

  /** A tie is a drop like any other: the order is sent, and the server numbers it. */
  it("moves a source that is level with its neighbour", () => {
    const tied = [
      { id: "ecb", default_priority: 16 },
      { id: "unodc", default_priority: 16 },
    ];
    expect(orderAfterDrop(tied, "unodc", "ecb")).toEqual(["unodc", "ecb"]);
  });

  /** A drop where the row already was sends nothing, so nothing flashes or is re-read. */
  it("asks for nothing when a row is dropped on itself", () => {
    expect(orderAfterDrop(sources, "oecd", "oecd")).toBeNull();
  });

  it("asks for nothing when either source is not in the list", () => {
    expect(orderAfterDrop(sources, "nowhere", "oecd")).toBeNull();
    expect(orderAfterDrop(sources, "oecd", "nowhere")).toBeNull();
  });

  it("asks for nothing at all from an empty list", () => {
    expect(orderAfterDrop([], "oecd", "numbeo")).toBeNull();
  });

  it("does not mutate the list it was given", () => {
    const given = [...sources];
    orderAfterDrop(given, "eurostat", "numbeo");
    expect(given.map((source) => source.id)).toEqual(["eurostat", "oecd", "numbeo"]);
  });
});

describe("the edge a dropped row lands against", () => {
  /**
   * **The edge follows the direction**, where the design's mockup draws the top edge always
   * and then re-inserts the row *below* the target on a downward drag. An indicator pointing
   * at a gap the drop will not use is the worse half of that contradiction to keep.
   */
  it("is the target's bottom edge when the drag went down", () => {
    expect(landingEdge(sources, "eurostat", "numbeo")).toBe("below");
  });

  it("is the target's top edge when the drag went up", () => {
    expect(landingEdge(sources, "numbeo", "eurostat")).toBe("above");
  });

  /** There is no gap a row would move to on its own row. */
  it("is nothing for the row being dragged", () => {
    expect(landingEdge(sources, "oecd", "oecd")).toBeNull();
  });

  it("is nothing when either source is not in the list", () => {
    expect(landingEdge(sources, "nowhere", "oecd")).toBeNull();
    expect(landingEdge(sources, "oecd", "nowhere")).toBeNull();
  });
});

describe("the sources an order refusal names", () => {
  const nameOf = (id: string) => ({ eurostat: "Eurostat", oecd: "OECD" })[id] ?? "?";
  const refusal = (details: Record<string, unknown>) =>
    new ApiError({ code: "invalid_source_order", message: "server prose", status: 422, details });

  it("names what was left out and what was named twice, by name", () => {
    expect(
      describeOrderRefusal(refusal({ missing: ["eurostat"], repeated: ["oecd"], unknown: [] }), nameOf),
    ).toBe(
      "In the order sent, Eurostat was left out of it; OECD was named twice. The list now shows the order stored.",
    );
  });

  /** An unknown source has no name left to read, so it is counted, never shown by id. */
  it("counts sources no longer in the catalog rather than showing their ids", () => {
    const said = describeOrderRefusal(
      refusal({ missing: ["eurostat", "oecd"], repeated: [], unknown: ["gone_a", "gone_b"] }),
      nameOf,
    );
    expect(said).toBe(
      "In the order sent, Eurostat, OECD were left out of it; 2 sources in it are no longer in the catalog. The list now shows the order stored.",
    );
    expect(said).not.toContain("gone_");
  });

  it("says one source in the singular", () => {
    expect(
      describeOrderRefusal(refusal({ missing: [], repeated: [], unknown: ["gone"] }), nameOf),
    ).toContain("one source in it is no longer in the catalog");
  });

  it("adds nothing to another refusal, or to one whose details name nothing", () => {
    expect(describeOrderRefusal(new ApiError({ code: "not_found", message: "x", status: 404 }), nameOf)).toBeNull();
    expect(describeOrderRefusal(refusal({ missing: "eurostat" }), nameOf)).toBeNull();
    expect(describeOrderRefusal(new Error("boom"), nameOf)).toBeNull();
  });
});
