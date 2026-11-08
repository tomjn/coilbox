/**
 * The wheels and treads a generated wheeled or tracked unit stands on (issue
 * #5117).
 *
 * The body plans put a bare bone where every wheel goes, and a bare bone for
 * each track. Without parts on them the unit has nothing to stand on, so its
 * balance was guessed from the underside of the body.
 *
 * - A wheel is one round part from the pack on the wheel bone, scaled the same
 *   on every axis to the bone's height above the ground, which is the wheel's
 *   radius, so it touches the ground. The part turns about its middle, where the
 *   bone is, so the wheels preset spins it. A part with a hub has it turned to
 *   the outside.
 * - A tread is a box shaped part of the pack along each track, in as many
 *   copies as the track is long. The track bone is the middle of the track, so
 *   the tread is scaled to twice the bone's height above the ground, which puts
 *   its underside on the ground. It is as long as the road wheels' span is
 *   `ROAD_WHEEL_SPAN` of. Its thickness is what the part gives at that height.
 * - A road wheel is a wheel on a bone under a track. It is held to half the
 *   distance to the next road wheel, so a crowded track gets smaller wheels
 *   instead of wheels that pass through each other, and those do not reach the
 *   ground, the tread does. It is moved out along its axle to stand against
 *   the tread's outer face, where it shows. Moving along the axle leaves it
 *   turning about its own middle.
 *
 * Every piece is the child of the bone it is on, and `LegoGenerated.running`
 * names it and the bone, so a reroll finds it. Nothing here rolls more than the
 * part to use, one roll for all the wheels, one for all the road wheels and one
 * for each side's tread, so the unit stays symmetric.
 */

import * as THREE from "three";
import { pick } from "../conquest/rng";
import {
  coverParts,
  isWheel,
  jointOf,
  laidAlong,
  MAX_PART_SCALE,
  sideless,
  sortedSizes,
  spaced,
  TOUCH,
} from "./covering";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  pieceById,
  uniquePieceName,
} from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { ROAD_WHEEL_SPAN } from "./vehiclePlans";

/**
 * The pack's round parts that make a wheel, by part id, which is a hash of the
 * part so it survives a rebuild of the pack. `axle` is the axis the part is
 * round about. `hub` says one face, the one on the low side of the axle, has a
 * hub in it.
 */
const WHEEL_PARTS: readonly { id: string; axle: 0 | 1 | 2; hub: boolean }[] = [
  { id: "2c9119b8312f", axle: 0, hub: true },
  { id: "33fe1e0324a5", axle: 0, hub: true },
  { id: "46fc689d2d63", axle: 1, hub: false },
];

/**
 * The pack's parts that make a tread: plain boxes, by part id, laid with the
 * longest axis along the track, the middle axis up and the shortest across.
 * Others of the same sizes are wedges, or have studs and bevels that show
 * along a track.
 */
const TREAD_PARTS: readonly string[] = [
  "3c550d542d37",
  "a2d9670d7b32",
  "bf1a43ccc72a",
  "1f1e3ee7a4e2",
  "ff9c6d2ad329",
];

/** How many of the tread parts with the fewest copies a roll chooses from. */
const TREADS_CHOSEN_FROM = 3;

/**
 * How much of a track's length the copies of a tread may fall short of, as a
 * share. A choice, not a measurement: it spares a second copy that would
 * overlap the first almost everywhere.
 */
const TREAD_SHORT = 0.1;

export interface RunningGearEntry {
  bone: string;
  piece: string;
  kind: "wheel" | "tread";
}

export interface RunningGearResult {
  project: LegoProject;
  gear: RunningGearEntry[];
}

export interface RunningGearOptions {
  pack: LoadedPack;
  /** The chassis's top piece, whose part sets the colourway. */
  chassis: string | null;
  newId: () => string;
  /** A PRNG for a choice's key. */
  roll: (key: string) => () => number;
}

