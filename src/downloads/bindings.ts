import { defineCommand } from "@picoframe/plugin-sdk";
import type { Channel } from "@tauri-apps/api/core";
import { withDownloadNotify } from "./downloadNotify";

/**
 * A live progress sample streamed during a download (mirrors the Rust
 * `DownloadProgress`). `totalBytes`/`percent` are null for indeterminate
 * transfers (chunked responses without a length, or archive extraction);
 * `bytesPerSec` is null when unknown (e.g. the pr-downloader sidecar).
 */
export interface DownloadProgress {
  phase: "downloading" | "extracting" | "done";
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  bytesPerSec: number | null;
}

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

/**
 * Cancel a running download by the `opId` its start call was given. Trips the
 * backend cancel flag (reqwest transfers) and kills the sidecar child (rapid /
 * map / spring-engine downloads). No-op for an unknown/finished id.
 */
export const dlCancel = defineCommand<{ opId: string }, Record<string, never>>(
  "coilbox-downloads",
  "dl_cancel",
);

export const dlRepos = defineCommand<{ masterUrl?: string }, { repos: Repo[] }>(
  "coilbox-downloads",
  "dl_repos",
);

export const dlVersions = defineCommand<
  { repoUrl: string },
  { versions: Version[] }
>("coilbox-downloads", "dl_versions");

/** Raw start command WITHOUT the completion notification — for internal callers
 * that compose several attempts into one logical download (fallback chains),
 * which notify once themselves. Prefer the wrapped `dlDownload` elsewhere. */
export const dlDownloadRaw = defineCommand<
  {
    tag: string;
    masterUrl?: string;
    writePath?: string;
    /** Pass a stable id to make the download cancellable via `dlCancel`. */
    opId?: string;
    onProgress: Channel<DownloadProgress>;
  },
  { message: string; tag: string }
>("coilbox-downloads", "dl_download");
export const dlDownload = withDownloadNotify(dlDownloadRaw, (a) => a.tag);

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
  /** Map author + dimensions (from `metadata=1`); empty/0 for non-maps. */
  metadata: { author: string; width: number; height: number };
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

/**
 * springfiles engines for the current platform, deduped to one per version.
 * `listsThisPlatform` is false when springfiles publishes nothing for this kind
 * of machine, which tells an empty list from a permanently empty one.
 */
export const dlSpringfilesEngines = defineCommand<
  undefined,
  {
    engines: SpringfilesEngine[];
    platform: string;
    listsThisPlatform: boolean;
  }
>("coilbox-downloads", "dl_springfiles_engines");

/** The Beyond All Reason validated maps list (with thumbnails). */
export const dlBarMaps = defineCommand<undefined, { maps: BarMap[] }>(
  "coilbox-downloads",
  "dl_bar_maps",
);

/**
 * A map archive from the hakora.xyz mirror (Apache autoindex). No springname or
 * metadata — `url` is fetched directly via `dlDownloadFile`. `size` is Apache's
 * human-readable string (e.g. `6.9M`).
 */
export interface HakoraMap {
  filename: string;
  url: string;
  size: string;
}

/** The hakora.xyz maps mirror, as a flat file list. */
export const dlHakoraMaps = defineCommand<undefined, { maps: HakoraMap[] }>(
  "coilbox-downloads",
  "dl_hakora_maps",
);

/**
 * A Spring content archive (`.sd7`/`.sdz`) from a curated GitHub release repo. Like
 * `HakoraMap` it has no springname — `url` is fetched directly via `dlDownloadFile`.
 * `tag` is the release it came from.
 */
export interface ReleaseArchive {
  filename: string;
  url: string;
  size: number;
  tag: string;
}

/** Content archives from an `owner/name` repo's recent GitHub releases, for the
 * curated map/game sources. */
export const dlGithubReleaseArchives = defineCommand<
  { repo: string },
  { archives: ReleaseArchive[] }
>("coilbox-downloads", "dl_github_release_archives");

