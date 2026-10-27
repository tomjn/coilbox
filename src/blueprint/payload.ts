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
 * - `terrain`, changes to the ground between the buildings (issue #4790). It is
 *   additive: a reader that does not know the field reads the buildings and
 *   drops the steps, which is why the container's `kindVersion` did not move.
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
  /** What this building was before it was swapped for another side's equivalent
   *  (issue #1314). It travels because it is what makes the swap reversible by
   *  whoever receives the layout, rather than only by whoever made it. */
  originalName?: string;
}

/** The ways a terrain step changes the ground. Zero-K's terraform types 1 to 4;
 *  restore, type 5, puts back the map's own ground and so is not a blueprint's
 *  to say. */
export const TERRAIN_KINDS = ["level", "raise", "ramp", "smooth"] as const;
export type PayloadTerrainKind = (typeof TERRAIN_KINDS)[number];

/** An open path or a closed outline. A ramp is a path of two points. */
export const TERRAIN_SHAPES = ["wall", "area"] as const;
export type PayloadTerrainShape = (typeof TERRAIN_SHAPES)[number];

/** One change to the ground, placed relative to wherever the layout is put
 *  down. Heights are relative: see `TerrainStep` in `./model.ts`. */
export interface PayloadTerrainStep {
  kind: PayloadTerrainKind;
  shape: PayloadTerrainShape;
  /** Offsets from the layout's origin in elmos, like a building's. */
  points: { x: number; z: number }[];
  /** Level and raise only. */
  height?: number;
  /** Ramp only: the height at each end, in the order of `points`. */
  heights?: [number, number];
  /** Ramp only, in elmos. */
  width?: number;
  /** Level and ramp only: `raise` leaves ground above the step's height
   *  standing, `lower` leaves ground below it. Absent changes it both ways. */
  only?: "raise" | "lower";
  /** The index in `buildings` this step comes before. `buildings.length` means
   *  after all of them. */
  before: number;
}

export interface BlueprintPayload {
  /** The game these def names belong to, named the shared way (issue #1335).
   *  Absent on a layout exported where the game could not be identified. */
  game?: GameIdentity;
  name: string;
  /**
   * The map the layout was shaped around, when it was shaped around one (issue
   * #1315).
   *
   * A note about where the shape came from, never a restriction on where it
   * goes. It travels because that is what makes it worth recording: a layout
   * spaced for one map's metal spots is worth knowing about by whoever takes it,
   * and the community gallery already puts map names in layout titles by hand.
   */
  designedFor?: string;
  /** Whether the order of `buildings` is the build order. Absent on a layout
   *  drawn without caring, which is most of them. */
  ordered?: boolean;
  buildings: PayloadBuilding[];
  /** Changes to the ground. Absent on a layout that makes none, and a layout
   *  may have these and no buildings. */
  terrain?: PayloadTerrainStep[];
  /** Def name in lower case to what it stands on. Not every def a layout uses
   *  is in here: one exported where the unit could not be read carries what it
   *  could. */
  footprints: Record<string, PayloadFootprint>;
}

/** What a def stands on where the payload says so, and nothing where it does
 *  not. The case-insensitive lookup `./footprint.ts` does, because a layout
 *  holds whatever its author typed. */
export function declaredFootprint(
  payload: BlueprintPayload,
  def: string,
): PayloadFootprint | undefined {
  const key = def.toLowerCase();
  return Object.hasOwn(payload.footprints, key)
    ? payload.footprints[key]
    : undefined;
}

/** What a def stands on, or one square when the payload does not say. The
 *  fallback belongs here, at the point of reading: a payload that says nothing
 *  about a def is not the same as one claiming it stands on one square. */
export function payloadFootprint(
  payload: BlueprintPayload,
  def: string,
): PayloadFootprint {
  return declaredFootprint(payload, def) ?? ONE_BUILD_SQUARE;
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
  const was =
    typeof v.originalName === "string" && v.originalName.trim() !== ""
      ? v.originalName
      : undefined;
  return {
    def: v.def,
    offset: { x, z },
    facing: v.facing,
    ...(was ? { originalName: was } : {}),
  };
}

function point(value: unknown): { x: number; z: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const x = finite(v.x);
  const z = finite(v.z);
  return x === null || z === null ? null : { x, z };
}

