import type { ExternalScore } from "../../api/endpoints";

/**
 * A candidate's outside opinions, one group per index: a publisher and the series it publishes
 * (PL-171). Two indices from one publisher are two groups, never one's history of the other.
 *
 * **In the server's order**, groups and editions alike: the server orders the editions and says
 * which one is current, and this only gathers them.
 */
export interface OutsideIndex {
  publisher: string;
  series: string;
  editions: ExternalScore[];
}

export function groupedByIndex(scores: readonly ExternalScore[]): OutsideIndex[] {
  const groups = new Map<string, OutsideIndex>();
  for (const score of scores) {
    const key = JSON.stringify([score.data_source, score.series]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { publisher: score.data_source, series: score.series, editions: [score] });
    } else {
      group.editions.push(score);
    }
  }
  return [...groups.values()];
}

/**
 * An earlier edition, kept as history. **Only when the server says so**: an edition it did not
 * mark is never demoted here, because which one stands is the server's to derive.
 */
export function isEarlierEdition(score: Pick<ExternalScore, "is_current">): boolean {
  return score.is_current === false;
}
