/**
 * Resizing a generated shape by dragging one of its faces (issue #3331).
 *
 * A shape stores a box `size`, so a resize changes numbers and the piece's
 * scale stays at 1. The pointer asks for a size along one of the shape's own
 * axes. `landSize` turns that into the size the drag lands on: whole part units
 * unless snapping is held off, and never below the shape's limit.
 *
 * What stays put, as it does for a pack block (`resizePackBlock.ts`):
 * - The face opposite the dragged one stays where it is in space, so the
 *   piece's position moves to make it so. With the origin at the middle of the
 *   box that is half the change.
 * - Children that are not joined stay where they are in the world. Joined
 *   children follow their connector, by the rule in `joinedWorld.ts`.
 * - A joined piece stays on its own join, which wins over the opposite face.
 *
 * A round shape's two cross axes are one radius, so dragging either of them
 * sizes both.
 */

import * as THREE from "three";

import { resolveConnections } from "./connectors";
import type { LegoPiece, LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { type Axis, turnAndScale } from "./resizePackBlock";
import { roundNumbers, withRoundNumber } from "./roundShape";
import { isKnownShapeKind, isRoundShapeKind, type LegoShape } from "./shapes";
import { MIN_SCREEN_THRESHOLD, type Vec3 } from "./snapping";
import { wedgeNumbers } from "./wedgeShape";
import { setPieceShape } from "./wheelAxle";

/**
 * The thinnest a shape may be dragged when the step is off. It is the distance
 * the builder already treats as the same plane, so a thinner shape could not be
 * told from a flat one.
 */
export const MIN_SHAPE_SIZE = MIN_SCREEN_THRESHOLD;

/** Two sizes this close are the same size. */
const SAME_SIZE = 1e-9;

/**
 * The shape's size along each of its own axes as it is drawn. A round shape
 * is as wide as its radius says on both cross axes.
 */
export function faceSizes(shape: LegoShape): Vec3 {
  if (!isRoundShapeKind(shape.kind)) return [...shape.size];
  const { axis, radius, length } = roundNumbers(shape);
  const sizes: Vec3 = [radius * 2, radius * 2, radius * 2];
  sizes[axis] = length;
  return sizes;
}

/**
 * The other axes that change with `axis` when it is dragged: a round shape's
 * two cross axes are one radius. None for any other drag.
 */
export function linkedAxes(shape: LegoShape, axis: Axis): Axis[] {
  if (!isRoundShapeKind(shape.kind)) return [];
  const along = roundNumbers(shape).axis;
  if (axis === along) return [];
  return ([0, 1, 2] as const).filter((k) => k !== axis && k !== along);
}

/** The size along `axis` that a drag may not reach, or may not go below. */
interface Limit {
  value: number;
  /** Whether `value` itself is out of reach: above it, not at it. */
  exclusive: boolean;
}

/**
 * How small the shape may be made along `axis`. Above zero everywhere. A tube's
 * wall and a cone's top radius must stay below the radius, and a wedge cannot
 * be shorter than its low end.
 */
export function lowestSize(shape: LegoShape, axis: Axis): Limit {
  if (isRoundShapeKind(shape.kind)) {
    const numbers = roundNumbers(shape);
    if (axis !== numbers.axis) {
      const value = 2 * Math.max(numbers.wall ?? 0, numbers.top ?? 0);
      return { value, exclusive: true };
    }
  }
  if (shape.kind === "wedge" && axis === 1) {
    const { low } = wedgeNumbers(shape);
    if (low > 0) return { value: low, exclusive: false };
  }
  return { value: 0, exclusive: true };
}

function meets(size: number, limit: Limit): boolean {
  return limit.exclusive
    ? size > limit.value + SAME_SIZE
    : size >= limit.value - SAME_SIZE;
}

/**
 * The size a drag lands on when the pointer asks for `wanted`. In whole steps
 * (`step` null is Alt held, no steps) and never below the limit: the drag
 * stops there.
 */
export function landSize(
  shape: LegoShape,
  axis: Axis,
  wanted: number,
  step: number | null,
): number {
  const limit = lowestSize(shape, axis);
  if (step === null || !(step > 0)) {
    const free = limit.value + (limit.exclusive ? MIN_SHAPE_SIZE : 0);
    return Math.max(wanted, free);
  }
  let count = Math.max(1, Math.round(wanted / step));
  while (!meets(count * step, limit)) count++;
  return Number((count * step).toFixed(6));
}

/**
 * The shape with `size` along `axis`, or null when it cannot take it. A round
 * shape's cross axes set its radius, so both change.
 */
export function withFaceSize(
  shape: LegoShape,
  axis: Axis,
  size: number,
): LegoShape | null {
  if (isRoundShapeKind(shape.kind)) {
    const along = roundNumbers(shape).axis;
    const result =
      axis === along
        ? withRoundNumber(shape, "length", size)
        : withRoundNumber(shape, "radius", size / 2);
    return "shape" in result ? result.shape : null;
  }
  const next: [number, number, number] = [...shape.size];
  next[axis] = size;
  return { ...shape, size: next };
}

/** Where a pivot coordinate goes when its axis changes length: a pivot on a
 *  face stays on it, anywhere else keeps its place, clamped to the new box. */
function pivotAlong(value: number, was: number, now: number): number {
  if (was > 0 && Math.abs(Math.abs(value) - was / 2) < 1e-6) {
    return (value > 0 ? 1 : -1) * (now / 2);
  }
  return Math.min(now / 2, Math.max(-now / 2, value));
}

export interface ShapeResizeResult {
  project: LegoProject;
  /** The size along the dragged axis now. */
  size: number;
  /** Pieces whose join this resize left unable to be made. */
  broken: string[];
}

/**
 * The project with one shape resized along one of its own axes.
 *
 * `axis` is the shape axis whose face is dragged and `sign` says which end:
 * the high face (1) or the low one (-1). `wanted` is the size asked for, which
 * is kept above the shape's limit. The change goes through `setPieceShape`, as
 * the piece panel's does, so a wheel keeps its axle on the spin axis. Null when
 * there is nothing to change: no such shape piece, or a size the shape already
 * has.
 */
export function resizeShapeFace(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  axis: Axis,
  sign: 1 | -1,
  wanted: number,
): ShapeResizeResult | null {
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece?.shape || piece.partId || !isKnownShapeKind(piece.shape.kind)) {
    return null;
  }
  const was = faceSizes(piece.shape);
  const size = landSize(piece.shape, axis, wanted, null);
  if (Math.abs(size - was[axis]) < SAME_SIZE) return null;
  const shape = withFaceSize(piece.shape, axis, size);
  if (!shape) return null;
  const now = faceSizes(shape);

  const reshaped = setPieceShape(project, pieceId, shape);
  const turned = reshaped.pieces.find((p) => p.id === pieceId) as LegoPiece;
  const turn = turnAndScale(turned);

  // The shape is centred on its box, so the fixed face moves in the shape's
  // space when the box grows: from -sign * was / 2 to -sign * now / 2. The
  // pivot follows the same rule as a pack block's.
  const fixed = -sign;
  const pivotFrom: Vec3 = turned.pivot ?? [0, 0, 0];
  const pivotTo = pivotFrom.map((value, k) =>
    pivotAlong(value, was[k], now[k]),
  ) as Vec3;
  const gone = new THREE.Vector3(...pivotFrom).negate();
  gone.setComponent(axis, gone.getComponent(axis) + (fixed * was[axis]) / 2);
  const kept = new THREE.Vector3(...pivotTo).negate();
  kept.setComponent(axis, kept.getComponent(axis) + (fixed * now[axis]) / 2);
  const offset = gone.sub(kept).applyMatrix4(turn);

  const slide = (fixed * (now[axis] - was[axis])) / 2;
  const joined = piece.connection !== undefined;
  const placed: LegoProject = {
    ...reshaped,
    pieces: reshaped.pieces.map((p) => {
      if (p.id !== pieceId) return p;
      const next: LegoPiece = { ...p };
      if (p.pivot || pivotTo.some((value) => value !== 0)) next.pivot = pivotTo;
      if (slide !== 0 && p.customAnchors) {
        next.customAnchors = p.customAnchors.map((anchor) => {
          const position: Vec3 = [...anchor.position];
          position[axis] += slide;
          return { ...anchor, position };
        });
      }
      if (!joined) {
        next.position = [
          piece.position[0] + offset.x,
          piece.position[1] + offset.y,
          piece.position[2] + offset.z,
        ];
      }
      return next;
    }),
  };

  // A join is placed from the shape and the pivot as they are now.
  const resolved = resolveConnections(placed, pack);
  const origin = resolved.project.pieces.find((p) => p.id === pieceId);
  if (!origin) return null;
  const moved = new THREE.Vector3(
    origin.position[0] - piece.position[0],
    origin.position[1] - piece.position[1],
    origin.position[2] - piece.position[2],
  ).applyMatrix4(turn.clone().invert());

  const out: LegoProject = {
    ...resolved.project,
    pieces: resolved.project.pieces.map((p) =>
      p.parentId === pieceId && !p.connection
        ? {
            ...p,
            position: [
              p.position[0] - moved.x,
              p.position[1] - moved.y,
              p.position[2] - moved.z,
            ] as Vec3,
          }
        : p,
    ),
  };

  const before = new Set(resolveConnections(project, pack).broken);
  return {
    project: out,
    size,
    broken: resolved.broken.filter((id) => !before.has(id)),
  };
}

function shown(value: number): number {
  return Number(value.toFixed(2));
}

/** What to tell the game maker mid-drag: the size the drag has landed on, in
 *  elmos and in part units. */
export function shapeReadout(size: number, unit: number): string {
  return `${shown(size)} elmos, ${shown(size / unit)} units`;
}
