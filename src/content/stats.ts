import type { StatRecord } from "./bindings";

/**
 * Pure aggregations over the local stats record set (see `stats.rs`). Each stats
 * view is a thin projection over the same flat table; these helpers back the
 * personal profile today and are the shared shape #375's head-to-head will reuse.
 *
 * A player is identified by their in-game name. The start-script only lists human
 * players (`[playerN]`), so AI opponents don't appear here — win/loss still comes
 * from the recorded winning ally-teams.
 */

/** One player's game from their point of view. */
interface PlayerGame {
  record: StatRecord;
  /** The side (faction) the player used, when known. */
  side?: string;
  /** True/false when the game was decided; undefined when the result is unknown. */
  won?: boolean;
}

/**
 * Why a record is a synthetic rerun rather than a genuine match, or `undefined`
 * when it counts. Two independent signals (#466): a coilbox remix stamped
 * in-file by `demo::rewrite_demo` (`record.remixed`, issue #367 — read fresh on
 * every ingest, so it also corrects records ingested before this change), or a
 * "refight this setup" rerun (issue #368), tagged best-effort by filename in
 * `content.replayState` (`ReplayProvenance.mode === "refight"`) since that
 * provenance lives outside the Rust stats store.
 */
function excludedReasonFor(
  record: StatRecord,
  refightFilenames: ReadonlySet<string>,
): "remix" | "refight" | undefined {
  if (record.remixed) return "remix";
  if (refightFilenames.has(record.filename)) return "refight";
  return undefined;
}

/** True when `record` is a genuine match that should count toward the aggregates. */
export function isGenuineMatch(
  record: StatRecord,
  refightFilenames: ReadonlySet<string>,
): boolean {
  return excludedReasonFor(record, refightFilenames) === undefined;
}

/** Drop remixed/refought records, keeping only genuine matches for the aggregates. */
function excludeSyntheticReruns(
  records: StatRecord[],
  refightFilenames: ReadonlySet<string>,
): StatRecord[] {
  return records.filter((r) => isGenuineMatch(r, refightFilenames));
}

/** Every non-spectator appearance of `name`, chronological (oldest first). */
function gamesFor(records: StatRecord[], name: string): PlayerGame[] {
  const out: PlayerGame[] = [];
  for (const record of records) {
    const me = record.players.find((p) => !p.spectator && p.name === name);
    if (!me) continue;
    out.push({
      record,
      side: me.side,
      won: record.winnersKnown ? (me.won ?? undefined) : undefined,
    });
  }
  out.sort((a, b) => a.record.startTimeMs - b.record.startTimeMs);
  return out;
}

/**
 * Every human player, by games played (descending), for the profile selector.
 * `refightFilenames` excludes remix/refight reruns (#466) — see
 * `excludedReasonFor`.
 */
