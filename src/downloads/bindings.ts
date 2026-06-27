import { defineCommand } from "@picoframe/plugin-sdk";

/** A rapid repository from the master index. */
export interface Repo {
  name: string;
  url: string;
}

/** A downloadable content version within a repository. */
export interface Version {
  tag: string;
  name: string;
}

/**
 * Typed bindings to `plugin:coilbox-downloads|*`. The first `defineCommand`
 * argument is the Tauri ACL identifier (crate name minus `tauri-plugin-`), not
 * the npm package name. Argument keys are camelCase; Tauri maps them to the
 * crate's snake_case parameters.
 */
export const dlVersion = defineCommand<undefined, { version: string }>(
  "coilbox-downloads",
  "dl_version",
);

export const dlRepos = defineCommand<{ masterUrl?: string }, { repos: Repo[] }>(
  "coilbox-downloads",
  "dl_repos",
);

export const dlVersions = defineCommand<
  { repoUrl: string },
  { versions: Version[] }
>("coilbox-downloads", "dl_versions");

export const dlDownload = defineCommand<
  { tag: string; masterUrl?: string; writePath?: string },
  { message: string; tag: string }
>("coilbox-downloads", "dl_download");

/** A springfiles catalog entry (maps or games). Field names mirror the API. */
export interface SpringFile {
  springname: string;
  name: string;
  filename: string;
  category: string;
  size: number;
  mirrors: string[];
  /** Thumbnail/preview image URLs (may be empty, e.g. for games). */
  mapimages: string[];
}

/** A Beyond All Reason map from the validated maps list. */
export interface BarMap {
  springName: string;
  displayName: string;
  author: string;
  filename: string;
  description?: string;
  mapWidth?: number;
  mapHeight?: number;
  playerCountMin?: number;
  playerCountMax?: number;
  /** Preview thumbnail; `images.preview` is a full HTTPS URL. */
  images?: { preview?: string };
}

/** Full springfiles catalog for a category (`map` / `game`); filtered client-side. */
export const dlSpringfilesList = defineCommand<
  { category: string },
  { results: SpringFile[] }
>("coilbox-downloads", "dl_springfiles_list");

/** A platform-matched springfiles engine (one per version). */
export interface SpringfilesEngine {
  name: string;
  version: string;
  filename: string;
  size: number;
}

/** springfiles engines for the current platform, deduped to one per version. */
export const dlSpringfilesEngines = defineCommand<
  undefined,
  { engines: SpringfilesEngine[]; platform: string }
>("coilbox-downloads", "dl_springfiles_engines");

/** The Beyond All Reason validated maps list (with thumbnails). */
export const dlBarMaps = defineCommand<undefined, { maps: BarMap[] }>(
  "coilbox-downloads",
  "dl_bar_maps",
);

/**
 * Download a map by spring name via the sidecar. `searchUrl` overrides
 * `PRD_HTTP_SEARCH_URL` (springrts default; BAR's files-cdn for BAR maps).
 */
export const dlDownloadMap = defineCommand<
  { springName: string; searchUrl?: string; writePath?: string },
  { message: string; springName: string }
>("coilbox-downloads", "dl_download_map");

/** Direct-download a file (e.g. a springfiles game mirror) into `destDir`. */
export const dlDownloadFile = defineCommand<
  { url: string; destDir: string; filename: string },
  { message: string; path: string }
>("coilbox-downloads", "dl_download_file");

/**
 * Lowercased filenames already present in `<path>/maps` and `/games` across every
 * given content root, for marking installed items. Compare against a source's
 * `filename` (lowercased).
 */
export const dlInstalledContent = defineCommand<
  { paths: string[] },
  { maps: string[]; games: string[] }
>("coilbox-downloads", "dl_installed_content");

/** A Recoil engine release matching the running platform. */
export interface EngineRelease {
  version: string;
  assetUrl: string;
  size: number;
  prerelease: boolean;
}

/** Recoil engine releases for the current platform (empty on macOS). */
export const dlRecoilEngines = defineCommand<
  undefined,
  { releases: EngineRelease[]; platform: string }
>("coilbox-downloads", "dl_recoil_engines");

/** Install a Recoil engine release into `<writePath>/engine/<version>/`. */
export const dlDownloadEngineRecoil = defineCommand<
  { version: string; assetUrl: string; writePath: string },
  { message: string; path: string }
>("coilbox-downloads", "dl_download_engine_recoil");

/** Download a classic Spring engine via the sidecar's `--download-engine`. */
export const dlDownloadEngineSpring = defineCommand<
  { version: string; writePath?: string },
  { message: string; version: string }
>("coilbox-downloads", "dl_download_engine_spring");
