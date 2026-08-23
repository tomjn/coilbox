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
 * Rapid pool housekeeping — background cache-warming and orphan pruning of the
 * `packages/`+`pool/` rapid store (client-side only, no protocol involvement).
 * -------------------------------------------------------------------------- */

/** How many `.sdp` manifests were read into the page cache, and their byte size. */
export interface WarmSummary {
  packages: number;
  bytes: number;
}

/** What a prune removed (or, on a dry run, would remove). */
export interface PruneSummary {
  /** True when the files were actually deleted (`false` for a dry run). */
  applied: boolean;
  /** Orphaned pool blobs (referenced by no on-disk `.sdp`). */
  blobs: number;
  blobBytes: number;
  /** Leftover `*.incomplete` temp files under `packages/`/`pool/`. */
  incompletes: number;
  incompleteBytes: number;
  /** `.sdp` files that failed to parse (corrupt/zero-byte). */
  unreadableSdp: number;
}

/**
 * Background-warm the rapid pool cache: read each root's `packages/*.sdp`
 * manifests into the OS page cache so the engine's first rapid-tag resolution is
 * warm. Manifests only (never the multi-GB pool blobs); safe to fire-and-forget.
 */
export const contentWarmRapidPool = defineCommand<
  { roots: string[] },
  { summary: WarmSummary }
>("coilbox-content", "content_warm_rapid_pool");

/**
 * Reclaim orphaned rapid pool data under a single root: pool blobs referenced by
 * no on-disk `.sdp`, plus `*.incomplete` leftovers. `apply: false` is a dry run
 * that reports what would be removed without deleting anything.
 */
export const contentPruneRapidPool = defineCommand<
  { root: string; apply: boolean },
  { summary: PruneSummary }
>("coilbox-content", "content_prune_rapid_pool");

/** One cache dir's size (and, when applied, clearance). */
export interface CacheEntry {
  /** On-disk subdir name (stable id). */
  name: string;
  /** Human-readable label. */
  label: string;
  bytes: number;
  files: number;
}

/** What reclaiming the generated-image / info caches covers (or, on a dry run, would). */
export interface CacheReclaimSummary {
  /** True when the caches were actually cleared (`false` for a dry run). */
  applied: boolean;
  caches: CacheEntry[];
  totalBytes: number;
  totalFiles: number;
}

/**
 * Size (and, when `apply: true`, clear) the app's grow-only generated-image / info
 * caches under the app cache dir. `apply: false` is a dry run that reports per-cache
 * sizes without deleting. Every cache regenerates on demand, so clearing is safe.
 */
export const contentReclaimCaches = defineCommand<
  { apply: boolean },
  { summary: CacheReclaimSummary }
>("coilbox-content", "content_reclaim_caches");

/* -------------------------------------------------------------------------- *
 * Storage overview (issue #386): where one content root's disk has gone, and
 * the engine removal the Storage settings section offers off the back of it.
 * -------------------------------------------------------------------------- */

/** One line of a root's breakdown. */
export interface StorageCategory {
  /** Stable id: `engines`, `games`, `maps`, `replays`, `saves`, `rapidPool`, `other`. */
  id: string;
  label: string;
  bytes: number;
  files: number;
  /** The existing folders the figure covers, for the reveal button. */
  paths: string[];
}

/** One installed engine's own folder. */
export interface EngineUsage {
  path: string;
  version: string;
  /** The whole folder, which is what deleting it frees. */
  bytes: number;
  /** What its own `demos`/`replays` folders hold, so the UI can warn first. */
  replayBytes: number;
}

/** One content root's whole breakdown. The categories add up to `totalBytes`. */
export interface StorageOverview {
  root: string;
  categories: StorageCategory[];
  engines: EngineUsage[];
  totalBytes: number;
}

/**
 * Size one content root by category. Walks the whole tree, so it takes seconds on
 * a large rapid pool. One root per call, so a multi-root breakdown renders as
 * each arrives.
 */
export const contentStorageOverview = defineCommand<
  { root: string },
  { overview: StorageOverview }
>("coilbox-content", "content_storage_overview");

/**
 * Delete one installed engine folder, returning the bytes freed. Rust only
 * accepts a real directory inside a folder named `engine`, so this cannot be
 * pointed at anything else.
 */
export const contentDeleteEngine = defineCommand<
  { path: string },
  { bytes: number }
>("coilbox-content", "content_delete_engine");

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
  /** True when this file is a coilbox remix (rewritten to run on a local build). */
  remixed?: boolean;
}

/**
 * One player's five counters from the replay's trailer, for the whole match.
 *
 * Present only when the engine actually recorded statistics: a match it
 * recorded none for still carries a block of bytes, and those bytes read as
 * plausible integers (issue #1190), so the decoder withholds them rather than
 * leaving each surface to remember why.
 */
export interface PlayerStats {
  /** Orders given. Over the match's minutes this is `apm`. */
  numCommands: number;
  /** Orders that reached a unit, as opposed to orders given. */
  unitCommands: number;
  mousePixels: number;
  mouseClicks: number;
  keyPresses: number;
}

/**
 * One `TeamStatistics` sample from the replay's trailer: one team, one moment,
 * every figure a running total for the match so far.
 *
 * This is also the metric vocabulary. A [`Metric`](#Metric)'s `key` is one of
 * these field names, so the published registry and the samples it describes
 * cannot name different things.
 */
export interface TeamStatSample {
  /** Sim frame this was sampled at. 30 frames is one second. */
  frame: number;
  metalUsed: number;
  energyUsed: number;
  metalProduced: number;
  energyProduced: number;
  metalExcess: number;
  energyExcess: number;
  metalReceived: number;
  energyReceived: number;
  metalSent: number;
  energySent: number;
  damageDealt: number;
  damageReceived: number;
  unitsProduced: number;
  unitsDied: number;
  unitsReceived: number;
  unitsSent: number;
  unitsCaptured: number;
  unitsOutCaptured: number;
  unitsKilled: number;
}

/** One team's samples for a whole match, in the order the engine recorded them. */
export interface TeamStatSeries {
  /** The `[teamN]` index this series belongs to. */
  team: number;
  /** Empty for a team the engine recorded no samples for, which is an answer
   * ("no statistics") rather than an error. */
  samples: TeamStatSample[];
}

/** The records after a replay's demo stream: who won, and how the match went. */
export interface DemoTrailer {
  /** The ally teams that won. Empty is a real outcome (a game over with nobody
   * winning), not a missing answer. */
  winningAllyTeams: number[];
  /** Seconds between samples, so a frame can be turned into a time without
   * assuming a period. */
  teamStatPeriodSec: number;
  /** One entry per team, in team order. */
  teams: TeamStatSeries[];
  /** One entry per player, indexed by the `[playerN]` id. Absent when the match
   * recorded no statistics: the bytes are still in the file and still read as
   * integers, so the decoder withholds them rather than hand over memory that
   * was never written (issue #1190). */
  players?: PlayerStats[];
}