export function allPlayers(
  records: StatRecord[],
  refightFilenames: ReadonlySet<string> = new Set(),
): { name: string; games: number }[] {
  const counts = new Map<string, number>();
  for (const r of excludeSyntheticReruns(records, refightFilenames)) {
    for (const p of r.players) {
      if (p.spectator) continue;
      counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, games]) => ({ name, games }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/**
 * Narrow an {@link allPlayers} list to names matching a search query
 * (case-insensitive substring), for the player stats picker (#496). Preserves
 * the input order. An empty/whitespace query returns the full list.
 */
export function filterPlayers<T extends { name: string }>(
  players: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return players;
  return players.filter((p) => p.name.toLowerCase().includes(q));
}

/** The most-played player name, the profile's default "me". */
export function guessPrimaryPlayer(
  records: StatRecord[],
  refightFilenames: ReadonlySet<string> = new Set(),
): string | undefined {
  return allPlayers(records, refightFilenames)[0]?.name;
}

/** A map or faction tally within a player's history. */
export interface Tally {
  key: string;
  games: number;
  wins: number;
}

/** An aggregated personal profile for one player. */
export interface PlayerProfile {
  name: string;
  /** Non-spectator games played. */
  games: number;
  /** Games with a known result. */
  decided: number;
  wins: number;
  losses: number;
  /** wins / decided, or null when no game has a known result. */
  winRate: number | null;
  /** Signed run of the most recent decided games: positive wins, negative losses. */
  currentStreak: number;
  longestWinStreak: number;
  /** Maps played, most-played first. */
  favouriteMaps: Tally[];
  /** Factions used, most-used first. */
  factions: Tally[];
  /** Most recent game's start time, or 0 with no games. */
  lastPlayedMs: number;
}

/** Tally games + wins by a key extractor, dropping empty keys. */
function tally(games: PlayerGame[], keyOf: (g: PlayerGame) => string): Tally[] {
  const map = new Map<string, Tally>();
  for (const g of games) {
    const key = keyOf(g);
    if (!key) continue;
    const t = map.get(key) ?? { key, games: 0, wins: 0 };
    t.games += 1;
    if (g.won === true) t.wins += 1;
    map.set(key, t);
  }
  return [...map.values()].sort(
    (a, b) => b.games - a.games || a.key.localeCompare(b.key),
  );
}

/** Longest run of consecutive wins across the decided games (chronological). */
function longestWinRun(games: PlayerGame[]): number {
  let best = 0;
  let run = 0;
  for (const g of games) {
    if (g.won === undefined) continue;
    run = g.won ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * The current streak: the most recent unbroken run of the same result among
 * decided games. Positive = that many straight wins, negative = straight losses.
 */
function currentStreak(games: PlayerGame[]): number {
  const decided = games.filter((g) => g.won !== undefined);
  let streak = 0;
  for (let i = decided.length - 1; i >= 0; i--) {
    const won = decided[i].won === true;
    if (streak === 0) streak = won ? 1 : -1;
    else if (won && streak > 0) streak += 1;
    else if (!won && streak < 0) streak -= 1;
    else break;
  }
  return streak;
}

/**
 * Aggregate one player's full profile from the record set, excluding
 * remix/refight reruns (#466) via `refightFilenames`.
 */
export function profileFor(
  records: StatRecord[],
  name: string,
  refightFilenames: ReadonlySet<string> = new Set(),
): PlayerProfile {
  const games = gamesFor(
    excludeSyntheticReruns(records, refightFilenames),
    name,
  );
  const decided = games.filter((g) => g.won !== undefined);
  const wins = decided.filter((g) => g.won === true).length;
  const losses = decided.length - wins;
  return {
    name,
    games: games.length,
    decided: decided.length,
    wins,
    losses,
    winRate: decided.length ? wins / decided.length : null,
    currentStreak: currentStreak(games),
    longestWinStreak: longestWinRun(games),
    favouriteMaps: tally(games, (g) => g.record.mapName),
    factions: tally(games, (g) => g.side ?? ""),
    lastPlayedMs: games.length ? games[games.length - 1].record.startTimeMs : 0,
  };
}

/** A player's record on one map or with one faction: games, win rate (when
 * decided), and when they last played it. */
export interface ScopedRecord {
  /** Non-spectator games played, including undecided ones. */
  games: number;
  /** Games with a known result. */
  decided: number;
  wins: number;
  losses: number;
  /** wins / decided, or null when no game in scope has a known result. */
  winRate: number | null;
  /** Most recent game's start time, or 0 with no games. */
  lastPlayedMs: number;
}

function scopedRecord(games: PlayerGame[]): ScopedRecord {
  const decided = games.filter((g) => g.won !== undefined);
  const wins = decided.filter((g) => g.won === true).length;
  return {
    games: games.length,
    decided: decided.length,
    wins,
    losses: decided.length - wins,
    winRate: decided.length ? wins / decided.length : null,
    lastPlayedMs: games.length ? games[games.length - 1].record.startTimeMs : 0,
  };
}

/** One player's record on a single map (#460), plus the faction they favour there. */
export interface MapRecord extends ScopedRecord {
  /** The most-used faction on this map, or null when no faction is recorded. */
  favouriteFaction: Tally | null;
}

/**
 * `playerName`'s record on `mapName` (#460): a thin filter of the same
 * per-player game history `profileFor` builds, scoped to one map. Backs the
 * map detail page's "Your record" card. `refightFilenames` excludes
 * remix/refight reruns (#466), matching every other aggregate here.
 */
export function mapRecordFor(
  records: StatRecord[],
  mapName: string,
  playerName: string,
  refightFilenames: ReadonlySet<string> = new Set(),
): MapRecord {
  const games = gamesFor(
    excludeSyntheticReruns(records, refightFilenames),
    playerName,
  ).filter((g) => g.record.mapName === mapName);
  return {
    ...scopedRecord(games),
    favouriteFaction: tally(games, (g) => g.side ?? "")[0] ?? null,
  };
}

/** One player's record with a single faction (#460). */
export interface FactionRecord extends ScopedRecord {
  faction: string;
}

/**
 * `playerName`'s record with each of `factionNames` (#460), one entry per
 * requested faction in the same order. Includes factions they've never
 * played, with `games: 0` and `winRate: null`, so a caller can render "no
 * games recorded" rather than silently dropping the row. Backs the game
 * detail page's per-faction records, scoped to that game's own sides.
 * `refightFilenames` excludes remix/refight reruns (#466).
 */
export function factionRecordsFor(
  records: StatRecord[],
  factionNames: string[],
  playerName: string,
  refightFilenames: ReadonlySet<string> = new Set(),
): FactionRecord[] {
  const games = gamesFor(
    excludeSyntheticReruns(records, refightFilenames),
    playerName,
  );
  return factionNames.map((faction) => ({
    faction,
    ...scopedRecord(games.filter((g) => g.side === faction)),
  }));
}

/**
 * `me`'s relationship to one other player across the record set (#375): every
 * game they've shared, split into "together" (same ally team) and "against"
 * (opposing ally team) — the shared-lobby view a #414 profile alone doesn't
 * give. Backs both the player dossier and the multiplayer user popover's "N
 * games with this player" line.
 */
export interface PlayerRelation {
  name: string;
  /** Every non-spectator game where both `me` and `name` played. */
  gamesShared: number;
  /** Subset of shared games where they were on the same ally team. */
  gamesTogether: number;
  /** `me`'s wins among `gamesTogether`. */
  winsTogether: number;
  /** Subset of shared games where they were on opposing ally teams. */
  gamesAgainst: number;
  /** `me`'s wins among `gamesAgainst`. */
  winsAgainst: number;
  /** Most recent shared game's start time, or 0 when they've never played together. */
  lastPlayedMs: number;
  /** Maps shared, most-played first (wins are `me`'s wins). */
  commonMaps: Tally[];
}

/** One replay `name` appeared in, for the dossier's replay list. */
export interface PlayerReplay {
  filename: string;
  mapName: string;
  gameType: string;
  startTimeMs: number;
  /** True/false when the game was decided; undefined when the result is unknown. */
  won?: boolean;
  /**
   * Set when this replay is a remix or refight rerun (#466) — still listed
   * here for visibility, but excluded from every other aggregate.
   */
  excludedReason?: "remix" | "refight";
}

/**
 * Every replay `name` appears in, most-recent-first. Unlike the other
 * aggregates, remix/refight reruns are kept (not filtered) so the dossier's
 * replay list stays a complete history — but each is flagged via
 * `excludedReason` so the UI can mark it as not counting.
 */
export function replaysFor(
  records: StatRecord[],
  name: string,
  refightFilenames: ReadonlySet<string> = new Set(),
): PlayerReplay[] {
  return gamesFor(records, name)
    .map((g) => ({
      filename: g.record.filename,
      mapName: g.record.mapName,
      gameType: g.record.gameType,
      startTimeMs: g.record.startTimeMs,
      won: g.won,
      excludedReason: excludedReasonFor(g.record, refightFilenames),
    }))
    .sort((a, b) => b.startTimeMs - a.startTimeMs);
}

/**
 * Aggregate `me`'s history with `other`: every record where both appeared as
 * non-spectators. A game only counts toward the together/against split when
 * both ally teams are known — an unknown ally team still counts toward
 * `gamesShared`, `commonMaps`, and `lastPlayedMs`. `refightFilenames` excludes
 * remix/refight reruns (#466).
 */
export function relationTo(
  records: StatRecord[],
  me: string,
  other: string,
  refightFilenames: ReadonlySet<string> = new Set(),
): PlayerRelation {
  const shared: PlayerGame[] = [];
  let gamesTogether = 0;
  let winsTogether = 0;
  let gamesAgainst = 0;
  let winsAgainst = 0;
  let lastPlayedMs = 0;

  for (const record of excludeSyntheticReruns(records, refightFilenames)) {
    const mine = record.players.find((p) => !p.spectator && p.name === me);
    const theirs = record.players.find((p) => !p.spectator && p.name === other);
    if (!mine || !theirs) continue;

    const won = record.winnersKnown ? (mine.won ?? undefined) : undefined;
    shared.push({ record, side: mine.side, won });
    if (record.startTimeMs > lastPlayedMs) lastPlayedMs = record.startTimeMs;

    if (mine.allyTeam == null || theirs.allyTeam == null) continue;
    if (mine.allyTeam === theirs.allyTeam) {
      gamesTogether += 1;
      if (won === true) winsTogether += 1;
    } else {
      gamesAgainst += 1;
      if (won === true) winsAgainst += 1;
    }
  }

  return {
    name: other,
    gamesShared: shared.length,
    gamesTogether,
    winsTogether,
    gamesAgainst,
    winsAgainst,
    lastPlayedMs,
    commonMaps: tally(shared, (g) => g.record.mapName),
  };
}
