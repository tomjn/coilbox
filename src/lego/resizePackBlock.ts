/**
 * Resizing a pack block by dragging one of its faces (issue #3332).
 *
 * A pack part is a fixed mesh, so a resize swaps the piece for the part of the
 * size asked for. The pack does not have every size, so a drag lands on the
 * nearest size it does have, among the parts that agree on the other two axes.
 *
 * Sizes are compared axis by axis in the part's own space. A part with the same
 * three sizes in another order would need the piece turned, which would move
 * its children, so it is not a match.
 *
 * What stays put:
 * - The face opposite the dragged one stays where it is in space, so the piece's
 *   position moves to make it so.
 * - Children that are not joined stay where they are in the world. Joined
 *   children follow their connector, by the rule in `joinedWorld.ts`.
 * - A joined piece stays on its own join, which wins over the opposite face.
 * - Everything else the swap keeps, as `swapPart.ts` describes.
 *
 * The pivot is kept in the new part's space. One on a named place stays on it.
 * One anywhere else keeps its distance from the part's middle, clamped to the
 * new box.
 */

import * as THREE from "three";

import { resolveConnections } from "./connectors";
import type { LegoPiece, LegoProject } from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import { currentPivot, pivotChoices } from "./pivot";
import type { Vec3 } from "./snapping";
import { swapPart } from "./swapPart";

/** Two sizes this close are the same size. The tolerance the pack is counted at. */
export const SIZE_TOLERANCE = 0.005;

export type Axis = 0 | 1 | 2;

/** One size a block can be resized to along an axis, and the part that has it. */
export interface SizeChoice {
  size: number;
  part: LegoPartInfo;
}

/** The part's size along each of its own axes. */
export function blockSizes(part: Pick<LegoPartInfo, "bbox">): Vec3 {
  const { min, max } = part.bbox;
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < SIZE_TOLERANCE;
}

/**
 * The sizes the pack has along `axis` for a part: parts of the same pack,
 * colourway, shape and material whose sizes on the other two axes are the same
 * as the part's. Smallest first, one part per size, the part itself standing
 * for its own size.
 */
export function sizeChoices(
  pack: LoadedPack,
  part: LegoPartInfo,
  axis: Axis,
): SizeChoice[] {
  const sizes = blockSizes(part);
  const choices: SizeChoice[] = [];
  for (const other of pack.parts) {
    if (
      other.packId !== part.packId ||
      other.colourway !== part.colourway ||
      other.shape !== part.shape ||
      other.material !== part.material
    ) {
      continue;
    }
    const otherSizes = blockSizes(other);
    if (
      !([0, 1, 2] as const).every(
        (k) => k === axis || near(otherSizes[k], sizes[k]),
      )
    ) {
      continue;
    }
    const size = otherSizes[axis];
    const have = choices.findIndex((choice) => near(choice.size, size));
    if (have === -1) choices.push({ size, part: other });
    else if (other.id === part.id) choices[have] = { size, part: other };
  }
  return choices.sort((a, b) => a.size - b.size);
}

/** The choice nearest `wanted`, the smaller one on a tie, or null for none. */
export function nearestSize(
  choices: readonly SizeChoice[],
  wanted: number,
): SizeChoice | null {
  let best: SizeChoice | null = null;
  for (const choice of choices) {
    if (
      !best ||
      Math.abs(choice.size - wanted) < Math.abs(best.size - wanted)
    ) {
      best = choice;
    }
  }
  return best;
}

export interface ResizeResult {
  project: LegoProject;
  /** The part the piece is made of now. */
  partId: string;
  /** The size along the dragged axis that the pack part has. */
  size: number;
  /** Names of the anchors that fell outside the new part and were dropped. */
  droppedAnchors: string[];
  /** Pieces whose join this resize left unable to be made. */
  broken: string[];
}

/** The centre of a part's face on `axis`, `sign` being the high or low one. */
function faceCentre(
  part: Pick<LegoPartInfo, "bbox">,
  axis: Axis,
  sign: 1 | -1,
) {
  const { min, max } = part.bbox;
  const centre: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  centre[axis] = sign > 0 ? max[axis] : min[axis];
  return centre;
}

function turnAndScale(piece: LegoPiece): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rotation)),
    new THREE.Vector3(...piece.scale),
  );
}

