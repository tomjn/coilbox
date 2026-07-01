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

/** A native skirmish AI — becomes an `[AI]` block. */
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
  /** A game Lua AI controlling this team — set INSTEAD of an `[AI]` block. */
  luaAi?: string;
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

/** Kill an in-flight game by run id. */
export const playCancel = defineCommand<
  { runId: string },
  { cancelled: boolean }
>("coilbox-play", "play_cancel");