/** A wheel part and how big it is. */
interface WheelFit {
  part: LegoPartInfo;
  hub: boolean;
  axle: 0 | 1 | 2;
  /** Half the thickness and the radius at scale 1. */
  halfThick: number;
  radius: number;
}

/** The wheel parts the pack has, in the colourway of the unit. */
function wheelFits(
  pack: LoadedPack,
  parts: readonly LegoPartInfo[],
): WheelFit[] {
  const out: WheelFit[] = [];
  for (const { id, axle, hub } of WHEEL_PARTS) {
    const base = pack.byId.get(id);
    if (!base) continue;
    const part = parts.find((p) => p.shapeId === base.shapeId) ?? base;
    const half = [0, 1, 2].map(
      (a) => (part.bbox.max[a] - part.bbox.min[a]) / 2,
    );
    const across = half.filter((_, a) => a !== axle);
    out.push({
      part,
      hub,
      axle,
      halfThick: half[axle] as number,
      radius: Math.max(...across),
    });
  }
  return out;
}

/** The distance along z to the nearest other wheel on the same bone, or
 *  infinity for a wheel with none. */
function nearestAlongZ(project: LegoProject, wheel: LegoPiece): number {
  let nearest = Number.POSITIVE_INFINITY;
  const z = wheel.position[2];
  for (const other of childrenOf(project, wheel.parentId ?? "")) {
    if (other.id === wheel.id || !isWheel(other)) continue;
    nearest = Math.min(nearest, Math.abs(other.position[2] - z));
  }
  return nearest;
}

/** Whether a wheel bone is a road wheel: it is hung from a track. */
function isRoadWheel(project: LegoProject, wheel: LegoPiece): boolean {
  return pieceById(project, wheel.parentId ?? "")?.role === "track";
}

/** A tread, in the track bone's own space. */
interface Tread {
  part: LegoPartInfo;
  scale: number;
  copies: number;
  /** The middle and length of the track along z, and how long one copy is. */
  centre: number;
  length: number;
  long: number;
  /** How thick, across the track, at its scale. */
  depth: number;
  /** The part's axes, longest first. */
  axes: number[];
}

/**
 * The tread for a track `length` long and `height` high: the part whose middle
 * size, scaled to the height, fills it. The parts with the fewest copies come
 * first, and a roll chooses between the first few.
 */
function treadFit(
  parts: readonly LegoPartInfo[],
  length: number,
  height: number,
  centre: number,
  rng: () => number,
): Tread | undefined {
  const fits: Tread[] = [];
  for (const part of parts) {
    const [long, mid, short] = sortedSizes(part);
    if (!long || !mid || !short || mid.size <= 0) continue;
    const scale = height / mid.size;
    if (scale > MAX_PART_SCALE) continue;
    fits.push({
      part,
      scale,
      copies: Math.max(
        1,
        Math.ceil(length / (long.size * scale) - TREAD_SHORT - 1e-9),
      ),
      centre,
      length,
      long: long.size * scale,
      depth: short.size * scale,
      axes: [long.axis, mid.axis, short.axis],
    });
  }
  fits.sort(
    (a, b) =>
      a.copies - b.copies ||
      (a.part.id < b.part.id ? -1 : a.part.id > b.part.id ? 1 : 0),
  );
  const chosen = fits.slice(0, TREADS_CHOSEN_FROM);
  return chosen.length > 0 ? pick(rng, chosen) : undefined;
}

/**
 * The project with a wheel on every wheel bone and a tread on every track
 * bone, and which piece is on which bone. A pack without a wheel part gets
 * none, and the bones stay bare.
 */
