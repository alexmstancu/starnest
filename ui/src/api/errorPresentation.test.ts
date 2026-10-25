import { describe, expect, it } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "./ApiError";
import { WORDS, presentError } from "./errorPresentation";

describe("presentError", () => {
  it("branches on the code, not on the message", () => {
    const misleadingProse = new ApiError({
      code: "weights_all_locked",
      message: "everything is fine, honestly",
      status: 409,
    });

    expect(presentError(misleadingProse).message).toMatch(/locked/);
    expect(presentError(misleadingProse).message).not.toMatch(/honestly/);
  });

  it("words a code it does not know as a refusal, never in the server's words (P1-07)", () => {
    const unknown = new ApiError({
      code: "a_code_from_a_newer_server",
      message: "SENTINEL_MESSAGE",
      status: 409,
    });

    const presented = presentError(unknown);
    expect(presented.message).toBe("The server refused this.");
    expect(presented.retryable).toBe(false);
  });

  it("treats a 5xx with an unknown code as worth retrying", () => {
    const serverFault = new ApiError({ code: "internal", message: "boom", status: 503 });

    expect(presentError(serverFault).retryable).toBe(true);
    expect(presentError(serverFault).message).toBe("The server failed while answering.");
  });

  it("offers a retry when the backend could not be reached", () => {
    const unreachable = new ApiError({
      code: CLIENT_ERROR_CODES.unreachable,
      message: "/v1/levels could not be reached.",
    });

    expect(presentError(unreachable).retryable).toBe(true);
  });

  it("offers a retry when the server failed while answering, without its words", () => {
    const fault = new ApiError({
      code: CLIENT_ERROR_CODES.serverFault,
      message: "The API answered HTTP 500 without a code and message.",
      status: 500,
    });

    expect(presentError(fault)).toEqual({
      code: CLIENT_ERROR_CODES.serverFault,
      kind: "fault",
      message: "The server failed while answering.",
      retryable: true,
    });
  });

  it("does not say the server is down when it answered in a shape nobody documented", () => {
    const malformed = new ApiError({
      code: CLIENT_ERROR_CODES.malformedError,
      message: "The API answered HTTP 404 without a code and message.",
      status: 404,
    });

    expect(presentError(malformed).retryable).toBe(false);
    expect(presentError(malformed).message).not.toMatch(/did not answer/);
  });

  it("does not offer a retry for a malformed response", () => {
    const malformed = new ApiError({
      code: CLIENT_ERROR_CODES.malformedBody,
      message: "not json",
      status: 200,
    });

    expect(presentError(malformed).retryable).toBe(false);
  });

  it("presents a plain Error without its text, which is for a developer", () => {
    expect(presentError(new Error("SENTINEL_MESSAGE"))).toEqual({
      code: "client.unexpected",
      kind: "fault",
      message: "Something went wrong in this interface.",
      retryable: false,
    });
  });

  it("presents a thrown non-Error the same way", () => {
    expect(presentError("SENTINEL_MESSAGE").message).toBe(
      "Something went wrong in this interface.",
    );
  });
});

/**
 * PL-003, P1-07: **every code has a sentence of the interface's own**, and no sentence carries
 * the code, the server's message or any other identifier -- whatever `details` holds.
 */
