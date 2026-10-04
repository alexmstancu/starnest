import { describe, expect, it } from "vitest";
import {
  comesToAHundred,
  previewRebalance,
  previewedCriteria,
  previewedTotal,
  totalOf,
  totalsByPillar,
  weightAsText,
  weightedCriteria,
  weightedPillars,
  weightFrom,
  weightReading,
  type WeightedItem,
} from "./weights";

/** Reading a typed weight, which both levels of weighting do and neither's markup should. */

describe("reading a typed weight", () => {
  it("reads a number", () => {
    expect(weightFrom("40")).toBe(40);
    expect(weightFrom("29.17")).toBe(29.17);
  });

  it("refuses an empty field rather than calling it zero", () => {
    expect(weightFrom("")).toBeNull();
    expect(weightFrom("   ")).toBeNull();
  });

  it("refuses something that is not a number at all", () => {
    /** Nothing is sent, so the refusal is about weights rather than about parsing. */
    expect(weightFrom("ten")).toBeNull();
    expect(weightFrom("4o")).toBeNull();
  });

  it("refuses an infinity, which is a number and not a percentage", () => {
    expect(weightFrom("Infinity")).toBeNull();
  });

  it("keeps a real zero, which is a weight somebody chose", () => {
    expect(weightFrom("0")).toBe(0);
  });
});

describe("the reading printed beside a slider", () => {
  /**
   * A decimal that is always there is what stops the column jumping left and right as a slider
   * moves, so a whole weight reads 8.0% rather than 8%.
   */
  it("prints one decimal, whether or not the weight has one", () => {
    expect(weightReading("8")).toBe("8.0%");
    expect(weightReading("29.17")).toBe("29.2%");
  });

  /**
   * **Unreachable through either panel, and asserted anyway.** Both call sites hand over a
   * range input's value or `String(weight)`, and neither can be anything but a number -- but
   * this function takes text, so it answers for text, and "NaN%" beside a slider would report
   * a fault in the weight rather than in what the function was handed. The alternative is the
   * same guard `weightFrom` makes above, left untested here because no screen can reach it:
   * this was the one branch in the module nothing covered.
   */
  it("hands text that is not a number straight back, rather than reading it as NaN", () => {
    expect(weightReading("ten")).toBe("ten");
    expect(weightReading("")).toBe("");
  });
});

describe("showing a stored weight", () => {
  it("prints the number", () => {
    expect(weightAsText(65)).toBe("65");
  });

  it("shows an absent weight as empty, never as a zero standing in for not set", () => {
    expect(weightAsText(undefined)).toBe("");
  });
});

describe("the running total", () => {
  it("adds the weights up", () => {
    expect(totalOf([{ weight: 40 }, { weight: 35 }, { weight: 25 }])).toBe(100);
  });

  it("is zero for a set that weighs nothing yet", () => {
    expect(totalOf([])).toBe(0);
  });
});

