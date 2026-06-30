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

/** Add a manually-picked root. Pass `force` to accept a folder that doesn't validate. */
export const contentAddRoot = defineCommand<
  { path: string; label?: string; force?: boolean },
  { state: ContentState }
>("coilbox-content", "content_add_root");

/** Remove a manual root (auto roots can't be removed). */
export const contentRemoveRoot = defineCommand<
  { path: string },
  { state: ContentState }
>("coilbox-content", "content_remove_root");

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

/** A map or game configuration option. */
export interface ConfigOption {
  key: string;
  name: string;
  description?: string;
}

export interface MapItem {
  name: string;
  fileName?: string;
  checksum?: string;
  archives: Archive[];
  /** mapinfo metadata (description, author, dimensions, ...). */
  info: Record<string, string>;
  /** Map proportions; the ratio is the true aspect ratio for undistorted display. */
  width?: number;
  height?: number;
  /** Map options (from mapoptions.lua). */
  options: ConfigOption[];
  /** Non-fatal unitsync diagnostics attributed to this map during the scan. */
  warnings?: string[];
}

export interface GameItem {
  name: string;
  checksum?: string;
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

export interface GameInfoResult {
  sides: Side[];
  unitCount: number;
  /** Game options (from modoptions.lua). */
  options: ConfigOption[];
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
  { enginePath: string; dataDir: string },
  ScanResult
>("coilbox-unitsync", "unitsync_scan");

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

export interface ThumbnailsResult {
  thumbnails: { name: string; dataUrl: string }[];
  errors: string[];
}

/** One engine configuration value, read from a curated key via `GetSpringConfig*`. */
export interface EngineConfigSetting {
  key: string;
  label: string;
  category: string;
  /** The effective value (configured value, or the engine default when unset). */
  value: string;
}

export interface EngineConfigResult {
  settings: EngineConfigSetting[];
  /** Path of the `springsettings.cfg` unitsync reads, when the build exposes it. */
  configPath?: string;
  errors: string[];
}

/**
 * Read a curated set of engine settings from the user's `springsettings.cfg`.
 * unitsync can't enumerate keys, so the worker reads a hand-picked catalog; values
 * are read-only. `enginePath` selects the libunitsync; `dataDir` the data root.
 */
export const unitsyncEngineConfig = defineCommand<
  { enginePath: string; dataDir: string },
  EngineConfigResult
>("coilbox-unitsync", "unitsync_engine_config");

/**
 * Render a small minimap thumbnail for every map in one unitsync session (for the
 * Maps grid). `mip` selects resolution: `1024 >> mip` px (default 3 = 128px).
 */
export const unitsyncThumbnails = defineCommand<
  { enginePath: string; dataDir: string; mip?: number },
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
