import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { patchJson } from "../../../api/client";
import { fetchDataSources } from "../../../api/endpoints";
import { DATA_SOURCES } from "../../../mocks/fixtures";
import { mockServer } from "../../../mocks/server";
import {
  expectHeld,
  expectNotHeld,
  followChromiumFocusFixup,
} from "../../../testing/keyboard";
import { renderShell } from "../../../testing/renderShell";

/**
 * Which sources are consulted, and in what order.
 *
 * The order is the point: it decides which figure is the active one, so the tests assert the
 * sequence rather than only that the rows exist.
 *
 * **Editable since Q232.** What a source *is* stays catalog, changed by migration; whether it
 * is consulted and where it stands is a judgement about evidence, and the household makes it.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Source priority" }));
}

describe("the source priority panel", () => {
  it("lists every source in priority order, lowest number first", async () => {
    renderShell("/configure");
    const sources = await panel();

    const names = (await sources.findAllByRole("listitem")).map((item) =>
      item.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Eurostat", "Manual entry", "LLM with web search"]);
  });

  it("names how each source answers, so a figure from a model is recognisable as one", async () => {
    renderShell("/configure");

    // **One fact, in words.** This column used to print the kind and the tier chained with a
    // comma -- "structured, official_international" -- which is two facts and two identifiers
    // nobody outside the code should read. A source nobody consults says that instead, because
    // it is the more useful fact about it.
    const eurostat = await screen.findByRole("listitem", { name: "Eurostat" });
    expect(eurostat).toHaveTextContent("published dataset");
  });

  it("says what switching a source off does, and what it does not", async () => {
    renderShell("/configure");
    const sources = await panel();

    // The non-destructive half is the part worth stating: a reader has to know that
    // switching one off is not the same as throwing its figures away.
    expect(
      sources.getByText(/every figure it has already produced is kept/i),
    ).toBeInTheDocument();
  });

  /**
   * A switched-off source is not in the contest, so it has no place in the order. Showing it
   * one would say it is next in line when it is not consulted at all.
   */
  it("gives a switched-off source no position, and closes the numbering up", async () => {
    renderShell("/configure");

    expect(
      await screen.findByRole("listitem", { name: "LLM with web search" }),
    ).toHaveTextContent("not consulted");
    expect(
      screen.getByRole("listitem", { name: "Manual entry" }),
    ).toHaveTextContent("2");
  });

  it("switches a source on, and it takes its place in the order", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("switch", {
        name: "Consult LLM with web search",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "LLM with web search" }),
      ).toHaveTextContent("3"),
    );
  });

  it("switches a source off, and it leaves the order", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("switch", { name: "Consult Eurostat" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "Eurostat" }),
      ).toHaveTextContent("not consulted"),
    );
  });

  /** A lower number wins, so moving up means taking the priority above. */
  it("moves a source up the order", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("button", { name: "Move Manual entry up" }),
    );

    await waitFor(() => {
      const names = sources
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label"));
      expect(names[0]).toBe("Manual entry");
    });
  });

  /** The other arrow, which nothing clicked: a lower number wins, so down means giving it up. */
  it("moves a source down the order", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("button", { name: "Move Eurostat down" }),
    );

    await waitFor(() =>
      expect(namesInOrder(sources)).toEqual([
        "Manual entry",
        "Eurostat",
        "LLM with web search",
      ]),
    );
  });

  it("will not move the first source up, or the last one down", async () => {
    renderShell("/configure");
    const sources = await panel();

    expect(
      await sources.findByRole("button", { name: "Move Eurostat up" }),
    ).toBeDisabled();
    expect(
      sources.getByRole("button", { name: "Move LLM with web search down" }),
    ).toBeDisabled();
    // Disabled outright rather than held: nothing is in flight, there is only nowhere to go.
    expectNotHeld(sources.getByRole("button", { name: "Move Eurostat up" }));
  });

  /**
   * PL-137. **Two sources sharing a priority are swapped, not refused**: the reorder hands the
   * pair distinct numbers, read back by id, and every other tier is left where it was.
   */
  it("swaps two sources that share a priority", async () => {
    const user = userEvent.setup();
    await patchJson("/data-sources/{dataSourceId}", { default_priority: 10 }, {
      pathParams: { dataSourceId: "manual" },
    });
    renderShell("/configure");
    const sources = await panel();

    const up = await sources.findByRole("button", { name: "Move Manual entry up" });
    expect(up).toBeEnabled();
    await user.click(up);

    await waitFor(() =>
      expect(namesInOrder(sources)).toEqual(["Manual entry", "Eurostat", "LLM with web search"]),
    );
    expect(await storedPriorities()).toEqual({ manual: 10, eurostat: 11, llm: 90 });
    expect(sources.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a refusal to change a source, and keeps the list readable", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sources = await panel();
    await sources.findByRole("switch", { name: "Consult Eurostat" });

    mockServer.use(
      http.patch("/v1/data-sources/:dataSourceId", () =>
        HttpResponse.json(
          { code: "unknown_data_source", message: "no such source" },
          { status: 422 },
        ),
      ),
    );
    await user.click(sources.getByRole("switch", { name: "Consult Eurostat" }));

    expect(await sources.findByRole("alert")).toHaveTextContent(
      "That source is not in the catalog.",
    );
    expect(
      screen.getByRole("listitem", { name: "Eurostat" }),
    ).toBeInTheDocument();
  });

  it("reports sources that could not be read", async () => {
    mockServer.use(
      http.get("/v1/data-sources", () =>
        HttpResponse.json(
          { code: "internal_error", message: "no sources" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");
    const sources = await panel();

    expect(
      await sources.findByText("The source priority could not be loaded"),
    ).toBeInTheDocument();
    expect(sources.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

/**
 * Dragging a source to a new place in the order.
 *
 * **A drag is a splice and the arrows are a swap**, so these do not share arithmetic with the
 * arrow tests -- and the request a drop sends is what they mostly check: one reorder carrying
 * the whole new order, the same operation the arrows send (D36).
 *
 * jsdom implements no `DataTransfer` at all, so each gesture passes a stub in the event init
 * and the handler is written to survive its absence.
 */
function dragOnto(dragged: HTMLElement, target: HTMLElement) {
  const dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData: () => undefined,
  };
  fireEvent.dragStart(dragged, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(dragged, { dataTransfer });
}

/**
 * Every order the panel sends, so a test can count them as well as read them. Each is handed
 * on to the stateful mock, so the order read back afterwards is the one it left.
 */
function recordOrders(): unknown[] {
  const sent: unknown[] = [];
  mockServer.use(
    http.put("/v1/data-sources/order", async ({ request }) => {
      sent.push(await request.clone().json());
    }),
  );
  return sent;
}

/** The one request the ▲ on Manual entry sends, against the shipped fixture: the whole order. */
const THE_ARROWS_ORDER = { order: ["manual", "eurostat", "llm"] };

/**
 * Order a request *after* the gesture under test, and wait for it to land.
 *
 * **This is what makes "it sent nothing" an assertion rather than a coincidence.** A request
 * the gesture did send is a promise away when the gesture returns, so reading the log straight
 * afterwards passes whatever the handler did -- which is exactly what happened: breaking the
 * guard that refuses a drag mid-save failed no test until this was added. A request issued
 * later cannot overtake one issued earlier, so its arrival proves the log is complete.
 */
async function thenOrderALaterRequest(
  sources: Awaited<ReturnType<typeof panel>>,
  seen: unknown[],
): Promise<void> {
  const user = userEvent.setup();
  await user.click(
    await sources.findByRole("button", { name: "Move Manual entry up" }),
  );
  await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1));
}

async function row(name: string): Promise<HTMLElement> {
  return screen.findByRole("listitem", { name });
}

/** The order on screen, which is the order the active-value rule applies. */
function namesInOrder(
  sources: Awaited<ReturnType<typeof panel>>,
): (string | null)[] {
  return within(
    sources.getByRole("list", { name: "Every configured source, in priority order" }),
  )
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));
}

/** Every switch the panel sends, which a move must never use. */
function recordSwitches(): unknown[] {
  const sent: unknown[] = [];
  mockServer.use(
    http.patch("/v1/data-sources/:dataSourceId", async ({ request }) => {
      sent.push(await request.clone().json());
    }),
  );
  return sent;
}

/** What the mock now stores, read the way the panel reads it. */
async function storedPriorities(): Promise<Record<string, number>> {
  const { items } = await fetchDataSources();
  return Object.fromEntries(items.map((source) => [source.id, source.default_priority]));
}

describe("reordering sources by dragging", () => {
  it("offers a grip on every row, and makes the row itself the handle", async () => {
    renderShell("/configure");

    // A 12px grip is a target nobody hits, so the whole row carries the drag and the grip is
    // there to say that it does.
    const eurostat = await row("Eurostat");
    expect(within(eurostat).getByTitle("Drag to reorder")).toBeInTheDocument();
    expect(eurostat).toHaveAttribute("draggable", "true");
  });

  /**
   * **The line points at the gap the row will actually land in.** The design draws it on the
   * target's top edge always, while its own handler re-inserts the row *below* the target on a
   * downward drag -- so one of the two is wrong, and an indicator aimed at a gap the drop will
   * not use is the worse half to keep.
   *
   * Read as an attribute because the states are attributes: a class modifier says the same
   * thing and no unit test can tell whether it was ever applied.
   */
  it("marks the edge the held row would land against, and only that row", async () => {
    renderShell("/configure");
    await row("Eurostat");
    const dataTransfer = { effectAllowed: "", setData: () => undefined };

    fireEvent.dragStart(await row("Eurostat"), { dataTransfer });
    fireEvent.dragOver(await row("LLM with web search"), { dataTransfer });

    expect(await row("Eurostat")).toHaveAttribute("data-dragging", "true");
    expect(await row("LLM with web search")).toHaveAttribute(
      "data-landing",
      "below",
    );
    // Only the row under the pointer, and never the held row itself: there is no gap it
    // would move to on its own row.
    expect(await row("Manual entry")).not.toHaveAttribute("data-landing");
    expect(await row("Eurostat")).not.toHaveAttribute("data-landing");

    // Dragged upwards it is the other edge, and the mark follows the pointer rather than
    // accumulating behind it.
    fireEvent.dragOver(await row("Manual entry"), { dataTransfer });
    expect(await row("Manual entry")).toHaveAttribute("data-landing", "below");
    expect(await row("LLM with web search")).not.toHaveAttribute("data-landing");

    fireEvent.dragEnd(await row("Eurostat"), { dataTransfer });
    expect(await row("Eurostat")).not.toHaveAttribute("data-dragging");
  });

  it("marks the target's top edge when the drag went up", async () => {
    renderShell("/configure");
    await row("Eurostat");
    const dataTransfer = { effectAllowed: "", setData: () => undefined };

    fireEvent.dragStart(await row("LLM with web search"), { dataTransfer });
    fireEvent.dragOver(await row("Eurostat"), { dataTransfer });

    expect(await row("Eurostat")).toHaveAttribute("data-landing", "above");
  });

  /** A gesture that never began marks nothing, so the list does not twitch mid-save. */
  it("marks nothing while a change is being saved", async () => {
    const user = userEvent.setup();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockServer.use(
      http.patch("/v1/data-sources/:dataSourceId", async () => {
        await held;
        return HttpResponse.json({});
      }),
    );
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("switch", { name: "Consult Eurostat" }),
    );
    await waitFor(async () =>
      expect(await row("Manual entry")).toHaveAttribute("draggable", "false"),
    );

    const dataTransfer = { effectAllowed: "", setData: () => undefined };
    fireEvent.dragStart(await row("Manual entry"), { dataTransfer });
    fireEvent.dragOver(await row("LLM with web search"), { dataTransfer });

    expect(await row("Manual entry")).not.toHaveAttribute("data-dragging");
    expect(await row("LLM with web search")).not.toHaveAttribute(
      "data-landing",
    );
    release();
  });

  it("drops a source below the row it was dragged onto", async () => {
    renderShell("/configure");
    const sources = await panel();
    await row("Eurostat");

    dragOnto(await row("Eurostat"), await row("LLM with web search"));

    await waitFor(() =>
      expect(namesInOrder(sources)).toEqual([
        "Manual entry",
        "LLM with web search",
        "Eurostat",
      ]),
    );
  });

  it("drops a source above the row it was dragged up onto", async () => {
    renderShell("/configure");
    const sources = await panel();
    await row("Eurostat");

    dragOnto(await row("LLM with web search"), await row("Eurostat"));

    await waitFor(() =>
      expect(namesInOrder(sources)).toEqual([
        "LLM with web search",
        "Eurostat",
        "Manual entry",
      ]),
    );
  });

  /**
   * PL-136. **One request carrying the whole order**, never a `PATCH` per row: a run of them
   * renumbered every source 1 to n, erasing the tiers, and could stop half way.
   */
  it("sends one reorder carrying the whole new order, and the tiers survive it", async () => {
    const sent = recordOrders();
    const patched = recordSwitches();
    renderShell("/configure");
    const sources = await panel();
    await row("Eurostat");

    dragOnto(await row("Eurostat"), await row("LLM with web search"));

    await waitFor(() =>
      expect(namesInOrder(sources)).toEqual(["Manual entry", "LLM with web search", "Eurostat"]),
    );
    expect(sent).toEqual([{ order: ["manual", "llm", "eurostat"] }]);
    expect(patched).toEqual([]);
    expect(await storedPriorities()).toEqual({ manual: 10, llm: 50, eurostat: 90 });
  });

  /**
   * **A drop where the row already was sends nothing.** A request writing the number already
   * stored would still flash the row as saving and re-read the whole list, to show the order
   * that was already on screen.
   */
  it("sends nothing when a row is dropped on itself", async () => {
    const sent = recordOrders();
    renderShell("/configure");
    const sources = await panel();
    await row("Manual entry");

    dragOnto(await row("Manual entry"), await row("Manual entry"));

    await thenOrderALaterRequest(sources, sent);
    expect(sent).toEqual([THE_ARROWS_ORDER]);
  });

  /**
   * A release over anything that is not a row -- the heading, the page, another window --
   * delivers no `drop`, only `dragend`.
   */
  it("sends nothing when the drag is released outside the list", async () => {
    const sent = recordOrders();
    renderShell("/configure");
    const sources = await panel();
    const dragged = await row("Eurostat");

    const dataTransfer = { effectAllowed: "", setData: () => undefined };
    fireEvent.dragStart(dragged, { dataTransfer });
    fireEvent.dragEnd(dragged, { dataTransfer });

    await thenOrderALaterRequest(sources, sent);
    expect(sent).toEqual([THE_ARROWS_ORDER]);
  });

  /** A payload dragged in from outside the page fires a drop that no gesture here began. */
  it("sends nothing for a drop that no drag started", async () => {
    const sent = recordOrders();
    renderShell("/configure");
    const sources = await panel();
    const target = await row("Manual entry");

    fireEvent.drop(target, { dataTransfer: { setData: () => undefined } });

    await thenOrderALaterRequest(sources, sent);
    expect(sent).toEqual([THE_ARROWS_ORDER]);
  });

  /**
   * **A switched-off source is draggable too.** It keeps its place in the order rather than
   * sinking to the bottom, because the order is the one it would take if it were switched back
   * on -- so the row showing no number is exactly the one whose number is being set for later.
   */
  it("moves a switched-off source, and it is still not consulted where it lands", async () => {
    renderShell("/configure");
    const sources = await panel();

    dragOnto(await row("LLM with web search"), await row("Eurostat"));

    await waitFor(() =>
      expect(namesInOrder(sources)[0]).toBe("LLM with web search"),
    );
    const llm = await row("LLM with web search");
    expect(llm).toHaveTextContent("not consulted");
    // The numbering closes up over it rather than counting it, wherever it stands.
    expect(await row("Eurostat")).toHaveTextContent("1");
  });

  /**
   * **A drag refuses to start while a change is in flight**, because it would compute its
   * order from the list before that change, and send an order that undoes it.
   */
  it("starts no drag while a change is still being saved", async () => {
    const user = userEvent.setup();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    mockServer.use(
      http.patch("/v1/data-sources/:dataSourceId", async ({ request }) => {
        sent.push(await request.json());
        await held;
        return HttpResponse.json({});
      }),
      http.put("/v1/data-sources/order", async ({ request }) => {
        sent.push(await request.clone().json());
      }),
    );
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("switch", { name: "Consult Eurostat" }),
    );
    await waitFor(() => expect(sent).toEqual([{ is_enabled: false }]));

    // The rows say so as well as refusing: nothing is draggable while a save is in flight.
    expect(await row("Manual entry")).toHaveAttribute("draggable", "false");
    dragOnto(await row("Manual entry"), await row("LLM with web search"));

    // **Releasing the held save is what makes this checkable.** Reading the log straight
    // after the drop passed with the guard removed, because the requests a started drag
    // would send had not been issued yet.
    release();
    // Draggable again is the save having finished -- and a round trip long enough for any
    // request the drop did issue to have reached the log.
    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "Eurostat" }),
      ).toHaveAttribute("draggable", "true"),
    );
    expect(sent).toEqual([{ is_enabled: false }]);
  });

  /** The arrows are not a fallback that may be dropped: they are the only keyboard route. */
  it("keeps the arrows working, which is the only route without a pointer", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sources = await panel();

    dragOnto(await row("Eurostat"), await row("Manual entry"));
    await waitFor(() => expect(namesInOrder(sources)[0]).toBe("Manual entry"));

    await user.click(
      await sources.findByRole("button", { name: "Move Eurostat up" }),
    );

    await waitFor(() => expect(namesInOrder(sources)[0]).toBe("Eurostat"));
  });

  /**
   * The column used to print two raw enum values chained with a comma -- "structured,
   * official_international" -- which broke two rules at once: a row says one fact, and an
   * identifier the code uses is never text a person reads.
   */
  it("says how a source answers, in words, and never chains two facts", async () => {
    renderShell("/configure");

    expect(await row("Eurostat")).toHaveTextContent("published dataset");
    expect(await row("Manual entry")).toHaveTextContent("typed by hand");

    const eurostat = await row("Eurostat");
    expect(eurostat.textContent).not.toContain("official");
    expect(eurostat.textContent).not.toContain("structured");
    expect(eurostat.textContent).not.toContain(",");
  });

  it("says a figure from a model came from one, which is why the column exists", async () => {
    const user = userEvent.setup();
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("switch", {
        name: "Consult LLM with web search",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("listitem", { name: "LLM with web search" }),
      ).toHaveTextContent("model with web search"),
    );
  });
});