/** The fewest points a step of this kind and shape can be drawn with. */
function fewestPoints(
  kind: PayloadTerrainKind,
  shape: PayloadTerrainShape,
): number {
  if (kind === "ramp") return 2;
  return shape === "area" ? 3 : 2;
}

/**
 * One terrain step, or null when it is damaged.
 *
 * Fields that do not belong to the step's kind are left out, so a `smooth` step
 * carrying a stray height reads back without one.
 */
function parseTerrainStep(
  value: unknown,
  buildings: number,
): PayloadTerrainStep | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const kind = TERRAIN_KINDS.find((one) => one === v.kind);
  const shape = TERRAIN_SHAPES.find((one) => one === v.shape);
  if (!kind || !shape) return null;
  if (kind === "ramp" && shape !== "wall") return null;

  if (!Array.isArray(v.points)) return null;
  const points: { x: number; z: number }[] = [];
  for (const raw of v.points) {
    const read = point(raw);
    if (!read) return null;
    points.push(read);
  }
  if (
    kind === "ramp"
      ? points.length !== 2
      : points.length < fewestPoints(kind, shape)
  ) {
    return null;
  }

  const before = finite(v.before);
  if (before === null || !Number.isInteger(before) || before < 0) return null;
  // A step that comes before a building the layout does not have comes after
  // them all, which is what the last place means.
  const step: PayloadTerrainStep = {
    kind,
    shape,
    points,
    before: Math.min(before, buildings),
  };

  if (kind === "level" || kind === "raise") {
    const height = finite(v.height);
    if (height === null) return null;
    step.height = height;
  }
  if (kind === "ramp") {
    if (!Array.isArray(v.heights) || v.heights.length !== 2) return null;
    const from = finite(v.heights[0]);
    const to = finite(v.heights[1]);
    const width = finite(v.width);
    if (from === null || to === null || width === null || width <= 0) {
      return null;
    }
    step.heights = [from, to];
    step.width = width;
  }
  // Anything else reads as both ways, so a later coilbox's new value costs the
  // step its choice and nothing more.
  if (
    (kind === "level" || kind === "ramp") &&
    (v.only === "raise" || v.only === "lower")
  ) {
    step.only = v.only;
  }
  return step;
}

/** A terrain step as plain values, copied so a payload shares nothing with the
 *  layout it was made from. Only the fields the step's kind uses are written. */
export function copyTerrainStep<T extends PayloadTerrainStep>(step: T): T {
  return {
    kind: step.kind,
    shape: step.shape,
    points: step.points.map((one) => ({ x: one.x, z: one.z })),
    ...(step.height !== undefined ? { height: step.height } : {}),
    ...(step.heights ? { heights: [step.heights[0], step.heights[1]] } : {}),
    ...(step.width !== undefined ? { width: step.width } : {}),
    ...(step.only ? { only: step.only } : {}),
    before: step.before,
  } as T;
}

/**
 * The readable steps of an untrusted `terrain` value, in order. Empty for
 * anything that is not a list. `buildings` is how many buildings the layout has,
 * which is the last place a step can come before.
 */
export function parseTerrainSteps(
  value: unknown,
  buildings: number,
): PayloadTerrainStep[] {
  if (!Array.isArray(value)) return [];
  const steps: PayloadTerrainStep[] = [];
  for (const entry of value) {
    const step = parseTerrainStep(entry, buildings);
    if (step) steps.push(step);
  }
  return steps;
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
 *
 * A damaged terrain step is dropped too. Steps sit beside the buildings and
 * name them by index, so losing one moves nothing else, and a step of a kind a
 * later version adds must not cost the buildings it travelled with.
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

  const terrain = parseTerrainSteps(v.terrain, buildings.length);

  const footprints: Record<string, PayloadFootprint> = {};
  if (typeof v.footprints === "object" && v.footprints !== null) {
    for (const [def, entry] of Object.entries(v.footprints)) {
      const footprint = parseFootprint(entry);
      if (footprint) footprints[def.toLowerCase()] = footprint;
    }
  }

  const game = parseGameIdentity(v.game);
  const designedFor =
    typeof v.designedFor === "string" && v.designedFor.trim() !== ""
      ? v.designedFor.trim()
      : undefined;
  return {
    ...(game ? { game } : {}),
    name: v.name,
    ...(designedFor ? { designedFor } : {}),
    ...(v.ordered === true ? { ordered: true } : {}),
    buildings,
    ...(terrain.length > 0 ? { terrain } : {}),
    footprints,
  };
}
