import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Whether `src/api/schema.ts` still matches the contract it was generated from.
 *
 * **This test exists because its absence hid a defect for days.** `openapi.yaml` gained
 * `RunRequest` -- the accept-an-uncapped-spend bypass of `reqs.md` 6.3 -- and nobody
 * regenerated the client, so the flag could not be sent from the interface at all and the 409
 * it answers was a dead end on screen. The drift was invisible until an unrelated change made
 * the file move (`known-issues.md` P32).
 *
 * **Nothing was watching, by design rather than by accident.** The backend's
 * `test_contract_drift.py` holds the *server* to the contract, and the interface is a separate
 * client that shares no code with it (`arch.md` 6.1) -- so neither side's checks looked at this
 * file. This is the interface's half of the same idea.
 *
 * It regenerates into a temporary file and compares, rather than trusting a timestamp: what
 * matters is whether the committed client says what the contract says, not when it was written.
 */

const CONTRACT = join(__dirname, "..", "..", "..", "docs", "openapi.yaml");
const COMMITTED = join(__dirname, "..", "api", "schema.ts");

const scratch = mkdtempSync(join(tmpdir(), "starnest-client-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the generated client", () => {
  it("is what the contract would produce today", () => {
    const fresh = join(scratch, "schema.ts");

    execFileSync("npx", ["openapi-typescript", CONTRACT, "-o", fresh], {
      stdio: "pipe",
    });

    expect(readFileSync(COMMITTED, "utf8")).toBe(readFileSync(fresh, "utf8"));
  }, 60_000);
});
