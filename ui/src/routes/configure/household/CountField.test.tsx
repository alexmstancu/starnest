import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CountField } from "./CountField";

/**
 * **A shortcut, not a ceiling.** The design offers adults as 1 to 4, which is one click for
 * almost every household -- but the domain has no such limit, and a control that cannot
 * express five adults would be the interface deciding who is allowed to use this.
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

  it("takes a number none of the buttons offers", async () => {
    const onChange = draw("");
    await userEvent.type(screen.getByRole("textbox", { name: "Adults" }), "7");
    expect(onChange).toHaveBeenCalledWith("7");
  });

  /** Nothing is pressed when the answer is outside the shortcut, because nothing is. */
  it("presses no button for an answer outside the buttons", () => {
    draw("7");
    for (const each of ["1", "2", "3", "4"]) {
      expect(screen.getByRole("button", { name: each })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    expect(screen.getByText(/outside the buttons/i)).toBeInTheDocument();
  });

  it("keeps the field's own name, whatever the sentence beside it says", () => {
    draw("2");
    expect(screen.getByRole("textbox", { name: "Adults" })).toHaveValue("2");
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
