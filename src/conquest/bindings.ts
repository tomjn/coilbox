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
