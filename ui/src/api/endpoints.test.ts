/**
 * What the wrappers actually put on the wire.
 *
 * **The body shape is a protocol, not a detail.** Three of these endpoints take fields the
 * server applies in a fixed order -- a weight before the flags beside it -- so a wrapper that
 * sends two together can express a change the server will always refuse. That is how a locked
 * pillar became impossible to unlock (P68) and it is why each of these is sent alone.
 */

import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockServer } from "../mocks/server";
import {
  fetchEveryRun,
  fetchValues,
  fetchValuesFromRun,
  updateCriterionLock,
  updateCriterionWeight,
  updatePillarLock,
  updatePillarWeight,
} from "./endpoints";

/** Captures the body of the next write to `path`, whatever the handler then answers. */
function bodySentTo(method: "patch" | "put", path: string): { seen: unknown } {
  const captured: { seen: unknown } = { seen: undefined };
  mockServer.use(
    http[method](path, async ({ request }) => {
      captured.seen = await request.json();
      return HttpResponse.json({ pillar: "economics", criteria: [], items: [] });
    }),
  );
  return captured;
}

const CRITERION = "/v1/criteria-sets/:id/criteria/:attribute";
const PILLAR = "/v1/criteria-sets/:id/pillar-weights/:pillar";

/**
 * **`is_scored` has no wrapper here, deliberately.** The contract accepts it and the backend
 * honours it, and the design -- scope-locked 2026-09-20 -- places no include/exclude control
 * anywhere: an attribute that should not count is dragged to a weight of 0, which its slider
 * (0-60) allows. A wrapper nobody can reach is a wrapper that rots, so the capability stays
 * where it is reachable: a migration. See P90 in `known-issues.md`.
 */
describe("changing one criterion", () => {
  it("sends a weight alone", async () => {
    const body = bodySentTo("patch", CRITERION);

    await updateCriterionWeight("alex", "country.rent", 40);

    expect(body.seen).toEqual({ weight: 40 });
  });

  it("sends a lock alone, because a locked weight cannot be moved", async () => {
    const body = bodySentTo("patch", CRITERION);

    await updateCriterionLock("alex", "country.rent", true);

    expect(body.seen).toEqual({ weight_locked: true });
  });


});

describe("changing one pillar", () => {
  it("sends a weight alone", async () => {
    const body = bodySentTo("put", PILLAR);

    await updatePillarWeight("alex", "economics", 25);

    expect(body.seen).toEqual({ weight: 25 });
  });

  it("sends a lock with no weight at all", async () => {
    // The whole of P68: a weight in this body is refused before the flag is read, so a lock
    // sent with one can be set and never released.
    const body = bodySentTo("put", PILLAR);

    await updatePillarLock("alex", "economics", false);

    expect(body.seen).toEqual({ weight_locked: false });
    expect(body.seen).not.toHaveProperty("weight");
  });
});

/** One page of `rows`, cut as the server cuts it from the query's `limit` and `offset`. */
function pageOf(
  rows: readonly { id: number }[],
  query: URLSearchParams,
): { items: { id: number }[]; total: number } {
  const offset = Number(query.get("offset") ?? 0);
  const limit = Number(query.get("limit") ?? rows.length);
  return { items: rows.slice(offset, offset + limit), total: rows.length };
}

function rowsOf(count: number): { id: number }[] {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

/**
 * `count` rows at `path`, each distinguishable, served with whatever paging the caller asks
 * for. Every query is kept, so a test can count the pages and read what each one asked.
 */
function servePaged(
  path: string,
  count: number,
): { pages: number; queries: URLSearchParams[] } {
  const rows = rowsOf(count);
  const seen = { pages: 0, queries: [] as URLSearchParams[] };
  mockServer.use(
    http.get(path, ({ request }) => {
      const query = new URL(request.url).searchParams;
      seen.pages += 1;
      seen.queries.push(query);
      return HttpResponse.json(pageOf(rows, query));
    }),
  );
  return seen;
}

/**
 * A row written while the pages are read. It lands at the head of the list once the first page
 * has been served, so every later row moves down by one and the second page starts with the
 * row the first page ended on.
 */
function serveAListThatGrowsBetweenPages(path: string, count: number): void {
  const rows = rowsOf(count);
  mockServer.use(
    http.get(path, ({ request }) => {
      const page = pageOf(rows, new URL(request.url).searchParams);
      if (rows.length === count) rows.unshift({ id: count });
      return HttpResponse.json(page);
    }),
  );
}

/** Serves the first page of a long list and refuses every page after it. */
function serveAListWhoseSecondPageFails(path: string): void {
  const rows = rowsOf(2000);
  mockServer.use(
    http.get(path, ({ request }) => {
      const query = new URL(request.url).searchParams;
      if (Number(query.get("offset") ?? 0) > 0) {
        return HttpResponse.json(
          { code: "internal_error", message: "the second page could not be read" },
          { status: 500 },
        );
      }
      return HttpResponse.json(pageOf(rows, query));
    }),
  );
}

function idsOf(items: readonly { id: number }[]): number[] {
  return items.map((item) => item.id);
}

describe("reading every value one run wrote", () => {
  const aCorpusOf = (count: number) => servePaged("/v1/values", count);

  it("follows the pages rather than taking the first one", async () => {
    // **A country run writes about 1 376 values** -- 32 candidates times ~43 attributes --
    // and this used to ask for 1 000 and discard `total`, so the acquisition diff compared a
    // truncated page against a full one (P89).
    const seen = aCorpusOf(1376);

    const { items, total } = await fetchValuesFromRun(7);

    expect(items).toHaveLength(1376);
    expect(total).toBe(1376);
    expect(seen.pages).toBeGreaterThan(1);
  });

  it("asks once when one page holds everything", async () => {
    const seen = aCorpusOf(12);

    const { items } = await fetchValuesFromRun(7);

    expect(items).toHaveLength(12);
    expect(seen.pages).toBe(1);
  });

  it("stops on a server that over-reports how much it has", async () => {
    // A `total` larger than the server will serve would otherwise spin here for ever, which
    // is a hung screen rather than a wrong number -- worse, and worth one extra condition.
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({ items: [{ id: 1 }], total: 9999 }),
      ),
    );

    const { items } = await fetchValuesFromRun(7);

    expect(items).toHaveLength(1);
  });

  it("returns nothing for a run that wrote nothing", async () => {
    aCorpusOf(0);

    expect((await fetchValuesFromRun(7)).items).toEqual([]);
  });

  it("keeps one copy of a value served on two pages", async () => {
    serveAListThatGrowsBetweenPages("/v1/values", 600);

    const { items } = await fetchValuesFromRun(7);

    expect(new Set(idsOf(items)).size).toBe(items.length);
    expect(items).toHaveLength(600);
  });

  it("rejects rather than returning part of the run when a page fails", async () => {
    serveAListWhoseSecondPageFails("/v1/values");

    await expect(fetchValuesFromRun(7)).rejects.toMatchObject({
      code: "internal_error",
    });
  });
});

