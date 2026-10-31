/**
 * The names a player gives a map's start positions (#1178).
 *
 * A position's number says where it is on the minimap. Only the player knows
 * what it is called, so the name is theirs and is kept on this machine, per
 * map, beside the other settings. Nothing here touches React or the DOM.
 *
 * A name is stored with the position's key and the centre the position had
 * when it was named. A declared position's key is its place in the map's own
 * list and never moves. A group's key is the grid cell its centre falls in, so
 * it can change when more matches move the centre across a cell edge. A name
 * is found by key first, and when the key is gone by the nearest group within
 * the grouping distance. A name that finds no position is kept and listed, and
 * only the player deletes it.
 */

import type { AggregateMatch } from "./mapAggregate";
import type { Count, JoinedStart, PlaceRecord, StartPlace } from "./mapRecords";

/** The frame setting holding every map's names, by the map's exact name. */
export const START_NAMES_KEY = "content.mapPositionNames";

export interface StoredName {
  /** The position's key when it was named: `d3` or `c3:7`. */
  key: string;
  /** As the player typed it, trimmed. */
  name: string;
  /** The position's centre when it was named, in elmos. */
  x: number;
  z: number;
}

/** Every map's names. The key is the exact map name: a version of a map can
 *  move its positions, so a name for one version is not carried to another. */
export type NameBook = Record<string, StoredName[]>;

export const tidyName = (name: string): string => name.trim();

type PlaceLike = Pick<StartPlace, "key" | "kind" | "x" | "z">;

export interface ResolvedNames {
  /** The stored name each position found, by the position's key. */
  byPlace: Map<string, StoredName>;
  /** Stored names no position in the current data found. */
  orphans: StoredName[];
}

/**
 * Find each position's stored name.
 *
 * 1. By key. A position takes the name stored under its key.
 * 2. By nearest centre. A group left without a name takes the nearest stored
 *    name that found nothing in step 1, if its centre is within `scale` of the
 *    group's. Declared positions are not matched this way, because their keys
 *    do not move. Nearest pairs are settled first, ties by key, so the same
 *    data gives the same answer.
 * 3. A stored name that found nothing is an orphan.
 *
 * `scale` is the grouping distance, or null when the map has no size, in which
 * case step 2 does not run.
 */
export function resolveNames(
  stored: readonly StoredName[],
  places: readonly PlaceLike[],
  scale: number | null,
): ResolvedNames {
  const byPlace = new Map<string, StoredName>();
  const used = new Set<StoredName>();
  const placeKeys = new Set(places.map((p) => p.key));
  for (const entry of stored)
    if (placeKeys.has(entry.key) && !byPlace.has(entry.key)) {
      byPlace.set(entry.key, entry);
      used.add(entry);
    }

  if (scale !== null) {
    const pairs: { entry: StoredName; place: PlaceLike; d: number }[] = [];
    for (const entry of stored) {
      if (used.has(entry) || !entry.key.startsWith("c")) continue;
      for (const place of places) {
        if (place.kind !== "cluster" || byPlace.has(place.key)) continue;
        const d = Math.hypot(entry.x - place.x, entry.z - place.z);
        if (d <= scale) pairs.push({ entry, place, d });
      }
    }
    pairs.sort(
      (a, b) =>
        a.d - b.d ||
        a.place.key.localeCompare(b.place.key) ||
        a.entry.key.localeCompare(b.entry.key),
    );
    for (const { entry, place } of pairs)
      if (!used.has(entry) && !byPlace.has(place.key)) {
        byPlace.set(place.key, entry);
        used.add(entry);
      }
  }
  return { byPlace, orphans: stored.filter((e) => !used.has(e)) };
}

/**
 * The stored names after giving `targets` a name, or none for an empty one.
 *
 * Whatever name each target found is replaced, and the new one is stored with
 * the key and centre the target has now. Several targets are one row that
 * shares a name, so they all take it. A name that is empty once trimmed clears
 * them.
 */
