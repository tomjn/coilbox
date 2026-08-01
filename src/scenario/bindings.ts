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

/**
 * Delete a scenario document and its imported dialogue media. `keepMedia` leaves
 * the clips on disk, for a scenario a campaign mission has attached: the mission
 * carries the document but still loads the clips out of this store by name.
 */
export const scenarioDelete = defineCommand<
  { id: string; keepMedia?: boolean },
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
 * Write an exported scenario's text to a path the user picked in the save
 * dialog. Opaque: the container text comes from {@link exportScenario}.
 */
export const scenarioExport = defineCommand<
  { text: string; dest: string },
  Record<string, never>
>("coilbox-scenario", "scenario_export");

/**
 * Read a scenario file the user picked, for {@link importScenario} to decode.
 */
export const scenarioImport = defineCommand<{ src: string }, { text: string }>(
  "coilbox-scenario",
  "scenario_import",
);

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

/**
 * A runtime's version marker and capability table, as `missions/runtime.lua`
 * declares it. `conditions` and `actions` are the trigger types that runtime
 * implements, which is what the editor's palette is gated on (issue #765).
 */
export interface RuntimeMarker {
  version: number;
  schemaVersion: number;
  conditions: string[];
  actions: string[];
}

/**
 * Write the mission runtime's `luarules/`, `luaui/` and `missions/` into the
 * loose game folder at `root`, or update an older install in place. `installed`
 * is the marker read back out of the game afterwards, so it is what the engine
 * will load rather than what coilbox meant to write. Fails on a packaged
 * `.sd7`/`.sdz`, which is a file and cannot be written into.
 */
export const scenarioRuntimeInstall = defineCommand<
  { root: string },
  { installed: RuntimeMarker; files: string[] }
>("coilbox-scenario", "scenario_runtime_install");

/**
 * The runtime the game at `root` has installed, the one this build of coilbox
 * ships, and the condition and action types the game declares for itself in
 * `missions/extensions.lua`. Each is null when it cannot be read: a game that has
 * not adopted the runtime has no marker at all, and most games declare no types
 * of their own.
 *
 * `installedError` says why the game's marker would not load, and is set only
 * when the marker file is there. A game that never adopted the runtime has a
 * null `installed` and a null `installedError`; one whose marker is broken has a
 * null `installed` and a message.
 *
 * `extensions` is whatever that file evaluated to, unread. The editor's half of
 * it is `parseExtensions` in `extensions.ts`, which is where a hand-written
 * declaration is checked.
 */
export const scenarioRuntimeStatus = defineCommand<
  { root: string },
  {
    installed: RuntimeMarker | null;
    installedError: string | null;
    available: RuntimeMarker | null;
    extensions: unknown;
  }
>("coilbox-scenario", "scenario_runtime_status");

/**
 * Generate the test mutator under `dataDir`'s `games/`: coilbox's own `.sdd`
 * carrying the mission runtime, the `modinfo.lua` the caller generated (which
 * names the base game as its one dependency), and the one compiled mission with
 * the scenario's dialogue clips beside it. Any previous scenario's mission is
 * dropped, so the generated game holds exactly the one under test.
 *
 * `installed` is the runtime marker read back out of the generated game, so it
 * is what the engine will load. See {@link writeTestMutator}, which is what
 * callers use.
 */
export const scenarioTestMutator = defineCommand<
  { dataDir: string; scenarioId: string; modinfo: string; mission: string },
  {
    dir: string;
    folder: string;
    installed: RuntimeMarker;
    files: string[];
    media: string[];
  }
>("coilbox-scenario", "scenario_test_mutator");

/**
 * Write a compiled mission into the loose game at `root`, under
 * `missions/<scenarioId>/`, with the scenario's dialogue clips beside it. The
 * launch-time half of the adoption contract: a game that vendors the runtime
 * plays a scenario out of its own archive. `dir` is the folder the files landed
 * in. Fails on a packaged `.sd7`/`.sdz`, which gets the test mutator instead.
 */
export const scenarioWriteMission = defineCommand<
  { root: string; scenarioId: string; mission: string },
  { dir: string; media: string[] }
>("coilbox-scenario", "scenario_write_mission");

/** Best-effort removal of a stored dialogue clip. */
export const scenarioMediaDelete = defineCommand<
  { scenarioId: string; file: string },
  Record<string, never>
>("coilbox-scenario", "scenario_media_delete");
