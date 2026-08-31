/**
 * Presentation configuration, fetched at runtime.
 *
 * The application display name is the only thing in here, and it is here rather than in the
 * API because renaming the product must be a one-line change to a served file -- not a code
 * change, and not a rebuild of the bundle (CLAUDE.md, "the app is named Starnest, the code is
 * not"). A Vite `import.meta.env` variable would have baked the name into the JavaScript at
 * build time, which is exactly the outcome the rule forbids.
 *
 * **Presentation only.** No domain configuration belongs here: the comparator limit, the score
 * scale and `min_coverage` are settings the backend owns and serves from `GET /v1/settings`.
 */

const CONFIG_URL = "/config.json";

export interface AppConfig {
  /** Shown in the sidebar heading and the browser tab. Never a compiled-in constant. */
  displayName: string;
}

export class AppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppConfigError";
  }
}

/**
 * Reads and validates `/config.json`.
 *
 * Throws rather than falling back to a built-in name. A default would be a hardcoded product
 * name in the bundle, which is the one thing this file exists to prevent -- and a name shown
 * without knowing whether it is the configured one is a fabricated fact, which the project
 * does not do anywhere else either.
 */
export async function loadAppConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  let response: Response;
  try {
    response = await fetchImpl(CONFIG_URL, { headers: { Accept: "application/json" } });
  } catch (cause) {
    throw new AppConfigError(`${CONFIG_URL} could not be fetched: ${String(cause)}`);
  }

  if (!response.ok) {
    throw new AppConfigError(`${CONFIG_URL} returned HTTP ${response.status}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AppConfigError(`${CONFIG_URL} is not valid JSON.`);
  }

  return { displayName: readDisplayName(body) };
}

function readDisplayName(body: unknown): string {
  if (typeof body !== "object" || body === null || !("display_name" in body)) {
    throw new AppConfigError(`${CONFIG_URL} has no "display_name".`);
  }

  const displayName = (body as { display_name: unknown }).display_name;
  if (typeof displayName !== "string" || displayName.trim() === "") {
    throw new AppConfigError(`${CONFIG_URL} has a "display_name" that is not a non-empty string.`);
  }

  return displayName;
}