/** A metric's identity: a sample field other than the frame it was taken at. */
export type MetricKey = Exclude<keyof TeamStatSample, "frame">;

/** Which question a metric answers. Charts and grids group by this. */
export type MetricGroup = "economy" | "military" | "units";

/** What a metric's numbers are, so a surface can format one without knowing
 * which metric it is holding. */
export type MetricUnit = "metal" | "energy" | "damage" | "count";

/**
 * One entry of the match-statistics metric registry, which lives in Rust beside
 * the decoder (`crates/tauri-plugin-coilbox-content/src/metrics.rs`).
 *
 * The chart's dropdown, the sparkline grid, the roster columns and the headline
 * tiles all build from `contentMetricRegistry`. None of them keeps a list of its
 * own, so adding a metric is one line of Rust and no frontend edit at all.
 */
export interface Metric {
  key: MetricKey;
  /** What to call it in the interface. */
  label: string;
  group: MetricGroup;
  unit: MetricUnit;
  /** Show it as a column on the match's roster table. */
  roster: boolean;
  /** Show it as a headline tile above the chart, summed across teams. */
  headline: boolean;
  /** False for a metric that is decoded but offered nowhere: the gifting and
   * capture counts, which are zero in almost every match. Filter these out
   * before showing a list of metrics to anyone. */
  surfaced: boolean;
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
  /** This seat's counters, absent when the match has none to show. */
  stats?: PlayerStats;
  /** Actions per minute: `stats.numCommands` over the match's minutes, worked
   * out by the decoder so every surface divides it the same way and nobody
   * shows a figure for a match that recorded none. Absent whenever `stats` is. */
  apm?: number;
}

/**
 * One skirmish AI from the replay's start-script `[aiN]` section, with the
 * side/ally-team/colour resolved from the team it controls. The same resolution
 * a `ReplayPlayer` gets, so a roster row or a chart series can treat an AI seat
 * like any other.
 */
export interface ReplayAi {
  /** The display name the host gave the bot, e.g. `AI 1`. */
  name: string;
  /** The AI's identifier, e.g. `SurvivalAI` or `BARb`. This names the opponent,
   * since `name` is often just a slot number. */
  shortName: string;
  /** The AI's version, e.g. `<game>` for a game-supplied Lua AI. */
  version?: string;
  team?: number;
  allyTeam?: number;
  /** The player number whose machine ran the AI. */
  host?: number;
  /** Faction (the team's `side`). */
  side?: string;
  /** Normalized team colour `[r, g, b]` in 0..1, when present. */
  rgbColor?: [number, number, number];
  /** Set only when the winner is known. */
  won?: boolean;
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

/** Decoded replay metadata (native header + start-script + trailer, with
 * demotool as a fallback for a trailer format the decoder refuses). */
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
  /** False when this file has no answer: the recording never reached a game
   * over, or its trailer's format couldn't be decoded and demotool couldn't
   * say either. Show "winner unknown", not a draw. */
  winnersKnown: boolean;
  numAllyTeams: number;
  allyTeams: AllyTeamInfo[];
  players: ReplayPlayer[];
  /** The skirmish AIs the match was played against. Kept out of `players`
   * because a bot is not a person: no dossier, no skill, no country, and a name
   * (`AI 1`) that repeats across unrelated matches. */
  ais: ReplayAi[];
  /** True when this file is a coilbox remix (rewritten to run on a local build). */
  remixed?: boolean;
  /** For a remix, the gametype it was originally recorded on. */
  sourceGametype?: string;
  /** For a remix, the filename of the original replay it was made from. */
  originFilename?: string;
  /** The `[modoptions]` section verbatim (key -> value), for surfaces that want
   * to reproduce the battle's options (e.g. refight-as-skirmish, #368). Empty
   * when the script carried no `[modoptions]` section. */
  modOptions: Record<string, string>;
}

/**
 * List replays in a content root's `demos/`/`replays/`, and in those of every
 * engine installed under it (cheap, newest first).
 */
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

/**
 * Decode one replay's trailer: the winning ally teams and every team's series of
 * samples. No engine folder and no subprocess, so it answers for a replay whose
 * game isn't installed. `replayPath` is a `ReplayFile.path`.
 *
 * It reads the whole file, so call it for one replay on demand rather than for a
 * library.
 */
export const contentReplayTrailer = defineCommand<
  { replayPath: string },
  { trailer: DemoTrailer }
>("coilbox-content", "content_replay_trailer");

/**
 * The metric registry: every figure a replay's team statistics carry, named,
 * grouped and placed. Static data, so it can be fetched once and shared.
 *
 * This is the only way to enumerate metrics. A surface that filters on `roster`,
 * `headline` or `surfaced` and reads `sample[metric.key]` gains the next metric
 * for free, and no surface has a list to keep in step with another one.
 */
export const contentMetricRegistry = defineCommand<
  undefined,
  { metrics: Metric[] }
>("coilbox-content", "content_metric_registry");

/** One player as recorded in a stats-database game (flattened from the demo). */
export interface StatPlayer {
  name: string;
  allyTeam?: number;
  /** Faction (the team's `side`). */
  side?: string;
  spectator: boolean;
  /** Set only for a decided game where the player wasn't a spectator. */
  won?: boolean;
  skill?: string;
  /** Actions per minute. Absent when the match measured nothing. */
  apm?: number;
}

/**
 * One team's end-of-match totals, keyed by metric key, for the metrics the
 * registry marks `roster`. This is all the store keeps of a match's statistics:
 * the shape of the match over time is read from the replay itself, via
 * `content_replay_trailer` (#1132).
 */
export interface TeamTotals {
  team: number;
  totals: Record<string, number>;
}

/** One skirmish AI as recorded in a stats-database game. */
export interface StatAi {
  name: string;
  /** The AI's identity (`name` is usually just a slot label like `AI 1`). */
  shortName: string;
  version?: string;
  allyTeam?: number;
  /** Faction (the team's `side`). */
  side?: string;
  /** Set only for a decided game. */
  won?: boolean;
}

/**
 * One ingested game — the denormalized row every stats view aggregates over. The
 * data layer for the personal profile, #375's head-to-head, and future per-map /
 * per-faction records.
 */
