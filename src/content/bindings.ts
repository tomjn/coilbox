import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to `plugin:coilbox-content|*` (crate `tauri-plugin-coilbox-content`,
 * ACL id `coilbox-content`). These types are also the cross-plugin read API: other
 * plugins can call `contentStateLoad` / `contentListEngines` to discover where
 * Spring/Recoil content lives without re-implementing detection.
 *
 * Timestamps are epoch-millis numbers (format with `new Date(ms)`).
 */

export type RootSource = "auto" | "manual";
export type RootKind = "data" | "portable";

/** Cheap archive counts for a root (`pool/` is never enumerated). */
export interface RootCounts {
  games: number;
  maps: number;
  engines: number;
  packages: number;
}

/** A discovered Spring/Recoil engine install. */
export interface Engine {
  id: string;
  rootPath: string;
  /** Directory containing the engine binary. */
  path: string;
  /** Absolute path to the spring / spring-headless executable. */
  executable: string;
  /** Platform dir name when present, e.g. `linux64`, `macos_arm64`. */
  platform?: string;
  /** Folder-derived version (the version dir name). */
  version: string;
  /** Populated only after an explicit verify, e.g. `104.0.1-1828-g1f481b7 BAR`. */
  syncVersion?: string;
  /** Epoch-ms of the last successful verify. */
  verifiedAt?: number;
}

/** A tracked content folder (Spring/Recoil data root). */
export interface ContentRoot {
  id: string;
  path: string;
  source: RootSource;
  kind: RootKind;
  label?: string;
  /** Which detector(s) matched this path, e.g. `prd-default`, `bar`, `manual`. */
  origins: string[];
  exists: boolean;
  valid: boolean;
  /** Stored as a path relative to the app dir — a portable root that follows the
   * executable when the whole package is moved. */
  portable: boolean;
  /** Present when a manual root was added despite failing validation. */
  forced?: boolean;
  counts: RootCounts;
  engines: Engine[];
  lastScannedAt?: number;
}

/** The authoritative persisted state (snapshot of the last scan). */
export interface ContentState {
  schemaVersion: number;
  roots: ContentRoot[];
  lastScanAt?: number;
}

/** A standard candidate location, before it is tracked. */
export interface RootCandidate {
  path: string;
  origin: string;
  exists: boolean;
  valid: boolean;
}

/** Standard per-OS candidate locations with exists/valid flags (no scan). */
export const contentCandidates = defineCommand<
  { includeZerok?: boolean } | undefined,
  { candidates: RootCandidate[] }
>("coilbox-content", "content_candidates");

/** The persisted snapshot (cross-plugin read API). */
export const contentStateLoad = defineCommand<
  undefined,
  { state: ContentState }
>("coilbox-content", "content_state_load");

/** Recompute roots/engines from scratch and persist. */
export const contentRescan = defineCommand<
  { withCounts?: boolean; includeZerok?: boolean } | undefined,
  { state: ContentState }
>("coilbox-content", "content_rescan");

/** Rescan a single tracked root; returns the refreshed root. */
export const contentScanRoot = defineCommand<
  { path: string },
  { root: ContentRoot }
>("coilbox-content", "content_scan_root");

/**
 * Add a manually-picked root. Pass `force` to accept a folder that doesn't
 * validate; pass `portable` to store it relative to the app dir (must be inside
 * the app folder) so it follows the executable in a portable install.
 */
export const contentAddRoot = defineCommand<
  { path: string; label?: string; force?: boolean; portable?: boolean },
  { state: ContentState }
>("coilbox-content", "content_add_root");

/** Remove a manual root (auto roots can't be removed). */
export const contentRemoveRoot = defineCommand<
  { path: string },
  { state: ContentState }
>("coilbox-content", "content_remove_root");

/** Create the OS-standard content folder on disk and register it (forced). */
export const contentCreateStandardRoot = defineCommand<
  undefined,
  { state: ContentState }
>("coilbox-content", "content_create_standard_root");

/** Recreate a configured root's folder on disk after it was deleted (forced). */
export const contentRecreateRoot = defineCommand<
  { path: string },
  { state: ContentState }
>("coilbox-content", "content_recreate_root");

/** Every engine across tracked roots (cross-plugin read API). */
export const contentListEngines = defineCommand<
  undefined,
  { engines: Engine[] }
