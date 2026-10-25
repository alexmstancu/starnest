import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "./ApiError";
import { fetchLevels } from "./endpoints";
import { mockServer } from "../mocks/server";
import {
  hasFailedReads,
  isUnreachable,
  noteAnswered,
  retryEveryFailed,
  subscribeToFailedReads,
  whenAnswered,
} from "./reachability";

/**
 * A read that failed because the server did not answer is read again once something is
 * answered (PL-002, D3): the server came back, and nobody should have to reload to see it.
 */

describe("a read waiting for the server", () => {
  it("is retried once when a request is answered, and then forgotten", () => {
    const retry = vi.fn();
    whenAnswered(retry);

    noteAnswered();
    noteAnswered();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(hasFailedReads()).toBe(false);
  });

  it("is not retried once it has taken itself back", () => {
    const retry = vi.fn();
    const takeBack = whenAnswered(retry);

    takeBack();
    noteAnswered();

    expect(retry).not.toHaveBeenCalled();
    expect(hasFailedReads()).toBe(false);
  });

  it("is retried by the screen's Try again, with every other read that failed that way", () => {
    const first = vi.fn();
    const second = vi.fn();
    whenAnswered(first);
    whenAnswered(second);
    expect(hasFailedReads()).toBe(true);

    retryEveryFailed();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(hasFailedReads()).toBe(false);
  });

  it("tells a listener when the set of failed reads changes, and stops when asked", () => {
    const listener = vi.fn();
    const stop = subscribeToFailedReads(listener);

    const takeBack = whenAnswered(() => {});
    takeBack();
    stop();
    whenAnswered(() => {});

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("the client", () => {
  it("notes an answer, even a refusal, and so retries what waits for the server", async () => {
    const retry = vi.fn();
    whenAnswered(retry);
    mockServer.use(
      http.get("/v1/levels", () =>
        HttpResponse.json({ code: "not_found", message: "No." }, { status: 404 }),
      ),
    );

    await fetchLevels().catch(() => undefined);

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a request that never completed", () => HttpResponse.error()],
    ["a proxy's 502 page", () => new HttpResponse("<html>Bad Gateway</html>", { status: 502 })],
  ])("does not take %s for an answer", async (_case, answer) => {
    const retry = vi.fn();
    whenAnswered(retry);
    mockServer.use(http.get("/v1/levels", answer));

    await fetchLevels().catch(() => undefined);

    expect(retry).not.toHaveBeenCalled();
  });
});

describe("isUnreachable", () => {
  it("is the client's own code for a server that did not answer, and nothing else", () => {
    expect(isUnreachable(new ApiError({ code: CLIENT_ERROR_CODES.unreachable, message: "" }))).toBe(true);
    expect(isUnreachable(new ApiError({ code: CLIENT_ERROR_CODES.serverFault, message: "" }))).toBe(false);
    expect(isUnreachable(new Error("client.unreachable"))).toBe(false);
  });
});
