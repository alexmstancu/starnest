import { expect, type APIRequestContext } from "@playwright/test";

/**
 * A fresh copy of `source` for one worker of a spec, under an id of that worker's own.
 *
 * **One id per worker, because a deleted set keeps its id** (PL-033). Playwright starts a new
 * worker after a failure and runs `beforeAll` again. A spec that deleted its set and copied it
 * again under the same id was refused, so every test after the first failure ran without its
 * set. A copy per worker is fresh every time and never collides. The database is a throwaway
 * copy (`make e2e`), so the sets left behind go with it.
 */
export async function copyForThisWorker(
  api: APIRequestContext,
  source: string,
  base: string,
  workerIndex: number,
): Promise<string> {
  const id = `${base}_w${String(workerIndex)}`;
  const made = await api.post(`/v1/criteria-sets/${source}/duplicate`, { data: { id, name: id } });
  expect(made.ok(), await made.text()).toBe(true);
  return id;
}
