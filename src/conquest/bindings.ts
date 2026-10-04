import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the `coilbox-conquest` plugin. Galaxy documents and run
 * state cross the boundary as opaque JSON strings (the frontend owns the
 * schema, see `model.ts`); the plugin only handles storage and opaque
 * import/export round-trips.
 */

/** One stored galaxy document plus where it was read from. */
export interface GalaxyListItem {
  json: string;
  /** `bundled` galaxies ship read-only in the portable `.coilbox` folder. */
  source: "local" | "bundled";
}

/** Every stored galaxy: writable local documents, then read-only bundled ones. */
export const conquestList = defineCommand<
  Record<string, never>,
  { items: GalaxyListItem[] }
>("coilbox-conquest", "conquest_list");

/** Write a galaxy document (serialized by the caller). Id: `[A-Za-z0-9-]+`. */
export const conquestSave = defineCommand<
  { id: string; json: string },
  Record<string, never>
>("coilbox-conquest", "conquest_save");

/** Delete a local galaxy document. */
export const conquestDelete = defineCommand<
  { id: string },
  Record<string, never>
>("coilbox-conquest", "conquest_delete");

/** Load the opaque run-state document (an empty default when none exists yet). */
export const conquestStateLoad = defineCommand<
  Record<string, never>,
  { json: string }
>("coilbox-conquest", "conquest_state_load");

/** Persist the opaque run-state document. */
export const conquestStateSave = defineCommand<
  { json: string },
  Record<string, never>
>("coilbox-conquest", "conquest_state_save");

/** One hand-made map folder: its manifest text and the files beside it. */
export interface HandmadeMapItem {
  /** The directory name. For an imported map this is the manifest's id. */
  folder: string;
  /** `bundled` maps ship read-only in the portable `.coilbox/galaxies` folder. */
  source: "imported" | "bundled";
  /** The text of `map.json`, unparsed. */
  manifest: string;
  /** Paths of the folder's files relative to it, with `/` separators. */
  files: string[];
}

/** Every hand-made map folder: imported ones, then read-only bundled ones. */
export const conquestMapList = defineCommand<
  Record<string, never>,
  { items: HandmadeMapItem[] }
>("coilbox-conquest", "conquest_map_list");

/** A zip unpacked into staging, waiting to be read and then committed. */
export interface StagedHandmadeMap {
  token: string;
  /** The manifest's id, or empty when the manifest is not JSON. */
  id: string;
  manifest: string;
  files: string[];
  /** How many zip entries were left out: hidden files and unknown types. */
  skipped: number;
}

/**
 * Unpack the zip at `path` into staging. Throws with a sentence for the player
 * when the zip is refused. Nothing is installed until {@link conquestMapCommit}.
 */
export const conquestMapStage = defineCommand<
  { path: string },
  StagedHandmadeMap
>("coilbox-conquest", "conquest_map_stage");

/**
 * Install a staged map. `exists` means a map with that id is installed and
 * `replace` was not set. The staged copy is kept in that case.
 */
export const conquestMapCommit = defineCommand<
  { token: string; replace: boolean },
  { status: "imported" | "exists"; id: string }
>("coilbox-conquest", "conquest_map_commit");

/** Throw away a staged map. */
export const conquestMapDiscard = defineCommand<
  { token: string },
  Record<string, never>
>("coilbox-conquest", "conquest_map_discard");

/** Remove an imported map. Throws for a bundled one. */
export const conquestMapRemove = defineCommand<
  { id: string },
  Record<string, never>
>("coilbox-conquest", "conquest_map_remove");
