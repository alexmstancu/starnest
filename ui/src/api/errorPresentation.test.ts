import { describe, expect, it } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "./ApiError";
import { presentError } from "./errorPresentation";

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

  it("falls back to the server's own words for a code it does not know", () => {
    const unknown = new ApiError({
      code: "criteria_set_not_found",
      message: "No criteria set called 'weekend'.",
      status: 404,
    });

    expect(presentError(unknown)).toEqual({
      code: "criteria_set_not_found",
      message: "No criteria set called 'weekend'.",
      retryable: false,
    });
  });

  it("treats a 5xx with an unknown code as worth retrying", () => {
    const serverFault = new ApiError({ code: "internal", message: "boom", status: 503 });

    expect(presentError(serverFault).retryable).toBe(true);
  });

  it("offers a retry when the backend could not be reached", () => {
    const unreachable = new ApiError({
      code: CLIENT_ERROR_CODES.unreachable,
      message: "/v1/levels could not be reached.",
    });

    expect(presentError(unreachable).retryable).toBe(true);
  });

  it("does not offer a retry for a malformed response", () => {
    const malformed = new ApiError({
      code: CLIENT_ERROR_CODES.malformedBody,
      message: "not json",
      status: 200,
    });

    expect(presentError(malformed).retryable).toBe(false);
  });

  it("presents a plain Error", () => {
    expect(presentError(new Error("something broke"))).toEqual({
      code: "client.unexpected",
      message: "something broke",
      retryable: false,
    });
  });

  it("presents a thrown non-Error", () => {
    expect(presentError("a string was thrown")).toEqual({
      code: "client.unexpected",
      message: "a string was thrown",
      retryable: false,
    });
  });
});
