import { describe, expect, it } from "vitest";
import { ApiError, CLIENT_ERROR_CODES } from "../../../api/ApiError";
import {
  STARTING,
  beginPass,
  couldNotStart,
  describeEnd,
  describeProgress,
  endIsWarning,
  failedOn,
  shouldReadAnswersAgain,
  nextStep,
  reachedCap,
  spendIsKnown,
  spentEur,
  withAnswer,
  type Gate,
  type Pass,
  type PassEnd,
  type ResearchAnswer,
} from "./researchPass";

/**
 * UI-01 and UI-14. **A research pass is one request per gate, and the page holds it to the spend
 * cap.** The server's cap is per request, so across a pass the only meter is the one kept here:
 * what each answer says it spent, summed, and compared with the cap before the next gate is
 * asked -- the same rule as the server's own meter, `spent >= cap`.
 */

const VISA: Gate = { id: "country.visa_route_exists", name: "A visa route exists" };
const FREE_MOVEMENT: Gate = {
  id: "country.eu_free_movement",
  name: "Free movement applies",
};
const BY_HAND: Gate = { id: "not_manually_excluded", name: "Not excluded by hand" };
const GATES = [VISA, FREE_MOVEMENT, BY_HAND];

/** What one request answers with, as the server sends it. */
function answer(
  cost_eur: number,
  more: Partial<ResearchAnswer> = {},
): ResearchAnswer {
  return {
    proposals: [],
    refusals: [],
    cost_eur,
    calls: cost_eur > 0 ? 1 : 0,
    halted_on_spend_cap: false,
    ...more,
  };
}

function aPass(
  scope: Partial<{
    level: string;
    gates: Gate[];
    questionsTotal: number;
    capEur: number | null;
    ceilingEur: number;
  }> = {},
): Pass {
  return beginPass({
    level: "country",
    gates: GATES,
    questionsTotal: 3,
    capEur: null,
    ceilingEur: 0.12,
    ...scope,
  });
}

/** What a pass reads at its start and could not: the level and the estimate, no gates. */
const UNREAD_SCOPE = { level: "country", questionsTotal: 3, ceilingEur: 0.12 };

/** A pass that has had these answers, one gate each, in order. */
function after(pass: Pass, ...answers: ResearchAnswer[]): Pass {
  return answers.reduce(withAnswer, pass);
}

/** Drives a pass to its end, answering each gate it asks as given. */
function drive(
  pass: Pass,
  answerFor: (gate: Gate) => ResearchAnswer,
): { asked: string[]; end: PassEnd } {
  const asked: string[] = [];
  let current = pass;
  for (;;) {
    const step = nextStep(current, false);
    if ("end" in step) return { asked, end: step.end };
    asked.push(step.ask.id);
    current = withAnswer(current, answerFor(step.ask));
  }
}

function endOf(pass: Pass, stopAsked = false): PassEnd {
  const step = nextStep(pass, stopAsked);
  if (!("end" in step)) throw new Error(`the pass would ask ${step.ask.id} next`);
  return step.end;
}

const REFUSED = new ApiError({
  code: "spend_cap_not_set",
  message: "no cap",
  status: 409,
});
const UNREACHABLE = new ApiError({
  code: CLIENT_ERROR_CODES.unreachable,
  message: "gone",
});

describe("the order a pass asks in", () => {
  it("asks every gate once, one at a time, in the order the catalog lists them", () => {
    const { asked, end } = drive(aPass(), () => answer(0));

    expect(asked).toEqual([
      "country.visa_route_exists",
      "country.eu_free_movement",
      "not_manually_excluded",
    ]);
    expect(end.kind).toBe("finished");
  });

  it("asks nothing at a level with no gate", () => {
    const { asked, end } = drive(aPass({ gates: [] }), () => answer(0.04));

    expect(asked).toEqual([]);
    expect(end.kind).toBe("finished");
  });
});

