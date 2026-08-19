/**
 * Asking the hub what it knows about a map, by name (issue #1738).
 *
 * `POST <hub>/api/v1/maps/lookup`. This is the question the rest of the map
 * catalog was built to answer: coilbox draws a battle lobby and a download
 * screen for maps the player has not installed, and for those it holds a name
 * and nothing else. `/api/v1/assets/pictures` turns that name into a minimap and
 * this turns it into the facts.
 *
 * ## Why this is a webview fetch and not a plugin command
 *
 * The same reasons `../assets/pictures.ts` gives: the route needs no token, the
 * hub sends `access-control-allow-origin: *`, and the caller is the page drawing
 * the caption. A plugin command would be an ACL entry, a permissions file and a
 * serde round trip in front of a `fetch` the webview can make itself, plus a
 * keychain read for a request that carries no account.
 *
 * The map catalog's other two routes are in Rust for the opposite reason: they
 * take a bearer token, and their caller is the Rust upload path.
 *
 * ## Why a failure is "no facts" rather than an error
 *
 * A name the hub knows nothing about answers `null` with a 200, and that is the
 * ordinary case rather than a fault: the catalog fills up as clients submit. The
 * caller's fallback is the name on its own, which is exactly what it draws today,
 * so a hub that cannot be reached lands in the same place. The reason comes back
 * rather than being thrown so a caller that wants to say something can.
 */

import { serverError } from "../api";
import { MAX_LOOKUP_NAMES } from "./vocabulary";

/** The envelope, from `lib/api/mapLookup.ts` in tomjn/coilbox-hub. */
const LOOKUP_FORMAT = "coilbox-hub-map-lookup";

/** The version this build was written against. A higher one is refused rather
 *  than read as a shape that changed underneath a build sitting on disk. */
export const MAP_LOOKUP_VERSION = 1;

export { MAX_LOOKUP_NAMES };

/** One point on the map, in elmos. `x` and `z` are the two ground axes. */
export interface MapFactPoint {
  x: number;
  z: number;
  y?: number | null;
  meta?: Record<string, unknown> | null;
}

/** Where things are, as the hub stores them. */
export interface MapFactPoints {
  start: MapFactPoint[];
  metal: MapFactPoint[];
  geo: MapFactPoint[];
}

/**
 * One person who made the map, as the hub files them.
 *
 * `name` is the most common spelling among that author's maps rather than this
 * archive's, so one mapper does not get a different name on every map.
 */
export interface MapFactAuthor {
  key: string;
  name: string;
}

/**
 * What the hub knows about one map.
 *
 * The measurements are what some client extracted from the archive and
 * submitted, which is the same read coilbox does locally. `tags` are the hub's
 * own, derived from those measurements plus whatever a maintainer wrote, so a
 * caller never has to know which is which.
 */
export interface MapFacts {
  slug: string;
  display_name: string | null;
  description: string | null;
  authors: MapFactAuthor[];
  width_elmos: number;
  height_elmos: number;
  world_height_min: number;
  world_height_max: number;
  min_wind: number | null;
  max_wind: number | null;
  tidal_strength: number | null;
  void_water: boolean | null;
  water_coverage: number | null;
  tags: string[];
  points: MapFactPoints;
  appearance: Record<string, unknown>;
}

/** Either the answers, in the order the names were asked, or a sentence saying
 *  why there are none. */
export type LookupResult =
  | { ok: true; maps: (MapFacts | null)[] }
  | { ok: false; reason: string };

/** The lookup's address under the configured base, concatenated rather than
 *  resolved so a hub served under a path prefix keeps its prefix. */