>("coilbox-content", "content_list_engines");

/** Execute the engine binary to read its sync-version. Returns the updated engine. */
export const contentVerifyEngine = defineCommand<
  { path: string },
  { engine: Engine }
>("coilbox-content", "content_verify_engine");

/**
 * Reveal a content folder / engine directory in the OS file manager. Runs the
 * platform open command in Rust, so it works for any path (unlike the frontend
 * opener plugin, which is gated by a capability path scope).
 */
export const contentOpenPath = defineCommand<{ path: string }, unknown>(
  "coilbox-content",
  "content_open_path",
);

/* -------------------------------------------------------------------------- *
 * Replays — demo files in a root's `demos/`/`replays/` folder. Listing is cheap
 * fs metadata; decoding reads the demo's native header + start-script and shells
 * out to `demotool` (in the engine folder) for the winning ally-teams.
 * -------------------------------------------------------------------------- */

/**
 * A replay file on disk. The summary fields come from a cheap native decode of
 * the demo header + start-script (no demotool); they're absent if it can't be
 * decoded. `startTimeMs` (from the header) is a more accurate played date than
 * `modifiedMs` (the file mtime).
 */
export interface ReplayFile {
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedMs: number;
  mapName?: string;
  gameType?: string;
  durationSec?: number;
  /** Non-spectator player count. */
  playerCount?: number;
  startTimeMs?: number;
  /** Min/avg/max non-spectator player skill (from the start-script), when present. */
  skillMin?: number;
  skillAvg?: number;
  skillMax?: number;
}

/** One player/spectator from a demo, with side + ally-team resolved from their team. */
export interface ReplayPlayer {
  name: string;
  team?: number;
  allyTeam?: number;
  /** Faction (the team's `side`, e.g. `Armada`/`Cortex`/`Legion`). */
  side?: string;
  /** Normalized team colour `[r, g, b]` in 0..1, when present. */
  rgbColor?: [number, number, number];
  spectator: boolean;
  /** Set only when the winner is known and the player isn't a spectator. */
  won?: boolean;
  skill?: string;
  countryCode?: string;
}

/** A start box (`startrect`), normalized 0..1 over the map (origin top-left). */
export interface StartBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** An ally team: its start box and a representative colour, for the minimap overlay. */
export interface AllyTeamInfo {
  id: number;
  startBox?: StartBox;
  /** Representative team colour `[r, g, b]` in 0..1. */
  color?: [number, number, number];
}

/** Decoded replay metadata (native header + start-script + demotool winner). */
export interface DemoInfo {
  engineVersion: string;
  gameId?: string;
  /** Battle start, epoch-millis (format with `new Date(ms)`). */
  startTimeMs: number;
  /** In-game duration, seconds. */
  durationSec: number;
  /** Wall-clock duration, seconds. */
  wallclockSec: number;
  mapName: string;
  /** Game + version, e.g. `Beyond All Reason test-30018-d71d659`. */
  gameType: string;
  startPosType?: number;
  winningAllyTeams: number[];
  /** False when demotool was absent/failed — show "winner unknown", not a draw. */
  winnersKnown: boolean;
  numAllyTeams: number;
  allyTeams: AllyTeamInfo[];
  players: ReplayPlayer[];
}

/** List replays in a content root's `demos/`/`replays/` (cheap; newest first). */
export const contentListReplays = defineCommand<
  { root: string },
  { replays: ReplayFile[] }
>("coilbox-content", "content_list_replays");

/**
 * Decode one replay. `enginePath` is an `Engine.path` (the engine folder holding
 * `demotool`); `replayPath` is a `ReplayFile.path`.
 */
export const contentDemoInfo = defineCommand<
  { enginePath: string; replayPath: string },
  { info: DemoInfo }
>("coilbox-content", "content_demo_info");

/** One chat/system line from a replay's network stream. */
export interface ChatLine {
  /** The speaking player's number, when the line names one. */
  player?: number;
  /** Player name resolved from the start-script, when known. */
  playerName?: string;
  text: string;
  /** True for engine system messages (vs a player chat line). */
  system: boolean;
}

/**
 * Extract a replay's chat log (its `NETMSG_CHAT`/`SYSTEMMSG` lines) via
 * `demotool --dump`. Read on demand — it walks the whole demo stream.
 */
