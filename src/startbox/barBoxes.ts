import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  MAX_INFLATED_BYTES,
} from "@/container/container";
import { allyLetter } from "@/lib/allyDisplay";
import { allyPaletteColor } from "@/lib/allyPalette";
import { optionValue } from "@/multiplayer/battle/battleOptions";
import { GRID, type StartRect } from "./geometry";
import type { StartArea, WorldExtent, WorldPoint } from "./polygon";
import { type Anchor, tessellateRing } from "./spline";

/**
 * BAR's start boxes (issue #343). The lobby protocol only carries rectangles,
 * so BAR sends the real shapes in two hidden game options, each the base64url
 * of zlib compressed JSON:
 *
 * - `mapmetadata_startboxes_set` holds one arrangement per team count, keyed by
 *   the count. The server or autohost sets it.
 * - `mapmetadata_startbox_override` holds a single arrangement. A host's custom
 *   boxes go there.
 *
 * `resolveArrangement` in BAR's `startbox_utilities.lua` picks the one the game
 * uses, and {@link resolveArrangement} here picks the same one.
 */

export const SET_OPTION = "mapmetadata_startboxes_set";
export const OVERRIDE_OPTION = "mapmetadata_startbox_override";

/** One point of a box, on the 0 to 200 grid. */
export interface BoxPoint {
  x: number;
  y: number;
  /** How far the edges leaving this point curve, from 0 to 1. */
  strength?: number;
}

/** One team's box: two opposite corners (a rectangle) or a closed curve. */
export interface BoxShape {
  poly: BoxPoint[];
}

/** The boxes for a game, one per ally team in order. */
export interface Arrangement {
  startboxes: BoxShape[];
  maxPlayersPerStartbox?: number;
}

/** Arrangements keyed by the team count they are for. */
export type ArrangementSet = Record<string, Arrangement>;

export type ArrangementSource = "override" | "set";

