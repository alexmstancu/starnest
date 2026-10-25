import { useEffect, useRef, useState } from "react";
import type { CriterionRule, Criterion } from "../../../api/endpoints";
import { useSelection } from "../../../shell/SelectionContext";
import { useDraftSlot } from "../../../shell/SessionProvider";
import { ruleDraftKey } from "../../../shell/sessionState";
import {
  anEmptyAnchor,
  describeAsked,
  draftFrom,
  numberKindFor,
  numberRulesFor,
  parseRuleDraftSlot,
  ruleFrom,
  type AnchorDraft,
  type RuleDraft,
  type RuleNumberRules,
} from "./criterionForm";
import {
  refusalOf,
  withoutMarks,
  type RuleMark,
  type RuleMarks,
  type RuleRefusal,
} from "./ruleRefusal";

/**
 * One criterion's rule, while it is being edited.
 *
 * **The behaviour of the editor lives here and the markup renders it** -- the repo's rule for
 * a React screen (`CLAUDE.md`). What this holds is a *draft*: what has been typed, which is
 * not yet what is stored, and may not even be a rule.
 *
 * **The stored criterion always wins in the end.** A refused change leaves the criterion
 * exactly as it was, so the draft goes back to it once the attempt is over. Leaving the typed
 * rule on screen would have one screen reporting a refusal in one place and showing the rule
 * it refused in another -- and what is in the fields is what a reader takes for the rule being
 * scored.
 */

export interface RuleForm {
  draft: RuleDraft;
  /** Why the draft cannot be sent. Empty when it can. */
  problems: string[];
  /** How each numeric field reads what is typed, from what the attribute measures (PL-024). */
  rules: RuleNumberRules;
  /** The server's last refusal of this rule, until the rule is sent again. */
  refusal: {
    sentences: string[];
    /** The fields it named that have not been edited since, each with its reason. */
    marks: RuleMarks;
    /** What the refused draft asked for, in words; null while it is the draft on screen. */
    asked: string | null;
  } | null;
  /** Put the refused draft back in the fields. Refuses while the rule is being saved. */
  putBack: () => void;
  /** Whether anything has been typed that is not already stored. */
  changed: boolean;
  /** The last save landed and nothing has been typed since (PL-025, UF-054). */
  saved: boolean;
  /** The stored rule changed under an unsaved draft: another save, an undo (C02-S3). */
  staleBase: boolean;
  /**
   * This rule is being saved, so the draft takes no edit until the answer is in (UI-06): it
   * follows the stored rule then, and anything typed meanwhile would be thrown away unsaid.
   */
  saving: boolean;
  /**
   * A write to the set is in flight -- this rule's or another's -- so the draft can be neither
   * sent nor thrown away until it has answered (UI-04). It can still be edited, unless saving.
   */
  held: boolean;
  // The four edits refuse while the rule is being saved.
  set: (field: keyof RuleDraft, value: string | boolean) => void;
  setAnchor: (index: number, field: keyof AnchorDraft, value: string) => void;
  addAnchor: () => void;
  removeAnchor: (index: number) => void;
  /** Parse and send, or report every problem and send nothing. Refuses while held or unchanged. */
  submit: () => void;
  /** Throw the draft away and go back to what is stored. Refuses while held or unchanged. */
  revert: () => void;
}

/** What is in flight that a rule has to wait for. */
export interface RuleWrites {
  /** This rule's own save. */
  saving: boolean;
  /** Any write to the set, which a rule's own save is one of (`CriteriaEditor.busy`). */
  busy: boolean;
}

/**
 * **Every edit refuses itself rather than relying on a disabled control** (NEW-34). A control
 * disabled under the keyboard throws its focus to the page in Chromium, so the fields stay
 * focusable while a write is in flight -- marked as held -- and it is these that ignore them.
 */
