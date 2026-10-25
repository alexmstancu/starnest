import { useCallback, useMemo, useRef, useState } from "react";
import {
  fetchMatchRules,
  putMatchRuleResult,
  type MatchRule,
  type MatchRuleResult,
} from "../../../api/endpoints";
import type { Read } from "../../../api/read";
import type { CandidateRosterState } from "../../../api/useCandidateNames";
import { useCandidateRosterState } from "../../../api/useCandidateRoster";
import { useRead } from "../../../api/useRead";
import {
  emptyDraft,
  readDraft,
  type DraftProblem,
  type GateAnswerDraft,
} from "./gateAnswerForm";

/**
 * The form that records, overrides or rules out one gate answer at one level (`reqs.md` 3.7,
 * 8.2; UI-29).
 *
 * **Keyed by level, never by set** (D4): an answer is objective and belongs to no criteria set,
 * so switching sets keeps a half-typed answer, and a set that failed to read hides nothing here.
 *
 * **One write at a time** (NEW-44). Save is held, not disabled, so it keeps a keyboard's focus,
 * which means a press still arrives while a write is in flight -- and is turned away here, by a
 * ref, because two presses in one tick would both pass a check on state.
 */
export interface GateAnswers {
  /** The gates asked at this level, a level-free gate among them. */
  gates: Read<{ items: MatchRule[] }>;
  reloadGates: () => Promise<void>;
  /** The candidates the form offers: the roster at this level. */
  candidates: CandidateRosterState;
  draft: GateAnswerDraft;
  change: (edit: Partial<GateAnswerDraft>) => void;
  /** What the last press of Save found wrong before anything was sent. */
  problems: DraftProblem[];
  saving: boolean;
  /** The last refusal of a save. Dismissed only: a save is never resent (P1-14). */
  failure: unknown;
  /** The answer the last save stored, until the form is edited again. */
  saved: MatchRuleResult | null;
  save: () => void;
}

export function useGateAnswers(
  level: string,
  /** Told after a save, so everything describing the answers re-reads. */
  onAnswered: () => void,
): GateAnswers {
  const gates = useRead(
    useCallback((signal: AbortSignal) => fetchMatchRules(level, { signal }), [level]),
  );
  const rosterState = useCandidateRosterState();

  const candidates = useMemo(
    () => ({
      ...rosterState,
      roster: rosterState.roster.filter((candidate) => candidate.level === level),
    }),
    [rosterState, level],
  );

  const [draft, setDraft] = useState<GateAnswerDraft>(emptyDraft);
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [saved, setSaved] = useState<MatchRuleResult | null>(null);
  const inFlight = useRef(false);

  function save(): void {
    if (inFlight.current) return;
    const reading = readDraft(draft);
    if (!reading.ok) {
      setProblems(reading.problems);
      return;
    }
    inFlight.current = true;
    setProblems([]);
    setFailure(null);
    setSaving(true);
    void putMatchRuleResult(reading.matchRule, reading.candidate, reading.input)
      .then((stored) => {
        setSaved(stored);
        setDraft(emptyDraft());
        onAnswered();
      })
      .catch((error: unknown) => setFailure(error))
      .finally(() => {
        inFlight.current = false;
        setSaving(false);
      });
  }

  return {
    gates: gates.read.state === "idle" ? PENDING : gates.read,
    reloadGates: gates.reload,
    candidates,
    draft,
    change: (edit) => {
      setDraft((current) => ({ ...current, ...edit }));
      setSaved(null);
    },
    problems,
    saving,
    failure,
    saved,
    save,
  };
}

const PENDING: Read<never> = { state: "pending" };
