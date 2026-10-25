/**
 * The arithmetic behind the ranking table's bars, kept out of the markup.
 *
 * `CLAUDE.md` bars a `.tsx` under `routes/` from calling `Number`, `parseInt`, `parseFloat` or
 * `toFixed`, so the widths and the label are computed here and the component renders what it is
 * given. The thresholds are the design's own (`Starnest Product`, claude.ai/design), not
 * chosen here.
 */

import { isScale, scoreShare } from "../../format/scoreScale";

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
  const percentage = clampShare(coverage);
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
    const share = clampShare(split?.[grade]);
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
      `${round(clampShare(split?.[band.grade as keyof ConfidenceSplit]))}${band.grade.charAt(0)}`,
  );
  return parts.length === 0 ? "—" : parts.join(" / ");
}

function clampShare(value: number | null | undefined): number {
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
 * **The bars encode 40% to 96% of the scale, not all of it.** Scores across 32 countries occupy
 * the middle of the range and nothing else: a bar scaled from zero would put every country in
 * the same narrow band near the top, which is a chart that cannot be read. Clipping to the range
 * the answers actually occupy is what makes the differences visible -- and the number is printed
 * inside the bar, so nothing is lost to the reader who wants the figure rather than the shape.
 *
 * **Fractions of the scale the ranking came with** (PL-062), never points: on a scale of 150 the
 * band is 60 to 144, and 128 is drawn above 96 rather than both clamped to 100.
 */
const READABLE_RANGE = { from: 0.4, to: 0.96 } as const;

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

/** Where a share of the scale sits on the readable range, 0 at the bottom and 1 at the top. */
function positionOf(share: number): number {
  const { from, to } = READABLE_RANGE;
  return Math.max(0, Math.min(1, (share - from) / (to - from)));
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
 *
 * **No scale, no chart**: a bar's height is a share of the scale, and without one there is
 * nothing to measure it against. The scores still print wherever else they appear.
 */
export function pillarBars(
  pillars: readonly PillarScore[] | null | undefined,
  /** The top of the range these scores are on, from the response that carried them. */
  scaleMax: number | null | undefined,
  /**
   * What to call each pillar in its tooltip. Passed in rather than looked up, so this module
   * stays a pure function and the hover reads "Economy" where the catalog says so.
   */
  name: (pillar: string) => string = (pillar) => pillar,
): PillarBar[] {
  const roster = pillars ?? [];
  if (roster.length === 0 || !isScale(scaleMax)) {
    return [];
  }
  const { width, height, gap } = PILLAR_CHART;
  const slot = (width - gap * (roster.length - 1)) / roster.length;

  return roster.map((pillar, index) => {
    const share = scoreShare(pillar.score, scaleMax);
    const scored = share !== null;
    const score = pillar.score ?? 0;
    const position = positionOf(share ?? 0);
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
        ? `${name(pillar.pillar)}: ${round(score)}, weight ${pillar.weight.toFixed(1)}%`
        : `${name(pillar.pillar)}: no value stored`,
    };
  });
}

/**
 * The confidence split read grade by grade, rather than as one share.
 *
 * **High, medium and low always.** The column used to print the low share alone, which answered
 * half of the question it raised: a candidate that is 5% low-confidence and one that is 5% low
 * and 60% medium are not the same candidate, and only showing both makes that visible.
 *
 * **`absolute` only when it carries a share** (P80, PL-078). The domain defines four grades, the
 * contract sends four, `confidenceBands` above draws four, and the hand-entry form offers
 * `absolute` as a choice -- so a candidate resting on hand-entered figures drew a full-width
 * band over the words "high 0% medium 0% low 0%". The bar and the sentence beside it have to
 * be reading the same split, so the words keep `absolute` by the test the bar uses -- and drop
 * it by the same test, or every row reads "absolute 0%".
 */
export function confidenceReadings(
  split: ConfidenceSplit | null | undefined,
): { grade: string; reading: string; loud: boolean }[] {
  if (!split) return [];
  return (["absolute", "high", "medium", "low"] as const)
    .filter((grade) => grade !== "absolute" || clampShare(split[grade]) > 0)
    .map((grade) => {
      const share = split[grade] ?? 0;
      return {
        grade,
        reading: `${grade} ${round(share)}%`,
        // The share that carries most of the weight is the one worth reading first.
        loud: share >= 50,
      };
    });
}

/** A candidate as the band below needs to see one: whether it matches, and why not. */
export interface Judged {
  match_status: string;
  non_match_reasons?: readonly {
    criterion?: string | null;
    match_rule?: string | null;
    compound_rule?: string | null;
  }[];
}

/**
 * Where the ranking stops, and what is below the line.
 *
 * **Non-matching candidates stay in the table, keeping their scores** (`reqs.md` 5.4).
 * Filtering them out would hide exactly what a rule is costing; leaving them in with nothing
 * between makes the ranking look as though it simply continues. The band is what says the list
 * has changed meaning -- above it is an order, below it is a set.
 *
 * **Counted by cause, from the reasons the server gave** (PL-067, N2). A threshold the
 * household set, a gate and a compound rule are three different decisions, and insufficient
 * data is a gap rather than a decision; only the causes that occur are named. One candidate
 * can be below for several reasons, and then the sentence says so rather than letting the
 * counts outrun the total unexplained.
 */
export function excludedBand(
  candidates: readonly Judged[],
): { at: number; reading: string } | null {
  const at = candidates.findIndex(
    (candidate) => candidate.match_status !== "matching",
  );
  if (at === -1) return null;

  const below = candidates.length - at;
  const counted = BELOW_CAUSES.map((cause) => ({
    words: cause.words,
    count: candidates.filter(cause.applies).length,
  })).filter((cause) => cause.count > 0);

  const causes = counted
    .map((cause, index) =>
      index === 0 && cause.words.startsWith("by ")
        ? `${round(cause.count)} ruled out ${cause.words}`
        : `${round(cause.count)} ${cause.words}`,
    )
    .join(", ");
  const overlap = counted.reduce((sum, cause) => sum + cause.count, 0) > below;

  return {
    at,
    reading:
      `${round(below)} ${below === 1 ? "candidate" : "candidates"} below — ${causes}` +
      (overlap ? " (some for more than one reason)" : ""),
  };
}

const REASON_KINDS = ["criterion", "match_rule", "compound_rule"] as const;

function ruledOutBy(
  kind: (typeof REASON_KINDS)[number],
): (candidate: Judged) => boolean {
  return (candidate) =>
    candidate.match_status === "not_matching" &&
    (candidate.non_match_reasons ?? []).some((reason) => Boolean(reason[kind]));
}

const BELOW_CAUSES: readonly { words: string; applies: (candidate: Judged) => boolean }[] = [
  { words: "by a threshold you set", applies: ruledOutBy("criterion") },
  { words: "by a gate", applies: ruledOutBy("match_rule") },
  { words: "by a compound rule", applies: ruledOutBy("compound_rule") },
  {
    words: "with no reason given",
    applies: (candidate) =>
      candidate.match_status === "not_matching" &&
      !(candidate.non_match_reasons ?? []).some((reason) =>
        REASON_KINDS.some((kind) => Boolean(reason[kind])),
      ),
  },
  {
    words: "without enough data to score",
    applies: (candidate) => candidate.match_status === "insufficient_data",
  },
];

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

/**
 * What is known about the household's home, as the Δ home note needs it (PL-081).
 *
 * `not_configured` only on the server's own `household_not_configured`; any other failure is
 * `unknown`, because a read that failed says nothing about whether a home was recorded.
 */
export type HomeRead =
  | { state: "ready"; household: AtHome }
  | { state: "not_configured" }
  | { state: "unknown" };

/** A ranked row as the Δ home note reads one. */
export interface Measured {
  candidate: string;
  score: number | null;
  delta_vs_home?: number | null;
}

const NOTHING_TO_MEASURE = "so Δ home has nothing to measure against.";

/**
 * Why no row has a difference against home, or null where some row has one or the reason is
 * not known.
 *
 * **Said once, under the table, and only when the whole column is a dash** (PL-081). A single
 * dash is answered by its own row -- home itself, or a candidate with no score -- but a column
 * of nothing but dashes reads as a broken column unless something says why.
 */
export function emptyDeltaNote(
  candidates: readonly Measured[],
  home: HomeRead,
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.some((candidate) => typeof candidate.delta_vs_home === "number")) {
    return null;
  }
  if (home.state === "not_configured") {
    return "No home country is recorded, so there is nothing to measure Δ home against.";
  }
  if (home.state === "unknown") return null;

  const homes = homeCandidates(home.household);
  const homeRow = candidates.find((candidate) => homes.has(candidate.candidate));
  if (homeRow === undefined) {
    return `Your home is not among the candidates ranked here, ${NOTHING_TO_MEASURE}`;
  }
  if (homeRow.score === null) {
    return `Your home has no score under this criteria set, ${NOTHING_TO_MEASURE}`;
  }
  return null;
}