export const contentDemoChat = defineCommand<
  { enginePath: string; replayPath: string },
  { messages: ChatLine[] }
>("coilbox-content", "content_demo_chat");

/* -------------------------------------------------------------------------- *
 * Savegames — singleplayer saves in a root's `Saves/` folder. Listing is cheap fs
 * metadata plus a best-effort map/game read from the save's embedded start-script.
 * -------------------------------------------------------------------------- */

/** A savegame on disk (`.ssf`/`.slsf`). `modifiedMs` (file mtime) is the save date. */
export interface SaveFile {
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedMs: number;
  mapName?: string;
  gameType?: string;
}

/** List savegames under a content root's `Saves/` folder (newest first). */
export const contentListSaves = defineCommand<
  { root: string },
  { saves: SaveFile[] }
>("coilbox-content", "content_list_saves");

/** Delete one savegame file (guarded to `.ssf`/`.slsf` paths). */
export const contentDeleteSave = defineCommand<
  { path: string },
  { ok: boolean }
>("coilbox-content", "content_delete_save");

/* -------------------------------------------------------------------------- *
 * Engine-config profiles — named backup/restore of a content root's
 * `springsettings.cfg`, `LuaUI/Config/` and `uikeys.txt`, so users can snapshot
 * and swap settings sets. Snapshots live under the app data dir, keyed per root.
 * -------------------------------------------------------------------------- */

/** One saved engine-config snapshot for a content root. */
export interface ConfigProfile {
  /** Display name as the user typed it. */
  name: string;
  /** Filesystem slug (its id for restore/delete). */
  slug: string;
  /** Creation time, epoch-millis (format with `new Date(ms)`). */
  createdAtMs: number;
  /** Which artifacts were captured: `springsettings.cfg`, `uikeys.txt`, `LuaUI/Config`. */
  artifacts: string[];
}

/** List saved engine-config profiles for a content root (newest first). */
export const contentConfigProfiles = defineCommand<
  { rootPath: string },
  { profiles: ConfigProfile[] }
>("coilbox-content", "content_config_profiles");

/** Snapshot the root's present config artifacts into a named profile. */
export const contentConfigBackup = defineCommand<
  { rootPath: string; name: string },
  { profile: ConfigProfile }
>("coilbox-content", "content_config_backup");

/**
 * Restore a profile's artifacts into the root. Without `overwrite`, refuses when
 * live files would be clobbered, returning `needsOverwrite: true` (nothing written)
 * so the UI can confirm and re-call with `overwrite: true`.
 */
export const contentConfigRestore = defineCommand<
  { rootPath: string; slug: string; overwrite?: boolean },
  { needsOverwrite: boolean; restored: number }
>("coilbox-content", "content_config_restore");

/** Delete a saved engine-config profile. */
export const contentConfigDeleteProfile = defineCommand<
  { rootPath: string; slug: string },
  { ok: boolean }
>("coilbox-content", "content_config_delete_profile");

/* -------------------------------------------------------------------------- *
 * unitsync content scan (plugin `tauri-plugin-coilbox-unitsync`, ACL id
 * `coilbox-unitsync`). The Content browser pages call this alongside the
 * content-state bindings above: this plugin's frontend talks to two backends.
 * -------------------------------------------------------------------------- */

/** An archive (`.sdz`/`.sd7`/`.sdd`) backing a map or game. */
export interface Archive {
  name: string;
  /** Full on-disk path, when the archive name resolves (game primary archives). */
  path?: string;
  /** Hex CRC, when a checksum accessor is available. */
  checksum?: string;
  /** On-disk size in bytes, when the path resolves. */
  size?: number;
}

/** One selectable item of a `list`-typed option. */
export interface OptionListItem {
  key: string;
  name: string;
}

/** A map or game configuration option, with its type/default when known. */
export interface ConfigOption {
  key: string;
  name: string;
  description?: string;
  /** `"bool"` | `"number"` | `"list"` | `"string"` (omitted if unknown). */
  type?: "bool" | "number" | "list" | "string";
  /** Default value, stringified (`"1"`/`"0"` for bool, the item key for list). */
  default?: string;
  numberMin?: number;
  numberMax?: number;
  numberStep?: number;
  listItems?: OptionListItem[];
}

