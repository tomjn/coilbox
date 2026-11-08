/**
 * The structural parts a generated unit is covered in (issue #3233).
 *
 * After the generator hangs its modules on the skeleton, it fills out the body
 * around the bones with ordinary blocks, beams and plates from the pack, so the
 * unit looks like a vehicle or a creature rather than a few lines with a gun on
 * top. The game maker can then move, swap or delete them like any other piece.
 *
 * There are three kinds of covering:
 *
 * - A deck under the chassis, on the bone the chassis goes on, as wide and as
 *   long as the skeleton (`skeletonSize`). Its top is the bone's joint, so the
 *   chassis sits on it. A job can leave it off (`CoveringRule.body`).
 * - A span along each bone that has a child bone, from joint to joint: a thigh
 *   from hip to knee, a shin from knee to ankle, a spar from the body to each
 *   hip or track.
 * - A housing round each axle: from one wheel of a pair to the other, stopping
 *   short of each wheel.
 *
 * Each covering part is a child of the bone it covers, so it moves with it, and
 * `LegoGenerated.covering` names that bone. Each is sized from the bones: a
 * part from the pack whose proportions come nearest, turned to lie along the
 * bone and scaled the same on every axis so its texture is not stretched. A
 * length longer than one part can cover at `MAX_PART_SCALE` takes several in a
 * row, and a deck several rows.
 *
 * Nothing buries a weapon, a build arm or a wheel. A part whose box would meet
 * the box of a module other than the chassis, or the room a wheel bone needs,
 * is left out, and a deck is narrowed to stop short of the wheels beside it.
 *
 * Every choice is made from the skeleton and the rolls the caller passes, so
 * the same seed gives the same covering.
 */

import * as THREE from "three";
import { pick } from "../conquest/rng";
import type { CoveringRule } from "./generatorJobs";
import {
  childrenOf,
  type LegoPiece,
  type LegoProject,
  pieceById,
  uniquePieceName,
} from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { worldMatrix } from "./reparent";

/**
 * The most a generated piece is scaled, a module or a covering part. A choice,
 * not a measurement: below it a part keeps its texture's detail, and a longer
 * length takes more parts.
 */
export const MAX_PART_SCALE = 12;

export interface CoveringOptions {
  pack: LoadedPack;
  rule: CoveringRule;
  /** The bone the chassis is on, and the chassis's top piece. */
  anchor: LegoPiece;
  chassis: string | null;
  /** The instances that must not be buried: every module but the chassis. */
  keepClear: ReadonlySet<string>;
  /** The skeleton's width and length in elmos, and the unit's width. */
  size: { x: number; z: number };
  width: number;
  newId: () => string;
  /** A PRNG for a choice's key. */
  roll: (key: string) => () => number;
}

export interface CoveringResult {
  project: LegoProject;
  covering: { bone: string; piece: string }[];
}

/** An axis aligned box in the unit's space. */
interface Box {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** Roles whose bones are a weapon's, a wheel's or a marker's, never covered. */
const GUN_ROLES = new Set(["turret", "aim", "barrel", "flare"]);
const GUN_BONES = new Set(["turret", "barrel", "flare"]);
const MARKER_ROLES = new Set(["wake", "rudder"]);

/** Two boxes this close are touching, not overlapping. */
const TOUCH = 1e-6;

/** The parts that may cover a span, and those that may make a deck. */
const SPAN_SHAPES = ["beam", "block"];
const DECK_SHAPES = ["plate", "block"];

/**
 * A number held to nine places, so the same seed gives the same document. A
 * part's turn is worked out with trigonometry, and its last bit differed
 * between a full test run and a run of the generator's tests alone.
 */
function settle(value: number): number {
  return Math.round(value * 1e9) / 1e9 || 0;
}

/** The id a part is measured under before it is kept. */
const PROBE = "covering.probe";

/** How many of the closest fitting parts a roll chooses between. */
const CLOSEST = 3;

export function boxesOverlap(a: Box, b: Box): boolean {
  for (const axis of ["x", "y", "z"] as const) {
    if (a.max[axis] <= b.min[axis] + TOUCH) return false;
    if (b.max[axis] <= a.min[axis] + TOUCH) return false;
  }
  return true;
}

/** A piece's own box in the unit's space, or null for a piece with no part. */
export function pieceWorldBox(
  project: LegoProject,
  pack: LoadedPack,
  piece: LegoPiece,
): Box | null {
  const bbox = piece.partId ? pack.byId.get(piece.partId)?.bbox : undefined;
  if (!bbox) return null;
  const pivot = piece.pivot ?? [0, 0, 0];
  const world = worldMatrix(project, piece.id);
  const box = { min: new THREE.Vector3(Infinity, Infinity, Infinity) };
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let corner = 0; corner < 8; corner++) {
    const point = new THREE.Vector3(
      (corner & 1 ? bbox.max[0] : bbox.min[0]) - pivot[0],
      (corner & 2 ? bbox.max[1] : bbox.min[1]) - pivot[1],
      (corner & 4 ? bbox.max[2] : bbox.min[2]) - pivot[2],
    ).applyMatrix4(world);
    box.min.min(point);
    max.max(point);
  }
  return { min: box.min, max };
}

