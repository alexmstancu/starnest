import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PL-082. The ranking's grid at each desktop width, read from the stylesheet.
 *
 * **Hiding a cell is two edits, and the sheet once made one.** The table is a CSS grid, so a
 * column that is `display: none` leaves its track behind and every cell after it shifts left
 * one column; and a row narrower than its own tracks spills past its ground. So at each width
 * the template must have exactly one track per visible column, and the table's `min-width`
 * must hold every track's minimum, the gaps between them and the row's padding.
 */
const ROW = ".table--ranking > tbody > tr";
const COLUMNS = 10;
const GAP = 14;
const ROW_PADDING = 2 * 16;

interface Block {
  /** The `max-width` of the media query, or null for the rules outside any. */
  maxWidth: number | null;
  body: string;
}

function stylesheet(): string {
  return readFileSync(join(__dirname, "../../styles.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

/** The `max-width` media blocks, each with its balanced body, and the sheet outside them. */
function blocks(sheet: string): Block[] {
  const found: Block[] = [];
  let outside = "";
  let cursor = 0;
  for (const match of sheet.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{/g)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let at = start;
    while (depth > 0 && at < sheet.length) {
      if (sheet[at] === "{") depth += 1;
      if (sheet[at] === "}") depth -= 1;
      at += 1;
    }
    outside += sheet.slice(cursor, match.index);
    found.push({ maxWidth: Number(match[1]), body: sheet.slice(start, at - 1) });
    cursor = at;
  }
  outside += sheet.slice(cursor);
  return [{ maxWidth: null, body: outside }, ...found];
}

/** The last value a block gives `property` in a rule whose selector list holds `selector`. */
function declared(body: string, selector: string, property: string): string | undefined {
  let value: string | undefined;
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? "").split(",").map((each) => each.trim().replace(/\s+/g, " "));
    if (!selectors.includes(selector)) continue;
    for (const line of (rule[2] ?? "").split(";")) {
      const [name = "", ...rest] = line.split(":");
      if (name.trim() === property) value = rest.join(":").trim();
    }
  }
  return value;
}

/** Each track's minimum: a fixed size is its own, a `minmax` its first argument. */
function trackMinimums(template: string): number[] {
  return [...template.matchAll(/minmax\(\s*(\d+)px[^)]*\)|(\d+)px/g)].map((track) =>
    Number(track[1] ?? track[2]),
  );
}

function px(value: string | undefined): number {
  return Number(/^(\d+)px$/.exec(value ?? "")?.[1] ?? Number.NaN);
}

const sheet = stylesheet();
const byWidth = new Map(blocks(sheet).map((block) => [block.maxWidth, block.body]));
const base = byWidth.get(null) ?? "";

/** Each width with the columns hidden at it, which a narrower width inherits from a wider. */
const WIDTHS = [
  { maxWidth: null, hidden: [] as string[] },
  { maxWidth: 1440, hidden: [".col--delta"] },
  { maxWidth: 1280, hidden: [".col--delta", ".col--pillars"] },
] as const;

describe("the ranking's grid at each desktop width", () => {
  for (const { maxWidth, hidden } of WIDTHS) {
    const at = maxWidth === null ? "full width" : `${maxWidth}px and below`;
    const body = byWidth.get(maxWidth);

    it(`has a block for ${at}`, () => {
      expect(body, `no @media (max-width: ${maxWidth}px) block`).toBeDefined();
    });

    it(`has one track per visible column at ${at}`, () => {
      const template = declared(body ?? "", ROW, "grid-template-columns") ?? "";
      expect(trackMinimums(template)).toHaveLength(COLUMNS - hidden.length);
      expect(declared(body ?? "", ".table--ranking > thead > tr", "grid-template-columns")).toBe(
        template,
      );
    });

    it(`is at least as wide as its tracks at ${at}`, () => {
      const tracks = trackMinimums(declared(body ?? "", ROW, "grid-template-columns") ?? "");
      const needed =
        tracks.reduce((sum, track) => sum + track, 0) + GAP * (tracks.length - 1) + ROW_PADDING;
      expect(px(declared(body ?? "", ".table--ranking", "min-width"))).toBeGreaterThanOrEqual(
        needed,
      );
    });

    it(`hides the columns it drops at ${at}, and no others`, () => {
      for (const column of [".col--delta", ".col--pillars"]) {
        const shown = [...byWidth.entries()]
          .filter(([width]) => width !== null && maxWidth !== null && width >= maxWidth)
          .every(([, each]) => declared(each, column, "display") !== "none");
        expect(shown, `${column} at ${at}`).toBe(!(hidden as readonly string[]).includes(column));
      }
    });
  }

  /** N5: the design's 1560 holds, so a 1920 window does not scroll sideways. */
  it("needs no more than the design's 1560px at full width", () => {
    expect(px(declared(base, ".table--ranking", "min-width"))).toBeLessThanOrEqual(1560);
  });

  /** At 1280 the table must fit beside the 200px sidebar and the content's 16px gutters. */
  it("fits 1280px beside a 200px sidebar", () => {
    const narrow = byWidth.get(1280) ?? "";
    expect(declared(narrow, ":root", "--sidebar-width")).toBe("12.5rem");
    expect(px(declared(narrow, ".table--ranking", "min-width"))).toBeLessThanOrEqual(
      1280 - 200 - 2 * 16,
    );
  });
});
