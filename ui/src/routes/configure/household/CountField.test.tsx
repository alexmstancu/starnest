import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { CountField } from "./CountField";
import { HOUSEHOLD_RULES } from "./householdForm";

/**
 * **Segments for the usual answers, and "More" for the rest** (PL-166, UF-050). The domain has
 * no ceiling -- `number_adults` is any whole number from one -- so a household of five adults
 * must be enterable, and a stored five must say five.
 */
function draw(value: string, onChange = vi.fn()) {
  render(
    <CountField
      id="adults"
      label="Adults"
      offered={[1, 2, 3, 4]}
      rule={HOUSEHOLD_RULES.number_adults}
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

/** The field as the form holds it: what is typed is what is drawn next. */
function Held({ initial, problem }: { initial: string; problem?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <CountField
      id="adults"
      label="Adults"
      offered={[1, 2, 3, 4]}
      rule={HOUSEHOLD_RULES.number_adults}
      value={value}
      onChange={setValue}
      problem={problem}
    />
  );
}

function segment(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function exact(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox", { name: "Adults, exact number" });
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

  it("offers no number field until More is chosen", () => {
    draw("2");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(segment("More")).toHaveAttribute("aria-pressed", "false");
  });

  it("takes five adults through More", async () => {
    const user = userEvent.setup();
    render(<Held initial="2" />);

    await user.click(segment("More"));
    await user.clear(exact());
    await user.type(exact(), "5");

    expect(segment("More")).toHaveAttribute("aria-pressed", "true");
    expect(segment("2")).toHaveAttribute("aria-pressed", "false");
    expect(exact()).toHaveValue("5");
  });

  /** A stored count above the segments is not hidden behind nothing pressed. */
  it("shows a stored count above the segments in the More field", () => {
    draw("7");

    for (const each of ["1", "2", "3", "4"]) {
      expect(segment(each)).toHaveAttribute("aria-pressed", "false");
    }
    expect(segment("More")).toHaveAttribute("aria-pressed", "true");
    expect(exact()).toHaveValue("7");
  });

  it("closes the field when a segment is chosen again", async () => {
    const user = userEvent.setup();
    render(<Held initial="2" />);

    await user.click(segment("More"));
    await user.click(segment("3"));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(segment("3")).toHaveAttribute("aria-pressed", "true");
    expect(segment("More")).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses a count the parser cannot read, on the field", async () => {
    const user = userEvent.setup();
    render(<Held initial="2" />);

    await user.click(segment("More"));
    await user.clear(exact());
    await user.type(exact(), "2.5");
    await user.tab();

    expect(exact()).toHaveAttribute("aria-invalid", "true");
    expect(exact()).toHaveAccessibleDescription(/whole number/i);
  });

  it("refuses a count below the minimum, on the field", async () => {
    const user = userEvent.setup();
    render(<Held initial="2" />);

    await user.click(segment("More"));
    await user.clear(exact());
    await user.type(exact(), "0");

    expect(exact()).toHaveAttribute("aria-invalid", "true");
  });

  it("marks the field with the server's refusal", () => {
    render(<Held initial="9" problem="Must be at least 1." />);

    expect(exact()).toHaveAttribute("aria-invalid", "true");
    expect(exact()).toHaveAccessibleDescription(/Must be at least 1\./);
  });

  /** Tab reaches every segment, Enter on More puts the cursor in the field, Tab leaves it. */
  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Held initial="2" />);

    segment("4").focus();
    await user.tab();
    expect(segment("More")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(exact()).toHaveFocus();
    await user.keyboard("{Control>}a{/Control}6");
    expect(exact()).toHaveValue("6");

    await user.tab({ shift: true });
    expect(segment("More")).toHaveFocus();
    await user.tab({ shift: true });
    expect(segment("4")).toHaveFocus();
    await user.keyboard(" ");
    expect(segment("4")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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
        rule={HOUSEHOLD_RULES.number_children}
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

/** A field opened for a stored count stays open while it is edited, until a segment is picked. */
describe("a stored count above the segments, while it is edited", () => {
  it("keeps the field and its focus when the count is erased", async () => {
    const user = userEvent.setup();
    render(<Held initial="7" />);
    await user.click(exact());

    await user.keyboard("{Backspace}");

    expect(exact()).toHaveValue("");
    expect(exact()).toHaveFocus();
  });

  it("takes 12 typed over a stored 10, never pressing segment 1 on the way", async () => {
    const user = userEvent.setup();
    render(<Held initial="10" />);
    await user.click(exact());

    await user.keyboard("{Backspace}2");

    expect(exact()).toHaveValue("12");
    expect(exact()).toHaveFocus();
    expect(segment("1")).toHaveAttribute("aria-pressed", "false");
  });

  it("closes once a segment is picked", async () => {
    const user = userEvent.setup();
    render(<Held initial="7" />);

    await user.click(segment("2"));

    expect(screen.queryByRole("textbox", { name: "Adults, exact number" })).toBeNull();
    expect(segment("2")).toHaveAttribute("aria-pressed", "true");
  });
});
