import { describe, expect, it } from "vitest";
import { describeRecordChange, undoUnsets } from "./recordChange";

const LABELS = { income: "Net income", home: "Moving from" };

describe("a record form's save, in words", () => {
  it("names each field it moved, and never prints an identifier", () => {
    expect(
      describeRecordChange(
        { income: "7400", home: "country.portugal" },
        { income: "8000", home: "country.spain" },
        { labels: LABELS, opaque: ["home"] },
      ),
    ).toBe("Net income 7400 to 8000; Moving from changed");
  });

  it("says what undoing it would unset, only where the record had left the field unset", () => {
    const stops = { income: "nothing can be ranked." };
    expect(undoUnsets({ income: "", home: "" }, { income: "10", home: "" }, LABELS, stops)).toBe(
      "Undoing this unsets Net income: nothing can be ranked.",
    );
    expect(undoUnsets({ income: "5", home: "" }, { income: "10", home: "" }, LABELS, stops)).toBe(
      undefined,
    );
  });
});
