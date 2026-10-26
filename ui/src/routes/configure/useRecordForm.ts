/**
 * One record form's state: the household's and the settings' (PL-025, D8), which had drifted
 * apart as two near-copies.
 *
 * **The draft lives in the session store**, not here, so it outlives this hook: changing tab
 * loses nothing, and a save answered after the form has gone still marks it saved. While
 * nothing differs from what is stored there is no draft, and the form follows the record.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fieldProblems } from "../../api/fieldProblems";
import { noteRankingInputsChanged } from "../../api/rankingInputs";
import type { NumberRule } from "../../format/typedNumber";
import { isRecord } from "../../shell/sessionState";
import { useDraftSlot } from "../../shell/SessionProvider";
import { describeRecordChange, undoUnsets, type RecordWording } from "./recordChange";
import { pendingEntry, settled, settledUndo, UnconfirmedWrite } from "./unknownOutcome";
import { sameDrafts, saveStatusOf, type SaveStatus } from "./saveState";
import { useConfigurationSession } from "./useConfigurationSession";

/** A form as text, field by field. */
type Draft<D> = Record<keyof D, string>;

/** What was typed, the stored record it was typed against, and whether they say different things. */
interface DraftSlot<D extends Draft<D>> {
  draft: D;
  base: D;
  unsaved: boolean;
}

export interface RecordFormSpec<R, D extends Draft<D>> {
  /** The draft's slot in the session store. */
  key: string;
  /** The record as last read. */
  stored: R;
  draftOf: (record: R) => D;
  /** How each number field reads, so `72000.0` is the stored 72000. */
  rules: Partial<Record<keyof D, NumberRule>>;
  /** Fields holding text the form cannot send. Nothing is sent while there are any. */
  invalid: (draft: D) => readonly (keyof D)[];
  /** Each field's range in words, for a server refusal whose kind the form does not know. */
  ranges: Readonly<Record<string, string>>;
  /** The record a draft describes, ready to send. Only for a draft with nothing invalid. */
  recordOf: (draft: D) => R;
  /** Stores a record, and answers with the record stored. */
  write: (record: R) => Promise<R>;
  /** Reads the record as stored: what a save whose answer was lost is read back by (PL-033). */
  read: (signal: AbortSignal) => Promise<R>;
  /** How a save is listed in Recent changes (PL-138): its stage, its words, what undoing stops. */
  recorded: {
    stage: string;
    wording: RecordWording<D>;
    /** What each field left unset stops, so an undo that would unset it says so first (D37). */
    consequences?: Readonly<Partial<Record<keyof D, string>>>;
  };
}

export interface RecordForm<R, D extends Draft<D>> {
  draft: D;
  /** The record as stored: as read, or as the last save here answered. */
  stored: R;
  invalid: readonly (keyof D)[];
  /** A refusal no field carries. One that names fields is said on them instead. */
  failure: unknown;
  /** The server's refusal of each field it named, in words, until that field is edited. */
  problems: Partial<Record<keyof D, string>>;
  status: SaveStatus;
  /** What is shown differs, by what it reads, from what is stored. */
  dirty: boolean;
  /** A save is in flight, so another may not start. */
  saving: boolean;
  /**
   * A save may not start now: this form's, or any other Configure write or undo, is in flight,
   * or this form's last save is unconfirmed and has to be checked first.
   */
  held: boolean;
  /** The stored record changed under an unsaved draft: an undo, another tab. */
  staleBase: boolean;
  change: (field: keyof D, value: string) => void;
  /** Throw the draft away and show what is stored. Refuses while saving or with nothing to throw. */
  discard: () => void;
  save: (event: FormEvent) => void;
}

/**
 * **The save answers with the record, so nothing is re-fetched after it**, and the draft is
 * rebuilt from what came back -- unless something was typed while it was in flight: that is
 * newer than what was stored, and stays, and the save is not called "Saved." (UI-06).
 */
