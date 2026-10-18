import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    // Backwards, out of the picker. Forwards, Tab lands on the option first (UI-26).
    await userEvent.tab({ shift: true });

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

/**
 * UI-26. **Tabbing into the list made it vanish under the keyboard.** The list closed 120 ms
 * after the box lost focus -- to one of its own options as much as to anything else -- so the
 * option Tab had just landed on was taken off the page, and the keyboard with it. It now closes
 * only when focus leaves the picker altogether.
 *
 * **On a clock that stands still until a test moves it**, because the fault is time passing: a
 * person takes longer than 120 ms to press the next key, and a test pressing it at once did not.
 */
describe("choosing a place from the keyboard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function keyboard() {
    // Advancing with real time as well, because Testing Library ends every user-event call on a
    // zero-delay timer that it only knows how to advance under Jest.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  }

  /** As long as anybody takes to read an option before pressing the next key. */
  function aMomentPasses(): void {
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
  }

  function theBox(): HTMLElement {
    return screen.getByRole("combobox", { name: "Home country" });
  }

  it("keeps the list open, and the option focused, when Tab moves onto one", async () => {
    const user = keyboard();
    draw();
    await user.type(theBox(), "a");

    await user.tab();
    aMomentPasses();

    expect(screen.getByRole("option", { name: "Austria" })).toHaveFocus();
    expect(theBox()).toHaveAttribute("aria-expanded", "true");
    // Still the filter that was typed: moving into the list is not leaving the picker.
    expect(theBox()).toHaveValue("a");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("chooses the focused option with Enter, and goes back to the box", async () => {
    const user = keyboard();
    const onChange = draw();
    await user.type(theBox(), "a");
    await user.tab();
    await user.tab();
    aMomentPasses();
    expect(screen.getByRole("option", { name: "Portugal" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("country.portugal");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
    // Not on the page: the option it was on has gone, so the keyboard goes back to the field.
    expect(theBox()).toHaveFocus();
  });

  it("chooses the focused option with Space", async () => {
    const user = keyboard();
    const onChange = draw();
    await user.click(theBox());
    await user.tab();
    aMomentPasses();

    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith("country.austria");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(theBox()).toHaveFocus();
  });

  it("closes the list, and discards what was typed, once Tab moves past the last option", async () => {
    const user = keyboard();
    const onChange = draw("country.austria");
    await user.clear(theBox());
    await user.type(theBox(), "a");
    await user.tab();
    await user.tab();

    await user.tab();
    aMomentPasses();

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(theBox()).toHaveAttribute("aria-expanded", "false");
    expect(theBox()).toHaveValue("Austria");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes the list when Shift+Tab leaves the box", async () => {
    const user = keyboard();
    draw();
    await user.click(theBox());

    await user.tab({ shift: true });
    aMomentPasses();

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(theBox()).not.toHaveFocus();
  });

  it("keeps the list open when Shift+Tab goes back from an option to the box", async () => {
    const user = keyboard();
    draw();
    await user.click(theBox());
    await user.tab();

    await user.tab({ shift: true });
    aMomentPasses();

    expect(theBox()).toHaveFocus();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("closes the list on Escape from an option, and goes back to the box", async () => {
    const user = keyboard();
    const onChange = draw("country.austria");
    await user.click(theBox());
    await user.tab();
    aMomentPasses();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(theBox()).toHaveFocus();
    expect(theBox()).toHaveValue("Austria");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still chooses with a click, and leaves the box focused", async () => {
    const user = keyboard();
    const onChange = draw();
    await user.click(theBox());
    aMomentPasses();

    await user.click(screen.getByRole("option", { name: "United Kingdom" }));

    expect(onChange).toHaveBeenCalledWith("country.united_kingdom");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(theBox()).toHaveFocus();
  });

  /** The box keeps focus after a choice, so a click on it has to be what opens the list again. */
  it("opens the list again when the box it left focused is clicked", async () => {
    const user = keyboard();
    draw();
    await user.click(theBox());
    await user.click(screen.getByRole("option", { name: "Portugal" }));

    await user.click(theBox());

    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});
