import { describe, expect, it } from "vitest";
import { describeFailures, failureGroups } from "./failureGroups";

/**
 * The shape the Acquire screen's failure list is built from.
 *
 * The rule these tests hold is that **one message repeated is one problem**: the shipped run
 * that prompted this failed 32 times on one billing state, and a list with a row each told the
 * reader nothing a row with a count does not.
 */

/** The run that prompted all of this: no credit on the key, and every country asked. */
const CREDIT =
  "Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', " +
  "'message': 'Your credit balance is too low to access the Anthropic API.'}}";

function creditFailures(countries: readonly string[]) {
  return countries.map((candidate) => ({
    data_source: "llm",
    candidate,
    attribute: "country.pension_portability",
    error_message: CREDIT,
  }));
}

describe("grouping a run's failures", () => {
  it("has nothing to group when nothing failed", () => {
    expect(failureGroups([])).toEqual([]);
  });

  /** `failures` is optional in the contract, so an absent array is not an empty one. */
  it("has nothing to group when the run reports no failures at all", () => {
    expect(failureGroups(null)).toEqual([]);
    expect(failureGroups(undefined)).toEqual([]);
  });

  it("keeps a single failure as a single group", () => {
    const groups = failureGroups([
      {
        data_source: "oecd",
        candidate: "country.liechtenstein",
        attribute: "country.total_tax_rate_effective",
        error_message: "the cloudflare front answered with a browser challenge",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      source: "oecd",
      tally: "1 item",
      headline: "the cloudflare front answered with a browser challenge",
      items: [
        {
          candidate: "country.liechtenstein",
          attribute: "country.total_tax_rate_effective",
        },
      ],
    });
  });

  /** The complaint, in one assertion: thirty-two identical messages are one row. */
  it("collapses one message repeated into one group with a count", () => {
    const groups = failureGroups(
      creditFailures([
        "country.austria",
        "country.belgium",
        "country.croatia",
        "country.denmark",
      ]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tally).toBe("4 items");
    expect(groups[0]?.items).toHaveLength(4);
  });

  it("keeps two different messages from one source apart", () => {
    const groups = failureGroups([
      ...creditFailures(["country.austria", "country.belgium"]),
      {
        data_source: "llm",
        candidate: "country.cyprus",
        attribute: "country.pension_portability",
        error_message: "the model read no page that answered",
      },
    ]);

    expect(groups.map((group) => group.tally)).toEqual(["2 items", "1 item"]);
    // Both are the same source, so both rows say so -- a reader scanning the list is choosing
    // which source to do something about.
    expect(groups.map((group) => group.source)).toEqual(["llm", "llm"]);
  });

  it("puts the source that failed most at the top and keeps its groups together", () => {
    const groups = failureGroups([
      {
        data_source: "oecd",
        candidate: "country.malta",
        attribute: "country.childcare_cost",
        error_message: "a browser challenge",
      },
      ...creditFailures(["country.austria", "country.belgium"]),
      {
        data_source: "llm",
        candidate: "country.cyprus",
        attribute: "country.pension_portability",
        error_message: "the model read no page that answered",
      },
    ]);

    // Three failures from `llm` beat one from `oecd`, whatever order the run reported them in.
    expect(groups.map((group) => group.source)).toEqual([
      "llm",
      "llm",
      "oecd",
    ]);
  });

  it("orders two equally bad sources by name, so a second read agrees with the first", () => {
    const groups = failureGroups([
      {
        data_source: "who",
        candidate: "country.malta",
        attribute: "country.life_expectancy",
        error_message: "timed out",
      },
      {
        data_source: "imf",
        candidate: "country.malta",
        attribute: "country.gdp_per_capita",
        error_message: "timed out",
      },
    ]);

    expect(groups.map((group) => group.source)).toEqual(["imf", "who"]);
  });

  /**
   * Two complaints of the same size from one source: the count cannot separate them, so the
   * message does. **A sort with an undecided case is a list that reorders itself between
   * reads**, which makes a reader doubt the figures rather than the ordering.
   */
  it("orders two equally large complaints from one source by their message", () => {
    const groups = failureGroups([
      {
        data_source: "oecd",
        candidate: "country.malta",
        attribute: "country.childcare_cost",
        error_message: "a browser challenge",
      },
      {
        data_source: "oecd",
        candidate: "country.cyprus",
        attribute: "country.childcare_cost",
        error_message: "timed out",
      },
    ]);

    expect(groups.map((group) => group.headline)).toEqual([
      "a browser challenge",
      "timed out",
    ]);
  });

  /** One country can fail on two attributes under one message, so the candidate cannot order them. */
  it("breaks a tie between two items on one candidate by attribute", () => {
    const groups = failureGroups([
      {
        data_source: "oecd",
        candidate: "country.malta",
        attribute: "country.childcare_cost",
        error_message: "a browser challenge",
      },
      {
        data_source: "oecd",
        candidate: "country.malta",
        attribute: "country.birth_rate",
        error_message: "a browser challenge",
      },
    ]);

    expect(groups[0]?.items.map((item) => item.attribute)).toEqual([
      "country.birth_rate",
      "country.childcare_cost",
    ]);
  });

  it("sorts the items inside a group, rather than serving them as the run asked", () => {
    const groups = failureGroups(
      creditFailures(["country.denmark", "country.austria", "country.croatia"]),
    );

    expect(groups[0]?.items.map((item) => item.candidate)).toEqual([
      "country.austria",
      "country.croatia",
      "country.denmark",
    ]);
  });
});

describe("what a collapsed failure row says", () => {
  /**
   * The heart of it: a provider wraps the one useful sentence inside a serialised payload, and
   * shortening that payload from the left gives a row as unreadable as the list it replaced.
   */
  it("reads the sentence out of a serialised error payload", () => {
    const groups = failureGroups(creditFailures(["country.austria"]));

    expect(groups[0]?.headline).toBe(
      "Your credit balance is too low to access the Anthropic API.",
    );
  });

  it("keeps the whole payload for the reader who opens the group", () => {
    const groups = failureGroups(creditFailures(["country.austria"]));

    expect(groups[0]?.message).toBe(CREDIT);
  });

  it("falls back to the message itself when there is no field to read", () => {
    const groups = failureGroups([
      {
        data_source: "eurostat",
        candidate: "country.malta",
        attribute: "country.homicide_rate",
        error_message: "the dataset moved",
      },
    ]);

    expect(groups[0]?.headline).toBe("the dataset moved");
  });

  it("shortens a sentence too long for a row, at a word", () => {
    const long = `${"policy ".repeat(30)}end`;
    const groups = failureGroups([
      { data_source: "llm", candidate: "c", attribute: "a", error_message: long },
    ]);

    const headline = groups[0]?.headline ?? "";
    expect(headline.endsWith("…")).toBe(true);
    expect(headline.length).toBeLessThanOrEqual(121);
    expect(headline).not.toContain("polic…");
  });

  it("shortens a single unbroken run of characters rather than giving up", () => {
    const groups = failureGroups([
      {
        data_source: "llm",
        candidate: "c",
        attribute: "a",
        error_message: "x".repeat(400),
      },
    ]);

    expect(groups[0]?.headline).toBe(`${"x".repeat(120)}…`);
  });

  it("leaves a sentence that already fits exactly as it is", () => {
    const groups = failureGroups([
      { data_source: "llm", candidate: "c", attribute: "a", error_message: "no" },
    ]);

    expect(groups[0]?.headline).toBe("no");
  });

  /** A stack trace in a collapsed row makes the row three rows tall -- the fault, in miniature. */
  it("folds a multi-line message onto one line", () => {
    const groups = failureGroups([
      {
        data_source: "oecd",
        candidate: "c",
        attribute: "a",
        error_message: "  Traceback:\n  line one\n\n  line two  ",
      },
    ]);

    expect(groups[0]?.headline).toBe("Traceback: line one line two");
  });
});

describe("a failure the run described incompletely", () => {
  it("still shows a failure whose source it did not name", () => {
    const groups = failureGroups([
      { candidate: "country.malta", attribute: "country.homicide_rate", error_message: "broke" },
    ]);

    expect(groups[0]?.source).toBe("unnamed");
  });

  it("says a source failed without saying why, rather than showing an empty row", () => {
    const groups = failureGroups([
      {
        data_source: "oecd",
        candidate: "country.malta",
        attribute: "country.childcare_cost",
        error_message: "   ",
      },
    ]);

    expect(groups[0]?.headline).toBe("The source failed without saying why.");
  });

  it("names neither half of an item it was given neither half of", () => {
    const groups = failureGroups([
      { data_source: "oecd", error_message: "broke" },
    ]);

    expect(groups[0]?.items).toEqual([
      { candidate: "unnamed", attribute: "unnamed" },
    ]);
  });

  /** Two blank messages from one source are one problem, not two. */
  it("groups silent failures together", () => {
    const groups = failureGroups([
      { data_source: "oecd", candidate: "a", attribute: "x", error_message: null },
      { data_source: "oecd", candidate: "b", attribute: "x" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tally).toBe("2 items");
  });
});

describe("the line above the failure list", () => {
  it("says nothing failed when nothing did", () => {
    expect(describeFailures([])).toBe("Nothing failed in this acquisition.");
    expect(describeFailures(undefined)).toBe(
      "Nothing failed in this acquisition.",
    );
  });

  it("counts one failure in the singular throughout", () => {
    expect(
      describeFailures([
        { data_source: "oecd", candidate: "c", attribute: "a", error_message: "broke" },
      ]),
    ).toContain("1 failure from 1 source, 1 distinct message.");
  });

  /**
   * The count that answers the complaint. "32 failures" reads as thirty-two problems; the
   * third figure says in four words that it is one problem with a wide blast radius.
   */
  it("separates how many failures there were from how many things are wrong", () => {
    const summary = describeFailures(
      creditFailures([
        "country.austria",
        "country.belgium",
        "country.croatia",
      ]),
    );

    expect(summary).toContain("3 failures from 1 source, 1 distinct message.");
  });

  it("counts the sources and the messages separately", () => {
    const summary = describeFailures([
      ...creditFailures(["country.austria", "country.belgium"]),
      {
        data_source: "oecd",
        candidate: "country.malta",
        attribute: "country.childcare_cost",
        error_message: "a browser challenge",
      },
    ]);

    expect(summary).toContain("3 failures from 2 sources, 2 distinct messages.");
  });
});
