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

/** Every human player, by games played (descending), for the profile selector. */
export function allPlayers(
  records: StatRecord[],
): { name: string; games: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const p of r.players) {
      if (p.spectator) continue;
      counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, games]) => ({ name, games }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}

/** The most-played player name — the profile's default "me". */
export function guessPrimaryPlayer(records: StatRecord[]): string | undefined {
  return allPlayers(records)[0]?.name;
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

/** Aggregate one player's full profile from the record set. */
export function profileFor(records: StatRecord[], name: string): PlayerProfile {
  const games = gamesFor(records, name);
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
  };
}