describe("the wording table", () => {
  const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
  const HOSTILE_DETAILS = {
    name: "Weekend",
    run: 7,
    minimum: 80,
    limit: 3,
    asked: 4,
    reason: "anchor_above_scale",
    anchor_score: 120,
    score_scale_max: 100,
    candidates: ["country.portugal"],
    pillars: ["economy"],
    locked: ["country.homicide_rate"],
    errors: [{ location: ["body", "net_income"], problem: "SENTINEL_MESSAGE", kind: "malformed_identifier" }],
  };

  it.each(Object.keys(WORDS))("words %s from its code and details alone", (code) => {
    for (const details of [undefined, {}, HOSTILE_DETAILS]) {
      const presented = presentError(
        new ApiError({ code, message: "SENTINEL_MESSAGE", status: 409, details }),
      );

      expect(presented.message.length).toBeGreaterThan(0);
      expect(presented.message).not.toContain("SENTINEL_MESSAGE");
      expect(presented.message).not.toContain(code);
      expect(presented.message).not.toMatch(SNAKE_CASE);
      expect(presented.message).not.toMatch(/\b(country|city)\./);
    }
  });

  it("fills in a name it is given, and never the id it was given", () => {
    const refused = new ApiError({
      code: "invalid_comparison",
      message: "SENTINEL_MESSAGE",
      status: 409,
      details: { candidates: ["country.portugal", "country.spain"] },
    });

    const names = { candidate: (id: string) => (id === "country.portugal" ? "Portugal" : undefined) };
    expect(presentError(refused, names).message).toMatch(/Portugal/);
    expect(presentError(refused, names).message).toMatch(/one other candidate/);
  });

  it("names what a refusal is about from its details", () => {
    const busy = new ApiError({
      code: "run_already_in_flight",
      message: "SENTINEL_MESSAGE",
      status: 409,
      details: { run: 7 },
    });
    const over = new ApiError({
      code: "comparator_limit_exceeded",
      message: "SENTINEL_MESSAGE",
      status: 409,
      details: { limit: 3, asked: 4 },
    });

    expect(presentError(busy).message).toMatch(/acquisition 7 is still going/i);
    expect(presentError(over).message).toMatch(/4 comparators.*limit is 3/i);
  });

  /** PL-120. Each reason an estimate has nothing to ask is worded from the reason alone. */
  it.each([
    ["empty_scope", {}, "Nothing is selected, so there is nothing to ask."],
    [
      "still_fresh",
      { refetch_older_than_days: 30 },
      "Every value in it was fetched within the last 30 days, so there is nothing to ask again. Lower “Refetch data older than” in Configure to ask anyway.",
    ],
    [
      "no_source_switched_on",
      {},
      "Every data source it may ask is switched off, so there is nothing to ask.",
    ],
    [
      "nothing_answerable",
      { candidates: 32 },
      "No switched-on source can answer anything in it, so there is nothing to ask.",
    ],
    [
      "sources_switched_off",
      {},
      "Every source that failed on these items is now switched off or no longer answers them, so a retry would ask nobody.",
    ],
    [undefined, {}, "Nothing in that scope can be fetched from a switched-on source."],
  ])("words nothing to fetch for the reason %s", (reason, more, sentence) => {
    const refused = new ApiError({
      code: "nothing_to_fetch",
      message: "SENTINEL_MESSAGE",
      status: 409,
      details: { ...(reason === undefined ? {} : { reason }), ...more },
    });

    expect(presentError(refused).message).toBe(sentence);
  });

  it("words a still-fresh refusal with no age without inventing one", () => {
    const refused = new ApiError({
      code: "nothing_to_fetch",
      message: "SENTINEL_MESSAGE",
      status: 409,
      details: { reason: "still_fresh" },
    });

    expect(presentError(refused).message).toMatch(/^Every value in it was fetched recently,/);
  });

  it("counts the selected items a retry cannot reach, and names none of them", () => {
    const outside = new ApiError({
      code: "selection_not_in_run",
      message: "SENTINEL_MESSAGE",
      status: 409,
      details: {
        items: "failures",
        pairs: [
          { candidate: "country.portugal", attribute: "country.homicide_rate" },
          { candidate: "country.spain", attribute: "country.homicide_rate" },
        ],
      },
    });

    expect(presentError(outside).message).toMatch(/2 selected items are not among/);
    expect(presentError(outside).message).not.toMatch(/portugal|homicide/i);
  });

  it("counts the answers a re-check named that nobody recorded, and names none of them by id", () => {
    const unrecorded = (pairs: number) =>
      new ApiError({
        code: "unknown_scope",
        message: "SENTINEL_MESSAGE",
        status: 422,
        details: {
          recheck: Array.from({ length: pairs }, () => ({
            match_rule: "country.visa_route_exists",
            candidate: "country.portugal",
          })),
        },
      });

    expect(presentError(unrecorded(1)).message).toBe(
      "A re-check asks again only about an answer a person recorded, and an answer it named has none.",
    );
    expect(presentError(unrecorded(2)).message).toMatch(/and 2 answers it named have none\.$/);
    expect(presentError(unrecorded(2)).message).not.toMatch(/country\.|SENTINEL/);
  });

  it("says an identifier in the request is malformed when the server says so", () => {
    const malformed = new ApiError({
      code: "invalid_request",
      message: "SENTINEL_MESSAGE",
      status: 422,
      details: { errors: [{ location: ["path", "id"], problem: "x", kind: "malformed_identifier" }] },
    });

    expect(presentError(malformed).message).toMatch(/not well formed/i);
  });
});

describe("a number the client would not send", () => {
  it("says so in words, and offers no retry, because the same request would fail again", () => {
    const refused = new ApiError({
      code: CLIENT_ERROR_CODES.unsendableNumber,
      message: "min_coverage is NaN.",
    });

    expect(presentError(refused)).toEqual({
      code: "client.unsendable_number",
      kind: "refusal",
      message: expect.stringMatching(/not a number/i) as unknown,
      retryable: false,
    });
  });
});
