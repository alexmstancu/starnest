import type { ReactNode } from "react";
import { useLanding } from "../../shell/useLanding";

/**
 * One numbered stage card on Configure (PL-013).
 *
 * **The card and its heading are drawn whatever its read is doing.** The numeral is a CSS
 * counter on `.stage__number`, so a stage that returned early without its header took its
 * number with it and every stage after it renumbered. A pending or failed read sits inside the
 * card, under the heading, never in its place.
 */
export function Stage({
  id,
  title,
  lead,
  landsOn = [],
  children,
}: {
  /** Names the heading, which names the region. */
  id: string;
  /** The `?show=` names a route lands on this stage with (PL-018). */
  landsOn?: readonly string[];
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
}) {
  const headingId = `${id}-heading`;
  const { target, asked, landed } = useLanding<HTMLElement>(landsOn);
  return (
    <section
      ref={target}
      tabIndex={asked ? -1 : undefined}
      className={landed ? "stage is-landed" : "stage"}
      aria-labelledby={headingId}
    >
      <header className="stage__head">
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          {/* Focusable by script, so a stage can be where focus goes when what was in it leaves. */}
          <h2 id={headingId} className="stage__title" tabIndex={-1}>
            {title}
          </h2>
          <p className="stage__lead">{lead}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