export interface StatRecord {
  filename: string;
  path: string;
  gameId?: string;
  mapName: string;
  gameType: string;
  engineVersion: string;
  durationSec: number;
  startTimeMs: number;
  sizeBytes: number;
  modifiedMs: number;
  /** False when the winner couldn't be read — the game is undecided, not a loss. */
  winnersKnown: boolean;
  winningAllyTeams: number[];
  remixed: boolean;
  players: StatPlayer[];
  /** The skirmish AIs the match was played against. Empty on a record ingested
   * before schema 2, until the next pass re-decodes it. */
  ais: StatAi[];
  /**
   * False when this replay measured nothing: the recording never reached a game
   * over, its trailer is in a format coilbox does not read, or the engine
   * recorded no samples. Show "not measured" rather than a row of zeroes.
   */
  statsKnown: boolean;
  /** Each team's end-of-match totals. Empty when `statsKnown` is false. */
  teamTotals: TeamTotals[];
  ingestedAt: number;
}

/** What an ingest pass did (for the status line). */
export interface IngestSummary {
  added: number;
  updated: number;
  skipped: number;
  /** Files that couldn't be decoded (corrupt/truncated) — skipped, not fatal. */
  failed: number;
  total: number;
}

/**
 * Incrementally parse every replay under `roots` into the local stats database,
 * decoding only files new or changed since the last pass (idempotent, keyed by
 * filename). `enginePath` locates `demotool` for the winner read; pass `dryRun` to
 * run the pass without writing. Returns the summary and the full record set.
 */
export const contentStatsIngest = defineCommand<
  { roots: string[]; enginePath: string; dryRun?: boolean },
  { summary: IngestSummary; records: StatRecord[] }
>("coilbox-content", "content_stats_ingest");

/** Read the whole local stats record set (read-only; never ingests). */
export const contentStatsQuery = defineCommand<
  undefined,
  { records: StatRecord[] }
>("coilbox-content", "content_stats_query");

/**
 * The Tauri event emitted to every window once the live watcher (#462) has
 * ingested a newly-arrived replay and persisted the store. Payload is the
 * pass's {@link IngestSummary}. Listeners should re-query
 * {@link contentStatsQuery} to pick up the refreshed record set.
 */
export const STATS_UPDATED_EVENT = "coilbox-content://stats-updated";

/**
 * Start (or restart) the live filesystem watcher over `roots`' demos/replays
 * folders, so a replay landing while the app is open is ingested immediately
 * instead of waiting for the next scan-on-open. Idempotent: replaces any
 * watcher already running for a previous root/engine selection.
 */
export const contentStatsWatchStart = defineCommand<
  { roots: string[]; enginePath: string },
  { watching: boolean }
>("coilbox-content", "content_stats_watch_start");

/** Stop the live filesystem watcher, if one is running. Idempotent. */
export const contentStatsWatchStop = defineCommand<
  undefined,
  { watching: boolean }
>("coilbox-content", "content_stats_watch_stop");

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

/**
 * Write a "remixed" **copy** of a replay whose embedded `gametype` is
 * `targetGametype` (and, when `engineVersion` is set, whose header engine version
 * is restamped), so the engine loads a different local game build when the copy
 * is watched. Returns the new sibling `path`; the source demo is never modified.
 */
export const contentRewriteDemo = defineCommand<
  { replayPath: string; targetGametype: string; engineVersion?: string },
  { path: string }
>("coilbox-content", "content_rewrite_demo");

/** Delete a replay file. `path` must be a `.sdfz`/`.sdf` from `content_list_replays`. */
export const contentDeleteReplay = defineCommand<
  { path: string },
  { ok: boolean }
>("coilbox-content", "content_delete_replay");

/** What a bulk replay delete removed, or would remove. */
export interface ReplayDeleteSummary {
  /** False for a preview, which deletes nothing. */
  applied: boolean;
  deleted: number;
  bytes: number;
  /** One sentence per path left alone, saying why. */
  skipped: string[];
}

/**
 * Delete a batch of replays. Every path is guarded the same way
 * `contentDeleteReplay` guards its one, and a path that fails is skipped with a
 * reason instead of failing the batch. `apply` false sizes it without deleting.
 */
export const contentDeleteReplays = defineCommand<
  { paths: string[]; apply: boolean },
  { summary: ReplayDeleteSummary }
>("coilbox-content", "content_delete_replays");

/**
 * Delete a downloaded game or map archive, returning the bytes freed. The Rust
 * side only accepts an archive sitting in a content root's `games`, `maps` or
 * `packages` folder, so an engine's base archives can't be removed.
 */
export const contentDeleteArchive = defineCommand<
  { path: string },
  { bytes: number }
>("coilbox-content", "content_delete_archive");

/** What a gather moved out of the engine folders, or would move (issue #971). */
export interface GatherSummary {
  /** False for a preview, which moves nothing. */
  applied: boolean;
  /** The file names that landed in the root's `demos/`, or that would. */
  moved: string[];
  /** Their total size. */
  bytes: number;
  /** One sentence per replay left where it was, saying why. */
  skipped: string[];
}

/**
 * Move each installed engine's own replays into the root's `demos/`, so deleting
 * an old engine folder does not take them. `apply` false previews.
 */
export const contentGatherReplays = defineCommand<
  { root: string; apply: boolean },
  { summary: GatherSummary }
>("coilbox-content", "content_gather_replays");

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
 * Keybinds: the engine's `uikeys.txt`, beside its `springsettings.cfg`. The
 * engine reads it raw-first, so once this file exists the copy a game ships in
 * its archive never loads, and a write has to carry both.
 * -------------------------------------------------------------------------- */

/** Read the `uikeys.txt` in an engine's config directory. */
export const contentKeybindsRead = defineCommand<
  { configDir: string },
  { path: string; exists: boolean; text: string; ours: boolean }
>("coilbox-content", "content_keybinds_read");

/**
 * Replace that `uikeys.txt`. The first write over a file coilbox did not author
 * copies it to `uikeys.txt.bak`, reported as `backedUp`.
 */
export const contentKeybindsWrite = defineCommand<
  { configDir: string; text: string },
  { path: string; backedUp: boolean }
>("coilbox-content", "content_keybinds_write");

/** One saved keymap for a content root. `json` is a serialised `SavedKeymap`. */
export interface StoredKeymap {
  name: string;
  slug: string;
  createdAtMs: number;
  json: string;
}

/** Saved keymaps for a content root, newest first. */
export const contentKeymaps = defineCommand<
  { rootPath: string },
  { keymaps: StoredKeymap[] }
>("coilbox-content", "content_keymaps");

/** Save a keymap under a name, replacing any keymap already saved under it. */
export const contentKeymapSave = defineCommand<
  { rootPath: string; name: string; json: string },
  { keymap: StoredKeymap }
>("coilbox-content", "content_keymap_save");

/** Delete a saved keymap by slug. */
export const contentKeymapDelete = defineCommand<
  { rootPath: string; slug: string },
  { ok: boolean }
>("coilbox-content", "content_keymap_delete");

/** One stored blueprint. `json` is a serialised `StoredBlueprint` from
 *  `../blueprint/library.ts`, which owns the shape. */
