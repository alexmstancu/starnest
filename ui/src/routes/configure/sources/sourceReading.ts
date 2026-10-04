/**
 * How a source reads on its row, beside its name.
 *
 * **The design asks for the source's attribute count here, and the contract does not carry
 * one.** `DataSource` serves an id, a name, a kind, a tier, a priority and a switch, and
 * nothing anywhere says which attributes a source answers: `Attribute.effective_source_priority`
 * is the *resolved global order*, so every source appears under every attribute, and
 * `RunPlan.by_source` counts candidate-and-attribute pairs for one scope rather than catalog
 * reach. Serving the count is a backend change, so this says the next most useful thing
 * instead and the column is one fact rather than none.
 *
 * **What it says instead is how the figure was come by**, which is the fact a reader of a
 * priority order needs: the order exists to decide which evidence wins, and "a model read a
 * web page" and "a statistics agency published a table" are not the same kind of evidence.
 *
 * **It replaced two raw enum values chained with a comma** -- "structured,
 * official_international" -- which broke two standing rules at once: a row says one fact, and
 * an identifier the code uses is never text a person reads. The tier is dropped rather than
 * translated because it *cannot* be translated: the contract declares it a free string with no
 * enumeration, so there is no closed set of values to write prose for. The kind has exactly
 * three.
 */

const HOW_IT_ANSWERS = new Map([
  ["structured", "published dataset"],
  ["llm", "model with web search"],
  ["manual", "typed by hand"],
]);

/**
 * The one fact beside a source's name.
 *
 * A source nobody consults says so instead, because that is the more useful fact about it: how
 * its figures would be come by does not matter while none of them are scored.
 *
 * **Empty for a kind this client has no words for**, rather than the identifier. A kind added
 * to the contract and not here should leave the column blank -- a gap a reader can see and
 * nobody can misread -- and not leak `official_international` back onto the screen, which is
 * the fault this module exists to have fixed.
 */
export function howItAnswers(
  sourceKind: string,
  isConsulted: boolean,
): string {
  if (!isConsulted) return "not consulted";
  return HOW_IT_ANSWERS.get(sourceKind) ?? "";
}
