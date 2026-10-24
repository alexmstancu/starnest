import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NumberRule } from "../format/typedNumber";
import { NumberField } from "./NumberField";

/**
 * T24-3. The one box that takes a number (PL-024, UF-026). It hands the caller exactly what was
 * typed, marks a refusal on itself with the sentence that says what to type, and when held it
 * stays focusable -- `readOnly` and `aria-disabled`, never `disabled` (NEW-34).
 */

const MONEY: NumberRule = { kind: "money", optional: false };

function Controlled({
  rule = MONEY,
  initial = "",
  onChange = () => {},
  ...rest
}: {
  rule?: NumberRule;
  initial?: string;
  onChange?: (text: string) => void;
} & Partial<Parameters<typeof NumberField>[0]>) {
  const [value, setValue] = useState(initial);
  return (
    <NumberField
      id="income"
      label="Net income"
      rule={rule}
      {...rest}
      value={value}
      onChange={(text) => {
        setValue(text);
        onChange(text);
      }}
    />
  );
}

describe("a number field", () => {
  it("keeps what was typed and hands it on unchanged", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.type(screen.getByRole("textbox", { name: "Net income" }), "72,000");

    expect(screen.getByRole("textbox", { name: "Net income" })).toHaveValue("72,000");
    expect(onChange).toHaveBeenLastCalledWith("72,000");
  });

  it("is a text box with the keypad its kind needs", () => {
    render(
      <>
        <Controlled id="a" label="Whole" rule={{ kind: "whole", optional: true }} />
        <Controlled id="b" label="Money" />
      </>,
    );

    const whole = screen.getByRole("textbox", { name: "Whole" });
    expect(whole).toHaveAttribute("type", "text");
    expect(whole).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByRole("textbox", { name: "Money" })).toHaveAttribute(
      "inputmode",
      "decimal",
    );
  });

  it("marks a figure it cannot read, and says what to type", () => {
    render(<Controlled initial="72,000" />);
    const box = screen.getByRole("textbox", { name: "Net income" });

    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(/Type 72000, or 72 if the comma was a decimal point/);
  });

  it("is not marked while what it holds is a number", () => {
    render(<Controlled initial="72000" />);

    expect(screen.getByRole("textbox", { name: "Net income" })).toHaveAttribute(
      "aria-invalid",
      "false",
    );
  });

  it("waits for the reader to leave a half-typed figure before saying anything", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole("textbox", { name: "Net income" });

    await user.type(box, ".");
    expect(box).toHaveAttribute("aria-invalid", "false");

    await user.tab();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(/Not a number/);
  });

  it("asks for a required figure only once the reader has left it blank", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const box = screen.getByRole("textbox", { name: "Net income" });
    expect(box).toHaveAttribute("aria-invalid", "false");

    await user.click(box);
    await user.tab();

    expect(box).toHaveAccessibleDescription(/Required/);
  });

  it("shows a problem it was given, such as the server's", () => {
    render(<Controlled initial="72000" problem="At most 50000." />);
    const box = screen.getByRole("textbox", { name: "Net income" });

    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(/At most 50000\./);
  });

  it("describes itself by its note, its unit and its bounds", () => {
    render(
      <Controlled
        rule={{ kind: "decimal", minimum: 0, maximum: 100, optional: true }}
        note="Below it, a candidate is insufficient data."
        suffix="%"
      />,
    );

    expect(screen.getByRole("textbox", { name: "Net income" })).toHaveAccessibleDescription(
      "% Below it, a candidate is insufficient data. From 0 to 100.",
    );
  });

  it("is held without losing focus: read-only and aria-disabled, never disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial="5" held onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Net income" });

    await user.click(box);
    await user.keyboard("9");

    expect(box).not.toBeDisabled();
    expect(box).toHaveAttribute("readonly");
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(box).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("can take its name from an unseen label, for a cell in a table", () => {
    render(<Controlled label="Anchor 1 value" labelHidden />);

    expect(screen.getByRole("textbox", { name: "Anchor 1 value" })).toBeInTheDocument();
    expect(screen.queryByText("Anchor 1 value")).not.toBeInTheDocument();
  });

  it("puts its prefix beside the box, out of its name", () => {
    render(<Controlled prefix="€" />);

    expect(screen.getByRole("textbox", { name: "Net income" })).toBeInTheDocument();
    expect(screen.getByText("€")).toHaveAttribute("aria-hidden", "true");
  });

  it("says when blank is an unset value, as a placeholder", () => {
    render(
      <Controlled rule={{ kind: "whole", optional: true }} placeholder="Not set" unset="blocking" />,
    );

    expect(screen.getByRole("textbox", { name: "Net income" })).toHaveAttribute(
      "placeholder",
      "Not set",
    );
  });
});

/**
 * C02-S8: the box itself is marked, not only its note. jsdom cascades the real stylesheet, so
 * deleting the refused-box rule, or writing it above `.field__control`, turns this red.
 */
describe("a refused number field's look", () => {
  const sheet = document.createElement("style");
  beforeAll(() => {
    sheet.textContent = readFileSync(join(__dirname, "../styles.css"), "utf8");
    document.head.append(sheet);
  });
  afterAll(() => sheet.remove());

  // jsdom drops a `var()` border shorthand from its cascade, so the fill is what is read.
  it.each([
    ["72,000", "var(--colour-invalid-surface)"],
    ["72000", "var(--colour-surface)"],
  ])("fills %j with the ground of its state", (initial, fill) => {
    render(<Controlled initial={initial} />);
    const box = screen.getByRole("textbox", { name: "Net income" });

    expect(getComputedStyle(box).getPropertyValue("background")).toBe(fill);
  });
});
