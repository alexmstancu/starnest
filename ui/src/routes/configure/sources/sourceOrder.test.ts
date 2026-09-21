import { describe, expect, it } from "vitest";
import { inPriorityOrder, positionsOf, priorityForMove } from "./sourceOrder";

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
