import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { renderShell } from "../testing/renderShell";
import { Skeleton, type SkeletonShape } from "./Skeleton";

/**
 * Grey blocks in the shape of what is coming (PL-012). A shape, not a sentence: "Loading…" is
 * a line of text standing where a table will be, and it moves everything when the table lands.
 */

// Every shape, held to the type both ways: one added or removed there fails to compile here.
const SHAPES = Object.keys({
  "rank-table": true,
  "configure-stage": true,
  "acquire-stats": true,
  "compare-picker": true,
  lines: true,
} satisfies Record<SkeletonShape, true>) as SkeletonShape[];

describe.each(SHAPES)("the %s skeleton", (shape) => {
  it("draws blocks a screen reader passes over, and no words", () => {
    const { container } = render(<Skeleton shape={shape} />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild?.childElementCount).toBeGreaterThan(0);
    expect(container.textContent).toBe("");
  });
});

/**
 * PL-012 on every tab: **while every read is on its way, the title is already drawn**, the
 * screen is marked busy, and no "Loading…" stands where content will be.
 */
describe.each([
  ["/configure", "Configure"],
  ["/acquire", "Acquire"],
  ["/rank", "Rank"],
  ["/compare", "Compare"],
])("%s with nothing answered yet", (path, title) => {
  it("draws its title at once, busy, with no Loading line", async () => {
    mockServer.use(
      http.get("/v1/*", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderShell(path);

    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    const shown = screen.getByRole("region", { name: title });
    await waitFor(() => expect(shown.querySelector('[aria-busy="true"] .skeleton')).not.toBeNull());
    expect(shown).not.toHaveTextContent(/Loading…/);
  });
});

/**
 * **A reader who asks for no motion gets still blocks** (PL-012). jsdom applies no media query,
 * so the rule is read from the sheet: the pulse is switched off under reduced motion.
 */
describe("the skeleton under prefers-reduced-motion", () => {
  it("does not pulse", () => {
    const sheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"), "utf8");
    const reduced = [...sheet.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
      .map((match) => match[1] ?? "")
      .join("\n");

    expect(reduced).toMatch(/\.skeleton__block \{\s*animation: none;\s*\}/);
  });
});
