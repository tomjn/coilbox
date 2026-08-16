import {
  type FlushableSettingsStorage,
  installSettingsStorage,
} from "./lib/storedSetting";
import { usSettingsLoad, usSettingsSave } from "./uberstress/bindings";

/**
 * A Tauri-app-data-backed `SettingsStorage` for the frame's `useSetting`. The
 * frame's interface is synchronous (`get`/`set` return immediately), but Tauri
 * IO is async, so we hydrate an in-memory cache once at boot and treat it as the
 * source of truth: `get` reads the cache; `set` updates it and fires an async
 * write-through that persists the whole map (serialized so rapid edits can't
 * interleave). The persistence command lives in the uberstress plugin crate —
 * the only settings consumer today; it would move app-level if others appear.
 *
 * `flush` is how anything that cares about the file rather than the cache waits
 * for that write to land. See `settingsWritten` in `./lib/storedSetting`.
 */
export async function createTauriSettingsStorage(): Promise<FlushableSettingsStorage> {
  const cache = new Map<string, string>();
  try {
    const { entries } = await usSettingsLoad(undefined);
    for (const [k, v] of Object.entries(entries)) cache.set(k, v);
  } catch (e) {
    console.error("uberstress: failed to load settings; starting empty", e);
  }

  let queue: Promise<unknown> = Promise.resolve();
  const persist = () => {
    const entries = Object.fromEntries(cache);
    queue = queue.then(() =>
      usSettingsSave({ entries }).catch((e) =>
        console.error("uberstress: settings save failed", e),
      ),
    );
  };

  const storage: FlushableSettingsStorage = {
    get: (key) => cache.get(key) ?? null,
    set: (key, value) => {
      cache.set(key, value);
      persist();
    },
    // The queue as it stands, so awaiting it waits for every write made before
    // the call and for none made after. Each write persists the whole map, so
    // the one being waited on is the one carrying the caller's value. It never
    // rejects: `persist` catches, and a chain that rejected would take the next
    // write down with it.
    flush: () => queue.then(() => undefined),
  };
  installSettingsStorage(storage);
  return storage;
}
