/**
 * Telling versions of one map apart by name (#1164).
 *
 * A replay records the map by name and nothing else: no archive, no checksum,
 * no size. Map names carry a version as a trailing word, so two versions of a
 * map are two names. This file says when two names are the same map at
 * different versions. Nothing here touches React or the DOM.
 *
 * Names are typed by people nobody controls, and a wrong merge puts two
 * different maps in one picture. A version is therefore only a trailing word
 * that is plainly one, and when in doubt a name is left whole.
 */

/**
 * The trailing word of a map name that counts as a version, after a space, an
 * underscore or a hyphen:
 * - `v` then a whole number or dotted numbers: `v3`, `v2.4.1`, `V1.0`.
 * - dotted numbers with at least one dot: `5.17`, `2.6.1`.
 *
 * A bare whole number is not one, so `DSD 2` and `Throne 8` keep their number.
 * Neither is a word with anything else in it, such as `1.0b` or `1.0-rc1`.
 */
const TRAILING_VERSION = /^(.*\S)[\s_-]+(v\d+(?:\.\d+)*|\d+(?:\.\d+)+)$/i;

export interface MapNameParts {
  /** The name with a trailing version taken off, or the whole name. */
  base: string;
  /** The version word as typed, or null when the name has none. */
  version: string | null;
}

export function splitMapName(name: string): MapNameParts {
  const trimmed = name.trim();
  const found = TRAILING_VERSION.exec(trimmed);
  // A base with no letter in it is a number that was mistaken for a name.
  if (!found || !/[a-z]/i.test(found[1]))
    return { base: trimmed, version: null };
  return { base: found[1], version: found[2] };
}

/** Whether two map names are one map at the same or different versions. */
export function sameMapFamily(a: string, b: string): boolean {
  return splitMapName(a).base === splitMapName(b).base;
}

/** A map's size in the units the map list reports, a width and a height. */
export interface MapSize {
  width: number;
  height: number;
}

/**
 * Whether a version is the size of the page's map. `unknown` when either size
 * is not known, which is every version that is not installed, because a replay
 * does not record the size of the map it was played on.
 */
export type SizeVerdict = "same" | "different" | "unknown";

export function sizeVerdict(
  name: string,
  own: string,
  sizes: Readonly<Record<string, MapSize>>,
): SizeVerdict {
  if (name === own) return "same";
  const mine = sizes[own];
  const theirs = sizes[name];
  if (!mine || !theirs) return "unknown";
  return mine.width === theirs.width && mine.height === theirs.height
    ? "same"
    : "different";
}

export interface MapVersion {
  /** The map's full name, which is what a replay records. */
  name: string;
  /** Matches with this name, counted once each. */
  matches: number;
  verdict: SizeVerdict;
}

/**
 * The names present among a family's matches, each with its count and its size
 * verdict against the page's map. The page's own name is always listed, even
 * with no match, so it can be marked. Natural order: `v1.9` before `v1.10`.
 */
export function mapVersions(
  matches: readonly { record: { mapName: string } }[],
  own: string,
  sizes: Readonly<Record<string, MapSize>> = {},
): MapVersion[] {
  const counts = new Map<string, number>([[own, 0]]);
  for (const m of matches)
    counts.set(m.record.mapName, (counts.get(m.record.mapName) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, n]) => ({
      name,
      matches: n,
      verdict: sizeVerdict(name, own, sizes),
    }));
}

/**
 * The names that are in. A choice the player made stands. With none, a version
 * is in unless it is known to be another size, because its coordinates would
 * land in the wrong place on this page's map.
 */
export function includedVersions(
  versions: readonly MapVersion[],
  choices: ReadonlyMap<string, boolean>,
): Set<string> {
  return new Set(
    versions
      .filter((v) => choices.get(v.name) ?? v.verdict !== "different")
      .map((v) => v.name),
  );
}

/** How many different map names a set of matches is drawn from. */
export const versionsSpanned = (
  matches: readonly { record: { mapName: string } }[],
): number => new Set(matches.map((m) => m.record.mapName)).size;

/** Each value among the matches with how many matches carry it, in order. */
export function countBy<T>(
  matches: readonly T[],
  by: (m: T) => string,
): { name: string; matches: number }[] {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(by(m), (counts.get(by(m)) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, n]) => ({ name, matches: n }));
}