export interface MapItem {
  name: string;
  fileName?: string;
  archives: Archive[];
  /** mapinfo metadata (description, author, dimensions, ...). */
  info: Record<string, string>;
  /** Map proportions; the ratio is the true aspect ratio for undistorted display. */
  width?: number;
  height?: number;
}

export interface GameItem {
  name: string;
  /** The game's own archive. */
  primaryArchive: Archive;
  /** Archives the game depends on (its primary archive excluded). */
  dependencyArchives: Archive[];
  /** modinfo metadata (name, shortname, version, description, ...). */
  info: Record<string, string>;
  /** Non-fatal unitsync diagnostics attributed to this game during the scan. */
  warnings?: string[];
}

/** A faction/side of a game, with its commander/start unit. */
export interface Side {
  name: string;
  startUnit?: string;
  /** Friendly start-unit name, when the engine can enumerate units. */
  startUnitName?: string;
}

/** A unit available in a game (from `GetUnitName`/`GetFullUnitName`). */
export interface UnitEntry {
  name: string;
  /** Friendly name of the unit, when the engine can enumerate units. */
  fullName?: string;
}

export interface GameInfoResult {
  sides: Side[];
  unitCount: number;
  /** Every unit in the game, sorted by internal name. */
  units: UnitEntry[];
  /** Game options (from modoptions.lua). */
  options: ConfigOption[];
  /** Hex CRC (from the primary archive), computed lazily here. */
  checksum?: string;
  errors: string[];
}

/**
 * Load a game's archives to read its sides (with start units) and unit count —
 * lazy, since it loads the whole game's archive set. `gameArchive` is the game's
 * primary archive name.
 */
export const unitsyncGameInfo = defineCommand<
  { enginePath: string; dataDir: string; gameArchive: string },
  GameInfoResult
>("coilbox-unitsync", "unitsync_game_info");

/** One resolved start unit: its friendly name and/or build-icon `data:` URL. */
export interface UnitDisplay {
  /** Human-friendly name from the unitdef `name` field, when present. */
  name?: string;
  /** Build-icon `data:` URL, when a texture resolved. */
  icon?: string;
}

export interface UnitBuildpicsResult {
  /** Unit internal name -> its display info, for units that resolved. */
  units: Record<string, UnitDisplay>;
  errors: string[];
}

/**
 * Resolve build icons for a game's start units — lazy, since it mounts the game's
 * archive set. `gameArchive` is the primary archive; `units` are internal names.
 */
export const unitsyncUnitBuildpics = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    units: string[];
  },
  UnitBuildpicsResult
>("coilbox-unitsync", "unitsync_unit_buildpics");

/** One unit in the reusable unit dataset: its names plus the internal names of the
 * units it can build (`buildoptions`, lowercased). */
export interface UnitDatasetEntry {
  name: string;
  fullName?: string;
  buildOptions?: string[];
  /** Whether the unit can move (mobile unit) vs a static building. */
  mobile?: boolean;
}

export interface UnitDatasetResult {
  /** Every unit in the game, sorted by internal name. */
  units: UnitDatasetEntry[];
  checksum?: string;
  errors: string[];
}

/**
 * Load a game's reusable unit graph (units + their `buildoptions` edges) — lazy,
 * since it mounts the game's archive set. Powers the per-faction build-tree viewer
 * and unit include/exclude filters. `gameArchive` is the primary archive name.
 */
export const unitsyncUnitDataset = defineCommand<
  { enginePath: string; dataDir: string; gameArchive: string },
  UnitDatasetResult
>("coilbox-unitsync", "unitsync_unit_dataset");

export interface MapInfoResult {
  options: ConfigOption[];
  checksum?: string;
  warnings?: string[];
  errors?: string[];
}

/**
 * Load a map's options + warnings — lazy, since it mounts the map's archive.
 */
export const unitsyncMapInfo = defineCommand<
  { enginePath: string; dataDir: string; mapName: string },
  MapInfoResult
>("coilbox-unitsync", "unitsync_map_info");

/** A skirmish AI available to play against: a native engine AI or a game Lua AI. */
export interface SkirmishAi {
  /** unitsync `shortName` — written to `[AI].ShortName` (native) or `[TEAM].LuaAI` (lua). */
  shortName: string;
  version?: string;
  name?: string;
  description?: string;
  /** `"native"` (engine-bundled) or `"lua"` (declared inside the game archive). */
  kind: "native" | "lua";
}