/**
 * UI-07. A second gesture started while a change is written would compute its order from the
 * list before it; and what is shown after a failure is the order the server last answered.
 */
describe("the source priority panel while a change is being written", () => {
  /** How many times the list has been read, so a test can say it was read again. */
  function countReads(): { count: number } {
    const reads = { count: 0 };
    mockServer.events.on("request:start", ({ request }) => {
      if (
        request.method === "GET" &&
        new URL(request.url).pathname === "/v1/data-sources"
      ) {
        reads.count += 1;
      }
    });
    return reads;
  }

  it("keeps every other row still while a move is being written", async () => {
    const user = userEvent.setup();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    const record = async ({ request }: { request: Request }) => {
      sent.push(await request.clone().json());
      await held;
    };
    mockServer.use(
      http.patch("/v1/data-sources/:dataSourceId", record),
      http.put("/v1/data-sources/order", record),
    );
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("button", { name: "Move Manual entry up" }),
    );
    await waitFor(() => expect(sent).toHaveLength(1));

    for (const name of ["Eurostat", "Manual entry", "LLM with web search"]) {
      expectHeld(sources.getByRole("switch", { name: `Consult ${name}` }));
    }
    expectHeld(sources.getByRole("button", { name: "Move Eurostat down" }));
    expectHeld(
      sources.getByRole("button", { name: "Move LLM with web search up" }),
    );
    // Held, they still take a click -- and send nothing.
    await user.click(sources.getByRole("switch", { name: "Consult Eurostat" }));
    await user.click(
      sources.getByRole("button", { name: "Move LLM with web search up" }),
    );

    release();

    await waitFor(() =>
      expectNotHeld(sources.getByRole("switch", { name: "Consult Eurostat" })),
    );
    expectNotHeld(
      sources.getByRole("button", { name: "Move LLM with web search up" }),
    );
    // The move's one write, and nothing from the clicks made while it was in flight.
    expect(sent).toEqual([THE_ARROWS_ORDER]);
  });

  /**
   * P1-14. **A failed move changes nothing**, because the reorder is one transaction, so the
   * order stays as the server last answered it; and the failure offers Dismiss alone, since a
   * move sent again is a new decision. An answering 500, so the shell does not read it as down.
   */
  it("leaves the order as the server last answered it after a failed move, with Dismiss only", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.put("/v1/data-sources/order", () =>
        HttpResponse.json(
          { code: "internal_error", message: "the reorder failed" },
          { status: 500 },
        ),
      ),
    );
    renderShell("/configure");
    const sources = await panel();
    await row("Eurostat");

    dragOnto(await row("Eurostat"), await row("LLM with web search"));

    const alert = await sources.findByRole("alert");
    expect(alert).toHaveTextContent("The server failed while answering.");
    expect(within(alert).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Dismiss",
    ]);
    await waitFor(() => expectNotHeld(sources.getByRole("switch", { name: "Consult Eurostat" })));
    expect(namesInOrder(sources)).toEqual(["Eurostat", "Manual entry", "LLM with web search"]);
    expect(await storedPriorities()).toEqual({ eurostat: 10, manual: 50, llm: 90 });

    await user.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(sources.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * The order sent is the list on screen, so the server refuses it when the catalog changed
   * underneath: here the list was read without Manual entry. The refusal names the source it
   * left out, never its id, and the list is read again to show what is stored.
   */
  it("names the sources an order refusal names, and shows the stored order", async () => {
    const user = userEvent.setup();
    mockServer.use(
      http.get(
        "/v1/data-sources",
        () =>
          HttpResponse.json({
            items: DATA_SOURCES.filter((source) => source.id !== "manual"),
          }),
        { once: true },
      ),
    );
    renderShell("/configure");
    const sources = await panel();

    await user.click(
      await sources.findByRole("button", { name: "Move LLM with web search up" }),
    );

    const alert = await sources.findByRole("alert");
    expect(alert).toHaveTextContent("The source order must name every source once, and no other.");
    expect(alert).toHaveTextContent("Manual entry was left out of it");
    expect(alert).not.toHaveTextContent("manual,");
    expect(within(alert).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Dismiss",
    ]);
    await waitFor(() =>
      expect(namesInOrder(sources)).toEqual(["Eurostat", "Manual entry", "LLM with web search"]),
    );
  });

  it("re-reads the order after a change refused outright, too", async () => {
    const user = userEvent.setup();
    const reads = countReads();
    mockServer.use(
      http.patch("/v1/data-sources/:dataSourceId", () =>
        HttpResponse.json(
          { code: "unknown_data_source", message: "no such source" },
          { status: 422 },
        ),
      ),
    );
    renderShell("/configure");
    const sources = await panel();
    await sources.findByRole("switch", { name: "Consult Eurostat" });
    expect(reads.count).toBe(1);

    await user.click(sources.getByRole("switch", { name: "Consult Eurostat" }));

    expect(await sources.findByRole("alert")).toHaveTextContent(
      "That source is not in the catalog.",
    );
    await waitFor(() => expect(reads.count).toBe(2));
    expect(
      await sources.findByRole("switch", { name: "Consult Eurostat" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  /**
   * NEW-34. **Held, never disabled -- and never taken off the page.** Chromium throws focus off
   * a control the moment it is disabled and does not give it back, and the list was also swapped
   * for "Loading…" while it was read again after every change: either way a keyboard user who
   * switched or moved a source was put back on the page. jsdom keeps focus on a disabled control,
   * which is why these follow Chromium's rule rather than jsdom's.
   */
  describe("from the keyboard", () => {
    beforeEach(() => followChromiumFocusFixup());

    /**
     * Every source write, recorded and held until the test lets go, then handed on to the
     * stateful mock, so the order read back afterwards is the one the writes left.
     */
    function holdSourceWrites(): {
      sent: { id: string; body: unknown }[];
      release: () => void;
    } {
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const sent: { id: string; body: unknown }[] = [];
      mockServer.use(
        http.patch(
          "/v1/data-sources/:dataSourceId",
          async ({ params, request }) => {
            sent.push({
              id: String(params["dataSourceId"]),
              body: await request.clone().json(),
            });
            await held;
          },
        ),
        http.put("/v1/data-sources/order", async ({ request }) => {
          sent.push({ id: "order", body: await request.clone().json() });
          await held;
        }),
      );
      return { sent, release: () => release() };
    }

    it("keeps focus on a switch while it is written, and a second press sends nothing", async () => {
      const user = userEvent.setup();
      const writes = holdSourceWrites();
      renderShell("/configure");
      const sources = await panel();
      const eurostat = await sources.findByRole("switch", {
        name: "Consult Eurostat",
      });
      act(() => eurostat.focus());

      await user.keyboard(" ");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(eurostat).toHaveFocus();
      expectHeld(eurostat);
      await user.keyboard(" ");

      writes.release();

      await waitFor(() =>
        expect(eurostat).toHaveAttribute("aria-checked", "false"),
      );
      await waitFor(() => expectNotHeld(eurostat));
      expect(eurostat).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() =>
        expect(eurostat).toHaveAttribute("aria-checked", "true"),
      );
      expect(writes.sent).toEqual([
        { id: "eurostat", body: { is_enabled: false } },
        { id: "eurostat", body: { is_enabled: true } },
      ]);
    });

    it("keeps focus on Move up while the move is written, and a second press sends nothing", async () => {
      const user = userEvent.setup();
      const writes = holdSourceWrites();
      renderShell("/configure");
      const sources = await panel();
      const up = await sources.findByRole("button", {
        name: "Move LLM with web search up",
      });
      act(() => up.focus());

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      expect(up).toHaveFocus();
      expectHeld(up);
      await user.keyboard("{Enter}");

      writes.release();

      await waitFor(() =>
        expect(namesInOrder(sources)).toEqual([
          "Eurostat",
          "LLM with web search",
          "Manual entry",
        ]),
      );
      await waitFor(() => expectNotHeld(up));
      expect(up).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(namesInOrder(sources)[0]).toBe("LLM with web search"),
      );
      expect(writes.sent).toEqual([
        { id: "order", body: { order: ["eurostat", "llm", "manual"] } },
        { id: "order", body: { order: ["llm", "eurostat", "manual"] } },
      ]);
      // First now, so there is nowhere further up to go: disabled outright, not held. Waited
      // for, because the order is drawn from the read-back a render before the hold lets go.
      await waitFor(() => expectNotHeld(up));
      expect(up).toBeDisabled();
    });

    /**
     * NEW-45. **A row moved down takes its focus with it.** React keeps the rows keyed and moves
     * the one that went down in the document, and a browser drops focus from an element it
     * moves -- so Move down, unlike Move up, put a keyboard user back on the page. Focus goes
     * back to the control they pressed, which is the same element, now one row lower.
     */
    it("keeps focus on Move down once the move is read back", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      const sources = await panel();
      const down = await sources.findByRole("button", {
        name: "Move Eurostat down",
      });
      act(() => down.focus());

      await user.keyboard("{Enter}");

      await waitFor(() =>
        expect(namesInOrder(sources)).toEqual([
          "Manual entry",
          "Eurostat",
          "LLM with web search",
        ]),
      );
      await waitFor(() => expect(down).toHaveFocus());
    });

    it("moves focus to Move up when a move down leaves nothing below", async () => {
      const user = userEvent.setup();
      renderShell("/configure");
      const sources = await panel();
      const down = await sources.findByRole("button", {
        name: "Move Manual entry down",
      });
      act(() => down.focus());

      await user.keyboard("{Enter}");

      await waitFor(() =>
        expect(namesInOrder(sources)).toEqual([
          "Eurostat",
          "LLM with web search",
          "Manual entry",
        ]),
      );
      // Last now, so its own arrow is disabled outright and cannot hold focus.
      await waitFor(() => expect(down).toBeDisabled());
      await waitFor(() =>
        expect(
          sources.getByRole("button", { name: "Move Manual entry up" }),
        ).toHaveFocus(),
      );
    });

    it("keeps the list on screen and every control held until the order has been read again", async () => {
      const user = userEvent.setup();
      const writes = holdSourceWrites();
      writes.release();
      let releaseRead = (): void => undefined;
      const readHeld = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      renderShell("/configure");
      const sources = await panel();
      const up = await sources.findByRole("button", {
        name: "Move LLM with web search up",
      });
      mockServer.use(
        http.get("/v1/data-sources", async () => {
          await readHeld;
        }),
      );
      act(() => up.focus());

      await user.keyboard("{Enter}");
      await waitFor(() => expect(writes.sent).toHaveLength(1));

      // The write is in and the order is being read again. The list shown is the one from
      // before them, so nothing may be computed from it -- but it is still there, and so is
      // the control the keyboard is on.
      expect(namesInOrder(sources)).toEqual([
        "Eurostat",
        "Manual entry",
        "LLM with web search",
      ]);
      expect(up).toHaveFocus();
      expectHeld(up);
      expectHeld(sources.getByRole("switch", { name: "Consult Eurostat" }));
      await user.keyboard("{Enter}");

      releaseRead();

      await waitFor(() =>
        expect(namesInOrder(sources)).toEqual([
          "Eurostat",
          "LLM with web search",
          "Manual entry",
        ]),
      );
      await waitFor(() => expectNotHeld(up));
      expect(up).toHaveFocus();
      expect(writes.sent).toHaveLength(1);
    });

    it("lets go of the switch after a refused change, with focus still on it", async () => {
      const user = userEvent.setup();
      const reads = countReads();
      mockServer.use(
        http.patch("/v1/data-sources/:dataSourceId", () =>
          HttpResponse.json(
            { code: "unknown_data_source", message: "no such source" },
            { status: 422 },
          ),
        ),
      );
      renderShell("/configure");
      const sources = await panel();
      const eurostat = await sources.findByRole("switch", {
        name: "Consult Eurostat",
      });
      act(() => eurostat.focus());

      await user.keyboard(" ");

      expect(await sources.findByRole("alert")).toHaveTextContent(
        "That source is not in the catalog.",
      );
      await waitFor(() => expect(reads.count).toBe(2));
      await waitFor(() => expectNotHeld(eurostat));
      expect(eurostat).toHaveFocus();
      expect(eurostat).toHaveAttribute("aria-checked", "true");
    });
  });
});

