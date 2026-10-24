import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "../api/ApiError";
import { presentError } from "../api/errorPresentation";
import { AppConfigProvider } from "../config/AppConfigContext";
import { ReadFailureCard } from "./ReadFailureCard";

/**
 * A read that never arrived (C01 M2). **One full card per screen, and a compact line for every
 * other region that failed with it** (P1-06): six full cards for one stopped server is six
 * times the same paragraph, and the reader has to find the one thing that differs.
 */

const UNREACHABLE = new ApiError({
  code: CLIENT_ERROR_CODES.unreachable,
  message: "Failed to fetch",
});
const REFUSED = new ApiError({ code: "not_found", message: "No such ranking.", status: 404 });
const ASSURANCE = "Nothing on this screen has changed, and nothing was charged.";
const SERVER_DOWN =
  "If this keeps happening, the Test Nest server is probably not running. Start it, then try again.";

function renderCard(error: unknown, prominence: "screen" | "region") {
  const onRetry = vi.fn();
  render(
    <AppConfigProvider config={{ displayName: "Test Nest" }}>
      <ReadFailureCard what="The ranking" error={error} onRetry={onRetry} prominence={prominence} />
    </AppConfigProvider>,
  );
  return onRetry;
}

describe("the card a screen shows", () => {
  it("names what could not be loaded, why, and that nothing changed", async () => {
    const onRetry = renderCard(REFUSED, "screen");
    const card = screen.getByRole("alert");

    expect(card).toHaveTextContent("The ranking could not be loaded");
    expect(card).toHaveTextContent(presentError(REFUSED).message);
    expect(card).toHaveTextContent(ASSURANCE);
    expect(card).not.toHaveTextContent(SERVER_DOWN);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says the server is probably not running, by its name, when it did not answer", () => {
    renderCard(UNREACHABLE, "screen");

    expect(screen.getByRole("alert")).toHaveTextContent(SERVER_DOWN);
  });
});

describe("the line every other region shows (P1-06)", () => {
  it("is its title and Try again, and interrupts nobody", async () => {
    const onRetry = renderCard(UNREACHABLE, "region");
    const line = screen.getByRole("status");

    expect(line).toHaveTextContent("The ranking could not be loaded");
    expect(line).not.toHaveTextContent(presentError(UNREACHABLE).message);
    expect(line).not.toHaveTextContent(ASSURANCE);
    expect(line).not.toHaveTextContent(SERVER_DOWN);
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe.each(["screen", "region"] as const)("the %s form", (prominence) => {
  it("never prints the code, which is for branching on and not for reading", () => {
    renderCard(UNREACHABLE, prominence);

    expect(document.body).not.toHaveTextContent(CLIENT_ERROR_CODES.unreachable);
  });
});