describe("what each pillar's criteria come to", () => {
  it("sums the weights of the criteria in each pillar", () => {
    expect(
      totalsByPillar([
        { pillar: "housing", weight: 60 },
        { pillar: "housing", weight: 40 },
        { pillar: "career", weight: 100 },
      ]),
    ).toEqual([
      { pillar: "housing", total: 100, balanced: true },
      { pillar: "career", total: 100, balanced: true },
    ]);
  });

  it("says when a pillar does not add up", () => {
    const [housing] = totalsByPillar([
      { pillar: "housing", weight: 60 },
      { pillar: "housing", weight: 30 },
    ]);
    expect(housing).toEqual({ pillar: "housing", total: 90, balanced: false });
  });

  /**
   * The lesson migration `0477` already paid for: three siblings sharing 100 do not come to
   * 100 in binary floating point, and an exact test reports the arithmetic as broken every
   * time it is right.
   */
  /**
   * `(1 / 3) * 100` three times comes to 99.99999999999999, while `100 / 3` three times comes
   * to exactly 100 -- the same quantity by two routes, one of which leaves a residue. Which
   * route a rebalance takes is the server's business, so the check here has to survive either.
   */
  it("treats a total that misses 100 by rounding as balanced", () => {
    const third = (1 / 3) * 100;
    const [pillar] = totalsByPillar([
      { pillar: "nature", weight: third },
      { pillar: "nature", weight: third },
      { pillar: "nature", weight: third },
    ]);
    expect(pillar?.total).not.toBe(100);
    expect(pillar?.balanced).toBe(true);
  });

  /** Tolerant of rounding, not of a real gap: 99.9 is somebody's weight missing. */
  it("does not treat a real shortfall as rounding", () => {
    const [pillar] = totalsByPillar([
      { pillar: "nature", weight: 50 },
      { pillar: "nature", weight: 49.9 },
    ]);
    expect(pillar?.balanced).toBe(false);
  });

  it("counts a criterion with no weight as nothing, not as a gap", () => {
    expect(totalsByPillar([{ pillar: "health" }])).toEqual([
      { pillar: "health", total: 0, balanced: false },
    ]);
  });

  it("has nothing to say about no criteria", () => {
    expect(totalsByPillar([])).toEqual([]);
  });

  it("keeps the pillars in the order they first appear", () => {
    expect(
      totalsByPillar([
        { pillar: "career", weight: 50 },
        { pillar: "housing", weight: 50 },
        { pillar: "career", weight: 50 },
      ]).map((each) => each.pillar),
    ).toEqual(["career", "housing"]);
  });
});

/**
 * The drag preview, against the server's own cases.
 *
 * **Every fixture below is lifted from `backend/tests/unit/criteria/test_rebalancing.py`** --
 * the inputs and the expected figures, test by test -- because these are two implementations of
 * one rule and the cheapest way to keep them in step is to make them answer the same questions.
 * Change `rebalance()` in the Python and this file is where it shows.
 *
 * The preview is presentational: it is what the rows read while a pointer is down, it is stored
 * nowhere, and the server's answer replaces it when the pointer lifts. Which is why an
 * impossible move previews nothing here rather than refusing in its own words -- the refusal is
 * the server's to word, and it arrives with the release.
 */

const weighted = (
  identifier: string,
  weight: number,
  locked = false,
): WeightedItem => ({ identifier, weight, locked });

/** A whole rebalance as one object, so one assertion can read all of it. */
function previewOf(
  items: readonly WeightedItem[],
  moved: string,
  to: number,
): Record<string, number> {
  return Object.fromEntries(previewRebalance(items, moved, to));
}

function previewTotal(
  items: readonly WeightedItem[],
  moved: string,
  to: number,
): number {
  return [...previewRebalance(items, moved, to).values()].reduce(
    (sum, weight) => sum + weight,
    0,
  );
}

