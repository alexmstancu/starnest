import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppConfig } from "../config/AppConfigContext";
import { useSelection } from "./SelectionContext";

/**
 * Both contexts refuse to serve a component mounted outside their provider, rather than
 * handing back a null the caller would have to check on every use.
 */

function ReadsConfig() {
  return <p>{useAppConfig().displayName}</p>;
}

function ReadsSelection() {
  return <p>{useSelection().levelId}</p>;
}

describe("context guards", () => {
  it("refuses to read the configuration outside its provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<ReadsConfig />)).toThrow(/AppConfigProvider/);

    quiet.mockRestore();
  });

  it("refuses to read the selection outside its provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<ReadsSelection />)).toThrow(/SelectionProvider/);

    quiet.mockRestore();
  });
});
