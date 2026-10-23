import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Request 70: the Macrotrend and competitor dashboards step between their
 * views quickly (a short glide), and a step taken while one is still moving
 * (the arrow pressed again, another scroll) jumps without the glide.
 */
export const STEP_MS = 220;
/** A wheel gesture (many events) steps once; this long after a step, scrolling steps again. */
export const STEP_LOCK_MS = 260;

export function useStepper<T>(go: (to: T) => void): { step: (to: T) => void; instant: boolean } {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [instant, setInstant] = useState(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const step = useCallback(
    (to: T) => {
      const now = Date.now();
      const busy = now - last.current < STEP_MS + 60;
      last.current = now;
      setInstant(busy);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setInstant(false), STEP_MS + 60);
      go(to);
    },
    [go],
  );
  return { step, instant };
}
