// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "./appConfig";

/**
 * PL-023. The interface's container writes `config.json` from `APP_DISPLAY_NAME` when it starts,
 * so renaming the product in `.env` and restarting renames the interface with no rebuild.
 *
 * The script is run for real against a scratch file, and its output is read by the same
 * `loadAppConfig` the interface boots with -- so what is checked is that a name survives the
 * round trip, not that the script prints some particular text.
 */

const UI_ROOT = join(__dirname, "..", "..");
const SCRIPT = join(UI_ROOT, "docker-entrypoint.d", "40-display-name.sh");
const SCRATCH = join(UI_ROOT, "node_modules", ".display-name-entrypoint-test");
const TARGET = join(SCRATCH, "config.json");
const BAKED = `{\n  "display_name": "Baked in"\n}\n`;

function runWith(name: string | undefined): void {
  const environment: NodeJS.ProcessEnv = { PATH: process.env["PATH"], CONFIG_JSON_PATH: TARGET };
  if (name !== undefined) environment["APP_DISPLAY_NAME"] = name;
  execFileSync("sh", [SCRIPT], { env: environment, stdio: "pipe" });
}

async function servedName(): Promise<string> {
  const body = readFileSync(TARGET, "utf8");
  const fetchFile = () => Promise.resolve(new Response(body, { status: 200 }));
  return (await loadAppConfig(fetchFile)).displayName;
}

beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(TARGET, BAKED);
});

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("the container's display-name entrypoint", () => {
  it("writes the configured name", async () => {
    runWith("Somewhere Else");

    expect(await servedName()).toBe("Somewhere Else");
  });

  it("keeps a quote and a backslash in the name, rather than breaking the JSON", async () => {
    runWith('Al "Nest" \\ Co');

    expect(await servedName()).toBe('Al "Nest" \\ Co');
  });

  it("keeps the name baked in at build time when the variable is empty", async () => {
    runWith("");

    expect(readFileSync(TARGET, "utf8")).toBe(BAKED);
  });

  it("keeps the name baked in at build time when the variable is absent", async () => {
    runWith(undefined);

    expect(await servedName()).toBe("Baked in");
  });
});

describe("the interface image", () => {
  it("copies the entrypoint script where nginx runs it at start", () => {
    const dockerfile = readFileSync(join(UI_ROOT, "Dockerfile"), "utf8");

    expect(dockerfile).toMatch(
      /^COPY\s+(--chmod=\S+\s+)?docker-entrypoint\.d\/40-display-name\.sh\s+\/docker-entrypoint\.d\/40-display-name\.sh\s*$/m,
    );
  });
});
