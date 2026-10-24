import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * **The mocks refuse with the server's codes** (PL-003). The contract lists every code the
 * server sends as `ErrorCode`, and the interface branches on the code: a refusal answered with
 * a code the server never sends certifies a branch the real backend can never reach -- the
 * mock kinder than the server, which is how a protocol nobody speaks ships.
 *
 * **Read from the source, not provoked one request at a time**, so a refusal no test happens to
 * reach is held as well. Every `code` the scaffolding writes is read, both branches of a
 * conditional included, and a code the scan cannot read as a literal fails rather than passes.
 */

const SOURCE = join(__dirname, "..");
const SCHEMA = join(SOURCE, "api", "schema.ts");
/** What every test answers from: the msw handlers, their fixtures, and the test helpers. */
const SCAFFOLDING = [join(SOURCE, "mocks"), join(SOURCE, "testing")];

/**
 * Codes the scaffolding may answer with although the server never does, each with its reason.
 *
 * `not_mocked` is the catch-all's answer for a path the mock does not serve: the mock admitting
 * a gap, not a refusal the server makes. Given a real code, a missing handler would pass for
 * the server's own answer.
 */
const NOT_A_REFUSAL = new Set(["not_mocked"]);

interface Answered {
  where: string;
  code: string;
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** A property's name, quoted or not. */
function nameOf(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText();
}

/** `ErrorCode` as the generated client declares it, which `generatedClient.test.ts` holds to the contract. */
function codesTheContractLists(): Set<string> {
  const listed = new Set<string>();
  walk(parse(SCHEMA), (node) => {
    if (!ts.isPropertySignature(node) || nameOf(node.name) !== "ErrorCode") return;
    if (node.type === undefined || !ts.isUnionTypeNode(node.type)) return;
    for (const member of node.type.types) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        listed.add(member.literal.text);
      }
    }
  });
  return listed;
}

function codesTheScaffoldingAnswers(): Answered[] {
  return SCAFFOLDING.flatMap(sourcesUnder).flatMap((path) => {
    const source = parse(path);
    const answered: Answered[] = [];
    walk(source, (node) => {
      if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return;
      if (nameOf(node.name) !== "code") return;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      const where = `${relative(SOURCE, path)}:${line + 1}`;
      const outcomes = ts.isPropertyAssignment(node)
        ? outcomesOf(node.initializer)
        : [`<unreadable: ${node.getText()}>`];
      answered.push(...outcomes.map((code) => ({ where, code })));
    });
    return answered;
  });
}

function sourcesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Each code an expression can come to: a literal, or either branch of a conditional. */
function outcomesOf(expression: ts.Expression): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return outcomesOf(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return [...outcomesOf(expression.whenTrue), ...outcomesOf(expression.whenFalse)];
  }
  return [`<unreadable: ${expression.getText()}>`];
}

describe("the codes the mocks refuse with", () => {
  it("are all codes the contract lists", () => {
    const listed = codesTheContractLists();

    const invented = codesTheScaffoldingAnswers().filter(
      ({ code }) => !listed.has(code) && !NOT_A_REFUSAL.has(code),
    );

    expect(invented).toEqual([]);
  });

  it("are read from both branches of a conditional", () => {
    // The retry handler answers one of two codes. A scan that kept only the first literal it
    // met would pass an invented second one.
    const codes = codesTheScaffoldingAnswers().map(({ code }) => code);

    expect(codes).toEqual(expect.arrayContaining(["nothing_to_retry", "nothing_to_ask_again"]));
  });

  it("excuse nothing the scaffolding no longer answers with", () => {
    const answered = new Set(codesTheScaffoldingAnswers().map(({ code }) => code));

    expect([...NOT_A_REFUSAL].filter((code) => !answered.has(code))).toEqual([]);
  });
});
