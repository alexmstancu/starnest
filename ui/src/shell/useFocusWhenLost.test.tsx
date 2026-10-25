import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useFocusRegion, useFocusWhenLost } from "./useFocusWhenLost";

/** A region whose button can be replaced by a notice, or joined by one, on demand. */
function Region({ replace }: { replace: boolean }) {
  const region = useFocusRegion();
  const [shown, setShown] = useState(false);
  return (
    <section aria-label="region" onFocus={region.claim}>
      {!(replace && shown) && (
        <button type="button" onClick={() => setShown(true)}>
          Press
        </button>
      )}
      {shown && <Notice region={region} />}
    </section>
  );
}

function Notice({ region }: { region: ReturnType<typeof useFocusRegion> }) {
  const notice = useFocusWhenLost<HTMLParagraphElement>(region);
  return (
    <p ref={notice} tabIndex={-1}>
      Notice
    </p>
  );
}

/** A region whose notice arrives when its parent says, and a control outside it that leaves. */
function Elsewhere({ arrived }: { arrived: boolean }) {
  const region = useFocusRegion();
  const [outside, setOutside] = useState(true);
  return (
    <>
      <section aria-label="region" onFocus={region.claim}>
        {arrived ? <Notice region={region} /> : <button type="button">Press</button>}
      </section>
      {outside && (
        <button type="button" onClick={() => setOutside(false)}>
          Leave
        </button>
      )}
    </>
  );
}

describe("the notice that replaces a pressed control", () => {
  it("takes nothing once focus has been somewhere else since its control had it", async () => {
    const { rerender } = render(<Elsewhere arrived={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Press" }));
    // Focus leaves the region, and is then lost where it went, not where the notice lands.
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(document.activeElement).toBe(document.body);

    rerender(<Elsewhere arrived />);

    expect(screen.getByText("Notice")).not.toHaveFocus();
  });

  it("takes the focus its control had", async () => {
    render(<Region replace />);

    await userEvent.click(screen.getByRole("button", { name: "Press" }));

    expect(screen.getByText("Notice")).toHaveFocus();
  });

  it("leaves focus where it is when nothing it replaced lost it", async () => {
    render(<Region replace={false} />);
    const press = screen.getByRole("button", { name: "Press" });

    await userEvent.click(press);

    expect(screen.getByText("Notice")).toBeInTheDocument();
    expect(press).toHaveFocus();
  });
});
