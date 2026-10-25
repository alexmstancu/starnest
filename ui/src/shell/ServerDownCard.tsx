import { useLocation } from "react-router-dom";
import {
  SERVER_DID_NOT_ANSWER,
  retryEveryFailed,
  useWaitingForServer,
} from "../api/reachability";
import type { RoutePath } from "../navigation/routes";
import { ReadFailureCardInFull } from "./ReadFailureCard";

/**
 * **The one card a screen draws when the server did not answer** (PL-002, P1-06).
 *
 * Every read that failed that way draws its compact line, and this says the rest once: what
 * the screen could not load, that nothing changed, and that the server is probably not running.
 * Its Try again reads every one of them again; and once the server answers anything -- the
 * shell's poll, usually -- they are read again without it.
 */
export function ServerDownCard() {
  const waitingForServer = useWaitingForServer();
  const { pathname } = useLocation();
  if (!waitingForServer) return null;

  return (
    <ReadFailureCardInFull
      what={SCREEN_SUBJECTS[pathname as RoutePath] ?? "This screen"}
      error={SERVER_DID_NOT_ANSWER}
      onRetry={retryEveryFailed}
    />
  );
}

/** What each screen is there to show, as the subject of a sentence. */
const SCREEN_SUBJECTS: Record<RoutePath, string> = {
  "/configure": "The configuration",
  "/acquire": "The acquisition history",
  "/rank": "The ranking",
  "/compare": "The comparison",
};
