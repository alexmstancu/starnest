import { createContext, useContext } from "react";
import type { Criterion } from "../../api/endpoints";
import type { components } from "../../api/schema";
import type { Answers } from "./useAnswers";
import type { ChangeHistory } from "./useChangeHistory";

type PillarWeight = components["schemas"]["PillarWeight"];

/**
 * **What Configure keeps above the route** (PL-033): the history, its one write in flight, and
 * where a write's answer goes.
 *
 * Held by Configure itself, all three ended with it: a write in flight when the reader went to
 * Rank lost its hold, its entry and its answer, so on return a second write could be sent beside
 * it, the history was empty, and the screen showed what the server no longer held. Mounted
 * above the routes, a write keeps the slot until it settles whichever screen is showing, and
 * Configure opened again shows the hold, its reason and the entry when it lands.
 */
export interface ConfigurationSession {
  history: ChangeHistory;
  pillarAnswers: Answers<PillarWeight[]>;
  criteriaAnswers: Answers<Criterion[]>;
}

export const ConfigurationSessionContext = createContext<ConfigurationSession | null>(null);

export function useConfigurationSession(): ConfigurationSession {
  const session = useContext(ConfigurationSessionContext);
  if (!session) {
    throw new Error("useConfigurationSession must be used inside ConfigurationSessionProvider");
  }
  return session;
}