export interface SkirmishAisResult {
  ais: SkirmishAi[];
  errors: string[];
}

/**
 * List the skirmish AIs available to play against: native engine AIs, plus the
 * selected game's bundled Lua AIs when `gameArchive` is given. The list changes
 * per game (Lua AIs live inside each game's archive).
 */
export const unitsyncSkirmishAis = defineCommand<
  { enginePath: string; dataDir: string; gameArchive?: string },
  SkirmishAisResult
>("coilbox-unitsync", "unitsync_skirmish_ais");

export interface ScanResult {
  maps: MapItem[];
  games: GameItem[];
  /** Non-fatal diagnostics drained from unitsync during the scan. */
  errors: string[];
  syncVersion?: string;
}

/**
 * Scan one content root with one engine's libunitsync, out-of-process. `enginePath`
 * is the engine dir holding `libunitsync.*` (an `Engine.path`); `dataDir` is the
 * content root to enumerate (a `ContentRoot.path`).
 */
export const unitsyncScan = defineCommand<
  { enginePath: string; dataDir: string; opId?: string },
  ScanResult
>("coilbox-unitsync", "unitsync_scan");

/** Signal the matching in-flight `unitsync_scan`/`unitsync_thumbnails` worker to stop. */
export const unitsyncCancel = defineCommand<{ opId: string }, unknown>(
  "coilbox-unitsync",
  "unitsync_cancel",
);

/** A team start position in map world coordinates (elmos). */
export interface StartPos {
  x: number;
  z: number;
}

export interface MinimapResult {
  /** PNG `data:` URL ready for an `<img src>`, when the map has a minimap. */
  dataUrl?: string;
  side?: number;
  /** Team start positions, for overlaying on the minimap. */
  startPositions: StartPos[];
  /** Wind power range (`atmosphere.minWind`/`maxWind` from mapinfo.lua). */
  minWind?: number;
  maxWind?: number;
  /** Tidal power (`water.tidalStrength` from mapinfo.lua). */
  tidalStrength?: number;
  /** Water/sky/sun appearance from mapinfo.lua, for the 3D preview's lighting and
   * water colour. Colours are `[r, g, b]` in 0..1. `voidWater`/`voidGround` are the
   * transparency flags (space maps hide the water plane and everything below it). */
  voidWater?: boolean;
  voidGround?: boolean;
  voidAlphaMin?: number;
  waterColor?: [number, number, number];
  waterAlpha?: number;
  waterPlaneColor?: [number, number, number];
  waterAbsorb?: [number, number, number];
  waterBaseColor?: [number, number, number];
  waterMinColor?: [number, number, number];
  forceRendering?: boolean;
  skyColor?: [number, number, number];
  fogColor?: [number, number, number];
  cloudColor?: [number, number, number];
  cloudDensity?: number;
  sunDir?: [number, number, number];
  sunColor?: [number, number, number];
  groundAmbientColor?: [number, number, number];
  groundDiffuseColor?: [number, number, number];
  groundSpecularColor?: [number, number, number];
  groundShadowDensity?: number;
  errors: string[];
}

/**
 * Render one map's minimap as a PNG data URL (lazy — a separate unitsync session
 * from the scan). `mip` selects resolution: `1024 >> mip` px per side (default 1).
 */
export const unitsyncMinimap = defineCommand<
  { enginePath: string; dataDir: string; mapName: string; mip?: number },
  MinimapResult
>("coilbox-unitsync", "unitsync_minimap");

export interface HeightmapResult {
  /** Grayscale PNG `data:` URL of the (downscaled) heightmap, for a displacement map. */
  dataUrl?: string;
  /** Full heightmap dimensions `(mapx+1, mapy+1)`; the ratio is the map's aspect ratio. */
  width?: number;
  height?: number;
  /** World height at heightmap value 0 (the flat water plane sits here). */
  minHeight?: number;
  /** World height at heightmap value 65535. */
  maxHeight?: number;
  errors: string[];
}

/**
 * Render one map's height infomap as a grayscale PNG data URL plus its world
 * `minHeight`/`maxHeight` (for physically-correct 3D displacement). Lazy — a
 * separate unitsync session, cached on disk. `maxSide` caps the PNG's longest side
 * (default 512).
 */
