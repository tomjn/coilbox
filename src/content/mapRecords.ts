/**
 * What the library knows about one map, as counts (#1162, #1163).
 *
 * The matches are the ones the map's picture is drawn from, after the same
 * filters. This file joins each match's start positions, which come from the
 * replay's stream, to its result, which comes from the trailer, and counts.
 * Nothing here is a percentage. A figure is "won 3 of 5" so the size of the
 * sample is always beside it, and no sample is too small to show.
 *
 * Words. A team here is a side, as the replay page says "Team 1". An engine
 * team is one army, and a start position belongs to the player or players who
 * control that army. A faction is what the replay's script calls a side.
 */

import { DEFAULT_RADIUS_FRACTION } from "@/lib/heatField";
import type { StatRecord } from "./bindings";
import type { AggregateMatch, MatchFormat, ReplayCounts } from "./mapAggregate";
import type { MapWorld } from "./replayMapLayers";

export interface Point {
  x: number;
  z: number;
}

// ---- assigning a start to a position the map declares -----------------------

/**
 * How near a start must be to a declared position to be at it: half the
 * smallest distance between two declared positions.
 *
 * That is the largest radius at which no start can be near two positions, so
 * "the nearest one" is never a coin toss. It is derived from the map and not a
 * number of elmos, so a small map and a large one each get their own. Two
 * declared positions at the same place are one position for this. Null when the
 * map declares fewer than two distinct positions, because one position has no
 * distance to halve and nothing then says how near is near.
 */
export function declaredTolerance(declared: readonly Point[]): number | null {
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < declared.length; i++)
    for (let j = i + 1; j < declared.length; j++) {
      const d = Math.hypot(
        declared[i].x - declared[j].x,
        declared[i].z - declared[j].z,
      );
      if (d > 0 && d < smallest) smallest = d;
    }
  return Number.isFinite(smallest) ? smallest / 2 : null;
}

/**
 * The index of the declared position a start is at, or null when it is at none.
 *
 * Strictly inside the tolerance, so a start exactly midway between the two
 * closest positions is at neither. That is the one place "nearest" would be a
 * tie, and it is left unassigned and not guessed.
 */
export function nearestDeclared(
  start: Point,
  declared: readonly Point[],
  tolerance: number | null,
): number | null {
  if (tolerance === null) return null;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  declared.forEach((d, i) => {
    const distance = Math.hypot(start.x - d.x, start.z - d.z);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best >= 0 && bestDistance < tolerance ? best : null;
}

// ---- grouping starts that are free to land anywhere -------------------------

/**
 * The distance within which two starts are the same position, as a fraction of
 * the map's shorter side. It is the heat field's own grain, so a position here
 * is the same size as a patch in the density layers.
 *
 * This is a display choice with no measurement behind it. At that grain "an
 * opening's buildings merge into one patch per base and two bases stay apart"
 * (`heatField.ts`), and a hundred elmos on a large map is well inside it.
 * Nothing measured says it suits every map. On a map where players spread
 * their starts evenly through a box it chains them into one wide group, which
 * the table shows as a large radius rather than hiding.
 */
export const CLUSTER_SCALE_FRACTION = DEFAULT_RADIUS_FRACTION;

/** The scale for one map in elmos, or null when the map has no size. */
export function clusterScale(world: MapWorld): number | null {
  if (!(world.worldWidth > 0) || !(world.worldHeight > 0)) return null;
  return Math.min(world.worldWidth, world.worldHeight) * CLUSTER_SCALE_FRACTION;
}

export interface StartCluster {
  /**
   * Where the group is, as the cell its centre falls in, on a grid of squares
   * `scale` elmos across: `c3:7`. A name stored against this key finds its
   * group again as matches are added, as long as the centre stays in its cell.
   * Two groups whose centres share a cell take `.2`, `.3` in order of place.
   */
  key: string;
  /** The mean of the group's starts, in elmos. */
  x: number;
  z: number;
  /** The distance from the centre to the farthest start in it. */
  radius: number;
  /** Indexes into the points given, in ascending order. */
  members: number[];
}

/**
 * Group starts so that any two within `scale` of each other, directly or
 * through others, are in one group (single linkage).
 *
 * It depends on the set of starts and nothing else. The points are put in a
 * fixed order before anything is decided, so the same starts in any order give
 * the same groups, centres and keys. Adding a start never splits a group: it
 * joins one, joins two into one, or starts its own, so a group's key moves only
 * when its centre crosses into another cell.
 */
export function clusterStarts(
  points: readonly Point[],
  scale: number,
): StartCluster[] {
  const order = points
    .map((_, i) => i)
    .sort(
      (a, b) => points[a].x - points[b].x || points[a].z - points[b].z || a - b,
    );
  const parent = order.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const up = parent[i];
      parent[i] = root;
      i = up;
    }
    return root;
  };
  for (let a = 0; a < order.length; a++)
    for (let b = a + 1; b < order.length; b++) {
      const p = points[order[a]];
      const q = points[order[b]];
      if (q.x - p.x > scale) break;
      if (Math.hypot(q.x - p.x, q.z - p.z) <= scale) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }

  const groups = new Map<number, number[]>();
  order.forEach((index, rank) => {
    const root = find(rank);
    const list = groups.get(root);
    if (list) list.push(index);
    else groups.set(root, [index]);
  });

  const clusters = [...groups.values()].map((members) => {
    // Summed in the fixed order, so rounding cannot differ between runs.
    let x = 0;
    let z = 0;
    for (const m of members) {
      x += points[m].x;
      z += points[m].z;
    }
    x /= members.length;
    z /= members.length;
    let radius = 0;
    for (const m of members)
      radius = Math.max(radius, Math.hypot(points[m].x - x, points[m].z - z));
    return {
      x,
      z,
      radius,
      members: members.sort((a, b) => a - b),
    };
  });
  clusters.sort((a, b) => a.x - b.x || a.z - b.z);

  const seen = new Map<string, number>();
  return clusters.map((c) => {
    const cell = `c${Math.floor(c.x / scale)}:${Math.floor(c.z / scale)}`;
    const n = (seen.get(cell) ?? 0) + 1;
    seen.set(cell, n);
    return { ...c, key: n === 1 ? cell : `${cell}.${n}` };
  });
}

