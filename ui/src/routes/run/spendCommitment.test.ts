import { describe, expect, it } from "vitest";
import { describeCommitment, describeSpend } from "./spendCommitment";

describe("what a run commits you to", () => {
  /**
   * A paid source is asked only when a run names its attributes, so a sweep over a level is
   * free by construction -- and a confirmation implying otherwise would train a reader to
   * click past the ones that matter.
   */
  it("says plainly when nothing can be spent", () => {
    const commitment = describeCommitment({
      act: "Start this run",
      itemsTotal: 1312,
      llmCallCount: 0,
      estimatedCostEur: 0,
      capEur: 5,
    });
    expect(commitment.spends).toBe(false);
    expect(commitment.uncapped).toBe(false);
    expect(commitment.sentence).toContain("1,312 values");
    expect(commitment.sentence).toMatch(/costs nothing/i);
  });

  it("names the ceiling, the paid calls and the cap when it can spend", () => {
    const commitment = describeCommitment({
      act: "Retry 12 failed",
      itemsTotal: 12,
      llmCallCount: 12,
      estimatedCostEur: 0.61,
      capEur: 5,
    });
    expect(commitment.spends).toBe(true);
    expect(commitment.uncapped).toBe(false);
    expect(commitment.sentence).toContain("12 values");
    expect(commitment.sentence).toContain("12 paid calls");
    expect(commitment.sentence).toMatch(/€0\.61/);
    expect(commitment.sentence).toMatch(/€5\.00/);
    expect(commitment.sentence).toMatch(/keeps whatever completed/i);
  });

  /**
   * `run_spend_cap_eur` is nullable and null is the shipped state. The backend refuses a run
   * that can spend without a cap unless the request accepts going uncapped, so the strip must
   * say which of those is about to happen rather than implying a ceiling that does not exist.
   */
  it("says when there is no cap at all", () => {
    const commitment = describeCommitment({
      act: "Start this run",
      itemsTotal: 40,
      llmCallCount: 40,
      estimatedCostEur: 2,
      capEur: null,
    });
    expect(commitment.uncapped).toBe(true);
    expect(commitment.sentence).toMatch(/no spend cap is set/i);
    expect(commitment.sentence).toMatch(/uncapped/i);
  });

  it("treats a missing cap the same as an explicit null", () => {
    expect(
      describeCommitment({
        act: "Start this run",
        itemsTotal: 1,
        llmCallCount: 1,
        estimatedCostEur: 1,
      }).uncapped,
    ).toBe(true);
  });

  it("carries the name of the act it is confirming", () => {
    expect(
      describeCommitment({ act: "Retry 62 unanswered", itemsTotal: 62 }).sentence,
    ).toMatch(/^Retry 62 unanswered over 62 values/);
  });

  it("counts nothing as nothing rather than as unknown", () => {
    const commitment = describeCommitment({ act: "Start this run" });
    expect(commitment.sentence).toContain("0 values");
    expect(commitment.spends).toBe(false);
  });
});

describe("what a run cost", () => {
  /** Recorded when the run started (PL-056): what it could spend and what held it. */
  const PAID = {
    plan_recorded: true,
    llm_call_count: 3,
    cost_eur: 0.11,
    estimate_ceiling_eur: 0.42,
    spend_cap_eur: 5,
  };

  it("says so plainly when nothing could be or was charged", () => {
    // Every source shipped today is free. A spend line that appeared only when money moved
    // would leave a reader unable to tell "free" from "not reported".
    expect(
      describeSpend({ plan_recorded: true, estimate_ceiling_eur: 0, cost_eur: 0 }),
    ).toBe("No paid call, nothing charged");
  });

  it("names the ceiling and the cap while the run is going, as the design does", () => {
    expect(describeSpend({ ...PAID, run_status: "running" })).toBe(
      "Spent €0.11 of the €0.42 ceiling. It halts at the €5.00 cap and keeps whatever completed.",
    );
  });

  it("names what was charged against the ceiling and the cap once it has ended", () => {
    expect(describeSpend({ ...PAID, run_status: "halted_on_spend_cap" })).toBe(
      "Charged €0.11 of the €0.42 ceiling, held to the €5.00 cap.",
    );
  });

  /** A cap of null on a run that could spend: the request accepted going uncapped. */
  it("says there was no cap rather than inventing one", () => {
    expect(
      describeSpend({ ...PAID, spend_cap_eur: null, run_status: "running" }),
    ).toBe("Spent €0.11 of the €0.42 ceiling. No cap is set: going uncapped was accepted.");
    expect(
      describeSpend({ ...PAID, spend_cap_eur: null, run_status: "completed" }),
    ).toBe("Charged €0.11 of the €0.42 ceiling, with no cap.");
  });

  /** The settings' cap now is not the one the run was held to, so it is never borrowed. */
  it("says a run from before plans were recorded has no ceiling or cap, never zero", () => {
    expect(
      describeSpend({
        plan_recorded: false,
        llm_call_count: 4,
        cost_eur: 0.32,
        estimate_ceiling_eur: null,
        spend_cap_eur: null,
      }),
    ).toBe("4 paid calls, €0.32. Its ceiling and cap were not recorded.");
    expect(describeSpend({ plan_recorded: false })).toBe(
      "No paid call, nothing charged. Its ceiling and cap were not recorded.",
    );
  });

  it("agrees with itself about one call on an older run", () => {
    expect(describeSpend({ llm_call_count: 1, cost_eur: 0.08 })).toBe(
      "1 paid call, €0.08. Its ceiling and cap were not recorded.",
    );
  });
});
