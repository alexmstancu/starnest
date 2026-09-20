/**
 * The arithmetic behind the ranking table's bars, kept out of the markup.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number`, `parseInt`, `parseFloat` or
 * `toFixed`, so the widths and the label are computed here and the component renders what it is
 * given. The thresholds are the design's own (`Starnest Product`, claude.ai/design), not
 * chosen here.
 */

/** The four grades `reqs.md` 5.7 splits covered weight into. */
export interface ConfidenceSplit {
  absolute?: number | null;
  high?: number | null;
  medium?: number | null;
  low?: number | null;
}

export type Tone = "strong" | "good" | "fair" | "weak";

export interface Band {
  grade: string;
  tone: Tone;
  /** Percentage offset from the left of the track, as an SVG `x`. */
  x: string;
  width: string;
  title: string;
}

const PERCENT_SCALE = 100;

/**
 * How wide the coverage bar is, and which tone it takes.
 *
 * The design's thresholds: 75 and above reads as covered, 60 to 75 as partial, below 60 as
 * thin. **60 is also the shipped coverage floor**, which is why the lowest band and the
 * refusal to score begin at the same number rather than at two numbers that merely look alike.
 */
export function coverageBar(coverage: number | null | undefined): {
  width: string;
  tone: Tone;
} {
  const percentage = clampPercentage(coverage);
  const tone: Tone =
    percentage >= 75 ? "good" : percentage >= 60 ? "fair" : "weak";
  return { width: `${percentage}%`, tone };
}

/**
 * The stacked confidence bar, strongest grade first.
 *
 * **A grade worth nothing is left out rather than drawn at zero width**, so the bar has as many
 * segments as the candidate actually has grades. `absolute` is carried although the design's
 * own data never had one -- dropping a grade the domain defines to match a mockup would lose
 * information the ranking is required to disclose.
 */
export function confidenceBands(
  split: ConfidenceSplit | null | undefined,
): Band[] {
  const grades: [keyof ConfidenceSplit, Tone][] = [
    ["absolute", "strong"],
    ["high", "good"],
    ["medium", "fair"],
    ["low", "weak"],
  ];
  let offset = 0;
  const bands: Band[] = [];
  for (const [grade, tone] of grades) {
    const share = clampPercentage(split?.[grade]);
    if (share <= 0) {
      continue;
    }
    bands.push({
      grade: String(grade),
      tone,
      x: `${offset}%`,
      width: `${share}%`,
      title: `${grade} confidence: ${round(share)}% of the scored weight`,
    });
    offset += share;
  }
  return bands;
}

/** The design's compact reading of the split -- "82h / 11m / 7l". */
export function confidenceLabel(
  split: ConfidenceSplit | null | undefined,
): string {
  const parts = confidenceBands(split).map(
    (band) =>
      `${round(clampPercentage(split?.[band.grade as keyof ConfidenceSplit]))}${band.grade.charAt(0)}`,
  );
  return parts.length === 0 ? "—" : parts.join(" / ");
}

function clampPercentage(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(PERCENT_SCALE, Math.max(0, value));
}

function round(value: number): string {
  return value.toFixed(0);
}