describe("what a pass adds up", () => {
  it("adds what each request spent, called, proposed and refused", () => {
    const pass = after(
      aPass(),
      answer(0.04, { proposals: [{}], refusals: ["one cited nothing"] }),
      answer(0),
      answer(0.03, { calls: 2, proposals: [{}, {}], refusals: ["two cited nothing"] }),
    );

    expect(pass.tally.asked).toBe(3);
    expect(pass.tally.calls).toBe(3);
    expect(spentEur(pass.tally)).toBe(0.07);
    expect(pass.tally.proposed).toBe(3);
    expect(pass.tally.refusals).toEqual(["one cited nothing", "two cited nothing"]);
  });

  it("reads an answer that lists no refusals as refusing nothing", () => {
    const pass = after(aPass(), {
      proposals: [],
      cost_eur: 0,
      calls: 0,
      halted_on_spend_cap: false,
    });

    expect(pass.tally.refusals).toEqual([]);
  });

  it("sums in micro-euros, so ten requests at ten cents come to a euro exactly", () => {
    const tenCents = Array.from({ length: 10 }, () => answer(0.1));
    // What the same figures come to in floating point, which is why they are not summed in it.
    expect(tenCents.reduce((sum, each) => sum + each.cost_eur, 0)).not.toBe(1);

    const gates = Array.from({ length: 10 }, (_, index) => ({
      id: `gate.${index}`,
      name: `Gate ${index}`,
    }));
    const pass = after(aPass({ gates }), ...tenCents);

    expect(spentEur(pass.tally)).toBe(1);
  });

  it("keeps what a request the server halted spent, without counting its gate as asked", () => {
    const pass = after(
      aPass(),
      answer(0.04),
      answer(0.02, { halted_on_spend_cap: true }),
    );

    expect(pass.tally.asked).toBe(1);
    expect(pass.tally.calls).toBe(2);
    expect(spentEur(pass.tally)).toBe(0.06);
  });
});

describe("holding a pass to the spend cap", () => {
  it("asks the next gate while the spend is below the cap", () => {
    const pass = after(aPass({ capEur: 0.08 }), answer(0.04));

    expect(reachedCap(pass.tally, 0.08)).toBe(false);
    expect(nextStep(pass, false)).toEqual({ ask: FREE_MOVEMENT });
  });

  it("stops before the next gate once the spend reaches the cap exactly", () => {
    const pass = after(aPass({ capEur: 0.08 }), answer(0.04), answer(0.04));

    expect(reachedCap(pass.tally, 0.08)).toBe(true);
    expect(endOf(pass)).toEqual({ kind: "cap", pass });
  });

  it("reaches a cap the same figures summed in floating point fall a hair short of", () => {
    expect(0.7 + 0.1).toBeLessThan(0.8);

    const pass = after(aPass({ capEur: 0.8 }), answer(0.7), answer(0.1));

    expect(reachedCap(pass.tally, 0.8)).toBe(true);
    expect(endOf(pass).kind).toBe("cap");
  });

  it("stops once the spend has gone past the cap", () => {
    const pass = after(aPass({ capEur: 0.1 }), answer(0.12));

    expect(reachedCap(pass.tally, 0.1)).toBe(true);
    expect(endOf(pass).kind).toBe("cap");
  });

  it("never stops for a cap that is not set", () => {
    const pass = after(aPass({ capEur: null }), answer(1000), answer(1000));

    expect(reachedCap(pass.tally, null)).toBe(false);
    expect(nextStep(pass, false)).toEqual({ ask: BY_HAND });
  });

  it("stops before the first gate under a cap of zero, as the server's own meter does", () => {
    const pass = aPass({ capEur: 0 });

    expect(reachedCap(pass.tally, 0)).toBe(true);
    expect(endOf(pass).kind).toBe("cap");
  });

  it("ends at the cap when the server says it stopped there, whatever the page's own sum", () => {
    const pass = after(
      aPass({ capEur: 10 }),
      answer(0.04, { halted_on_spend_cap: true }),
    );

    expect(reachedCap(pass.tally, 10)).toBe(false);
    expect(endOf(pass).kind).toBe("cap");
  });

  it("finishes rather than stopping at the cap when the last gate reached it", () => {
    const pass = after(
      aPass({ capEur: 0.08 }),
      answer(0),
      answer(0.04),
      answer(0.04),
    );

    expect(endOf(pass).kind).toBe("finished");
  });
});

