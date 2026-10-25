/**
 * How far a run has got, as a bar rather than four numbers to compare in your head.
 *
 * `RunDetail.progress` carries five counts and they close: completed, failed, unanswered and
 * not reached sum to the total (`reqs.md` Q217, PL-050). So the bar has three segments and
 * **not reached is the empty part of the track** -- an item no source has been asked about yet
 * is neither an answer nor an absence, and drawing it as either would claim an outcome.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, so the
 * arithmetic lives here and the component draws what it is given.
 */

export interface Progress {
  items_total?: number | null;
  items_completed?: number | null;
  items_failed?: number | null;
  items_unanswered?: number | null;
  items_not_reached?: number | null;
}

export interface Segment {
  kind: "completed" | "failed" | "unanswered";
  /** Percentage offset from the left of the track, as an SVG `x`. */
  x: string;
  width: string;
  title: string;
}

export interface ProgressBar {
  segments: Segment[];
  /** "37 of 160 answered, 3 failed, 0 unanswered, 120 not reached". Never a bare percentage. */
  reading: string;
  /** What share of the run has been reached at all, for the label. */
  settled: number;
}

export function progressBar(progress: Progress | null | undefined): ProgressBar {
  const total = count(progress?.items_total);
  const completed = count(progress?.items_completed);
  const failed = count(progress?.items_failed);
  const unanswered = count(progress?.items_unanswered);
  const notReached = count(progress?.items_not_reached);

  if (total <= 0) {
    return { segments: [], reading: "Nothing to do", settled: 0 };
  }

  const segments: Segment[] = [];
  let offset = 0;
  for (const [kind, value] of [
    ["completed", completed],
    ["failed", failed],
    ["unanswered", unanswered],
  ] as const) {
    // **A share worth nothing is left out rather than drawn at zero width.** A zero-width
    // segment is invisible anyway, and keeping it would make the bar claim more parts than
    // the run has.
    const share = (value / total) * 100;
    if (share <= 0) continue;
    segments.push({
      kind,
      x: `${offset}%`,
      width: `${share}%`,
      title: `${value} ${kind}`,
    });
    offset += share;
  }

  return {
    segments,
    // Named only when there are any: a finished run has none, and "0 not reached" on every
    // completed run would be a count about nothing.
    reading:
      `${completed} of ${total} answered, ${failed} failed, ${unanswered} unanswered` +
      (notReached > 0 ? `, ${notReached} not reached` : ""),
    settled: offset,
  };
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
