/**
 * What the reader was looking at, kept where it outlives a screen (PL-016, PL-017, P1-19).
 *
 * **Pure: read, validate, write.** Nothing here knows React, so the selection -- which sits
 * above the session store -- persists through the same helpers without depending on it.
 *
 * Two places, with different lives:
 * - **This tab's `sessionStorage`** survives a reload and belongs to one tab, so two tabs never
 *   fight over one value. It holds the screens' slices and the tab's selection.
 * - **`localStorage`** holds the selection last used in any tab, which seeds a new tab or a
 *   restart.
 *
 * **Every key is versioned and never names the product** (CLAUDE.md): a shape that changes gets
 * a new key, and an old or corrupt entry is ignored rather than thrown.
 */

export const SLICES_KEY = "session/v1";
export const SELECTION_KEY = "selection/v1";

export type StorageKind = "session" | "local";

/** A browser store, or null where it is unavailable -- then everything lives in memory only. */
export function storageOf(kind: StorageKind): Storage | null {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(kind: StorageKind, key: string): unknown {
  try {
    const text = storageOf(kind)?.getItem(key);
    return text == null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function writeJson(kind: StorageKind, key: string, value: unknown): void {
  try {
    storageOf(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Full or refused: the value still lives in memory for this page.
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One screen's slice as stored: its value, and the level it belongs to when it is about one
 * level's candidates (null for a slice that holds across levels).
 */
export interface StoredSlice {
  value: unknown;
  level: string | null;
}

export type StoredSlices = Readonly<Record<string, StoredSlice>>;

/** This tab's slices; anything unreadable is dropped entry by entry, never thrown. */
export function readSlices(): StoredSlices {
  const stored = readJson("session", SLICES_KEY);
  if (!isRecord(stored)) return {};
  const slices: Record<string, StoredSlice> = {};
  for (const [key, entry] of Object.entries(stored)) {
    if (!isRecord(entry) || !("value" in entry)) continue;
    const level = typeof entry["level"] === "string" ? entry["level"] : null;
    slices[key] = { value: entry["value"], level };
  }
  return slices;
}

export function writeSlices(slices: StoredSlices): void {
  writeJson("session", SLICES_KEY, slices);
}

/**
 * A form's draft lives in a slice under this prefix (PL-025, D8): null once nothing typed
 * differs from what is stored, and marked `unsaved` while what it says differs -- text such as
 * `72000.0` can differ from the stored 72000 and still say the same.
 */
export const DRAFT_PREFIX = "draft:";

/** Whether any form holds something not yet saved: what a reload or a closed tab would lose. */
export function hasUnsavedDraft(slices: StoredSlices): boolean {
  return Object.entries(slices).some(
    ([key, slice]) =>
      key.startsWith(DRAFT_PREFIX) && isRecord(slice.value) && slice.value["unsaved"] === true,
  );
}

/**
 * A criteria set as remembered: its name as well as its id, so a set that has gone can still be
 * named when the selection falls back from it.
 */
export interface RememberedSet {
  id: string;
  name: string;
}

export interface StoredSelection {
  criteriaSet: RememberedSet | null;
  levelId: string | null;
}

export function parseSelection(stored: unknown): StoredSelection | undefined {
  if (!isRecord(stored)) return undefined;
  const set = stored["criteriaSet"];
  const criteriaSet =
    isRecord(set) && typeof set["id"] === "string" && typeof set["name"] === "string"
      ? { id: set["id"], name: set["name"] }
      : null;
  const levelId = typeof stored["levelId"] === "string" ? stored["levelId"] : null;
  if (criteriaSet === null && levelId === null) return undefined;
  return { criteriaSet, levelId };
}

/** This tab's own selection, which a reload keeps. */
export function readTabSelection(): StoredSelection | undefined {
  return parseSelection(readJson("session", SELECTION_KEY));
}

/** The selection last chosen in any tab, which a new tab opens on. */
export function readLastUsedSelection(): StoredSelection | undefined {
  return parseSelection(readJson("local", SELECTION_KEY));
}

/** Records the tab's selection; `lastUsed` also makes it the one a new tab opens on. */
export function writeSelection(selection: StoredSelection, { lastUsed }: { lastUsed: boolean }): void {
  writeJson("session", SELECTION_KEY, selection);
  if (lastUsed) writeJson("local", SELECTION_KEY, selection);
}

/** Forgets everything this module stores, in this tab and across tabs. For tests. */
export function forgetStoredSession(): void {
  for (const kind of ["session", "local"] as const) {
    try {
      storageOf(kind)?.removeItem(SLICES_KEY);
      storageOf(kind)?.removeItem(SELECTION_KEY);
    } catch {
      // Unavailable storage holds nothing to forget.
    }
  }
}
