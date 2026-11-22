import { useSyncExternalStore } from "react";

import { parseOverrides, type ShortcutOverrides } from "./shortcutOverrides";

const KEY = "coilbox.lego.shortcutOverrides";

const listeners = new Set<() => void>();
let current: ShortcutOverrides | null = null;

/** The saved overrides, read once and then kept here. */
export function getShortcutOverrides(): ShortcutOverrides {
  if (current === null) {
    try {
      current = parseOverrides(localStorage.getItem(KEY));
    } catch {
      current = {};
    }
  }
  return current;
}

/**
 * Saves the overrides, so they last between runs. A preference about how the
 * person works, so it is not saved in the unit.
 */
export function setShortcutOverrides(overrides: ShortcutOverrides): void {
  current = overrides;
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {}
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShortcutOverrides(): ShortcutOverrides {
  return useSyncExternalStore(subscribe, getShortcutOverrides);
}

/** Forgets the cached value so a test can read storage afresh. */
export function resetShortcutOverridesCache(): void {
  current = null;
}