export interface BlueprintListItem {
  id: string;
  json: string;
}

/** Every layout in the blueprint library, unsorted. */
export const contentBlueprints = defineCommand<
  Record<string, never>,
  { items: BlueprintListItem[] }
>("coilbox-content", "content_blueprints");

/** Write one layout under its id, replacing what was filed under it. */
export const contentBlueprintSave = defineCommand<
  { id: string; json: string },
  { ok: boolean }
>("coilbox-content", "content_blueprint_save");

/** Drop one layout from the library. */
export const contentBlueprintDelete = defineCommand<
  { id: string },
  { ok: boolean }
>("coilbox-content", "content_blueprint_delete");

/**
 * Write text to a path the caller picked, knowing nothing about what is in it:
 * a serialised keymap, or a game's own `blueprints.json`. Reading runs through
 * `content_import_container`, the other half of the pair.
 */
export const contentWriteFile = defineCommand<
  { dest: string; text: string },
  Record<string, never>
>("coilbox-content", "content_write_file");

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
  /**
   * `"bool"` | `"number"` | `"list"` | `"string"` | `"section"` (omitted if
   * unknown). A `"section"` is a group header rather than a setting: it has no
   * value and is never written to a start script.
   */
  type?: "bool" | "number" | "list" | "string" | "section";
  /** Key of the section this option groups under; absent when top-level. */
  section?: string;
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

/** One resolved start unit: its friendly name and/or build icon. */
export interface UnitDisplay {
  /** Human-friendly name from the unitdef `name` field, when present. */
  name?: string;
  /**
   * The icon's PNG in the build-icon cache, served over
   * `coilbox://unitsyncbuildpic/`. This is how a resolved icon normally
   * arrives. Read it with `unitIconSrc` rather than reaching for either field.
   */
  iconFile?: string;
  /** Build-icon `data:` URL, only when the icon had nowhere on disk to go. */
  icon?: string;
  /**
   * Why there is neither. `no-source` is a game that ships this unit no build
   * pic, which is normal. `undecodable` is a picture coilbox could not read,
   * which is coilbox's problem and worth saying out loud (#1625).
   */
  iconSkipped?: "no-source" | "undecodable" | "encode-failed";
  /** The same picture encoded as the hub's `buildpic` asset and written to disk,
   *  present only when the call asked for `assets` and one came out. */
  asset?: UnitBuildpicAsset;
  /** Why there is no {@link asset}, when one was asked for. A unit is never in
   *  both. `not-square` and `too-large` are pictures the hub refuses on the
   *  bytes, and cropping one would invent a picture the game does not ship. */
  assetSkipped?:
    | "no-source"
    | "undecodable"
    | "not-square"
    | "too-large"
    | "encode-failed"
    | "not-written";
}

/** A build pic encoded as the asset the hub takes, written to disk. The bytes
 *  are not here: the worker prints one JSON document and a few hundred WebPs is
 *  the wrong shape for that, so the uploader reads {@link path}. */
export interface UnitBuildpicAsset {
  /** Always `buildpic`. */
  variant: string;
  /** Always `extracted`, against `rendered` for a picture coilbox drew. */
  origin: string;
  /** The name the archive this came out of declares for itself, which is what
   *  the hub row's `source_archive` holds, and never a file name (#1678). */
  sourceArchive: string;
  /** Absolute path to the encoded file. */
  path: string;
  /** sha256 of the encoded bytes. */
  hash: string;
  /** sha256 of the archive member as read, before any decode. This is what the
   *  hub's have check compares on, so it does not move when the encoder does. */
  sourceHash: string;
  /** The archive member the picture came from. */
  sourceMember: string;
  encodeProfile: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export interface UnitBuildpicsResult {
  /** Unit internal name -> its display info, for units that resolved. */
  units: Record<string, UnitDisplay>;
  errors: string[];
}

/**
 * Resolve build icons for a game's start units — lazy, since it mounts the game's
 * archive set. `gameArchive` is the primary archive; `units` are internal names.
 *
 * `assets` also encodes each one as the hub's `buildpic` asset and writes it
 * where the uploader can read it. Only the blueprint backfill asks for that
 * (#1636): a page drawing icons would be paying for a WebP encode nobody sends.
 */
export const unitsyncUnitBuildpics = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    units: string[];
    assets?: boolean;
  },
  UnitBuildpicsResult
>("coilbox-unitsync", "unitsync_unit_buildpics");

/** One side's resolved faction emblem: a PNG plus the source image's longest
 * pixel side (so callers can prefer a crisper image over a 16px upscale). */
export interface FactionLogoEntry {
  side: string;
  /** The emblem's PNG in the faction-logo cache, served over
   * `coilbox://unitsyncfactionlogo/`. How a resolved emblem normally arrives. */
  file?: string;
  /** PNG `data:` URL, only when the emblem had nowhere on disk to go. */
  dataUri?: string;
  maxDim: number;
}

export interface FactionLogosResult {
  /** One entry per side whose `Sidepics/<side>` emblem resolved. */
  logos: FactionLogoEntry[];
  errors: string[];
}

/**
 * Resolve a game's per-side faction emblems from its `Sidepics/<side>` folder —
 * lazy, since it mounts the game's archive set. `sides` are the side names (from
 * {@link unitsyncGameInfo}).
 */
export const unitsyncFactionLogos = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    sides: string[];
  },
  FactionLogosResult
>("coilbox-unitsync", "unitsync_faction_logos");

/** One unit in the reusable unit dataset: its names plus the internal names of the
 * units it can build (`buildoptions`, lowercased). */
