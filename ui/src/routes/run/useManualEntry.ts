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
 * on nothing but its retrieval date. What was typed while it was being stored is the next
 * figure, not this one, so that stays.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { enterValueManually, type StoredValue } from "../../api/endpoints";
import {
  buildManualValue,
  NOTHING_TYPED,
  type ManualDraft,
  type ManualKind,
  refusedFields,
  type Problem,
} from "./manualEntry";

export interface ManualEntryState {
  draft: ManualDraft;
  change: (field: keyof ManualDraft, value: string) => void;
  /**
   * Why there is nothing to send yet, and what the server's last refusal said about a field.
   * Empty until a submit has been attempted.
   */
  problems: readonly Problem[];
  /**
   * The retrieval date the next figure will carry, shown before it is sent. **Stamped once,
   * when the form opens and again after each store**, so what is shown is what is sent -- a
   * stamp taken at submit could differ from the one on screen across midnight.
   */
  retrievedAt: string;
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
  onStored: () => void = () => undefined,
): ManualEntryState {
  const [draft, setDraft] = useState<ManualDraft>(NOTHING_TYPED);
  const [problems, setProblems] = useState<readonly Problem[]>([]);
  const [retrievedAt, setRetrievedAt] = useState(() => new Date().toISOString());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<StoredValue | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // A ref, not `saving`: state takes effect at the next render, so two calls before it would
  // both read "not saving" and store the figure twice (NEW-29).
  const inFlight = useRef(false);
  // **Bumped by every keystroke** (UI-06). A figure that is stored clears the form only if
  // nothing was typed while it was in flight: what is on screen is the next figure then.
  const revision = useRef(0);

  const change = useCallback((field: keyof ManualDraft, value: string) => {
    revision.current += 1;
    // **Anything typed clears the last outcome.** Leaving a success banner above a form being
    // filled again would have it describe a figure that is no longer what is on screen.
    setSaved(null);
    setFailure(null);
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const submit = useCallback(() => {
    if (inFlight.current) return;
    // The retrieval date is when this application learned the value, which for typing is the
    // moment of typing. What period the figure describes is a different question.
    const built = buildManualValue(attribute, kind, draft, retrievedAt);
    setProblems(built.problems);
    if (built.body === null) return;

    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    const sentAt = revision.current;
    void enterValueManually(built.body)
      .then((stored) => {
        // Said even over newer typing: it names the figure stored, not what is on screen.
        setSaved(stored);
        onStored();
        setRetrievedAt(new Date().toISOString());
        if (revision.current === sentAt) {
          setDraft(NOTHING_TYPED);
          setProblems([]);
        }
      })
      .catch((error: unknown) => setFailure(error))
      .finally(() => {
        // Released however it ended, so a figure that failed can be sent again.
        inFlight.current = false;
        setSaving(false);
      });
  }, [attribute, kind, draft, retrievedAt, onStored]);

  // The server is the authority when the two disagree: a field it refused is marked as the
  // form's own problems are, until the next keystroke clears the refusal.
  const shown = useMemo(() => [...problems, ...refusedFields(failure)], [problems, failure]);

  return { draft, change, problems: shown, retrievedAt, saving, saved, failure, submit };
}
