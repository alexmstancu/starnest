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

/** One pillar's part in a candidate's total, as the ranking serves it. */
export interface PillarScore {
  pillar: string;
  score?: number | null;
  weight: number;
  contribution: number;
}

export interface PillarBar {
  pillar: string;
  /** Left edge and width in the chart's own pixel space, which is the design's 522px track. */
  x: number;
  width: number;
  y: number;
  height: number;
  /** The score printed inside the bar, or empty where there is none to print. */
  label: string;
  /** The two ends of the bar's vertical ramp, or null for a pillar with no score. */
  fill: { top: string; bottom: string } | null;
  title: string;
}

/**
 * The chart's coordinate space, which is the design's own: a 522px track 36px tall holding
 * eleven bars two pixels apart.
 */
export const PILLAR_CHART = { width: 522, height: 36, columns: 11, gap: 2 } as const;

/**
 * **The bars encode 40 to 96, not 0 to 100.** Scores across 32 countries occupy the middle of
 * the range and nothing else: a bar scaled from zero would put every country in the same
 * narrow band near the top, which is a chart that cannot be read. Clipping to the range the
 * answers actually occupy is what makes the differences visible -- and the number is printed
 * inside the bar, so nothing is lost to the reader who wants the figure rather than the shape.
 */
const READABLE_RANGE = { from: 40, to: 96 } as const;

/** The shortest and tallest a scored bar is drawn, so even the lowest score has a body. */
const BAR_HEIGHT = { shortest: 19, tallest: 36 } as const;

/**
 * Amber through pale teal to teal: one hue ramp with a warning at the bottom of it.
 *
 * **Three stops, interpolated, not three classes.** A pillar score is continuous, and
 * bucketing it into three tones would draw 69 and 71 as different colours while drawing 71
 * and 96 as the same one.
 */
const RAMP: readonly (readonly [number, number, number])[] = [
  [253, 176, 34],
  [110, 231, 183],
  [45, 212, 191],
];

/** Where a score sits on the readable range, 0 at the bottom and 1 at the top. */
function positionOf(score: number): number {
  const { from, to } = READABLE_RANGE;
  return Math.max(0, Math.min(1, (score - from) / (to - from)));
}

/**
 * The ramp colour at a position, shifted by `lift` so a bar can be lighter at the top than at
 * the bottom without needing a second ramp.
 */
function rampColour(position: number, lift: number): string {
  const scaled = position * (RAMP.length - 1);
  const lower = Math.min(RAMP.length - 2, Math.floor(scaled));
  const within = scaled - lower;
  const from = RAMP[lower]!;
  const to = RAMP[lower + 1]!;
  const channels = from.map((value, index) =>
    Math.round(
      Math.max(0, Math.min(255, value + (to[index]! - value) * within + lift)),
    ),
  );
  return `rgb(${channels.join(",")})`;
}

/**
 * The eleven pillars as one chart, in the design's 522 x 36 space.
 *
 * **A pillar with no score is drawn full height, hatched**, not omitted and not drawn at
 * zero. Omitting it would silently renumber the others -- the reader counts eleven bars and
 * reads the shape of a decision -- and zero would claim it measured badly rather than that
 * nobody measured it.
 */
export function pillarBars(
  pillars: readonly PillarScore[] | null | undefined,
): PillarBar[] {
  const roster = pillars ?? [];
  if (roster.length === 0) {
    return [];
  }
  const { width, height, gap } = PILLAR_CHART;
  const slot = (width - gap * (roster.length - 1)) / roster.length;

  return roster.map((pillar, index) => {
    const scored = typeof pillar.score === "number";
    const score = scored ? clampPercentage(pillar.score) : 0;
    const position = positionOf(score);
    const drawn = scored
      ? Math.round(
          BAR_HEIGHT.shortest +
            position * (BAR_HEIGHT.tallest - BAR_HEIGHT.shortest),
        )
      : height;

    return {
      pillar: pillar.pillar,
      x: index * (slot + gap),
      width: slot,
      y: height - drawn,
      height: drawn,
      label: scored ? round(score) : "",
      fill: scored
        ? { top: rampColour(position, 16), bottom: rampColour(position, -12) }
        : null,
      title: scored
        ? `${pillar.pillar}: ${round(score)}, weight ${pillar.weight.toFixed(1)}%`
        : `${pillar.pillar}: no value stored`,
    };
  });
}

