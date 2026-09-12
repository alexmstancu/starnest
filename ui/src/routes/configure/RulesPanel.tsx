import { useCallback, useState } from "react";
import {
  fetchCompoundRules,
  fetchMatchRules,
  setCompoundRuleApplication,
  setMatchRuleEnforcement,
  type CompoundRule,
  type CriteriaSet,
  type MatchRule,
} from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";

/**
 * The rules that exist, and which of them this set lets act (`reqs.md` 3.7, 3.7a).
 *
 * **A rule is catalog; enforcing it is a judgement.** The gates and compound rules are the
 * same for everyone -- a visa route either exists or it does not -- but whether an answer of
 * "no" rules a candidate out is the set's opinion, which is why the toggles write to the
 * criteria set and not to the rule.
 *
 * **Two different consequences, kept apart on screen.** A match rule can make a candidate
 * `not_matching`, which costs it its rank while it keeps its score (`reqs.md` 5.5). A compound
 * rule usually only warns. Presenting them in one list would suggest the two switches do the
 * same thing.
 */
export function RulesPanel({
  criteriaSet,
  levelId,
}: {
  criteriaSet: CriteriaSet;
  levelId: string;
}) {
  const matchRules = useResource(
    useCallback(
      (signal: AbortSignal) => fetchMatchRules(levelId, { signal }),
      [levelId],
    ),
  );
  const compoundRules = useResource(
    useCallback(
      (signal: AbortSignal) => fetchCompoundRules(levelId, { signal }),
      [levelId],
    ),
  );

  const [enforced, setEnforced] = useState<string[]>(
    criteriaSet.enforced_match_rules ?? [],
  );
  const [applied, setApplied] = useState<string[]>(
    criteriaSet.applied_compound_rules ?? [],
  );
  const [failure, setFailure] = useState<unknown>(null);

  // The list is only changed once the server has accepted the change: a checkbox that ticked
  // itself optimistically and then failed would leave the screen claiming a gate is enforced
  // when it is not, which is the one thing this panel must never do.
  const toggle = useCallback(
    async (
      id: string,
      wanted: boolean,
      write: (wanted: boolean) => Promise<void>,
      remember: (change: (current: string[]) => string[]) => void,
    ) => {
      setFailure(null);
      try {
        await write(wanted);
        remember((current) =>
          wanted ? [...current, id] : current.filter((each) => each !== id),
        );
      } catch (error) {
        setFailure(error);
      }
    },
    [],
  );

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

      {/* No "try again" button: the way to retry a save is the save button, which is still
          there. A second control that only cleared the message would offer a retry it does not
          perform. */}
      {failure !== null && <ErrorNotice error={failure} />}

      <h4 className="panel__heading">Gates</h4>
      <RuleList
        resource={matchRules.resource}
        onRetry={matchRules.reload}
        empty="No gate is defined at this level."
        caption="Gates. Enforcing one lets it rule a candidate out."
        columnLabel="Enforced"
        rows={(rules: MatchRule[]) =>
          rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            detail: rule.level ?? "every level",
            on: enforced.includes(rule.id),
            toggleLabel: `Enforce ${rule.name}`,
            onToggle: (wanted: boolean) =>
              void toggle(
                rule.id,
                wanted,
                (value) =>
                  setMatchRuleEnforcement(criteriaSet.id, rule.id, value),
                setEnforced,
              ),
          }))
        }
      />

      <h4 className="panel__heading">Compound rules</h4>
      <RuleList
        resource={compoundRules.resource}
        onRetry={compoundRules.reload}
        empty="No compound rule is defined at this level."
        caption="Compound rules, with what each one does when it fires."
        columnLabel="Applied"
        rows={(rules: CompoundRule[]) =>
          rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            detail: `${rule.shape} · ${rule.outcome}`,
            on: applied.includes(rule.id),
            toggleLabel: `Apply ${rule.name}`,
            onToggle: (wanted: boolean) =>
              void toggle(
                rule.id,
                wanted,
                (value) =>
                  setCompoundRuleApplication(criteriaSet.id, rule.id, value),
                setApplied,
              ),
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
  resource: { status: string; data: { items: Rule[] } | null; error: unknown };
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