describe("previewing a rebalance", () => {
  /** `test_raising_one_weight_lowers_the_others_proportionally`. */
  it("lowers the others in proportion, so the shape of the set survives", () => {
    expect(
      previewOf([weighted("a", 20), weighted("b", 40), weighted("c", 40)], "a", 40),
    ).toEqual({ a: 40, b: 30, c: 30 });
  });

  it("gives a sibling holding twice as much twice as much to give up", () => {
    const preview = previewOf(
      [weighted("a", 40), weighted("b", 40), weighted("c", 20)],
      "a",
      25,
    );

    expect(preview["b"]).toBe(50);
    expect(preview["c"]).toBe(25);
  });

  /** `test_a_locked_sibling_keeps_its_weight_exactly`. */
  it("holds a locked sibling exactly where it is, and makes the rest absorb the lot", () => {
    expect(
      previewOf(
        [weighted("a", 20), weighted("b", 30, true), weighted("c", 50)],
        "a",
        30,
      ),
    ).toEqual({ a: 30, b: 30, c: 40 });
  });

  /** `test_absorbers_at_zero_share_the_remainder_evenly`. */
  it("splits the room evenly when every absorber is at zero", () => {
    /** Proportional sharing has nothing to go by when every absorber holds nothing. */
    expect(
      previewOf([weighted("a", 100), weighted("b", 0), weighted("c", 0)], "a", 40),
    ).toEqual({ a: 40, b: 30, c: 30 });
  });

  /** `test_setting_a_weight_to_zero_is_allowed`. */
  it("allows a weight of zero, which is a weight somebody chose", () => {
    expect(
      previewOf([weighted("a", 20), weighted("b", 40), weighted("c", 40)], "a", 0),
    ).toEqual({ a: 0, b: 50, c: 50 });
  });

  /** `test_setting_one_weight_to_one_hundred_empties_the_others`. */
  it("empties the others when one weight takes the whole hundred", () => {
    expect(
      previewOf([weighted("a", 20), weighted("b", 40), weighted("c", 40)], "a", 100),
    ).toEqual({ a: 100, b: 0, c: 0 });
  });

  /**
   * `test_the_total_is_exactly_one_hundred_however_it_divides`, with its four cases. The first
   * divides cleanly and is the control: the rounding correction must not disturb a total that
   * is already exact.
   */
  it.each([
    { weights: [10, 30, 30, 30], to: 1 },
    { weights: [10, 20, 30, 40], to: 15 },
    { weights: [25, 25, 25, 25], to: 7 },
    { weights: [1, 33, 33, 33], to: 13 },
  ])("comes to a hundred however it divides ($weights -> $to)", ({ weights, to }) => {
    const items = weights.map((weight, index) =>
      weighted(["a", "b", "c", "d"][index] ?? "", weight),
    );

    expect(comesToAHundred(previewTotal(items, "a", to))).toBe(true);
    expect(previewRebalance(items, "a", to).get("a")).toBe(to);
  });

  /**
   * `_corrected_for_rounding`, whose choice of absorber this pins.
   *
   * The largest absorber sits in the middle here on purpose, so the test tells "the largest"
   * apart from "the first" and "the last". 87 shared in the ratio 1:8:1 leaves a residue in
   * binary floating point as surely as in `Decimal`: the two small absorbers hold their exact
   * proportional share and `c` carries what is left over, which is what makes the total land on
   * 100 rather than on 99.99999999999999.
   */
  it("puts the residue of the division on the largest absorber", () => {
    const items = [
      weighted("a", 90),
      weighted("b", 1),
      weighted("c", 8),
      weighted("d", 1),
    ];

    const preview = previewOf(items, "a", 13);

    expect(preview["b"]).toBe(87 * (1 / 10));
    expect(preview["d"]).toBe(87 * (1 / 10));
    expect(preview["c"]).not.toBe(87 * (8 / 10));
    expect(previewTotal(items, "a", 13)).toBe(100);
  });

  it("names every weight it was given, changed or not", () => {
    /** As `rebalance()` does, so a caller reads one answer rather than working out the rest. */
    expect(
      Object.keys(
        previewOf(
          [weighted("a", 20), weighted("b", 30, true), weighted("c", 50)],
          "a",
          30,
        ),
      ).sort(),
    ).toEqual(["a", "b", "c"]);
  });
});

/**
 * The moves that have no preview.
 *
 * **Nothing previewed, and no refusal worded here.** Each of these is a 409 the server words
 * with the locks actually in the way (`reqs.md` 3.4, `_refuse_unless_the_locks_allow_it`); the
 * rows hold still until the release brings that message back. A client-side sentence would be a
 * second, quietly different answer to the same question.
 */