/** Where a piece's origin is in the unit's space. */
function jointOf(project: LegoProject, pieceId: string): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(
    worldMatrix(project, pieceId),
  );
}

/** The room a wheel bone needs: a cube as wide as the wheel is tall, round its
 *  joint. A wheel touches the ground, so its joint's height is its radius. */
function wheelRoom(project: LegoProject, bone: LegoPiece): Box {
  const joint = jointOf(project, bone.id);
  const r = Math.max(joint.y, 0);
  const half = new THREE.Vector3(r, r, r);
  return { min: joint.clone().sub(half), max: joint.clone().add(half) };
}

function isWheel(piece: LegoPiece): boolean {
  return piece.bone !== undefined && piece.role === "wheel";
}

function isGunBone(piece: LegoPiece): boolean {
  return (
    GUN_BONES.has(piece.bone ?? "") ||
    (piece.role !== undefined && GUN_ROLES.has(piece.role))
  );
}

/**
 * The same key for a bone and its twin across the centre line, so a pair of
 * legs rolls the same part and the unit stays symmetric.
 */
function sideless(bone: string): string {
  return bone.replace(/\.r(\d*)/g, ".l$1");
}

/** A part's three sizes, longest first, with the axis each is along. */
function sortedSizes(part: LegoPartInfo): { size: number; axis: number }[] {
  return [0, 1, 2]
    .map((axis) => ({
      size: part.bbox.max[axis] - part.bbox.min[axis],
      axis,
    }))
    .sort((a, b) => b.size - a.size || a.axis - b.axis);
}

interface Fit {
  part: LegoPartInfo;
  scale: number;
  /** Copies along the length and across the width. */
  along: number;
  across: number;
  /** The part's own axes, longest first. */
  axes: number[];
  /** How deep one copy is, at its scale. */
  depth: number;
  error: number;
}

/**
 * The best parts for a box `length` long, `width` wide and `depth` deep, made
 * of rows of copies when one is not enough at `MAX_PART_SCALE`. A span is one
 * row, with its width and depth the thickness. A deck has as many rows as its
 * width needs. The error is how far, in ratio, the copies' size is from the
 * box's on the two axes the length does not set.
 */
function fits(
  parts: readonly LegoPartInfo[],
  length: number,
  width: number,
  depth: number,
  rows: boolean,
): Fit[] {
  const out: Fit[] = [];
  for (const part of parts) {
    const [long, mid, short] = sortedSizes(part);
    if (!long || !mid || !short || short.size <= 0) continue;
    const along = Math.max(1, Math.ceil(length / (long.size * MAX_PART_SCALE)));
    const byLength = length / (along * long.size);
    let scale = byLength;
    let across = 1;
    let widthError: number;
    if (rows) {
      across = Math.max(1, Math.ceil(width / (mid.size * MAX_PART_SCALE)));
      const byWidth = width / (across * mid.size);
      scale = Math.min(byLength, byWidth);
      widthError = Math.abs(Math.log(byLength / byWidth));
    } else {
      widthError = Math.abs(Math.log((mid.size * scale) / width));
    }
    const depthError = Math.abs(Math.log((short.size * scale) / depth));
    out.push({
      part,
      scale,
      along,
      across,
      axes: [long.axis, mid.axis, short.axis],
      depth: short.size * scale,
      error: widthError + depthError,
    });
  }
  return out.sort(
    (a, b) =>
      a.error - b.error ||
      (a.part.id < b.part.id ? -1 : a.part.id > b.part.id ? 1 : 0),
  );
}

/**
 * The rotation that lays a part's axes, longest first, along `frame`'s three
 * directions. A part is a box, so a direction may be reversed to keep it a
 * rotation rather than a mirror.
 */