export interface UnitDatasetEntry {
  name: string;
  fullName?: string;
  buildOptions?: string[];
  /** Whether the unit can move (mobile unit) vs a static building. */
  mobile?: boolean;
  /**
   * The unitdef's `objectname`: the model the engine draws this unit with,
   * resolved against `objects3d/`. Written however the game's author felt like,
   * so it may be any case and usually carries no extension.
   */
  objectName?: string;
  /**
   * The unitdef's `footprintx` and `footprintz`: how much ground the unit stands
   * on, in build squares of 16 elmos. Absent from a dataset read by a worker
   * that did not report them, and read as one square when it is, which is the
   * floor the engine applies.
   */
  footprintX?: number;
  footprintZ?: number;
  /**
   * The unitdef's `maxSlope` in degrees, clamped to the 0..89 the engine clamps
   * it to. What decides whether a building will stand on a piece of ground: the
   * engine tolerates `40 * tan(maxSlope)` elmos of height difference across the
   * footprint and refuses to build past that.
   *
   * Absent from a dataset read by a worker that did not report it, which is not
   * the same as zero. Zero is a def asking for flat ground, absent is a dataset
   * that cannot answer, and a caller that confused the two would call every
   * building on a hill unbuildable.
   */
  maxSlope?: number;
  /** Whether the building sits on the water rather than on the seabed, from the
   *  unitdef's `floater` or its having a `waterline`. Exempt from the slope test
   *  wherever the ground is below sea level. */
  floatOnWater?: boolean;
  /**
   * The unitdef's `minWaterDepth`/`maxWaterDepth`, the depth half of the
   * engine's terrain check: the ground under every square of the footprint has
   * to lie in `[-maxWaterDepth, -minWaterDepth]`. A naval yard declares a
   * `minWaterDepth` so it can only go in the sea, a land building declares a
   * `maxWaterDepth` of 0 so it cannot.
   *
   * Absent from a dataset read by a worker that did not report them. The
   * engine's own defaults are -10e6 and +10e6, a band no ground falls outside,
   * so a caller with nothing to read here refuses nothing.
   */
  minWaterDepth?: number;
  maxWaterDepth?: number;
  /** The unitdef's `waterline`: how far below the water a floater sits. The
   *  engine levels a floater to `-waterline` rather than to the ground, so
   *  without it a floater cannot be judged at all. */
  waterline?: number;
  /**
   * Everything else the unitdef declares that is worth reading next to the
   * unit: `health`, `metalCost`, `energyCost`, `buildTime`, `sightDistance`,
   * `maxVelocity`, `range`, and a `weapons` array of one object per weapon.
   * `shared/unitdef-stats.json` writes the list down.
   *
   * Untyped on purpose. The hub stores these as schemaless JSON and renders
   * what arrives, so a stat added to the worker's Lua shim reaches a unit page
   * without a type change here. A key a def does not declare is simply not
   * present, which is not the same as zero: zero is a claim about the game.
   */
  stats?: Record<string, unknown>;
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

/** One drawable batch inside a piece: an indexed triangle list whose corners all
 *  sample the same texture. */
export interface UnitModelGroup {
  /** Which {@link UnitModelResult.textures} entry this batch samples. Absent for
   *  a `.3do` face the format gives a flat palette colour instead. */
  texture?: string;
  /** x, y, z per vertex. */
  positions: number[];
  /** x, y, z per vertex. */
  normals: number[];
  /** u, v per vertex. */
  uvs: number[];
  /** Three indices per triangle, into this batch's own vertices. */
  indices: number[];
}

/** One piece of the model tree. A piece with no groups is hierarchy only. */
export interface UnitModelPiece {
  name: string;
  /** Translation from the parent piece. The formats have no rotation or scale. */
  offset: [number, number, number];
  groups: UnitModelGroup[];
  children: UnitModelPiece[];
}

/** One texture the model asks for, and what became of it. */
export interface UnitModelTexture {
  /** The name as the model file gives it, and the key groups refer to. */
  name: string;
  /** The archive member it resolved to. Empty when nothing matched. */
  source: string;
  /** The file in the model-texture cache, loaded via {@link unitModelTextureUrl}.
   *  Empty when nothing matched. */
  file: string;
  /** A `.3do` region the engine paints in the player's colour. The file behind
   *  it is a flat magenta placeholder, so the viewer picks a colour instead. */
  teamColour: boolean;
}

export interface UnitModelResult {
  /** `"s3o"` or `"3do"`. Empty when nothing was read. */
  format: string;
  /** The archive member the model came from. */
  path: string;
  radius: number;
  height: number;
  mid: [number, number, number];
  root?: UnitModelPiece;
  textures: UnitModelTexture[];
  /** An `.s3o`'s second texture: glow in red, reflectivity in green, and whether
   *  a pixel is drawn in alpha. Only that last one is drawn, as the cut-out the
   *  engine discards on. Named after the header's own field rather than after
   *  what the channels mean, since the name that tried the latter said team mask
   *  and the team-colour mask is the first texture's alpha (issue #1910). */
  texture2?: UnitModelTexture;
  /** Faces a `.3do` draws in a flat palette colour, which is engine-embedded and
   *  not in the archive. Drawn plain grey, so the count is worth showing. */
  paletteFaces: number;
  errors: string[];
}

/**
 * Read one unit's model out of a game's archive, flattened so `.s3o` and `.3do`
 * draw the same way. `object` is the unitdef's `objectname` verbatim. Loads the
 * game's archive set, so it is fetched on demand.
 */
export const unitsyncUnitModel = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    object: string;
  },
  UnitModelResult
>("coilbox-unitsync", "unitsync_unit_model");

/** One unit's animation script, as found in the game it came from. */
export interface UnitScriptResult {
  /** The archive member it was found at, or null when the game has none for
   *  this unit. */
  member: string | null;
  /** `lua` or `cob`, or null when nothing was found. */
  kind: "lua" | "cob" | null;
  /** The source, for a Lua script. Null for a `.cob`, which is not text. */
  text: string | null;
  /** The bytes, for a `.cob`. Null for Lua. */
  bytes: number[] | null;
  /** The `.bos` source beside a `.cob`, where the game ships one. Null for Lua,
   *  which needs no conversion, and for a `.cob` shipped without its source. */
  bosMember: string | null;
  /** That source, as text. */
  bosText: string | null;
  /** The unit's whole definition, as JSON, or null when the game's definitions
   *  could not be read. A script is allowed to read its own definition and
   *  BAR's do, so without it those scripts throw at load rather than losing a
   *  branch. */
  unitDef: string | null;
  /** What the unit definition asked for, found or not. A name that resolved to
   *  nothing is the useful half of "this unit has no script here". */
  declared: string | null;
  /** The library files the script pulls in with `include`, and the ones those
   *  pull in. Empty for a `.cob`, which has no such thing. */
  includes: UnitScriptInclude[];
  errors: string[];
}

/** One library file a unit script pulls in. */
export interface UnitScriptInclude {
  /** The name the script asked for, as written. That is what the preview
   *  matches on, because it is all the script ever says about the file. */
  name: string;
  /** The archive member it resolved to. */
  member: string;
  /** The source. */
  text: string;
}

/**
 * Find and read one unit's animation script inside a game's archive.
 *
 * `unit` is the unit definition's own key, not its `objectname`: a script is
 * named by the definition and a model by a field inside it, and games regularly
 * use different words for the two.
 *
 * The name a definition gives is resolved the way the unit script framework
 * resolves it rather than as a path, so a game that moved to Lua while keeping
 * the old `.cob` names in its definitions still resolves.
 */
export const unitsyncUnitScript = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    unit: string;
  },
  UnitScriptResult
>("coilbox-unitsync", "unitsync_unit_script");

/**
 * One model of a batch: where the flattened model was written, rather than the
 * model itself (issue #1684).
 *
 * A flattened model is megabytes of floats and a blueprint asks for twenty at
 * once, so the batch writes each into the model-texture cache and names it here.
 */
