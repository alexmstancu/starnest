import { type RefObject, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { highlighted } from "../navigation/highlight";

/**
 * Lands a reader on the card a route named with `?show=` (PL-018): scrolled into view, focused,
 * and marked until they act.
 *
 * **On every arrival, not only on mount.** A link followed while already on the screen keeps
 * the screen mounted; each navigation has its own `location.key`, so it lands again. **And not
 * before the target is `ready`**: a card still being read is landed on once it is drawn.
 *
 * `landed` stays true until the first pointer press or key press anywhere: the mark answers
 * "which one", and once the reader does anything it is answered. The target needs
 * `tabIndex={-1}` while it can be landed on, so focus can reach it without a tab stop.
 */
export function useLanding<T extends HTMLElement>(
  name: string,
  ready = true,
): { target: RefObject<T | null>; asked: boolean; landed: boolean } {
  const target = useRef<T>(null);
  const location = useLocation();
  const asked = highlighted(location.search) === name;
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const element = target.current;
    if (!asked || !ready || element === null) return;
    element.focus({ preventScroll: true });
    // Not in jsdom: the scroll is for the eye, the focus is what moves the reader.
    element.scrollIntoView?.({ block: "start", behavior: "smooth" });
    setLanded(true);
    const acted = () => setLanded(false);
    document.addEventListener("pointerdown", acted, { once: true });
    document.addEventListener("keydown", acted, { once: true });
    return () => {
      document.removeEventListener("pointerdown", acted);
      document.removeEventListener("keydown", acted);
    };
  }, [asked, ready, location.key]);

  return { target, asked, landed: asked && landed };
}
