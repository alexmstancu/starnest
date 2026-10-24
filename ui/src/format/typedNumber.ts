/**
 * How typed text becomes a number (PL-024, UF-026). **One grammar, the one every figure on screen
 * is printed in** (`display.ts`: en-GB): digits, at most one point, and a minus only where the
 * figure may be negative. Nothing else is read -- no comma, space, exponent, plus, currency sign
 * or letter -- and **nothing is ever applied to the text**: what cannot be read is refused with a
 * sentence saying what to type, never filtered, rounded or read as "unset". A filter here once
 * turned "72,000" into 72 and the form said "Saved.".
 *
 * Money takes at most two decimals, because a reader who writes seventy-two thousand as "72.000"
 * would otherwise be read as 72: the same thousand-fold error, through the point (C02-S5, D7).
 */

export type NumberKind = "whole" | "money" | "decimal";

export interface NumberRule {
  kind: NumberKind;
  /** A minus may be typed. */
  signed?: boolean;
  /** Inclusive, stated in the field's note. */
  minimum?: number;
  maximum?: number;
  /** Blank is a legal answer: a nullable setting, an optional bound. */
  optional: boolean;
  /** Money only: how a stored figure is shown. */
  cents?: "always" | "if-any";
}

export type Reading =
  | { kind: "blank" }
  | { kind: "number"; value: number }
  /** "-", ".", "-.": nothing to say until the reader leaves the field. */
  | { kind: "incomplete" }
  | { kind: "refused"; refusal: Refusal };

/** A suggested reading is offered only when the field would itself accept it. */
export type Refusal =
  | { code: "required" }
  | { code: "not_a_number"; currency?: true }
  | { code: "separator"; mark: string; grouped?: number; decimal?: number }
  | { code: "sign" }
  | { code: "exponent"; written?: number }
  | { code: "fraction" }
  | { code: "too_many_decimals"; grouped?: number }
  | { code: "below"; limit: number }
  | { code: "above"; limit: number }
  | { code: "too_long" };

const MINUS = /^[-\u2212]/;
const GRAMMAR = /^[-\u2212]?(\d+(\.\d*)?|\.\d+)$/;
const EXPONENT = /^[-\u2212]?(\d+\.?\d*|\.\d+)[eE][-+]?\d+$/;
const SEPARATORS = [",", " ", "'", "\u00a0", "\u202f", "_"];
/** Every accepted figure survives JSON, a float and the server's `Decimal(str(...))` exactly. */
const MOST_SIGNIFICANT_DIGITS = 15;

export function readNumber(typed: string, rule: NumberRule): Reading {
  const text = typed.trim();
  if (text === "") return rule.optional ? { kind: "blank" } : refuse({ code: "required" });
  if (MINUS.test(text) && rule.signed !== true && /^[-\u2212](\d|\.\d|\.?$)/.test(text)) {
    return refuse({ code: "sign" });
  }
  if (/^[-\u2212]?\.?$/.test(text)) return { kind: "incomplete" };
  if (!GRAMMAR.test(text)) return refuse(whyNotRead(text, rule));
  return readDigits(text, rule);
}

function readDigits(text: string, rule: NumberRule): Reading {
  const sign = MINUS.test(text) ? "-" : "";
  const [whole = "", fraction = ""] = text.replace(MINUS, "").split(".");
  if (rule.kind === "whole" && text.includes(".")) return refuse({ code: "fraction" });
  const value = Number(sign + whole + "." + fraction);
  if (
    significantDigits(whole, fraction) > MOST_SIGNIFICANT_DIGITS ||
    exactDigits(plainDigits(Math.abs(value))) !== exactDigits(`${whole}.${fraction}`)
  ) {
    return refuse({ code: "too_long" });
  }
  if (rule.kind === "money" && fraction.length > 2) {
    const grouped =
      fraction.length === 3 ? acceptable(Number(sign + whole + fraction), rule) : undefined;
    return refuse({ code: "too_many_decimals", ...(grouped !== undefined && { grouped }) });
  }
  if (rule.minimum !== undefined && value < rule.minimum) {
    return refuse({ code: "below", limit: rule.minimum });
  }
  if (rule.maximum !== undefined && value > rule.maximum) {
    return refuse({ code: "above", limit: rule.maximum });
  }
  return { kind: "number", value };
}

/** Zeros that only place the point, before the first digit or after the last, are not kept. */
function significantDigits(whole: string, fraction: string): number {
  return (whole + fraction.replace(/0+$/, "")).replace(/^0+/, "").length;
}

/** The figure with the zeros that say nothing removed, so "0.50" and ".5" compare equal. */
function exactDigits(digits: string): string {
  const [whole = "", fraction = ""] = digits.split(".");
  return `${whole.replace(/^0+/, "")}.${fraction.replace(/0+$/, "")}`;
}

/** Why text outside the grammar was not read, with the readings it could have meant. */
function whyNotRead(text: string, rule: NumberRule): Refusal {
  if (EXPONENT.test(text)) {
    const written = acceptable(Number(text.replace(MINUS, "-")), rule);
    return { code: "exponent", ...(written !== undefined && { written }) };
  }
  if (text.includes("€")) return { code: "not_a_number", currency: true };
  const mark = SEPARATORS.find((separator) => text.includes(separator));
  if (mark !== undefined) return separatorRefusal(text, mark, rule);
  return { code: "not_a_number" };
}

