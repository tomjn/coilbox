import type { SettingsStorage } from "@picoframe/frame";

/**
 * Read-modify-write against the frame's settings store.
 *
 * The frame's `useSetting` hands back a setter that takes a value rather than an
 * updater, and the value it returns is fixed for the life of a render. So two
 * writes to one key before the next render both fold over the value as it was
 * before either, and only the last survives. That has cost us a pack's presets
 * (#1371), a battle list's map appearances (#1374) and a first connect's
 * channels (#1375).
 *
 * The store writes through to storage synchronously, so what is stored is always
 * current even when React state is a render behind. Folding over storage
 * therefore sees an earlier write in the same pass, including one made by a
 * different component, which a ref or a box inside one hook cannot.
 *
 * Kept free of app imports so anything can use it, and so tests can install a
 * storage without a Tauri backend.
 */

let installed: SettingsStorage | null = null;

/**
 * Point these helpers at the storage the frame is using. Called once at boot by
 * `createTauriSettingsStorage`, before anything renders, and by tests.
 */
export function installSettingsStorage(storage: SettingsStorage | null) {
  installed = storage;
}

/**
 * A settings storage held in memory, with none of the app's write-through. For
 * tests: install it and the helpers below behave as they do in the app.
 */
export function memorySettingsStorage(): SettingsStorage {
  const entries = new Map<string, string>();
  return {
    get: (key) => entries.get(key) ?? null,
    set: (key, value) => {
      entries.set(key, value);
    },
  };
}

/**
 * The value stored under `key`, or `fallback` when nothing is stored there.
 *
 * Throws when no storage has been installed, rather than quietly handing back
 * the fallback: a caller about to fold a change over this would wipe the key.
 * The app installs one before it renders, so only a test can see it.
 */
export function readStoredSetting<T>(key: string, fallback: T): T {
  if (!installed)
    throw new Error(
      "settings storage read before it was installed (see installSettingsStorage)",
    );
  const raw = installed.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Fold `change` over the stored value of `key` and persist the result through
 * `write`, the setter a `useSetting` call handed back. Use this for any setting
 * that can be written twice in one pass.
 *
 * `change` returning its argument unchanged means no write, so a recorder that
 * already knows a value doesn't rewrite settings.
 */
export function updateStoredSetting<T>(
  key: string,
  fallback: T,
  write: (next: T) => void,
  change: (prev: T) => T,
) {
  const prev = readStoredSetting(key, fallback);
  const next = change(prev);
  if (next !== prev) write(next);
}