// ---- joining a start to a result --------------------------------------------

export type StartOutcome = "won" | "lost" | "no-result";

/** One team's start in one match, joined to how that match went for it. */
export interface JoinedStart extends Point {
  filename: string;
  /** The engine team. */
  team: number;
  /** The side the team was on. */
  allyTeam: number;
  /**
   * 1 or 2 when the match was two sides, numbered in order of ally team, and
   * null for any other arrangement, where there is no pair of sides to number.
   */
  side: 1 | 2 | null;
  outcome: StartOutcome;
  /** Every seat on the team is a skirmish AI. */
  byAi: boolean;
}

export interface JoinedStarts {
  starts: JoinedStart[];
  /** Matches that were joined, with at least one start in the list. */
  joined: number;
  /** Matches whose record carries no team ids, which a start cannot be joined
   *  through. They are left out whole. */
  noTeamIds: number;
  /** Starts in a match with team ids where no seat holds the start's team. */
  noSeat: number;
  /** Matches whose replay recorded no start. */
  noStarts: number;
  /** Matches whose replay has not been read yet, or could not be. */
  unread: number;
}

interface Seat {
  team?: number;
  allyTeam?: number;
  ai: boolean;
}

function seatsOf(record: StatRecord): Seat[] {
  return [
    ...record.players
      .filter((p) => !p.spectator)
      .map((p) => ({ team: p.team, allyTeam: p.allyTeam, ai: false })),
    ...record.ais.map((a) => ({
      team: a.team,
      allyTeam: a.allyTeam,
      ai: true,
    })),
  ];
}

/**
 * Join each start to its result through the engine team id, then the side.
 *
 * A start belongs to an engine team, a team belongs to a side, and a side won
 * or lost, so a position "won" when the side holding it did. A record from
 * before team ids were kept has none, and an absent id is never read as team 0:
 * that match is counted in `noTeamIds` and has no start in the list. A match
 * with no recorded result is in the list with no result, so it counts as a
 * start taken and in no win or loss. Two seats on one team share its start,
 * which is listed once.
 */
export function joinStarts(
  matches: readonly AggregateMatch[],
  counts: ReadonlyMap<string, ReplayCounts>,
): JoinedStarts {
  const out: JoinedStarts = {
    starts: [],
    joined: 0,
    noTeamIds: 0,
    noSeat: 0,
    noStarts: 0,
    unread: 0,
  };
  for (const m of matches) {
    const r = m.record;
    const replay = counts.get(r.path);
    if (!replay) {
      out.unread++;
      continue;
    }
    if (replay.starts.length === 0) {
      out.noStarts++;
      continue;
    }
    const seats = seatsOf(r);
    if (!seats.some((s) => s.team !== undefined)) {
      out.noTeamIds++;
      continue;
    }
    const byTeam = new Map<number, { allyTeam: number; ai: boolean }>();
    for (const s of seats) {
      if (s.team === undefined || s.allyTeam === undefined) continue;
      const held = byTeam.get(s.team);
      byTeam.set(s.team, {
        allyTeam: s.allyTeam,
        ai: held ? held.ai && s.ai : s.ai,
      });
    }
    const allies = [
      ...new Set(
        seats.flatMap((s) => (s.allyTeam === undefined ? [] : [s.allyTeam])),
      ),
    ].sort((a, b) => a - b);
    const twoSides = m.format === "duel" || m.format === "teams";
    let any = false;
    for (const start of replay.starts) {
      const held = byTeam.get(start.team);
      if (!held) {
        out.noSeat++;
        continue;
      }
      any = true;
      out.starts.push({
        filename: r.filename,
        team: start.team,
        x: start.x,
        z: start.z,
        allyTeam: held.allyTeam,
        side:
          twoSides && allies.length === 2
            ? ((allies.indexOf(held.allyTeam) + 1) as 1 | 2)
            : null,
        outcome: !r.winnersKnown
          ? "no-result"
          : r.winningAllyTeams.includes(held.allyTeam)
            ? "won"
            : "lost",
        byAi: held.ai,
      });
    }
    if (any) out.joined++;
  }
  return out;
}

