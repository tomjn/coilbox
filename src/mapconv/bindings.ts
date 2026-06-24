import { defineCommand } from "@picoframe/plugin-sdk";
import type { Channel } from "@tauri-apps/api/core";

/**
 * Typed bindings to `plugin:coilbox-mapconv|*`. The first `defineCommand`
 * argument is the Tauri ACL identifier (crate name minus `tauri-plugin-`).
 * Argument keys are camelCase; Tauri maps them to the crate's snake_case params,
 * and the `CompileOpts`/`DecompileOpts` structs use serde `rename_all =
 * "camelCase"`. Each command returns the inner data of the plugin's `CliResult`
 * envelope (or throws its error message).
 */

/** One streamed output line from a run. */
export interface LogLine {
  stream: "out" | "err";
  line: string;
}

export type CompressionType = 1 | 2 | 3 | 4;

/**
 * A `mapcompile` request. One field per CLI flag. `outDir` is NOT a CLI flag —
 * it is the spawn working directory, kept separate because `-o` must be a bare
 * suffix (mapcompile bakes `<suffix>.smt` into the `.smf`).
 */
export interface CompileOpts {
  maintexture: string; // -t (required)
  outSuffix: string; // -o (required, bare basename)
  heightmap?: string; // -h
  maxh?: number; // -maxh
  minh?: number; // -minh
  metalmap?: string; // -m
  typemap?: string; // -z
  minimap?: string; // -minimap
  vegmap?: string; // -v
  compressionType?: CompressionType; // -ct
  ccount?: number; // -ccount
  th?: number; // -th
  noclamp: boolean; // -noclamp
  smooth: boolean; // -smooth
  features?: string; // -features
}

/** Basic map facts parsed from the `.smf` header after a decompile. */
export interface MapInfo {
  mapx: number;
  mapy: number;
  squareSize: number;
  minHeight: number;
  maxHeight: number;
  worldWidth: number;
  worldHeight: number;
}

/** Plugin config, persisted through the frame settings store. */
export interface Config {
  lastTextureDir?: string;
  lastOutDir?: string;
  lastSmfDir?: string;
  defaultCompressionType: CompressionType;
  rememberDirs: boolean;
}

/** Which sidecars are bundled — drives the UI's readiness banner. */
export const mcProbe = defineCommand<
  undefined,
  { available: boolean; compile: boolean; decompile: boolean }
>("coilbox-mapconv", "mc_probe");

/** Conventional sibling source files found next to a chosen main texture. */
export const mcSuggestSources = defineCommand<
  { texturePath: string },
  { heightmap?: string; metalmap?: string; typemap?: string; minimap?: string; vegmap?: string; features?: string }
>("coilbox-mapconv", "mc_suggest_sources");

export const mcCompile = defineCommand<
  { opts: CompileOpts; outDir: string; runId: string; onLog: Channel<LogLine> },
  { smfPath: string; outSuffix: string }
>("coilbox-mapconv", "mc_compile");

export const mcDecompile = defineCommand<
  { inputPath: string; runId: string; onLog: Channel<LogLine> },
  { directory: string; exitCode: number; mapInfo?: MapInfo | null; minimap?: string | null }
>("coilbox-mapconv", "mc_decompile");

export const mcCancel = defineCommand<{ runId: string }, { cancelled: boolean }>(
  "coilbox-mapconv",
  "mc_cancel",
);

/** Open a folder in the OS file manager (Finder/Explorer/file manager). */
export const mcOpenPath = defineCommand<{ path: string }, { opened: boolean }>(
  "coilbox-mapconv",
  "mc_open_path",
);

/** Whole settings map (opaque JSON-encoded string values), for the frame's SettingsStorage. */
export const mcSettingsLoad = defineCommand<undefined, { entries: Record<string, string> }>(
  "coilbox-mapconv",
  "mc_settings_load",
);

export const mcSettingsSave = defineCommand<{ entries: Record<string, string> }, Record<string, never>>(
  "coilbox-mapconv",
  "mc_settings_save",
);
