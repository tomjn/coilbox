/**
 * Whether the unit map draws each unit as its game icon or as its footprint,
 * remembered between visits (#5316).
 *
 * A preference about how someone reads a map, not a fact about one replay, so
 * it goes to `localStorage` under one key for every replay, as the chart's
 * colour mode does in `chartColorMode.ts`.
 */

import { useSyncExternalStore } from "react";

const KEY = "coilbox.replayMap.unitDrawing";

export type UnitDrawing = "icons" | "footprints";

/** Parse a stored value. Anything but the two known choices is icons, which is
 *  what nobody having chosen means. */
export function storedUnitDrawing(raw: string | null): UnitDrawing {
  return raw === "footprints" ? "footprints" : "icons";
}

function readStored(): UnitDrawing {
  try {
    return storedUnitDrawing(localStorage.getItem(KEY));
  } catch {
    // Storage unavailable (private mode or quota). Icons stand.
    return "icons";
  }
}

const listeners = new Set<() => void>();
let current: UnitDrawing | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): UnitDrawing {
  if (current === undefined) current = readStored();
  return current;
}

/** The remembered choice, and a setter that remembers it. */
export function useUnitDrawing(): [UnitDrawing, (next: UnitDrawing) => void] {
  const drawing = useSyncExternalStore(subscribe, snapshot);
  return [
    drawing,
    (next) => {
      current = next;
      for (const listener of listeners) listener();
      try {
        localStorage.setItem(KEY, next);
      } catch {}
    },
  ];
}

/** For tests: forget what was chosen, as a fresh session would. */
export function resetUnitDrawingForTests(): void {
  current = undefined;
}
