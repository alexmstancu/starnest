import { useEffect, useRef, useState } from "react";
import {
  fetchMatchRules,
  fetchSettings,
  researchMatchRules,
} from "../../../api/endpoints";
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
  withAnswer,
  type Asking,
  type Pass,
  type PassEnd,
} from "./researchPass";

/**
 * A gate research pass, one gate per request, held to the spend cap (UI-01, UI-14).
 *
 * **The Configure screen holds it, not the panel that starts it.** Switching the criteria set
 * remounts the rules and the proposals beneath them, and a pass kept there would go with them --
 * its spend unsaid, its last answer read by nobody. Leaving Configure is what stops a pass:
 * nothing more is asked, and the question in flight is no longer waited for -- the server still
 * finishes it and keeps what it found, which the screen reads when it is next opened.
 *
 * **Stop takes effect after the question in flight.** The server finishes a call it has begun and
 * stores what it found, so cutting the request would lose an answer already paid for; the pass
 * simply asks nothing after it.
 *
 * **The decisions are `researchPass.ts`'s** -- which gate is next, whether the cap is reached, how
 * the pass ended. This hook only asks, one request after another, and keeps what the screen shows.
 */

export interface PassRequest {
  level: string;
  /** The questions the estimate counted, which the pass's progress is said against (PL-159). */
  questionsTotal: number;
  /** Goes with every request of this pass, and with no other pass: a sentence about this one. */
  acceptUncapped: boolean;
  /** The estimate's ceiling, which the spend is read beside. */
  ceilingEur: number;
}

export interface ResearchPass {
  running: boolean;
  /** Stop was pressed; the pass ends once the question in flight is answered. */
  stopAsked: boolean;
  /** What to say now: the pass's progress while it runs, how the last one ended after. */
  statusLine: { text: string; warning: boolean } | null;
  /** Gates asked but not stored: the model cited nothing, or a person answered first. */
  refusals: readonly string[];
  /** Why the last pass ended early, when a request was refused or failed. Null otherwise. */
  failure: unknown;
  /** How the last pass ended. Null until one has, and again while the next runs. */
  end: PassEnd | null;
  start: (request: PassRequest) => void;
  stop: () => void;
}

type Phase = { kind: "idle" } | { kind: "starting" } | ({ kind: "asking" } & Asking);

const IDLE: Phase = { kind: "idle" };

export function useResearchPass(
  /** Told once, as a pass ends, when it may have stored a proposal: the answers have moved. */
  onAnswered: () => void,
): ResearchPass {
  const [phase, setPhase] = useState<Phase>(IDLE);
  const [end, setEnd] = useState<PassEnd | null>(null);
  const [stopAsked, setStopAsked] = useState(false);
  // Refs, because the pass reads them between its requests -- long after the render that a
  // press changed -- and two presses in one tick would both pass a check on state.
  const inFlight = useRef(false);
  const stopping = useRef(false);
  // One per mount, so leaving Configure abandons the request in flight. Made in the effect
  // rather than at the first render, so a remount gets a signal that has not been aborted.
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  function start(request: PassRequest): void {
    const signal = lifetime.current?.signal;
    if (inFlight.current || signal === undefined) return;
    inFlight.current = true;
    stopping.current = false;
    setStopAsked(false);
    setEnd(null);
    setPhase({ kind: "starting" });

    askEachGate(request, signal, {
      asking: (asking) => setPhase({ kind: "asking", ...asking }),
      stopAsked: () => stopping.current,
    }).then(
      (ended) => {
        inFlight.current = false;
        setPhase(IDLE);
        setEnd(ended);
        if (shouldReadAnswersAgain(ended)) onAnswered();
      },
      () => {
        // Abandoned: the screen that held the pass has gone, and there is nobody left to tell.
        inFlight.current = false;
      },
    );
  }

  function stop(): void {
    // Unguarded: a stop asked for with no pass running is undone by the next start.
    stopping.current = true;
    setStopAsked(true);
  }

  return {
    running: phase.kind !== "idle",
    stopAsked,
    statusLine: statusLineOf(phase, end, stopAsked),
    refusals:
      phase.kind === "asking"
        ? phase.pass.tally.refusals
        : (end?.pass.tally.refusals ?? []),
    failure: end !== null && "failure" in end ? end.failure : null,
    end,
    start,
    stop,
  };
}

function statusLineOf(
  phase: Phase,
  end: PassEnd | null,
  stopAsked: boolean,
): ResearchPass["statusLine"] {
  if (phase.kind === "starting") return { text: STARTING, warning: false };
  if (phase.kind === "asking") {
    return { text: describeProgress(phase, stopAsked), warning: false };
  }
  if (end === null) return null;
  return { text: describeEnd(end), warning: endIsWarning(end) };
}

/**
 * Asks each gate in turn until the pass comes to an end, and says which.
 *
 * **Rejects only when abandoned**: every failure of a read or a request is an end the screen
 * shows, while an abort is the screen having gone -- `throwIfAborted` turns the failure it caused
 * back into what it is, so it is never reported as a failed pass.
 */
async function askEachGate(
  request: PassRequest,
  signal: AbortSignal,
  watch: { asking: (asking: Asking) => void; stopAsked: () => boolean },
): Promise<PassEnd> {
  let pass: Pass;
  try {
    const [settings, rules] = await Promise.all([
      fetchSettings({ signal }),
      fetchMatchRules(request.level, { signal }),
    ]);
    pass = beginPass({
      level: request.level,
      gates: rules.items,
      questionsTotal: request.questionsTotal,
      capEur: settings.run_spend_cap_eur ?? null,
      ceilingEur: request.ceilingEur,
    });
  } catch (failure) {
    signal.throwIfAborted();
    return couldNotStart(request, failure);
  }

  for (;;) {
    const step = nextStep(pass, watch.stopAsked());
    if ("end" in step) return step.end;
    // Checked before every question as well as after a failure: an answer can land in the
    // moment the screen goes, and the next question must not leave with it.
    signal.throwIfAborted();
    watch.asking({ pass, gate: step.ask });
    try {
      const answer = await researchMatchRules(
        {
          level: request.level,
          match_rules: [step.ask.id],
          accept_uncapped_spend: request.acceptUncapped,
        },
        { signal },
      );
      pass = withAnswer(pass, answer);
    } catch (failure) {
      signal.throwIfAborted();
      return failedOn(pass, failure);
    }
  }
}
