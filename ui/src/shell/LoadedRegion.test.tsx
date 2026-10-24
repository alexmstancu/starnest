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
