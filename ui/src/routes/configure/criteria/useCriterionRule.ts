import { useEffect, useRef, useState } from "react";
import type { CriterionRule, Criterion } from "../../../api/endpoints";
import {
  anEmptyAnchor,
  draftFrom,
  ruleFrom,
  type AnchorDraft,
  type RuleDraft,
} from "./criterionForm";

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
  /** Whether anything has been typed that is not already stored. */
  changed: boolean;
  set: (field: keyof RuleDraft, value: string | boolean) => void;
  setAnchor: (index: number, field: keyof AnchorDraft, value: string) => void;
  addAnchor: () => void;
  removeAnchor: (index: number) => void;
  /** Parse and send, or report every problem and send nothing. */
  submit: () => void;
  /** Throw the draft away and go back to what is stored. */
  revert: () => void;
}

export function useCriterionRule(
  criterion: Criterion,
  saving: boolean,
  onSave: (attribute: string, rule: CriterionRule) => void,
): RuleForm {
  const stored = draftFrom(criterion);
  const asJson = JSON.stringify(stored);

  const [draft, setDraft] = useState<RuleDraft>(stored);
  const [problems, setProblems] = useState<string[]>([]);

  // The stored rule can change without this row having been edited -- another panel's save,
  // a reload, a different criteria set -- so the draft follows it.
  useEffect(() => setDraft(JSON.parse(asJson) as RuleDraft), [asJson]);

  // **A refused change leaves the stored rule where it was, so the fields go back to it once
  // the attempt is over** (P55) -- which this file's header promised and only half did: it
  // cleared the problems and left the rejected draft on screen, so the Goal select read
  // `target_range` while the rule being scored was still `minimise`. The rule a reader sees is
  // the one they take for the rule doing the work, which is the argument the weight input
  // beside this one already makes (`CriteriaPanel.tsx`).
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !saving) {
      setProblems([]);
      setDraft(JSON.parse(asJson) as RuleDraft);
    }
    wasSaving.current = saving;
  }, [saving, asJson]);

  return {
    draft,
    problems,
    changed: JSON.stringify(draft) !== asJson,
    set: (field, value) =>
      setDraft((current) => ({ ...current, [field]: value })),
    setAnchor: (index, field, value) =>
      setDraft((current) => ({
        ...current,
        anchors: current.anchors.map((anchor, at) =>
          at === index ? { ...anchor, [field]: value } : anchor,
        ),
      })),
    addAnchor: () =>
      setDraft((current) => ({
        ...current,
        anchors: [...current.anchors, anEmptyAnchor()],
      })),
    removeAnchor: (index) =>
      setDraft((current) => ({
        ...current,
        anchors: current.anchors.filter((_, at) => at !== index),
      })),
    submit: () => {
      const parsed = ruleFrom(draft);
      setProblems(parsed.problems);
      if (parsed.rule !== null) onSave(criterion.attribute, parsed.rule);
    },
    revert: () => {
      setDraft(JSON.parse(asJson) as RuleDraft);
      setProblems([]);
    },
  };
}