describe("stopping and failing", () => {
  it("stops before the next gate once the reader asks", () => {
    const pass = after(aPass(), answer(0.04));

    expect(endOf(pass, true)).toEqual({ kind: "stopped", pass });
  });

  it("finishes when the reader asked to stop during the last gate, since nothing was left", () => {
    const pass = after(aPass(), answer(0), answer(0), answer(0.04));

    expect(endOf(pass, true).kind).toBe("finished");
  });

  it("ends refused on a refusal in the contract's shape, which spent nothing", () => {
    const pass = after(aPass(), answer(0.04));

    expect(failedOn(pass, REFUSED)).toEqual({
      kind: "refused",
      pass,
      failure: REFUSED,
    });
  });

  it("ends failed on anything else, whose spend is not known", () => {
    const pass = after(aPass(), answer(0.04));

    expect(failedOn(pass, UNREACHABLE)).toEqual({
      kind: "failed",
      pass,
      failure: UNREACHABLE,
    });
  });

  it("ends before asking anything when the cap or the gates could not be read", () => {
    const end = couldNotStart(UNREAD_SCOPE, UNREACHABLE);

    expect(end).toMatchObject({ kind: "unread", failure: UNREACHABLE });
    expect(end.pass.gates).toEqual([]);
    expect(end.pass.tally.asked).toBe(0);
    expect(end.pass.ceilingEur).toBe(0.12);
  });

  /**
   * UIC-A2. **Read again after any pass that asked something**, not only one that stored: the
   * server declines a model's proposal when a person answered meanwhile, so the answers can move
   * under a pass that stored nothing -- and an outdated proposal stayed confirmable after it.
   */
  it("reads the answers again after any pass that asked something", () => {
    const proposedOne = after(aPass(), answer(0.04, { proposals: [{}] }));
    const proposedNothing = after(aPass(), answer(0.04));
    const metAPerson = after(
      aPass(),
      answer(0.04, { refusals: ["a person answered this gate while the pass ran"] }),
    );

    expect(shouldReadAnswersAgain(endOf(proposedOne, true))).toBe(true);
    expect(shouldReadAnswersAgain(endOf(proposedNothing, true))).toBe(true);
    expect(shouldReadAnswersAgain(endOf(metAPerson, true))).toBe(true);
    expect(shouldReadAnswersAgain(failedOn(proposedNothing, REFUSED))).toBe(true);
  });

  /**
   * RD-1. **An answer the cap cut short still moved the answers.** A request about more than one
   * candidate can store a proposal and then meet the cap: the gate is not counted as asked, but
   * a proposal is on the server that the list on screen has never seen.
   */
  it("reads them again after an answer the cap cut short, whatever it stored", () => {
    const proposedThenCapped = after(
      aPass(),
      answer(0.04, { halted_on_spend_cap: true, proposals: [{}] }),
    );
    const cappedAtOnce = after(aPass(), answer(0, { halted_on_spend_cap: true }));

    expect(shouldReadAnswersAgain(endOf(proposedThenCapped, false))).toBe(true);
    expect(shouldReadAnswersAgain(endOf(cappedAtOnce, false))).toBe(true);
  });

  it("does not read them again when nothing was asked", () => {
    expect(shouldReadAnswersAgain(failedOn(aPass(), REFUSED))).toBe(false);
    expect(shouldReadAnswersAgain(couldNotStart(UNREAD_SCOPE, UNREACHABLE))).toBe(false);
  });

  it("reads them again after a failure, which may follow a write it never reported", () => {
    expect(shouldReadAnswersAgain(failedOn(aPass(), UNREACHABLE))).toBe(true);
  });
});