/** PL-134. What each source answers, and what switching it off costs. */
describe("what each source row says it answers", () => {
  async function row(name: string) {
    const sources = await panel();
    return within(await sources.findByRole("listitem", { name }));
  }

  it("counts the attributes a consulted source can answer, from the catalog", async () => {
    renderShell("/configure");
    const eurostat = await row("Eurostat");
    expect(await eurostat.findByText(/1 attribute/)).toBeInTheDocument();
    expect(eurostat.getByText(/published dataset/)).toBeInTheDocument();
    // Hand entry answers what the catalog lets a person type.
    expect(await (await row("Manual entry")).findByText(/3 attributes/)).toBeInTheDocument();
  });

  it("says a consulted source that answers nothing yet does", async () => {
    mockServer.use(
      http.get("/v1/data-sources", () =>
        HttpResponse.json({
          items: [
            {
              id: "numbeo",
              name: "Numbeo",
              source_kind: "structured",
              default_priority: 60,
              reliability_tier: "crowdsourced",
              is_enabled: true,
            },
          ],
        }),
      ),
    );
    renderShell("/configure");
    expect(await (await row("Numbeo")).findByText(/answers nothing yet/)).toBeInTheDocument();
  });

  it("claims no count while the catalog cannot be read", async () => {
    mockServer.use(
      http.get("/v1/attributes", () =>
        HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 }),
      ),
    );
    renderShell("/configure");
    const eurostat = await row("Eurostat");
    await eurostat.findByText(/published dataset/);
    expect(eurostat.queryByText(/attribute|answers nothing/)).not.toBeInTheDocument();
  });

  it("names the required attribute only it can fetch, and what switching it off does", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/:id", ({ params }) =>
        HttpResponse.json({
          id: String(params["id"]),
          name: "Default",
          pillar_weights: [
            { pillar: "economics", level: "country", weight: 100, weight_locked: false },
          ],
          criteria: [
            {
              attribute: "country.cost_of_living_index",
              pillar: "economics",
              weight: 100,
              goal: "minimise",
              normalisation_method: "percentile",
              blocks_if_missing: true,
            },
          ],
        }),
      ),
    );
    renderShell("/configure");
    expect(
      await (await row("Eurostat")).findByText(
        /Only source of Cost of living index, which is required: switched off, a candidate without that figure gets no score/,
      ),
    ).toBeInTheDocument();
  });
});

