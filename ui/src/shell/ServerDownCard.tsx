import { useRef } from "react";
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
 *
 * **That Try again takes the card, and itself, away** (RULES "Focus"), so focus pressed on it
 * goes to the screen it reads again -- `main` -- rather than to the page.
 */
export function ServerDownCard() {
  const waitingForServer = useWaitingForServer();
  const { pathname } = useLocation();
  const card = useRef<HTMLDivElement>(null);
  if (!waitingForServer) return null;

  function retry() {
    if (card.current?.contains(document.activeElement)) {
      card.current.closest("main")?.focus();
    }
    retryEveryFailed();
  }

  return (
    <div ref={card}>
      <ReadFailureCardInFull
        what={SCREEN_SUBJECTS[pathname as RoutePath] ?? "This screen"}
        error={SERVER_DID_NOT_ANSWER}
        onRetry={retry}
      />
    </div>
  );
}

/** What each screen is there to show, as the subject of a sentence. */
const SCREEN_SUBJECTS: Record<RoutePath, string> = {
  "/configure": "The configuration",
  "/acquire": "The acquisition history",
  "/rank": "The ranking",
  "/compare": "The comparison",
};
