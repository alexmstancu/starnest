import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  fetchAttributes,
  fetchDataSources,
  type DataSource,
} from "../../api/endpoints";
import { usePillarNames, type PillarNames } from "../../api/usePillarNames";
import { combine, map } from "../../api/read";
import { useRead } from "../../api/useRead";
import { useSourceNames } from "../../api/useSourceNames";
import { ABSENT, pillarName, sourceName } from "../../format/display";
import { handEntryAsked } from "../../navigation/highlight";
import { LoadedRegion } from "../../shell/LoadedRegion";
import { alwaysAsked } from "./alwaysAsked";
import { ManualEntryPanel } from "./ManualEntryPanel";
import { handEnterable, type HandEnterable } from "./unsourced";

/**
 * The attributes a person may answer themselves.
 *
 * **A card of its own, because it is a different gap from the one beside it.** "No source at
 * all" means no adapter can fetch it and retrying changes nothing. This means the catalog
 * permits a figure typed by hand, whether or not a source could also fetch it -- so an
 * attribute only a person can answer honestly appears in both lists, and this is where its
 * form is. Folding the two together would hide the form from every attribute a source can also
 * fetch; done once, while "no source" was read from the priority order, it hid the form from
 * all of them (found by opening the screen, not by reading the code).
 *
 * **It lists what the catalog permits, not what is missing.** Whether a candidate already has a
 * figure is per candidate, and the form asks which candidate; saying "empty" here would be a
 * claim about 32 of them at once.
 */
