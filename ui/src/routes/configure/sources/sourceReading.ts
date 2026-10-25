/**
 * How a source reads on its row, beside its name.
 *
 * **The design asks for the source's attribute count here, and `DataSource` does not carry
 * one.** It serves an id, a name, a kind, a tier, a priority and a switch.
 * `Attribute.effective_source_priority` is the *resolved global order*, so every source appears
 * under every attribute, and `RunPlan.by_source` counts candidate-and-attribute pairs for one
 * scope rather than catalog reach. `Attribute.answerable_by` (`reqs.md` Q235) now names the
 * sources that can fetch each attribute, so the count could be derived from the catalog; until
 * that is built, this says the next most useful thing and the column is one fact rather than
 * none.
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
 * The one fact beside a source's name about how its figures are come by.
 *
 * A source nobody consults says so instead, because that is the more useful fact about it: how
 * its figures would be come by does not matter while none of them are scored.
 *
 * **The tier corrects the kind where the kind misleads** (PL-134): an estimate or a stand-in is
 * a `structured` source whose figures are worked out rather than published, and a `manual`
 * source other than the household's own -- a transcribed index, the official pages -- is
 * copied from a publication rather than typed from somebody's knowledge.
 *
 * **Empty for a kind this client has no words for**, rather than the identifier. A kind added
 * to the contract and not here should leave the column blank -- a gap a reader can see and
 * nobody can misread -- and not leak `official_international` back onto the screen.
 */
export function howItAnswers(
  sourceKind: string,
  reliabilityTier: string,
  isConsulted: boolean,
): string {
  if (!isConsulted) return "not consulted";
  if (reliabilityTier === "derived") return "worked out from other figures";
  if (sourceKind === "manual" && reliabilityTier !== "manual") {
    return "copied from a publication";
  }
  return HOW_IT_ANSWERS.get(sourceKind) ?? "";
}

/** What a source row needs to know of an attribute. */
export interface ReachedAttribute {
  id: string;
  name: string;
  answerable_by: readonly string[];
  effective_source_priority?: readonly string[];
  max_age_months?: number | null;
  manual_entry?: boolean;
}

/** The source hand entry is stored under; it answers what the catalog lets a person type. */
const HAND_ENTRY = "manual";

function canAnswer(sourceId: string, attribute: ReachedAttribute): boolean {
  return sourceId === HAND_ENTRY
    ? attribute.manual_entry === true
    : attribute.answerable_by.includes(sourceId);
}

/** How many attributes a source can answer, from the catalog (PL-134). */
export function describeReach(
  sourceId: string,
  attributes: readonly ReachedAttribute[],
): string {
  const count = attributes.filter((attribute) => canAnswer(sourceId, attribute)).length;
  if (count === 0) return "answers nothing yet";
  return count === 1 ? "1 attribute" : `${String(count)} attributes`;
}

/**
 * The required attributes nothing but this source can fetch, by name: switched off, every
 * candidate is left without them, and a missing required figure blocks a score.
 */
export function soleSourceOf(
  sourceId: string,
  attributes: readonly ReachedAttribute[],
  required: ReadonlySet<string>,
): string[] {
  return onlySourceOf(sourceId, attributes.filter((attribute) => required.has(attribute.id)));
}

/** Every attribute nothing but this source can fetch, by name, required or not. */
export function onlySourceOf(
  sourceId: string,
  attributes: readonly ReachedAttribute[],
): string[] {
  return attributes
    .filter(
      (attribute) =>
        attribute.answerable_by.length === 1 && attribute.answerable_by[0] === sourceId,
    )
    .map((attribute) => attribute.name);
}

export interface OwnOrder {
  id: string;
  name: string;
  /** The sources the attribute puts ahead of the global order, in its order. */
  leading: string[];
  maxAgeMonths: number | null;
}

/**
 * The attributes that name their own source order (PL-135), and the sources they put first.
 *
 * **Read off the resolved order the server sends**: an attribute's own overrides come first and
 * every other source follows in the global order. So the order is the global one exactly when
 * the priorities along it never go down, and otherwise the overrides are the shortest lead
 * after which they never do. A source with no priority here is passed over rather than guessed.
 */
export function attributesWithOwnOrder(
  attributes: readonly ReachedAttribute[],
  sources: readonly { id: string; default_priority: number }[],
): OwnOrder[] {
  const priorityOf = new Map(sources.map((source) => [source.id, source.default_priority]));
  return attributes.flatMap((attribute) => {
    const order = (attribute.effective_source_priority ?? []).filter((id) =>
      priorityOf.has(id),
    );
    const lead = leadBeforeGlobalOrder(order.map((id) => priorityOf.get(id) ?? 0));
    if (lead === 0) return [];
    return [
      {
        id: attribute.id,
        name: attribute.name,
        leading: order.slice(0, lead),
        maxAgeMonths: attribute.max_age_months ?? null,
      },
    ];
  });
}

/** The shortest prefix after which the priorities never go down: up to the last descent. */
function leadBeforeGlobalOrder(priorities: readonly number[]): number {
  for (let index = priorities.length - 2; index >= 0; index -= 1) {
    if (priorities[index]! > priorities[index + 1]!) return index + 1;
  }
  return 0;
}

/** How long a figure of the attribute is trusted before a run fetches it again. */
export function describeMaxAge(months: number | null | undefined): string {
  if (months === null || months === undefined) return "no maximum age";
  return months === 1 ? "refetched after 1 month" : `refetched after ${String(months)} months`;
}
