import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the `coilbox-scenario` plugin. Scenario documents cross the
 * boundary as opaque JSON strings, because the frontend owns the schema (see
 * `model.ts`). The plugin only stores them and the dialogue clips a compiled
 * mission ships with.
 */

/** One stored scenario document, still unparsed. */
export interface ScenarioListItem {
  json: string;
}

/** Every stored scenario document. */
export const scenarioList = defineCommand<
  Record<string, never>,
  { items: ScenarioListItem[] }
>("coilbox-scenario", "scenario_list");

/** Write a scenario document (serialized by the caller). Id: `[A-Za-z0-9-]+`. */
export const scenarioSave = defineCommand<
  { id: string; json: string },
  Record<string, never>
>("coilbox-scenario", "scenario_save");

/** Delete a scenario document and its imported dialogue media. */
export const scenarioDelete = defineCommand<
  { id: string },
  Record<string, never>
>("coilbox-scenario", "scenario_delete");

/**
 * Copy a dialogue portrait or voice clip into the scenario's media folder,
 * verbatim. Returns the bare stored filename, which is what
 * {@link ScenarioDialogue.portrait} and `.audio` hold: the compile step writes
 * those files beside the compiled mission, where the engine loads them by name.
 */
export const scenarioMediaImport = defineCommand<
  { scenarioId: string; srcPath: string },
  { file: string }
>("coilbox-scenario", "scenario_media_import");

/**
 * Read a stored dialogue clip back as a `data:` URL, for the export path. The
 * content type follows the stored extension.
 */
export const scenarioMediaRead = defineCommand<
  { scenarioId: string; file: string },
  { dataUrl: string }
>("coilbox-scenario", "scenario_media_read");

/**
 * Write a clip carried by an imported scenario file, under the name the imported
 * document already references. Rejects anything that is not a `data:` URI, or
 * that holds more than 16 MB.
 */
export const scenarioMediaWrite = defineCommand<
  { scenarioId: string; file: string; dataUri: string },
  Record<string, never>
>("coilbox-scenario", "scenario_media_write");

/**
 * Evaluate a compiled `mission.lua` at `path` (VFS-relative) inside the game
 * archive directory `root`, and return the table it built. The read half of the
 * compile step's validator, run through the same `VFS.Include` the mission
 * runtime's gadget uses. See {@link validateCompiledMission}.
 */
export const scenarioReadMission = defineCommand<
  { root: string; path: string },
  { mission: unknown }
>("coilbox-scenario", "scenario_read_mission");

/** Best-effort removal of a stored dialogue clip. */
export const scenarioMediaDelete = defineCommand<
  { scenarioId: string; file: string },
  Record<string, never>
>("coilbox-scenario", "scenario_media_delete");
