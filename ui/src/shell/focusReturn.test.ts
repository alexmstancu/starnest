import { afterEach, describe, expect, it } from "vitest";
import { refocusIfLost } from "./focusReturn";

/** Buttons appended to the page for one test, and removed after it. */
function buttons(...labels: string[]): HTMLButtonElement[] {
  return labels.map((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    document.body.append(button);
    return button;
  });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("where focus goes once the control that had it is gone (NEW-45)", () => {
  it("gives it to the first target when it has fallen to the page", () => {
    const [first, second] = buttons("first", "second");

    refocusIfLost(first, second);

    expect(first).toHaveFocus();
  });

  it("passes over a target that is disabled, and gives it to the next", () => {
    const [held, next] = buttons("held", "next");
    held!.disabled = true;

    refocusIfLost(held, next);

    expect(next).toHaveFocus();
  });

  it("passes over a target no longer on the page, and one not given at all", () => {
    const [gone, next] = buttons("gone", "next");
    gone!.remove();

    refocusIfLost(gone, null, undefined, next);

    expect(next).toHaveFocus();
  });

  /**
   * **Only when it was lost.** A reader who moved focus somewhere else while the write was in
   * flight put it there on purpose, and taking it back would be the screen deciding for them.
   */
  it("leaves focus where the reader put it", () => {
    const [target, chosen] = buttons("target", "chosen");
    chosen!.focus();

    refocusIfLost(target);

    expect(chosen).toHaveFocus();
  });

  it("leaves focus on the page when no target can take it", () => {
    const [held] = buttons("held");
    held!.disabled = true;

    refocusIfLost(held);

    expect(document.body).toHaveFocus();
  });

  /**
   * Chromium drops focus from a control the moment it is disabled; jsdom leaves it there. Either
   * way the reader can no longer act on it, so it counts as lost.
   */
  it("counts focus left on a control since disabled as lost", () => {
    const [arrow, other] = buttons("arrow", "other");
    arrow!.focus();
    arrow!.disabled = true;

    refocusIfLost(arrow, other);

    expect(other).toHaveFocus();
  });
});
