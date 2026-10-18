import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to `plugin:coilbox-compat|*` (crate
 * `tauri-plugin-coilbox-compat`, ACL id `coilbox-compat`). Each command returns
 * the inner data of the plugin's `CliResult` envelope, or throws its error
 * message.
 */

/** What the 3do converter said about the base game's models. */
export interface CompatConversion {
  modelsFound: number;
  modelsWritten: number;
  unreadable: Record<string, string>;
  didNotFit: string[];
  errors: string[];
}

/** What a build wrote. */
export interface CompatBuilt {
  dir: string;
  folder: string;
  files: string[];
  models: CompatConversion;
  /** Why the converted models are not used, when they cannot be. */
  notes: string[];
  /** The ids of the prelude fixes written. */
  preludeFixes: string[];
  /** The names of the polyfill gadgets written. */
  gadgets: string[];
  /** How many converted models the game's defs are pointed at. */
  defOverrides: number;
}

/** Why a built mutator no longer matches what would be built now. */
export type CompatStale =
  | { kind: "manifest"; built: number; now: number }
  | { kind: "writer"; built: number; now: number }
  | { kind: "baseChecksum"; built: string; now: string }
  | { kind: "noMarker" };

/** Where the compat mutator for a game stands. */
export interface CompatStatus {
  /** The manifest coilbox builds now. */
  latest: number;
  /** The newest mutator built for the game, or `null` when there is none. */
  folder: string | null;
  /** Why that mutator is stale. Empty when it is current or there is none. */
  stale: CompatStale[];
}

/**
 * Write the compat mutator for a game under `dataDir`'s `games/`, replacing
 * what the folder held. `baseChecksum` is the archive's checksum as unitsync
 * reports it.
 */
export const compatBuild = defineCommand<
  {
    dataDir: string;
    enginePath: string;
    archiveName: string;
    gameName: string;
    baseChecksum: string;
    manifestVersion: number;
  },
  CompatBuilt
>("coilbox-compat", "compat_build");

/** Whether the newest mutator built for a game is stale. */
export const compatStatus = defineCommand<
  { dataDir: string; archiveName: string; baseChecksum: string },
  CompatStatus
>("coilbox-compat", "compat_status");

/** Delete every mutator built for a game. Answers with the folders deleted. */
export const compatRemove = defineCommand<
  { dataDir: string; archiveName: string },
  string[]
>("coilbox-compat", "compat_remove");