// ---- counting by position ---------------------------------------------------

/** Starts taken, how many of those have a result, and how many won. */
export interface Count {
  taken: number;
  known: number;
  won: number;
}

const add = (c: Count, outcome: StartOutcome) => {
  c.taken++;
  if (outcome !== "no-result") c.known++;
  if (outcome === "won") c.won++;
};

export interface StartPlace {
  key: string;
  kind: "declared" | "cluster";
  /** The number drawn on the minimap and in the table. A declared position
   *  keeps its place in the map's own list, counted from 1, so it is the
   *  number the map's page already gives it. A group is numbered after the
   *  declared ones, most taken first. */
  number: number;
  x: number;
  z: number;
  /** Zero for a declared position and for a group of one start. */
  radius: number;
}

export interface PlaceRecord extends Count {
  place: StartPlace;
  /** The same count for starts on side 1 and on side 2. Starts in a match that
   *  was not two sides are in neither. */
  sides: [Count, Count];
  /** Starts taken by an AI, which are in the counts above. */
  byAi: number;
}

export interface StartRecords {
  /** Most taken first. A declared position nobody started on has no row. */
  places: PlaceRecord[];
  /** Null when the map declares no position to compare with. */
  tolerance: number | null;
  /** Null when the map has no size. */
  scale: number | null;
  /** Starts at a declared position, and starts grouped by distance. */
  atDeclared: number;
  grouped: number;
  /** Starts left out because the map has no size to group them on. */
  ungrouped: number;
}

/**
 * Count starts by position.
 *
 * A start within the tolerance of a declared position is at that position.
 * Every other start is grouped by distance with `clusterStarts`, which is what
 * a box start map and a map whose players chose their places both need. The
 * two kinds sit in one list because a place is a place, and the key says
 * which kind: `d3` for the third declared position, `c3:7` for a group.
 */
export function placeRecords(
  starts: readonly JoinedStart[],
  declared: readonly Point[],
  world: MapWorld,
): StartRecords {
  const tolerance = declaredTolerance(declared);
  const scale = clusterScale(world);
  const records = new Map<string, PlaceRecord>();
  const count = (
    place: Omit<StartPlace, "number">,
    members: readonly JoinedStart[],
    number = 0,
  ) => {
    const record: PlaceRecord = {
      place: { ...place, number },
      taken: 0,
      known: 0,
      won: 0,
      sides: [
        { taken: 0, known: 0, won: 0 },
        { taken: 0, known: 0, won: 0 },
      ],
      byAi: 0,
    };
    for (const s of members) {
      add(record, s.outcome);
      if (s.side) add(record.sides[s.side - 1], s.outcome);
      if (s.byAi) record.byAi++;
    }
    records.set(place.key, record);
  };

  const strays: JoinedStart[] = [];
  const onDeclared = new Map<number, JoinedStart[]>();
  for (const s of starts) {
    const at = nearestDeclared(s, declared, tolerance);
    if (at === null) strays.push(s);
    else onDeclared.set(at, [...(onDeclared.get(at) ?? []), s]);
  }
  let atDeclared = 0;
  for (const [index, members] of onDeclared) {
    atDeclared += members.length;
    count(
      {
        key: `d${index + 1}`,
        kind: "declared",
        x: declared[index].x,
        z: declared[index].z,
        radius: 0,
      },
      members,
      index + 1,
    );
  }

  let grouped = 0;
  let ungrouped = 0;
  if (scale === null) ungrouped = strays.length;
  else {
    const clusters = clusterStarts(strays, scale);
    for (const c of clusters) {
      grouped += c.members.length;
      count(
        {
          key: c.key,
          kind: "cluster",
          x: c.x,
          z: c.z,
          radius: c.radius,
        },
        c.members.map((i) => strays[i]),
      );
    }
  }

  const places = [...records.values()];
  let next = declared.length;
  for (const r of places
    .filter((p) => p.place.kind === "cluster")
    .sort(
      (a, b) => b.taken - a.taken || a.place.key.localeCompare(b.place.key),
    ))
    r.place.number = ++next;
  places.sort((a, b) => b.taken - a.taken || a.place.number - b.place.number);
  return { places, tolerance, scale, atDeclared, grouped, ungrouped };
}