describe("what the screen says while a pass runs", () => {
  it("says it is reading what it needs before it asks anything", () => {
    expect(STARTING).toBe(
      "Reading the spend cap and the gates before asking anything.",
    );
  });

  it("names the gate being asked, the level, the questions against the estimate's, and the spend", () => {
    const pass = after(aPass(), answer(0.04));

    expect(describeProgress({ pass, gate: FREE_MOVEMENT }, false)).toBe(
      "Asking Free movement applies at the Country level. So far 1 of 3 questions, €0.04 spent of at most €0.12.",
    );
  });

  it("counts from nothing at the first gate", () => {
    expect(describeProgress({ pass: aPass(), gate: VISA }, false)).toBe(
      "Asking A visa route exists at the Country level. So far 0 of 3 questions, €0.00 spent of at most €0.12.",
    );
  });

  /**
   * PL-159. **Questions, as the estimate counts them**, not gates: five gates of which three can
   * be researched read "gate 4 of 5" against an estimate of three questions.
   */
  it("counts questions as the estimate does, however many gates the level has", () => {
    const pass = after(aPass({ questionsTotal: 1 }), answer(0));

    expect(describeProgress({ pass, gate: FREE_MOVEMENT }, false)).toBe(
      "Asking Free movement applies at the Country level. So far 0 of 1 question, €0.00 spent of at most €0.12.",
    );
  });

  it("says the pass will stop once the gate in flight is answered, when the reader asked", () => {
    const pass = after(aPass(), answer(0.04), answer(0.04, { calls: 2 }));

    expect(describeProgress({ pass, gate: BY_HAND }, true)).toBe(
      "Stopping once Not excluded by hand is answered at the Country level. So far 3 of 3 questions, €0.08 spent of at most €0.12.",
    );
  });

  /** PL-151. The level the pass researches, whatever level the screen shows now. */
  it("names the level the pass researches", () => {
    const pass = aPass({ level: "city" });

    expect(describeProgress({ pass, gate: VISA }, false)).toMatch(/^Asking A visa route exists at the City level\./);
    expect(describeEnd(endOf(after(pass, answer(0), answer(0), answer(0))))).toMatch(
      /^The last pass at the City level /,
    );
  });
});