/**
 * UI-16. **The drill-down is titled "Every stored value"**, and it asked for one page of 500 and
 * kept it: a candidate past five hundred figures silently lost the rest.
 */
describe("reading every value one candidate has", () => {
  const aCandidateWith = (count: number) => servePaged("/v1/values", count);

  it("follows the pages rather than taking the first one", async () => {
    const seen = aCandidateWith(1201);

    const { items, total } = await fetchValues("country.malta");

    expect(items).toHaveLength(1201);
    expect(total).toBe(1201);
    expect(seen.pages).toBeGreaterThan(1);
  });

  it("asks once when one page holds everything", async () => {
    const seen = aCandidateWith(12);

    const { items } = await fetchValues("country.malta");

    expect(items).toHaveLength(12);
    expect(seen.pages).toBe(1);
  });

  /** Superseded and rejected figures are the drill-down's point, on every page as on the first. */
  it("asks for the candidate's superseded values on every page", async () => {
    const seen = aCandidateWith(1201);

    await fetchValues("country.malta");

    expect(seen.queries.map((query) => query.get("include_superseded"))).toEqual(
      ["true", "true", "true"],
    );
    expect(seen.queries.map((query) => query.get("candidate"))).toEqual([
      "country.malta",
      "country.malta",
      "country.malta",
    ]);
  });

  it("stops on a server that over-reports how much it has", async () => {
    mockServer.use(
      http.get("/v1/values", () =>
        HttpResponse.json({ items: [{ id: 1 }], total: 9999 }),
      ),
    );

    const { items } = await fetchValues("country.malta");

    expect(items).toHaveLength(1);
  });

  it("returns nothing for a candidate with no stored value", async () => {
    aCandidateWith(0);

    expect((await fetchValues("country.malta")).items).toEqual([]);
  });

  it("keeps one row for a value served on two pages", async () => {
    serveAListThatGrowsBetweenPages("/v1/values", 600);

    const { items } = await fetchValues("country.malta");

    expect(new Set(idsOf(items)).size).toBe(items.length);
    expect(items).toHaveLength(600);
  });

  it("rejects rather than returning part of the values when a page fails", async () => {
    serveAListWhoseSecondPageFails("/v1/values");

    await expect(fetchValues("country.malta")).rejects.toMatchObject({
      code: "internal_error",
    });
  });
});

/**
 * UI-17. **Acquire asked for the ten newest runs**, and the history, the diff's choices and
 * "Spent this month" all read that one page as though it were every run.
 */
describe("reading every run", () => {
  const aHistoryOf = (count: number) =>
    servePaged("/v1/data-acquisition-runs", count);

  it("follows the pages rather than taking the first one", async () => {
    const seen = aHistoryOf(250);

    const { items, total } = await fetchEveryRun();

    expect(items).toHaveLength(250);
    expect(total).toBe(250);
    expect(seen.pages).toBe(3);
  });

  it("asks once when one page holds everything", async () => {
    const seen = aHistoryOf(12);

    const { items } = await fetchEveryRun();

    expect(items).toHaveLength(12);
    expect(seen.pages).toBe(1);
  });

  it("stops on a server that over-reports how much it has", async () => {
    mockServer.use(
      http.get("/v1/data-acquisition-runs", () =>
        HttpResponse.json({ items: [{ id: 1 }], total: 9999 }),
      ),
    );

    const { items } = await fetchEveryRun();

    expect(items).toHaveLength(1);
  });

  it("returns nothing when no run has been started", async () => {
    aHistoryOf(0);

    expect((await fetchEveryRun()).items).toEqual([]);
  });

  /** A run started while the history is read pushes every older run down by one. */
  it("keeps one copy of a run that moves between pages", async () => {
    serveAListThatGrowsBetweenPages("/v1/data-acquisition-runs", 150);

    const { items } = await fetchEveryRun();

    expect(new Set(idsOf(items)).size).toBe(items.length);
    expect(items).toHaveLength(150);
  });

  it("rejects rather than returning part of the history when a page fails", async () => {
    serveAListWhoseSecondPageFails("/v1/data-acquisition-runs");

    await expect(fetchEveryRun()).rejects.toMatchObject({
      code: "internal_error",
    });
  });
});