/** The arrangement every match shares, or null when they differ or there are
 *  none. A split by side only means something within one arrangement. */
export function sharedFormat(
  matches: readonly AggregateMatch[],
): MatchFormat | null {
  const formats = new Set(matches.map((m) => m.format));
  return formats.size === 1 ? [...formats][0] : null;
}

// ---- the map's results ------------------------------------------------------

export interface TeamRecord {
  /** Matches of two sides, which are the ones that have a team 1 and a team 2. */
  twoSides: number;
  /** Of those, the ones with a recorded result. */
  decided: number;
  team1Won: number;
  team2Won: number;
  /** Matches of any other arrangement, which are in neither team's count. */
  other: number;
}

/**
 * Which side won, over the matches of two sides. Team 1 is the side with the
 * lower ally team number. Where that is the lobby's first slot or the stronger
 * side nothing here says, so the counts are not an advantage of either.
 */
export function teamRecord(matches: readonly AggregateMatch[]): TeamRecord {
  const out: TeamRecord = {
    twoSides: 0,
    decided: 0,
    team1Won: 0,
    team2Won: 0,
    other: 0,
  };
  for (const m of matches) {
    if (m.format !== "duel" && m.format !== "teams") {
      out.other++;
      continue;
    }
    out.twoSides++;
    if (!m.record.winnersKnown) continue;
    out.decided++;
    const allies = [
      ...new Set(
        seatsOf(m.record).flatMap((s) =>
          s.allyTeam === undefined ? [] : [s.allyTeam],
        ),
      ),
    ].sort((a, b) => a - b);
    if (m.record.winningAllyTeams.includes(allies[0])) out.team1Won++;
    if (m.record.winningAllyTeams.includes(allies[1])) out.team2Won++;
  }
  return out;
}

/** Matches with a recorded result. Not knowing who won is not a loss. */
export const withResult = (matches: readonly AggregateMatch[]): number =>
  matches.filter((m) => m.record.winnersKnown).length;

// ---- length -----------------------------------------------------------------

export interface LengthSummary {
  /** Matches with a length. */
  matches: number;
  /** Matches left out because the replay's header holds no length. */
  noLength: number;
  median: number | null;
  shortest: number | null;
  longest: number | null;
}

/** The median and the range of match lengths, in seconds. */
export function lengthSummary(
  matches: readonly AggregateMatch[],
): LengthSummary {
  const lengths = matches
    .map((m) => m.record.durationSec)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  const n = lengths.length;
  return {
    matches: n,
    noLength: matches.length - n,
    median:
      n === 0
        ? null
        : n % 2
          ? lengths[(n - 1) / 2]
          : (lengths[n / 2 - 1] + lengths[n / 2]) / 2,
    shortest: n === 0 ? null : lengths[0],
    longest: n === 0 ? null : lengths[n - 1],
  };
}

// ---- factions ---------------------------------------------------------------

export interface FactionCount {
  faction: string;
  /** Seats that played it. */
  games: number;
  /** Of those, the ones with a recorded result. */
  decided: number;
  wins: number;
}

/**
 * Each faction's games and wins over the matches, for every player.
 *
 * It is `factionRecordsFor` in `stats.ts` with the player taken away: the
 * faction is the seat's `side` as the script spells it, a seat with none is
 * dropped, a spectator is not a player, and a match with no result is a game
 * and not a win or a loss. Skirmish AIs stay out, as they do everywhere in the
 * library's records. Two players of one faction on one side count twice.
 */
export function factionCounts(
  matches: readonly AggregateMatch[],
): FactionCount[] {
  const by = new Map<string, FactionCount>();
  for (const m of matches)
    for (const p of m.record.players) {
      if (p.spectator || !p.side) continue;
      const c = by.get(p.side) ?? {
        faction: p.side,
        games: 0,
        decided: 0,
        wins: 0,
      };
      c.games++;
      const won = m.record.winnersKnown ? (p.won ?? undefined) : undefined;
      if (won !== undefined) {
        c.decided++;
        if (won) c.wins++;
      }
      by.set(p.side, c);
    }
  return [...by.values()].sort(
    (a, b) => b.games - a.games || a.faction.localeCompare(b.faction),
  );
}