export interface UnitModelFile {
  /** The file in the model-texture cache, loaded via {@link unitModelTextureUrl}.
   *  Holds one {@link UnitModelResult} as JSON. */
  file: string;
  /** The archive member the model came from, which is what the file is named
   *  after: two units sharing one model share one file. */
  path: string;
  /** `"s3o"` or `"3do"`. */
  format: string;
}

export interface UnitModelsResult {
  /** Keyed by the `objectname` as asked for, so a caller looks up what it sent
   *  rather than what the archive called it. */
  models: Record<string, UnitModelFile>;
  /** The objects that produced no model, and why. An object is in exactly one of
   *  the two maps. */
  skipped: Record<string, string>;
  errors: string[];
}

/**
 * Read a batch of units' models out of a game's archive in one mount, writing
 * each into the model-texture cache (issue #1684).
 *
 * The same read {@link unitsyncUnitModel} does, for a list. One call is one
 * archive mount however many objects it names, which on a game like Beyond All
 * Reason is a second or more saved per unit past the first.
 */
export const unitsyncUnitModels = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    objects: string[];
  },
  UnitModelsResult
>("coilbox-unitsync", "unitsync_unit_models");

/** Why a unit produced no render asset. */
export type RenderSkip =
  /** The pixels are not the shape this footprint frames to. The hub cannot check
   *  this, because it does not hold footprints, so it is checked in the worker or
   *  nowhere. */
  | "mis-framed"
  /** The pixel buffer is missing, unreadable, or not `width * height * 4` long. */
  | "no-pixels"
  /** An angle the shared vocabulary does not list. */
  | "unknown-angle"
  /** The game archive has no model for this unit's `objectname`. */
  | "no-model"
  | "encode-failed"
  | "too-large"
  | "not-written";

/** A top down render encoded as the asset the hub takes, written to disk. */
export interface UnitRenderAsset {
  /** `render:<angle>`. */
  variant: string;
  /** How the bytes were produced, `rendered` rather than `extracted`. */
  origin: string;
  /** The name the archive the model was read out of declares for itself, which
   *  is what the hub row's `source_archive` holds and never a file name. */
  sourceArchive: string;
  /** Absolute path to the encoded file, named after {@link hash}. */
  path: string;
  /** sha256 of the encoded bytes, and the hub's object path component. */
  hash: string;
  /** The identity dedupe and the have check compare on, over the render's inputs
   *  rather than its pixels, so it does not move when the encoder does. */
  sourceHash: string;
  /** The archive member the model was read from. */
  sourceMember: string;
  /** sha256 over the model file and its textures, the part of {@link sourceHash}
   *  that comes out of the archive. */
  modelDigest: string;
  /** Which renderer drew it, from `RENDER_VERSION`. */
  rendererVersion: number;
  footprintX: number;
  footprintZ: number;
  encodeProfile: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

export interface UnitRenderResult {
  asset?: UnitRenderAsset;
  assetSkipped?: RenderSkip;
  /** The encoded bytes as a `data:` URL, so the caller can look at what came out
   *  of the encoder rather than at what it drew. */
  dataUrl?: string;
  errors: string[];
}

/**
 * Encode a top down render the webview drew as the hub's `render:<angle>` asset
 * (issue #1631).
 *
 * `pixels` is base64 RGBA, top row first, straight alpha, exactly
 * `width * height * 4` bytes. The worker recomputes the frame from the footprint
 * and refuses pixels that are not that shape, which is the only check on the rule
 * anywhere: the hub does not hold footprints.
 *
 * Mounts the game's archive set to read the model the render was taken of, which
 * is what its `source_hash` is over, so it is as slow as reading a model, unless
 * the three `source` fields below say what it was drawn from.
 */
export const unitsyncUnitRender = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    object: string;
    angle: string;
    footprintX: number;
    footprintZ: number;
    rendererVersion: number;
    pixels: string;
    width: number;
    height: number;
    /**
     * What the render was drawn from, from the `unitsyncUnitRenderKeys` call that
     * decided this unit was worth drawing (issue #1720). Pass all three and the
     * worker does not mount the game's archive set at all, which on a blueprint
     * of twenty buildings is twenty mounts saved.
     *
     * All three or none. Two of them is refused rather than mounted for, because
     * a caller with two has a wiring bug and a mount would hide it.
     *
     * Leaving them out is the path for a caller with no key, which is what the
     * unit model panel does: it renders one unit on its own and the worker
     * working the identity out is the thing that panel is showing.
     */
    modelDigest?: string;
    sourceMember?: string;
    sourceArchive?: string;
  },
  UnitRenderResult
>("coilbox-unitsync", "unitsync_unit_render");

/** One unit to work out a render key for. */
export interface UnitRenderKeyRequest {
  /** The unit's internal name, which is what the hub keys a unit picture on. */
  unit: string;
  /** The unitdef's `objectname`, which is what the model is found by. */
  object: string;
  /** The footprint the render will be framed on. It has to be the one the render
   *  is actually drawn to, or the key names a picture nobody will make. */
  footprintX: number;
  footprintZ: number;
}

/** What a unit's render will be called before anybody draws it. */
export interface UnitRenderKey {
  /** The `objectname` the digest was taken of, echoed because several units share
   *  one model. */
  objectName: string;
  /** The archive member the model was read from. */
  sourceMember: string;
  /** sha256 over the model file and its textures as the archive stores them. */
  modelDigest: string;
  /** `render:<angle>`. */
  variant: string;
  rendererVersion: number;
  footprintX: number;
  footprintZ: number;
  /** What the footprint frames to, which is part of the identity and also what
   *  the renderer has to draw for the render to be accepted. */
  widthPx: number;
  heightPx: number;
  /** The identity the hub's have check compares on. */
  sourceHash: string;
}

export interface UnitRenderKeysResult {
  /**
   * Keyed by the unit's internal name, as asked for, then by the variant.
   *
   * Two maps rather than one because a unit has a key per angle (issue #1951),
   * and every one of them comes out of a single mount: what the archive is read
   * for is the model digest, which all of a unit's angles share.
   */
  keys: Record<string, Record<string, UnitRenderKey>>;
  /** The name the game archive declares for itself, which is what a hub row's
   *  `source_archive` holds. One per batch, because a batch is one game. Here so
   *  the encode can be handed the whole of what it would otherwise mount to work
   *  out (issue #1720). Absent when the mount failed, which is also when there
   *  are no keys. */
  sourceArchive?: string;
  /** The units that got no key, and why. A unit is in exactly one of the two. */
  skipped: Record<string, RenderSkip>;
  errors: string[];
}

