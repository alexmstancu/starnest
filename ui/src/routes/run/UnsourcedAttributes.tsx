import { useCallback, useId } from "react";
import { Link } from "react-router-dom";
import { fetchAttributes, fetchCriteriaSet } from "../../api/endpoints";
import { combine, map, type Read } from "../../api/read";
import { type PillarNames, usePillarNames } from "../../api/usePillarNames";
import { useRead } from "../../api/useRead";
import { ABSENT, formatPercentage, pillarName } from "../../format/display";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { useSelection } from "../../shell/SelectionContext";
import { linkToHandEntry, UNSOURCED } from "../../navigation/highlight";
import { useLanding } from "../../shell/useLanding";
import { alwaysAsked } from "./alwaysAsked";
import {
  type UnsourcedAttribute,
  unsourcedAttributes,
  type WeightedCriterion,
  WEIGHTS_PENDING,
} from "./unsourced";

/**
 * Attributes no source can fetch at all, and what each gap costs.
 *
 * **The honest framing is the whole point.** Retrying and refreshing cannot conjure an
 * adapter, so this card says so rather than offering a button that would do nothing. It sits
 * beside the failures deliberately: the three reasons a figure is missing look identical in a
 * ranking and have completely different remedies.
 *
 * **Hand entry is not offered here, though the two lists now overlap.** An attribute only a
 * person can answer -- hand entry permitted, no adapter able to fetch it -- honestly appears in
 * both, and its remedy here links to its form in the card beside. The form lives in `OpenToHandEntry` beside
 * this card, which lists every attribute a person may answer, so there is one form in one place.
 * It was first put here, while "no source" was read from the priority order and no hand-entry
 * attribute ever qualified -- which made it unreachable, as opening the screen showed and no
 * test did.
 */
export function UnsourcedAttributes({ level }: { level: string }) {
  const headingId = useId();
  const selection = useSelection();
  const { criteriaSetId } = selection;

  const pillars = usePillarNames();
  const attributes = useRead(
    useCallback(
      (signal: AbortSignal) => fetchAttributes(level, { signal }),
      [level],
    ),
  );
  const set = useRead(
    useCallback(
      (signal: AbortSignal) => fetchCriteriaSet(criteriaSetId ?? "", { signal }),
      [criteriaSetId],
    ),
    { enabled: criteriaSetId !== null },
  );
  const catalog = alwaysAsked(attributes.read);
  // The weights come from the set: without one, from the selection that says there is none.
  const weights: Read<readonly WeightedCriterion[]> =
    set.read.state === "idle"
      ? map(selection.read, () => [])
      : map(set.read, (chosen) => chosen.criteria ?? []);
  // **The gaps are the catalog's; only what each is worth waits for the set** (PL-088). While
  // it is read, each weight is a dash, never "not scored here"; if it fails, the card says so
  // and offers Try again, rather than draw a weight it does not have.
  const gaps: Read<UnsourcedAttribute[]> =
    weights.state === "pending"
      ? map(catalog, (read) => unsourcedAttributes(read.items, WEIGHTS_PENDING))
      : map(combine(catalog, weights), ([read, criteria]) =>
          unsourcedAttributes(read.items, criteria),
        );

  // **Arrived at from Configure's "No source yet →".** The route carries which card was asked
  // for, so the reader lands on a long screen with the one they came for marked -- and the mark
  // is in the URL, so a reload and a copied link both keep it.
  /**
   * **Following a link moves the reader, not just the scrollbar** (PL-018): focused, scrolled
   * to, and marked until the reader acts -- also when the link is followed from this screen.
   */
  const { target: card, asked, landed } = useLanding<HTMLElement>(UNSOURCED);

  return (
    <section
      ref={card}
      // Focusable only as the target of a jump: -1 keeps it out of the tab order, so nobody
      // tabbing through the screen has to pass a card that is not a control.
      tabIndex={asked ? -1 : undefined}
      className={landed ? "panel is-landed" : "panel"}
      aria-labelledby={headingId}
    >
      <div className="panel__head">
        <h2 id={headingId} className="panel__heading">
          Attributes with no data source at all
        </h2>
        {/* The count as a badge, which is what the design puts here: the heading says what the
            card is, and this says how much of it there is before the table is read. */}
        {gaps.state === "ready" && gaps.data.length > 0 && (
          <span className="chip chip--warning">
            {gaps.data.length === 1
              ? "1 attribute affected"
              : `${String(gaps.data.length)} attributes affected`}
          </span>
        )}
      </div>

      <LoadedRegion
        read={gaps}
        what="The attributes with no source"
        skeleton="lines"
        prominence="region"
        onRetry={async () => {
          selection.reload();
          await Promise.all([attributes.reload(), set.reload()]);
        }}
      >
        {(unsourced) => <Gaps gaps={unsourced} pillars={pillars} />}
      </LoadedRegion>
    </section>
  );
}

function Gaps({
  gaps,
  pillars,
}: {
  gaps: readonly UnsourcedAttribute[];
  pillars: PillarNames;
}) {
  return gaps.length === 0 ? (
    <p className="panel__hint">
      {/* "Unless it is switched off" because `answerable_by` names what can fetch an
          attribute whatever the switch says (Q235), and a source switched off is not asked. */}
      Every attribute at this level has at least one source that would be
      asked, unless it is switched off.
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
              <th scope="col">Type</th>
              <th scope="col">Pillar</th>
              <th scope="col">Weight in pillar</th>
              <th scope="col">What would fill it</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((gap) => (
              <tr key={gap.id}>
                <th scope="row">{gap.name}</th>
                <td>{gap.type}</td>
                {/* The catalog's pillar name, never the id: the catalog says "Economy"
                    where the id says `economics`, and a title-cased id is this screen
                    guessing at a name somebody already chose. */}
                <td>{pillarName(pillars, gap.pillar)}</td>
                <td aria-busy={gap.weight === WEIGHTS_PENDING || undefined}>
                  {gap.weight === WEIGHTS_PENDING
                    ? ABSENT
                    : gap.weight === null
                      ? "not scored here"
                      : formatPercentage(gap.weight)}
                </td>
                <td>
                  {/* The remedy takes the reader to the form, where there is one (PL-088). */}
                  {gap.manualKind === null ? (
                    gap.remedy
                  ) : (
                    <Link to={linkToHandEntry("/acquire", gap.id)}>{gap.remedy}</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
