import { defineCommand } from "@picoframe/plugin-sdk";
import type { Channel } from "@tauri-apps/api/core";
import type { DownloadProgress } from "../downloads/bindings";
import { gameArchivePath, gameRefs, mapHint, mapRefs } from "./scanHints";

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
  /**
   * The distribution's bundled content folder (`.coilbox/content`). Read in
   * place, searched after every other root and never written into, so it is
   * never a download destination. Lists no engines: a bundled engine is copied
   * into the player's own folder before it runs. Absent from a snapshot written
   * before the field existed.
   */
  bundled?: boolean;
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
  /** A remix whose header names one game and whose first packet another, so
   * the engine plays it on the game it was recorded with. Made by a coilbox
   * older than the fix for issue #3861. */
  staleRemix?: boolean;
  /** A zero byte file: a recording that did not finish, or one still being
   * written. The engine writes a replay only when its game ends. */
  unfinished?: boolean;
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

/**
 * One metric divided by another, declared in the registry beside the metrics
 * (`RATIOS` in `metrics.rs`). It has no unit and is not a rate, so never say
 * "per minute" about it. A match whose `denominator` is zero has no ratio:
 * that is neither infinity nor zero. Both halves are `roster` metrics, the ones
 * the stats store keeps totals for.
 */
export interface MetricRatio {
  /** What the ratio is called. It is never a metric key. */
  key: string;
  /** What to call it in the interface. */
  label: string;
  /** The metric on top. */
  numerator: MetricKey;
  /** The metric underneath. */
  denominator: MetricKey;
}