export function withNames(
  stored: readonly StoredName[],
  resolved: ResolvedNames,
  targets: readonly PlaceLike[],
  name: string,
): StoredName[] {
  const replaced = new Set(
    targets.flatMap((t) => resolved.byPlace.get(t.key) ?? []),
  );
  const kept = stored.filter(
    (e) => !replaced.has(e) && !targets.some((t) => t.key === e.key),
  );
  const tidy = tidyName(name);
  if (!tidy) return kept;
  return [
    ...kept,
    ...targets.map((t) => ({ key: t.key, name: tidy, x: t.x, z: t.z })),
  ];
}

/** The stored names without one, for an orphan the player deletes. */
export const withoutName = (
  stored: readonly StoredName[],
  entry: StoredName,
): StoredName[] =>
  stored.filter((e) => !(e.key === entry.key && e.name === entry.name));

// ---- rows ---------------------------------------------------------------------

/**
 * One row of the start table: a position, or several positions the player
 * gave one name. Counts are the sums over its positions.
 */
export interface StartRow extends Count {
  /** The key of the position with most starts, which stands for the row. */
  key: string;
  /** The number drawn on the minimap for every mark in the row. */
  number: number;
  /** The name as the first of its positions was given it, or null. */
  name: string | null;
  /** The positions in the row, most taken first. */
  places: StartPlace[];
  sides: [Count, Count];
  byAi: number;
}

const addCounts = (into: Count, from: Count) => {
  into.taken += from.taken;
  into.known += from.known;
  into.won += from.won;
};

/**
 * Join positions that share a name into one row. Names are compared without
 * regard to case, so "Front" and "front" are one position, and the row shows
 * the name of its first. `names` is the name found by each position's key.
 * Rows are most taken first, as the positions were.
 */
export function startRows(
  places: readonly PlaceRecord[],
  names: ReadonlyMap<string, string>,
): StartRow[] {
  const rows = new Map<string, StartRow>();
  for (const p of places) {
    const name = names.get(p.place.key) ?? null;
    const id = name === null ? `\0${p.place.key}` : name.toLowerCase();
    const row = rows.get(id);
    if (row) {
      row.places.push(p.place);
      addCounts(row, p);
      addCounts(row.sides[0], p.sides[0]);
      addCounts(row.sides[1], p.sides[1]);
      row.byAi += p.byAi;
    } else
      rows.set(id, {
        key: p.place.key,
        number: p.place.number,
        name,
        places: [p.place],
        taken: p.taken,
        known: p.known,
        won: p.won,
        sides: [{ ...p.sides[0] }, { ...p.sides[1] }],
        byAi: p.byAi,
      });
  }
  return [...rows.values()].sort(
    (a, b) => b.taken - a.taken || a.number - b.number,
  );
}

// ---- one named position -------------------------------------------------------

/** The matches where a named position was taken, and the engine teams that
 *  took it in each, by the match's replay path. */
export interface PositionPicture {
  matches: AggregateMatch[];
  teams: Map<string, Set<number>>;
  /** The starts taken at the position, one for each team in each match. */
  starts: JoinedStart[];
}

/**
 * The matches in which a start was taken at a position called `name`, and the
 * teams that took it.
 *
 * `places` and `names` are the ones the start table is built from, so the
 * positions are the rows the player sees and a name finds its positions as the
 * table does: by key, then by the nearest group (`resolveNames`). Names are
 * compared without regard to case, as `startRows` joins them. A match whose
 * starts could not be joined to a team (`joinStarts`) took no position and is
 * not here. Where two teams of one match took positions with the name, both are
 * in `teams`.
 */
export function pictureAt(
  matches: readonly AggregateMatch[],
  places: readonly PlaceRecord[],
  names: ReadonlyMap<string, string>,
  name: string,
): PositionPicture {
  const wanted = name.toLowerCase();
  const out: PositionPicture = { matches: [], teams: new Map(), starts: [] };
  const held = new Map<string, Set<number>>();
  for (const p of places) {
    if (names.get(p.place.key)?.toLowerCase() !== wanted) continue;
    for (const s of p.starts) {
      out.starts.push(s);
      const teams = held.get(s.filename);
      if (teams) teams.add(s.team);
      else held.set(s.filename, new Set([s.team]));
    }
  }
  for (const m of matches) {
    const teams = held.get(m.record.filename);
    if (!teams) continue;
    out.matches.push(m);
    out.teams.set(m.record.path, teams);
  }
  return out;
}
