import type { MatchRule } from "../../api/endpoints";
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

/** A clearing citizenship, and the candidates it clears a gate in -- none: everywhere (0526). */
type Clearing = MatchRule["cleared_by"][number];

/**
 * "Free movement applies: no citizenship the household holds (United Kingdom) clears it. …"
 *
 * **A held citizenship that clears the gate elsewhere says where** (0526): a British household
 * is ruled out of Germany, and "Cleared only where yours does: United Kingdom (in Ireland)" says
 * why not of Ireland.
 */
export function citizenshipVerdict(
  finding: GateFinding,
  names: {
    gates: ReadonlyMap<string, string>;
    candidates: ReadonlyMap<string, string>;
    clearing?: ReadonlyMap<string, readonly Clearing[]>;
  },
): string {
  const gate = matchRuleName(names.gates, finding.match_rule ?? "");
  const clearing = names.clearing?.get(finding.match_rule ?? "") ?? [];
  const nameOf = (id: string) => candidateName(names.candidates, id);
  const read = finding.citizenships ?? [];
  const held = new Intl.ListFormat(DISPLAY_LOCALE, { type: "conjunction" }).format(read.map(nameOf));
  const elsewhere = clearing
    .filter((each) => each.candidates.length > 0 && read.includes(each.citizenship))
    .map((each) => `${nameOf(each.citizenship)} (in ${each.candidates.map(nameOf).sort().join(", ")})`)
    .sort();
  const where = elsewhere.length > 0 ? ` Cleared only where yours does: ${elsewhere.join(", ")}.` : "";
  return `${gate}: no citizenship the household holds (${held}) clears it.${where} Decided by citizenship alone; no answer was recorded or read.`;
}
