import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquiringProgress,
  acquisitionEnded,
  announcementFor,
  runningRunOf,
} from "./acquiringProgress";

describe("how far through an acquisition is", () => {
  it("reads as a count of what is done out of what there is", () => {
    expect(acquiringProgress(12, 96)).toEqual({
      reading: "12 of 96",
      portion: 12.5,
    });
  });

  /** A run that has not said how much there is to do has not failed to do any of it. */
  it("says it is starting rather than none of none", () => {
    expect(acquiringProgress(0, 0)).toEqual({
      reading: "starting",
      portion: 0,
    });
  });

  it("never draws past the end of the track", () => {
    expect(acquiringProgress(120, 96).portion).toBe(100);
  });

  it("never draws behind the start of it", () => {
    expect(acquiringProgress(-5, 96).portion).toBe(0);
  });

  it("is full when everything is done", () => {
    expect(acquiringProgress(96, 96)).toEqual({
      reading: "96 of 96",
      portion: 100,
    });
  });
});

/**
 * UI-11. **When the run the shell watches stops, what the sidebar read about it is stale.** The
 * strip under the tabs looks at the newest run every two seconds; these say which look is news.
 */
describe("which run a look saw running", () => {
  it("is the newest run while it runs", () => {
    expect(runningRunOf({ id: 8, run_status: "running" })).toBe(8);
  });

  it("is none once the newest run has stopped, however it stopped", () => {
    for (const run_status of [
      "completed",
      "halted_on_spend_cap",
      "halted_by_user",
      "failed",
    ] as const) {
      expect(runningRunOf({ id: 8, run_status })).toBeNull();
    }
  });

  it("is none when there has never been a run", () => {
    expect(runningRunOf(undefined)).toBeNull();
  });
});

describe("whether a run has ended since the last look", () => {
  /** A run that had ended before anybody looked did not end under them. */
  it("is never so on the first look, at a run that has stopped", () => {
    expect(acquisitionEnded(null, { id: 7, run_status: "completed" })).toBe(false);
  });

  it("is never so on the first look, at a run that is running", () => {
    expect(acquisitionEnded(null, { id: 8, run_status: "running" })).toBe(false);
  });

  it("is not so while the run seen running is still running", () => {
    expect(acquisitionEnded(8, { id: 8, run_status: "running" })).toBe(false);
  });

  it("is so once the run seen running has finished", () => {
    expect(acquisitionEnded(8, { id: 8, run_status: "completed" })).toBe(true);
  });

  it("is so once the run seen running has failed", () => {
    expect(acquisitionEnded(8, { id: 8, run_status: "failed" })).toBe(true);
  });

  /** Ended and followed by another between two looks: the one that was watched is over. */
  it("is so once another run has taken its place", () => {
    expect(acquisitionEnded(8, { id: 9, run_status: "running" })).toBe(true);
  });

  it("is so when the runs have gone altogether", () => {
    expect(acquisitionEnded(8, undefined)).toBe(true);
  });

  it("is not so when nothing was running and nothing is", () => {
    expect(acquisitionEnded(null, undefined)).toBe(false);
  });
});

describe("what a look announces (PL-131)", () => {
  const running = (id: number) => ({ id, run_status: "running" as const });
  const completed = (id: number) => ({ id, run_status: "completed" as const });

  it("announces a run the first time it is seen running", () => {
    expect(announcementFor(null, running(7))).toBe("An acquisition is running.");
  });

  it("announces nothing while the same run goes on running", () => {
    expect(announcementFor(7, running(7))).toBeNull();
  });

  it("announces the end of the run it saw running", () => {
    expect(announcementFor(7, completed(7))).toBe("The acquisition has ended.");
    expect(announcementFor(7, undefined)).toBe("The acquisition has ended.");
  });

  it("announces both when another run has taken its place", () => {
    expect(announcementFor(7, running(8))).toBe(
      "The acquisition has ended. An acquisition is running.",
    );
  });

  it("announces nothing when nothing was running and nothing is", () => {
    expect(announcementFor(null, completed(7))).toBeNull();
    expect(announcementFor(null, undefined)).toBeNull();
  });
});

describe("how the strip is drawn (PL-133)", () => {
  const sheet = readFileSync(join(__dirname, "..", "styles.css"), "utf8");

  /** The declarations of the one rule whose selector is exactly `selector`. */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(sheet);
    if (!match) throw new Error(`no rule for ${selector}`);
    return match[1]!;
  }

  it("groups the count as every other count is grouped", () => {
    expect(acquiringProgress(1200, 4800).reading).toBe("1,200 of 4,800");
  });

  it("colours the bar with fill, which an SVG rectangle reads, not background", () => {
    expect(rule(".acquiring-bar__fill")).toMatch(/\bfill:\s*var\(--colour-accent\)/);
    expect(rule(".acquiring-bar__fill")).not.toMatch(/background/);
  });

  it("sits exactly where the tab bar ends, both read from one height", () => {
    expect(rule(".tabbar")).toMatch(/\bheight:\s*var\(--tabbar-height\)/);
    expect(rule(".acquiring-bar")).toMatch(/\btop:\s*var\(--tabbar-height\)/);
  });
});