export function OpenToHandEntry({ level }: { level: string }) {
  const headingId = useId();
  // One form at a time: two would put two candidate pickers and two date pairs on screen with
  // nothing saying which belonged to which attribute.
  const [open, setOpen] = useState<string | null>(null);
  const pillars = usePillarNames();
  const sourceNames = useSourceNames();

  const attributes = useRead(
    useCallback(
      (signal: AbortSignal) => fetchAttributes(level, { signal }),
      [level],
    ),
  );
  // **Read fresh, not from the session's cached names** (PL-089): whether Manual entry is
  // switched on is a setting that changes, and the names cache never re-reads.
  const sources = useRead(
    useCallback((signal: AbortSignal) => fetchDataSources({ signal }), []),
  );
  const ready = map(
    combine(alwaysAsked(attributes.read), alwaysAsked(sources.read)),
    ([read, catalog]) => ({
      enterable: handEnterable(read.items, sourceNames),
      switchedOff: catalog.items.some(
        (source) => source.id === MANUAL && !source.is_enabled,
      ),
      manual: catalog.items.find((source) => source.id === MANUAL),
    }),
  );
  const openTo = map(ready, ({ enterable }) => enterable);
  // Nothing opens on arrival while hand entry is switched off: there is no form to open.
  const card = useArrivalAt(
    ready.state === "ready"
      ? ready.data.switchedOff
        ? []
        : ready.data.enterable
      : null,
    setOpen,
  );
  const manualName = sourceName(sourceNames, MANUAL);

  return (
    <section ref={card} className="panel" aria-labelledby={headingId}>
      <div className="panel__head">
        <h2 id={headingId} className="panel__heading">
          Figures you can enter by hand
        </h2>
        {openTo.state === "ready" && openTo.data.length > 0 && (
          <span className="chip chip--neutral">
            {openTo.data.length === 1
              ? "1 attribute permits it"
              : `${String(openTo.data.length)} attributes permit it`}
          </span>
        )}
      </div>
      <p className="panel__hint">
        The catalog permits a typed figure for these. It is stored under{" "}
        <strong>{manualName}</strong>, which ranks last — a published figure
        supersedes it the moment one arrives, and the typed one stays visible
        underneath.
      </p>

      <LoadedRegion
        read={ready}
        what="The attributes open to hand entry"
        skeleton="lines"
        prominence="region"
        onRetry={async () => {
          await Promise.all([attributes.reload(), sources.reload()]);
        }}
      >
        {/* **Kept, and saying so, when there are none**: Try again answered with none used to
            take the card away, and the focused button with it, so focus fell to the page. */}
        {({ enterable, switchedOff, manual }) =>
          enterable.length === 0 ? (
            <p className="panel__hint">
              No attribute at this level may be entered by hand.
            </p>
          ) : (
            <>
              {switchedOff && <SwitchedOff manual={manual} />}
              <div className="table-card">
                <table
                  className="table"
                  aria-label="Attributes open to hand entry"
                >
                  <thead>
                    <tr>
                      <th scope="col">Attribute</th>
                      <th scope="col">Pillar</th>
                      <th scope="col">What else would answer it</th>
                      <th scope="col">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enterable.map((attribute) => (
                      <Row
                        key={attribute.id}
                        attribute={attribute}
                        pillars={pillars}
                        level={level}
                        switchedOff={switchedOff}
                        open={open === attribute.id && !switchedOff}
                        onToggle={() =>
                          setOpen((current) =>
                            current === attribute.id ? null : attribute.id,
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </LoadedRegion>
    </section>
  );
}

/** The source a typed figure is stored under, as the catalog lists it. */
const MANUAL = "manual";

/**
 * **Said before anything is typed** (PL-089, D23): while Manual entry is switched off, a figure
 * stored would be left out of scoring and sit there uncounted, so the server refuses it -- and
 * the card says why, and where to switch it on, rather than offer a form that will be refused.
 */
function SwitchedOff({ manual }: { manual: DataSource | undefined }) {
  const name = manual?.name ?? "Manual entry";
  return (
    <div className="notice notice--warning">
      <p>
        {name} is switched off in Configure, so a figure typed here would not
        count. Figures already typed stay stored and count again when it is
        switched back on.
      </p>
      <Link className="button" to="/configure">
        Switch it on in Configure
      </Link>
    </div>
  );
}

/**
 * **Arrived at from the no-source card's remedy** (PL-088): the link names an attribute, and its
 * row opens once per arrival -- keyed on the navigation, so the reader's own toggles afterwards
 * are not fought -- and the card scrolls into view.
 */
function useArrivalAt(
  enterable: readonly HandEnterable[] | null,
  open: (attribute: string) => void,
) {
  const location = useLocation();
  const asked = handEntryAsked(location.search);
  const answered = useRef<string | null>(null);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    if (
      asked === null ||
      enterable === null ||
      answered.current === location.key
    )
      return;
    answered.current = location.key;
    if (
      !enterable.some(
        (attribute) => attribute.id === asked && attribute.kind !== null,
      )
    )
      return;
    open(asked);
    // Not in jsdom; the focus the form takes when it opens is what moves the reader.
    card.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [asked, enterable, location.key, open]);

  return card;
}

function Row({
  attribute,
  pillars,
  level,
  switchedOff,
  open,
  onToggle,
}: {
  attribute: HandEnterable;
  pillars: PillarNames;
  level: string;
  switchedOff: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  // The open row and its form read as one, tinted as the design's open row is.
  const tint = open
    ? "hand-entry__row hand-entry__row--open"
    : "hand-entry__row";
  return (
    <>
      <tr className={tint}>
        <th scope="row">
          {attribute.name}
          <span className="hand-entry__type">{attribute.type}</span>
        </th>
        {/* The catalog's name, as the card beside this one prints it -- never the id (NEW-09). */}
        <td>{attribute.pillar === null ? "No pillar" : pillarName(pillars, attribute.pillar)}</td>
        <td>{attribute.otherwise}</td>
        <td>
          {attribute.kind === null ? (
            attribute.noForm
          ) : switchedOff ? (
            ABSENT
          ) : (
            <button
              ref={toggle}
              type="button"
              className="button button--quiet"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? "Close" : "Enter a value by hand"}
            </button>
          )}
        </td>
      </tr>
      {open && attribute.kind !== null && (
        <tr className={tint}>
          <td colSpan={4}>
            <ManualEntryPanel
              attribute={attribute.id}
              attributeName={attribute.name}
              kind={attribute.kind}
              level={level}
              pillar={attribute.pillar}
              onClose={() => {
                onToggle();
                // Back to the control that opened it, which stays: never to the page.
                toggle.current?.focus();
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}