describe("previewing a move that cannot be made", () => {
  /** `test_moving_a_weight_that_is_itself_locked_is_refused`. */
  it("previews nothing when the moved weight is itself locked", () => {
    expect(
      previewOf([weighted("a", 20, true), weighted("b", 80)], "a", 60),
    ).toEqual({});
  });

  /** `test_it_refuses_when_every_other_weight_is_locked`. */
  it("previews nothing when every other weight is locked", () => {
    expect(
      previewOf(
        [weighted("a", 20), weighted("b", 40, true), weighted("c", 40, true)],
        "a",
        30,
      ),
    ).toEqual({});
  });

  /** `test_it_refuses_when_the_locks_leave_no_room`. */
  it("previews nothing when the locks already claim more than what is left", () => {
    /** `c` is unlocked and there is still no arrangement that sums to 100. */
    expect(
      previewOf(
        [weighted("a", 10), weighted("b", 80, true), weighted("c", 10)],
        "a",
        50,
      ),
    ).toEqual({});
  });

  it("previews the move that fits exactly beside the locks", () => {
    /** The boundary of the case above: 20 and the locked 80 come to exactly the hundred. */
    expect(
      previewOf(
        [weighted("a", 10), weighted("b", 80, true), weighted("c", 10)],
        "a",
        20,
      ),
    ).toEqual({ a: 20, b: 80, c: 0 });
  });

  /** `test_a_single_weight_pillar_cannot_be_rebalanced`. */
  it("previews nothing for a pillar of one, which already holds the whole hundred", () => {
    expect(previewOf([weighted("only", 100)], "only", 60)).toEqual({});
  });

  /** `test_a_weight_outside_zero_to_one_hundred_is_refused`. */
  it.each([-1, 101, 1000])("previews nothing for %s, which is no percentage", (to) => {
    expect(
      previewOf([weighted("a", 50), weighted("b", 50)], "a", to),
    ).toEqual({});
  });

  /** `test_moving_a_weight_that_is_not_in_the_pillar_is_refused`. */
  it("previews nothing for a weight that is not one of these", () => {
    expect(previewOf([weighted("a", 100)], "elsewhere", 50)).toEqual({});
  });

  /** `test_an_empty_pillar_is_refused`. */
  it("previews nothing for no weights at all", () => {
    expect(previewOf([], "a", 50)).toEqual({});
  });

  /** `test_a_repeated_identifier_is_refused`. */
  it("previews nothing when the same identifier appears twice", () => {
    /** Two rows for one attribute makes the answer ambiguous, and the schema forbids it. */
    expect(previewOf([weighted("a", 50), weighted("a", 50)], "a", 60)).toEqual({});
  });
});

/**
 * Why a drag snapshots the weights it began with.
 *
 * **The bug this guards is a drag that computes each frame from the frame before it.** The
 * server recomputes from the stored weights on every request; a client that feeds each preview
 * into the next is doing something else, and the difference hides for a while -- proportional
 * sharing keeps the siblings' ratios, so the two routes agree to within rounding for an
 * ordinary drag. They stop agreeing the moment the drag passes a point where the absorbers are
 * all at zero, and from there the shape the reader set is gone: the way back down is an even
 * split. Which is why the sequence below goes through 100 rather than wandering about.
 */
describe("the weights a preview is computed from", () => {
  const start = [
    weighted("a", 10),
    weighted("b", 20),
    weighted("c", 30),
    weighted("d", 40),
  ];

  /** One frame of the compounding mistake: the preview written back over the weights. */
  const fedBack = (items: readonly WeightedItem[], to: number): WeightedItem[] => {
    const preview = previewRebalance(items, "a", to);
    return items.map((item) => ({
      ...item,
      weight: preview.get(item.identifier) ?? item.weight,
    }));
  };

  it("is the same answer whichever way an ordinary drag got there", () => {
    /**
     * **This is the test that does not catch the bug**, and it is here to say so. 18 -> 25 ->
     * 31 -> 24 compounded lands within rounding of a single jump to 24, because every frame
     * scales the absorbers by one factor and leaves their ratios where they were. A sequence
     * like this one is not evidence that the snapshot is being taken.
     */
    const throughTheMiddle = [18, 25, 31, 24].reduce(fedBack, start);
    const straightThere = previewRebalance(start, "a", 24);

    for (const item of throughTheMiddle) {
      expect(straightThere.get(item.identifier)).toBeCloseTo(item.weight, 10);
    }
  });

  it("loses the shape of the set when each frame is computed from the last", () => {
    /**
     * The failure, written down. 76 shared in the ratio 20:30:40 gives 16.9, 25.3 and 33.8;
     * compounding through the top of the track gives three equal thirds, and the reader's 20:30:40
     * is not recoverable from them.
     */
    const throughTheTop = [18, 100, 24].reduce(fedBack, start);

    expect(throughTheTop.map((item) => item.weight)).toEqual([
      24,
      76 / 3,
      76 / 3,
      76 / 3,
    ]);
    expect(previewOf(start, "a", 24)["b"]).toBeCloseTo(76 * (20 / 90), 10);
  });
});

