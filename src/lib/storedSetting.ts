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

/**
 * The frame's storage, plus a way to wait for what it has written.
 *
 * The frame's own interface is synchronous and says nothing about durability,
 * which is right for a UI: a component reads back what it just wrote from the
 * cache. It is not enough for anything that reads the settings *file*, which is
 * a write behind the cache until the app's storage has persisted it.
 *
 * `flush` is optional because only the app's Tauri-backed storage writes to
 * anything: a storage held in memory has nothing to wait for.
 */
export interface FlushableSettingsStorage extends SettingsStorage {
  /** Resolves once every write queued before this call has been persisted. */
  flush?(): Promise<void>;
}

let installed: FlushableSettingsStorage | null = null;

/**
 * Point these helpers at the storage the frame is using. Called once at boot by
 * `createTauriSettingsStorage`, before anything renders, and by tests.
 */
export function installSettingsStorage(
  storage: FlushableSettingsStorage | null,
) {
  installed = storage;
}

/**
 * Wait until the settings written so far are on disk.
 *
 * For the few readers that are not this webview. `AssetUploadConsent::check` in
 * the hub plugin reads the settings file itself, on purpose: it is enforcement
 * rather than a preference, so no argument sent over IPC can turn an upload on
 * (issues #1635 and #1674). Between flipping a switch and the file saying so
 * there is a window where that check reads the old answer, and awaiting this
 * closes it.
 *
 * Resolves rather than rejects when a write failed: the storage logs that
 * itself, and what a failed write leaves behind is a file that still holds the
 * old answer, which the plugin then refuses on. Failing safe is the point.
 */
export function settingsWritten(): Promise<void> {
  return installed?.flush?.() ?? Promise.resolve();
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