/**
 * The confidence split as three readings rather than one.
 *
 * **All three, always.** The column used to print the low share alone, which answered half of
 * the question it raised: a candidate that is 5% low-confidence and one that is 5% low and 60%
 * medium are not the same candidate, and only showing both makes that visible.
 */
export function confidenceReadings(
  split: ConfidenceSplit | null | undefined,
): { grade: string; reading: string; loud: boolean }[] {
  if (!split) return [];
  return (["high", "medium", "low"] as const).map((grade) => {
    const share = split[grade] ?? 0;
    return {
      grade,
      reading: `${grade} ${round(share)}%`,
      // The share that carries most of the weight is the one worth reading first.
      loud: share >= 50,
    };
  });
}

/** The difference from home, signed, or a dash when there is nothing to compare against. */
export function formatDelta(delta: number | null | undefined): string {
  if (typeof delta !== "number" || Number.isNaN(delta)) {
    return "—";
  }
  if (delta === 0) return "0";
  // **U+2212, not a hyphen.** A hyphen is narrower than a plus at the same size, so a column
  // of signed deltas does not line up on it -- and this screen is a column of signed deltas.
  return delta > 0 ? `+${round(delta)}` : `\u2212${round(Math.abs(delta))}`;
}

/** Which way the difference goes, for the colour the design gives it. */
export function deltaTone(
  delta: number | null | undefined,
): "ahead" | "behind" | "level" {
  if (typeof delta !== "number" || Number.isNaN(delta) || delta === 0) {
    return "level";
  }
  return delta > 0 ? "ahead" : "behind";
}

/** A candidate as the band below needs to see one: only whether it matches. */
export interface Judged {
  match_status: string;
}

/**
 * Where the ranking stops, and what is below the line.
 *
 * **Non-matching candidates stay in the table, keeping their scores** (`reqs.md` 5.4).
 * Filtering them out would hide exactly what a rule is costing; leaving them in with nothing
 * between makes the ranking look as though it simply continues. The band is what says the list
 * has changed meaning -- above it is an order, below it is a set.
 *
 * **Two ways to be below it, and they are not the same problem.** A gate ruled a candidate out;
 * insufficient data means nobody could score it. One is a decision and the other is a gap, so
 * the sentence counts them separately.
 */
export function excludedBand(
  candidates: readonly Judged[],
): { at: number; reading: string } | null {
  const at = candidates.findIndex(
    (candidate) => candidate.match_status !== "matching",
  );
  if (at === -1) return null;

  const below = candidates.length - at;
  const gated = candidates.filter(
    (candidate) => candidate.match_status === "not_matching",
  ).length;
  const unscored = below - gated;

  return {
    at,
    reading:
      `${round(below)} ${below === 1 ? "candidate" : "candidates"} below — ` +
      `${round(gated)} ruled out by a gate, ` +
      `${round(unscored)} without enough data to score`,
  };
}

/** A candidate as the catalog serves one, for the flag beside its name. */
export interface Coded {
  id: string;
  country_code?: string | null;
}

/**
 * Candidate id to ISO 3166-1 alpha-2.
 *
 * **From the catalog, never from the name.** Mapping "Netherlands" to NL in the client would
 * be a second copy of something the database already holds -- and wrong for every candidate
 * whose name is not a country's, which is every city.
 */
export function codesByCandidate(
  roster: readonly Coded[] | null | undefined,
): Map<string, string> {
  const codes = new Map<string, string>();
  for (const candidate of roster ?? []) {
    if (candidate.country_code) codes.set(candidate.id, candidate.country_code);
  }
  return codes;
}

/** The household as the ranking needs it: only which candidates it already lives in. */
export interface AtHome {
  home_country_candidate?: string | null;
  home_city_candidate?: string | null;
}

/**
 * The candidates the household is already in.
 *
 * **Both places, never the one belonging to the level on screen.** Staying put is one of the
 * options being measured (`reqs.md` 1.1), so the row for it is worth marking -- but a level is
 * an ordered record rather than a known pair (`reqs.md` 3.1), and picking the home by matching
 * the level's id would be this client deciding there are exactly two of them. Candidate ids
 * are unique across levels, so a set of both is right at every level and wrong at none.
 */
export function homeCandidates(
  household: AtHome | null | undefined,
): Set<string> {
  const home = new Set<string>();
  for (const candidate of [
    household?.home_country_candidate,
    household?.home_city_candidate,
  ]) {
    if (candidate) home.add(candidate);
  }
  return home;
}
