import { describe, expect, it, vi } from "vitest";
import { AppConfigError, loadAppConfig } from "./appConfig";

function respondWith(body: unknown, init: ResponseInit = {}): typeof fetch {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    }),
  ) as unknown as typeof fetch;
}

describe("loadAppConfig", () => {
  it("reads the display name from /config.json", async () => {
    const fetchImpl = respondWith({ display_name: "Starnest" });

    await expect(loadAppConfig(fetchImpl)).resolves.toEqual({ displayName: "Starnest" });
    expect(fetchImpl).toHaveBeenCalledWith("/config.json", expect.anything());
  });

  it("accepts any name, because the name is configuration and not a known value", async () => {
    await expect(loadAppConfig(respondWith({ display_name: "Relocation" }))).resolves.toEqual({
      displayName: "Relocation",
    });
  });

  it("fails when the file is missing", async () => {
    const fetchImpl = respondWith({}, { status: 404 });

    await expect(loadAppConfig(fetchImpl)).rejects.toBeInstanceOf(AppConfigError);
  });

  it("fails when the request itself throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;

    await expect(loadAppConfig(fetchImpl)).rejects.toThrow(/could not be fetched/);
  });

  it("fails when the body is not JSON", async () => {
    await expect(loadAppConfig(respondWith("not json at all"))).rejects.toThrow(/not valid JSON/);
  });

  it("fails when display_name is absent, rather than inventing a name", async () => {
    await expect(loadAppConfig(respondWith({ theme: "dark" }))).rejects.toThrow(/display_name/);
  });

  it("fails when display_name is not a non-empty string", async () => {
    await expect(loadAppConfig(respondWith({ display_name: "" }))).rejects.toThrow(/non-empty/);
    await expect(loadAppConfig(respondWith({ display_name: "   " }))).rejects.toThrow(/non-empty/);
    await expect(loadAppConfig(respondWith({ display_name: 42 }))).rejects.toThrow(/non-empty/);
  });

  it("fails when the body is JSON but not an object", async () => {
    await expect(loadAppConfig(respondWith(null))).rejects.toThrow(/display_name/);
    await expect(loadAppConfig(respondWith(["Starnest"]))).rejects.toThrow(/display_name/);
  });
});
