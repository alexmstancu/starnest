import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import { TEST_CONFIG, renderShell } from "../testing/renderShell";

/**
 * PL-002: four ways a request can fail, told apart on every screen.
 *
 * **A server that did not answer is one card per screen** (P1-06), with Try again, and never
 * "a shape this interface does not recognise" -- that is for a malformed answer from a server
 * that did answer. A refusal says the server's code in its own words, and a server that failed
 * while answering says so, offering Try again.
 */

const SCREENS = [
  ["/configure", "The configuration"],
  ["/acquire", "The acquisition history"],
  ["/rank", "The ranking"],
  ["/compare", "The comparison"],
] as const;

const SERVER_DOWN = `the ${TEST_CONFIG.displayName} server is probably not running`;
const MALFORMED = /does not recognise/i;

function everyRequestAnswers(answer: () => Response) {
  mockServer.use(http.all("/v1/*", answer));
}

describe.each(SCREENS)("on %s", (path, subject) => {
  it.each([
    ["no request completes", () => HttpResponse.error()],
    ["a proxy answers 502 for the backend", () => new HttpResponse("<html>Bad Gateway</html>", { status: 502 })],
  ])("says once that the server is down when %s", async (_case, answer) => {
    everyRequestAnswers(answer);
    renderShell(path);

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent(`${subject} could not be loaded`);
    });
    const card = screen.getByRole("alert");
    expect(card).toHaveTextContent(SERVER_DOWN);
    expect(within(card).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(MALFORMED);
  });

  it("says the answer could not be read when it is not JSON", async () => {
    everyRequestAnswers(() => new HttpResponse("{not json", { status: 200 }));
    renderShell(path);

    expect(
      (await screen.findAllByText(/answered with something that is not JSON/i)).length,
    ).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(SERVER_DOWN);
  });

  it("says the server's refusal in its own words", async () => {
    everyRequestAnswers(() =>
      HttpResponse.json(
        { code: "criteria_set_not_found", message: "No such criteria set." },
        { status: 409 },
      ),
    );
    renderShell(path);

    expect((await screen.findAllByText("No such criteria set.")).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(SERVER_DOWN);
    expect(document.body).not.toHaveTextContent(MALFORMED);
  });

  it("says the server failed while answering, and offers Try again", async () => {
    everyRequestAnswers(() => new HttpResponse("Internal Server Error", { status: 500 }));
    renderShell(path);

    const [first] = await screen.findAllByText("The server failed while answering.");
    const card = first!.closest<HTMLElement>("[role=alert]")!;
    expect(within(card).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SERVER_DOWN);
    expect(document.body).not.toHaveTextContent(MALFORMED);
  });
});

describe("when the server comes back", () => {
  it("reads again without a click, once the shell's poll is answered", async () => {
    everyRequestAnswers(() => HttpResponse.error());
    renderShell("/rank");
    await screen.findByText(/the ranking could not be loaded/i);

    mockServer.resetHandlers();

    expect(await screen.findByRole("table", {}, { timeout: 6_000 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads every failed read again from the screen's Try again", async () => {
    everyRequestAnswers(() => HttpResponse.error());
    renderShell("/rank");
    const card = await screen.findByRole("alert");

    mockServer.resetHandlers();
    await userEvent.setup().click(within(card).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
