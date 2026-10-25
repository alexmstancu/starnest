import { useCallback, useState } from "react";
import { fetchAttributes, type RunPair } from "../../api/endpoints";
import type { Read } from "../../api/read";
import { useCandidateRosterState } from "../../api/useCandidateNames";
import { usePillarNames, usePillarOrder } from "../../api/usePillarNames";
import { useRead } from "../../api/useRead";
import { type PickCatalog, type PickKind, type PickOption, optionsFor, pairsPicked } from "./scopePicker";

export interface ScopePickerState {
  kind: PickKind;
  picked: string;
  /** The level's candidates and attributes, read; what can be picked is drawn from them. */
  catalog: Read<PickCatalog>;
  reload: () => void;
  options: PickOption[];
  pairs: RunPair[];
  choose: (kind: PickKind) => void;
  pick: (value: string) => void;
}

/**
 * What the picker does (PL-125): choose a kind, then one of it, and say which pairs that is.
 * **Any change to the pick puts away a start armed for the previous one** (`onChange`), as a
 * change of selection does in the remedy cards (PL-116).
 */
export function useScopePicker(level: string, onChange: () => void): ScopePickerState {
  const [kind, setKind] = useState<PickKind>("candidate");
  const [picks, setPicks] = useState({ level, picked: "" });
  const picked = picks.level === level ? picks.picked : "";
  const roster = useCandidateRosterState();
  const pillars = { names: usePillarNames(), order: usePillarOrder() };
  const attributes = useRead(
    useCallback(
      async (signal: AbortSignal) => (await fetchAttributes(level, { signal })).items,
      [level],
    ),
  );
  const catalog: Read<PickCatalog> =
    attributes.read.state === "idle"
      ? { state: "pending" }
      : attributes.read.state !== "ready"
        ? attributes.read
        : roster.status === "error"
        ? { state: "failed", error: roster.error }
        : roster.status === "loading"
          ? { state: "pending" }
          : {
              ...attributes.read,
              data: {
                candidates: roster.roster.filter((candidate) => candidate.level === level),
                attributes: attributes.read.data,
              },
            };
  const ready = catalog.state === "ready" ? catalog.data : null;
  return {
    kind,
    picked,
    catalog,
    reload: () => {
      void attributes.reload();
      if (roster.status === "error") roster.reload();
    },
    options: ready === null ? [] : optionsFor(kind, ready, pillars),
    pairs: ready === null ? [] : pairsPicked(kind, picked, ready),
    choose: (next) => {
      onChange();
      setKind(next);
      setPicks({ level, picked: "" });
    },
    pick: (value) => {
      onChange();
      setPicks({ level, picked: value });
    },
  };
}
