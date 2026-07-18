import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the `coilbox-runlite` plugin. The active run and the
 * meta-progression cross the boundary as opaque JSON strings (the frontend owns
 * the schema, see `model.ts`); the plugin only stores and returns them.
 */

/** Load the opaque active-run document (an empty default when none exists). */
export const runliteStateLoad = defineCommand<
  Record<string, never>,
  { json: string }
>("coilbox-runlite", "runlite_state_load");

/** Persist the opaque active-run document. */
export const runliteStateSave = defineCommand<
  { json: string },
  Record<string, never>
>("coilbox-runlite", "runlite_state_save");

/** Load the opaque meta-progression document (an empty default when none). */
export const runliteMetaLoad = defineCommand<
  Record<string, never>,
  { json: string }
>("coilbox-runlite", "runlite_meta_load");

/** Persist the opaque meta-progression document. */
export const runliteMetaSave = defineCommand<
  { json: string },
  Record<string, never>
>("coilbox-runlite", "runlite_meta_save");
