import { describe, expect, it } from "vitest";
import {
  PILLAR_CHART,
  codesByCandidate,
  confidenceBands,
  confidenceLabel,
  confidenceReadings,
  coverageBar,
  emptyDeltaNote,
  excludedBand,
  homeCandidates,
  pillarBars,
} from "./rankTable";

describe("the coverage bar", () => {
  it.each([
    [90, "good"],
    [75, "good"],
    [70, "fair"],
    [60, "fair"],
    [59.9, "weak"],
    [0, "weak"],
  ])("reads %s%% as %s", (coverage, tone) => {
    expect(coverageBar(coverage).tone).toBe(tone);
  });

  it("carries the percentage through as a width", () => {
    expect(coverageBar(73.4).width).toBe("73.4%");
  });

  it("treats a missing coverage as nothing covered rather than as full width", () => {
    expect(coverageBar(null)).toEqual({ width: "0%", tone: "weak" });
    expect(coverageBar(undefined).width).toBe("0%");
  });

  it("clamps a figure outside the scale instead of drawing past the track", () => {
    expect(coverageBar(140).width).toBe("100%");
    expect(coverageBar(-20).width).toBe("0%");
  });
});

describe("the confidence bands", () => {
  const split = { absolute: 0, high: 82.5, medium: 11, low: 6.5 };

  it("orders them strongest first, whatever order the payload used", () => {
    expect(
      confidenceBands({ low: 6.5, high: 82.5, medium: 11 }).map((b) => b.grade),
    ).toEqual(["high", "medium", "low"]);
  });

  it("leaves out a grade worth nothing rather than drawing it at zero width", () => {
    expect(confidenceBands(split).map((b) => b.grade)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("keeps `absolute`, which the domain defines and the design's own data never had", () => {
    const bands = confidenceBands({ absolute: 40, high: 60 });
    expect(bands.map((b) => b.grade)).toEqual(["absolute", "high"]);
    expect(bands[0]?.tone).toBe("strong");
  });

  it("titles each band so the bar is readable without the legend", () => {
    expect(confidenceBands(split)[0]?.title).toBe(
      "high confidence: 83% of the scored weight",
    );
  });

  it("is empty when nothing was answered, rather than one full-width band", () => {
    expect(confidenceBands(null)).toEqual([]);
    expect(confidenceBands({})).toEqual([]);
  });
});

describe("the confidence label", () => {
  it("reads the split the way the design writes it", () => {
    expect(confidenceLabel({ high: 82.5, medium: 11, low: 6.5 })).toBe(
      "83h / 11m / 7l",
    );
  });

  it("says nothing rather than `0h / 0m / 0l` when there is no split", () => {
    expect(confidenceLabel(undefined)).toBe("—");
  });
});

/**
 * PL-078. **The words beside the bar read high, medium and low always, and absolute only when
 * it carries a share** -- the same test the bar applies. Reading all four always printed
 * "absolute 0%" on every row of the shipped ranking (UF-122).
 */
describe("the confidence readings", () => {
  const readingsOf = (split: Parameters<typeof confidenceReadings>[0]) =>
    confidenceReadings(split).map((each) => each.reading);

  it("leaves absolute out when it carries nothing", () => {
    expect(readingsOf({ absolute: 0, high: 82, medium: 11, low: 7 })).toEqual([
      "high 82%",
      "medium 11%",
      "low 7%",
    ]);
    expect(readingsOf({ high: 90, medium: 10 })).toEqual([
      "high 90%",
      "medium 10%",
      "low 0%",
    ]);
  });

  it("reads absolute first when it carries a share, as the bar draws it", () => {
    expect(readingsOf({ absolute: 40, high: 60, medium: 0, low: 0 })).toEqual([
      "absolute 40%",
      "high 60%",
      "medium 0%",
      "low 0%",
    ]);
  });
});

describe("the pillar chart", () => {
  const roster = [
    { pillar: "economics", score: 80, weight: 16.3, contribution: 13.1 },
    { pillar: "family", score: null, weight: 4, contribution: 0 },
    { pillar: "housing", score: 20, weight: 10, contribution: 2 },
  ];

  it("draws one bar per pillar, in the order they arrive", () => {
    expect(pillarBars(roster, 100).map((b) => b.pillar)).toEqual([
      "economics",
      "family",
      "housing",
    ]);
  });

  it("draws an unscored pillar full height and hatched, never omitted", () => {
    const [, family] = pillarBars(roster, 100);
    // No ramp colour is the signal for "nothing was stored"; the chart hatches it.
    expect(family?.fill).toBeNull();
    expect(family?.height).toBe(PILLAR_CHART.height);
    expect(family?.label).toBe("");
    expect(family?.title).toBe("family: no value stored");
  });

  /**
   * The lowest score still has a body. A bar one pixel tall is indistinguishable from a
   * missing one, and those two mean opposite things.
   */
  it("gives the lowest score a bar with a body rather than a hairline", () => {
    const [lowest] = pillarBars(
      [{ pillar: "x", score: 1, weight: 1, contribution: 0 }],
      100,
    );
    expect(lowest?.height).toBe(19);
    expect(lowest?.label).toBe("1");
  });

  /** 96% of the scale and above fills the band; 40% and below sits at the floor. */
  it("scales a bar across the range the scores actually occupy", () => {
    const [top] = pillarBars([{ pillar: "x", score: 96, weight: 1, contribution: 0 }], 100);
    expect(top?.height).toBe(PILLAR_CHART.height);
    const [middle] = pillarBars([{ pillar: "x", score: 68, weight: 1, contribution: 0 }], 100);
    expect(middle?.height).toBeGreaterThan(19);
    expect(middle?.height).toBeLessThan(PILLAR_CHART.height);
  });

  it("ramps a bar's colour from amber through to teal as it scores", () => {
    const [low] = pillarBars([{ pillar: "a", score: 40, weight: 1, contribution: 1 }], 100);
    const [high] = pillarBars([{ pillar: "b", score: 96, weight: 1, contribution: 1 }], 100);
    // Amber at the floor: red channel far above blue.
    const amber = low!.fill!.bottom.match(/\d+/g)!.map(Number);
    expect(amber[0]).toBeGreaterThan(amber[2]!);
    // Teal at the ceiling: blue and green far above red.
    const teal = high!.fill!.bottom.match(/\d+/g)!.map(Number);
    expect(teal[1]).toBeGreaterThan(teal[0]!);
    expect(teal[2]).toBeGreaterThan(teal[0]!);
  });

  /** Eleven bars in 522px with 2px gutters leaves 45.6px each, and they must not overlap. */
  it("lays the bars out across the chart without overlapping", () => {
    const bars = pillarBars(
      Array.from({ length: 11 }, (_, index) => ({
        pillar: `p${index}`,
        score: 70,
        weight: 1,
        contribution: 1,
      })),
      100,
    );
    expect(bars[0]?.x).toBe(0);
    const last = bars[10]!;
    expect(last.x + last.width).toBeCloseTo(PILLAR_CHART.width, 6);
    expect(bars[1]!.x - (bars[0]!.x + bars[0]!.width)).toBeCloseTo(
      PILLAR_CHART.gap,
      6,
    );
  });

  it("titles each bar, because a stripe of colour explains nothing on its own", () => {
    expect(pillarBars(roster, 100)[0]?.title).toBe("economics: 80, weight 16.3%");
  });

  it("draws nothing when the ranking carried no pillars", () => {
    expect(pillarBars([], 100)).toEqual([]);
    expect(pillarBars(null, 100)).toEqual([]);
  });
  /**
   * PL-062. The top of the score range is a setting, so a bar is drawn against the scale the
   * ranking came with. Clamped to 100, 128 on a scale of 150 printed "100" and stood level with
   * a 96.
   */
  describe("on a scale other than 100", () => {
    const onOneFifty = [
      { pillar: "economics", score: 128, weight: 20, contribution: 25.6 },
      { pillar: "safety", score: 96, weight: 10, contribution: 9.6 },
    ];

    it("prints the score as it came, never clamped to 100", () => {
      const [economics] = pillarBars(onOneFifty, 150);
      expect(economics?.label).toBe("128");
      expect(economics?.title).toBe("economics: 128, weight 20.0%");
    });

    it("draws a higher score taller, above 100 as below it", () => {
      const [economics, safety] = pillarBars(onOneFifty, 150);
      expect(economics!.height).toBeGreaterThan(safety!.height);
    });

    it("fills the band at 96% of the scale and sits at the floor at 40% of it", () => {
      const [top, floor] = pillarBars(
        [
          { pillar: "a", score: 144, weight: 1, contribution: 0 },
          { pillar: "b", score: 60, weight: 1, contribution: 0 },
        ],
        150,
      );
      expect(top?.height).toBe(PILLAR_CHART.height);
      expect(floor?.height).toBe(19);
    });

    it("reads a small scale as its own, so 48 out of 50 fills the band", () => {
      const [top] = pillarBars(
        [{ pillar: "a", score: 48, weight: 1, contribution: 0 }],
        50,
      );
      expect(top?.height).toBe(PILLAR_CHART.height);
    });

    it("draws nothing when the ranking carried no scale to draw against", () => {
      expect(pillarBars(onOneFifty, null)).toEqual([]);
      expect(pillarBars(onOneFifty, undefined)).toEqual([]);
    });
  });
});

describe("where the ranking stops", () => {
  const matching = { match_status: "matching" };
  const threshold = {
    match_status: "not_matching",
    non_match_reasons: [{ criterion: "country.rent", reason_detail: "Rent is too high" }],
  };
  const gated = {
    match_status: "not_matching",
    non_match_reasons: [{ match_rule: "country.visa", reason_detail: "Visa answered not matching" }],
  };
  const compound = {
    match_status: "not_matching",
    non_match_reasons: [{ compound_rule: "cheap_but_taxed", reason_detail: "Cheap but taxed" }],
  };
  const unscored = { match_status: "insufficient_data" };

  it("marks the first candidate that is not in the ranking", () => {
    expect(excludedBand([matching, matching, gated, unscored])?.at).toBe(2);
  });

  /** Nothing to mark: the band would be a line under a list that has not changed meaning. */
  it("is nothing when every candidate matches", () => {
    expect(excludedBand([matching, matching])).toBeNull();
  });

  it("is nothing when there are no candidates at all", () => {
    expect(excludedBand([])).toBeNull();
  });

  /**
   * PL-067, N2. **A threshold, a gate and a compound rule are three different decisions**, and
   * insufficient data is a gap; counting every non-match as a gate blamed a gate for what a
   * threshold the household set had done.
   */
  it("counts thresholds, gates and rules apart, and the gap apart from all three", () => {
    expect(
      excludedBand([matching, threshold, threshold, gated, compound, unscored])?.reading,
    ).toBe(
      "5 candidates below — 2 ruled out by a threshold you set, 1 by a gate, " +
        "1 by a compound rule, 1 without enough data to score",
    );
  });

  /** Only the causes that occur: "0 ruled out by a gate" names a gate that did nothing. */
  it("names only the causes that occur", () => {
    expect(excludedBand([matching, gated, gated])?.reading).toBe(
      "2 candidates below — 2 ruled out by a gate",
    );
  });

  it("says candidate rather than candidates when there is one", () => {
    expect(excludedBand([matching, unscored])?.reading).toBe(
      "1 candidate below — 1 without enough data to score",
    );
  });

  /** One candidate can fail a threshold and a gate at once, so the counts can outrun the total. */
  it("says so when a candidate is below for more than one reason", () => {
    const both = {
      match_status: "not_matching",
      non_match_reasons: [...threshold.non_match_reasons, ...gated.non_match_reasons],
    };
    expect(excludedBand([both, gated])?.reading).toBe(
      "2 candidates below — 1 ruled out by a threshold you set, 2 by a gate " +
        "(some for more than one reason)",
    );
  });

  /** A non-match the server gave no reason for is counted, not silently dropped. */
  it("counts a non-match that carries no reason as one with no reason given", () => {
    expect(
      excludedBand([{ match_status: "not_matching" }, threshold])?.reading,
    ).toBe("2 candidates below — 1 ruled out by a threshold you set, 1 with no reason given");
  });

  /** The whole list can be below the line, and then the band is the first row. */
  it("marks the top when nothing matches at all", () => {
    expect(excludedBand([gated, unscored])?.at).toBe(0);
  });
});

/**
 * PL-081. **Why the whole Δ home column is a dash, said once.** Only on the server's own
 * "not configured" does it say nothing is recorded; a household read that failed says nothing,
 * because a note claiming no home on a failed read would be false.
 */
describe("why no row has a difference against home", () => {
  const portugal = { candidate: "country.portugal", score: 78, delta_vs_home: null };
  const spain = { candidate: "country.spain", score: 64, delta_vs_home: null };
  const atHome = (candidate: string) => ({
    state: "ready" as const,
    household: { home_country_candidate: candidate },
  });

  it("says no home is recorded only when the server says the household is not configured", () => {
    expect(emptyDeltaNote([portugal, spain], { state: "not_configured" })).toBe(
      "No home country is recorded, so there is nothing to measure Δ home against.",
    );
  });

  it("says nothing when the household could not be read", () => {
    expect(emptyDeltaNote([portugal, spain], { state: "unknown" })).toBeNull();
  });

  it("says home is not ranked here when no row is home", () => {
    expect(emptyDeltaNote([portugal, spain], atHome("country.romania"))).toBe(
      "Your home is not among the candidates ranked here, so Δ home has nothing to measure against.",
    );
  });

  it("says home has no score under this set when its row has none", () => {
    expect(
      emptyDeltaNote(
        [portugal, { ...spain, score: null }],
        atHome("country.spain"),
      ),
    ).toBe("Your home has no score under this criteria set, so Δ home has nothing to measure against.");
  });

  it("says nothing once any row has a difference", () => {
    expect(
      emptyDeltaNote(
        [{ ...portugal, delta_vs_home: 14 }, spain],
        atHome("country.spain"),
      ),
    ).toBeNull();
  });

  it("says nothing about an empty ranking", () => {
    expect(emptyDeltaNote([], { state: "not_configured" })).toBeNull();
  });
});

describe("the flag beside a candidate", () => {
  it("maps a candidate to the code the catalog holds", () => {
    const codes = codesByCandidate([
      { id: "country.netherlands", country_code: "NL" },
      { id: "country.portugal", country_code: "PT" },
    ]);
    expect(codes.get("country.netherlands")).toBe("NL");
  });

  /**
   * **No code, no flag.** A city belongs to a country but is not one, and guessing from the
   * name would put the wrong flag beside Lisbon or none beside Liechtenstein.
   */
  it("leaves out a candidate the catalog gives no code", () => {
    const codes = codesByCandidate([
      { id: "city.lisbon" },
      { id: "city.porto", country_code: null },
    ]);
    expect(codes.size).toBe(0);
  });

  it("is empty before the roster arrives", () => {
    expect(codesByCandidate(null).size).toBe(0);
  });
});

describe("the home pill", () => {
  it("marks the country the household lives in", () => {
    const home = homeCandidates({
      home_country_candidate: "country.romania",
      home_city_candidate: null,
    });
    expect(home.has("country.romania")).toBe(true);
    expect(home.size).toBe(1);
  });

  /**
   * **Both, because the ranking is drawn per level and this set is not.** A city level whose
   * home row went unmarked would be the same screen telling the truth about countries and
   * saying nothing about cities.
   */
  it("marks the home city as well as the home country", () => {
    const home = homeCandidates({
      home_country_candidate: "country.romania",
      home_city_candidate: "city.bucharest",
    });
    expect([...home].sort()).toEqual(["city.bucharest", "country.romania"]);
  });

  it("marks nothing before the household arrives", () => {
    expect(homeCandidates(null).size).toBe(0);
    expect(homeCandidates(undefined).size).toBe(0);
  });
});
