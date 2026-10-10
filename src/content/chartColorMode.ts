/**
 * Whether the match chart draws in coilbox's palette or the game's own colours,
 * remembered between visits (#1142).
 *
 * A preference about how someone reads charts, not a fact about one replay, so
 * it goes to `localStorage` under one key for every replay, as the campaign
 * editor's `presentationOpen` does.
 */

import { useState } from "react";
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

/** The remembered mode (null until chosen), and a setter that remembers it. */
export function useStoredColorMode(): [
  ChartColorMode | null,
  (mode: ChartColorMode) => void,
] {
  const [mode, setMode] = useState<ChartColorMode | null>(() => {
    try {
      return storedColorMode(localStorage.getItem(KEY));
    } catch {
      // Storage unavailable (private mode or quota). The chart picks per match.
      return null;
    }
  });

  return [
    mode,
    (next) => {
      setMode(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {}
    },
  ];
}
