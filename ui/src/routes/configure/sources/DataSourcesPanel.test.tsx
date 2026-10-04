import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../../mocks/server";
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
      "unknown_data_source",
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

    expect(await sources.findByText(/no sources/)).toBeInTheDocument();
  });
});

/**
 * Dragging a source to a new place in the order.
 *
 * **A drag is a splice and the arrows are a swap**, so these do not share arithmetic with the
 * arrow tests -- and the request a drop sends is what they mostly check, because that is the
 * part the contract constrains: there is no batch reorder and no new operation, only a run of
 * the same `PATCH` the arrows already send.
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

/** Every priority change the panel sends, so a test can count them as well as read them. */
function recordPriorityRequests(): { id: string; body: unknown }[] {
  const sent: { id: string; body: unknown }[] = [];
  mockServer.use(
    http.patch(
      "/v1/data-sources/:dataSourceId",
      async ({ params, request }) => {
        sent.push({
          id: String(params["dataSourceId"]),
          body: await request.json(),
        });
        return HttpResponse.json({});
      },
    ),
  );
  return sent;
}

/**
 * The two requests the ▲ on Manual entry sends, against the shipped fixture: a move is an
 * exchange of two numbers, so Manual entry takes Eurostat's 10 and Eurostat takes its 50.
 */
const THE_ARROWS_SWAP = [
  { id: "manual", body: { default_priority: 10 } },
  { id: "eurostat", body: { default_priority: 50 } },
];

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
  seen: { id: string; body: unknown }[],
): Promise<void> {
  const user = userEvent.setup();
  await user.click(
    await sources.findByRole("button", { name: "Move Manual entry up" }),
  );
  await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
}

async function row(name: string): Promise<HTMLElement> {
  return screen.findByRole("listitem", { name });
}

/** The order on screen, which is the order the active-value rule applies. */
function namesInOrder(
  sources: Awaited<ReturnType<typeof panel>>,
): (string | null)[] {
  return sources
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));
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
   * **One `PATCH` per row that moved, numbered from one.** A swap of two numbers would put the
   * dragged row where it was dropped and leave the rows it passed untouched, which is a
   * different order; and the numbering is dense rather than a rotation of 10, 50 and 90
   * because two sources sharing a number are then ordered by id rather than by the drop.
   */
  it("sends the same request the arrows send, once per row that moved", async () => {
    const sent = recordPriorityRequests();
    renderShell("/configure");
    await row("Eurostat");

    dragOnto(await row("Eurostat"), await row("LLM with web search"));

    await waitFor(() => expect(sent).toHaveLength(3));
    expect(sent).toEqual([
      { id: "manual", body: { default_priority: 1 } },
      { id: "llm", body: { default_priority: 2 } },
      { id: "eurostat", body: { default_priority: 3 } },
    ]);
  });

  /**
   * **A drop where the row already was sends nothing.** A request writing the number already
   * stored would still flash the row as saving and re-read the whole list, to show the order
   * that was already on screen.
   */
  it("sends nothing when a row is dropped on itself", async () => {
    const sent = recordPriorityRequests();
    renderShell("/configure");
    const sources = await panel();
    await row("Manual entry");

    dragOnto(await row("Manual entry"), await row("Manual entry"));

    await thenOrderALaterRequest(sources, sent);
    expect(sent).toEqual(THE_ARROWS_SWAP);
  });

  /**
   * A release over anything that is not a row -- the heading, the page, another window --
   * delivers no `drop`, only `dragend`.
   */
  it("sends nothing when the drag is released outside the list", async () => {
    const sent = recordPriorityRequests();
    renderShell("/configure");
    const sources = await panel();
    const dragged = await row("Eurostat");

    const dataTransfer = { effectAllowed: "", setData: () => undefined };
    fireEvent.dragStart(dragged, { dataTransfer });
    fireEvent.dragEnd(dragged, { dataTransfer });

    await thenOrderALaterRequest(sources, sent);
    expect(sent).toEqual(THE_ARROWS_SWAP);
  });

  /** A payload dragged in from outside the page fires a drop that no gesture here began. */
  it("sends nothing for a drop that no drag started", async () => {
    const sent = recordPriorityRequests();
    renderShell("/configure");
    const sources = await panel();
    const target = await row("Manual entry");

    fireEvent.drop(target, { dataTransfer: { setData: () => undefined } });

    await thenOrderALaterRequest(sources, sent);
    expect(sent).toEqual(THE_ARROWS_SWAP);
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
   * **A drag refuses to start while a change is in flight.** A reorder writes several rows one
   * at a time, so a gesture arriving mid-write would compute its order from a list that is
   * partly the old one, and send a mixture of the two numberings.
   */
  it("starts no drag while a change is still being saved", async () => {
    const user = userEvent.setup();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    mockServer.use(
      http.patch(
        "/v1/data-sources/:dataSourceId",
        async ({ params, request }) => {
          sent.push(await request.json());
          if (String(params["dataSourceId"]) === "eurostat") await held;
          return HttpResponse.json({});
        },
      ),
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
