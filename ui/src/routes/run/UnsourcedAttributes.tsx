import { useCallback, useEffect, useId, useRef } from "react";
import { useLocation } from "react-router-dom";
import { fetchAttributes, fetchCriteriaSet } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { formatPercentage } from "../../format/display";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { useSelection } from "../../shell/SelectionContext";
import { highlighted, UNSOURCED } from "../../navigation/highlight";
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

  // **Arrived at from Configure's "No source yet →".** The route carries which card was asked
  // for, so the reader lands on a long screen with the one they came for marked -- and the mark
  // is in the URL, so a reload and a copied link both keep it.
  const asked = highlighted(useLocation().search) === UNSOURCED;
  const card = useRef<HTMLElement>(null);
  const ready = attributes.resource.status === "ready";

  /**
   * **Following a link moves the reader, not just the scrollbar.** A jump that only tinted a
   * card leaves anyone reading by keyboard or screen reader where they were, on a screen of
   * six cards, with no way to tell which one was meant. Focusing the card is what actually
   * says "here"; the tint is for the eye that is already on the page.
   */
  useEffect(() => {
    // **Waits for the card to exist.** The catalog is still in flight on the first render, so
    // the section is not there yet and a focus call would land on nothing -- and `asked` never
    // changes afterwards, so nothing would bring the effect back.
    if (!asked || card.current === null) return;
    card.current.focus();
    // Not in jsdom, and not worth a shim: the scroll is a courtesy and the focus is the thing
    // that actually moves the reader.
    card.current.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [asked, ready]);

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
    <section
      ref={card}
      // Focusable only as the target of a jump: -1 keeps it out of the tab order, so nobody
      // tabbing through the screen has to pass a card that is not a control.
      tabIndex={asked ? -1 : undefined}
      className={asked ? "panel panel--asked-for" : "panel"}
      aria-labelledby={headingId}
    >
      <div className="panel__head">
        <h3 id={headingId} className="panel__heading">
          Attributes with no data source at all
        </h3>
        {/* The count as a badge, which is what the design puts here: the heading says what the
            card is, and this says how much of it there is before the table is read. */}
        {gaps.length > 0 && (
          <span className="chip chip--warning">
            {gaps.length === 1
              ? "1 attribute affected"
              : `${String(gaps.length)} attributes affected`}
          </span>
        )}
      </div>

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
