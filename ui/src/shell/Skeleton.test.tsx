import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
