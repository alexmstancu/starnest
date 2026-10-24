import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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
