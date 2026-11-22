import { useSyncExternalStore } from "react";

import { type NavigationPreset, presetFromStored } from "./cameraNavigation";

const KEY = "coilbox.lego.cameraNavigation";

const listeners = new Set<() => void>();
let current: NavigationPreset | null = null;

/** The saved preset, read once and then kept here. */
export function getNavigationPreset(): NavigationPreset {
  if (current === null) {
    try {
      current = presetFromStored(localStorage.getItem(KEY));
    } catch {
      current = presetFromStored(null);
    }
  }
  return current;
}

/**
 * Saves the preset, so it lasts between runs. A preference about how the
 * person works, so it is not saved in the unit.
 */
export function setNavigationPreset(preset: NavigationPreset): void {
  current = preset;
  try {
    localStorage.setItem(KEY, preset);
  } catch {}
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNavigationPreset(): [
  NavigationPreset,
  (preset: NavigationPreset) => void,
] {
  const preset = useSyncExternalStore(subscribe, getNavigationPreset);
  return [preset, setNavigationPreset];
}

/** Forgets the cached value so a test can read storage afresh. */
export function resetNavigationPresetCache(): void {
  current = null;
}
