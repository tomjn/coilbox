/**
 * Whether the unit map marks where shots landed and units died, remembered
 * between visits (#5317).
 *
 * A preference about how someone reads a map, not a fact about one replay, so
 * it goes to `localStorage` under one key for every replay, as
 * `unitMapDrawing.ts` does for icons and footprints.
 */

import { useSyncExternalStore } from "react";

const KEY = "coilbox.replayMap.explosions";

/** Parse a stored value. Anything but "off" is on, which is what nobody having
 *  chosen means. */
export function storedExplosions(raw: string | null): boolean {
  return raw !== "off";
}

function readStored(): boolean {
  try {
    return storedExplosions(localStorage.getItem(KEY));
  } catch {
    // Storage unavailable (private mode or quota). They stay on.
    return true;
  }
}

const listeners = new Set<() => void>();
let current: boolean | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  if (current === undefined) current = readStored();
  return current;
}

/** The remembered choice, and a setter that remembers it. */
export function useUnitMapExplosions(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, snapshot);
  return [
    on,
    (next) => {
      current = next;
      for (const listener of listeners) listener();
      try {
        localStorage.setItem(KEY, next ? "on" : "off");
      } catch {}
    },
  ];
}

/** For tests: forget what was chosen, as a fresh session would. */
export function resetExplosionsForTests(): void {
  current = undefined;
}