export interface ResolvedArrangement {
  arrangement: Arrangement;
  source: ArrangementSource;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isCoordinate = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function asPoint(v: unknown): BoxPoint | null {
  if (!isRecord(v) || !isCoordinate(v.x) || !isCoordinate(v.y)) return null;
  if (v.strength === undefined) return { x: v.x, y: v.y };
  return isCoordinate(v.strength)
    ? { x: v.x, y: v.y, strength: v.strength }
    : null;
}

/** An arrangement from decoded JSON, or null when it is not shaped like one. */
export function asArrangement(v: unknown): Arrangement | null {
  if (!isRecord(v) || !Array.isArray(v.startboxes)) return null;
  const startboxes: BoxShape[] = [];
  for (const box of v.startboxes) {
    if (!isRecord(box) || !Array.isArray(box.poly) || box.poly.length < 2) {
      return null;
    }
    const poly = box.poly.map(asPoint);
    if (poly.some((p) => p === null)) return null;
    startboxes.push({ poly: poly as BoxPoint[] });
  }
  return isCoordinate(v.maxPlayersPerStartbox)
    ? { startboxes, maxPlayersPerStartbox: v.maxPlayersPerStartbox }
    : { startboxes };
}

function asSet(v: unknown): ArrangementSet | null {
  if (!isRecord(v)) return null;
  const set: ArrangementSet = {};
  for (const [key, entry] of Object.entries(v)) {
    const arrangement = asArrangement(entry);
    if (!arrangement) return null;
    set[key] = arrangement;
  }
  return set;
}

/**
 * The JSON inside an option's value: base64url, then zlib, then JSON. Text
 * that is base64url JSON without the zlib layer is read too, as BAR reads it.
 * Throws with the reason when it is neither.
 */
export function decodePayload(raw: string): unknown {
  const bytes = base64UrlToBytes(raw.trim());
  if (bytes.length === 0) throw new Error("it is empty");
  let text: string;
  try {
    // A fixed buffer, so a small value cannot inflate into a huge one.
    text = strFromU8(
      unzlibSync(bytes, { out: new Uint8Array(MAX_INFLATED_BYTES) }),
    );
  } catch {
    text = strFromU8(bytes);
  }
  return JSON.parse(text);
}

/** An arrangement as the value of the override option. */
export function encodeArrangement(arrangement: Arrangement): string {
  return bytesToBase64Url(zlibSync(strToU8(JSON.stringify(arrangement))));
}

export interface StartBoxOptions {
  override: Arrangement | null;
  set: ArrangementSet | null;
  /** One line for each option that has a value but could not be read. */
  problems: string[];
}

function readOption<T>(
  raw: string | undefined,
  name: string,
  shape: (v: unknown) => T | null,
  problems: string[],
): T | null {
  if (raw === undefined || raw.trim() === "") return null;
  try {
    const value = shape(decodePayload(raw));
    if (value) return value;
    problems.push(`${name} does not hold start boxes`);
  } catch (e) {
    problems.push(`${name} could not be decoded: ${(e as Error).message}`);
  }
  return null;
}

/**
 * Both options from a room's script tags. A value that cannot be read is left
 * out and named in `problems`, so the room shows its rectangles.
 */
export function startBoxOptions(
  scriptTags: Record<string, string>,
): StartBoxOptions {
  const problems: string[] = [];
  return {
    override: readOption(
      optionValue(scriptTags, "mod", OVERRIDE_OPTION),
      OVERRIDE_OPTION,
      asArrangement,
      problems,
    ),
    set: readOption(
      optionValue(scriptTags, "mod", SET_OPTION),
      SET_OPTION,
      asSet,
      problems,
    ),
    problems,
  };
}

/** The set's entry with the smallest (or largest) team count past `teams`. */
function nearestInSet(
  set: ArrangementSet,
  teams: number,
  direction: "larger" | "smaller",
): Arrangement | null {
  let best: { count: number; arrangement: Arrangement } | null = null;
  for (const [key, arrangement] of Object.entries(set)) {
    const count = key.trim() === "" ? Number.NaN : Number(key);
    if (!Number.isFinite(count)) continue;
    if (direction === "larger" ? count <= teams : count >= teams) continue;
    const closer =
      !best ||
      (direction === "larger" ? count < best.count : count > best.count);
    if (closer) best = { count, arrangement };
  }
  return best?.arrangement ?? null;
}

/**
 * The arrangement the game uses for `teams` ally teams, in BAR's order:
 *
 * 1. The override, if it has at least as many boxes as there are teams.
 * 2. The set's entry for exactly that team count.
 * 3. The set's entry for the next larger count.
 * 4. The set's entry for the next smaller count.
 *
 * Null means none applies and the game uses the engine's rectangles.
 */
export function resolveArrangement(
  override: Arrangement | null,
  set: ArrangementSet | null,
  teams: number,
): ResolvedArrangement | null {
  if (override && override.startboxes.length >= teams) {
    return { arrangement: override, source: "override" };
  }
  if (!set) return null;
  const exact = Object.hasOwn(set, String(teams)) ? set[String(teams)] : null;
  const arrangement =
    exact ??
    nearestInSet(set, teams, "larger") ??
    nearestInSet(set, teams, "smaller");
  return arrangement ? { arrangement, source: "set" } : null;
}

/** A box's anchors in world units, a rectangle's corners expanded to four. */
function anchorsOf(box: BoxShape, scaleX: number, scaleZ: number): Anchor[] {
  const at = (p: BoxPoint, strength?: number): Anchor => ({
    x: p.x * scaleX,
    z: p.y * scaleZ,
    ...(strength !== undefined ? { strength } : {}),
  });
  if (box.poly.length === 2) {
    const [a, b] = box.poly;
    return [
      at({ x: a.x, y: a.y }),
      at({ x: b.x, y: a.y }),
      at({ x: b.x, y: b.y }),
      at({ x: a.x, y: b.y }),
    ];
  }
  return box.poly.map((p) => at(p, p.strength));
}

/**
 * An arrangement as the areas `StartPolygonOverlay` draws: the 0 to 200 grid
 * scaled to the map's world units, curves cut into points, and the south edge
 * kept one unit inside the map as the game keeps it.
 */
export function arrangementAreas(
  arrangement: Arrangement,
  extent: WorldExtent,
): StartArea[] {
  const scaleX = extent.x / GRID;
  const scaleZ = extent.z / GRID;
  const maxZ = extent.z - 1;
  return arrangement.startboxes.map((box, i) => {
    const ring = tessellateRing(anchorsOf(box, scaleX, scaleZ)).map(
      ([x, z]): WorldPoint => [x, Math.min(z, maxZ)],
    );
    return {
      key: String(i),
      label: allyLetter(i),
      color: allyPaletteColor(i),
      polygons: [ring],
      points: [],
    };
  });
}

/** One change a host made to a team's box: a new rectangle, or none. */
export interface BoxEdit {
  ally: number;
  rect: StartRect | null;
}

/** A box that restricts nothing: the whole map. */
const WHOLE_MAP: BoxShape = {
  poly: [
    { x: 0, y: 0 },
    { x: GRID, y: GRID },
  ],
};

const rectBox = (r: StartRect): BoxShape => ({
  poly: [
    { x: r.left, y: r.top },
    { x: r.right, y: r.bottom },
  ],
});

/**
 * The override that puts a host's edits on top of the arrangement the game is
 * using now. Boxes the host did not touch stay as they are, curves included. A
 * team with no box gets the whole map, which is what no box means. The result
 * has a box for every team, because the game ignores an override with fewer.
 */
export function overrideAfterEdits(
  current: Arrangement,
  edits: BoxEdit[],
  teams: number,
  fallbackMaxPlayers: number,
): Arrangement {
  const startboxes = [...current.startboxes];
  const wanted = Math.max(teams, ...edits.map((e) => e.ally + 1));
  while (startboxes.length < wanted) startboxes.push(WHOLE_MAP);
  for (const { ally, rect } of edits) {
    startboxes[ally] = rect ? rectBox(rect) : WHOLE_MAP;
  }
  return {
    startboxes,
    maxPlayersPerStartbox: Math.max(
      1,
      current.maxPlayersPerStartbox ?? fallbackMaxPlayers,
    ),
  };
}
