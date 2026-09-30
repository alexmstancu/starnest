/**
 * What the hand-entry form does: hold what is being typed, and send it once.
 *
 * **Markup and behaviour live in different files** (`CLAUDE.md`). The panel renders; the draft,
 * the submit and what came back are here, and the text-to-request conversion is in
 * `manualEntry.ts`, which has no React in it at all.
 *
 * **One figure at a time, and the form clears on success.** A form that kept what it had just
 * stored would invite a second identical entry, which the store would accept -- values are never
 * overwritten, so a duplicate is a second row the active-value rule then has to choose between
 * on nothing but its retrieval date.
 */

import { useCallback, useState } from "react";
import { enterValueManually, type StoredValue } from "../../api/endpoints";
import {
  buildManualValue,
  NOTHING_TYPED,
  type ManualDraft,
  type ManualKind,
} from "./manualEntry";

export interface ManualEntryState {
  draft: ManualDraft;
  change: (field: keyof ManualDraft, value: string) => void;
  /** Why there is nothing to send yet. Empty until a submit has been attempted. */
  problems: readonly string[];
  saving: boolean;
  /** The value the server stored, so the panel can say what it wrote rather than "done". */
  saved: StoredValue | null;
  /** The server's refusal, which is the authority when it disagrees with the form. */
  failure: unknown;
  submit: () => void;
}

export function useManualEntry(
  attribute: string,
  kind: ManualKind,
  onStored?: () => void,
): ManualEntryState {
  const [draft, setDraft] = useState<ManualDraft>(NOTHING_TYPED);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<StoredValue | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const change = useCallback((field: keyof ManualDraft, value: string) => {
    // **Anything typed clears the last outcome.** Leaving a success banner above a form being
    // filled again would have it describe a figure that is no longer what is on screen.
    setSaved(null);
    setFailure(null);
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const submit = useCallback(() => {
    // The retrieval date is *now* for a hand-typed figure: it is when this application learned
    // the value. What period the figure describes is a different question, and the form asks it.
    const built = buildManualValue(attribute, kind, draft, new Date().toISOString());
    setProblems(built.problems);
    if (built.body === null) return;

    setSaving(true);
    setFailure(null);
    void enterValueManually(built.body)
      .then((stored) => {
        setSaved(stored);
        setDraft(NOTHING_TYPED);
        setProblems([]);
        onStored?.();
      })
      .catch((error: unknown) => setFailure(error))
      .finally(() => setSaving(false));
  }, [attribute, kind, draft, onStored]);

  return { draft, change, problems, saving, saved, failure, submit };
}
