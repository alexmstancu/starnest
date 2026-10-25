import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeRunStatus, RUN_STATUS_WORDS } from "./runStatus";

/** The statuses the contract names, read from the generated schema rather than restated. */
function contractStatuses(): string[] {
  const schema = readFileSync(join(__dirname, "..", "api", "schema.ts"), "utf8");
  const union = /run_status: ((?:"[a-z_]+"(?: \| )?)+);/.exec(schema)?.[1] ?? "";
  return [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
}

describe("a run's status in words", () => {
  /** PL-122's guard: a status the server adds must be worded here, or this fails. */
  it("words every status the contract names", () => {
    const statuses = contractStatuses();
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.filter((status) => !Object.hasOwn(RUN_STATUS_WORDS, status))).toEqual([]);
  });

  it("never shows a wire identifier", () => {
    for (const status of [...contractStatuses(), "stopping"]) {
      const { word, heading, outcome } = describeRunStatus(status);
      expect(word).not.toMatch(/_/);
      expect(heading).not.toMatch(/_/);
      expect(outcome).not.toMatch(/_/);
    }
  });

  /** UF-083: the reader's stop read as a halt at the cap, in words and in colour. */
  it("keeps a stop by the reader apart from a halt at the spend cap", () => {
    const byYou = describeRunStatus("halted_by_user");
    const atTheCap = describeRunStatus("halted_on_spend_cap");
    expect(byYou).toMatchObject({ word: "halted by you", heading: "Stopped by you", tone: "plain" });
    expect(atTheCap).toMatchObject({
      word: "halted at the spend cap",
      heading: "Halted at the spend cap",
      tone: "warn",
    });
    expect(byYou.outcome).not.toBe(atTheCap.outcome);
  });

  it("says a status it does not know is not known, rather than printing it", () => {
    expect(describeRunStatus("exploded_somehow").word).toBe("status not known");
    expect(describeRunStatus(null).word).toBe("status not known");
    expect(describeRunStatus(undefined).heading).toBe("Acquisition");
    expect(describeRunStatus("toString").word).toBe("status not known");
  });
});
