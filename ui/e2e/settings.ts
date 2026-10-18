import { expect, type APIRequestContext } from "@playwright/test";

/**
 * The settings as the API serves them. **A failed read is refused**, never read as settings.
 *
 * Shared by the specs that put a setting back after changing it (NEW-32): a restore built from a
 * read that failed sends a body without the field, and `PUT /v1/settings` replaces the settings
 * whole -- which clears the household's own choice in the database this suite runs against.
 */
export async function readSettings(
  request: APIRequestContext,
): Promise<Record<string, unknown>> {
  const response = await request.get("/v1/settings");
  expect(
    response.ok(),
    `the settings could not be read: HTTP ${response.status()}`,
  ).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}
