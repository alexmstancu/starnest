import { useMemo, type ReactNode } from "react";
import type { Criterion } from "../../api/endpoints";
import type { components } from "../../api/schema";
import { useAnswers } from "./useAnswers";
import { useChangeHistory } from "./useChangeHistory";
import { ConfigurationSessionContext } from "./useConfigurationSession";

type PillarWeight = components["schemas"]["PillarWeight"];

/** Holds Configure's session above the routes (PL-033): see `useConfigurationSession.ts`. */
export function ConfigurationSessionProvider({ children }: { children: ReactNode }) {
  const history = useChangeHistory();
  const pillarAnswers = useAnswers<PillarWeight[]>();
  const criteriaAnswers = useAnswers<Criterion[]>();
  const session = useMemo(
    () => ({ history, pillarAnswers, criteriaAnswers }),
    [history, pillarAnswers, criteriaAnswers],
  );
  return (
    <ConfigurationSessionContext.Provider value={session}>
      {children}
    </ConfigurationSessionContext.Provider>
  );
}
