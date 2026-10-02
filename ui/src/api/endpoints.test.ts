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
  fetchValuesFromRun,
  updateCriterionLock,
  updateCriterionScored,
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

  it("sends the scoring flag alone", async () => {
    // **The first thing the Roles section says a user does**, and it had no client at all
    // (P86): the contract accepts `is_scored`, the backend honours it, and nothing could
    // send it. The three criteria excluded in the shipped sets got there by migration.
    const body = bodySentTo("patch", CRITERION);

    await updateCriterionScored("alex", "country.climate_zone", false);

    expect(body.seen).toEqual({ is_scored: false });
  });

  it("can put an excluded criterion back", async () => {
    const body = bodySentTo("patch", CRITERION);

    await updateCriterionScored("alex", "country.climate_zone", true);

    expect(body.seen).toEqual({ is_scored: true });
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

describe("reading every value one run wrote", () => {
  /** `count` rows, each distinguishable, served with whatever paging the caller asks for. */
  function aCorpusOf(count: number): { pages: number } {
    const rows = Array.from({ length: count }, (_, index) => ({ id: index }));
    const seen = { pages: 0 };
    mockServer.use(
      http.get("/v1/values", ({ request }) => {
        const query = new URL(request.url).searchParams;
        const offset = Number(query.get("offset") ?? 0);
        const limit = Number(query.get("limit") ?? rows.length);
        seen.pages += 1;
        return HttpResponse.json({
          items: rows.slice(offset, offset + limit),
          total: rows.length,
        });
      }),
    );
    return seen;
  }

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
});