function laidAlong(axes: number[], frame: THREE.Vector3[]): THREE.Euler {
  const columns = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  axes.forEach((axis, i) => {
    columns[axis]?.copy(frame[i] as THREE.Vector3);
  });
  const basis = new THREE.Matrix4().makeBasis(
    columns[0] as THREE.Vector3,
    columns[1] as THREE.Vector3,
    columns[2] as THREE.Vector3,
  );
  if (basis.determinant() < 0) {
    const last = axes[2] as number;
    columns[last]?.negate();
    basis.makeBasis(
      columns[0] as THREE.Vector3,
      columns[1] as THREE.Vector3,
      columns[2] as THREE.Vector3,
    );
  }
  return new THREE.Euler().setFromRotationMatrix(basis);
}

/** Two directions square to `along`: across it level with the ground where
 *  that can be, and the third. */
function frameFor(along: THREE.Vector3): THREE.Vector3[] {
  const up =
    Math.abs(along.y) > 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
  const across = new THREE.Vector3().crossVectors(up, along).normalize();
  const third = new THREE.Vector3().crossVectors(along, across).normalize();
  return [along.clone(), across, third];
}

interface Plan {
  bone: LegoPiece;
  /** The middle of the box, in the bone's own space. */
  centre: THREE.Vector3;
  /** The box's three directions, length first, in the bone's own space. */
  frame: THREE.Vector3[];
  length: number;
  width: number;
  depth: number;
  rows: boolean;
  shapes: string[];
  key: string;
}

/**
 * The project with the covering added, and which bone each part covers. The
 * chassis is lifted onto the deck when the deck would otherwise reach below the
 * ground.
 */
