import {
  readStoredSettingIfInstalled,
  writeStoredSetting,
} from "./storedSetting";

/**
 * A cache of derived data kept in the app's settings store, so it survives a
 * restart. The settings store already persists to the app data directory (see
 * `settings-storage.ts`), which is why this does not open a store of its own.
 *
 * The record is stored as `{ version, entries }`. A stored record with another
 * `version` is ignored and replaced on the next save, so a change to the logic
 * that builds the values invalidates every entry by raising the version.
 *
 * Reads come from memory after the first. `set` only changes memory, and `save`
 * writes the whole record once, and only when something changed. Every settings write saves the whole settings
 * file, so a caller that fills the cache in a loop saves once at the end.
 */
export interface PersistedCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  /**
   * Write the cache to the settings store. With `keep`, entries whose key is
   * not in it are dropped first, so a cache keyed by something that is replaced
   * (an archive name with its version) does not grow for ever.
   */
  save(keep?: Iterable<string | null>): void;
}

interface Stored<T> {
  version: number;
  entries: Record<string, T>;
}

export function createPersistedCache<T>(
  storageKey: string,
  version: number,
): PersistedCache<T> {
  let entries: Map<string, T> | undefined;
  /** Whether memory holds something the settings store does not. */
  let dirty = false;
  const load = () => {
    if (entries) return entries;
    const stored = readStoredSettingIfInstalled<Stored<T> | null>(
      storageKey,
      null,
    );
    entries =
      stored && stored.version === version && stored.entries
        ? new Map(Object.entries(stored.entries))
        : new Map();
    return entries;
  };
  return {
    get: (key) => load().get(key),
    set: (key, value) => {
      load().set(key, value);
      dirty = true;
    },
    save(keep) {
      const held = load();
      if (keep) {
        const wanted = new Set(keep);
        for (const key of [...held.keys()]) {
          if (wanted.has(key)) continue;
          held.delete(key);
          dirty = true;
        }
      }
      if (!dirty) return;
      dirty = false;
      writeStoredSetting<Stored<T>>(storageKey, {
        version,
        entries: Object.fromEntries(held),
      });
    },
  };
}
