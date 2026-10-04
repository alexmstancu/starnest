import { describe, expect, it } from "vitest";
import type { StoredValue } from "../../api/endpoints";
import { describeRepeats, foldRepeats } from "./repeatedValues";

function aValue(over: Partial<StoredValue> = {}): StoredValue {
  return {
    id: 1,
    candidate: "country.malta",
    attribute: "country.average_working_hours",
    value_type: "Quantity",
    payload: { value_type: "Quantity", magnitude: 40.7, unit: "hours_per_week" },
    data_source: "eurostat",
    reference_period: { start: "2025-01-01", end: "2025-12-31" },
    retrieval_date: "2026-10-02T19:16:00Z",
    confidence_level: "high",
    is_active: false,
    citations: [],
    ...over,
  } as unknown as StoredValue;
}

describe("folding a figure that was stored more than once", () => {
  it("leaves a single figure alone", () => {
    const folded = foldRepeats([aValue()]);

    expect(folded).toHaveLength(1);
    expect(folded[0]?.copies).toBe(1);
    expect(folded[0]?.firstRetrieved).toBeNull();
  });

  /** The live case: 26 identical rows from 26 acquisitions of one unchanged Eurostat figure. */
  it("folds identical copies into one, counted", () => {
    const copies = Array.from({ length: 26 }, (_, n) =>
      aValue({ id: n + 1, retrieval_date: `2026-10-0${String((n % 9) + 1)}T19:16:00Z` }),
    );

    const folded = foldRepeats(copies);

    expect(folded).toHaveLength(1);
    expect(folded[0]?.copies).toBe(26);
  });

  it("shows the most recently fetched of the identical copies", () => {
    const folded = foldRepeats([
      aValue({ id: 1, retrieval_date: "2026-10-02T19:16:00Z" }),
      aValue({ id: 2, retrieval_date: "2026-10-02T19:40:00Z" }),
      aValue({ id: 3, retrieval_date: "2026-10-02T19:25:00Z" }),
    ]);

    expect(folded[0]?.value.id).toBe(2);
    expect(folded[0]?.firstRetrieved).toBe("2026-10-02T19:16:00Z");
  });

  /**
   * **The sad path that matters.** Folding is only safe because it folds nothing a reader
   * could act on. A different magnitude is a different measurement, and merging two of those
   * would hide a figure that changed -- the opposite of what this panel exists for.
   */
  it("keeps figures whose magnitude differs", () => {
    const folded = foldRepeats([
      aValue({ id: 1 }),
      aValue({
        id: 2,
        payload: {
          value_type: "Quantity",
          magnitude: 38.2,
          unit: "hours_per_week",
        },
      } as Partial<StoredValue>),
    ]);

    expect(folded).toHaveLength(2);
  });

  /**
   * **The one that would delete a figure from the screen.** This panel lists every attribute of
   * one candidate, so two *different* attributes that happen to agree on source, period and
   * magnitude — two Eurostat ratios both reading 31.2% for 2025, which is ordinary — would fold
   * into a single row and one of them would simply not be there. The fingerprint has always
   * included the attribute; nothing proved it until now. Dropping `attribute`,
   * `breakdown_option` and `confidence_level` from the key left all 210 tests in this folder
   * green.
   */
  it("keeps figures for different attributes, however alike they read", () => {
    const folded = foldRepeats([
      aValue({ id: 1, attribute: "country.forest_cover" }),
      aValue({ id: 2, attribute: "country.protected_land_share" }),
    ]);

    expect(folded).toHaveLength(2);
  });

  /** A one-bedroom rent and a two-bedroom rent are both current; neither supersedes the other. */
  it("keeps figures for different breakdown options", () => {
    const folded = foldRepeats([
      aValue({ id: 1, breakdown_option: "one_bedroom" }),
      aValue({ id: 2, breakdown_option: "two_bedroom" }),
    ]);

    expect(folded).toHaveLength(2);
  });

  /** Confidence is on screen beside the figure, so folding across it would hide a difference. */
  it("keeps figures stored at different confidence", () => {
    const folded = foldRepeats([
      aValue({ id: 1, confidence_level: "high" }),
      aValue({ id: 2, confidence_level: "low" }),
    ]);

    expect(folded).toHaveLength(2);
  });

  it("keeps figures for different candidates", () => {
    const folded = foldRepeats([
      aValue({ id: 1, candidate: "country.malta" }),
      aValue({ id: 2, candidate: "country.cyprus" }),
    ]);

    expect(folded).toHaveLength(2);
  });

  it("keeps figures from different sources", () => {
    const folded = foldRepeats([aValue(), aValue({ id: 2, data_source: "oecd" })]);

    expect(folded).toHaveLength(2);
  });

  it("keeps figures describing different periods", () => {
    const folded = foldRepeats([
      aValue(),
      aValue({
        id: 2,
        reference_period: { start: "2024-01-01", end: "2024-12-31" },
      }),
    ]);

    expect(folded).toHaveLength(2);
  });

  it("keeps a rejected figure apart from an accepted one that reads the same", () => {
    const folded = foldRepeats([
      aValue(),
      aValue({ id: 2, rejection_reason: "outside the allowed range" }),
    ]);

    expect(folded).toHaveLength(2);
  });

  it("keeps the order the server sent", () => {
    const folded = foldRepeats([
      aValue({ id: 1, data_source: "oecd" }),
      aValue({ id: 2, data_source: "eurostat" }),
    ]);

    expect(folded.map((each) => each.value.data_source)).toEqual([
      "oecd",
      "eurostat",
    ]);
  });

  it("folds nothing when given nothing", () => {
    expect(foldRepeats([])).toEqual([]);
  });
});

describe("saying that a figure arrived more than once", () => {
  it("says what did not change, and when it was first seen", () => {
    expect(describeRepeats(26, "2026-10-02T19:16:00Z")).toBe(
      "unchanged across 26 acquisitions, first on 2 Oct 2026",
    );
  });

  it("says only what did not change when there is no earlier date", () => {
    expect(describeRepeats(3, null)).toBe("unchanged across 3 acquisitions");
  });

  /**
   * **The day is UTC's, not the machine's**, like every other date on this panel. The sentence
   * used to format its own date with no `timeZone`, so a figure fetched at 08:00Z read as the
   * day before for a reader west of UTC -- beside a "Fetched" cell naming the right day.
   *
   * **Both ends of the day, so the assertion does not depend on where it runs.** A local-time
   * formatter and a UTC one agree except when the offset carries the instant across midnight,
   * and which instant that is depends on the sign of the offset: 00:30Z moves back a day for
   * any reader west of UTC, 23:30Z moves forward for any reader east of it. One of these two
   * fails on every clock that is not itself UTC, which is why the old test at 19:16Z passed
   * everywhere while the formatter was wrong.
   */
  it("reads the first fetch in UTC, whatever the reader's clock says", () => {
    expect(describeRepeats(2, "2026-10-02T00:30:00Z")).toBe(
      "unchanged across 2 acquisitions, first on 2 Oct 2026",
    );
    expect(describeRepeats(2, "2026-10-02T23:30:00Z")).toBe(
      "unchanged across 2 acquisitions, first on 2 Oct 2026",
    );
  });
});
