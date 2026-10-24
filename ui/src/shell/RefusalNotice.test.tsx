import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/ApiError";
import { presentError } from "../api/errorPresentation";
import { RefusalNotice } from "./RefusalNotice";

/**
 * An act that did not go through (C01 M2, PL-004). **Every refusal can be dismissed, and "Try
 * again" appears only where pressing it sends the same request again** (P1-14): a start sent
 * twice could begin a second paid run.
 */

const REFUSED = new ApiError({
  code: "weights_all_locked",
  message: "All other weights are locked.",
  status: 409,
});

function renderNotice(onResend?: () => Promise<void>) {
  const onDismiss = vi.fn();
  render(
    <RefusalNotice act="The estimate" error={REFUSED} onDismiss={onDismiss} onResend={onResend} />,
  );
  return onDismiss;
}

describe("a refusal", () => {
  it("says which act did not go through, and why", () => {
    renderNotice();
    const notice = screen.getByRole("alert");

    expect(notice).toHaveTextContent("The estimate did not go through");
    expect(notice).toHaveTextContent(presentError(REFUSED).message);
    expect(notice).not.toHaveTextContent(REFUSED.code);
  });

  it("can always be dismissed", async () => {
    const onDismiss = renderNotice();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("offers no Try again for an act that may not be sent twice (P1-14)", () => {
    renderNotice();

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("sends the act again on Try again, where that is safe", async () => {
    const onResend = vi.fn(() => Promise.resolve());
    renderNotice(onResend);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("cannot be drawn without a way to dismiss it", () => {
    // @ts-expect-error -- every refusal can be dismissed (PL-004), so leaving it out is an error
    const notice = <RefusalNotice act="The save" error={REFUSED} />;

    expect(notice).toBeTruthy();
  });
});
