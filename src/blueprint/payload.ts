/**
 * A layout as it travels to somebody else (issue #1417).
 *
 * This is the wire shape behind `kind: "blueprint"` in
 * `../container/container.ts`, and it is deliberately its own thing rather than
 * the app's `BaseBlueprint` written out. Two readers have to agree on it: this
 * app, and the Coilbox hub, which vendors this file to draw a preview of a
 * layout it was given. The hub compiles none of the rest of coilbox, so
 * everything here is plain values and the only import is the shared game
 * identity, which the hub already vendors.
 *
 * What it carries, and why each of them:
 *
 * - `buildings`, in order, each with the def name, an offset from the layout's
 *   origin in elmos, and a facing. The order is the build order when `ordered`
 *   says it was meant, which is the one thing a sequence cannot say about
 *   itself.
 * - `footprints`, how much ground each def stands on. This is the field that
 *   makes the whole payload worth having. A footprint comes from the unit
 *   definition, which means unitsync, which means the game installed. The hub
 *   has neither, so without this a preview can only draw one uniform square per
 *   building and a solar collector looks the same size as a factory. It is a
 *   dictionary keyed by def rather than a field on each building because a
 *   footprint is a fact about the unit and not about the placement: a base with
 *   twenty solars states it once, and two entries for one def can never
 *   disagree.
 * - `name`, what the author calls it, and `game`, which game's def names these
 *   are. A blueprint names units by internal name, so it belongs to a game the
 *   way a scenario does, and the hub has `game_key` and `game_name` columns to
 *   fill from it.
 *
 * What it does not carry: the layout's local id, which the machine reading it
 * mints for itself the same way `./format.ts` does for an imported one, and
 * anything a mission puts on top of a placement, which is not part of a layout
 * at all.
 */

import {
  type GameIdentity,
  parseGameIdentity,
} from "../container/gameIdentity";

/**
 * One build square in elmos, which is what a footprint of 1 covers.
 *
 * Offsets are in elmos and footprints are in build squares, so a reader drawing
 * one against the other needs this number. It restates `BUILD_SQUARE` in
 * `./footprint.ts`, which derives it from the engine's own `footprintScale` and
 * `squareSize`, because that file reaches the rest of the app and this one has
 * to stand alone. `./payload.test.ts` asserts the two agree.
 */
export const BUILD_SQUARE_ELMOS = 16;

/** How much ground a unit stands on, in build squares. */
export interface PayloadFootprint {
  x: number;
  z: number;
}

/** What a def nothing was said about stands on. The engine floors a footprint
 *  at one square, so nothing ever stands on less. */
export const ONE_BUILD_SQUARE: PayloadFootprint = { x: 1, z: 1 };

/**
 * Which way a building faces, as the engine's `Spring.CreateUnit` facing: 0
 * south, 1 east, 2 north, 3 west. Spelled out rather than imported from the
 * scenario model, which reaches the whole app.
 */
export type PayloadFacing = 0 | 1 | 2 | 3;

/** One building, placed relative to wherever the layout is put down. */
export interface PayloadBuilding {
  def: string;
  offset: { x: number; z: number };
  facing: PayloadFacing;
}

export interface BlueprintPayload {
  /** The game these def names belong to, named the shared way (issue #1335).
   *  Absent on a layout exported where the game could not be identified. */
  game?: GameIdentity;
  name: string;
  /** Whether the order of `buildings` is the build order. Absent on a layout
   *  drawn without caring, which is most of them. */
  ordered?: boolean;
  buildings: PayloadBuilding[];
  /** Def name in lower case to what it stands on. Not every def a layout uses
   *  is in here: one exported where the unit could not be read carries what it
   *  could. */
  footprints: Record<string, PayloadFootprint>;
}

/** What a def stands on, or one square when the payload does not say. Matches
 *  the case-insensitive lookup `./footprint.ts` does, because a layout holds
 *  whatever its author typed. */
export function payloadFootprint(
  payload: BlueprintPayload,
  def: string,
): PayloadFootprint {
  const key = def.toLowerCase();
  return Object.hasOwn(payload.footprints, key)
    ? payload.footprints[key]
    : ONE_BUILD_SQUARE;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One building, or null when it is damaged. */
function parseBuilding(value: unknown): PayloadBuilding | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.def !== "string" || v.def.trim() === "") return null;
  if (typeof v.offset !== "object" || v.offset === null) return null;
  const offset = v.offset as Record<string, unknown>;
  const x = finite(offset.x);
  const z = finite(offset.z);
  if (x === null || z === null) return null;
  if (v.facing !== 0 && v.facing !== 1 && v.facing !== 2 && v.facing !== 3) {
    return null;
  }
  return { def: v.def, offset: { x, z }, facing: v.facing };
}

/** One footprint, floored at a square the way the engine does, or null when it
 *  is not a pair of sides at all. */
function parseFootprint(value: unknown): PayloadFootprint | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const x = finite(v.x);
  const z = finite(v.z);
  if (x === null || z === null || x < 1 || z < 1) return null;
  return { x: Math.floor(x), z: Math.floor(z) };
}

/**
 * Narrow an untrusted value to a {@link BlueprintPayload}, or null. Never
 * throws: this runs on a file somebody else wrote.
 *
 * A damaged building rejects the whole layout, because a layout missing a
 * building is a different layout and nothing says which one it was. A damaged
 * footprint is dropped instead and the def falls back to one square: a
 * footprint is how the layout is drawn, not what the layout is.
 */
export function parseBlueprintPayload(value: unknown): BlueprintPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") return null;
  if (!Array.isArray(v.buildings)) return null;

  const buildings: PayloadBuilding[] = [];
  for (const entry of v.buildings) {
    const building = parseBuilding(entry);
    if (!building) return null;
    buildings.push(building);
  }

  const footprints: Record<string, PayloadFootprint> = {};
  if (typeof v.footprints === "object" && v.footprints !== null) {
    for (const [def, entry] of Object.entries(v.footprints)) {
      const footprint = parseFootprint(entry);
      if (footprint) footprints[def.toLowerCase()] = footprint;
    }
  }

  const game = parseGameIdentity(v.game);
  return {
    ...(game ? { game } : {}),
    name: v.name,
    ...(v.ordered === true ? { ordered: true } : {}),
    buildings,
    footprints,
  };
}
