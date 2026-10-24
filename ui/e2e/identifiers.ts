/**
 * A copy of `src/testing/identifiers.ts`, for the browser sweep (map-C01 §3 M3): the internal
 * identifiers a page shows its reader.
 *
 * **Copied, not imported**, because a browser spec imports nothing from `src/` -- that is what
 * makes it a test of the product rather than of the implementation (`playwright.config.ts`).
 * `src/app/identifiers.test.tsx` reads both files and fails when the copies differ in their
 * patterns or in how they read and match: change one, change both.
 */

/** Where on the page a piece of text was read from. */
export type ReadFrom = "text" | "aria-label" | "title" | "placeholder" | "alt" | "value";

/** One piece of text a reader meets. */
export interface Reading {
  readonly from: ReadFrom;
  readonly text: string;
}

/** An identifier, and the reading it was found in. */
export interface Finding {
  readonly identifier: string;
  readonly reading: Reading;
}

/** What the data in play calls things, which the page alone cannot say. */
export interface Vocabulary {
  /** The PascalCase literals the contract enumerates (shape 4): see `enumLiteralsIn`. */
  readonly enumLiterals: readonly string[];
  /** Every id the data uses (shape 5): a reading that is one of these and nothing else. */
  readonly ids: readonly string[];
}

/**
 * The pattern list. **The same in both copies of this file**, which a unit test holds them to.
 *
 * Tried in this order, and each match is taken out of the text before the next shape is looked
 * for, so one identifier is found once and whole: `country.visa_route_exists` is not also found
 * as `visa_route_exists`, nor `client.malformed_error_body` as `malformed_error_body`.
 */
export const IDENTIFIER_PATTERNS = {
  /** Never an identifier: a link's address names its publisher's paths, which are not ours. */
  url: /https?:\/\/\S+/g,
  /** Shape 1: a catalog id under its level, `country.portugal`, anywhere. */
  levelPrefixed: /(country|city)\.[a-z0-9_.]+/g,
  /** Shape 3: a code the client makes up for itself, `client.unreachable`. */
  clientCode: /\bclient\.[a-z_]+\b/g,
  /** Shape 2: a gate or set id, a code, an enum word, a source id -- `world_bank`. */
  snakeCase: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g,
  /**
   * Shape 4, as the generated schema writes one: a PascalCase literal in a union. Two humps at
   * least, because `Count` or `Text` alone is a word a sentence can start with.
   */
  schemaEnumLiteral: /[:|]\s*"([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)"(?=\s*[|;])/g,
} as const;

/** The PascalCase literals the generated schema (`api/schema.ts`) enumerates, once each. */
export function enumLiteralsIn(schemaSource: string): string[] {
  const literals = [...schemaSource.matchAll(IDENTIFIER_PATTERNS.schemaEnumLiteral)].map(
    (match) => match[1] ?? "",
  );
  return [...new Set(literals)].sort();
}

/**
 * Every piece of text under `root` that a reader meets, in document order.
 *
 * **Self-contained on purpose**: it reaches nothing outside its own body, so a browser test can
 * hand it to the page as it stands -- `page.locator("body").evaluate(readingsOf)`.
 */
export function readingsOf(root: Element): Reading[] {
  const attributes = ["aria-label", "title", "placeholder", "alt"] as const;
  const verbatim = "data-verbatim";
  const unread = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const textInputs = new Set(["text", "search", "email", "tel", "url"]);
  const readings: Reading[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.trim() !== "") readings.push({ from: "text", text });
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.hasAttribute(verbatim) || unread.has(node.tagName)) return;
    for (const name of attributes) {
      const value = node.getAttribute(name);
      if (value !== null && value.trim() !== "") readings.push({ from: name, text: value });
    }
    if (
      node instanceof HTMLTextAreaElement ||
      (node instanceof HTMLInputElement && textInputs.has(node.type))
    ) {
      // What the field holds now, which a text area's own text stops being once it is typed in.
      if (node.value.trim() !== "") readings.push({ from: "value", text: node.value });
      return;
    }
    node.childNodes.forEach(visit);
  };

  visit(root);
  return readings;
}

/** The identifiers in a page's readings, reading by reading. */
export function identifiersIn(
  readings: readonly Reading[],
  vocabulary: Vocabulary,
): Finding[] {
  const { url, levelPrefixed, clientCode, snakeCase } = IDENTIFIER_PATTERNS;
  const shapes: RegExp[] = [levelPrefixed, clientCode, snakeCase];
  if (vocabulary.enumLiterals.length > 0) {
    shapes.push(new RegExp(`\\b(?:${vocabulary.enumLiterals.join("|")})\\b`, "g"));
  }
  const ids = new Set(vocabulary.ids);

  return readings.flatMap((reading) => {
    const found: string[] = [];
    let text = reading.text.replace(url, " ");
    for (const shape of shapes) {
      text = text.replace(shape, (match) => {
        // A sentence's full stop is not part of the id it ends on.
        found.push(match.replace(/\.+$/, ""));
        return " ";
      });
    }
    const alone = reading.text.trim();
    if (ids.has(alone) && !found.includes(alone)) found.push(alone);
    return found.map((identifier) => ({ identifier, reading }));
  });
}

/** The identifiers on the page under `root`. */
export function findIdentifiers(root: Element, vocabulary: Vocabulary): Finding[] {
  return identifiersIn(readingsOf(root), vocabulary);
}
