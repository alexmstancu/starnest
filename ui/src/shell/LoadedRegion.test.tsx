import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Read } from "../api/read";
import { AppConfigProvider } from "../config/AppConfigContext";
import { formatDateTime } from "../format/display";
import { LoadedRegion } from "./LoadedRegion";

/**
 * How a read is drawn: a skeleton while it is on its way, the failure card when it never
 * arrived, and what it read otherwise -- **never a default standing in for it** (PL-001), since
 * a default is how a zero gets drawn.
 */

const READ_AT = new Date("2026-10-24T13:14:00Z");
const BOOM = new Error("the server is down");

function renderRegion(read: Read<string>) {
  const onRetry = vi.fn();
  const draw = vi.fn((figures: string) => <p>{figures}</p>);
  const { container } = render(
    <AppConfigProvider config={{ displayName: "Test Nest" }}>
      <LoadedRegion read={read} what="The ranking" skeleton="rank-table" onRetry={onRetry}>
        {draw}
      </LoadedRegion>
    </AppConfigProvider>,
  );
  return { container, onRetry, draw };
}

function busy(container: HTMLElement) {
  return container.querySelectorAll('[aria-busy="true"]');
}

describe("a region while its read is pending", () => {
  it("draws a skeleton in a busy region, and nothing the read would have drawn", () => {
    const { container, draw } = renderRegion({ state: "pending" });

    expect(busy(container)).toHaveLength(1);
    expect(busy(container)[0]?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(draw).not.toHaveBeenCalled();
    expect(container).not.toHaveTextContent(/loading/i);
  });
});

describe("a region whose read failed", () => {
  it("shows the failure card instead of the content, with Try again", async () => {
    const { container, onRetry, draw } = renderRegion({ state: "failed", error: BOOM });

    expect(screen.getByRole("alert")).toHaveTextContent("The ranking could not be loaded");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(draw).not.toHaveBeenCalled();
    expect(busy(container)).toHaveLength(0);
  });
});

describe("a region whose read is ready", () => {
  it("draws what was read, in a region that is not busy", () => {
    const { container } = renderRegion({
      state: "ready",
      data: "figures",
      readAt: READ_AT,
      refresh: "idle",
    });

    expect(screen.getByText("figures")).toBeInTheDocument();
    expect(busy(container)).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps what was read on screen, marked busy, while it is read again", () => {
    renderRegion({ state: "ready", data: "figures", readAt: READ_AT, refresh: "running" });

    expect(screen.getByText("figures").closest("[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("keeps what was read when the re-read failed, saying when it was read (P1-05)", async () => {
    const { onRetry } = renderRegion({
      state: "ready",
      data: "figures",
      readAt: READ_AT,
      refresh: { failed: BOOM },
    });

    expect(screen.getByText("figures")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      `The ranking could not be refreshed, shown as read at ${formatDateTime(READ_AT.toISOString())}`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

/**
 * Try again takes its own button away -- the read goes pending, or the stale line goes -- and a
 * browser answers by putting focus on the page. A keyboard user must not start again at the top
 * on every retry, nor be pulled back if they have tabbed somewhere else meanwhile.
 */
describe("focus across a retry", () => {
  function renderRetryable(initial: Read<string>) {
    const tree = (read: Read<string>) => (
      <AppConfigProvider config={{ displayName: "Test Nest" }}>
        <LoadedRegion read={read} what="The ranking" skeleton="rank-table" onRetry={vi.fn()}>
          {(figures) => <p>{figures}</p>}
        </LoadedRegion>
        <button type="button">Elsewhere</button>
      </AppConfigProvider>
    );
    const { rerender } = render(tree(initial));
    return { settle: (read: Read<string>) => rerender(tree(read)) };
  }

  async function pressTryAgain() {
    screen.getByRole("button", { name: "Try again" }).focus();
    await userEvent.keyboard("{Enter}");
  }

  const stale: Read<string> = {
    state: "ready",
    data: "figures",
    readAt: READ_AT,
    refresh: { failed: BOOM },
  };

  it("puts focus on the new Try again when the read fails again", async () => {
    const { settle } = renderRetryable({ state: "failed", error: BOOM });

    await pressTryAgain();
    settle({ state: "pending" });
    expect(document.activeElement).not.toBe(document.body);
    settle({ state: "failed", error: BOOM });

    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
  });

  it("puts focus on the new Try again when a refresh fails again, keeping the data", async () => {
    const { settle } = renderRetryable(stale);

    await pressTryAgain();
    settle({ ...stale, refresh: "running" });
    expect(document.activeElement).not.toBe(document.body);
    settle(stale);

    expect(screen.getByText("figures")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
  });

  it("leaves focus in the region when the retry succeeds", async () => {
    const { settle } = renderRetryable({ state: "failed", error: BOOM });

    await pressTryAgain();
    settle({ state: "pending" });
    settle({
      state: "ready",
      data: "figures",
      readAt: READ_AT,
      refresh: "idle",
    });

    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByText("figures").closest("[tabindex]")).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("leaves focus alone when the reader moved it elsewhere before the retry settled", async () => {
    const { settle } = renderRetryable({ state: "failed", error: BOOM });

    await pressTryAgain();
    settle({ state: "pending" });
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    settle({ state: "failed", error: BOOM });

    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("stops holding focus once the retry has settled", async () => {
    const { settle } = renderRetryable({ state: "failed", error: BOOM });
    const ready: Read<string> = {
      state: "ready",
      data: "figures",
      readAt: READ_AT,
      refresh: "idle",
    };

    await pressTryAgain();
    settle(ready);
    (document.activeElement as HTMLElement).blur();
    settle({ ...ready, refresh: "running" });

    expect(document.body).toHaveFocus();
  });
});