/**
 * Work out what a batch of units' renders will be called, without drawing any of
 * them (issues #1672 and #1666).
 *
 * This is what lets the hub's have check come first for a render. The identity is
 * over the model and its textures, so it can be read straight out of the archive,
 * and until this existed the only route to one was to draw the picture and encode
 * it, which is the cost asking first exists to avoid.
 *
 * One call is one archive mount however many units it names, and however many
 * angles it asks for. Ask for the whole batch at once rather than looping:
 * twenty units one at a time is twenty mounts, a second or more each on a game
 * like Beyond All Reason.
 */
export const unitsyncUnitRenderKeys = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    gameArchive: string;
    /** The angles to key, without the `render:` prefix. Every angle the
     *  vocabulary lists when it is left off, since they share the mount. */
    angles?: string[];
    rendererVersion: number;
    units: UnitRenderKeyRequest[];
  },
  UnitRenderKeysResult
>("coilbox-unitsync", "unitsync_unit_render_keys");

/**
 * Write down which unit a drawn render is of, so this machine can find it again
 * (issue #1724).
 *
 * The encoded file is named after the sha256 of its own bytes, which is the name
 * the hub's object path wants and tells a second reader nothing. This records the
 * other name. Pass back the fields {@link unitsyncUnitRender} answered with.
 *
 * Called whether or not the picture is then sent anywhere. Renders are only drawn
 * today when picture uploads are on, so this does not on its own give pictures to
 * somebody who has never turned them on, but keeping one is not the same decision
 * as sending it and the gate belongs on the sending.
 */
export const unitsyncRememberRender = defineCommand<
  {
    /** The game's modinfo shortname, which is what a plan asks by. */
    game: string;
    /** The unit's internal name. Lower cased on the way in, so the case a layout
     *  happens to carry cannot decide whether the picture is found. */
    unit: string;
    /** `render:<angle>`. */
    variant: string;
    /** The absolute path the encode answered with. Only the file name is kept. */
    path: string;
    mime: string;
    encodeProfile: string;
    sourceHash: string;
    modelDigest: string;
    sourceArchive: string;
    rendererVersion: number;
    width: number;
    height: number;
  },
  { remembered: boolean }
>("coilbox-unitsync", "unitsync_remember_render");

/** One render this machine has already drawn, as the index holds it. */
export interface LocalRender {
  game: string;
  unit: string;
  variant: string;
  /** The file in the render cache, loaded via `hubAssetUrl`. */
  file: string;
  /** Where those bytes are now, for a caller that has to hand them on rather than
   *  draw them: the uploader takes a path. Worked out when the record is found,
   *  because where the cache folder is depends on the machine. */
  path: string;
  mime: string;
  encodeProfile: string;
  sourceHash: string;
  modelDigest: string;
  sourceArchive: string;
  rendererVersion: number;
  width: number;
  height: number;
}

/**
 * The renders this machine has already drawn for a batch of units (issue #1724).
 *
 * One call for a whole layout. Nothing is mounted and nothing is drawn: it reads a
 * few hundred bytes per unit off disk, so a plan of twenty buildings can ask on a
 * page load. A unit with no render is absent from the answer rather than null.
 *
 * `rendererVersion` is the caller's `RENDER_VERSION` and a render drawn by a
 * different one is not answered with, so a bump misses everything ever drawn.
 * `sourceArchive` is the game's archive when the caller knows it, and a render of
 * a different one is then refused too.
 */
export const unitsyncLocalRenders = defineCommand<
  {
    game: string;
    variant: string;
    rendererVersion: number;
    /** The game's archive, when the caller knows it. A caller that does not gets
     *  the renderer-version check alone, and can be handed a render of a model the
     *  game has since replaced. */
    sourceArchive?: string;
    units: string[];
  },
  { renders: Record<string, LocalRender> }
>("coilbox-unitsync", "unitsync_local_renders");

/**
 * One map's facts as the hub takes them, in the hub's own snake case (issue
 * #1732). Passed through to `hub_publish_maps` verbatim rather than translated,
 * because the hub refuses a field name it does not know.
 */
export interface MapCatalogEntry {
  map_name: string;
  display_name?: string;
  description?: string;
  map_version?: string;
  author?: string;
  archive_filename?: string;
  source_archive: string;
  source_hash: string;
  catalog_version: number;
  width_elmos: number;
  height_elmos: number;
  world_height_min: number;
  world_height_max: number;
  min_wind?: number;
  max_wind?: number;
  tidal_strength?: number;
  void_water?: boolean;
  void_ground?: boolean;
  water_coverage?: number;
  appearance?: Record<string, number | boolean | number[]>;
  points?: {
    start?: { x: number; z: number; y?: number }[];
    metal?: {
      x: number;
      z: number;
      y?: number;
      meta?: Record<string, unknown>;
    }[];
    geo?: {
      x: number;
      z: number;
      y?: number;
      meta?: Record<string, unknown>;
    }[];
  };
}

/** One map in a catalog walk: what a have check asks about, and the facts when
 *  they were asked for. */
export interface MapCatalogRow {
  mapName: string;
  sourceHash: string;
  catalogVersion: number;
  /** Absent on a keys-only pass. */
  entry?: MapCatalogEntry;
}

/** Why a map produced no row. */
export type MapCatalogSkip =
  | "no-archive-file"
  | "unreadable-archive"
  | "no-extent"
  | "no-height-range"
  | "duplicate-map";

export interface MapCatalogResult {
  maps: MapCatalogRow[];
  skipped: { mapName: string; reason: MapCatalogSkip }[];
  errors: string[];
}

/**
 * Read the installed map library into the entries the hub takes (issue #1737).
 *
 * Two passes, and the caller picks which. `keysOnly` gives each map's name, the
 * sha256 of its archive and the catalog version, which is the whole of a have
 * check's question. `maps` then names the ones the hub said it wanted, and those
 * come back with their facts, which costs a read of each map's whole height
 * grid.
 *
 * One call is one session however many maps it covers, and the archive hashes
 * are cached on file identity, so a second sweep over an unchanged library reads
 * no archives at all.
 */
export const unitsyncMapCatalog = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    /** The maps to read. Absent walks the whole library. */
    maps?: string[];
    keysOnly: boolean;
  },
  MapCatalogResult
