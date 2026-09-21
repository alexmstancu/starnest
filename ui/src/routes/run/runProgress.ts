/**
 * How far a run has got, as a bar rather than four numbers to compare in your head.
 *
 * `RunDetail.progress` carries the four counts and `reqs.md` Q217 makes them close: completed,
 * failed and unanswered together account for every item asked about. So the bar has three
 * segments and no remainder -- what is left of the track is what has not been reached yet.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number` and friends, so the
 * arithmetic lives here and the component draws what it is given.
 */

export interface Progress {
  items_total?: number | null;
  items_completed?: number | null;
  items_failed?: number | null;
  items_unanswered?: number | null;
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
  /** "37 of 160 answered, 123 failed", or similar. Never a bare percentage. */
  reading: string;
  /** What share of the run has been reached at all, for the label. */
  settled: number;
}

export function progressBar(progress: Progress | null | undefined): ProgressBar {
  const total = count(progress?.items_total);
  const completed = count(progress?.items_completed);
  const failed = count(progress?.items_failed);
  const unanswered = count(progress?.items_unanswered);

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
    reading: `${completed} of ${total} answered, ${failed} failed, ${unanswered} unanswered`,
    settled: offset,
  };
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