describe("what the screen says once a pass has ended", () => {
  it("says a finished pass asked every gate, and what it spent beside the estimate", () => {
    const end = endOf(after(aPass(), answer(0.04), answer(0), answer(0.08, { calls: 2 })));

    expect(describeEnd(end)).toBe(
      "The last pass at the Country level asked every gate: it asked 3 of 3 questions and spent €0.12 of at most €0.12.",
    );
    expect(endIsWarning(end)).toBe(false);
  });

  it("says a pass that called nothing spent nothing", () => {
    const end = endOf(after(aPass(), answer(0), answer(0), answer(0)));

    expect(describeEnd(end)).toBe(
      "The last pass at the Country level asked every gate: it asked 0 of 3 questions and spent nothing.",
    );
  });

  it("says when there was no gate to ask", () => {
    expect(describeEnd(endOf(aPass({ gates: [] })))).toBe(
      "The last pass at the Country level found no gate to ask, so it made no calls and spent nothing.",
    );
  });

  it("says a pass stopped at the cap, with the cap, the spend and the questions asked", () => {
    const end = endOf(
      after(aPass({ capEur: 0.08 }), answer(0.04), answer(0.04)),
    );

    expect(describeEnd(end)).toBe(
      "The last pass at the Country level stopped at the spend cap of €0.08: it asked 2 of 3 questions and spent €0.08 of at most €0.12.",
    );
    expect(endIsWarning(end)).toBe(true);
  });

  it("says the server stopped it at the cap even when the page had read none", () => {
    const end = endOf(
      after(aPass({ capEur: null }), answer(0.04, { halted_on_spend_cap: true })),
    );

    expect(describeEnd(end)).toBe(
      "The last pass at the Country level stopped at the spend cap: it asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
  });

  it("says the reader stopped it, and how many questions it asked", () => {
    const end = endOf(after(aPass(), answer(0.04)), true);

    expect(describeEnd(end)).toBe(
      "You stopped the last pass at the Country level: it asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
    expect(endIsWarning(end)).toBe(false);
  });

  it("says a refusal spent nothing, and which gate it came at", () => {
    const end = failedOn(after(aPass(), answer(0.04)), REFUSED);

    expect(describeEnd(end)).toBe(
      "The last pass at the Country level was refused at Free movement applies, which spent nothing: it asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
    expect(endIsWarning(end)).toBe(true);
  });

  it("says what a failed request spent is not known, and what came before it", () => {
    const end = failedOn(after(aPass(), answer(0.04)), UNREACHABLE);

    expect(describeEnd(end)).toBe(
      "The last pass at the Country level failed at Free movement applies, and what that request spent is not known: before it, the pass asked 1 of 3 questions and spent €0.04 of at most €0.12.",
    );
    expect(endIsWarning(end)).toBe(true);
  });

  it("says a pass that could not read what it needed asked nothing", () => {
    const end = couldNotStart(UNREAD_SCOPE, UNREACHABLE);

    expect(describeEnd(end)).toBe(
      "The last pass at the Country level did not start, because the spend cap and the gates could not be read: it asked nothing and spent nothing.",
    );
    expect(endIsWarning(end)).toBe(true);
  });
});

/**
 * UI-14, NEW-31. **A failed request may still have been billed.** A refusal in the contract's
 * shape is the server saying no before asking the model anything; any other failure can come
 * after calls that were paid for, and the response that would have said how many never arrived.
 */
describe("whether a failed research request is known to have spent nothing", () => {
  it("knows a refusal in the contract's shape spent nothing", () => {
    expect(spendIsKnown(REFUSED)).toBe(true);
    expect(
      spendIsKnown(
        new ApiError({ code: "invalid_request", message: "bad", status: 422 }),
      ),
    ).toBe(true);
  });

  /**
   * NEW-31. **A 501 is a refusal too**: no model is configured, or the `llm` source is switched
   * off -- which can happen on this same screen between the estimate and the pass. The server
   * says so before it asks anything, so the request spent nothing.
   */
  it("knows a request refused because no model may be asked spent nothing", () => {
    expect(
      spendIsKnown(
        new ApiError({
          code: "llm_not_configured",
          message: "the llm source is switched off, so no gate can be researched",
          status: 501,
        }),
      ),
    ).toBe(true);
  });

  it("does not trust a 501 whose body is not the contract's shape", () => {
    expect(
      spendIsKnown(
        new ApiError({
          code: CLIENT_ERROR_CODES.malformedError,
          message: "HTML",
          status: 501,
        }),
      ),
    ).toBe(false);
  });

  it("does not know what a server failure spent", () => {
    expect(
      spendIsKnown(
        new ApiError({ code: "internal_error", message: "boom", status: 500 }),
      ),
    ).toBe(false);
  });

  it.each([
    [502, "bad_gateway"],
    [503, "service_unavailable"],
    [504, "gateway_timeout"],
  ])(
    "does not know what a request answered with a %i spent, even in the contract's shape",
    (status, code) => {
      expect(
        spendIsKnown(new ApiError({ code, message: "failed", status })),
      ).toBe(false);
    },
  );

  it("does not know what a request the proxy timed out spent", () => {
    expect(
      spendIsKnown(
        new ApiError({
          code: CLIENT_ERROR_CODES.malformedError,
          message: "HTML",
          status: 504,
        }),
      ),
    ).toBe(false);
  });

  it("does not know what a request spent when the backend could not be reached", () => {
    expect(spendIsKnown(UNREACHABLE)).toBe(false);
  });

  it("does not trust a 4xx whose body is not the contract's shape", () => {
    expect(
      spendIsKnown(
        new ApiError({
          code: CLIENT_ERROR_CODES.malformedError,
          message: "HTML",
          status: 413,
        }),
      ),
    ).toBe(false);
  });

  it("does not know what anything else spent", () => {
    expect(spendIsKnown(new Error("unexpected"))).toBe(false);
  });
});
