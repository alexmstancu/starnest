import { describe, expect, it } from "vitest";
import {
  describeRefusal,
  describeRule,
  numberAsInput,
  readNumber,
  type NumberRule,
  type Reading,
} from "./typedNumber";

const MONEY: NumberRule = { kind: "money", optional: false };
const DECIMAL: NumberRule = { kind: "decimal", optional: false };
const WHOLE: NumberRule = { kind: "whole", optional: false };
const SIGNED: NumberRule = { kind: "decimal", signed: true, optional: false };
const OPTIONAL: NumberRule = { kind: "decimal", optional: true };
const SIGNED_MONEY: NumberRule = { kind: "money", signed: true, optional: false };
const COVERAGE: NumberRule = { kind: "decimal", minimum: 0, maximum: 100, optional: true };

const refused = (refusal: object): Reading =>
  ({ kind: "refused", refusal }) as Reading;

/**
 * T24-1. What is typed is read as exactly the number it spells in the one grammar -- digits,
 * at most one point, a minus only where the figure may be negative -- or refused with a code.
 * Nothing is ever stripped or rewritten, and refused text never becomes "unset" (UF-026: "72,000"
 * was stored as 72 and the form said "Saved.").
 */
describe("readNumber", () => {
  it.each<[string, NumberRule, Reading]>([
    ["72", MONEY, { kind: "number", value: 72 }],
    [" 72 ", MONEY, { kind: "number", value: 72 }],
    ["12.34", MONEY, { kind: "number", value: 12.34 }],
    ["12.", DECIMAL, { kind: "number", value: 12 }],
    [".5", DECIMAL, { kind: "number", value: 0.5 }],
    ["0", WHOLE, { kind: "number", value: 0 }],
    ["72.000", DECIMAL, { kind: "number", value: 72 }],
    ["-5", SIGNED, { kind: "number", value: -5 }],
    ["\u22125", SIGNED, { kind: "number", value: -5 }],
    // One significant digit: the zeros before it place the point, they are not digits kept.
    ["0.0000000000000001", DECIMAL, { kind: "number", value: 1e-16 }],
    ["", OPTIONAL, { kind: "blank" }],
    ["   ", OPTIONAL, { kind: "blank" }],
    [".", DECIMAL, { kind: "incomplete" }],
    ["-", SIGNED, { kind: "incomplete" }],
    ["-.", SIGNED, { kind: "incomplete" }],
  ])("reads %j", (typed, rule, reading) => {
    expect(readNumber(typed, rule)).toEqual(reading);
  });

  it.each<[string, NumberRule, object]>([
    ["", MONEY, { code: "required" }],
    ["72,000", MONEY, { code: "separator", mark: ",", grouped: 72000, decimal: 72 }],
    ["72,000", WHOLE, { code: "separator", mark: ",", grouped: 72000, decimal: 72 }],
    ["1,5", DECIMAL, { code: "separator", mark: ",", decimal: 1.5 }],
    ["1,5", WHOLE, { code: "separator", mark: "," }],
    ["72 000", MONEY, { code: "separator", mark: " ", grouped: 72000 }],
    ["1,2,3", DECIMAL, { code: "separator", mark: "," }],
    ["-5", DECIMAL, { code: "sign" }],
    ["-", DECIMAL, { code: "sign" }],
    ["1e9", DECIMAL, { code: "exponent", written: 1000000000 }],
    ["1e400", DECIMAL, { code: "exponent" }],
    ["abc", DECIMAL, { code: "not_a_number" }],
    ["+5", DECIMAL, { code: "not_a_number" }],
    ["0x10", DECIMAL, { code: "not_a_number" }],
    ["Infinity", DECIMAL, { code: "not_a_number" }],
    ["--5", SIGNED, { code: "not_a_number" }],
    ["\uff17\uff12", DECIMAL, { code: "not_a_number" }],
    ["€2000", MONEY, { code: "not_a_number", currency: true }],
    ["2.5", WHOLE, { code: "fraction" }],
    ["12.", WHOLE, { code: "fraction" }],
    ["72.000", MONEY, { code: "too_many_decimals", grouped: 72000 }],
    ["1.2345", MONEY, { code: "too_many_decimals" }],
    ["-72.000", SIGNED_MONEY, { code: "too_many_decimals", grouped: -72000 }],
    ["\u221272.000", SIGNED_MONEY, { code: "too_many_decimals", grouped: -72000 }],
    ["9".repeat(400), DECIMAL, { code: "too_long" }],
    ["1234567890123456", DECIMAL, { code: "too_long" }],
    ["1000000000000000000000", DECIMAL, { code: "too_long" }],
    ["150", COVERAGE, { code: "above", limit: 100 }],
    ["-1", { ...COVERAGE, signed: true }, { code: "below", limit: 0 }],
  ])("refuses %j", (typed, rule, refusal) => {
    expect(readNumber(typed, rule)).toEqual(refused(refusal));
  });

  it("refuses a figure too small for a float to hold, rather than store it as 0", () => {
    expect(readNumber(`0.${"0".repeat(400)}1`, DECIMAL)).toEqual(refused({ code: "too_long" }));
  });

  it("never offers a reading the field would itself refuse", () => {
    const atLeastHundred: NumberRule = { kind: "money", minimum: 100, optional: false };

    expect(readNumber("72,000", atLeastHundred)).toEqual(
      refused({ code: "separator", mark: ",", grouped: 72000 }),
    );
    expect(readNumber("1e9", { ...DECIMAL, maximum: 10 })).toEqual(
      refused({ code: "exponent" }),
    );
  });
});

