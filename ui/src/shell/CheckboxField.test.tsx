import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CheckboxField } from "./CheckboxField";

/**
 * One checkbox with its words (PL-027). The label wraps both, so the words are the name and a
 * click on them ticks the box; held, it stays focusable and refuses the change (NEW-34).
 */

function Controlled({
  held,
  onChange = () => {},
}: {
  held?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <CheckboxField
      id="accept-uncapped"
      checked={checked}
      held={held}
      onChange={(next) => {
        setChecked(next);
        onChange(next);
      }}
    >
      Accept an uncapped spend for this pass
    </CheckboxField>
  );
}

describe("a checkbox field", () => {
  it("is named by its words, and a click on them ticks it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByText("Accept an uncapped spend for this pass"));

    expect(
      screen.getByRole("checkbox", { name: "Accept an uncapped spend for this pass" }),
    ).toBeChecked();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is held without losing focus, and does not change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled held onChange={onChange} />);
    const box = screen.getByRole("checkbox");

    await user.click(box);

    expect(box).not.toBeDisabled();
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveFocus();
    expect(box).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });
});

/**
 * The box and its words on one line, no wider than they are. `.field` is a column that fills its
 * card, so a modifier that only styled the held box left the words under the box and the whole
 * card clickable. jsdom cascades the real stylesheet, so this reads what the browser computes.
 */
describe("a checkbox field's layout", () => {
  const sheet = document.createElement("style");
  beforeAll(() => {
    sheet.textContent = readFileSync(join(__dirname, "../styles.css"), "utf8");
    document.head.append(sheet);
  });
  afterAll(() => sheet.remove());

  it("sets the box and its words side by side, as wide as they are", () => {
    render(<Controlled />);
    const label = screen.getByText("Accept an uncapped spend for this pass");
    const style = getComputedStyle(label);

    expect(style.display).toBe("flex");
    expect(style.flexDirection).toBe("row");
    expect(style.alignItems).toBe("center");
    expect(style.width).toBe("fit-content");
  });
});
