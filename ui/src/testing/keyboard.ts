import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";

/**
 * What a keyboard user meets that jsdom does not show: Chromium's focus fix-up, the arrow keys
 * on a slider, and a control held still rather than disabled while a write is in flight.
 */

/**
 * **A focused control that becomes disabled loses focus to the page at once** in Chromium, and
 * enabling it again does not bring focus back. jsdom leaves focus on the disabled control, so a
 * test can go on pressing keys on something a keyboard user has already been thrown out of --
 * which is how controls that disabled themselves while a write was in flight passed every unit
 * test while sending a keyboard user back to the page after every step (NEW-34).
 *
 * jsdom already applies the other half of the rule -- a focused element taken out of the
 * document leaves focus on the page -- so only disabling is emulated here.
 *
 * **Opt-in, per test**: returns the way to stop, which is what `beforeEach` wants back.
 */
export function followChromiumFocusFixup(): () => void {
  const observer = new MutationObserver(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches(":disabled")) {
      focusThePage();
    }
  });
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled"],
  });
  return () => observer.disconnect();
}

/**
 * Moves focus to the page, firing `blur` on the control that had it, as Chromium does.
 *
 * jsdom will not blur an element it no longer counts as focusable, and a disabled one is not --
 * so the page takes focus instead, made focusable just long enough to do so.
 */
function focusThePage(): void {
  const page = document.body;
  page.tabIndex = -1;
  page.focus();
  page.removeAttribute("tabindex");
}

/**
 * **A slider holds its value snapped to its step** in Chromium (HTML's step-mismatch rule for a
 * range input): handed a rebalanced 29.17 with a step of 0.5, it reads back 29. jsdom keeps
 * 29.17, so a test of what a slider sends with nobody having moved it has to snap it first --
 * or it cannot see a release that sends the snapped weight nobody chose (NEW-43).
 */
export function snapToStep(slider: HTMLInputElement): void {
  const step = Number(slider.step);
  const lowest = Number(slider.min);
  const steps = Math.round((Number(slider.value) - lowest) / step);
  slider.value = String(lowest + steps * step);
}

/**
 * ArrowRight pressed on whatever has focus, handled the way a browser handles it on a slider.
 *
 * user-event sends the key and leaves a range input's value alone, so the step a browser takes
 * between the key going down and coming up -- the value moving one step and `change` firing --
 * is taken here. **Only when an enabled slider holds focus**: a key pressed after focus has gone
 * to the page moves nothing, which is the defect these tests exist to see.
 */
export async function pressArrowRight(user: UserEvent): Promise<void> {
  const focused = document.activeElement;
  await user.keyboard("{ArrowRight>}");
  if (
    focused instanceof HTMLInputElement &&
    focused.type === "range" &&
    !focused.disabled
  ) {
    const stepped = Number(focused.value) + Number(focused.step);
    fireEvent.change(focused, {
      target: { value: String(Math.min(stepped, Number(focused.max))) },
    });
  }
  await user.keyboard("{/ArrowRight}");
}

/**
 * **Held, not disabled** (NEW-34): a write is in flight, so the control takes no input -- and it
 * is still a control a keyboard can stand on, saying so with `aria-disabled` rather than with
 * `disabled`, which would throw focus off it.
 *
 * **And it looks held** (NEW-46): jsdom applies no stylesheet, so an attribute nothing styles
 * passed here while the control looked exactly as it does when it takes input. The stylesheet
 * is read as text and one of its held rules must match the control.
 */
export function expectHeld(control: HTMLElement): void {
  expect(control).toBeEnabled();
  expect(control).toHaveAttribute("aria-disabled", "true");
  expect(
    heldSelectors().some((selector) => control.matches(selector)),
    `no held rule in styles.css matches ${control.outerHTML.slice(0, 120)}`,
  ).toBe(true);
}

const HELD = '[aria-disabled="true"]';

/**
 * Every selector in `styles.css` that styles a held control -- `[aria-disabled="true"]` outside a
 * `:not(...)`, where it means the opposite. Read once: the sheet does not change during a run.
 */
const heldSelectors = (() => {
  let selectors: string[] | undefined;
  return (): string[] => {
    // Read from disk: vitest hands a test an empty string for any CSS import, `?raw` included.
    selectors ??= readHeldSelectors(
      readFileSync(join(__dirname, "..", "styles.css"), "utf8"),
    );
    return selectors;
  };
})();

export function readHeldSelectors(stylesheet: string): string[] {
  const rules = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g);
  return [...rules]
    .flatMap(([, prelude = ""]) => prelude.split(/,(?![^(]*\))/))
    .map((selector) => selector.trim())
    .filter((selector) => selector.replace(/:not\([^)]*\)/g, "").includes(HELD));
}

/** The write has answered and the control takes input again. */
export function expectNotHeld(control: HTMLElement): void {
  expect(control).not.toHaveAttribute("aria-disabled");
}
