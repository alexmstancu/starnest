import { screen, waitFor, within } from "@testing-library/react";
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

  it("names each source's kind, so a figure from a model is recognisable as one", async () => {
    renderShell("/configure");

    // The kind and the tier stand in for the order only while the source is consulted; a
    // source nobody consults says that instead, because it is the more useful fact.
    const eurostat = await screen.findByRole("listitem", { name: "Eurostat" });
    expect(eurostat).toHaveTextContent("structured");
    expect(eurostat).toHaveTextContent("official");
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
