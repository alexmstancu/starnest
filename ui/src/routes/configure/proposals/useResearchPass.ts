import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMatchRules,
  fetchSettings,
  researchMatchRules,
} from "../../../api/endpoints";
import { useSessionState } from "../../../shell/SessionProvider";
import { type PassRecord, parsePassRecord, storedFormOf } from "./passRecord";
import {
  STARTING,
  abandoned,
  beginPass,
  couldNotStart,
  describeEnd,
  describeProgress,
  endIsWarning,
  failedOn,
  notYetAsking,
  shouldReadAnswersAgain,
  nextStep,
  withAnswer,
  type Asking,
  type Pass,
  type PassEnd,
  type Progress,
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
 * **What the pass did outlives the screen** (PL-052): its progress and then its end are kept in
 * the session store, above the routes and mirrored to this tab's storage, so leaving Configure
 * and a reload keep them. A pass still recorded as running when a screen mounts is one no page
 * is running any more, and is recorded as abandoned with what it had spent. The end stays until
 * the reader dismisses it, or the next pass starts.
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
  /** How the last pass ended. Null until one has, while the next runs, and once dismissed. */
  end: PassEnd | null;
  start: (request: PassRequest) => void;
  stop: () => void;
  /** Forgets how the last pass ended. Turned away while a pass runs. */
  dismiss: () => void;
}

type Phase = { kind: "idle" } | { kind: "starting" } | ({ kind: "asking" } & Asking);

const IDLE: Phase = { kind: "idle" };

export function useResearchPass(
  /** Told once, as a pass ends, when it may have stored a proposal: the answers have moved. */
  onAnswered: () => void,
): ResearchPass {
  const [phase, setPhase] = useState<Phase>(IDLE);
  const [record, setRecord] = useSessionState<PassRecord | null>(
    PASS_KEY,
    null,
    parsePassRecord,
    // Across levels: the pass names its own level, and what it spent stays said wherever the
    // reader goes.
    { scope: "session" },
  );
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

  // A record running that this page is not running was left by a screen that has gone.
  useEffect(() => {
    if (record?.kind === "running" && !inFlight.current) setRecord(abandoned(record));
  }, [record, setRecord]);

  const keep = useCallback(
    (next: PassRecord | null) => setRecord(next === null ? null : storedFormOf(next)),
    [setRecord],
  );

  function start(request: PassRequest): void {
    const signal = lifetime.current?.signal;
    if (inFlight.current || signal === undefined) return;
    inFlight.current = true;
    stopping.current = false;
    setStopAsked(false);
    keep({ kind: "running", ...notYetAsking(request) });
    setPhase({ kind: "starting" });

    askEachGate(request, signal, {
      reached: (progress) => {
        // A screen that has gone records nothing more: its pass is abandoned where it was.
        if (signal.aborted) return;
        keep({ kind: "running", ...progress });
        if (progress.inFlight !== null) {
          setPhase({ kind: "asking", pass: progress.pass, gate: progress.inFlight });
        }
      },
      stopAsked: () => stopping.current,
    }).then(
      (ended) => {
        inFlight.current = false;
        setPhase(IDLE);
        keep(ended);
        if (shouldReadAnswersAgain(ended)) onAnswered();
      },
      () => {
        // Abandoned: the screen that held the pass has gone. Its record says how far it got,
        // and the next screen to mount records it as abandoned.
        inFlight.current = false;
      },
    );
  }

  function stop(): void {
    // Unguarded: a stop asked for with no pass running is undone by the next start.
    stopping.current = true;
    setStopAsked(true);
  }

  function dismiss(): void {
    if (inFlight.current) return;
    keep(null);
  }

  const end = record === null || record.kind === "running" ? null : record;
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
    dismiss,
  };
}

/** Where the session store keeps the last pass. */
const PASS_KEY = "configure/research-pass";

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
  watch: { reached: (progress: Progress) => void; stopAsked: () => boolean },
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
  watch.reached({ pass, inFlight: null });

  for (;;) {
    const step = nextStep(pass, watch.stopAsked());
    if ("end" in step) return step.end;
    // Checked before every question as well as after a failure: an answer can land in the
    // moment the screen goes, and the next question must not leave with it.
    signal.throwIfAborted();
    watch.reached({ pass, inFlight: step.ask });
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
      watch.reached({ pass, inFlight: null });
    } catch (failure) {
      signal.throwIfAborted();
      return failedOn(pass, failure);
    }
  }
}