export function hubMapLookupUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/api/v1/maps/lookup`;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function points(value: unknown): MapFactPoints {
  const empty: MapFactPoints = { start: [], metal: [], geo: [] };
  if (typeof value !== "object" || value === null) return empty;
  const record = value as Record<string, unknown>;
  const read = (kind: keyof MapFactPoints): MapFactPoint[] => {
    const list = record[kind];
    if (!Array.isArray(list)) return [];
    return list.flatMap((point) => {
      if (typeof point !== "object" || point === null) return [];
      const at = point as Record<string, unknown>;
      if (typeof at.x !== "number" || typeof at.z !== "number") return [];
      return [
        {
          x: at.x,
          z: at.z,
          y: nullableNumber(at.y),
          meta:
            typeof at.meta === "object" && at.meta !== null
              ? (at.meta as Record<string, unknown>)
              : null,
        },
      ];
    });
  };
  return { start: read("start"), metal: read("metal"), geo: read("geo") };
}

/**
 * One answer's facts, or null for anything that is not a set of them.
 *
 * A malformed row reads as no facts, because the caller's fallback is what it
 * would draw for a map the hub has never heard of anyway. The required
 * measurements are the ones an entry cannot exist without, so a row missing one
 * is not a row this understands.
 */
export function readMapFacts(value: unknown): MapFacts | null {
  if (typeof value !== "object" || value === null) return null;
  const facts = value as Record<string, unknown>;
  if (typeof facts.slug !== "string" || !facts.slug) return null;
  if (typeof facts.width_elmos !== "number") return null;
  if (typeof facts.height_elmos !== "number") return null;

  const authors = Array.isArray(facts.authors)
    ? facts.authors.flatMap((author) => {
        if (typeof author !== "object" || author === null) return [];
        const one = author as Record<string, unknown>;
        return typeof one.key === "string" && typeof one.name === "string"
          ? [{ key: one.key, name: one.name }]
          : [];
      })
    : [];

  return {
    slug: facts.slug,
    display_name:
      typeof facts.display_name === "string" ? facts.display_name : null,
    description:
      typeof facts.description === "string" ? facts.description : null,
    authors,
    width_elmos: facts.width_elmos,
    height_elmos: facts.height_elmos,
    world_height_min: numberOr(facts.world_height_min, 0),
    world_height_max: numberOr(facts.world_height_max, 0),
    min_wind: nullableNumber(facts.min_wind),
    max_wind: nullableNumber(facts.max_wind),
    tidal_strength: nullableNumber(facts.tidal_strength),
    void_water: typeof facts.void_water === "boolean" ? facts.void_water : null,
    water_coverage: nullableNumber(facts.water_coverage),
    tags: Array.isArray(facts.tags)
      ? facts.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    points: points(facts.points),
    appearance:
      typeof facts.appearance === "object" && facts.appearance !== null
        ? (facts.appearance as Record<string, unknown>)
        : {},
  };
}

/**
 * Read one batch's answer, given the names it was asked with.
 *
 * The count and the echoed name are both checked before anything is read by
 * index. The hub answers in request order, which is what makes an answer
 * readable by position, and a batch that came back reordered or short would put
 * one map's size on another map's card. That is worse than no facts, so it is
 * refused whole.
 *
 * A repeated name is allowed, because the hub allows it: a lobby list names the
 * map each game is playing and several games play the same map.
 */
export function readLookupBody(body: unknown, asked: string[]): LookupResult {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      reason: "The hub sent something coilbox could not read.",
    };
  }
  const shape = body as Record<string, unknown>;
  if (shape.format !== LOOKUP_FORMAT) {
    return {
      ok: false,
      reason: "That address answered, but it is not a coilbox hub.",
    };
  }
  if (typeof shape.version !== "number" || shape.version > MAP_LOOKUP_VERSION) {
    return {
      ok: false,
      reason:
        "This hub answers with a newer map lookup than this copy of coilbox understands. Update coilbox.",
    };
  }
  const results = shape.results;
  if (!Array.isArray(results) || results.length !== asked.length) {
    return {
      ok: false,
      reason: `The hub answered ${Array.isArray(results) ? results.length : 0} of ${asked.length} maps.`,
    };
  }

  const maps: (MapFacts | null)[] = [];
  for (const [index, result] of results.entries()) {
    if (typeof result !== "object" || result === null) {
      return {
        ok: false,
        reason: `The hub's answer ${index} is not a result.`,
      };
    }
    const record = result as Record<string, unknown>;
    if (record.map_name !== asked[index]) {
      return {
        ok: false,
        reason: `The hub answered name ${index} with a different name.`,
      };
    }
    maps.push(readMapFacts(record.map));
  }
  return { ok: true, maps };
}

/** One request, and what it answered. */
async function ask(
  url: string,
  names: string[],
  signal?: AbortSignal,
): Promise<LookupResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ names }),
      signal,
    });
  } catch {
    return { ok: false, reason: `Could not reach the hub at ${hostOf(url)}.` };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) {
      return {
        ok: false,
        reason: "The hub sent something coilbox could not read.",
      };
    }
  }

  if (!response.ok) {
    const said = serverError(body);
    return {
      ok: false,
      reason:
        said ?? `The hub refused the map lookup (HTTP ${response.status}).`,
    };
  }
  return readLookupBody(body, names);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Ask the hub about these map names, answered in the order they were given so a
 * caller can zip the two by index.
 *
 * A set larger than {@link MAX_LOOKUP_NAMES} is split into requests of that size
 * and the answers joined back up. One failed request fails the set: a partial
 * answer read by index would line the rest up against the wrong names.
 *
 * An empty set asks nobody, which matters because the hub refuses an empty batch
 * and because the caller of this is a queue that can flush empty.
 */
export async function fetchMapFacts(
  base: string,
  names: string[],
  signal?: AbortSignal,
): Promise<LookupResult> {
  if (names.length === 0) return { ok: true, maps: [] };

  const url = hubMapLookupUrl(base);
  const maps: (MapFacts | null)[] = [];
  for (let at = 0; at < names.length; at += MAX_LOOKUP_NAMES) {
    const batch = names.slice(at, at + MAX_LOOKUP_NAMES);
    const answered = await ask(url, batch, signal);
    if (!answered.ok) return answered;
    maps.push(...answered.maps);
  }
  return { ok: true, maps };
}
