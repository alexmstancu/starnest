import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PL-129, UF-101. **Acquire's visual details as the design draws them.** jsdom computes no
 * layout, so these read the declarations the sheet ends with for each selector -- the last one
 * wins in a browser, and that is the one held here.
 */
const SHEET = readFileSync(join(__dirname, "..", "..", "styles.css"), "utf8");

/** The value the sheet leaves `property` at for exactly `selector`, the last rule winning. */
function lastValue(selector: string, property: string): string | undefined {
  let value: string | undefined;
  for (const [, selectors, body] of SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const named = selectors!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((each) => each.trim());
    if (!named.includes(selector)) continue;
    const found = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`).exec(body!);
    if (found) value = found[1]!.trim();
  }
  return value;
}

describe("Acquire's visual details (PL-129)", () => {
  it("stretches the remedy cards in a row, so their actions sit at one height", () => {
    expect(lastValue(".gap-cards", "align-items")).toBe("stretch");
    expect(lastValue(".gap-cards", "grid-template-columns")).toBe(
      "repeat(auto-fit, minmax(330px, 1fr))",
    );
  });

  it("draws the acquisition's overall bar 8 px high, teal, and amber once stopped or halted", () => {
    expect(lastValue(".acquisition .meter__track", "height")).toBe("8px");
    expect(lastValue(".acquisition .meter__fill--completed", "fill")).toBe("var(--colour-accent)");
    expect(lastValue(".acquisition:has(.pill--warn) .meter__fill--completed", "fill")).toBe(
      "var(--colour-warning-bar)",
    );
  });

  it("writes why an item failed in red", () => {
    expect(lastValue(".gap-card--danger .toggle__detail", "color")).toBe("var(--colour-danger)");
    expect(lastValue(".gap-card--danger .group__message-text", "color")).toBe(
      "var(--colour-danger)",
    );
  });

  it("keeps an uncapped confirmation amber, as every confirmation is", () => {
    expect(lastValue(".confirm--uncapped", "background")).toBeUndefined();
    expect(lastValue(".confirm--uncapped .confirm__message", "color")).toBeUndefined();
  });
});
