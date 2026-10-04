import { describe, expect, it } from "vitest";
import {
  inPriorityOrder,
  landingEdge,
  positionsOf,
  priorityForMove,
  reorderForDrop,
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
  /**
   * **A swap, not an assignment.** Giving the moved source its neighbour's number leaves the
   * two level rather than reordered, and a tie keeps whatever order they already had -- so the
   * row would not visibly move.
   */
  it("exchanges its priority with the source above it", () => {
    expect(priorityForMove(sources, "oecd", "up")).toEqual({
      id: "oecd",
      priority: 10,
      neighbourId: "eurostat",
      neighbourPriority: 11,
    });
  });

  it("exchanges its priority with the source below it", () => {
    expect(priorityForMove(sources, "oecd", "down")).toEqual({
      id: "oecd",
      priority: 60,
      neighbourId: "numbeo",
      neighbourPriority: 11,
    });
  });

  it("cannot move the first one up, or the last one down", () => {
    expect(priorityForMove(sources, "eurostat", "up")).toBeNull();
    expect(priorityForMove(sources, "numbeo", "down")).toBeNull();
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
    expect(priorityForMove(tied, "unodc", "up")).toBeNull();
  });

  it("knows nothing about a source that is not in the list", () => {
    expect(priorityForMove(sources, "nowhere", "up")).toBeNull();
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
   * **A splice, not a swap.** Exchanging two numbers would put the dragged row where it was
   * dropped and leave every row between untouched, which is a different order from the one
   * the gesture described.
   */
  it("renumbers from one so the dropped order is the stored order", () => {
    expect(reorderForDrop(sources, "eurostat", "numbeo")).toEqual([
      { id: "oecd", default_priority: 1 },
      { id: "numbeo", default_priority: 2 },
      { id: "eurostat", default_priority: 3 },
    ]);
  });

  /** Dragging upwards lands the row before the target, which is where the line is drawn. */
  it("puts a row dragged upwards above the row it was dropped on", () => {
    expect(reorderForDrop(sources, "numbeo", "eurostat")).toEqual([
      { id: "numbeo", default_priority: 1 },
      { id: "eurostat", default_priority: 2 },
      { id: "oecd", default_priority: 3 },
    ]);
  });

  /**
   * **The numbering is dense on purpose.** Rotating the priorities the span already holds
   * would keep 10, 11 and 60 -- and would tie the moved row with its new neighbour wherever
   * the span contains a tie, which then orders it by id rather than by where it was dropped.
   */
  it("leaves no two sources sharing a number, whatever they shared before", () => {
    const tied = [
      { id: "ecb", default_priority: 16, is_enabled: true },
      { id: "unodc", default_priority: 16, is_enabled: true },
      { id: "imf", default_priority: 20, is_enabled: true },
    ];
    const changes = reorderForDrop(tied, "imf", "ecb");
    expect(changes).toEqual([
      { id: "imf", default_priority: 1 },
      { id: "ecb", default_priority: 2 },
      { id: "unodc", default_priority: 3 },
    ]);
  });

  /** A tie the arrows refuse to cross is a drop like any other, because nothing is exchanged. */
  it("moves a source that is level with its neighbour, which the arrows will not", () => {
    const tied = [
      { id: "ecb", default_priority: 16, is_enabled: true },
      { id: "unodc", default_priority: 16, is_enabled: true },
    ];
    expect(priorityForMove(tied, "unodc", "up")).toBeNull();
    expect(reorderForDrop(tied, "unodc", "ecb")).toEqual([
      { id: "unodc", default_priority: 1 },
      { id: "ecb", default_priority: 2 },
    ]);
  });

  /**
   * **A drop where the row already was sends nothing.** A request writing the number already
   * stored would still flash the row as saving and re-read the whole list, to show the order
   * that was already on screen.
   */
  it("asks for no change when a row is dropped on itself", () => {
    expect(reorderForDrop(sources, "oecd", "oecd")).toEqual([]);
  });

  it("asks for no change when either source is not in the list", () => {
    expect(reorderForDrop(sources, "nowhere", "oecd")).toEqual([]);
    expect(reorderForDrop(sources, "oecd", "nowhere")).toEqual([]);
  });

  it("asks for nothing at all from an empty list", () => {
    expect(reorderForDrop([], "oecd", "numbeo")).toEqual([]);
  });

  /** Only what moved: a row already holding its new number is not written again. */
  it("leaves out a row whose number does not change", () => {
    const dense = [
      { id: "a", default_priority: 1, is_enabled: true },
      { id: "b", default_priority: 2, is_enabled: true },
      { id: "c", default_priority: 3, is_enabled: true },
      { id: "d", default_priority: 4, is_enabled: true },
    ];
    expect(reorderForDrop(dense, "b", "c")).toEqual([
      { id: "c", default_priority: 2 },
      { id: "b", default_priority: 3 },
    ]);
  });

  it("does not mutate the list it was given", () => {
    const given = [...sources];
    reorderForDrop(given, "eurostat", "numbeo");
    expect(given.map((source) => source.id)).toEqual([
      "eurostat",
      "oecd",
      "numbeo",
    ]);
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
