import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CountField } from "./CountField";

/**
 * **Segments, and only segments.** The design offers adults as 1 to 4 and children as none to
 * 3, with no free-text escape beside them. There used to be one, labelled "Or type another
 * number", and it showed on every render holding the number the pressed button already showed.
 * Widening the range is adding a segment, not asking every household to read past a field it
 * will never use.
 */
function draw(value: string, onChange = vi.fn()) {
  render(
    <CountField
      id="adults"
      label="Adults"
      offered={[1, 2, 3, 4]}
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("a small whole number", () => {
  it("offers the answers people actually give", async () => {
    const onChange = draw("");
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("shows which one is chosen", () => {
    draw("2");
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  /**
   * A stored value the segments do not offer still renders, with nothing pressed, which is the
   * honest reading: no button says 7. The remedy is to offer 7, not to carry a text field on
   * every render for the household that has it.
   */
  it("presses no button for an answer outside the buttons", () => {
    draw("7");

    for (const each of ["1", "2", "3", "4"]) {
      expect(screen.getByRole("button", { name: each })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });

  /** The field it replaced is gone, and nothing on the panel asks to be read twice. */
  it("offers no free-text field beside the buttons", () => {
    draw("2");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/type another number/i)).not.toBeInTheDocument();
  });

  /** The group carries the name now that the buttons are the whole control. */
  it("names the control for a reader who cannot see the label", () => {
    draw("2");

    expect(screen.getByRole("group", { name: "Adults" })).toBeInTheDocument();
  });

  it("calls zero what the caller calls it", () => {
    render(
      <CountField
        id="children"
        label="Children"
        offered={[0, 1, 2]}
        noneLabel="None"
        value="0"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
