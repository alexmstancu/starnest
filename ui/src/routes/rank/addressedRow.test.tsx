import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../../mocks/server";
import { TEST_CONFIG, renderShell } from "../../testing/renderShell";

/**
 * PL-084 (UF-087). **Rank opens a candidate, and a pillar, from the address**: the link a
 * hand-typed figure's read-back offers, a reload, a shared link. The request is applied once the
 * ranking holds the candidate and only then taken out of the address; what it cannot open is
 * said, never left blank.
 */

let address = "";

function renderAt(path: string) {
  return renderShell(path, TEST_CONFIG, (now) => {
    address = now;
  });
}

async function toggleOf(name: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table", { name: /ranked candidates/i });
  return within(table).findByRole("button", { name });
}

function openToggles(): HTMLElement[] {
  const table = screen.getByRole("table", { name: /ranked candidates/i });
  return within(table)
    .queryAllByRole("button", { expanded: true })
    .filter((button) => button.classList.contains("name-cell__toggle"));
}

describe("an address that names a candidate and a pillar", () => {
  it("opens the candidate at the pillar, takes the request out, and gives it the keyboard", async () => {
    renderAt("/rank?candidate=country.portugal&pillar=safety&level=country");

    const portugal = await toggleOf("Portugal");
    await waitFor(() => expect(portugal).toHaveAttribute("aria-expanded", "true"));
    expect(
      await screen.findAllByRole("button", { name: /^Safety/, pressed: true }),
    ).not.toHaveLength(0);
    await waitFor(() => expect(portugal).toHaveFocus());
    await waitFor(() => expect(address).toBe("/rank"));
  });

  it("keeps the request when the selection arrives after the first render", async () => {
    mockServer.use(
      http.get("/v1/criteria-sets", async () => {
        await delay(150);
        return undefined;
      }),
    );
    renderAt("/rank?candidate=country.spain");

    const spain = await toggleOf("Spain");
    await waitFor(() => expect(spain).toHaveAttribute("aria-expanded", "true"));
    await waitFor(() => expect(address).toBe("/rank"));
  });

  it("keeps the request while the ranking fails, and opens it once Try again reads it", async () => {
    let fail = true;
    mockServer.use(
      http.get("/v1/rankings", () =>
        fail ? HttpResponse.json({ code: "internal", message: "x" }, { status: 500 }) : undefined,
      ),
    );
    renderAt("/rank?candidate=country.spain&saved=");

    const failure = await screen.findByRole("alert");
    expect(address).toContain("candidate=country.spain");
    fail = false;
    await userEvent.click(within(failure).getByRole("button", { name: /try again/i }));

    await waitFor(async () =>
      expect(await toggleOf("Spain")).toHaveAttribute("aria-expanded", "true"),
    );
    await waitFor(() => expect(address).toBe("/rank?saved="));
  });

  it("says a candidate the ranking does not hold is not in it, and opens nothing", async () => {
    renderAt("/rank?candidate=country.romania&pillar=safety");

    expect(
      await screen.findByText("Romania is not in this ranking, so there is no evidence of it to open."),
    ).toBeInTheDocument();
    expect(openToggles()).toHaveLength(0);
    await waitFor(() => expect(address).toBe("/rank"));
  });

  it("says an unknown candidate opened nothing, without naming it from its id", async () => {
    renderAt("/rank?candidate=country.atlantis");

    expect(
      await screen.findByText(
        "The address names a candidate this ranking does not hold, so nothing was opened.",
      ),
    ).toBeInTheDocument();
    expect(openToggles()).toHaveLength(0);
    expect(screen.queryByText(/atlantis/i)).toBeNull();
  });

  it("opens the candidate at every pillar where the address names one it is not scored on", async () => {
    renderAt("/rank?candidate=country.portugal&pillar=astrology");

    const portugal = await toggleOf("Portugal");
    await waitFor(() => expect(portugal).toHaveAttribute("aria-expanded", "true"));
    expect(
      await screen.findByText(
        "The address names a pillar Portugal is not scored on here, so every pillar of Portugal is shown.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", { name: /^(Economy|Safety|Family)/, pressed: true }),
    ).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^Safety/ })).not.toHaveLength(0);
  });

  it("says an unknown level opened nothing", async () => {
    renderAt("/rank?candidate=country.portugal&level=galaxy");

    expect(
      await screen.findByText("The address names a level that does not exist, so nothing was opened."),
    ).toBeInTheDocument();
    expect(openToggles()).toHaveLength(0);
  });
});