export function addRunningGear(
  start: LegoProject,
  options: RunningGearOptions,
): RunningGearResult {
  const { pack, roll } = options;
  const project = start;
  const parts = coverParts(project, pack, options.chassis);
  const treadParts = TREAD_PARTS.flatMap((id) => {
    const base = pack.byId.get(id);
    const part =
      base && (parts.find((p) => p.shapeId === base.shapeId) ?? base);
    return part ? [part] : [];
  });
  const fits = wheelFits(pack, parts);
  if (fits.length === 0) return { project, gear: [] };

  const names = project.pieces.map((p) => p.name);
  const added: LegoPiece[] = [];
  const gear: RunningGearEntry[] = [];
  const record = (
    bone: LegoPiece,
    piece: LegoPiece,
    kind: "wheel" | "tread",
  ) => {
    added.push(piece);
    gear.push({ bone: bone.bone ?? bone.id, piece: piece.id, kind });
  };

  // The tread of each track, which the road wheels stand against.
  const treads = new Map<string, Tread>();
  for (const track of project.pieces) {
    if (track.bone === undefined || track.role !== "track") continue;
    const wheels = childrenOf(project, track.id).filter(isWheel);
    const height = 2 * jointOf(project, track.id).y;
    if (wheels.length < 2 || !(height > TOUCH)) continue;
    const zs = wheels.map((w) => w.position[2]);
    const low = Math.min(...zs);
    const high = Math.max(...zs);
    const tread = treadFit(
      treadParts,
      (high - low) / ROAD_WHEEL_SPAN,
      height,
      (low + high) / 2,
      roll(`gear:tread:${sideless(track.bone)}`),
    );
    if (tread) treads.set(track.id, tread);
  }

  const chosen = new Map<string, WheelFit>();
  const choice = (key: string, radius: number): WheelFit | undefined => {
    const fitting = fits.filter((f) => radius / f.radius <= MAX_PART_SCALE);
    if (fitting.length === 0) return undefined;
    const known = chosen.get(key);
    if (known && fitting.includes(known)) return known;
    const fit = pick(roll(`gear:${key}`), fitting);
    chosen.set(key, fit);
    return fit;
  };

  for (const bone of project.pieces) {
    if (bone.bone === undefined || !isWheel(bone)) continue;
    const road = isRoadWheel(project, bone);
    const joint = jointOf(project, bone.id);
    // A wheel on the ground is as big as it is high.
    const radius = Math.min(
      Math.max(joint.y, 0),
      road ? nearestAlongZ(project, bone) / 2 : Number.POSITIVE_INFINITY,
    );
    if (!(radius > TOUCH)) continue;
    const fit = choice(road ? "roadwheel" : "wheel", radius);
    if (!fit) continue;
    const scale = radius / fit.radius;
    const outward = joint.x > TOUCH ? 1 : joint.x < -TOUCH ? -1 : 0;
    // The hub is on the part's low side, so a wheel on the unit's left (+x)
    // is turned half way round to put it on the outside.
    const rotation: [number, number, number] =
      fit.axle === 1
        ? [0, 0, Math.PI / 2]
        : fit.hub && outward > 0
          ? [0, Math.PI, 0]
          : [0, 0, 0];
    const tread = road ? treads.get(bone.parentId ?? "") : undefined;
    const x = tread ? outward * (tread.depth / 2 + fit.halfThick * scale) : 0;
    const name = uniquePieceName(`${bone.name}rim`, names);
    names.push(name);
    record(
      bone,
      {
        id: options.newId(),
        name,
        parentId: bone.id,
        partId: fit.part.id,
        position: [x, 0, 0],
        rotation,
        scale: [scale, scale, scale],
      },
      "wheel",
    );
  }

  for (const [trackId, tread] of treads) {
    const track = pieceById(project, trackId) as LegoPiece;
    const rotation = laidAlong(tread.axes, [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    ]);
    for (let i = 0; i < tread.copies; i++) {
      const name = uniquePieceName(`${track.name}tread`, names);
      names.push(name);
      record(
        track,
        {
          id: options.newId(),
          name,
          parentId: track.id,
          partId: tread.part.id,
          position: [
            0,
            0,
            tread.centre + spaced(i, tread.copies, tread.length, tread.long),
          ],
          rotation: [...rotation],
          scale: [tread.scale, tread.scale, tread.scale],
        },
        "tread",
      );
    }
  }
  return {
    project: { ...project, pieces: [...project.pieces, ...added] },
    gear,
  };
}