export const unitsyncHeightmap = defineCommand<
  { enginePath: string; dataDir: string; mapName: string; maxSide?: number },
  HeightmapResult
>("coilbox-unitsync", "unitsync_heightmap");

export interface MetalmapResult {
  /** Green-on-transparent RGBA PNG `data:` URL of the (downscaled) metal infomap. */
  dataUrl?: string;
  /** Metal infomap dimensions; the ratio is the map's aspect ratio. */
  width?: number;
  height?: number;
  errors: string[];
}

/**
 * Render one map's metal infomap as a green-on-transparent RGBA PNG data URL, for
 * overlaying mex spots on a minimap. Lazy — a separate unitsync session, cached on
 * disk. `maxSide` caps the PNG's longest side (default 1024).
 */
export const unitsyncMetalmap = defineCommand<
  { enginePath: string; dataDir: string; mapName: string; maxSide?: number },
  MetalmapResult
>("coilbox-unitsync", "unitsync_metalmap");

export interface MapSkyboxResult {
  /** `data:` URL of the raw skybox DDS bytes (parsed by three.js `DDSLoader`),
   * when the map declares `atmosphere.skyBox`. */
  dataUrl?: string;
  errors: string[];
}

/**
 * Read one map's `atmosphere.skyBox` DDS cube map as raw bytes (a `data:` URL),
 * for the 3D preview's sky. Lazy — a separate unitsync session. Absent for the
 * common case of a map with no skybox.
 */
export const unitsyncMapSkybox = defineCommand<
  { enginePath: string; dataDir: string; mapName: string },
  MapSkyboxResult
>("coilbox-unitsync", "unitsync_map_skybox");

export interface ThumbnailsResult {
  thumbnails: {
    name: string;
    dataUrl: string;
    width?: number;
    height?: number;
  }[];
  errors: string[];
}

/** One engine configuration value, read from a curated key via `GetSpringConfig*`. */
export interface EngineConfigSetting {
  key: string;
  label: string;
  category: string;
  /** How to render the value. */
  type: "bool" | "number" | "string";
  /** The effective value (configured value, or the engine default when unset). */
  value: string;
  /** The engine's default for this key, for reset + "changed" hints. */
  default: string;
}

export interface EngineConfigResult {
  settings: EngineConfigSetting[];
  /** Path of the `springsettings.cfg` unitsync reads, when the build exposes it. */
  configPath?: string;
  /** Whether this unitsync build can write config (`SetSpringConfig*` present). */
  writable: boolean;
  errors: string[];
}

/**
 * Read a curated set of engine settings from the user's `springsettings.cfg`.
 * unitsync can't enumerate keys, so the worker reads a hand-picked catalog.
 * `enginePath` selects the libunitsync; `dataDir` the data root.
 */
export const unitsyncEngineConfig = defineCommand<
  { enginePath: string; dataDir: string },
  EngineConfigResult
>("coilbox-unitsync", "unitsync_engine_config");

/** Outcome of writing one engine setting. */
export interface EngineConfigWriteResult {
  ok: boolean;
  errors: string[];
}

/**
 * Write one curated engine setting back to `springsettings.cfg` via
 * `SetSpringConfig*`. `key` must be a catalog key; `dataDir` selects the data
 * root whose config is written (same resolution as the read command).
 */
export const unitsyncEngineConfigSet = defineCommand<
  { enginePath: string; dataDir: string; key: string; value: string },
  EngineConfigWriteResult
>("coilbox-unitsync", "unitsync_engine_config_set");

/**
 * Render a small minimap thumbnail for every map in one unitsync session (for the
 * Maps grid). `mip` selects resolution: `1024 >> mip` px (default 3 = 128px).
 */
export const unitsyncThumbnails = defineCommand<
  { enginePath: string; dataDir: string; mip?: number; opId?: string },
  ThumbnailsResult
>("coilbox-unitsync", "unitsync_thumbnails");

/** One member of an archive's file tree. */
export interface ArchiveFileEntry {
  /** Slash-separated path within the archive. */
  path: string;
  size: number;
}

export interface ArchiveTreeResult {
  files: ArchiveFileEntry[];
  /** The archive's on-disk path (for the `.sdd` "open folder" action). */
  archivePath?: string;
  /** Hex CRC, computed lazily here. */
  checksum?: string;
  errors: string[];
}