function separatorRefusal(text: string, mark: string, rule: NumberRule): Refusal {
  const sign = MINUS.test(text) ? "-" : "";
  const digits = text.replace(MINUS, "");
  const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const groups = new RegExp(`^\\d{1,3}(${escaped}\\d{3})+(\\.\\d*)?$`);
  const grouped = groups.test(digits)
    ? acceptable(Number(sign + digits.split(mark).join("")), rule)
    : undefined;
  const decimal =
    mark === "," && /^\d+,\d+$/.test(digits)
      ? acceptable(Number(sign + digits.replace(",", ".")), rule)
      : undefined;
  return {
    code: "separator",
    mark,
    ...(grouped !== undefined && { grouped }),
    ...(decimal !== undefined && { decimal }),
  };
}

function acceptable(value: number, rule: NumberRule): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const reading = readNumber(numberAsInput(value, rule), rule);
  return reading.kind === "number" ? reading.value : undefined;
}

function refuse(refusal: Refusal): Reading {
  return { kind: "refused", refusal };
}

/**
 * A stored figure as the box shows it: never grouped, never in exponent form, never rounded, so
 * `readNumber(numberAsInput(v))` is `v` for every figure the rule accepts.
 */
export function numberAsInput(value: number | null | undefined, rule: NumberRule): string {
  if (value === null || value === undefined) return "";
  const plain = plainDigits(value);
  if (rule.kind !== "money" || rule.cents === undefined) return plain;
  const [whole = "", fraction = ""] = plain.split(".");
  if (fraction.length >= 2) return plain;
  if (fraction.length === 0 && rule.cents === "if-any") return plain;
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/** `String()` is the shortest text that reads back exactly; this only writes its exponent out. */
function plainDigits(value: number): string {
  const text = String(value);
  const exponent = /^(-?)(\d+)(?:\.(\d+))?e([-+]\d+)$/.exec(text);
  if (exponent === null) return text;
  const [, sign = "", whole = "", fraction = "", power = "0"] = exponent;
  const digits = whole + fraction;
  const point = whole.length + Number(power);
  // `String()` writes an exponent only below 1e-6 and from 1e21, so the point is either before
  // every digit or after all seventeen at most.
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  return `${sign}${digits}${"0".repeat(point - digits.length)}`;
}

const MARK_NAMES: Record<string, string> = { ",": "comma", "'": "apostrophe", _: "underscore" };

/** The refusal as the field's note says it: what was wrong, then what to type. */
export function describeRefusal(refusal: Refusal, rule: NumberRule): string {
  const shown = (value: number) => numberAsInput(value, { ...rule, cents: undefined });
  const digitsOnly =
    rule.kind === "whole" ? "Type digits only." : "Type digits, with a point for a fraction.";
  switch (refusal.code) {
    case "required":
      return "Required: type a figure.";
    case "not_a_number":
      return refusal.currency === true
        ? `Not a number. ${digitsOnly.slice(0, -1)}; the € is shown beside the box.`
        : `Not a number. ${digitsOnly}`;
    case "separator": {
      const name = MARK_NAMES[refusal.mark] ?? "space";
      const { grouped, decimal } = refusal;
      if (grouped !== undefined && decimal !== undefined) {
        return (
          `A ${name} is not read: it can mean thousands or a decimal. ` +
          `Type ${shown(grouped)}, or ${shown(decimal)} if the ${name} was a decimal point.`
        );
      }
      if (decimal !== undefined) {
        return `A ${name} is not read. Use a point for a fraction: ${shown(decimal)}.`;
      }
      if (grouped !== undefined) {
        return `A ${name} is not read. Type the figure without it: ${shown(grouped)}.`;
      }
      return `A ${name} is not read. ${digitsOnly}`;
    }
    case "sign":
      return "This figure cannot be negative.";
    case "exponent":
      return refusal.written === undefined
        ? "Write the figure out in digits."
        : `Write the figure out in digits: ${shown(refusal.written)}.`;
    case "fraction":
      return "A whole number, with no point.";
    case "too_many_decimals":
      return refusal.grouped === undefined
        ? "Euros and cents take at most two decimals."
        : "Euros and cents take at most two decimals. " +
            `If the point separated thousands, type ${shown(refusal.grouped)}.`;
    case "below":
    case "above":
      return describeRule(rule);
    case "too_long":
      return `Too many digits: at most ${MOST_SIGNIFICANT_DIGITS} are kept exactly.`;
  }
}

/** The field's bounds, as its note states them: "From 1 to 20." */
export function describeRule(rule: NumberRule): string {
  const { minimum, maximum } = rule;
  if (minimum !== undefined && maximum !== undefined) {
    return `From ${plainDigits(minimum)} to ${plainDigits(maximum)}.`;
  }
  if (minimum !== undefined) return `At least ${plainDigits(minimum)}.`;
  if (maximum !== undefined) return `At most ${plainDigits(maximum)}.`;
  return "";
}