/** One player/spectator from a demo, with side + ally-team resolved from their team. */
export interface ReplayPlayer {
  /** The `[playerN]` number, which a chat line's or a timeline event's
   * `player` holds. The decoder always sends it. It is optional here only so
   * that the many hand built players in tests need not carry one. */
  player?: number;
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
  /** The `skilluncertainty` the lobby wrote beside `skill`, as the script
   * holds it. Absent when the script has none or it is not a number. */
  skillUncertainty?: number;
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

/** Where one team started, in world units (elmos): `x` and `z` across the map,
 * `y` up. Not scaled to the map, which a replay does not state the size of. */
export interface TeamStartPosition {
  /** The `[teamN]` index, the same number `ReplayPlayer.team` and `ReplayAi.team` carry. */
  team: number;
  x: number;
  y: number;
  z: number;
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
  /** See `ReplayFile.staleRemix`. */
  staleRemix?: boolean;
  /** For a remix, the gametype it was originally recorded on. */
  sourceGametype?: string;
  /** For a remix, the filename of the original replay it was made from. */
  originFilename?: string;
  /** The `[modoptions]` section verbatim (key -> value), for surfaces that want
   * to reproduce the battle's options (e.g. refight-as-skirmish, #368). Empty
   * when the script carried no `[modoptions]` section. */
  modOptions: Record<string, string>;
  /** The `[mapoptions]` section verbatim, as `modOptions` is. Empty when the
   * script carried none. */
  mapOptions: Record<string, string>;
  /** Where each team started, by team id, from the replay's stream (#1146). A
   * team with no recorded position is absent, since 0,0,0 is a real map corner.
   * Absent altogether when the stream has none or cannot be read. */
  startPositions?: TeamStartPosition[];
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
 * `demotool`) and is left out when no engine is installed, which still reads the
 * header and script; `replayPath` is a `ReplayFile.path`.
 */
export const contentDemoInfo = defineCommand<
  { enginePath?: string; replayPath: string },
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
  { metrics: Metric[]; ratios: MetricRatio[] }
>("coilbox-content", "content_metric_registry");

/** One player as recorded in a stats-database game (flattened from the demo). */
export interface StatPlayer {
  name: string;
  /**
   * The `[teamN]` index this seat plays for: the key of its team's entry in
   * `StatRecord.teamTotals`. Absent for a spectator, and for a record ingested
   * before schema 5 until the next pass re-decodes it. Team 0 is a real team,
   * so test for `undefined` and never for falsy.
   */
  team?: number;
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
  /** The `[teamN]` index the bot plays for. Absent on a record from before
   * schema 5. See `StatPlayer.team`. */
  team?: number;
  allyTeam?: number;
  /** Faction (the team's `side`). */
  side?: string;
  /** The team's `Advantage` fraction (0.25 is +25%). Absent when the script has none. */
  advantage?: number;
  /** The team's `IncomeMultiplier`. Absent when the script has none. */
  incomeMultiplier?: number;
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

/** Who a chat line was addressed to. */
export type ChatDest =
  | { kind: "player"; player: number }
  | { kind: "allies" }
  | { kind: "spectators" }
  | { kind: "everyone" };

/** One chat/system line from a replay's network stream. */
export interface ChatLine {
  /** Simulation frame the line arrived in, `-1` before the match started.
   * 30 frames are one second of match time. */
  frame: number;
  /** The packet's `modGameTime` in seconds. Orders pregame lines. Not match
   * time. */
  time: number;
  /** The speaking player's number. 255 is the server. */
  player: number;
  /** Player name from the start script or the stream, when either names them. */
  playerName?: string;
  /** Who a player's line was for. Absent on system lines. */
  dest?: ChatDest;
  text: string;
  /** True for engine system messages (vs a player chat line). */
  system: boolean;
}

/** Why a player left, from the engine's `bIntended` byte. `other` is a value
 * the engine does not define, carried as sent. */
export type LeaveReason =
  | { kind: "lostConnection" }
  | { kind: "left" }
  | { kind: "kicked" }
  | { kind: "other"; code: number };

/** What a {@link TimelineEvent} is. The engine's `JoinTeam` message is left
 * out, since every match opens with them. */
export type TimelineEventKind =
  /** The player stopped playing. */
  | { type: "resigned" }
  /** A team died. `players` are the names of whoever controlled it, empty when
   * no named player did (a bot's team). The event's own `player` is only the
   * one who reported it, so do not name them. */
  | { type: "teamDied"; team: number; players: string[] }
  | { type: "playerLeft"; reason: LeaveReason }
  | { type: "paused"; paused: boolean }
  /** A player who was not in the start script joined mid game. */
  | { type: "joined"; spectator: boolean; team: number }
  /** Everything `fromTeam` owned went to `toTeam`. */
  | { type: "giveAway"; toTeam: number; fromTeam: number }
  /** A team action the engine does not define, carried as sent. */
  | { type: "other"; action: number; param1: number; param2: number };

/** Something that happened to the match or its players, from the typed
 * messages in the replay's stream. */
export type TimelineEvent = {
  /** Simulation frame, `-1` before the match started. 30 frames are one second. */
  frame: number;
  /** The packet's `modGameTime` in seconds. Orders events that share a frame. */
  time: number;
  /** The player it concerns. */
  player: number;
  /** That player's name as it stood when the event arrived, when known. */
  playerName?: string;
} & TimelineEventKind;

/**
 * Extract a replay's chat log (its `NETMSG_CHAT`/`SYSTEMMSG` lines) and its
 * timeline events (resignations, departures, pauses, late joiners, team
 * deaths) from one native stream walk. Needs no engine folder. Read on demand,
 * it walks the whole demo stream. `incomplete` is set when the walk stopped
 * early, so lines and events after that point are missing.
 */
export const contentDemoChat = defineCommand<
  { replayPath: string },
  { messages: ChatLine[]; incomplete: boolean; events: TimelineEvent[] }
>("coilbox-content", "content_demo_chat");

/** What issued an order. `lua` is a widget on the player's own machine acting
 *  for that player, not a bot. `ai` is a skirmish AI the player's machine hosts. */
export type CommandOrigin =
  | { kind: "selection" }
  | { kind: "lua" }
  | { kind: "ai"; ai: number; team: number };

/** Where in a builder's queue a build order went. */
export type BuildSlot =
  /** A placed building given without shift, which replaces the queue. */
  | { kind: "replace" }
  /** The end of the queue: a placed building given with shift, or a factory order. */
  | { kind: "append" }
  /** A factory order given with alt, which goes to the front. */
  | { kind: "front" }
  /** The engine's insert command by position. 0 is "build this next", and a
   *  negative position counts back from the end. */
  | { kind: "insertAt"; position: number }
  /** The engine's insert command beside the queued command carrying `tag`. */
  | { kind: "insertAtTag"; tag: number; after: boolean };

/** One order to build a unit, as a player gave it. An order, not a building:
 *  the replay does not say whether it was carried out. */
export interface BuildOrder {
  /** Simulation frame. 30 frames are one second of match time. */
  frame: number;
  /** The `[playerN]` number of whoever sent it. */
  player: number;
  /** The `[teamN]` index that player was on at the time, or the AI's team. */
  team?: number;
  origin: CommandOrigin;
  /** The engine's unit definition id, which means something only inside the
   *  build of the game the replay was played on. See `resolveBuildUnit`. */
  unitDefId: number;
  /** Where the building was placed, in elmos. Absent for a factory queue order. */
  position?: { x: number; y: number; z: number };
  /** 0 south, 1 east, 2 north, 3 west. Absent when the order does not say. */
  facing?: number;
  /** How many units the order asks for: 1 for a placed building, and 1, 5, 20
   *  or 100 for a factory queue order. */
  count: number;
  slot: BuildSlot;
  /** How many units were given the order. One order to several builders is
   *  one order. */
  builders: number;
  /** The build command's option bits as the engine sent them. */
  options: number;
}

export interface DemoBuildOrders {
  /** Every build order, in the order the engine recorded them. */
  orders: BuildOrder[];
  /** A name for each player number in `orders` that has one. */
  players: { player: number; name: string }[];
  /** Factory queue orders that took units off a queue. Counted, not listed. */
  removals: number;
  /** The last simulation frame the replay reached. */
  lastFrame: number;
  /** True when the walk stopped early, so later orders are missing. */
  incomplete: boolean;
}

/**
 * Read every order to build something out of a replay (#1145). Needs no engine
 * folder and no installed game: the unit definition ids come back as the
 * engine recorded them. Read on demand, it walks the whole demo stream.
 */
export const contentDemoBuildOrders = defineCommand<
  { replayPath: string },
  DemoBuildOrders
>("coilbox-content", "content_demo_build_orders");

/**
 * Every order in a replay that points at a place on the map, packed (#1152).
 *
 * Not objects and not a JSON array: each field is one column of little endian
 * bytes in standard base64, and the columns are parallel, so entry `i` of each
 * is one order. Decode with `decodeOrderPoints` in `replayOrderPoints.ts`.
 * `count` is how many entries each column holds.
 */
export interface DemoOrderPoints {
  count: number;
  /** `f32`, elmos from the map's north west corner. */
  x: string;
  /** `f32`. */
  z: string;
  /** `i32`, a simulation frame (30 to a second). -1 is before the game began. */
  frame: string;
  /** `i16`, the engine team, or -1 when the stream does not say. */
  team: string;
  /** `u8`, the player number. 255 is the server. */
  player: string;
  /** `u8`: 0 move, 1 attack or fight, 2 build, 3 support, 4 other positioned. */
  kind: string;
  /** `u8`: 0 the player's own selection, 1 a widget, 2 a skirmish AI. */
  source: string;
  /** Orders aimed at a unit or a feature. The stream has an id and no place. */
  unitAimed: number;
  /** Orders with no target: a stop, a wait, a fire state, a factory queue entry. */
  noTarget: number;
  /** Orders with an id the engine does not define. None is read for a place. */
  custom: number;
  /** Orders with an id the engine defines and parameters that fit none of its forms. */
  malformed: number;
  lastFrame: number;
  /** True when the walk stopped early, so later orders are missing. */
  incomplete: boolean;
}

/**
 * Read every positioned order out of a replay, packed. Needs no engine folder.
 * Read on demand, it walks the whole demo stream.
 */
export const contentDemoOrderPoints = defineCommand<
  { replayPath: string },
  DemoOrderPoints
>("coilbox-content", "content_demo_order_points");

/**
 * How many events fell in each cell of a map's grid in each minute of a match,
 * packed (#1161). The columns are parallel, little endian in standard base64,
 * and `entries` is how many each holds. See `mapAggregate.ts` for the decode.
 */
export interface MapCountLayer {
  entries: number;
  /** `u32`: the row times the grid's width plus the column. */
  cell: string;
  /** `u16`: the minute of the match, 0 for the first. */
  slice: string;
  /** `u16`: how many events. */
  count: string;
  /** `u32`: the unit definition id. On the buildings layer only. */
  def?: string;
  /** How many events are in the entries. */
  total: number;
  /** How many had a place off the map and were left out. */
  offMap: number;
}

/** One replay reduced to counts on its map's grid (#1161). */
export interface ReplayMapGrids {
  path: string;
  /** Absent for a remix, which carries its original's id. */
  gameId?: string;
  remixed: boolean;
  mapName: string;
  gameType: string;
  lastFrame: number;
  /** True when the walk stopped early, so later events are missing. */
  incomplete: boolean;
  /** Where each team started, by engine team, in elmos. */
  starts: { team: number; x: number; z: number }[];
  /** Orders to place a building, with each one's unit definition id. */
  buildings: MapCountLayer;
  /** Every order aimed at a place on the map. */
  orders: MapCountLayer;
  unitAimed: number;
  custom: number;
  /** Where units died. Absent when the match has no analysis with events. */
  deaths?: {
    layer: MapCountLayer;
    /** Deaths the log names no attacker for. Counted in `layer` all the same. */
    unattacked: number;
    /** Deaths the log puts at exactly 0,0, which are left out. */
    noPosition: number;
  };
  /** Whether the counts came from a kept file and not from walking the replay. */
  fromCache: boolean;
}

/**
 * Reduce replays to counts on their map's grid. `worldWidth` and `worldHeight`
 * are the map's size in elmos. A path must be a replay in a folder the Replays
 * list reads. One that is not, or will not read, comes back in `failed`.
 * Replays are walked one at a time, so ask for one path a call to show progress.
 */
export const contentReplayMapGrids = defineCommand<
  { paths: string[]; worldWidth: number; worldHeight: number },
  {
    grid: {
      width: number;
      height: number;
      worldWidth: number;
      worldHeight: number;
    };
    replays: ReplayMapGrids[];
    failed: { path: string; error: string }[];
  }
>("coilbox-content", "content_replay_map_grids");

/** Who sent a run of orders. A widget is the player's Lua acting for them. */
export type OrderSource = "selection" | "lua" | "ai";

/** One team's order count in each bucket of match time, from one sender. */
export interface CommandSeries {
  /** The engine team. Players sharing a team are already added together. */
  team: number;
  source: OrderSource;
  /** Bucket `i` covers `periodSec` seconds from `i * periodSec`. */
  counts: number[];
}

/** How many orders each team gave in each period of a replay (#1149). */
export interface DemoCommandRates {
  /** The bucket length: the replay's own team statistics period. */
  periodSec: number;
  /** True when the header named no period and the engine's default was used. */
  periodIsDefault: boolean;
  /** Whole buckets. The stretch after the last is left out. */
  buckets: number;
  series: CommandSeries[];
  /** Orders given before the game started. */
  pregame: number;
  /** Orders in the stretch after the last whole bucket. */
  trailing: number;
  /** Orders from a player with no team, such as a spectator. */
  unattributed: number;
  lastFrame: number;
  /** True when the walk stopped early, so later orders are missing. */
  incomplete: boolean;
}

/**
 * Count the orders each team gave in each statistics period of a replay. Needs
 * no engine folder. Read on demand, it walks the whole demo stream.
 */
export const contentDemoCommandRates = defineCommand<
  { replayPath: string },
  DemoCommandRates
>("coilbox-content", "content_demo_command_rates");

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

/** The replay logger's first line: what the gadget saw the run as. */
export interface ReplayLogHeader {
  /** The line format. A reader that knows a lower one should offer a new run. */
  format: number;
  /**
   * `Game.gameName` during the run, which is the analysis game's name and not
   * the game the replay was recorded on. That one is `StoredReplayAnalysis.game`.
   */
  game: string;
  gameVersion: string;
  gameShortName: string;
  map: string;
  engine: string;
  /** The map's size in world units, which places an event's `x` and `z` on a map. */
  mapSizeX: number;
  mapSizeZ: number;
  gaiaTeam: number;
  /**
   * How many frames lie between two `start_unit_position` lines for one unit.
   * 0 from a logger that wrote none.
   */
  positionFrames: number;
}

/**
 * A unit being created, finished, destroyed or handed to another team. `def` is
 * a unit definition id as that run's engine numbered them. `x`, `y` and `z` are
 * world coordinates.
 */
export interface ReplayUnitEvent {
  frame: number;
  unit: number;
  def: number;
  team: number;
  x: number;
  y: number;
  z: number;
  /**
   * Present and true on a unit its team started with: one created for a team
   * other than Gaia, by no builder, on the frame that team's first unit was
   * created. The engine has no idea of a commander, so this is not one, and the
   * interface says "starting unit". Absent on every other unit.
   */
  startUnit?: boolean;
  /** On `unit_given`, the team the unit left. `team` is the one it went to. */
  from?: number;
  /** On `unit_given`, present and true for a capture and absent for a gift. */
  captured?: boolean;
  /** On `unit_created`, the unit that built it. Absent when nothing did. */
  builder?: number;
  /**
   * On `unit_destroyed`, what destroyed it. All four are absent for a death
   * with no attacker, such as a cancelled build.
   */
  attacker?: number;
  attackerDef?: number;
  attackerTeam?: number;
  weapon?: number;
}

/**
 * Where a living starting unit was. Written every
 * `ReplayLogHeader.positionFrames` frames and left out when the unit has not
 * moved since the last one, so a gap means it stood still. Its `unit_created`
 * line is its first position and its `unit_destroyed` line its last.
 */
export interface ReplayStartUnitPosition {
  frame: number;
  unit: number;
  /** The team the unit belonged to on that frame. */
  team: number;
  x: number;
  z: number;
}

/**
 * One team's totals when the game ended, as the engine reported them to Lua.
 * The figures are `TeamStatSample`'s. `frame` is the frame the game ended on.
 */
export interface ReplayLoggedTeam extends TeamStatSample {
  team: number;
  /** How many statistics samples the team had. */
  samples: number;
}

/**
 * One line of an analysed replay's event log. A later logger adds kinds, which
 * arrive as `unknown`, so switch on `kind` with a default.
 */
export type ReplayLogLine =
  | ({ kind: "header" } & ReplayLogHeader)
  | { kind: "game_start"; frame: number }
  | ({ kind: "unit_created" } & ReplayUnitEvent)
  | ({ kind: "unit_finished" } & ReplayUnitEvent)
  | ({ kind: "unit_destroyed" } & ReplayUnitEvent)
  | ({ kind: "unit_given" } & ReplayUnitEvent)
  | ({ kind: "start_unit_position" } & ReplayStartUnitPosition)
  | {
      kind: "game_over";
      frame: number;
      winners: number[];
      teams: ReplayLoggedTeam[];
    }
  | { kind: "unknown" };

/** How many lines of each kind a run's log held. */
export interface ReplayEventCounts {
  header: number;
  /** The engine's unit definitions the run listed. They are kept in the unit
   *  definition store and not among the events. Absent from a file written
   *  before the logger listed them. */
  unitDef?: number;
  gameStart: number;
  unitCreated: number;
  unitFinished: number;
  unitDestroyed: number;
  unitGiven: number;
  startUnitPosition: number;
  /** Absent from a file written before the logger followed a starting unit
   *  through a replacement. */
  startUnitReplaced?: number;
  /** Absent from a file written before the logger recorded damage. */
  damage?: number;
  gameOver: number;
  /** Lines of a kind this build does not know. */
  unknown: number;
}

/** One figure an analysis run and its replay disagree on. */
export interface ReplayDisagreement {
  /**
   * `winners`, `gameSeconds`, `teams`, `samples`, `desyncWarnings`,
   * `unitCreatedLines`, `unitDestroyedLines`, `unitsReceivedLines`,
   * `unitsSentLines`, `unitsCapturedLines`, `unitsOutCapturedLines`, or a
   * `TeamStatSample` key such as `metalProduced`.
   */
  figure: string;
  /** The team the figure belongs to, when it is a team's. */
  team?: number;
  /** What the replay recorded. */
  recorded: string;
  /** What the run observed. */
  observed: string;
  /** Observed minus recorded, for a figure that is a number. */
  difference?: number;
}

/** How far a running analysis has got. */
export type ReplayAnalysisPhase = "starting" | "loading" | "playing";

/** The analysis that is running. */
export interface ReplayAnalysisRunningJob {
  id: number;
  gameId: string;
  /** The replay's file name. */
  name: string;
  replayPath: string;
  matchSeconds: number;
  startedAtMs: number;
  phase: ReplayAnalysisPhase;
  /**
   * The frame of the last event the logger wrote. It stands still through a
   * stretch of the match in which no unit is made or lost.
   */
  frame: number;
  /**
   * The match's last frame, from the whole seconds in the replay's header, so
   * `frame` can end up to a second past it.
   */
  lastFrame: number;
  /** A cancel has been asked for and the run is on its way out. */
  cancelling: boolean;
}

/** An analysis waiting its turn. */
export interface ReplayAnalysisQueuedJob {
  id: number;
  gameId: string;
  name: string;
  replayPath: string;
}

/**
 * The last run of a match that failed this session. A failure is not a fact
 * about the replay, so it is never stored.
 *
 * - `tookTooLong`: the run reached `limitSeconds` and was killed. Not a
 *   divergence: it never got as far as being compared.
 * - `engineFailed`: the engine stopped before the match ended.
 * - `couldNotRun`: the run could not be started, or its result not stored.
 */
export interface ReplayAnalysisFailure {
  gameId: string;
  name: string;
  reason: "tookTooLong" | "engineFailed" | "couldNotRun";
  /** The detail: an error, or how the engine exited. */
  message: string;
  limitSeconds?: number;
  /** What the engine said: its fatal lines, or its last lines. */
  logExcerpt: string[];
}

/** The analysis queue, which belongs to the app and outlives any page. */
export interface ReplayAnalysisQueue {
  running: ReplayAnalysisRunningJob | null;
  /** In the order they will run. */
  queued: ReplayAnalysisQueuedJob[];
  /** Nothing is running because a game is. The queue starts again when it ends. */
  waitingForGame: boolean;
  failures: ReplayAnalysisFailure[];
  /**
   * Counts up each time a run changes the store, so a listener knows to ask
   * {@link contentReplayAnalyses} again.
   */
  stored: number;
}

/**
 * The Tauri event every window is sent when the analysis queue changes. Its
 * payload is a {@link ReplayAnalysisQueue}. A page asks
 * {@link contentAnalysisQueue} once when it opens and then listens for this.
 */
export const ANALYSIS_QUEUE_EVENT = "coilbox-content://analysis-queue";

/**
 * Ask for a replay to be analysed: played back headless under coilbox's
 * analysis game, with the result stored (#1157). This is the only command that
 * leads to an engine being run for an analysis. Call it through
 * `src/content/replayAnalysis.ts`, which is where the `analytics.run` profile
 * key is checked, and only because a person pressed the button for that
 * replay.
 *
 * `replayPath` is a `ReplayFile.path`. `enginePath` and `dataDir` are the
 * `PlayTarget.enginePath` and `PlayTarget.dataDir` a replay launch would use,
 * or those of another installed engine when the replay's own is not installed
 * (#3869). `game` names another installed version of the replay's game to
 * depend on instead of the one it names, and is left out for the recorded one.
 * `force` asks for a run of a match that already has a current analysis.
 *
 * It rejects, with the reason, for a replay that cannot be analysed: a remix,
 * one with no recorded game over, or an engine folder with no headless engine.
 * There is no time limit to pass: the queue allows the match's own length plus
 * time for the engine to start.
 */
export const contentAnalysisEnqueue = defineCommand<
  {
    replayPath: string;
    enginePath: string;
    dataDir: string;
    game?: string;
    force?: boolean;
  },
  {
    outcome: "queued" | "alreadyQueued" | "alreadyAnalysed";
    queue: ReplayAnalysisQueue;
  }
>("coilbox-content", "content_analysis_enqueue");

/**
 * Whether a replay can be analysed at all, read from the replay itself.
 * `cannot` is null when it can. Whether its engine, game and map are installed
 * is a separate question.
 *
 * - `remix`: a remix keeps its original's recorded result, so there is nothing
 *   of its own to check a run against.
 * - `noGameOver`: the match was quit before a game over was recorded.
 * - `noGameId`: the header holds no id to file a result under.
 * - `unreadable`: the file does not read as a replay.
 *
 * `enginePaths` are installed engine folders (`Engine.path`), and `headless`
 * answers which of them hold a headless engine, the only kind an analysis can
 * run.
 */
export const contentAnalysisCheck = defineCommand<
  { replayPath: string; enginePaths?: string[] },
  {
    cannot: "remix" | "noGameId" | "noGameOver" | "unreadable" | null;
    gameId: string | null;
    matchSeconds: number;
    headless: string[];
  }
>("coilbox-content", "content_analysis_check");

/** The analysis queue as it is now. */
export const contentAnalysisQueue = defineCommand<
  undefined,
  { queue: ReplayAnalysisQueue }
>("coilbox-content", "content_analysis_queue");

/**
 * Cancel one analysis by its id, queued or running, or every one when no id is
 * given. A running one has its engine killed and nothing of it is stored.
 */
export const contentAnalysisCancel = defineCommand<
  { id?: number },
  { cancelled: boolean }
>("coilbox-content", "content_analysis_cancel");

/** Forget a match's last failed run, once it has been read. */
export const contentAnalysisDismiss = defineCommand<
  { gameId: string },
  { ok: boolean }
>("coilbox-content", "content_analysis_dismiss");

/**
 * What a stored analysis means to a reader today (#1158).
 *
 * - `current`: events from the logger this build ships.
 * - `outdated`: events from an earlier logger. They still read. A view that
 *   needs something the earlier logger did not record offers a new run.
 * - `diverged`: a run finished and did not reproduce the match. No events.
 */
export type ReplayAnalysisState = "current" | "outdated" | "diverged";

/** One run that finished and did not reproduce the match. */
export interface ReplayAnalysisAttempt {
  engine: string;
  game: string;
  analysedAtMs: number;
  disagreements: ReplayDisagreement[];
}

/**
 * What is stored for one analysed match: what produced it, when, and how many
 * events of each kind it holds. Never the events themselves.
 */
export interface StoredReplayAnalysis {
  state: ReplayAnalysisState;
  /** The stored file's size on disk, compressed. */
  sizeBytes: number;
  kind: "analysis";
  storeFormat: number;
  outcome: "reproduced" | "diverged";
  /** The replay's game id, which is what `StatRecord.gameId` and `DemoInfo.gameId` hold. */
  gameId: string;
  /** The logger's line format, and which logger wrote the events. */
  loggerFormat: number;
  loggerVersion: number;
  /** The engine the run used, as it named itself. */
  engine: string;
  /** The game the run depended on, name and version. */
  game: string;
  /**
   * What the replay says it was recorded with. Empty in a file written before
   * these were kept, which reads as unknown and never as the same.
   */
  recordedEngine?: string;
  recordedGame?: string;
  /** Whether the run used another engine or game version. Null when unknown. */
  engineDiffers?: boolean | null;
  gameDiffers?: boolean | null;
  /** Every engine and game the match diverged on, oldest first. */
  attempts?: ReplayAnalysisAttempt[];
  map: string;
  analysedAtMs: number;
  /** The match's length, and how long the engine took to play it back. */
  matchSeconds: number;
  wallSeconds: number;
  counts: ReplayEventCounts;
  /** The figures the run and the replay disagreed on. Empty unless `diverged`. */
  disagreements: ReplayDisagreement[];
}

/**
 * Every stored analysis, to join to replay records by `gameId`. This is how
 * the library knows which replays have event data: the answer changes when an
 * analysis is run or deleted, so it is asked for and never stored in a
 * `StatRecord`.
 *
 * A remix carries its original's game id and has no analysis of its own, so
 * leave records with `remixed` set out of the join.
 */
export const contentReplayAnalyses = defineCommand<
  undefined,
  { analyses: StoredReplayAnalysis[] }
>("coilbox-content", "content_replay_analyses");

/** What is stored for one match, or null. Carries the counts per kind. */
export const contentReplayAnalysis = defineCommand<
  { gameId: string },
  { analysis: StoredReplayAnalysis | null }
>("coilbox-content", "content_replay_analysis");

/**
 * A match's stored events, in the order the logger wrote them. `kinds` keeps
 * only lines of those kinds. `offset` and `limit` take a window of what was
 * kept, and `total` is how many lines matched in all. A match can hold tens
 * of thousands of lines, so ask for the kinds a view draws.
 */
export const contentReplayAnalysisEvents = defineCommand<
  { gameId: string; kinds?: string[]; offset?: number; limit?: number },
  { events: ReplayLogLine[]; total: number }
>("coilbox-content", "content_replay_analysis_events");

/** Delete what is stored for one match, leaving the replay alone. */
export const contentReplayAnalysisDelete = defineCommand<
  { gameId: string },
  { deleted: boolean }
>("coilbox-content", "content_replay_analysis_delete");

/**
 * One unit definition as the unit definition store keeps it (#1176): what the
 * replay page reads of a unit and no more. A number that is absent is one the
 * source did not give, which is not the same as zero.
 */
export interface StoredUnitDef {
  /** The definition's key. */
  name: string;
  /** What a player calls it. Absent when the source gave none. */
  humanName?: string;
  metalCost?: number;
  energyCost?: number;
  /** Whether it moves. Left out when false, like the three below. */
  mobile?: boolean;
  /** Whether the definition says it builds. */
  builder?: boolean;
  /** Whether it has a build menu. */
  builds?: boolean;
  /** Whether it has a weapon. */
  armed?: boolean;
  transportCapacity?: number;
  metalMake?: number;
  energyMake?: number;
  makesMetal?: number;
  extractsMetal?: number;
  windGenerator?: number;
  tidalGenerator?: number;
  metalUpkeep?: number;
  energyUpkeep?: number;
  metalStorage?: number;
  energyStorage?: number;
  radarDistance?: number;
  sonarDistance?: number;
  radarDistanceJam?: number;
  sonarDistanceJam?: number;
  seismicDistance?: number;
}

/**
 * Where a stored unit list came from, least trusted first. `folder` and
 * `archive` were read through unitsync from an installed game matched by name:
 * a loose folder can change under its name and a packaged archive cannot.
 * `engine` is the engine's own list, written during an analysis run.
 */
export type UnitDefOrigin = "folder" | "archive" | "engine";

/** One unit list recorded for a replay. */
export interface UnitDefLink {
  /** `sha256:` and 64 hex digits, the list's name. */
  digest: string;
  origin: UnitDefOrigin;
  /** The game the list was read from, name and version. */
  game: string;
  takenAtMs: number;
  /** For an engine's list: whether the run used a game other than the one the
   *  replay names. Absent when that is not known. */
  gameDiffers?: boolean;
}

/** What is recorded for one replay. */
export interface ReplayUnitDefSets {
  links: UnitDefLink[];
  /** The link that names the ids in the replay's own stream, if any. */
  stream: UnitDefLink | null;
  /** The link that names the ids in the replay's analysis events, if any. */
  events: UnitDefLink | null;
  /** The lists `stream` and `events` name, by digest, each in id order. */
  sets: Record<string, StoredUnitDef[]>;
}

/**
 * The unit lists recorded for one replay. `gameId` is the replay's own, which
 * for a remix is its original's, so a remix reads its original's lists.
 */
export const contentUnitDefSet = defineCommand<
  { gameId: string },
  ReplayUnitDefSets
>("coilbox-content", "content_unit_def_set");

/**
 * Keep the unit list a replay was just read against. Only for a game installed
 * under the exact name the replay records. `archive` is the installed game's
 * archive name, which says whether it is a loose folder. A replay that already
 * has a list from that kind of read keeps it, and `digest` is the one it kept.
 */
export const contentUnitDefSetStore = defineCommand<
  { gameId: string; game: string; archive: string; units: StoredUnitDef[] },
  { digest: string | null; origin: UnitDefOrigin; links: UnitDefLink[] }
>("coilbox-content", "content_unit_def_set_store");

/** How many unit lists are kept, for how many replays, and their size on disk. */
export const contentUnitDefSetsUsage = defineCommand<
  undefined,
  { sets: number; replays: number; bytes: number }
>("coilbox-content", "content_unit_def_sets_usage");

/**
 * Delete a replay file. `path` must be a `.sdfz`/`.sdf` from
 * `content_list_replays`. Its stored analysis goes with it. With
 * `onlyUnfinished` a file that is no longer empty is left alone. The backend
 * refuses an empty file while a game coilbox launched is running.
 */
export const contentDeleteReplay = defineCommand<
  { path: string; onlyUnfinished?: boolean },
  { ok: boolean; analysisDeleted: boolean }
>("coilbox-content", "content_delete_replay");

/** What a bulk replay delete removed, or would remove. */
export interface ReplayDeleteSummary {
  /** False for a preview, which deletes nothing. */
  applied: boolean;
  deleted: number;
  bytes: number;
  /** One sentence per path left alone, saying why. */
  skipped: string[];
  /** How many of the replays had a stored analysis, which goes with them. */
  analyses: number;
  analysisBytes: number;
}

/**
 * Delete a batch of replays. Every path is guarded the same way
 * `contentDeleteReplay` guards its one, and a path that fails is skipped with a
 * reason instead of failing the batch. `apply` false sizes it without deleting.
 */
export const contentDeleteReplays = defineCommand<
  { paths: string[]; apply: boolean; onlyUnfinished?: boolean },
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

/** One engine a distribution's bundled content folder carries (issue #3668). */
export interface BundledEngine {
  /** Its platform folder, such as `macos_arm64`, or absent for `engine/<version>/`. */
  platform?: string | null;
  /** The version folder name. */
  version: string;
  /** Relative to the bundle folder. */
  path: string;
  /** What installing it copies. */
  bytes: number;
  forThisPlatform: boolean;
  /** Already in one of the player's own content folders, by version. */
  installed: boolean;
}

/** The kinds of authoring mistake `contentBundleInspect` reports. */
export type BundleProblemKind =
  | "looseArchive"
  | "stray"
  | "packagesWithoutPool"
  | "looseGame"
  | "unknownPlatform"
  | "engineAtTop"
  | "unreadableEngine"
  | "noEngineForThisPlatform"
  | "empty";

/** One authoring mistake in the bundle, for the distribution health checklist. */
export interface BundleProblem {
  kind: BundleProblemKind;
  /** Relative to the bundle folder. */
  path: string;
  detail?: string;
}

/** What the bundle holds, counted by file, and what is wrong with it. */
export interface BundleReport {
  path: string;
  games: number;
  maps: number;
  packages: number;
  engines: BundledEngine[];
  problems: BundleProblem[];
}

/**
 * The distribution's bundled content, or `bundle: null` when it has none, which
 * is every install that is not portable. `writePath` is the download
 * destination, used to tell whether a bundled engine is already installed.
 */
export const contentBundleInspect = defineCommand<
  { writePath?: string },
  { bundle: BundleReport | null }
>("coilbox-content", "content_bundle_inspect");

/**
 * Copy the bundled engine for this platform into `writePath`, the way a
 * download would install it. `copied` is false when it was already there.
 * Cancelled through {@link contentBundleCancel} with the same `opId`.
 */
export const contentBundleInstallEngine = defineCommand<
  {
    writePath: string;
    platform?: string | null;
    version: string;
    opId?: string;
    onProgress: Channel<DownloadProgress>;
  },
  { path: string; copied: boolean; bytes: number }
>("coilbox-content", "content_bundle_install_engine");

/** Stop the engine copy started with this `opId`. */
export const contentBundleCancel = defineCommand<
  { opId: string },
  { cancelled: boolean }
>("coilbox-content", "content_bundle_cancel");

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

/** What of the in game blueprint widget is installed under a content root,
 *  against what this coilbox ships (issue #1419). */
export interface WidgetStatus {
  /** Any of the widget's files are there. */
  installed: boolean;
  /** Every shipped file is there with the same bytes. */
  current: boolean;
  /** Shipped files, relative to `LuaUI/`. */
  files: string[];
  /** Shipped files that are missing or differ. */
  stale: string[];
}

/** Compare the widget under a content root with the one coilbox ships. */
export const contentWidgetStatus = defineCommand<
  { rootPath: string },
  WidgetStatus
>("coilbox-content", "content_widget_status");

/** Copy the widget into a content root's `LuaUI/`, or update it there. */
export const contentWidgetInstall = defineCommand<
  { rootPath: string },
  { written: string[] }
>("coilbox-content", "content_widget_install");

/** Take the widget out of a content root. Its data files stay. */
export const contentWidgetRemove = defineCommand<
  { rootPath: string },
  { removed: string[] }
>("coilbox-content", "content_widget_remove");

/** What one install of a batch `.3do` conversion (issue #2622) did. */
export interface Install3doOutcome {
  /** How many files were copied from the conversion's output into the game. */
  filesCopied: number;
  /** Original `.3do` files moved aside, as their path inside the game. */
  originalsMovedAside: string[];
  /** Models an earlier install already moved aside, left untouched. */
  alreadyInstalled: string[];
  /** A converted model whose original `.3do` could not be found. */
  missingOriginal: string[];
  /** Unit definitions that spelled `.3do` in `objectname` and had it stripped. */
  unitDefsPatched: string[];
}

/**
 * Install a batch `.3do` conversion's output into the `.sdd` game it came
 * from: copy the converted models and sheets in, move the original `.3do`
 * files they replace aside (not delete - the engine tries `.3do` before
 * `.s3o` for an extensionless `objectname`, so the original has to go before
 * the conversion has any effect), and strip the extension from a unit
 * definition that names one directly. Refuses anything that is not a `.sdd`:
 * a `.sdz`/`.sd7` is one packed file with no sound way to rewrite it in place.
 */
export const contentInstall3doConversion = defineCommand<
  { gameDir: string; outDir: string },
  Install3doOutcome
>("coilbox-content", "content_install_3do_conversion");

/** What one undo of a batch `.3do` install restored. */
export interface Undo3doInstallOutcome {
  /** Every file the install touched, restored from its backup. */
  restored: string[];
}

/** Reverse every change an earlier {@link contentInstall3doConversion} made. */
export const contentUndo3doInstall = defineCommand<
  { gameDir: string },
  Undo3doInstallOutcome
>("coilbox-content", "content_undo_3do_install");

/**
 * How many backups an earlier `.3do` install left under a game, so the
 * frontend can offer undo even in a freshly opened drawer that never ran the
 * install itself this session.
 */
export const content3doInstallStatus = defineCommand<
  { gameDir: string },
  { backups: number }
>("coilbox-content", "content_3do_install_status");

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
  /**
   * Dependencies no installed archive satisfies, as the engine names them
   * (lower-cased). Empty when everything resolves. Absent in a scan from a
   * worker that predates the field, which reads as none known.
   */
  missingDependencies?: string[];
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

/**
 * What a read of a game takes. `archivePath` is the game's primary archive as a
 * full path, and it is what lets the plugin answer from the cache without starting
 * a worker (issue #3714). Callers leave it out. It is filled in from the content
 * scan, and a game the scan has not placed is read by a worker as it always was.
 */
type GameReadArgs = {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  archivePath?: string;
};

/** What a read of a map takes. `archivePath` and `fileName` are what the map's
 *  cache key is made from, filled in from the content scan like a game's. */
type MapReadArgs = {
  enginePath: string;
  dataDir: string;
  mapName: string;
  archivePath?: string;
  fileName?: string;
};

/** One map of the last scan, as the plugin needs it to find the map's saved
 *  answer. At least one of `archivePath` and `fileName` is set. */
export type MapRef = {
  name: string;
  archivePath?: string;
  fileName?: string;
};

/** One game of the last scan. `name` is the game's name and `archivePath` its
 *  primary archive as a full path. */
export type GameRef = { name: string; archivePath: string };

type SkirmishAisArgs = {
  enginePath: string;
  dataDir: string;
  gameArchive?: string;
  archivePath?: string;
};

function withGameArchivePath<T extends GameReadArgs>(args: T): T {
  if (args.archivePath !== undefined) return args;
  const archivePath = gameArchivePath(
    args.dataDir,
    args.enginePath,
    args.gameArchive,
  );
  return archivePath === undefined ? args : { ...args, archivePath };
}

function withMapHint<T extends MapReadArgs>(args: T): T {
  if (args.archivePath !== undefined || args.fileName !== undefined) {
    return args;
  }
  const hint = mapHint(args.dataDir, args.enginePath, args.mapName);
  return hint === undefined ? args : { ...args, ...hint };
}

function withMapRefs<
  T extends { enginePath: string; dataDir: string; maps?: MapRef[] },
>(args: T): T {
  if (args.maps !== undefined) return args;
  const maps = mapRefs(args.dataDir, args.enginePath);
  return maps === undefined ? args : { ...args, maps };
}

function withGameRefs<
  T extends { enginePath: string; dataDir: string; games?: GameRef[] },
>(args: T): T {
  if (args.games !== undefined) return args;
  const games = gameRefs(args.dataDir, args.enginePath);
  return games === undefined ? args : { ...args, games };
}

/** A tree read names a game by its archive file name or a map by its name, so
 *  try the game lookup first and then the map lookup. */
function withArchiveTreeHint<
  T extends {
    enginePath: string;
    dataDir: string;
    archive: string;
    archivePath?: string;
    fileName?: string;
  },
>(args: T): T {
  if (args.archivePath !== undefined || args.fileName !== undefined) {
    return args;
  }
  const archivePath = gameArchivePath(
    args.dataDir,
    args.enginePath,
    args.archive,
  );
  if (archivePath !== undefined) return { ...args, archivePath };
  const hint = mapHint(args.dataDir, args.enginePath, args.archive);
  return hint === undefined ? args : { ...args, ...hint };
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
export const unitsyncGameInfo = (args: GameReadArgs) =>
  gameInfoCommand(withGameArchivePath(args));
const gameInfoCommand = defineCommand<GameReadArgs, GameInfoResult>(
  "coilbox-unitsync",
  "unitsync_game_info",
);

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
export const unitsyncUnitBuildpics = (args: UnitBuildpicsArgs) =>
  unitBuildpicsCommand(withGameArchivePath(args));
type UnitBuildpicsArgs = GameReadArgs & { units: string[]; assets?: boolean };
const unitBuildpicsCommand = defineCommand<
  UnitBuildpicsArgs,
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
export const unitsyncFactionLogos = (args: FactionLogosArgs) =>
  factionLogosCommand(withGameArchivePath(args));
type FactionLogosArgs = GameReadArgs & { sides: string[] };
const factionLogosCommand = defineCommand<FactionLogosArgs, FactionLogosResult>(
  "coilbox-unitsync",
  "unitsync_faction_logos",
);

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
   * `maxVelocity`, `range`, and a `weapons` array of one object per weapon,
   * plus what a unit makes, stores and senses and whether it builds (the
   * engine's own keys, such as `energyMake`, `extractsMetal`, `energyStorage`,
   * `radarDistance` and `builder`). `classifyUnit` in `unitCategory.ts` reads
   * those. `shared/unitdef-stats.json` writes the list down.
   *
   * Untyped on purpose. The hub stores these as schemaless JSON and renders
   * what arrives, so a stat added to the worker's Lua shim reaches a unit page
   * without a type change here. A key a def does not declare is simply not
   * present, which is not the same as zero: zero is a claim about the game.
   */
  stats?: Record<string, unknown>;
  /**
   * What this unit turns into: a morph, an upgrade, a tech level (issue #2063).
   * One object per edge, each with `into` (the target's lowercased def key) and
   * whatever conditions the game declared beside it, under the game's own
   * lowercased names. Untyped past `into` on purpose, because no two games
   * spell the conditions the same way.
   *
   * Absent from a dataset read by a worker too old to report it, which reads
   * the same as a unit that morphs nowhere: draw no edge either way.
   */
  morphTargets?: ({ into: string } & Record<string, unknown>)[];
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
export const unitsyncUnitDataset = (args: GameReadArgs) =>
  unitDatasetCommand(withGameArchivePath(args));
const unitDatasetCommand = defineCommand<GameReadArgs, UnitDatasetResult>(
  "coilbox-unitsync",
  "unitsync_unit_dataset",
);

/**
 * Every key a game declares for every unit, read out of the game's own def
 * pipeline (issue #1269).
 *
 * {@link UnitDatasetResult} is the curated read: the fields a tech tree and an
 * encyclopedia page were built around. This is the whole table and is typed
 * nowhere, because a unit editor has to offer the keys nobody curated and a
 * game's `customparams` mean whatever that game's own Lua says they mean.
 *
 * Everything here is what the game says. A tweak a player makes is a separate,
 * sparse set of overrides held against these values, so nothing user-supplied
 * ever belongs in this object.
 */
export interface UnitDefsResult {
  /**
   * Every unit, keyed by its lowercased def key, which is the key
   * {@link UnitDatasetEntry.name} carries so the two join.
   *
   * Each value is the unitdef table as the game left it, including its
   * `customparams`, its `buildoptions`, and the `weapondefs` a game that
   * declares its weapons inside the unit puts there. A Lua table whose keys are
   * exactly 1..n arrives as an array and every other table as an object. A
   * value the worker could not represent arrives as null, which says the game
   * declared the key and it could not be read. An absent key says the game
   * declared nothing, and the two must not be conflated.
   */
  units: Record<string, Record<string, unknown>>;
  /**
   * The game's shared weapondef table, keyed by lowercased weapondef name. A
   * unitdef's `weapons` list names entries here, and a game that hoists its
   * weapons out of the unit keeps them nowhere else.
   */
  weaponDefs: Record<string, Record<string, unknown>>;
  /**
   * The game's armour classes, from `gamedata/armordefs.lua`: each class name
   * to whatever the game listed as its members, ordinarily an array of unit
   * def keys. The engine assigns a unit's class purely from which of these
   * lists names it, always trying a class it calls `default` first regardless
   * of what the game writes here, so a unit named nowhere in this table is in
   * that class rather than in none (issue #2645).
   */
  armorDefs: Record<string, unknown>;
  /**
   * The units the game's own def loader could not read, in its own words. The
   * loader runs each unit file separately and logs the ones that raise, so a
   * broken unit costs that unit and not the scan. Without this the unit would
   * simply be absent, with nothing to say whether the game ships it.
   */
  unitErrors: string[];
  /**
   * What the game calls its units in each `language/<code>/units.json` it
   * ships, keyed by that language code and then by lowercased def key.
   *
   * Absent for a game that names its units in its unitdefs, which is every game
   * measured here but Beyond All Reason. BAR writes no `name`, no `humanName`
   * and no `description` in any of its 564 unitdefs and keeps both in these
   * files instead, so this is the only place a rename or a rewritten tooltip
   * can go for it (issue #2650).
   *
   * One entry per translation the game ships, since a rename made in English
   * alone leaves the other translations saying the old thing (issue #2672).
   * Beyond All Reason ships six: de, en, es, fr, ru and zh.
   */
  languageText?: Record<
    string,
    { names?: Record<string, string>; descriptions?: Record<string, string> }
  >;
  /**
   * What the game's own `unitdefs_post.lua` and `weapondefs_post.lua` changed
   * in each definition, by unit and by weapon, the weapon keyed as
   * {@link weaponDefs} keys it. A definition they left alone has no entry
   * (issue #3054).
   *
   * Absent when the game's loader never ran a post file by either name, so
   * there was no moment to compare against.
   */
  beforePost?: {
    units: Record<string, PostChange>;
    weaponDefs: Record<string, PostChange>;
  };
  checksum?: string;
  errors: string[];
}

/**
 * What a game's post files did to one definition. Paths are dotted, a list
 * position counted from zero. `values` holds the game's own value at each path
 * the post files changed or removed, and `added` each path they added. Either
 * half is left out when empty.
 */
export interface PostChange {
  values?: Record<string, unknown>;
  added?: string[];
}

/**
 * Load every key a game declares for every unit. Lazy, since it mounts the
 * game's archive set, and megabytes of JSON on a full game, so a caller wanting
 * only names and build options should use {@link unitsyncUnitDataset} instead.
 * `gameArchive` is the primary archive name.
 */
export const unitsyncUnitDefs = defineCommand<
  { enginePath: string; dataDir: string; gameArchive: string },
  UnitDefsResult
>("coilbox-unitsync", "unitsync_unit_defs");

/** One Lua file in a game's archives that names a custom parameter. */
export interface CustomParamSite {
  /** Path inside the game's archives, e.g.
   *  `luarules/gadgets/unit_paralyze_damage_multiplier.lua`. */
  file: string;
  /** How many times the file reads the parameter. */
  reads: number;
  /** How many times it assigns to it. A game's own def post-processing writes
   *  parameters onto units, and the file that sets one answers "what is this?"
   *  as well as one that acts on it. */
  writes: number;
}

/** Which of a game's Lua files name one custom parameter. */
export interface CustomParamConsumers {
  /** The files, most mentions first. Capped by the worker, so this may be
   *  shorter than {@link CustomParamConsumers.files}. */
  sites: CustomParamSite[];
  /** How many files name it in total. A parameter named in one file has an
   *  answer and one named in forty does not, so the count comes before the
   *  list. */
  files: number;
}

/**
 * Which of a game's own Lua files name each custom parameter (issue #2661).
 *
 * The engine ignores custom parameters completely, so {@link UnitDefsResult}
 * can say a unit carries `techlevel` and nothing about what it means. Only the
 * game's Lua gives it one, and this is a text search over that Lua for the file
 * that reads it.
 */
export interface CustomParamsResult {
  /** Parameter name, lowercased, to the files that name it. Lowercase because
   *  that is the casing both the def table and the engine's own `customParams`
   *  table use, so this joins to a def key without either side guessing. */
  params: Record<string, CustomParamConsumers>;
  /** How many files read `customParams` without naming a key: passing the whole
   *  table on, or building it. Those read parameters the scan cannot attribute,
   *  so a parameter with no named consumer is "nothing names this, and N files
   *  read the table whole" rather than "nothing reads this". */
  wholeTableFiles: number;
  /** How many Lua files were read. */
  filesScanned: number;
  /** Whether a cap stopped the walk early, so an absent answer may be that
   *  rather than the game. */
  truncated: boolean;
  checksum?: string;
  errors: string[];
}

/**
 * Index a game's Lua for the files that name each custom parameter. Lazy, since
 * it mounts the game's archive set and reads every `.lua` in it, and disk-cached
 * on the game's sync checksum. `gameArchive` is the primary archive name.
 */
export const unitsyncCustomParams = defineCommand<
  { enginePath: string; dataDir: string; gameArchive: string },
  CustomParamsResult
>("coilbox-unitsync", "unitsync_custom_params");

/** One drawable batch inside a piece: an indexed triangle list whose corners all
 *  sample the same texture. */
export interface UnitModelGroup {
  /** Which {@link UnitModelResult.textures} entry this batch samples. Absent for
   *  a `.3do` face that named no texture at all and whose Total Annihilation
   *  palette entry could not be resolved to a real colour either. */
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
  /** A `.3do` face named no texture at all and named this entry of the Total
   *  Annihilation palette (`unittextures/tatex/palette.pal`) instead. `name` is
   *  a synthetic key, one per palette entry the model actually uses, rather
   *  than anything the model file stores. */
  paletteColour?: [number, number, number];
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
  /** Faces a `.3do` names no texture for and whose Total Annihilation palette
   *  entry could not be resolved, because `unittextures/tatex/palette.pal` was
   *  not found in the archive or the entry named is outside the 256 it holds.
   *  Drawn plain grey, so the count is worth showing. A face whose entry did
   *  resolve is drawn in its real colour and is not counted here. */
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
export const unitsyncUnitModels = (args: UnitModelsArgs) =>
  unitModelsCommand(withGameArchivePath(args));
type UnitModelsArgs = GameReadArgs & { objects: string[] };
const unitModelsCommand = defineCommand<UnitModelsArgs, UnitModelsResult>(
  "coilbox-unitsync",
  "unitsync_unit_models",
);

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

/** One sample as a map catalog walk works through the library, per map read
 *  rather than once at the end (issue #3147). */
export interface MapCatalogProgress {
  done: number;
  total: number;
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
 *
 * `onProgress` takes a sample per map as the walk reads it, so a library that
 * takes tens of seconds to hash is not a window that sits at zero the whole
 * time.
 */
export const unitsyncMapCatalog = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    /** The maps to read. Absent walks the whole library. */
    maps?: string[];
    keysOnly: boolean;
    onProgress: Channel<MapCatalogProgress>;
  },
  MapCatalogResult
>("coilbox-unitsync", "unitsync_map_catalog");

/** A map's minimap encoded as the asset the hub takes, written to disk. Same
 *  shape as {@link UnitBuildpicAsset} without the archive member, since a map
 *  layer is produced from the map file rather than read out of one. */
export interface MapMinimapAsset {
  /** Always `minimap`. */
  variant: string;
  /** Always `extracted`, against `rendered` for a picture coilbox drew. */
  origin: string;
  /** The name the map's archive declares for itself. */
  sourceArchive: string;
  /** Absolute path to the encoded file. */
  path: string;
  /** sha256 of the encoded bytes. */
  hash: string;
  /** sha256 over the texture unitsync handed over, which is what the have check
   *  compares on and what the survey pass already knew. */
  sourceHash: string;
  encodeProfile: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}

/** One map in a minimap walk: what a have check asks about, and the encoded
 *  picture when this pass was the one that sends. */
export interface MapMinimapRow {
  /** unitsync's versioned name, which is the whole of a map asset's key
   *  alongside the variant. */
  mapName: string;
  sourceHash: string;
  sourceArchive: string;
  /** The map's size in elmos, which the hub requires on a map row. */
  mapWidth: number;
  mapHeight: number;
  /** Absent on a survey pass. */
  asset?: MapMinimapAsset;
}

/** Why a map produced no row. The first seven are one picture's reasons and the
 *  last three are about the walk. */
export type MapMinimapSkip =
  | "no-source"
  | "blank"
  | "read-failed"
  | "no-bounds"
  | "encode-failed"
  | "too-large"
  | "not-written"
  | "no-extent"
  | "working-folder"
  | "duplicate-map";

export interface MapMinimapsResult {
  maps: MapMinimapRow[];
  skipped: { mapName: string; reason: MapMinimapSkip }[];
  errors: string[];
}

/**
 * Name what every installed map's minimap would be called, and with `assets`
 * encode the pictures themselves (issue #2379).
 *
 * Two passes, and the caller picks which, the same shape
 * {@link unitsyncMapCatalog} takes. A minimap's identity is over the texture
 * unitsync produces rather than over the encoded bytes, so it is knowable before
 * anything is encoded, which is what lets the hub be asked first. `maps` then
 * names the ones it wanted.
 *
 * One call is one session however many maps it covers, and what the survey read
 * is cached on file identity, so a second sweep over an unchanged library reads
 * no textures at all.
 */
export const unitsyncMapMinimaps = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    /** The maps to read. Absent walks the whole library. */
    maps?: string[];
    /** Encode and write each one, rather than only naming it. */
    assets?: boolean;
  },
  MapMinimapsResult
>("coilbox-unitsync", "unitsync_map_minimaps");

export interface MapInfoResult {
  options: ConfigOption[];
  checksum?: string;
  warnings?: string[];
  errors?: string[];
}

/**
 * Load a map's options + warnings — lazy, since it mounts the map's archive.
 */
export const unitsyncMapInfo = (args: MapReadArgs) =>
  mapInfoCommand(withMapHint(args));
const mapInfoCommand = defineCommand<MapReadArgs, MapInfoResult>(
  "coilbox-unitsync",
  "unitsync_map_info",
);

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
export const unitsyncSkirmishAis = (args: SkirmishAisArgs) =>
  skirmishAisCommand(
    args.gameArchive
      ? withGameArchivePath({ ...args, gameArchive: args.gameArchive })
      : args,
  );
const skirmishAisCommand = defineCommand<SkirmishAisArgs, SkirmishAisResult>(
  "coilbox-unitsync",
  "unitsync_skirmish_ais",
);

export interface ScanResult {
  maps: MapItem[];
  games: GameItem[];
  /** Non-fatal diagnostics drained from unitsync during the scan. */
  errors: string[];
  /**
   * Set when unitsync's `Init` failed (a full disk, say): the lists above are
   * then empty or partial, and say nothing about what is installed. The engine's
   * reason for the failure.
   */
  initFailure?: string;
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

/**
 * The scan last saved for a target, or null when there is none, it is unreadable
 * or it is from another format version. A first paint only: it can name an
 * archive deleted since.
 */
export const unitsyncLastScanRead = defineCommand<
  { enginePath: string; dataDir: string },
  ScanResult | null
>("coilbox-unitsync", "unitsync_last_scan_read");

/** Save a scan that succeeded as the target's first paint at the next launch. */
export const unitsyncLastScanWrite = defineCommand<
  { enginePath: string; dataDir: string; scan: ScanResult },
  null
>("coilbox-unitsync", "unitsync_last_scan_write");

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
export const unitsyncMinimap = (args: MinimapArgs) =>
  minimapCommand(withMapHint(args));
type MinimapArgs = MapReadArgs & { mip?: number };
const minimapCommand = defineCommand<MinimapArgs, MinimapResult>(
  "coilbox-unitsync",
  "unitsync_minimap",
);

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
export const unitsyncHeightmap = (args: MapReadArgs) =>
  heightmapCommand(withMapHint(args));
const heightmapCommand = defineCommand<MapReadArgs, HeightmapResult>(
  "coilbox-unitsync",
  "unitsync_heightmap",
);

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
export const unitsyncMapSkybox = (args: MapReadArgs) =>
  mapSkyboxCommand(withMapHint(args));
const mapSkyboxCommand = defineCommand<MapReadArgs, MapSkyboxResult>(
  "coilbox-unitsync",
  "unitsync_map_skybox",
);

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

type ThumbnailsArgs = {
  enginePath: string;
  dataDir: string;
  mip?: number;
  opId?: string;
  maps?: MapRef[];
};

/**
 * Render a small minimap thumbnail for every map in one unitsync session (for the
 * Maps grid). `mip` selects resolution: `1024 >> mip` px (default 3 = 128px).
 * `maps` lists every map of the last scan, filled in from it. The plugin answers
 * from the disk cache only when every listed map has a saved answer.
 */
export const unitsyncThumbnails = (args: ThumbnailsArgs) =>
  thumbnailsCommand(withMapRefs(args));
const thumbnailsCommand = defineCommand<ThumbnailsArgs, ThumbnailsResult>(
  "coilbox-unitsync",
  "unitsync_thumbnails",
);

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

type MapMetaArgs = {
  enginePath: string;
  dataDir: string;
  opId?: string;
  maps?: MapRef[];
};

/**
 * Read every map's mapinfo metadata in one session. Kept out of the scan because
 * it opens each map's archive, and only the map detail page and the singleplayer
 * map card read it. Disk-cached per map by the worker. `maps` is filled in from
 * the last scan like {@link unitsyncThumbnails}.
 */
export const unitsyncMapMeta = (args: MapMetaArgs) =>
  mapMetaCommand(withMapRefs(args));
const mapMetaCommand = defineCommand<MapMetaArgs, MapMetaResult>(
  "coilbox-unitsync",
  "unitsync_map_meta",
);

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

type ArchiveTreeArgs = {
  enginePath: string;
  dataDir: string;
  archive: string;
  archivePath?: string;
  fileName?: string;
};

/**
 * List one archive's member tree (and resolve its on-disk path). Reads through
 * unitsync's VFS, so `.sd7`/`.sdz`/`.sdd` and rapid-pool `.sdp` packages all
 * work. `archive` is the archive name as unitsync knows it. When it is a game's
 * primary archive or a map's name from the last scan, the archive path and map
 * file name are filled in so the plugin can answer from the disk cache.
 */
export const unitsyncArchiveTree = (args: ArchiveTreeArgs) =>
  archiveTreeCommand(withArchiveTreeHint(args));
const archiveTreeCommand = defineCommand<ArchiveTreeArgs, ArchiveTreeResult>(
  "coilbox-unitsync",
  "unitsync_archive_tree",
);

export interface ArchiveFileResult {
  /** `"text"`, `"image"`, `"audio"`, or `"binary"`. */
  kind: "text" | "image" | "audio" | "binary";
  /** Decoded contents, when `kind === "text"`. */
  text?: string;
  /** `data:` URL, when `kind === "image"` or `kind === "audio"`, or a raw read. */
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
  {
    enginePath: string;
    dataDir: string;
    archive: string;
    file: string;
    /**
     * Return the member's own bytes as an `application/octet-stream` data URL
     * in `dataUrl`, with no preview cap or transcode. A member past the raw
     * cap comes back `truncated` with no bytes.
     */
    raw?: boolean;
  },
  ArchiveFileResult
>("coilbox-unitsync", "unitsync_archive_file");

export interface GameHeadersResult {
  /** Header art per game. Both fields are absent when the game has no usable
   * art. `file` is the cache file name, served over `coilbox://unitsyncheader/`,
   * and `dataUrl` only appears when the art never reached the cache. */
  headers: { name: string; file?: string; dataUrl?: string }[];
  errors: string[];
}

type GameHeadersArgs = {
  enginePath: string;
  dataDir: string;
  games?: GameRef[];
};

/**
 * Resolve loading-screen art for every game in one unitsync session (for the
 * Games grid). Keyed on cheap file identity and disk-cached by the worker, so it
 * stays cheap on later launches. Games with no usable art come back with neither
 * a `file` nor a `dataUrl`, and the UI shows a gradient placeholder. `games`
 * lists every game of the last scan, filled in from it. The plugin answers from
 * the disk cache only when every listed game has a saved answer.
 */
export const unitsyncGameHeaders = (args: GameHeadersArgs) =>
  gameHeadersCommand(withGameRefs(args));
const gameHeadersCommand = defineCommand<GameHeadersArgs, GameHeadersResult>(
  "coilbox-unitsync",
  "unitsync_game_headers",
);

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

/** One line the 3do conversion prints as it works. */
export interface Convert3doProgress {
  /** `scan` once the models have been counted, `atlas` while a folder's sheet
   * is being built, `model` per model converted. */
  phase: "scan" | "atlas" | "model";
  done: number;
  total: number;
  /** The archive folder being worked on, empty during the scan. */
  folder: string;
  /** The archive member being converted, empty outside the `model` phase. */
  member: string;
}

/** A tile the archive holds that coilbox could not decode. */
export interface Convert3doUndecodable {
  member: string;
  wantedBy: number;
}

/** One model folder's sheet, and what happened to the models sharing it. */
export interface Convert3doGroup {
  folder: string;
  /** The sheet's path inside the output folder. */
  atlas: string;
  /** And the name the converted models give it, resolved under `unittextures/`. */
  texture1: string;
  atlasSide: number;
  /** True when an earlier run's sheet was kept, which is what stops a repack
   * moving every tile out from under the models it already wrote. */
  reusedAtlas: boolean;
  tilesPacked: number;
  /** Tiles that would not fit on a sheet the size cap allows. */
  tilesThatDidNotFit: string[];
  /** Tile names nothing in the archive matched, and how many models wanted each. */
  missingTextures: Record<string, number>;
  /** Tile names the archive holds that would not decode. */
  undecodableTextures: Record<string, Convert3doUndecodable>;
  modelsWritten: number;
  /** Models left unconverted because a tile they name did not fit. */
  didNotFit: string[];
  /** Faces drawn flat grey because their palette entry resolved to nothing. */
  paletteFaces: number;
  paletteModels: string[];
  /** Faces drawn flat grey because their named tile is not on the sheet. */
  missingTextureFaces: number;
  vertices: number;
  triangles: number;
  droppedPieces: number;
}

export interface Convert3doResult {
  outDir: string;
  groups: Convert3doGroup[];
  /** Models the reader refused, by archive member, with what it said. Apart from
   * the ones that did not fit: this is a file coilbox cannot read, and that is a
   * file it read fine and had nowhere to paint. */
  unreadable: Record<string, string>;
  modelsFound: number;
  modelsWritten: number;
  errors: string[];
}

/**
 * Turn every `.3do` in a game into an `.s3o`, one shared texture per folder
 * under `objects3d/`, written into `outDir` (issue #2573).
 *
 * Progress arrives on `onProgress` as the run works rather than with the
 * answer, because a game is hundreds of models and a window that sits still is
 * a window nobody can tell from a hung one. `opId` is the handle
 * `unitsyncCancel` stops it by, and a cancelled run keeps whatever it had
 * already written.
 */
export const unitsyncConvert3do = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    archive: string;
    outDir: string;
    opId?: string;
    onProgress: Channel<Convert3doProgress>;
  },
  Convert3doResult
>("coilbox-unitsync", "unitsync_convert_3do");
