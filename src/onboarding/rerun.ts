import { useSyncExternalStore } from "react";

/**
 * Whether "Run setup again" has been asked for and not yet picked up. A module
 * store, so the Settings button and the onboarding provider share it without
 * either rendering inside the other.
 */
let requested = false;
const listeners = new Set<() => void>();

function set(value: boolean) {
  if (requested === value) return;
  requested = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Open the wizard with every relevant page, ignoring what is settled. */
export function requestOnboardingRerun(): void {
  set(true);
}

export function useOnboardingRerun(): { rerun: boolean; clear(): void } {
  const rerun = useSyncExternalStore(
    subscribe,
    () => requested,
    () => requested,
  );
  return { rerun, clear: clearRerun };
}

function clearRerun() {
  set(false);
}
