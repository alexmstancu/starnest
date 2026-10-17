import { describe, expect, it } from "vitest";
import { onlyNumberCharacters, readTypedNumber } from "./numericInput";

describe("what a reader may type into a number field", () => {
  it("keeps digits", () => {
    expect(onlyNumberCharacters("2000")).toBe("2000");
  });

  /**
   * The owner's complaint: these were plain text boxes. "abc12x" went into the spend cap and
   * "about 2000" into a monthly spend; `Number()` made each `NaN`, and the form rendered that
   * as an empty field — so the figure disappeared without a word.
   */
  it("drops letters", () => {
    expect(onlyNumberCharacters("about 2000 a month")).toBe("2000");
    expect(onlyNumberCharacters("abc12x")).toBe("12");
    expect(onlyNumberCharacters("abc")).toBe("");
  });

  it("drops a currency symbol, which the field already shows beside it", () => {
    expect(onlyNumberCharacters("€2000")).toBe("2000");
  });

  it("keeps one decimal point", () => {
    expect(onlyNumberCharacters("1250.75")).toBe("1250.75");
  });

  it("accepts a comma as the decimal point, because half of Europe types one", () => {
    expect(onlyNumberCharacters("1250,75")).toBe("1250.75");
  });

  /**
   * **A second point ends the number; it does not vanish from the middle of it.** This used to
   * read "1.23", gluing the digits across the separator, and a test asserted that as if it were
   * the intent. Three is not a hundredth.
   */
  it("stops at a second point rather than gluing the digits across it", () => {
    expect(onlyNumberCharacters("1.2.3")).toBe("1.2");
  });

  /** Every field this guards is floored at zero by the schema or by the domain. */
  it("drops a minus sign", () => {
    expect(onlyNumberCharacters("-500")).toBe("500");
  });

  it("leaves an empty field empty, which is unanswered rather than zero", () => {
    expect(onlyNumberCharacters("")).toBe("");
  });

  describe("and when the setting counts things", () => {
    /**
     * **Fifty-five is not five and a half.** These two tests used to assert "55" and "15" and
     * read as if that were the point of the rule -- "drops the decimal point too" is literally
     * what the code did and not at all what a reader meant. A field counting days would have
     * accepted "refetch anything older than 5.5 days" as 55, and the schema has no objection.
     */
    it("stops at the point rather than gluing the digits across it", () => {
      expect(onlyNumberCharacters("5.5", { whole: true })).toBe("5");
    });

    it("stops at a comma the same way", () => {
      expect(onlyNumberCharacters("1,5", { whole: true })).toBe("1");
    });

    it("still keeps plain digits", () => {
      expect(onlyNumberCharacters("20", { whole: true })).toBe("20");
    });
  });
});

/**
 * UI-10. **Three answers, not two.** The filter keeps a lone point -- it is the start of "0.5" --
 * and reading only blank against not-blank sent it as `Number(".")`, which is NaN, which JSON
 * writes as null: the "unset" of every nullable setting.
 */
describe("reading what was typed into a number field", () => {
  it("calls a lone decimal point invalid rather than blank", () => {
    expect(readTypedNumber(".")).toBe("invalid");
  });

  it("calls a digit string too long to be finite invalid", () => {
    expect(readTypedNumber("9".repeat(400))).toBe("invalid");
  });

  it("reads an empty field, or one of spaces, as blank", () => {
    expect(readTypedNumber("")).toBe("blank");
    expect(readTypedNumber("   ")).toBe("blank");
  });

  it("reads digits as the number they spell", () => {
    expect(readTypedNumber("2000")).toBe(2000);
    expect(readTypedNumber("57.5")).toBe(57.5);
  });

  it("reads a number with its point at either end", () => {
    expect(readTypedNumber("12.")).toBe(12);
    expect(readTypedNumber(".5")).toBe(0.5);
  });

  it("keeps a zero, because zero can be a decision", () => {
    expect(readTypedNumber("0")).toBe(0);
  });
});
