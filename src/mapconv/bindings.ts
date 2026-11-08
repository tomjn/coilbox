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

/**
 * Best-effort subset of a map's `mapinfo.lua` (plus an `.smf`-header height
 * fallback for old maps). Every field may be `null` when not found as a literal.
 * Colours are RGB triples in 0–1; `sunDir` is a direction vector.
 */
export interface MapAppearance {
  name?: string | null;
  description?: string | null;
  author?: string | null;
  version?: string | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  /** `voidWater`: no water plane, terrain below the sea plane shows the skybox. */
  voidWater?: boolean | null;
  /** `voidGround` (engine 92.0+): ground transparent where the diffuse alpha is
   * below `voidAlphaMin`. Surfaced for display; the preview can't reproduce it. */
  voidGround?: boolean | null;
  voidAlphaMin?: number | null;
  /** `extractorRadius`: how far a metal extractor reaches on this map. Absent
   * when `mapinfo.lua` sets none, which the engine reads as 500. */
  extractorRadius?: number | null;
  /** Effective water tint (`surfaceColor`, falling back to `planeColor`). */
  waterColor?: [number, number, number] | null;
  waterAlpha?: number | null;
  /** `water.planeColor` on its own, kept distinct from the merged `waterColor`. */
  waterPlaneColor?: [number, number, number] | null;
  /** Depth-based water colouring (`water.absorb`/`baseColor`/`minColor`). */
  waterAbsorb?: [number, number, number] | null;
  waterBaseColor?: [number, number, number] | null;
  waterMinColor?: [number, number, number] | null;
  /** `water.forceRendering`: when `false`, the map wants no water plane even below
   * the sea plane (the space-map "no water" signal alongside `voidWater`). */
  forceRendering?: boolean | null;
  skyColor?: [number, number, number] | null;
  fogColor?: [number, number, number] | null;
  cloudColor?: [number, number, number] | null;
  cloudDensity?: number | null;
  sunDir?: [number, number, number] | null;
  sunColor?: [number, number, number] | null;
  /** `atmosphere.sunColor` alone: the colour the engine draws the sky's sun in.
   * `sunColor` prefers `lighting.sunColor`, which the engine ignores. */
  skySunColor?: [number, number, number] | null;
  /** `lighting.*` ground shading colours. */
  groundAmbientColor?: [number, number, number] | null;
  groundDiffuseColor?: [number, number, number] | null;
  groundSpecularColor?: [number, number, number] | null;
  groundShadowDensity?: number | null;
  /** `atmosphere.skyBox` — a DDS cube map (relative to the map root), if any. */
  skyBox?: string | null;
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
  {
    heightmap?: string;
    metalmap?: string;
    typemap?: string;
    minimap?: string;
    vegmap?: string;
    features?: string;
  }
>("coilbox-mapconv", "mc_suggest_sources");

/**
 * Read a map's `mapinfo.lua` (searching `path`'s folder and its parent; `path`
 * may be a chosen texture file or a decompiled directory). Returns metadata,
 * height range, and appearance hints, falling back to a sibling `.smf` header
 * for the height range when there's no `mapinfo.lua`.
 */
export const mcReadMapinfo = defineCommand<{ path: string }, MapAppearance>(
  "coilbox-mapconv",
  "mc_read_mapinfo",
);

/**
 * Read a map's `atmosphere.skyBox` DDS (a loose file next to `mapinfo.lua`,
 * searched the same way as `mc_read_mapinfo`) as a raw-bytes `data:` URL for the
 * 3D preview's sky. `dataUrl` is null when the map declares no skybox or the file
 * is missing.
 */
export const mcReadSkybox = defineCommand<
  { path: string },
  { dataUrl?: string | null }
>("coilbox-mapconv", "mc_read_skybox");

/**
 * Decode an image to its true pixel size plus a small preview thumbnail. `max`
 * sets the thumbnail's longest side, 320 by default, and the 3D preview asks for
 * a larger heightmap so displacement has enough detail.
 *
 * The thumbnail normally arrives as `thumbFile`, a name under
 * `coilbox://mapconvthumb/`, with `thumb` a `data:` URL only where there was
 * nowhere to cache it. Read it through `getImageInfo`, which resolves the two
 * into one `src`.
 */
export const mcImageInfo = defineCommand<
  { path: string; max?: number },
  { width: number; height: number; thumbFile?: string; thumb?: string }
>("coilbox-mapconv", "mc_image_info");

/**
 * Decode a heightmap to the engine's own 16 bit words, decimated to `max` on the
 * longest edge, and report the cache file holding them (issue #1730).
 *
 * Separate from {@link mcImageInfo} because a picture cannot carry them: a
 * browser flattens an image to eight bits a channel on the way in whatever the
 * file holds, so a slope drawn from a thumbnail comes out as contour rings. Read
 * it through `getHeightWords`, which fetches the bytes and frames them.
 */
export const mcHeightField = defineCommand<
  { path: string; max: number },
  { width: number; height: number; file: string }
>("coilbox-mapconv", "mc_height_field");

/**
 * A compiled `.smf`'s heights as the engine reads them, written to a cache file
 * under `coilbox://mapconvthumb/` with the corner grid and height range they
 * are on (issue #2169).
 */
export const mcSmfHeights = defineCommand<
  { path: string },
  {
    file: string;
    width: number;
    height: number;
    minHeight: number;
    maxHeight: number;
    /** The metal map in the same cache, one byte per 16 by 16 elmo cell. Absent
     * when the `.smf`'s metal map pointer does not lie inside the file. */
    metalFile?: string;
    metalWidth?: number;
    metalHeight?: number;
    /** Why the metal map could not be read, when it lies inside the file. */
    metalError?: string;
  }
>("coilbox-mapconv", "mc_smf_heights");

export const mcCompile = defineCommand<
  { opts: CompileOpts; outDir: string; runId: string; onLog: Channel<LogLine> },
  { smfPath: string; outSuffix: string }
>("coilbox-mapconv", "mc_compile");

/**
 * The `mapinfo.lua` fields the Compile page sends. A field left out is not the
 * page's to set: an existing file keeps its value and a new file gets the
 * writer's default. Colours are RGB triples in 0 to 1, start positions are in
 * elmos.
 */
export interface MapinfoForm {
  name?: string;
  shortname?: string;
  description?: string;
  author?: string;
  skyColor?: [number, number, number];
  fogColor?: [number, number, number];
  sunColor?: [number, number, number];
  /** A direction vector, not a colour: its parts are not limited to 0 to 1. */
  sunDir?: [number, number, number];
  groundAmbientColor?: [number, number, number];
  groundDiffuseColor?: [number, number, number];
  waterSurfaceColor?: [number, number, number];
  waterSurfaceAlpha?: number;
  terrainHardness?: number;
  /**
   * One slot per team, in team order. `null` is a row left unfilled. Left out,
   * the page has no opinion and the file's teams stay. An empty list says the
   * map has no start positions, which removes `teams` from the file. A list
   * shorter than the file's teams removes the ones past its end.
   */
  startPositions?: ({ x: number; z: number } | null)[];
}

/**
 * The start positions in `<outDir>/mapinfo.lua`, one slot per team in team
 * order, `null` for a team without one. Empty when there is no file or it has
 * no teams.
 */
export const mcReadTeams = defineCommand<
  { outDir: string },
  { teams: ({ x: number; z: number } | null)[] }
>("coilbox-mapconv", "mc_read_teams");

/**
 * Write `<outDir>/mapinfo.lua` for a map just compiled as `<outSuffix>.smf`, or
 * patch the one already there so every field the page does not own survives.
 * Heights default to the `.smf` header when the form has none.
 */
export const mcWriteMapinfo = defineCommand<
  {
    opts: {
      outDir: string;
      outSuffix: string;
      minHeight?: number;
      maxHeight?: number;
      info: MapinfoForm;
    };
  },
  { path: string; created: boolean; changed: boolean }
>("coilbox-mapconv", "mc_write_mapinfo");

/**
 * Write a generated sky into a compiled map as `<outDir>/maps/skybox.jpg` and
 * point `atmosphere.skyBox` at it. Refused when `mapinfo.lua` already names
 * another skybox.
 */
export const mcWriteSkybox = defineCommand<
  { outDir: string; jpeg: number[] },
  { path: string; mapinfoChanged: boolean }
>("coilbox-mapconv", "mc_write_skybox");

/**
 * Write `<outDir>/<outSuffix>.sdz` from the compile and the `mapinfo.lua` beside
 * it. `files` lists the archive's entries by their path inside it.
 */
export const mcPackMap = defineCommand<
  { outDir: string; outSuffix: string },
  { path: string; files: string[] }
>("coilbox-mapconv", "mc_package_map");

/**
 * Copy a packed `.sdz` into `<rootPath>/maps/`. When an `.sdz` with that name
 * is already there and `replace` is false, nothing is copied and `installed` is
 * false. When `sdzPath` is already the archive in `maps/`, nothing is copied
 * and `installed` is true with `replaced` false. `replaced` is true when the copy took the place of one. A `.sd7` or
 * `.sdd` with the same name is an error whatever `replace` says.
 */
export const mcInstallMap = defineCommand<
  { sdzPath: string; rootPath: string; replace: boolean },
  { installed: boolean; replaced: boolean; path: string }
>("coilbox-mapconv", "mc_install_map");

export const mcDecompile = defineCommand<
  { inputPath: string; runId: string; onLog: Channel<LogLine> },
  {
    directory: string;
    exitCode: number;
    mapInfo?: MapInfo | null;
    minimap?: string | null;
  }
>("coilbox-mapconv", "mc_decompile");

export const mcCancel = defineCommand<
  { runId: string },
  { cancelled: boolean }
>("coilbox-mapconv", "mc_cancel");

/** Open a folder in the OS file manager (Finder/Explorer/file manager). */
export const mcOpenPath = defineCommand<{ path: string }, { opened: boolean }>(
  "coilbox-mapconv",
  "mc_open_path",
);

/** Open an external http(s) URL (e.g. a wiki help page) in the OS browser. */
export const mcOpenUrl = defineCommand<{ url: string }, { opened: boolean }>(
  "coilbox-mapconv",
  "mc_open_url",
);
