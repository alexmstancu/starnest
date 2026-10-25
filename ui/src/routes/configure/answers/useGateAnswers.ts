import { useCallback, useMemo, useRef, useState } from "react";
import {
  fetchMatchRuleResults,
  fetchMatchRules,
  putMatchRuleResult,
  type MatchRule,
  type MatchRuleResult,
} from "../../../api/endpoints";
import type { Read } from "../../../api/read";
import type { CandidateRosterState } from "../../../api/useCandidateNames";
import { useCandidateRosterState } from "../../../api/useCandidateRoster";
import { useRankingInputsVersion } from "../../../api/rankingInputs";
import { useRead } from "../../../api/useRead";
import {
  emptyDraft,
  readDraft,
  type DraftProblem,
  type GateAnswerDraft,
} from "./gateAnswerForm";

/**
 * The gate answers a person recorded at one level, and the form that records, corrects or
 * rules out one (`reqs.md` 3.7, 8.2; UI-29, BE-36).
 *
 * **Keyed by level, never by set** (D4): an answer is objective and belongs to no criteria set,
 * so switching sets keeps a half-typed answer, and a set that failed to read hides nothing here.
 *
 * **One write at a time** (NEW-44). Save is held, not disabled, so it keeps a keyboard's focus,
 * which means a press still arrives while a write is in flight -- and is turned away here, by a
 * ref, because two presses in one tick would both pass a check on state.
 */
export interface GateAnswers {
  /** The answers' read; the table draws it, kept on screen while it is read again. */
  read: Read<{ items: MatchRuleResult[] }>;
  /** What a person recorded about candidates at this level. Proposals are the other panel's. */
  recorded: MatchRuleResult[];
  /**
   * The list on screen predates the last write, so a newer one is on its way (NEW-45). A
   * Change from an outdated row would correct an answer that is no longer the stored one.
   */
  stale: boolean;
  /** The gates asked at this level, a level-free gate among them. */
  gates: Read<{ items: MatchRule[] }>;
  reloadGates: () => Promise<void>;
  /** The candidates the form offers: the roster at this level. */
  candidates: CandidateRosterState;
  draft: GateAnswerDraft;
  change: (edit: Partial<GateAnswerDraft>) => void;
  /** Prefills the form: a stored answer to correct, or a proposal to take. */
  load: (draft: GateAnswerDraft) => void;
  /** What the last press of Save found wrong before anything was sent. */
  problems: DraftProblem[];
  saving: boolean;
  /** The last refusal of a save. Dismissed only: a save is never resent (P1-14). */
  failure: unknown;
  /** The answer the last save stored, until the form is edited again. */
  saved: MatchRuleResult | null;
  save: () => void;
  reload: () => Promise<void>;
}

export function useGateAnswers(
  level: string,
  /** Moves whenever any panel writes an answer, so this list is read again with the rest. */
  answersFreshness: number,
  /** Told after a save, so everything describing the answers re-reads. */
  onAnswered: () => void,
): GateAnswers {
  // Read again when the household is saved too: a citizenship change is what flags an answer
  // for a re-check (Q239), and both only ever grow, so their sum moves with either.
  const inputs = useRankingInputsVersion();
  const answers = useRead(
    useCallback((signal: AbortSignal) => fetchMatchRuleResults({ signal }), []),
    { freshness: answersFreshness + inputs },
  );
  const read = answers.read.state === "idle" ? PENDING : answers.read;
  const gates = useRead(
    useCallback((signal: AbortSignal) => fetchMatchRules(level, { signal }), [level]),
  );
  const rosterState = useCandidateRosterState();

  const recorded = useMemo(
    () =>
      atLevel(read.state === "ready" ? read.data.items : [], rosterState.roster, level).filter(
        (answer) => answer.is_proposal !== true,
      ),
    [read, rosterState.roster, level],
  );
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

  const load = useCallback((next: GateAnswerDraft) => {
    setDraft(next);
    setProblems([]);
    setSaved(null);
  }, []);

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
    read,
    recorded,
    stale: read.state === "ready" && read.refresh !== "idle",
    gates: gates.read.state === "idle" ? PENDING : gates.read,
    reloadGates: gates.reload,
    candidates,
    draft,
    change: (edit) => {
      setDraft((current) => ({ ...current, ...edit }));
      setSaved(null);
    },
    load,
    problems,
    saving,
    failure,
    saved,
    save,
    reload: answers.reload,
  };
}

const PENDING: Read<never> = { state: "pending" };

/**
 * The answers about candidates at this level. A candidate's level is the roster's to say --
 * never read off its id -- and **one the roster does not place is kept**, so a roster that
 * failed to load hides nothing.
 */
function atLevel(
  answers: readonly MatchRuleResult[],
  roster: readonly { id: string; level: string }[],
  level: string,
): MatchRuleResult[] {
  const levelOf = new Map(roster.map((candidate) => [candidate.id, candidate.level]));
  return answers.filter((answer) => {
    const placed = levelOf.get(answer.candidate);
    return placed === undefined || placed === level;
  });
}