export function useCriterionRule(
  criterion: Criterion,
  /** Resolves to the refusal to report, or null when the rule was stored or is no longer shown. */
  onSave: (attribute: string, rule: CriterionRule) => Promise<unknown>,
  { saving, busy }: RuleWrites,
  /** What the attribute measures and what the form calls it, from the catalog. */
  { valueType, title }: { valueType?: string; title: string },
): RuleForm {
  const stored = draftFrom(criterion);
  const asJson = JSON.stringify(stored);
  const kind = numberKindFor(valueType);

  // **The draft lives in the session store, keyed by set and attribute** (PL-025, D8), so
  // closing the pillar or switching sets and back loses nothing. No draft means the stored
  // rule, so the form follows the stored rule while nothing is typed -- and an unsaved draft
  // is kept, and said to be stale, when the stored rule changes under it (C02-S3).
  const { criteriaSetId } = useSelection();
  const [slot, setSlot] = useDraftSlot(
    ruleDraftKey(criteriaSetId ?? "", criterion.attribute),
    parseRuleDraftSlot,
  );
  const draft = slot?.draft ?? stored;
  const setDraft = (change: (current: RuleDraft) => RuleDraft) =>
    setSlot((current) => {
      const next = change(current?.draft ?? stored);
      return JSON.stringify(next) === asJson
        ? null
        : { draft: next, base: current?.base ?? stored, unsaved: true };
    });
  const [problems, setProblems] = useState<string[]>([]);
  // Not cleared by P55's restore below: the refusal can land after it, and it is what the
  // restore leaves the reader to act on.
  const [refused, setRefused] = useState<RuleRefusal | null>(null);
  const [saved, setSaved] = useState(false);
  // Whether the save asked for was taken: a rule's save is not sent while another write holds
  // the set, and then it answers as a stored one does.
  const sent = useRef(false);

  // **A refused change leaves the stored rule where it was, so the fields go back to it once
  // the attempt is over** (P55) -- which this file's header promised and only half did: it
  // cleared the problems and left the rejected draft on screen, so the Goal select read
  // `target_range` while the rule being scored was still `minimise`. The rule a reader sees is
  // the one they take for the rule doing the work, which is the argument the weight input
  // beside this one already makes (`CriteriaPanel.tsx`).
  const wasSaving = useRef(false);
  useEffect(() => {
    if (saving) sent.current = true;
    if (wasSaving.current && !saving) {
      setProblems([]);
      setSlot(null);
    }
    wasSaving.current = saving;
  }, [saving, setSlot]);

  const held = saving || busy;
  /** An edit to the draft, unless the rule is being saved. It answers the marks it names. */
  const edit = (change: (current: RuleDraft) => RuleDraft, answers: readonly RuleMark[]) => {
    if (saving) return;
    setDraft(change);
    setSaved(false);
    setRefused((current) =>
      current === null ? null : { ...current, marks: withoutMarks(current.marks, answers) },
    );
  };

  const changed = JSON.stringify(draft) !== asJson;
  // Typed back to what is stored, a draft is nothing to keep.
  useEffect(() => {
    if (slot !== null && !changed) setSlot(null);
  }, [slot, changed, setSlot]);

  return {
    draft,
    problems,
    rules: numberRulesFor(kind),
    refusal:
      refused === null
        ? null
        : {
            sentences: refused.sentences,
            marks: refused.marks,
            asked:
              JSON.stringify(refused.draft) === JSON.stringify(draft)
                ? null
                : describeAsked(refused.draft),
          },
    putBack: () => {
      if (saving || refused === null) return;
      setDraft(() => refused.draft);
    },
    changed,
    saved,
    staleBase: !saving && slot !== null && changed && JSON.stringify(slot.base) !== asJson,
    saving,
    held,
    set: (field, value) =>
      edit((current) => ({ ...current, [field]: value }), MARKS_OF_FIELD[field] ?? []),
    setAnchor: (index, field, value) =>
      edit(
        (current) => ({
          ...current,
          anchors: current.anchors.map((anchor, at) =>
            at === index ? { ...anchor, [field]: value } : anchor,
          ),
        }),
        ["anchors"],
      ),
    addAnchor: () =>
      edit(
        (current) => ({
          ...current,
          anchors: [...current.anchors, anEmptyAnchor()],
        }),
        ["anchors"],
      ),
    removeAnchor: (index) =>
      edit(
        (current) => ({
          ...current,
          anchors: current.anchors.filter((_, at) => at !== index),
        }),
        ["anchors"],
      ),
    submit: () => {
      // Unchanged is refused here, not by a disabled button: Enter in a field submits the form
      // whatever the button says, and an unchanged rule is nothing to send (UIC-G1).
      if (held || !changed) return;
      const parsed = ruleFrom(draft, kind);
      setProblems(parsed.problems);
      if (parsed.rule === null) return;
      const asked = draft;
      setRefused(null);
      setSaved(false);
      sent.current = false;
      void onSave(criterion.attribute, parsed.rule).then((error) => {
        const answered = (error !== null && error !== undefined) || sent.current;
        // **Through the store, so it lands though the row has gone** -- a pillar closed while
        // the save was in flight left the draft asking before every reload. Stored or refused,
        // the stored rule is what the fields show now (P55); a draft typed since is kept.
        if (answered) {
          setSlot((current) =>
            current !== null && JSON.stringify(current.draft) === JSON.stringify(asked)
              ? null
              : current,
          );
        }
        if (error !== null && error !== undefined) {
          setRefused(refusalOf(error, asked, { attribute: criterion.attribute, title }));
        } else if (sent.current) {
          setSaved(true);
        }
      });
    },
    revert: () => {
      if (held || !changed) return;
      setSlot(null);
      setProblems([]);
    },
  };
}

/** The mark an edit to each draft field answers. */
const MARKS_OF_FIELD: Partial<Record<keyof RuleDraft, readonly RuleMark[]>> = {
  goal: ["goal"],
  normalisation_method: ["normalisation_method"],
  blocks_if_missing: ["blocks_if_missing"],
  target_range_min: ["target_range_min"],
  target_range_max: ["target_range_max"],
  zero_score_below: ["zero_score_below"],
  zero_score_above: ["zero_score_above"],
  threshold_min: ["threshold_min"],
  threshold_max: ["threshold_max"],
};
