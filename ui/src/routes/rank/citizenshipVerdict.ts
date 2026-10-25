import { DISPLAY_LOCALE, candidateName, matchRuleName } from "../../format/display";

/**
 * A gate the household's citizenships decided, with no recorded answer (Q239, PL-164).
 *
 * **Said from the codes, never from the server's sentence** (P1-07): the gate by its catalog
 * name and the citizenships it read by the roster's, so no id reaches the screen -- and never
 * as though an answer had been recorded, because none was read.
 */
export interface GateFinding {
  match_rule?: string | null;
  citizenships?: readonly string[];
}

/** Whether the household's citizenships decided this finding rather than a recorded answer. */
export function decidedByCitizenship(finding: GateFinding): boolean {
  return finding.match_rule != null && (finding.citizenships ?? []).length > 0;
}

/** "Free movement applies: no citizenship the household holds (United Kingdom) clears it. …" */
export function citizenshipVerdict(
  finding: GateFinding,
  names: { gates: ReadonlyMap<string, string>; candidates: ReadonlyMap<string, string> },
): string {
  const gate = matchRuleName(names.gates, finding.match_rule ?? "");
  const held = new Intl.ListFormat(DISPLAY_LOCALE, { type: "conjunction" }).format(
    (finding.citizenships ?? []).map((id) => candidateName(names.candidates, id)),
  );
  return `${gate}: no citizenship the household holds (${held}) clears it. Decided by citizenship alone; no answer was recorded or read.`;
}
