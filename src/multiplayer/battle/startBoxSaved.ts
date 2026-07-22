import { useSetting } from "@picoframe/frame";
import type { StartRect } from "../bindings";

/**
 * Per-map saved start boxes (issue #334) — the host's chosen layout for a map,
 * persisted locally like `notes.ts`' settings-backed record. Keyed by the
 * map's springName, then by 0-based ally as a string (the same keying as
 * `Battle.startRects`, so a battle's live rects save/restore verbatim).
 * Saving an empty layout deletes the map's entry rather than storing `{}`.
 */

const STORAGE_KEY = "multiplayer.startBoxes";

/** map springName -> ally (0-based, as string) -> rect. */
export type SavedStartBoxes = Record<string, Record<string, StartRect>>;

/** New store with `mapName`'s layout replaced (or removed when empty). */
export function saveMapBoxes(
  store: SavedStartBoxes,
  mapName: string,
  rects: Record<string, StartRect>,
): SavedStartBoxes {
  if (Object.keys(rects).length === 0) {
    if (!(mapName in store)) return store;
    const next = { ...store };
    delete next[mapName];
    return next;
  }
  return { ...store, [mapName]: { ...rects } };
}

/** The whole saved-boxes store, persisted via the settings storage. */
export function useSavedStartBoxes() {
  return useSetting<SavedStartBoxes>(STORAGE_KEY, {});
}
