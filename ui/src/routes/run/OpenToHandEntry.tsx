import { useCallback, useId, useState } from "react";
import { fetchAttributes } from "../../api/endpoints";
import { useResource } from "../../api/useResource";
import { ErrorNotice } from "../../shell/ErrorNotice";
import { ManualEntryPanel } from "./ManualEntryPanel";
import { handEnterable } from "./unsourced";

/**
 * The attributes a person may answer themselves.
 *
 * **A card of its own, because it is a different gap from the one beside it.** "No source at
 * all" means nobody would be asked and retrying changes nothing. This means the catalog permits
 * a figure typed by hand -- which every one of these also declares a source for, so the two
 * lists never overlap. Folding them together would have put the form where it could not be
 * reached (found by opening the screen, not by reading the code).
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

  const attributes = useResource(
    useCallback(
      (signal: AbortSignal) => fetchAttributes(level, { signal }),
      [level],
    ),
  );

  if (attributes.resource.status === "error") {
    return (
      <ErrorNotice error={attributes.resource.error} onRetry={attributes.reload} />
    );
  }
  if (attributes.resource.status !== "ready") return null;

  const open_to = handEnterable(attributes.resource.data.items);
  if (open_to.length === 0) return null;

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId} className="panel__heading">
        Figures you can enter by hand
      </h3>
      <p className="panel__hint">
        The catalog permits a typed figure for these. It is stored under the{" "}
        <strong>manual</strong> source, which ranks last — a published figure
        supersedes it the moment one arrives, and the typed one stays visible
        underneath.
      </p>

      <div className="table-card">
        <table className="table" aria-label="Attributes open to hand entry">
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              <th scope="col">Pillar</th>
              <th scope="col">What else would answer it</th>
              <th scope="col">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {open_to.map((attribute) => (
              <Row
                key={attribute.id}
                attribute={attribute}
                level={level}
                open={open === attribute.id}
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
    </section>
  );
}

function Row({
  attribute,
  level,
  open,
  onToggle,
}: {
  attribute: ReturnType<typeof handEnterable>[number];
  level: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <th scope="row">{attribute.name}</th>
        <td>{attribute.pillar}</td>
        <td>{attribute.otherwise}</td>
        <td>
          <button
            type="button"
            className="button button--quiet"
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? "Close" : "Enter a value by hand"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4}>
            <ManualEntryPanel
              attribute={attribute.id}
              attributeName={attribute.name}
              kind={attribute.kind}
              level={level}
            />
          </td>
        </tr>
      )}
    </>
  );
}
