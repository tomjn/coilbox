import { defineCommand } from "@picoframe/plugin-sdk";
import type { Channel } from "@tauri-apps/api/core";

/**
 * Typed bindings to the `coilbox-play` plugin: generate a Recoil/Spring start
 * script from a `BattleConfig`, launch the resolved engine with it, and cancel a
 * running game. Shapes mirror the Rust `script::BattleConfig` (serde camelCase).
 */

/** A human participant. `team` is omitted when spectating. */
export interface Player {
  name: string;
  spectator: boolean;
  team?: number;
}

/**
 * A skirmish AI — becomes an `[AI]` block. Native and game-Lua AIs use the same
 * block; the engine matches `shortName` against the game's `LuaAI.lua` to tell
 * them apart, and a Lua one carries `version: "<game>"`.
 */
export interface Ai {
  name: string;
  shortName: string;
  version?: string;
  team: number;
  /** Player index whose machine runs the AI (usually 0). */
  host: number;
  options?: Record<string, string>;
}

export interface Team {
  teamLeader: number;
  allyTeam: number;
  /** RGB in 0..1. */
  rgbColor: [number, number, number];
  side?: string;
  advantage?: number;
  incomeMultiplier?: number;
  startPosX?: number;
  startPosZ?: number;
}

export interface AllyTeam {
  numAllies: number;
  /** `[top, left, bottom, right]` in 0..1, for `StartPosType=2`. */
  startRect?: [number, number, number, number];
}

export interface BattleConfig {
  mapName: string;
  gameType: string;
  myPlayerName: string;
  /** 0 fixed, 1 random, 2 choose-in-game, 3 choose-before. */
  startPosType: number;
  gameStartDelay?: number;
  fixedRngSeed?: number;
  players: Player[];
  ais: Ai[];
  teams: Team[];
  allyTeams: AllyTeam[];
  modOptions?: Record<string, string>;
  mapOptions?: Record<string, string>;
  /**
   * `[RESTRICT]` — per-unit build limits. Key = unit internal name, value =
   * limit (0 disables the unit).
   */
  restrictedUnits?: Record<string, number>;
  /**
   * Whether this machine hosts the game. Defaults to true (singleplayer/skirmish
   * and lobby-host); a client joining a remote lobby battle sets false and gets a
   * minimal script pointing at the host.
   */
  isHost?: boolean;
  /** Host address: `0.0.0.0` when hosting a networked game, or the host to join. */
  hostIp?: string;
  /** Host port (networked host or client). Omitted for pure singleplayer. */
  hostPort?: number;
  /** Script password presented to the host (client scripts only). */
  myPasswd?: string;
}

/** Engine lifecycle event streamed while a game runs. */
export interface LaunchEvent {
  kind: "started" | "exited";
  code?: number;
}

/** Render a `BattleConfig` to start-script text (no launch). */
export const playGenerateScript = defineCommand<
  { config: BattleConfig },
  { script: string }
>("coilbox-play", "play_generate_script");

/**
 * Render a `BattleConfig` and write it to `dest` (a path the user picked via the
 * save dialog). The write happens in the plugin since there's no frontend fs
 * plugin. Rejects if the file couldn't be written.
 */
export const playExportScript = defineCommand<
  { config: BattleConfig; dest: string },
  { dest: string }
>("coilbox-play", "play_export_script");

/**
 * Write a saved preset's JSON (serialized by the caller) to `dest` so it can be
 * shared. Opaque string round-trip — the plugin doesn't model the preset shape.
 */
export const playExportPreset = defineCommand<
  { json: string; dest: string },
  { dest: string }
>("coilbox-play", "play_export_preset");

/** Read a preset JSON file the user picked; the caller parses/validates it. */
export const playImportPreset = defineCommand<
  { src: string },
  { json: string }
>("coilbox-play", "play_import_preset");

/**
 * Write the start script and launch the engine, resolving when the engine
 * process exits (the UI's unfreeze signal). `executable` is the engine binary;
 * `dataDir` the content root. Refuses a second launch while one is running.
 */
export const playLaunch = defineCommand<
  {
    config: BattleConfig;
    executable: string;
    dataDir: string;
    runId: string;
    onEvent: Channel<LaunchEvent>;
  },
  { exitCode: number | null }
>("coilbox-play", "play_launch");

/**
 * Launch the engine to play back a demo (`.sdfz`). No start script is written —
 * the engine reads map/game/players from the demo. Resolves when the engine
 * exits. Shares the single-game guard with `playLaunch`.
 */
export const playLaunchReplay = defineCommand<
  {
    demoPath: string;
    executable: string;
    dataDir: string;
    runId: string;
    onEvent: Channel<LaunchEvent>;
  },
  { exitCode: number | null }
>("coilbox-play", "play_launch_replay");

/**
 * Resume a savegame (`.ssf`/`.slsf`). No start script is written — the engine
 * reads everything from the save when it's passed as the positional argument.
 * Resolves when the engine exits. Shares the single-game guard with `playLaunch`.
 */
export const playLaunchSave = defineCommand<
  {
    savePath: string;
    executable: string;
    dataDir: string;
    runId: string;
    onEvent: Channel<LaunchEvent>;
  },
  { exitCode: number | null }
>("coilbox-play", "play_launch_save");

/** Kill an in-flight game by run id. */
export const playCancel = defineCommand<
  { runId: string },
  { cancelled: boolean }
>("coilbox-play", "play_cancel");

/**
 * Bring the running game's window back to the foreground. Maps the run id to the
 * live engine process on the Rust side. Best-effort — resolves `focused:false`
 * when no window could be raised (e.g. Wayland).
 */
export const playFocus = defineCommand<{ runId: string }, { focused: boolean }>(
  "coilbox-play",
  "play_focus",
);
