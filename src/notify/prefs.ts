/**
 * A module-level bridge for state the imperative `notify()` helper needs but that
 * lives in React / Tauri. `main.tsx` owns the settings cache privately and the
 * frame's `useSetting` is React-only, so the NotifyProvider pushes the current
 * values in here; `notify()` (which may run outside React, e.g. from a download
 * binding) reads them synchronously. Defaults are safe pre-seed values.
 */
const prefs = {
  /** User toggle for OS notifications. Default on. */
  osEnabled: true,
  /** Cached OS permission grant. Assume not-granted until the Provider checks. */
  permGranted: false,
};

export function setOsEnabled(v: boolean): void {
  prefs.osEnabled = v;
}

export function setPermGranted(v: boolean): void {
  prefs.permGranted = v;
}

export function getOsEnabled(): boolean {
  return prefs.osEnabled;
}

export function getPermGranted(): boolean {
  return prefs.permGranted;
}
