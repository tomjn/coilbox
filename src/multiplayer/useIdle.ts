import { useEffect, useRef, useState } from "react";
import { IDLE_POLL_MS, isIdle } from "./awayStatus";

/**
 * Events that count as the user still being here. Pointer, keyboard and wheel
 * cover ordinary use, and `focus` covers coming back from another app without
 * touching anything, which is otherwise invisible to the webview.
 */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "focus",
] as const;

/**
 * True once the user has not interacted with the window for `minutes`. Activity
 * clears it at once, so only the flip to idle waits for the next poll. Returns
 * false whenever `enabled` is off, and drops its listeners with it.
 */
export function useIdle(enabled: boolean, minutes: number): boolean {
  const [idle, setIdle] = useState(false);
  // Read inside the (throttle-free) activity listener so a mousemove storm does
  // not dispatch a state update per event.
  const idleRef = useRef(false);
  idleRef.current = idle;

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let last = Date.now();
    const onActivity = () => {
      last = Date.now();
      if (idleRef.current) setIdle(false);
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    const timer = window.setInterval(() => {
      setIdle(isIdle(last, Date.now(), minutes));
    }, IDLE_POLL_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity);
      }
      window.clearInterval(timer);
    };
  }, [enabled, minutes]);

  return idle;
}