export function coverSkeleton(
  start: LegoProject,
  options: CoveringOptions,
): CoveringResult {
  const { pack, rule, anchor, roll } = options;
  let project = start;
  const thickness =
    options.width *
    (rule.thickness[0] +
      (rule.thickness[1] - rule.thickness[0]) * roll("covering:thickness")());
  if (!(thickness > 0)) return { project, covering: [] };

  const chassisPart = options.chassis
    ? pieceById(project, options.chassis)?.partId
    : null;
  const colourway =
    (chassisPart && pack.byId.get(chassisPart)?.colourway) ?? "grey";
  const parts = pack.parts.filter(
    (p) => p.colourway === colourway && p.packId === pack.manifest.id,
  );

  const bones = project.pieces.filter((p) => p.bone !== undefined);
  const wheels = bones.filter(isWheel).map((w) => wheelRoom(project, w));
  const plans: Plan[] = [];

  if (rule.body) {
    // Below the ground is out of sight, so the deck and the chassis on it are
    // lifted to stand on it.
    const joint = jointOf(project, anchor.id);
    const lift = Math.max(0, thickness - joint.y);
    // Narrowed to stop short of a wheel beside it.
    let halfX = options.size.x / 2;
    const halfZ = options.size.z / 2;
    for (const room of wheels) {
      const overlapsY =
        room.max.y > joint.y + lift - thickness + TOUCH &&
        room.min.y < joint.y + lift - TOUCH;
      const overlapsZ =
        room.max.z > joint.z - halfZ + TOUCH &&
        room.min.z < joint.z + halfZ - TOUCH;
      if (!overlapsY || !overlapsZ) continue;
      if (room.min.x >= joint.x) halfX = Math.min(halfX, room.min.x - joint.x);
      else if (room.max.x <= joint.x)
        halfX = Math.min(halfX, joint.x - room.max.x);
    }
    if (lift > 0 && options.chassis) {
      project = {
        ...project,
        pieces: project.pieces.map((p) =>
          p.id === options.chassis
            ? {
                ...p,
                position: [p.position[0], p.position[1] + lift, p.position[2]],
              }
            : p,
        ),
      };
    }
    const longX = halfX >= halfZ;
    const x = new THREE.Vector3(1, 0, 0);
    const z = new THREE.Vector3(0, 0, 1);
    if (halfX > 0 && halfZ > 0) {
      plans.push({
        bone: anchor,
        centre: new THREE.Vector3(0, lift - thickness / 2, 0),
        frame: longX
          ? [x, z, new THREE.Vector3(0, 1, 0)]
          : [z, x, new THREE.Vector3(0, 1, 0)],
        length: 2 * (longX ? halfX : halfZ),
        width: 2 * (longX ? halfZ : halfX),
        depth: thickness,
        rows: true,
        shapes: DECK_SHAPES,
        key: `deck:${anchor.bone}`,
      });
    }
  }

  const root = pieceById(project, project.rootPieceId);
  for (const bone of bones) {
    if (isWheel(bone) || isGunBone(bone)) continue;
    // A root on the ground is the unit's foot point, not a part of its body.
    if (bone.id === root?.id && bone.id !== anchor.id) continue;
    const children = childrenOf(project, bone.id).filter(
      (c) => c.bone !== undefined,
    );
    for (const child of children) {
      const to = new THREE.Vector3(...child.position);
      if (isWheel(child)) {
        // An axle: from this wheel to its twin, once a pair, from the left.
        const twin = children.find((c) => c.id === child.twin);
        if (!twin || child.position[0] <= 0) continue;
        const from = new THREE.Vector3(...twin.position);
        const r = Math.max(jointOf(project, child.id).y, 0);
        const span = to.clone().sub(from);
        const length = span.length() - 2 * r;
        if (length <= 0) continue;
        const along = span.normalize();
        plans.push({
          bone,
          centre: from.clone().add(to).multiplyScalar(0.5),
          frame: frameFor(along),
          length,
          width: thickness / 2,
          depth: thickness / 2,
          rows: false,
          shapes: SPAN_SHAPES,
          key: `axle:${sideless(child.bone ?? "")}`,
        });
        continue;
      }
      if (isGunBone(child) || MARKER_ROLES.has(child.role ?? "")) continue;
      const length = to.length();
      if (length <= TOUCH) continue;
      plans.push({
        bone,
        centre: to.clone().multiplyScalar(0.5),
        frame: frameFor(to.clone().normalize()),
        length,
        width: thickness,
        depth: thickness,
        rows: false,
        shapes: SPAN_SHAPES,
        key: `span:${sideless(bone.bone ?? "")}:${sideless(child.bone ?? "")}`,
      });
    }
  }

  // Where every module but the chassis is, now the chassis has its place.
  const keepOut: Box[] = [...wheels];
  for (const piece of project.pieces) {
    if (!piece.module || !options.keepClear.has(piece.module.instance))
      continue;
    const box = pieceWorldBox(project, pack, piece);
    if (box) keepOut.push(box);
  }

  const covering: CoveringResult["covering"] = [];
  for (const plan of plans) {
    const candidates = fits(
      parts.filter((p) => plan.shapes.includes(p.shape)),
      plan.length,
      plan.width,
      plan.depth,
      plan.rows,
    ).slice(0, CLOSEST);
    if (candidates.length === 0) continue;
    const fit = pick(roll(`covering:${plan.key}`), candidates);
    const rotation = laidAlong(fit.axes, plan.frame);
    const [along, across] = plan.frame as [THREE.Vector3, THREE.Vector3];
    for (let i = 0; i < fit.along; i++) {
      for (let j = 0; j < fit.across; j++) {
        const at = plan.centre
          .clone()
          .addScaledVector(along, ((i + 0.5) / fit.along - 0.5) * plan.length)
          .addScaledVector(
            across,
            plan.rows ? ((j + 0.5) / fit.across - 0.5) * plan.width : 0,
          );
        // A deck's parts keep their tops on the deck's top, so one thicker
        // than the deck reaches down rather than up into the chassis.
        if (plan.rows)
          at.addScaledVector(
            plan.frame[2] as THREE.Vector3,
            (plan.depth - fit.depth) / 2,
          );
        const piece: LegoPiece = {
          id: PROBE,
          name: uniquePieceName(
            `${plan.bone.name}cover`,
            project.pieces.map((p) => p.name),
          ),
          parentId: plan.bone.id,
          partId: fit.part.id,
          position: [settle(at.x), settle(at.y), settle(at.z)],
          rotation: [
            settle(rotation.x),
            settle(rotation.y),
            settle(rotation.z),
          ],
          scale: [settle(fit.scale), settle(fit.scale), settle(fit.scale)],
        };
        const next = { ...project, pieces: [...project.pieces, piece] };
        const box = pieceWorldBox(next, pack, piece);
        if (!box || keepOut.some((room) => boxesOverlap(box, room))) continue;
        const id = options.newId();
        project = {
          ...project,
          pieces: [...project.pieces, { ...piece, id }],
        };
        covering.push({ bone: plan.bone.bone ?? plan.bone.id, piece: id });
      }
    }
  }
  return { project, covering };
}
