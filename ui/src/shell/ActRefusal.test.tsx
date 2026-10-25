import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/ApiError";
import { ActRefusal } from "./ActRefusal";

/**
 * PL-004: the refusal of an act, as a screen holds it -- **dismissed by the reader without the
 * screen's hook having to know**, and back again for the next refusal, which is a new error.
 */

const LOCKED = new ApiError({ code: "weights_all_locked", message: "x", status: 409 });
const AGAIN = new ApiError({ code: "weights_all_locked", message: "x", status: 409 });

describe("the refusal of an act", () => {
  it("draws nothing while nothing was refused", () => {
    render(<ActRefusal act="The save" error={null} />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is gone once dismissed, and back for the next refusal", async () => {
    const { rerender } = render(<ActRefusal act="The save" error={LOCKED} />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<ActRefusal act="The save" error={AGAIN} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The save did not go through");
  });

  it("offers Try again only when the act may be sent again", async () => {
    const onResend = vi.fn(() => Promise.resolve());
    const { rerender } = render(<ActRefusal act="The save" error={LOCKED} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    rerender(<ActRefusal act="The estimate" error={LOCKED} onResend={onResend} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("keeps what the refusal names inside it, and puts it away with it", async () => {
    render(
      <ActRefusal act="The weight change" error={LOCKED}>
        <p>Locked, so unable to absorb the change</p>
      </ActRefusal>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Locked, so unable to absorb the change");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("Locked, so unable to absorb the change")).toBeNull();
  });
});
