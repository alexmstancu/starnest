import { describeRunStatus } from "./runStatus";

/** A run's status as the history and the sidebar show it: the card's words, in its tone. */
export function RunStatusChip({ status }: { status: string }) {
  const { word, tone } = describeRunStatus(status);
  return <span className={`chip chip--run-${tone}`}>{word}</span>;
}
