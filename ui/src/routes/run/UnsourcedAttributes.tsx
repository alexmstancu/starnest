import { useCallback, useId } from "react";
import { fetchAttributes, fetchCriteriaSet } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { formatPercentage } from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { unsourcedAttributes } from "./unsourced";

/**
 * Attributes with no data source at all, and what each gap costs.
 *
 * **The honest framing is the whole point.** Retrying and refreshing cannot conjure an
 * adapter, so this card says so rather than offering a button that would do nothing. It sits
 * beside the failures deliberately: the three reasons a figure is missing look identical in a
 * ranking and have completely different remedies.
 *
 * **Hand entry is not offered here**, and the two lists are why: every attribute the catalog
 * lets a person answer also declares a source, so none of them ever appears in this one. The
 * form lives in `OpenToHandEntry` beside this card. Putting it here first made it unreachable,
 * which opening the screen showed and no test did.
 */
export function UnsourcedAttributes({ level }: { level: string }) {
  const headingId = useId();
  const { criteriaSetId } = useSelection();

  const attributes = useResource(
    useCallback(
      (signal: AbortSignal) => fetchAttributes(level, { signal }),
      [level],
    ),
  );
  const set = useResource(
    useCallback(
      (signal: AbortSignal) => fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    criteriaSetId !== null,
  );

  if (attributes.resource.status === "error") {
    return (
      <ErrorNotice
        error={attributes.resource.error}
        onRetry={attributes.reload}
      />
    );
  }
  if (attributes.resource.status !== "ready") return null;

  const gaps = unsourcedAttributes(
    attributes.resource.data.items,
    set.resource.status === "ready" ? (set.resource.data.criteria ?? []) : [],
  );

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        Attributes with no data source at all
      </h3>

      {gaps.length === 0 ? (
        <p className="panel__hint">
          Every attribute at this level has at least one source that would be
          asked.
        </p>
      ) : (
        <>
          <p className="panel__hint">
            Nobody would be asked about these, so a run cannot fill them and
            retrying one changes nothing. They are a missing adapter, not a
            missing figure.
          </p>
          <div className="table-card">
            <table className="table" aria-label="Attributes with no source">
              <thead>
                <tr>
                  <th scope="col">Attribute</th>
                  <th scope="col">Pillar</th>
                  <th scope="col">Weight in pillar</th>
                  <th scope="col">What would fill it</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((gap) => (
                  <tr key={gap.id}>
                    <th scope="row">{gap.name}</th>
                    <td>{gap.pillar}</td>
                    <td>
                      {gap.weight === null
                        ? "not scored here"
                        : formatPercentage(gap.weight)}
                    </td>
                    <td>{gap.remedy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