export function useRecordForm<R, D extends Draft<D>>(spec: RecordFormSpec<R, D>): RecordForm<R, D> {
  const { key, draftOf, rules, recorded } = spec;
  const { history, noteRecordsChanged } = useConfigurationSession();
  const [slot, setSlot] = useDraftSlot<DraftSlot<D>>(key, parseDraftSlot as ParseSlot<D>);
  // The last save's answer, for as long as the read it was made against is the one shown.
  const [answered, setAnswered] = useState<{ to: R; record: R } | null>(null);
  const stored = answered !== null && answered.to === spec.stored ? answered.record : spec.stored;
  const storedDraft = draftOf(stored);
  const draft = slot?.draft ?? storedDraft;
  const dirty = !sameDrafts(draft, storedDraft, rules);
  const staleBase = slot !== null && dirty && !sameDrafts(slot.base, storedDraft, rules);

  const [failure, setFailure] = useState<unknown>(null);
  const [problems, setProblems] = useState<Partial<Record<keyof D, string>>>({});
  const [savedSinceEdit, setSavedSinceEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  // Refs, because both are read when a save starts and when it ends, and neither is drawn.
  const inFlight = useRef(false);
  // **Bumped by every keystroke** (UI-06).
  const revision = useRef(0);
  const invalid = spec.invalid(draft);
  // **A save nobody can confirm holds the next** (PL-033): changed again meanwhile, the record
  // could no longer say whether the first ever landed. Read from the history, so it holds
  // whichever form is mounted when it is checked.
  const unconfirmed = history.changes.some(
    (change) => change.target === key && change.unconfirmed !== undefined,
  );

  // A record read again can make the draft say what is stored, or no longer say it.
  useEffect(() => {
    if (slot !== null && slot.unsaved !== dirty) setSlot({ ...slot, unsaved: dirty });
  }, [slot, dirty, setSlot]);

  function change(field: keyof D, value: string): void {
    revision.current += 1;
    setSlot((current) => {
      const from = current ?? { draft: storedDraft, base: storedDraft };
      const next = { ...from.draft, [field]: value };
      // Text the reader typed is never rewritten: `72000.0` stays, saying the stored 72000.
      if (sameDrafts(next, storedDraft, {})) return null;
      return { draft: next, base: from.base, unsaved: !sameDrafts(next, storedDraft, rules) };
    });
    setProblems((current) => {
      const { [field]: _answered, ...rest } = current;
      return rest as Partial<Record<keyof D, string>>;
    });
    setSavedSinceEdit(false);
  }

  async function send(): Promise<void> {
    if (inFlight.current || invalid.length > 0 || unconfirmed) return;
    // **Configure's one write in flight** (PL-138): a save waits for any other write or undo.
    const done = history.begin();
    if (done === null) return;
    inFlight.current = true;
    const sentAt = revision.current;
    const sent = draft;
    const against = spec.stored;
    const was = stored;
    setSaving(true);
    setFailure(null);
    setProblems({});
    setSavedSinceEdit(false);
    // **An answer lost on the way is read back** (PL-033): the record as stored saying what was
    // sent means it was stored, and one that cannot be read leaves the save unconfirmed.
    const wanted = draftOf(spec.recordOf(sent));
    const entry = {
      target: key,
      stage: recorded.stage,
      describe: ({ before, after }: { before: unknown; after: unknown }) =>
        describeRecordChange(draftOf(before as R), draftOf(after as R), recorded.wording),
      before: was,
      // Read back as the save is (P105): an undo whose answer never came is unconfirmed.
      reverse: (back: unknown) => {
        const restored = draftOf(back as R);
        return settledUndo(
          () => spec.write(back as R),
          async (signal) => {
            const stored = await spec.read(signal);
            return sameDrafts(draftOf(stored), restored, rules) ? stored : null;
          },
          () => {
            noteRankingInputsChanged();
            noteRecordsChanged();
          },
        );
      },
    };
    try {
      const record = await settled(
        () => spec.write(spec.recordOf(sent)),
        async (signal) => {
          const stored = await spec.read(signal);
          return sameDrafts(draftOf(stored), wanted, rules) ? stored : null;
        },
      );
      noteRankingInputsChanged();
      const recordDraft = draftOf(record);
      // **Listed with the request that reverses it**: the record as it was, sent again, and the
      // form read again wherever it is shown then.
      history.note({
        ...entry,
        after: record,
        caveat: undoUnsets(
          draftOf(was),
          recordDraft,
          recorded.wording.labels,
          recorded.consequences ?? NO_CONSEQUENCES,
        ),
      });
      setAnswered({ to: against, record });
      // Through the store, so it lands even when the form has gone meanwhile (T25-10).
      setSlot((current) =>
        current === null || sameDrafts(current.draft, sent, {})
          ? null
          : {
              draft: current.draft,
              base: recordDraft,
              unsaved: !sameDrafts(current.draft, recordDraft, rules),
            },
      );
      if (revision.current === sentAt) setSavedSinceEdit(true);
    } catch (error) {
      // Neither saved nor refused: listed unconfirmed with Check again, and the draft kept.
      // Confirmed, the form reads the record again wherever it is shown then.
      if (error instanceof UnconfirmedWrite) {
        history.note({
          ...entry,
          after: spec.recordOf(sent),
          ...pendingEntry(error, () => {
            noteRankingInputsChanged();
            noteRecordsChanged();
          }),
        });
        return;
      }
      const named = Object.fromEntries(
        [...fieldProblems(error, spec.ranges)].filter(([field]) => field in sent),
      ) as Partial<Record<keyof D, string>>;
      if (Object.keys(named).length > 0) setProblems(named);
      else setFailure(error);
    } finally {
      inFlight.current = false;
      setSaving(false);
      done();
    }
  }

  const refused = failure !== null || Object.keys(problems).length > 0;
  return {
    draft,
    stored,
    invalid,
    failure,
    problems,
    status: saveStatusOf({ saving, refused, dirty, savedSinceEdit, unconfirmed }),
    dirty,
    saving,
    held: saving || history.busy || unconfirmed,
    staleBase,
    change,
    discard: () => {
      if (inFlight.current || !dirty) return;
      revision.current += 1;
      setSlot(null);
      setProblems({});
      setFailure(null);
      setSavedSinceEdit(false);
    },
    save: (event: FormEvent) => {
      event.preventDefault();
      void send();
    },
  };
}

const NO_CONSEQUENCES: Readonly<Partial<Record<never, string>>> = {};

type ParseSlot<D extends Draft<D>> = (stored: unknown) => DraftSlot<D> | undefined;

function parseDraftSlot(stored: unknown): DraftSlot<Record<string, string>> | undefined {
  if (!isRecord(stored) || !isTextRecord(stored["draft"]) || !isTextRecord(stored["base"])) {
    return undefined;
  }
  return { draft: stored["draft"], base: stored["base"], unsaved: stored["unsaved"] === true };
}

function isTextRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
