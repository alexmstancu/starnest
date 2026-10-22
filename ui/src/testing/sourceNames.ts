import { HttpResponse, http } from "msw";
import type { DataSource } from "../api/endpoints";
import { DATA_SOURCES } from "../mocks/fixtures";
import { mockServer } from "../mocks/server";

/**
 * The source catalog with more of the real one's names in it (RB-4).
 *
 * **Only a name the id cannot be read into proves the catalog was asked.** The shared fixture's
 * `eurostat` reads "Eurostat" whether a screen looked it up or title-cased the id, so a screen
 * printing the fallback passes on it. The real catalog calls `oecd`, `world_bank` and
 * `eurostat_estimate` "OECD", "World Bank" and "Estimated from Eurostat tax-benefit figures",
 * and no title-casing reaches any of them.
 *
 * **Served beside the fixture's three rather than added to them**, because every attribute's
 * source priority in the fixtures is written against those three: a fourth source there would
 * make each of them a priority the server would never send.
 *
 * Call it before the screen renders: the names are read once per page.
 */
export function serveSourceNames(names: Readonly<Record<string, string>>): void {
  const more: DataSource[] = Object.entries(names).map(([id, name], at) => ({
    id,
    name,
    source_kind: "structured",
    default_priority: 20 + at,
    reliability_tier: "official_international",
    is_enabled: true,
  }));
  mockServer.use(
    http.get("/v1/data-sources", () =>
      HttpResponse.json({ items: [...DATA_SOURCES, ...more] }),
    ),
  );
}