/**
 * Download a map by spring name via the sidecar. `searchUrl` overrides
 * `PRD_HTTP_SEARCH_URL` (springrts default; BAR's files-cdn for BAR maps).
 */
/** Raw start command WITHOUT the completion notification — for internal callers
 * that compose several attempts into one logical download (fallback chains),
 * which notify once themselves. Prefer the wrapped `dlDownloadMap` elsewhere. */
export const dlDownloadMapRaw = defineCommand<
  {
    springName: string;
    searchUrl?: string;
    writePath?: string;
    /** Pass a stable id to make the download cancellable via `dlCancel`. */
    opId?: string;
    onProgress: Channel<DownloadProgress>;
  },
  { message: string; springName: string }
>("coilbox-downloads", "dl_download_map");
export const dlDownloadMap = withDownloadNotify(
  dlDownloadMapRaw,
  (a) => a.springName,
);

/** Direct-download a file (e.g. a springfiles game mirror) into `destDir`. */
/** Raw start command WITHOUT the completion notification — for internal callers
 * that compose several attempts into one logical download (fallback chains),
 * which notify once themselves. Prefer the wrapped `dlDownloadFile` elsewhere. */
export const dlDownloadFileRaw = defineCommand<
  {
    url: string;
    destDir: string;
    filename: string;
    /** Pass a stable id to make the download cancellable via `dlCancel`. */
    opId?: string;
    onProgress: Channel<DownloadProgress>;
  },
  { message: string; path: string }
>("coilbox-downloads", "dl_download_file");
export const dlDownloadFile = withDownloadNotify(
  dlDownloadFileRaw,
  (a) => a.filename,
);

/**
 * Lowercased filenames already present in `<path>/maps` and `/games` across every
 * given content root, for marking installed items. Compare against a source's
 * `filename` (lowercased).
 */
export const dlInstalledContent = defineCommand<
  { paths: string[] },
  { maps: string[]; games: string[] }
>("coilbox-downloads", "dl_installed_content");

/**
 * Register installed-engine directories so the sidecar prefers an engine's own
 * pr-downloader (which ships beside its complete DLL set) over coilbox's bundled
 * bootstrap copy. Pushed from content state whenever roots/engines change.
 */
export const dlSetEngineDirs = defineCommand<
  { dirs: string[] },
  Record<string, never>
>("coilbox-downloads", "dl_set_engine_dirs");

/** Report whether a folder can be written to. A read-only write root or portable
 * data dir silently blocks downloads and release updates. */
export const dlPathWritable = defineCommand<
  { path: string },
  { writable: boolean; error: string | null }
>("coilbox-downloads", "dl_path_writable");

/**
 * Fetch a shared `coilbox://import?url=` payload as text over HTTPS from the
 * Rust side, bypassing the webview's CORS limits (issue #482). Enforces https, a
 * byte cap and a timeout, and rejects (throws the reason) on a non-200,
 * oversized, unreachable or timed-out response. Used by the deep-link import
 * handler, which runs the text through `identify()` before applying anything.
 */
export const dlFetchText = defineCommand<{ url: string }, { text: string }>(
  "coilbox-downloads",
  "dl_fetch_text",
);

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
export const dlDownloadEngineRecoil = withDownloadNotify(
  defineCommand<
    {
      version: string;
      assetUrl: string;
      writePath: string;
      /** Pass a stable id to make the download phase cancellable via `dlCancel`. */
      opId?: string;
      onProgress: Channel<DownloadProgress>;
    },
    { message: string; path: string }
  >("coilbox-downloads", "dl_download_engine_recoil"),
  (a) => `Engine ${a.version}`,
);

/** Download a classic Spring engine via the sidecar's `--download-engine`. */
export const dlDownloadEngineSpring = withDownloadNotify(
  defineCommand<
    {
      version: string;
      writePath?: string;
      /** Pass a stable id to make the download cancellable via `dlCancel`. */
      opId?: string;
      onProgress: Channel<DownloadProgress>;
    },
    { message: string; version: string }
  >("coilbox-downloads", "dl_download_engine_spring"),
  (a) => `Engine ${a.version}`,
);
