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
  /**
   * Host address: `0.0.0.0` when hosting a networked game, `127.0.0.1` when
   * hosting one through the relay, or the host to join.
   */
  hostIp?: string;
  /**
   * Why this host binds an address the engine will warn about, written into the
   * start script as a comment above `HostIP`.
   *
   * Only set on a relayed host. The engine says a loopback socket means nobody
   * can connect, which under a relay is untrue, and the script is the file next
   * to the infolog somebody has just read that in.
   */
  hostLoopbackReason?: string;
  /** Host port (networked host or client). Omitted for pure singleplayer. */
  hostPort?: number;
  /** Script password presented to the host (client scripts only). */
  myPasswd?: string;
}

/** Engine lifecycle event streamed while a game runs. */
export interface LaunchEvent {
  kind: "started" | "exited";
  code?: number;
  signal?: number;
}

/**
 * How the engine process ended.
 *
 * `signal` is what makes a crash visible. A segfault kills the engine outright,
 * so there is no exit code to report and `exitCode` is null while `signal` names
 * the signal. Windows has no signals, so it is always null there. Both null means
 * the run was cancelled: `playCancel` removed the child before it was reaped.
 */
export interface LaunchOutcome {
  exitCode: number | null;
  signal: number | null;
}

/** The tail of an engine `infolog.txt`, with enough about the file to tell
 * whether it belongs to a given run. */
export interface InfologTail {
  path: string;
  /** Last modified, milliseconds since the unix epoch. */
  modifiedMs: number;
  /** Lines in the whole file, not just the tail. */
  totalLines: number;
  /** The last `maxLines` lines. */
  lines: string[];
  /** Whether anything was left off the front. */
  truncated: boolean;
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

/** The content folders among `roots` that hold BYAR-Chobby's
 *  `optionsPresets.json`, as the path to the file in each. */
export const playChobbyPresetsFind = defineCommand<
  { roots: string[] },
  { files: string[] }
>("coilbox-play", "play_chobby_presets_find");

/** The records of an `optionsPresets.json` as one JSON object. Errors when
 *  the file is one Chobby could not decode. */
export const playChobbyPresetsRead = defineCommand<
  { path: string },
  { json: string }
>("coilbox-play", "play_chobby_presets_read");

/** One change to an `optionsPresets.json`. */
export type ChobbyPresetEdit =
  | { op: "set"; name: string; record: unknown }
  | { op: "remove"; name: string };

/**
 * Apply edits to an `optionsPresets.json`. The file is read again inside the
 * command, so a change Chobby made meanwhile is kept, and copied beside itself
 * before it is replaced. Returns the file as it now is and the copy's path.
 */
export const playChobbyPresetsWrite = defineCommand<
  { path: string; edits: ChobbyPresetEdit[] },
  { json: string; backup: string }
>("coilbox-play", "play_chobby_presets_write");

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
    /**
     * Open coilbox's end of the engine's autohost interface for this run, so
     * `playAskLuaRules` can reach the game while it runs (issue #3346).
     */
    autohost?: boolean;
    onEvent: Channel<LaunchEvent>;
  },
  LaunchOutcome
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
  LaunchOutcome
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
  LaunchOutcome
>("coilbox-play", "play_launch_save");

/**
 * Send `/luarules <message>` to a game launched with `autohost`, and wait for a
 * Lua message from it starting with `reply` (issue #3346). Rejects when the
 * game has not started, or does not answer in time.
 */
export const playAskLuaRules = defineCommand<
  { runId: string; message: string; reply: string },
  { answer: string; seconds: number }
>("coilbox-play", "play_ask_lua_rules");

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

/**
 * Read the tail of the engine's most recent `infolog.txt`.
 *
 * It is not in `dataDir`, whatever the content root says. The engine writes the
 * log to its own write dir, which on unix is `~/.config/spring` rather than
 * anything coilbox named, so the Rust side searches every dir the engine could
 * have picked and returns the newest log it finds.
 *
 * The result says when the log was written and nothing about which run wrote it.
 * The caller knows when its launch started, so the caller decides. Rejects when
 * no engine log exists anywhere.
 */
export const playInfolog = defineCommand<
  { dataDir: string; maxLines: number },
  { log: InfologTail }
>("coilbox-play", "play_infolog");

/** The machine coilbox runs on, as far as the OS will say. */
export interface SystemInfo {
  /** `macos`, `windows` or `linux`. */
  os: string;
  osVersion: string | null;
  /** `aarch64`, `x86_64` and so on. */
  arch: string;
}

/** The operating system, its version and the CPU architecture. */
export const playSystemInfo = defineCommand<Record<string, never>, SystemInfo>(
  "coilbox-play",
  "play_system_info",
);

/** An Open Annihilation program that ran: where it is and what it printed for `--version`. */
export interface OaProgram {
  path: string;
  /** The first line of `--version`, such as `Open Annihilation 0.8.9 (macos-universal arm64, 9eb18ad4)`. */
  version: string;
}

/**
 * Look for Open Annihilation where its installer puts it. `found` is `null` when
 * it is not there, and always on Linux, which has no fixed location.
 */
export const playOaFind = defineCommand<
  Record<string, never>,
  { found: OaProgram | null }
>("coilbox-play", "play_oa_find");

/**
 * Run the program at `path` with `--version`. Rejects, with a message to show,
 * when it is not a program, does not run, or does not print an Open Annihilation
 * version line.
 */
export const playOaCheck = defineCommand<{ path: string }, OaProgram>(
  "coilbox-play",
  "play_oa_check",
);

/** An installed Open Annihilation map. */
export interface OaMap {
  /** What OA's menus show, and what the lobby's map field carries. */
  shownName: string;
  /** What OA's `--map` takes. */
  key: string;
}

/**
 * The maps the Open Annihilation at `path` has installed, from
 * `--list-content --json`. Rejects, with a message to show, when the program
 * would not run or printed something else.
 */
export const playOaMaps = defineCommand<{ path: string }, { maps: OaMap[] }>(
  "coilbox-play",
  "play_oa_maps",
);

/**
 * One line of Open Annihilation's status stream. Fields coilbox reads are named.
 * `seq`, `frame` and `tick` are on every kind but `hello` and `unreadable`, and
 * anything else OA wrote on the line (a screen's `previous`, an exit's `code`)
 * arrives alongside them.
 */
export type OaEvent =
  | { kind: "hello"; version: string; pid: number }
  | { kind: "screen"; name: string }
  | { kind: "match"; change: string }
  | { kind: "gameOver"; results: unknown[] }
  | { kind: "exit"; reason: string }
  | { kind: "unknown"; event: string }
  | { kind: "unreadable"; line: string };

/**
 * Start the Open Annihilation at `executable` with `args`, always adding
 * `--status-stdout`, and stream what it reports down `onEvent`. Resolves when
 * the process exits, with both `exitCode` and `signal` null when `playOaCancel`
 * ended it. Rejects with OA's own words when it refuses an option, and while
 * another OA runs.
 */
export const playOaLaunch = defineCommand<
  {
    executable: string;
    args: string[];
    runId: string;
    onEvent: Channel<OaEvent>;
  },
  LaunchOutcome
>("coilbox-play", "play_oa_launch");

/** End the Open Annihilation a launch started, by run id. */
export const playOaCancel = defineCommand<
  { runId: string },
  { cancelled: boolean }
>("coilbox-play", "play_oa_cancel");
