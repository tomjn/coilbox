/**
 * Whether the match chart draws in coilbox's palette or the game's own colours,
 * remembered between visits (#1142).
 *
 * A preference about how someone reads charts, not a fact about one replay, so
 * it goes to `localStorage` under one key for every replay, as the campaign
 * editor's `presentationOpen` does.
 */

import { useSyncExternalStore } from "react";
import type { ChartColorMode } from "./matchStats";

const KEY = "coilbox.matchStats.colorMode";

/**
 * Parse a stored value. `null` means nobody has chosen, so the chart picks a mode
 * for each match (#3830). Anything but the two known modes counts as not chosen.
 * Before #3830 nothing valid meant the palette, but the key is only written when
 * the toggle is used, so every stored value keeps its meaning.
 */
export function storedColorMode(raw: string | null): ChartColorMode | null {
  return raw === "game" || raw === "palette" ? raw : null;
}

function readStored(): ChartColorMode | null {
  try {
    return storedColorMode(localStorage.getItem(KEY));
  } catch {
    // Storage unavailable (private mode or quota). The chart picks per match.
    return null;
  }
}

/** Everything on the page that is painted from the mode, so the map's dots
 *  repaint with the chart's lines when the chart's toggle is used (#1152). */
const listeners = new Set<() => void>();
let current: ChartColorMode | null | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ChartColorMode | null {
  if (current === undefined) current = readStored();
  return current;
}

/** The remembered mode (null until chosen), and a setter that remembers it. */
export function useStoredColorMode(): [
  ChartColorMode | null,
  (mode: ChartColorMode) => void,
] {
  const mode = useSyncExternalStore(subscribe, snapshot);
  return [
    mode,
    (next) => {
      current = next;
      for (const listener of listeners) listener();
      try {
        localStorage.setItem(KEY, next);
      } catch {}
    },
  ];
}