describe("the weights a rebalance sees", () => {
  it("reads a level's pillar weights", () => {
    expect(
      weightedPillars([
        { pillar: "economics", weight: 40, weight_locked: false },
        { pillar: "housing", weight: 35, weight_locked: true },
      ]),
    ).toEqual([
      { identifier: "economics", weight: 40, locked: false },
      { identifier: "housing", weight: 35, locked: true },
    ]);
  });

  it("reads a pillar's criteria", () => {
    expect(
      weightedCriteria([
        { attribute: "country.rent", weight: 60, weight_locked: true },
        { attribute: "country.size", weight: 40 },
      ]),
    ).toEqual([
      { identifier: "country.rent", weight: 60, locked: true },
      { identifier: "country.size", weight: 40, locked: false },
    ]);
  });

  it("counts a criterion with no weight as zero, which is what a slider can show", () => {
    expect(weightedCriteria([{ attribute: "country.rent" }])).toEqual([
      { identifier: "country.rent", weight: 0, locked: false },
    ]);
  });

  it("has nothing to say about no weights", () => {
    expect(weightedPillars([])).toEqual([]);
    expect(weightedCriteria([])).toEqual([]);
  });
});

/** The running total, which has to read what the rows read or it contradicts them. */
describe("the total as the screen is showing it", () => {
  const items = [weighted("a", 40), weighted("b", 35), weighted("c", 25)];

  it("counts the preview where there is one", () => {
    const preview = previewRebalance(items, "a", 50);

    // The preview holds 50, 29.17 and 20.83 where the stored weights hold 40, 35 and 25. Both
    // come to a hundred, which is the whole point: the chip reads 100 for the length of the
    // gesture because the rebalance it is counting is the one the rows are showing.
    expect(preview.get("a")).toBe(50);
    expect(comesToAHundred(previewedTotal(items, preview))).toBe(true);
  });

  it("counts the stored weights when nothing is being dragged", () => {
    expect(previewedTotal(items, new Map())).toBe(100);
  });

  it("counts the stored weights for anything the preview does not name", () => {
    expect(previewedTotal(items, new Map([["a", 50]]))).toBe(110);
  });

  it("is zero for a set that weighs nothing yet", () => {
    expect(previewedTotal([], new Map())).toBe(0);
  });
});

describe("the criteria as the screen is showing them", () => {
  const criteria = [
    { attribute: "country.rent", pillar: "housing", weight: 60 },
    { attribute: "country.size", pillar: "housing", weight: 40 },
  ];

  it("puts the preview's weight on the criteria it names", () => {
    expect(
      previewedCriteria(criteria, new Map([["country.rent", 30]])),
    ).toEqual([
      { pillar: "housing", weight: 30 },
      { pillar: "housing", weight: 40 },
    ]);
  });

  it("leaves the stored weights alone when nothing is being dragged", () => {
    expect(totalsByPillar(previewedCriteria(criteria, new Map()))).toEqual([
      { pillar: "housing", total: 100, balanced: true },
    ]);
  });

  it("keeps a missing weight missing rather than calling it zero", () => {
    expect(
      previewedCriteria([{ attribute: "country.rent", pillar: "housing" }], new Map()),
    ).toEqual([{ pillar: "housing", weight: undefined }]);
  });
});
