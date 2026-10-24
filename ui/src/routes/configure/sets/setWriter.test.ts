import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * G5. **One writer of sets, and it records what it writes** (PL-033, D-C03-9).
 *
 * A set verb sent from anywhere else would change the configuration without an entry in Recent
 * changes, and the undo of everything noted after it would then run over a state it never saw.
 * So the five set operations are imported by `useCriteriaSets.ts` alone, and there every verb
 * it sends is sent beside a `note`.
 */

const SOURCE = join(__dirname, "..", "..", "..");
const WRITER = "routes/configure/sets/useCriteriaSets.ts";
const RECORDED = [
  "createCriteriaSet",
  "renameCriteriaSet",
  "duplicateCriteriaSet",
  "deleteCriteriaSet",
];
const SET_OPERATIONS = [...RECORDED, "restoreCriteriaSet"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** The set operations a file imports from the endpoints module. */
function setOperationsImportedBy(file: ts.SourceFile): string[] {
  const imported: string[] = [];
  walk(file, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    if (!node.moduleSpecifier.text.endsWith("api/endpoints")) return;
    const bindings = node.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) return;
    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      if (SET_OPERATIONS.includes(name)) imported.push(name);
    }
  });
  return imported;
}

function calledName(node: ts.CallExpression): string | undefined {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

function nearestFunction(node: ts.Node): ts.Node | undefined {
  let at = node.parent;
  while (at !== undefined && !ts.isFunctionLike(at)) at = at.parent;
  return at;
}

function callsNote(scope: ts.Node): boolean {
  let found = false;
  walk(scope, (node) => {
    if (ts.isCallExpression(node) && calledName(node) === "note") found = true;
  });
  return found;
}

/**
 * The recorded verbs the writer sends beside a `note`: in the same function as one. A call
 * inside an undo's `reverse` is the reverse of another verb, and notes nothing itself.
 */
function verbsSentWithANote(file: ts.SourceFile): Set<string> {
  const noted = new Set<string>();
  walk(file, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = calledName(node);
    if (name === undefined || !RECORDED.includes(name)) return;
    const scope = nearestFunction(node);
    if (scope !== undefined && callsNote(scope)) noted.add(name);
  });
  return noted;
}

describe("the criteria-set writer", () => {
  it("is the only module that imports a set operation", () => {
    const importers = sourceFiles(SOURCE)
      .filter((path) => setOperationsImportedBy(parse(path)).length > 0)
      .map((path) => relative(SOURCE, path));

    expect(importers).toEqual([WRITER]);
  });

  it("notes every verb it sends in Recent changes", () => {
    const writer = parse(join(SOURCE, WRITER));

    expect([...verbsSentWithANote(writer)].sort()).toEqual([...RECORDED].sort());
  });
});
