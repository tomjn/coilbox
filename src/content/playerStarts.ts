/**
 * Which named start positions one player took, and how those matches went
 * (#3883).
 *
 * It is the map page's join (`joinStarts`, `placeRecords`) kept to the starts
 * of the engine teams the player held, then named with the player's own names
 * for the map (`resolveNames`). The starts come from the replays the player
 * took part in, so a position is grouped from their starts alone. A declared
 * position is found the same way as on the map's page. A group can sit a little
 * differently from the page, and a stored name finds it by its nearest centre
 * within the grouping distance, as it does when more matches are added.
 *
 * Counts only, as on the map page: "won 4 of 6".
 */

import type { StatRecord } from "./bindings";
import {
  type AggregateMatch,
  mapMatches,
  type ReplayCounts,
} from "./mapAggregate";
import { joinStarts, type Point, placeRecords } from "./mapRecords";
import type { MapWorld } from "./replayMapLayers";
import {
  type NameBook,
  resolveNames,
  type StartRow,
  type StoredName,
  startRows,
} from "./startNames";

/**
 * The player's matches on one map, by its exact name.
 *
 * The same matches the map's page draws from: a remix or a refight is left out
 * and one match in two files is counted once. A match on another version of the
 * map is left out, because the names belong to the exact name.
 */
export function playerMatchesOn(
  records: readonly StatRecord[],
  mapName: string,
  playerName: string,
  refights: ReadonlySet<string>,
): AggregateMatch[] {
  return mapMatches(records, mapName, new Map(), refights).matches.filter(
    (m) =>
      m.record.mapName === mapName &&
      m.record.players.some((p) => p.name === playerName && !p.spectator),
  );
}

/**
 * The maps the player has played that have names for their start positions,
 * with the matches on each. Most played first.
 */
export function namedMapsOf(
  records: readonly StatRecord[],
  playerName: string,
  refights: ReadonlySet<string>,
  book: NameBook,
): { mapName: string; matches: AggregateMatch[] }[] {
  const candidates = new Set(
    records
      .filter((r) => (book[r.mapName]?.length ?? 0) > 0)
      .map((r) => r.mapName),
  );
  return [...candidates]
    .map((mapName) => ({
      mapName,
      matches: playerMatchesOn(records, mapName, playerName, refights),
    }))
    .filter((m) => m.matches.length > 0)
    .sort(
      (a, b) =>
        b.matches.length - a.matches.length ||
        a.mapName.localeCompare(b.mapName),
    );
}

export interface PlayerStarts {
  /** The named positions the player took, most taken first. A position with no
   *  name is in no row. */
  rows: StartRow[];
  /** Matches where a start of the player's team was found. */
  placed: number;
  /** Starts of the player's teams at a position with no name. */
  unnamed: number;
}

/** The engine teams a player held in a match. Spectators held none. */
function teamsHeld(match: AggregateMatch, playerName: string): Set<number> {
  const teams = new Set<number>();
  for (const p of match.record.players)
    if (p.name === playerName && !p.spectator && p.team !== undefined)
      teams.add(p.team);
  return teams;
}

/**
 * The named positions a player took on one map.
 *
 * `matches` are the player's matches on that exact map name, because a name is
 * stored for the exact name only and a version of a map can move its
 * positions. `declared` and `world` are the map's own, as the map page has them.
 */
export function playerStarts(
  matches: readonly AggregateMatch[],
  playerName: string,
  counts: ReadonlyMap<string, ReplayCounts>,
  declared: readonly Point[],
  world: MapWorld,
  stored: readonly StoredName[],
): PlayerStarts {
  const held = new Map(
    matches.map((m) => [m.record.filename, teamsHeld(m, playerName)] as const),
  );
  const joined = joinStarts(matches, counts);
  const mine = joined.starts.filter((s) => held.get(s.filename)?.has(s.team));
  const records = placeRecords(mine, declared, world);
  const resolved = resolveNames(
    stored,
    records.places.map((p) => p.place),
    records.scale,
  );
  const all = startRows(
    records.places,
    new Map([...resolved.byPlace].map(([key, e]) => [key, e.name])),
  );
  const rows = all.filter((r) => r.name !== null);
  return {
    rows,
    placed: new Set(mine.map((s) => s.filename)).size,
    unnamed: all.reduce((n, r) => (r.name === null ? n + r.taken : n), 0),
  };
}