function clampTo(part: LegoPartInfo, point: Vec3): Vec3 {
  return point.map((value, axis) =>
    Math.min(part.bbox.max[axis], Math.max(part.bbox.min[axis], value)),
  ) as Vec3;
}

/**
 * The project with one pack block resized along one of its own axes.
 *
 * `axis` is the part axis whose face is dragged and `sign` says which end:
 * the high face (1) or the low one (-1). `wanted` is the size the drag asks
 * for, in the part's own units. Null when there is nothing to change: no such
 * piece, a piece with no pack part, or a drag that lands on the size the piece
 * already is.
 */
export function resizePackBlock(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  axis: Axis,
  sign: 1 | -1,
  wanted: number,
): ResizeResult | null {
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece?.partId || piece.meshId) return null;
  const from = pack.byId.get(piece.partId);
  if (!from) return null;

  const chosen = nearestSize(sizeChoices(pack, from, axis), wanted);
  if (!chosen || chosen.part.id === from.id) return null;
  const to = chosen.part;

  // The face opposite the dragged one, in each part's space. The geometry is
  // recentred on each part, so a longer part has that face further out, and
  // anything written against the old part's space slides by the difference.
  const fixed = -sign as 1 | -1;
  const was = faceCentre(from, axis, fixed);
  const now = faceCentre(to, axis, fixed);
  const slide = now[axis] - was[axis];

  const slid: LegoProject =
    slide === 0 || !piece.customAnchors
      ? project
      : {
          ...project,
          pieces: project.pieces.map((p) =>
            p.id === pieceId
              ? {
                  ...p,
                  customAnchors: p.customAnchors?.map((anchor) => {
                    const position: Vec3 = [...anchor.position];
                    position[axis] += slide;
                    return { ...anchor, position };
                  }),
                }
              : p,
          ),
        };

  const swapped = swapPart(slid, pack, pieceId, to.id);
  if (!swapped) return null;

  // The pivot: a named place stays on it (swapPart did that), anything else
  // keeps its place in the part's space, clamped to the new box.
  const pivotFrom = piece.pivot ?? [0, 0, 0];
  const named = piece.pivot ? currentPivot(from, piece.pivot) : null;
  const pivotTo: Vec3 | undefined = piece.pivot
    ? named
      ? (pivotChoices(to).find((c) => c.id === named)?.position ?? piece.pivot)
      : clampTo(to, piece.pivot)
    : undefined;

  const turn = turnAndScale(piece);
  const joined = piece.connection !== undefined;
  // How far the origin has to move for the fixed face to stay where it was.
  const offset = new THREE.Vector3(
    ...(was.map((value, k) => value - pivotFrom[k]) as Vec3),
  ).sub(
    new THREE.Vector3(
      ...(now.map((value, k) => value - (pivotTo ?? [0, 0, 0])[k]) as Vec3),
    ),
  );
  offset.applyMatrix4(turn);

  const placed: LegoProject = {
    ...swapped.project,
    pieces: swapped.project.pieces.map((p) => {
      if (p.id !== pieceId) return p;
      const next: LegoPiece = { ...p };
      if (pivotTo) next.pivot = pivotTo;
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

  // A join is placed from the part and the pivot as they are now.
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
    partId: to.id,
    size: chosen.size,
    droppedAnchors: swapped.droppedAnchors,
    broken: resolved.broken.filter((id) => !before.has(id)),
  };
}

function shown(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * What to tell the game maker mid-drag: the size the pack part has, in elmos
 * and in part units, or that the pack has no part at the size asked for.
 * `choices` is `sizeChoices` for the dragged axis and `wanted` the size the
 * pointer is asking for.
 */
export function resizeReadout(
  choices: readonly SizeChoice[],
  wanted: number,
  unit: number,
): string {
  const none = "No other size in the pack on this axis";
  if (choices.length < 2) return none;
  const chosen = nearestSize(choices, wanted);
  if (!chosen) return none;
  const size = `${shown(chosen.size)} elmos, ${shown(chosen.size / unit)} units`;
  if (wanted > choices[choices.length - 1].size + SIZE_TOLERANCE) {
    return `No longer part in the pack. Longest is ${size}`;
  }
  if (wanted < choices[0].size - SIZE_TOLERANCE) {
    return `No shorter part in the pack. Shortest is ${size}`;
  }
  return Math.abs(chosen.size - wanted) < SIZE_TOLERANCE
    ? size
    : `Snapped to ${size}`;
}
