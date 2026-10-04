import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CandidateField } from "./CandidateField";

const COUNTRIES = [
  { id: "country.austria", name: "Austria" },
  { id: "country.portugal", name: "Portugal" },
  { id: "country.united_kingdom", name: "United Kingdom" },
];

function draw(value = "", onChange = vi.fn(), options = COUNTRIES) {
  render(
    <CandidateField
      id="home"
      label="Home country"
      options={options}
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("choosing a place from the roster", () => {
  it("shows the name of what is stored, not its id", () => {
    draw("country.austria");

    expect(screen.getByRole("combobox", { name: "Home country" })).toHaveValue(
      "Austria",
    );
  });

  it("offers the whole roster when it is opened", async () => {
    draw();

    await userEvent.click(screen.getByRole("combobox", { name: "Home country" }));

    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("narrows the list as it is typed", async () => {
    draw();
    const box = screen.getByRole("combobox", { name: "Home country" });

    await userEvent.type(box, "aus");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Austria" })).toBeInTheDocument();
  });

  it("commits the id when an option is chosen, never the typed text", async () => {
    const onChange = draw();
    await userEvent.type(
      screen.getByRole("combobox", { name: "Home country" }),
      "portu",
    );

    await userEvent.click(screen.getByRole("option", { name: "Portugal" }));

    expect(onChange).toHaveBeenCalledWith("country.portugal");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  /**
   * **The whole point of the control.** The owner's complaint was that this field was free
   * text: "I could write there my telephone number if I wanted to, a poem." Typing commits
   * nothing at all -- the stored value only ever changes through an option.
   */
  it("commits nothing while a name is merely being typed", async () => {
    const onChange = draw();

    await userEvent.type(
      screen.getByRole("combobox", { name: "Home country" }),
      "Atlantis",
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops digits and punctuation as they are typed", async () => {
    draw();
    const box = screen.getByRole("combobox", { name: "Home country" });

    await userEvent.type(box, "0721+Portugal!");

    expect(box).toHaveValue("Portugal");
  });

  it("says so when nothing matches, rather than showing an empty list", async () => {
    draw();

    await userEvent.type(
      screen.getByRole("combobox", { name: "Home country" }),
      "zzz",
    );

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/nothing here matches/i)).toBeInTheDocument();
  });

  /** A half-typed name is a filter, not an answer, so leaving discards it. */
  it("goes back to what is stored when it loses focus", async () => {
    draw("country.austria");
    const box = screen.getByRole("combobox", { name: "Home country" });
    await userEvent.type(box, "portu");

    await userEvent.tab();

    // Testing Library's `waitFor`, not vitest's: the restoring update comes from a 120ms
    // timer, and only this one wraps the poll in `act`.
    await waitFor(() => expect(box).toHaveValue("Austria"));
  });

  it("chooses the only match when Enter is pressed", async () => {
    const onChange = draw();
    const box = screen.getByRole("combobox", { name: "Home country" });

    await userEvent.type(box, "kingdom{Enter}");

    expect(onChange).toHaveBeenCalledWith("country.united_kingdom");
  });

  it("does not guess when Enter is pressed on an ambiguous filter", async () => {
    const onChange = draw();

    await userEvent.type(
      screen.getByRole("combobox", { name: "Home country" }),
      "a{Enter}",
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes the list on Escape without changing anything", async () => {
    const onChange = draw("country.austria");
    const box = screen.getByRole("combobox", { name: "Home country" });
    await userEvent.click(box);

    await userEvent.type(box, "{Escape}");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  /** A value stored before this control existed, or by hand against the database. */
  it("warns about a stored value the roster does not hold", () => {
    draw("country.atlantis");

    expect(screen.getByText(/nothing in the database is called that/i))
      .toBeInTheDocument();
  });

  it("accuses nobody while the roster has not arrived", () => {
    draw("country.austria", vi.fn(), []);

    expect(screen.queryByText(/nothing in the database is called that/i))
      .not.toBeInTheDocument();
  });

  it("says why it is empty when the level has no candidates at all", () => {
    render(
      <CandidateField
        id="city"
        label="Home city"
        options={[]}
        value=""
        onChange={vi.fn()}
        nothingOffered="City level arrives after v1"
      />,
    );

    const box = screen.getByRole("combobox", { name: "Home city" });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("placeholder", "City level arrives after v1");
  });
});