/**
 * List one archive's member tree (and resolve its on-disk path). Reads through
 * unitsync's VFS, so `.sd7`/`.sdz`/`.sdd` and rapid-pool `.sdp` packages all
 * work. `archive` is the archive name as unitsync knows it.
 */
export const unitsyncArchiveTree = defineCommand<
  { enginePath: string; dataDir: string; archive: string },
  ArchiveTreeResult
>("coilbox-unitsync", "unitsync_archive_tree");

export interface ArchiveFileResult {
  /** `"text"`, `"image"`, or `"binary"`. */
  kind: "text" | "image" | "binary";
  /** Decoded contents, when `kind === "text"`. */
  text?: string;
  /** `data:` URL, when `kind === "image"`. */
  dataUrl?: string;
  /** The member's real size in bytes. */
  size: number;
  /** True when the member was a previewable type but exceeded the size cap. */
  truncated: boolean;
  errors: string[];
}

/**
 * Read one member of an archive for preview. `file` is the member's
 * slash-separated path within `archive`. Text members are returned up to 512 KB
 * and images up to 8 MB; anything larger (or non-previewable) returns as binary.
 */
export const unitsyncArchiveFile = defineCommand<
  { enginePath: string; dataDir: string; archive: string; file: string },
  ArchiveFileResult
>("coilbox-unitsync", "unitsync_archive_file");

export interface GameHeadersResult {
  /** Header art per game (`dataUrl` absent when the game has no usable art). */
  headers: { name: string; dataUrl?: string }[];
  errors: string[];
}

/**
 * Resolve loading-screen art for every game in one unitsync session (for the
 * Games grid). Keyed on cheap file identity and disk-cached by the worker, so it
 * stays cheap on later launches; games with no usable art come back without a
 * `dataUrl` (the UI shows a gradient placeholder).
 */
export const unitsyncGameHeaders = defineCommand<
  { enginePath: string; dataDir: string },
  GameHeadersResult
>("coilbox-unitsync", "unitsync_game_headers");

export interface LuaExecResult {
  /** The pretty-printed value the script returned (set on success). */
  result?: string;
  /** A compile or runtime error from the Lua parser (set on failure). */
  error?: string;
  /** Non-fatal unitsync diagnostics (e.g. a missing dependency archive). */
  errors: string[];
}

/**
 * Run a Lua snippet through the engine's Lua parser with `archive` (and its
 * dependencies) mounted in the VFS, so `VFS.Include(...)` resolves against it.
 * Restricted, one-shot, no persistent state — a debugging aid, not a REPL. End
 * the script with `return …` to see a value.
 */
export const unitsyncLuaExec = defineCommand<
  { enginePath: string; dataDir: string; archive: string; source: string },
  LuaExecResult
>("coilbox-unitsync", "unitsync_lua_exec");

export interface LuaReplResult {
  /** The pretty-printed value the final chunk returned (set on success). */
  result?: string;
  /** A compile/runtime error, or a "session replay diverged…" message. */
  error?: string;
  /** 1-based index of a replayed chunk that failed (set with such an error). */
  divergedAt?: number;
  /** The final chunk's `print` output, newline-joined. */
  prints?: string;
  /** Non-fatal unitsync diagnostics (e.g. a missing dependency archive). */
  errors: string[];
}

/**
 * REPL replay: run `chunks` (the session's previously-successful inputs plus the
 * new one) sequentially in one fresh Lua state, with `archive` mounted. Globals
 * persist across chunks; only the final chunk's value, `print` output, and error
 * are reported. There is no live VM — each eval re-runs the whole session.
 */
export const unitsyncLuaReplExec = defineCommand<
  { enginePath: string; dataDir: string; archive: string; chunks: string[] },
  LuaReplResult
>("coilbox-unitsync", "unitsync_lua_repl_exec");

export interface ArchiveExtractResult {
  /** Bytes written to the destination (0 when extraction failed). */
  size: number;
  errors: string[];
}

/**
 * Write one archive member's full bytes to `dest` (the download action). `file`
 * is the member's slash-separated path within `archive`; `dest` is an absolute
 * path the user picked via a save dialog. Unlike preview, this is uncapped.
 */
export const unitsyncArchiveExtract = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    archive: string;
    file: string;
    dest: string;
  },
  ArchiveExtractResult
>("coilbox-unitsync", "unitsync_archive_extract");
