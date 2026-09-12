import {
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
} from "../../../api/endpoints";
import { type Resource } from "../../../api/useResource";
import { ErrorNotice } from "../../../shell/ErrorNotice";
import { useRuleToggles } from "./useRuleToggles";

/**
 * The rules that exist, and which of them this set lets act (`reqs.md` 3.7, 3.7a).
 *
 * **Two different consequences, kept apart on screen.** A match rule can make a candidate
 * `not_matching`, which costs it its rank while it keeps its score (`reqs.md` 5.5). A compound
 * rule usually only warns. Presenting them in one list would suggest the two switches do the
 * same thing.
 *
 * **Markup only.** Reading the rules and writing a toggle are `useRuleToggles.ts`.
 */
export function RulesPanel({
  criteriaSet,
  levelId,
}: {
  criteriaSet: CriteriaSet;
  levelId: string;
}) {
  const rules = useRuleToggles(criteriaSet, levelId);

  return (
    <section className="panel" aria-labelledby="rules-heading">
      <h3 id="rules-heading" className="panel__heading">
        Rules
      </h3>
      <p className="panel__hint">
        A gate can make a candidate not matching, which costs it its rank and
        leaves its score intact. A compound rule mostly warns. A rule nobody has
        answered never fires either way.
      </p>

      {rules.failure !== null && <ErrorNotice error={rules.failure} />}

      <h4 className="panel__heading">Gates</h4>
      <RuleList
        resource={rules.matchRules}
        onRetry={rules.reloadMatchRules}
        empty="No gate is defined at this level."
        caption="Gates. Enforcing one lets it rule a candidate out."
        columnLabel="Enforced"
        rows={(listed: MatchRule[]) =>
          listed.map((rule) => ({
            id: rule.id,
            name: rule.name,
            detail: rule.level ?? "every level",
            on: rules.isEnforced(rule.id),
            toggleLabel: `Enforce ${rule.name}`,
            onToggle: (wanted: boolean) => rules.enforce(rule.id, wanted),
          }))
        }
      />

      <h4 className="panel__heading">Compound rules</h4>
      <RuleList
        resource={rules.compoundRules}
        onRetry={rules.reloadCompoundRules}
        empty="No compound rule is defined at this level."
        caption="Compound rules, with what each one does when it fires."
        columnLabel="Applied"
        rows={(listed: CompoundRule[]) =>
          listed.map((rule) => ({
            id: rule.id,
            name: rule.name,
            detail: `${rule.shape} · ${rule.outcome}`,
            on: rules.isApplied(rule.id),
            toggleLabel: `Apply ${rule.name}`,
            onToggle: (wanted: boolean) => rules.apply(rule.id, wanted),
          }))
        }
      />
    </section>
  );
}

interface RuleRow {
  id: string;
  name: string;
  detail: string;
  on: boolean;
  toggleLabel: string;
  onToggle: (wanted: boolean) => void;
}

/**
 * One list of rules with one switch each. Written once for both kinds because the shape of the
 * table is the same; what differs is only what the switch means, which the labels carry.
 */
function RuleList<Rule>({
  resource,
  onRetry,
  empty,
  caption,
  columnLabel,
  rows,
}: {
  resource: Resource<{ items: Rule[] }>;
  onRetry: () => void;
  empty: string;
  caption: string;
  columnLabel: string;
  rows: (items: Rule[]) => RuleRow[];
}) {
  if (resource.status === "error")
    return <ErrorNotice error={resource.error} onRetry={onRetry} />;
  if (resource.data === null) return <p className="screen__note">Loading…</p>;

  const listed = rows(resource.data.items);
  if (listed.length === 0) return <p className="screen__note">{empty}</p>;

  return (
    <table className="table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Rule</th>
          <th scope="col">Detail</th>
          <th scope="col">{columnLabel}</th>
        </tr>
      </thead>
      <tbody>
        {listed.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.name}</th>
            <td>{row.detail}</td>
            <td>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={row.on}
                  aria-label={row.toggleLabel}
                  onChange={(event) => row.onToggle(event.target.checked)}
                />
              </label>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
