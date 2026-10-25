import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { renderShell } from "../testing/renderShell";
import { SelectionProvider, useSelection } from "./SelectionContext";
import { SELECTION_KEY } from "./sessionState";

const BASE = "/v1";

function wrapper({ children }: { children: ReactNode }) {
  return <SelectionProvider>{children}</SelectionProvider>;
}

describe("the selection's read (PL-009, PL-010)", () => {
  it("is pending, with no sets, until both lists have arrived", () => {
    const { result } = renderHook(() => useSelection(), { wrapper });

    expect(result.current.read.state).toBe("pending");
    expect(result.current.criteriaSets).toEqual([]);
  });

  it("is failed when either list fails, never an empty ready", async () => {
    mockServer.use(http.get(`${BASE}/levels`, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useSelection(), { wrapper });

    await waitFor(() => expect(result.current.read.state).toBe("failed"));
  });

  it("keeps the sets while they are read again, and reload settles once they land", async () => {
    let release = () => {};
    let reads = 0;
    mockServer.use(
      http.get(`${BASE}/criteria-sets`, async () => {
        reads += 1;
        if (reads > 1) await new Promise<void>((resolve) => (release = resolve));
        return undefined;
      }),
    );
    const { result } = renderHook(() => useSelection(), { wrapper });
    await waitFor(() => expect(result.current.read.state).toBe("ready"));
    const sets = result.current.criteriaSets;
    expect(sets.length).toBeGreaterThan(0);

    let settled = false;
    act(() => {
      void result.current.reloadAndWait().then(() => (settled = true));
    });

    await waitFor(() => expect(reads).toBe(2));
    expect(result.current.criteriaSets).toBe(sets);
    expect(result.current.read).toMatchObject({ state: "ready", refresh: "running" });
    expect(settled).toBe(false);

    act(() => release());
    await waitFor(() => expect(settled).toBe(true));
    expect(result.current.read).toMatchObject({ state: "ready", refresh: "idle" });
  });
});

/** The sidebar's set picker. */
function setPicker(): HTMLElement {
  return screen.getByRole("combobox", { name: /active criteria set/i });
}

async function opensOn(id: string) {
  await waitFor(() => expect(setPicker()).toHaveValue(id));
}

function remember(where: Storage, criteriaSet: { id: string; name: string }) {
  where.setItem(SELECTION_KEY, JSON.stringify({ criteriaSet, levelId: "country" }));
}

describe("the remembered selection (PL-017)", () => {
  it("a reload keeps Remote only", async () => {
    const page = renderShell("/rank");
    await opensOn("default");
    await userEvent.selectOptions(setPicker(), "remote-only");

    page.unmount();
    renderShell("/rank");

    await opensOn("remote-only");
  });

  it("a new tab opens on the last set used", async () => {
    const page = renderShell("/rank");
    await opensOn("default");
    await userEvent.selectOptions(setPicker(), "remote-only");
    page.unmount();

    window.sessionStorage.clear();
    renderShell("/rank");

    await opensOn("remote-only");
  });

  it("two tabs each keep their own set: a reload is not moved by the other tab's choice", async () => {
    remember(window.sessionStorage, { id: "default", name: "Default" });
    remember(window.localStorage, { id: "remote-only", name: "Remote only" });

    renderShell("/rank");

    await opensOn("default");
  });

  it("a remembered set that no longer exists falls back to the first and says so", async () => {
    // A deleted set is soft-deleted: gone from the list, and 404 to anything that asks for it.
    const askedForIt: string[] = [];
    mockServer.events.on("request:start", ({ request }) => {
      if (request.url.includes("retired")) askedForIt.push(request.url);
    });
    remember(window.sessionStorage, { id: "retired", name: "Old plan" });

    try {
      renderShell("/rank");

      await opensOn("default");
      expect(
        await screen.findByText(
          "The criteria set you last used, Old plan, no longer exists, so Default is open instead.",
        ),
      ).toBeInTheDocument();
      expect(askedForIt).toEqual([]);
    } finally {
      mockServer.events.removeAllListeners();
    }
  });

  it("stops saying a set was gone once another is chosen", async () => {
    remember(window.sessionStorage, { id: "retired", name: "Old plan" });
    renderShell("/rank");
    await screen.findByText(/Old plan, no longer exists/);

    await userEvent.selectOptions(setPicker(), "remote-only");

    expect(screen.queryByText(/no longer exists/)).toBeNull();
  });

  it("ignores a remembered selection it cannot read, and opens on the first", async () => {
    window.sessionStorage.setItem(SELECTION_KEY, "{not json");
    window.localStorage.setItem(SELECTION_KEY, JSON.stringify({ criteriaSet: 7 }));

    renderShell("/rank");

    await opensOn("default");
    expect(screen.queryByText(/no longer exists/)).toBeNull();
  });
});
