import { useSetting } from "@picoframe/frame";
import { useMemo } from "react";
import type { StartRect } from "./geometry";

/**
 * Start-box layouts saved against a map (issue #334), persisted locally like
 * `notes.ts`' settings-backed record. Each layout is keyed by 0-based ally as a
 * string, the same keying as `Battle.startRects`, so a battle's live rects save
 * and apply verbatim.
 *
 * A map holds a list rather than a single layout, so the ones you keep sit beside
 * the built-in splits as previews you can read before applying. That is the point
 * of the list: the old single slot could only be restored blind, because nothing
 * on screen said what was in it.
 *
 * One store for both a hosted battle and a skirmish: a layout you drew for a map
 * is the layout you want for that map either way, and the storage key keeps its
 * original name so nobody's saved layouts disappear.
 */

const STORAGE_KEY = "multiplayer.startBoxes";

/** One saved arrangement: ally (0-based, as string) -> rect. */
export type LayoutBoxes = Record<string, StartRect>;

export interface SavedLayout {
  /** Stable within its map, for React keys and for removal. */
  id: string;
  boxes: LayoutBoxes;
}

/** map springName -> the layouts saved for it, oldest first. */
export type SavedStartBoxes = Record<string, SavedLayout[]>;

/**
 * What the setting may actually hold: the list shape above, or the single layout
 * per map it held before this file grew a list.
 */
type StoredStartBoxes = Record<string, SavedLayout[] | LayoutBoxes>;

/**
 * The id given to a layout carried over from the one-per-map shape. Fixed rather
 * than generated, because normalising runs on every read and a fresh id each time
 * would hand React a new key for a tile that did not change.
 */
const LEGACY_ID = "saved";

/**
 * Read the store in the current shape, migrating a map still holding a bare
 * layout. Migration happens on read and is never written back on its own: an
 * older coilbox sharing the same settings file keeps working, and the shape
 * converts the first time something is actually saved.
 */
export function normaliseSaved(stored: StoredStartBoxes): SavedStartBoxes {
  const out: SavedStartBoxes = {};
  for (const [mapName, value] of Object.entries(stored ?? {})) {
    if (Array.isArray(value)) {
      if (value.length > 0) out[mapName] = value;
    } else if (value && Object.keys(value).length > 0) {
      out[mapName] = [{ id: LEGACY_ID, boxes: value }];
    }
  }
  return out;
}

/** Two layouts holding the same allies with the same four edges each. */
function sameBoxes(a: LayoutBoxes, b: LayoutBoxes): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    return (
      y !== undefined &&
      x.left === y.left &&
      x.top === y.top &&
      x.right === y.right &&
      x.bottom === y.bottom
    );
  });
}

/** Whether `boxes` is already saved for `mapName`, edge for edge. */
export function layoutAlreadySaved(
  store: SavedStartBoxes,
  mapName: string,
  boxes: LayoutBoxes,
): boolean {
  return (store[mapName] ?? []).some((l) => sameBoxes(l.boxes, boxes));
}

/**
 * The store with `boxes` added to `mapName`'s layouts. An empty arrangement saves
 * nothing, and one already saved is not duplicated, so pressing save twice cannot
 * leave two identical tiles to delete.
 */
export function addMapLayout(
  store: SavedStartBoxes,
  mapName: string,
  boxes: LayoutBoxes,
): SavedStartBoxes {
  if (Object.keys(boxes).length === 0) return store;
  if (layoutAlreadySaved(store, mapName, boxes)) return store;
  const layout: SavedLayout = { id: crypto.randomUUID(), boxes: { ...boxes } };
  return { ...store, [mapName]: [...(store[mapName] ?? []), layout] };
}

/**
 * The store without one layout. A map left with none loses its entry rather than
 * keeping an empty list.
 */
export function removeMapLayout(
  store: SavedStartBoxes,
  mapName: string,
  id: string,
): SavedStartBoxes {
  const rest = (store[mapName] ?? []).filter((l) => l.id !== id);
  const next = { ...store };
  if (rest.length === 0) delete next[mapName];
  else next[mapName] = rest;
  return next;
}

/** The whole saved-layout store, persisted via the settings storage. */
export function useSavedStartBoxes() {
  const [stored, setStored] = useSetting<StoredStartBoxes>(STORAGE_KEY, {});
  const saved = useMemo(() => normaliseSaved(stored), [stored]);
  return [saved, setStored] as const;
}
