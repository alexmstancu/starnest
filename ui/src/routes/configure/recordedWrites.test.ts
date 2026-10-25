/**
 * PL-138's guard: **every Configure edit goes into Recent changes.**
 *
 * The client calls that change a criteria set, the household, the settings or the sources are
 * found by the paths they write, not listed by hand, so one added later is caught too. Each may be
 * imported only by a writer this test names, and each of those writers -- or the hook it hands
 * its changes to -- notes the change in the history. A call made anywhere else would change
 * what Configure shows with no entry to undo it, which is what PL-138 closed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(__dirname, "..", "..");

/** The paths whose writes are Configure edits: a set's configuration, and the three records. */
const RECORDED_PATHS = /^"\/(criteria-sets|household|settings|data-sources)\b/;

/** Each writer allowed to import a recorded call, and the file in which it notes the change. */
const WRITERS: Readonly<Record<string, string>> = {
  "routes/configure/useCriteriaEditor.ts": "routes/configure/useCriteriaEditor.ts",
  "routes/configure/pillars/PillarWeightsPanel.tsx": "routes/configure/pillars/useNotePillarChange.ts",
  "routes/configure/pillars/useNotePillarChange.ts": "routes/configure/pillars/useNotePillarChange.ts",
  "routes/configure/rules/ruleSwitches.ts": "routes/configure/rules/useRuleToggles.ts",
  "routes/configure/sets/useCriteriaSets.ts": "routes/configure/sets/useCriteriaSets.ts",
  "routes/configure/sources/useDataSources.ts": "routes/configure/sources/useDataSources.ts",
  "routes/configure/household/useHouseholdForm.ts": "routes/configure/useRecordForm.ts",
  "routes/configure/settings/useSettingsForm.ts": "routes/configure/useRecordForm.ts",
};

function sourceFiles(directory: string = SOURCE): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "mocks" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The endpoint functions whose request writes a recorded path. */
function recordedCalls(): string[] {
  const endpoints = readFileSync(join(SOURCE, "api", "endpoints.ts"), "utf8");
  return [...endpoints.matchAll(/export function (\w+)\(([\s\S]*?)\n}\n/g)]
    .filter(([, , body]) =>
      [...(body ?? "").matchAll(/(?:postJson|putJson|patchJson|deleteResource)\(\s*("[^"]+")/g)]
        .some(([, path]) => RECORDED_PATHS.test(path ?? "")),
    )
    .map(([, name]) => name ?? "");
}

function importsOf(text: string, names: readonly string[]): string[] {
  const imported = [...text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[^"]*api\/endpoints"/g)]
    .flatMap(([, list]) => (list ?? "").split(","))
    .map((each) => each.trim().replace(/^type\s+/, ""));
  return names.filter((name) => imported.includes(name));
}

describe("the Configure edits Recent changes records", () => {
  const calls = recordedCalls();

  it("finds the calls by what they write", () => {
    expect(calls).toEqual(
      expect.arrayContaining([
        "updateCriterionWeight",
        "updateCriterionRule",
        "updatePillarLock",
        "setMatchRuleEnforcement",
        "deleteCriteriaSet",
        "reorderDataSources",
        "replaceHousehold",
        "replaceSettings",
      ]),
    );
  });

  it("lets only the writers import them", () => {
    const strays = sourceFiles()
      .map((path) => relative(SOURCE, path))
      .filter((path) => path !== join("api", "endpoints.ts"))
      .filter((path) => importsOf(readFileSync(join(SOURCE, path), "utf8"), calls).length > 0)
      .filter((path) => !(path in WRITERS));
    expect(strays).toEqual([]);
  });

  it("has every writer note what it changes", () => {
    const silent = [...new Set(Object.values(WRITERS))].filter(
      (path) => !/history\??\.note\(/.test(readFileSync(join(SOURCE, path), "utf8")),
    );
    expect(silent).toEqual([]);
  });
});
