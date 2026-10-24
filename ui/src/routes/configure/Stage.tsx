import type { ReactNode } from "react";

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
  children,
}: {
  /** Names the heading, which names the region. */
  id: string;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section className="stage" aria-labelledby={headingId}>
      <header className="stage__head">
        <span className="stage__number" aria-hidden="true" />
        <div className="stage__titles">
          <h3 id={headingId} className="stage__title">
            {title}
          </h3>
          <p className="stage__lead">{lead}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
