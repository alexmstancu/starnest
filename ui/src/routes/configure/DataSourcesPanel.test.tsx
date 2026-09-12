import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { renderShell } from "../../testing/renderShell";

/**
 * The source priority order, shown and not editable.
 *
 * The order is the point: it decides which figure is the active one, so the test asserts the
 * sequence rather than only that the rows exist.
 */

async function panel() {
  return within(await screen.findByRole("region", { name: "Source priority" }));
}

describe("the source priority panel", () => {
  it("lists every source in priority order, lowest number first", async () => {
    renderShell("/configure");
    const sources = await panel();

    const names = (await sources.findAllByRole("rowheader")).map(
      (cell) => cell.textContent,
    );
    expect(names).toEqual(["Eurostat", "Manual entry", "LLM with web search"]);
  });

  it("names each source's kind, so a figure from a model is recognisable as one", async () => {
    renderShell("/configure");
    const sources = await panel();

    const row = (
      await sources.findByRole("rowheader", { name: "LLM with web search" })
    ).closest("tr");
    expect(row).toHaveTextContent("llm");
    expect(row).toHaveTextContent("90");
  });

  it("says the order is changed by a migration rather than here", async () => {
    renderShell("/configure");
    const sources = await panel();

    expect(
      sources.getByText(/Changed by a migration, not here/),
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