/**
 * T24-2. A stored figure shown in the box and saved unchanged is sent unchanged: the box never
 * groups thousands, never writes an exponent and never rounds.
 */
describe("numberAsInput", () => {
  const SAMPLE = [0, 1, 0.5, 12.34, 72000, 9007199254740, 0.0000001, 123456789012345];

  it.each<[string, NumberRule, number[]]>([
    ["decimal", DECIMAL, SAMPLE],
    ["signed decimal", SIGNED, [...SAMPLE, -0.5, -72000]],
    ["money, cents always", { ...MONEY, cents: "always" }, [0, 1, 0.5, 12.34, 72000]],
    ["money, cents if any", { ...MONEY, cents: "if-any" }, [0, 1, 0.5, 12.34, 72000]],
    ["whole", WHOLE, [0, 1, 72000, 9007199254740]],
  ])("reads back exactly what it shows, %s", (_name, rule, values) => {
    for (const value of values) {
      expect(readNumber(numberAsInput(value, rule), rule)).toEqual({
        kind: "number",
        value,
      });
    }
  });

  it.each<[number | null | undefined, NumberRule, string]>([
    [72000, MONEY, "72000"],
    [5, { ...MONEY, cents: "always" }, "5.00"],
    [12.3, { ...MONEY, cents: "if-any" }, "12.30"],
    [72000, { ...MONEY, cents: "if-any" }, "72000"],
    [5.555, { ...MONEY, cents: "always" }, "5.555"],
    [0.0000001, DECIMAL, "0.0000001"],
    [1e21, DECIMAL, "1000000000000000000000"],
    [-2.5e-7, SIGNED, "-0.00000025"],
    [null, OPTIONAL, ""],
    [undefined, OPTIONAL, ""],
  ])("shows %j as %j", (value, rule, text) => {
    expect(numberAsInput(value, rule)).toBe(text);
  });
});

describe("describeRefusal", () => {
  const sentence = (typed: string, rule: NumberRule) => {
    const reading = readNumber(typed, rule);
    if (reading.kind !== "refused") throw new Error(`${typed} was not refused`);
    return describeRefusal(reading.refusal, rule);
  };

  it.each<[string, NumberRule, string]>([
    [
      "72,000",
      MONEY,
      "A comma is not read: it can mean thousands or a decimal. Type 72000, or 72 if the comma was a decimal point.",
    ],
    ["1,5", DECIMAL, "A comma is not read. Use a point for a fraction: 1.5."],
    ["72 000", MONEY, "A space is not read. Type the figure without it: 72000."],
    ["1,5", WHOLE, "A comma is not read. Type digits only."],
    [
      "72.000",
      MONEY,
      "Euros and cents take at most two decimals. If the point separated thousands, type 72000.",
    ],
    ["1.2345", MONEY, "Euros and cents take at most two decimals."],
    [
      "\u221272.000",
      SIGNED_MONEY,
      "Euros and cents take at most two decimals. If the point separated thousands, type -72000.",
    ],
    ["-5", DECIMAL, "This figure cannot be negative."],
    ["1e9", DECIMAL, "Write the figure out in digits: 1000000000."],
    ["1e400", DECIMAL, "Write the figure out in digits."],
    ["abc", DECIMAL, "Not a number. Type digits, with a point for a fraction."],
    ["abc", WHOLE, "Not a number. Type digits only."],
    [
      "€2000",
      MONEY,
      "Not a number. Type digits, with a point for a fraction; the € is shown beside the box.",
    ],
    ["2.5", WHOLE, "A whole number, with no point."],
    ["150", COVERAGE, "From 0 to 100."],
    ["", MONEY, "Required: type a figure."],
    ["1234567890123456", DECIMAL, "Too many digits: at most 15 are kept exactly."],
    ["-1", { kind: "whole", signed: true, minimum: 1, optional: false }, "At least 1."],
    ["30", { kind: "whole", maximum: 20, optional: false }, "At most 20."],
  ])("words %j", (typed, rule, words) => {
    expect(sentence(typed, rule)).toBe(words);
  });
});

describe("describeRule", () => {
  it.each<[NumberRule, string]>([
    [COVERAGE, "From 0 to 100."],
    [{ kind: "whole", minimum: 1, optional: true }, "At least 1."],
    [{ kind: "whole", maximum: 20, optional: true }, "At most 20."],
    [DECIMAL, ""],
  ])("states %j", (rule, words) => {
    expect(describeRule(rule)).toBe(words);
  });
});
