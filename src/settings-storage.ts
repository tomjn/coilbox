import { t } from "@lingui/core/macro";
import { invoke } from "@tauri-apps/api/core";
import {
  type FlushableSettingsStorage,
  installSettingsStorage,
} from "./lib/storedSetting";
import { notify } from "./notify/notify";

/** A settings file that failed to load, and where it went if it was moved. */
export interface SettingsLoadProblem {
  copy: string | null;
}

/**
 * A Tauri-app-data-backed `SettingsStorage` for the frame's `useSetting`. The
 * frame's interface is synchronous (`get`/`set` return immediately), but Tauri
 * IO is async, so we hydrate an in-memory cache once at boot and treat it as the
 * source of truth: `get` reads the cache; `set` updates it and fires an async
 * write-through that persists the whole map (serialized so rapid edits can't
 * interleave). The persistence commands (`app_settings_load` / `app_settings_save`)
 * are app-level, in `src-tauri/src/settings.rs`, not a plugin. Twenty-nine settings
 * sections across a dozen plugins go through them, so no one plugin should own them.
 *
 * `flush` is how anything that cares about the file rather than the cache waits
 * for that write to land. See `settingsWritten` in `./lib/storedSetting`.
 *
 * A save that fails raises a notification (issue #1701). It used to be a
 * `console.error` and nothing else, so the switch stayed where it was put, the
 * file kept the old answer, and the first anybody heard of it was the hub plugin
 * refusing an upload and telling them to turn on a switch they could see was
 * already on. A notification is right here where it was wrong for a background
 * backfill (#1690): somebody changed a setting, so somebody is looking at the
 * screen, and the answer they were given is untrue until they are told.
 *
 * A file that failed to load must never be overwritten by a map that started
 * from nothing (issue #4897). The backend moves a bad file aside before answering.
 * If it could do neither, the file is still there and possibly fine, so this
 * session keeps its changes in memory and writes nothing.
 */
export async function createTauriSettingsStorage(): Promise<
  FlushableSettingsStorage & {
    hadSettings: boolean;
    loadProblem: SettingsLoadProblem | null;
  }
> {
  const cache = new Map<string, string>();
  let loadProblem: SettingsLoadProblem | null = null;
  try {
    const { entries, recoveredCopy } = await invoke<{
      entries: Record<string, string>;
      recoveredCopy: string | null;
    }>("app_settings_load");
    for (const [k, v] of Object.entries(entries)) cache.set(k, v);
    if (recoveredCopy !== null) loadProblem = { copy: recoveredCopy };
  } catch (e) {
    console.error("settings: failed to load settings; not saving", e);
    loadProblem = { copy: null };
  }
  const canSave = loadProblem?.copy !== null;

  // Whether the save before this one failed, so a disk that has stopped taking
  // writes is said once rather than once per setting anybody touches.
  let failing = false;
  let queue: Promise<unknown> = Promise.resolve();

  const persist = () => {
    const entries = Object.fromEntries(cache);
    queue = queue.then(() =>
      invoke("app_settings_save", { entries }).then(
        () => {
          failing = false;
        },
        (e) => {
          console.error("settings: save failed", e);
          if (failing) return;
          failing = true;
          void notify({
            level: "error",
            title: t`Coilbox could not save your settings`,
            body: t`Your change will be lost when Coilbox closes, and anything that reads the settings file still has the old answer. Check the disk is not full, then change the setting again to try saving it.`,
          });
        },
      ),
    );
  };

  const storage: FlushableSettingsStorage = {
    get: (key) => cache.get(key) ?? null,
    set: (key, value) => {
      cache.set(key, value);
      if (canSave) persist();
    },
    // The queue as it stands, so awaiting it waits for every write made before
    // the call and for none made after. Each write persists the whole map, so
    // the one being waited on is the one carrying the caller's value. It never
    // rejects: `persist` catches, and a chain that rejected would take the next
    // write down with it.
    flush: () => queue.then(() => undefined),
  };
  installSettingsStorage(storage);
  // Whether a settings file was here, so onboarding can tell an existing install
  // from a fresh one before anything writes. A file that failed to load counts,
  // whatever could be kept from it.
  return Object.assign(storage, {
    hadSettings: cache.size > 0 || loadProblem !== null,
    loadProblem,
  });
}

/**
 * Tell the player their settings could not be read. Separate from loading because
 * the catalog is not loaded yet at that point, and this has to be in their language.
 * It stays up until dismissed, because the path in it is the way back.
 */
export function announceSettingsLoadProblem({
  copy,
}: SettingsLoadProblem): void {
  void notify({
    level: "error",
    sticky: true,
    title:
      copy === null
        ? t`Your settings could not be read, so changes will not be saved until Coilbox restarts.`
        : t`Your settings could not be read. The old file is kept at ${copy}`,
  });
}
