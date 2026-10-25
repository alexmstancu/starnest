import { useMemo, useRef } from "react";

/**
 * Where a write's answer goes (PL-138a, PL-033): **to whatever shows its set now**, not to what
 * sent it.
 *
 * The history and Configure's one write in flight outlive every panel -- switching sets
 * remounts the pillar weights, and leaving Configure unmounts it all -- so an answer fed to the
 * sender's own setter fed something long gone, and the screen kept showing what the server had
 * just changed. The session holds this; whatever shows a set listens for it. An answer for a set
 * nothing shows is dropped: that set is read afresh when it is next shown.
 */
export interface Answers<Answer> {
  /** Shows a set's answers in `show` until the returned function is called. */
  listen: (setId: string, show: (answer: Answer) => void) => () => void;
  deliver: (setId: string, answer: Answer) => void;
}

export function useAnswers<Answer>(): Answers<Answer> {
  const listeners = useRef(new Map<string, (answer: Answer) => void>());
  return useMemo(
    () => ({
      listen: (setId, show) => {
        listeners.current.set(setId, show);
        return () => {
          if (listeners.current.get(setId) === show) listeners.current.delete(setId);
        };
      },
      deliver: (setId, answer) => listeners.current.get(setId)?.(answer),
    }),
    [],
  );
}
