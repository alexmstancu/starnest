import { render } from "@testing-library/react";
import { LockIcon } from "./LockIcon";

function drawn(locked: boolean): SVGSVGElement {
  const { container } = render(<LockIcon locked={locked} />);
  const icon = container.querySelector("svg");
  if (icon === null) throw new Error("the lock drew no SVG");
  return icon;
}

describe("LockIcon", () => {
  it("draws a padlock that is shut when locked and open when free", () => {
    expect(drawn(true)).toHaveAttribute("data-state", "shut");
    expect(drawn(false)).toHaveAttribute("data-state", "open");
    expect(drawn(true).innerHTML).not.toBe(drawn(false).innerHTML);
  });

  // An SVG with no size draws at 300 by 150 px, which only a browser would show.
  it("is sized by its own attributes, takes the text colour and hides from the reading order", () => {
    const icon = drawn(true);
    expect(icon).toHaveAttribute("width");
    expect(icon).toHaveAttribute("height");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
  });
});
