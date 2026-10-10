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

/** The mode when nothing valid is stored: coilbox's palette. */
export const DEFAULT_COLOR_MODE: ChartColorMode = "palette";

/** Parse a stored value, falling back to the default for anything else. */
export function storedColorMode(raw: string | null): ChartColorMode {
  return raw === "game" || raw === "palette" ? raw : DEFAULT_COLOR_MODE;
}

/** The remembered mode, and a setter that remembers the answer. */
export function useStoredColorMode(): [
  ChartColorMode,
  (mode: ChartColorMode) => void,
] {
  const [mode, setMode] = useState<ChartColorMode>(() => {
    try {
      return storedColorMode(localStorage.getItem(KEY));
    } catch {
      // Storage unavailable (private mode or quota). The choice still applies
      // for the session.
      return DEFAULT_COLOR_MODE;
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