/**
 * From review. **What switching a source off costs depends on the set, and an unread set is not
 * a set that requires nothing.** The rows dropped their warning while the set was pending,
 * failed or switching, so switching off seemed to cost nothing.
 */
describe("what switching off costs, while the criteria set is not read", () => {
  const UNKNOWN =
    /Only source of Cost of living index; what switching it off costs cannot be known until the criteria set is read/;

  it("says the cost cannot be known yet while the set is being read", async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => release());
    mockServer.use(
      http.get("/v1/criteria-sets/:id", async () => {
        await held;
        return HttpResponse.json({ code: "internal_error", message: "late" }, { status: 500 });
      }),
    );
    renderShell("/configure");

    expect(await within(await row("Eurostat")).findByText(UNKNOWN)).toBeInTheDocument();
  });

  it("says the cost cannot be known when the set could not be read", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 }),
      ),
    );
    renderShell("/configure");

    expect(await within(await row("Eurostat")).findByText(UNKNOWN)).toBeInTheDocument();
  });

  it("says nothing about a source that is the only one for no attribute", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets/:id", () =>
        HttpResponse.json({ code: "internal_error", message: "x" }, { status: 500 }),
      ),
    );
    renderShell("/configure");
    await within(await row("Eurostat")).findByText(UNKNOWN);

    expect(within(await row("Manual entry")).queryByText(/Only source of/)).toBeNull();
  });
});

/** PL-135. Attributes with their own order are listed, read-only, with their maximum age. */
describe("attributes that name their own source order", () => {
  it("lists them, with the sources they put first and their maximum age", async () => {
    renderShell("/configure");
    const sources = await panel();
    const list = await sources.findByRole("list", {
      name: "Attributes that name their own source order",
    });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(
      "International employers: LLM with web search first, then the order above; refetched after 24 months",
    );
  });

  it("says what the order decides, and that some attributes name their own", async () => {
    renderShell("/configure");
    const sources = await panel();
    expect(
      sources.getByText(/unless the attribute names its own order/i),
    ).toBeInTheDocument();
    expect(sources.queryByText(/Which source wins when two answer/)).not.toBeInTheDocument();
  });
});
