import { expectHeld, readHeldSelectors } from "./keyboard";

function heldButton(className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = className;
  button.setAttribute("aria-disabled", "true");
  document.body.append(button);
  return button;
}

afterEach(() => document.body.replaceChildren());

describe("expectHeld", () => {
  it("passes a held control the stylesheet draws as held", () => {
    expect(() => expectHeld(heldButton("button"))).not.toThrow();
  });

  it("fails a held control no held rule in the stylesheet matches", () => {
    expect(() => expectHeld(heldButton("nothing-styles-this"))).toThrow(
      /no held rule in styles\.css matches/,
    );
  });
});

describe("readHeldSelectors", () => {
  it("keeps a held selector and drops one where held sits inside :not()", () => {
    const sheet = `
      /* .commented[aria-disabled="true"] { opacity: 0 } */
      .a:hover:not(:disabled, [aria-disabled="true"]) { color: red; }
      .b:disabled,
      .b[aria-disabled="true"] { opacity: 0.45; }
      @media (min-width: 1px) { .c[aria-disabled="true"] { opacity: 0.45; } }
    `;
    expect(readHeldSelectors(sheet)).toEqual([
      '.b[aria-disabled="true"]',
      '.c[aria-disabled="true"]',
    ]);
  });
});
