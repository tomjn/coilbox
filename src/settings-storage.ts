import type { SettingsStorage } from "@picoframe/frame";
import { usSettingsLoad, usSettingsSave } from "./uberstress/bindings";

/**
 * A Tauri-app-data-backed `SettingsStorage` for the frame's `useSetting`. The
 * frame's interface is synchronous (`get`/`set` return immediately), but Tauri
 * IO is async, so we hydrate an in-memory cache once at boot and treat it as the
 * source of truth: `get` reads the cache; `set` updates it and fires an async
 * write-through that persists the whole map (serialized so rapid edits can't
 * interleave). The persistence command lives in the uberstress plugin crate —
 * the only settings consumer today; it would move app-level if others appear.
 */
export async function createTauriSettingsStorage(): Promise<SettingsStorage> {
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

  return {
    get: (key) => cache.get(key) ?? null,
    set: (key, value) => {
      cache.set(key, value);
      persist();
    },
  };
}