>("coilbox-unitsync", "unitsync_map_catalog");

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
  /** Cache file name, served over `coilbox://unitsyncthumb/`. Set whenever the
   * render reached disk, and preferred over `dataUrl`. */
  file?: string;
  /** PNG `data:` URL, only when the render never reached the worker's cache. */
  dataUrl?: string;
  side?: number;
  /**
   * The map's size in elmos, which is the space `startPositions` are in and what
   * an overlay drawn on this minimap is lined up against (issue #1629). Absent
   * when the map has no metal infomap to derive it from.
   */
  widthElmos?: number;
  heightElmos?: number;
  /** Team start positions, for overlaying on the minimap. */
  startPositions: StartPos[];
  /** Wind power range (`atmosphere.minWind`/`maxWind` from mapinfo.lua). */
  minWind?: number;
  maxWind?: number;
  /** Tidal power (root-level `tidalStrength` from mapinfo.lua). */
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
  /** Cache file name, served over `coilbox://unitsyncthumb/`. Set whenever the
   * render reached disk, and preferred over `dataUrl`. */
  file?: string;
  /** Grey WebP `data:` URL, only when the render never reached the cache. */
  dataUrl?: string;
  /** Full heightmap dimensions `(mapx+1, mapy+1)`; the ratio is the map's aspect ratio. */
  width?: number;
  height?: number;
  /** World height at heightmap value 0 (the flat water plane sits here). */
  minHeight?: number;
  /** World height at heightmap value 65535. */
  maxHeight?: number;
  /**
   * World height at the picture's black, and at its white (issue #1730).
   *
   * Not `minHeight` and `maxHeight`: the picture is 8 bit and rescaled into the
   * window its own samples occupy, so these are what a reader displaces it by. A
   * map whose heights do not reach both ends of the 16 bit scale would come out
   * flattened against the map's own pair.
   */
  pictureMinHeight?: number;
  pictureMaxHeight?: number;
  errors: string[];
}

/**
 * Render one map's height infomap as a grey WebP plus the world heights that
 * turn it back into terrain. Lazy, a separate unitsync session, cached on disk.
 *
 * No size argument. The shared asset vocabulary caps the picture at 512px, which
 * is where the preview mesh stops being able to show more, and it is the same
 * cap the hub's `overlay:height` asset is stored at.
 */
export const unitsyncHeightmap = defineCommand<
  { enginePath: string; dataDir: string; mapName: string },
  HeightmapResult
>("coilbox-unitsync", "unitsync_heightmap");

export interface HeightFieldResult {
  /** Cache file name, served over `coilbox://unitsyncthumb/`. Little endian
   *  `u16` words, row major, `width * height` of them. No inline fallback: the
   *  grid runs to tens of megabytes and does not belong on the bridge. */
  file?: string;
  /** Grid dimensions `(mapx+1, mapy+1)`, the engine's own corner grid. */
  width?: number;
  height?: number;
  /** World height at word 0, and at word 65536. The engine's conversion is
   *  `minHeight + word * (maxHeight - minHeight) / 65536`. */
  minHeight?: number;
  maxHeight?: number;
  errors: string[];
}

/**
 * Write one map's raw 16 bit heights to the thumbnail cache and report the
 * file, for the terrain check to read at the depth the engine holds them (issue
 * #1490). Lazy, a separate unitsync session, cached on disk.
 */
export const unitsyncHeightField = defineCommand<
  { enginePath: string; dataDir: string; mapName: string },
  HeightFieldResult
>("coilbox-unitsync", "unitsync_height_field");

export interface MetalmapResult {
  /** Cache file name, served over `coilbox://unitsyncthumb/`. Set whenever the
   * render reached disk, and preferred over `dataUrl`. */
  file?: string;
  /** Green-on-transparent RGBA PNG `data:` URL, only when it missed the cache. */
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
    /** Cache file name, served over `coilbox://unitsyncthumb/`. */
    file?: string;
    /** PNG `data:` URL, only when the render never reached the cache. */
    dataUrl?: string;
    /** Metal infomap samples, whose ratio is the map's aspect ratio. */
    width?: number;
    height?: number;
    /**
     * The map's size in elmos, which is the space every overlay is in
     * (issue #1629). Not the samples above, and not the "8 x 8" a player says,
     * which is this over 512.
     */
    widthElmos?: number;
    heightElmos?: number;
  }[];
  errors: string[];
}

/** One engine configuration value, read from a curated key via `GetSpringConfig*`. */
export interface EngineConfigSetting {
  key: string;
  label: string;
  category: string;
  /**
   * Which control the value deserves. `enum` is a named choice (see `options`),
   * `range` has both ends known (see `min`/`max`) and is worth dragging.
   */
  type: "bool" | "number" | "string" | "enum" | "range";
  /** The effective value (configured value, or the engine default when unset). */
  value: string;
  /** The engine's default for this key, for reset + "changed" hints. */
  default: string;
  /** A line under the label, for a key whose name does not explain itself. */
  hint?: string;
  /** The engine's own bounds, where it declares them. */
  min?: number;
  max?: number;
  /** The named choices for an `enum`, absent for everything else. */
  options?: { value: string; label: string }[];
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

/** One map's mapinfo metadata from the batch map-meta pass. */
export interface MapMeta {
  name: string;
  /** mapinfo metadata (description, author, ...). */
  info: Record<string, string>;
}

export interface MapMetaResult {
  maps: MapMeta[];
  errors: string[];
}

/**
 * Read every map's mapinfo metadata in one session. Kept out of the scan because
 * it opens each map's archive, and only the map detail page and the singleplayer
 * map card read it. Disk-cached per map by the worker.
 */
export const unitsyncMapMeta = defineCommand<
  { enginePath: string; dataDir: string; opId?: string },
  MapMetaResult
>("coilbox-unitsync", "unitsync_map_meta");

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
  /** `"text"`, `"image"`, `"audio"`, or `"binary"`. */
  kind: "text" | "image" | "audio" | "binary";
  /** Decoded contents, when `kind === "text"`. */
  text?: string;
  /** `data:` URL, when `kind === "image"` or `kind === "audio"`. */
  dataUrl?: string;
  /** The member's real size in bytes. */
  size: number;
  /** True when the member was a previewable type but exceeded the size cap. */
  truncated: boolean;
  errors: string[];
}

/**
 * Read one member of an archive for preview. `file` is the member's
 * slash-separated path within `archive`. Text members are returned up to 512 KB,
 * images up to 8 MB and audio up to 16 MB. Anything larger (or non-previewable)
 * returns as binary.
 */
export const unitsyncArchiveFile = defineCommand<
  { enginePath: string; dataDir: string; archive: string; file: string },
  ArchiveFileResult
>("coilbox-unitsync", "unitsync_archive_file");

export interface GameHeadersResult {
  /** Header art per game. Both fields are absent when the game has no usable
   * art. `file` is the cache file name, served over `coilbox://unitsyncheader/`,
   * and `dataUrl` only appears when the art never reached the cache. */
  headers: { name: string; file?: string; dataUrl?: string }[];
  errors: string[];
}

/**
 * Resolve loading-screen art for every game in one unitsync session (for the
 * Games grid). Keyed on cheap file identity and disk-cached by the worker, so it
 * stays cheap on later launches. Games with no usable art come back with neither
 * a `file` nor a `dataUrl`, and the UI shows a gradient placeholder.
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
