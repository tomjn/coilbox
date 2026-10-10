/**
 * Whether the match chart raises the current player's own line, remembered
 * between visits (#1139).
 *
 * Someone who wants it wants it for every replay, so it goes to `localStorage`
 * under one key, as {@link useStoredColorMode} does.
 */

import { useState } from "react";

const KEY = "coilbox.matchStats.highlightMe";

/** Off when nothing valid is stored: the chart opens as it always did. */
export const DEFAULT_HIGHLIGHT_ME = false;

/** Parse a stored value, falling back to the default for anything else. */
export function storedHighlightMe(raw: string | null): boolean {
  return raw === "true" ? true : raw === "false" ? false : DEFAULT_HIGHLIGHT_ME;
}

/** The remembered choice, and a setter that remembers the answer. */
export function useStoredHighlightMe(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return storedHighlightMe(localStorage.getItem(KEY));
    } catch {
      // Storage unavailable (private mode or quota). The choice still applies
      // for the session.
      return DEFAULT_HIGHLIGHT_ME;
    }
  });

  return [
    on,
    (next) => {
      setOn(next);
      try {
        localStorage.setItem(KEY, String(next));
      } catch {}
    },
  ];
}
