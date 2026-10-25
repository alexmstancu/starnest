import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSelection } from "./SelectionContext";
import { readSlices, writeSlices, type StoredSlice, type StoredSlices } from "./sessionState";

/**
 * The screens' view state, kept above the routes (PL-016, `map-C01` M4).
 *
 * A screen unmounts when its tab is left and remounts on a set switch, so state held inside it
 * was lost each time: Compare's picks, Rank's open rows. Here each screen keeps a named slice
 * that outlives it, mirrored to this tab's `sessionStorage` so a reload keeps it too.
 *
 * **Generic on purpose**: the store knows keys and levels, never what a slice means. Each screen
 * brings its own key, type and parser, and checks its ids against its own roster.
 *
 * **A slice scoped to the level is reset when the level changes**, because a candidate id means
 * nothing at another level (P53, P54). Each is also stored with the level it was written at, so
 * it is never read at another one even for the render before the reset lands.
 */

interface SessionStore {
  slices: StoredSlices;
  levelId: string | null;
  update: (key: string, next: (slice: StoredSlice | undefined) => StoredSlice) => void;
  markUnpersisted: (key: string) => void;
}

const SessionContext = createContext<SessionStore | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { levelId } = useSelection();
  const [slices, setSlices] = useState<StoredSlices>(readSlices);
  const unpersisted = useRef(new Set<string>());

  // From one level to another, not from none to the first: a level arriving is not a change.
  const previousLevel = useRef(levelId);
  useEffect(() => {
    const previous = previousLevel.current;
    previousLevel.current = levelId;
    if (previous === null || previous === levelId) return;
    setSlices((current) => withoutLevelScoped(current));
  }, [levelId]);

  useEffect(() => {
    const persisted = Object.fromEntries(
      Object.entries(slices).filter(([key]) => !unpersisted.current.has(key)),
    );
    writeSlices(persisted);
  }, [slices]);

  const update = useCallback(
    (key: string, next: (slice: StoredSlice | undefined) => StoredSlice) => {
      setSlices((current) => ({ ...current, [key]: next(current[key]) }));
    },
    [],
  );
  const markUnpersisted = useCallback((key: string) => {
    unpersisted.current.add(key);
  }, []);

  const store = useMemo(
    () => ({ slices, levelId, update, markUnpersisted }),
    [slices, levelId, update, markUnpersisted],
  );
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

function withoutLevelScoped(slices: StoredSlices): StoredSlices {
  return Object.fromEntries(Object.entries(slices).filter(([, slice]) => slice.level === null));
}

export interface SessionStateOptions {
  /** `level` (the default) resets on a level change; `session` holds across levels. */
  scope?: "level" | "session";
  /** False keeps the slice in memory only, never in storage. */
  persist?: boolean;
}

/**
 * `useState`, kept above the routes under `key`.
 *
 * `parse` validates what was stored -- possibly by an older build, possibly corrupt -- and
 * answers undefined for anything it does not recognise, which reads as `initial`. **Pass a
 * module-level `parse`**: it is a dependency, so a new one each render re-reads the slice.
 * **Stable identities**: the value changes only when its slice is written, so it is safe in a
 * dependency array, and the setter never changes for one key at one level.
 */
export function useSessionState<T>(
  key: string,
  initial: T,
  parse: (stored: unknown) => T | undefined,
  { scope = "level", persist = true }: SessionStateOptions = {},
): readonly [T, (next: T | ((current: T) => T)) => void] {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSessionState must be used inside SessionProvider");
  const { slices, levelId, update, markUnpersisted } = store;
  useEffect(() => {
    if (!persist) markUnpersisted(key);
  }, [persist, key, markUnpersisted]);

  const [first] = useState(initial);
  const owner = scope === "level" ? levelId : null;
  const slice = slices[key];
  const value = useMemo(() => valueOf(slice, owner, parse, first), [slice, owner, parse, first]);

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      update(key, (current) => {
        const resolved =
          typeof next === "function"
            ? (next as (current: T) => T)(valueOf(current, owner, parse, first))
            : next;
        return { value: resolved, level: owner };
      });
    },
    [key, owner, parse, first, update],
  );

  return [value, setValue] as const;
}

function valueOf<T>(
  slice: StoredSlice | undefined,
  owner: string | null,
  parse: (stored: unknown) => T | undefined,
  initial: T,
): T {
  if (slice?.level !== owner) return initial;
  return parse(slice.value) ?? initial;
}
