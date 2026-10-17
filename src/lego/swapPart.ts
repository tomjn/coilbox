/**
 * Swapping the part a piece is made of, in place (issue #3294).
 *
 * The piece keeps its id, name, role, parent, children, tags, hidden state,
 * collision settings, transform and animation. Only its part changes, and what
 * is written in the old part's space is carried over:
 *
 * - Its pivot stays on the same named place ("top" is still the top), or at the
 *   same fraction of the box when it has no name. The piece's position is not
 *   touched, so the pivot is still where the piece is.
 * - Its custom anchors stay when they fall inside the new box and are dropped
 *   when they do not.
 * - A join is named by connector id, so it survives when the new part has that
 *   id. When it does not, the connector that faces the same way takes its
 *   place, which is what keeps a join through a face on parts that name their
 *   connectors differently. When no connector faces that way the join is left
 *   as it is. It then cannot be made, the piece stays where it was, and the
 *   builder lists it as a problem (`resolveConnections`).
 *
 * This applies both to the swapped piece's own join to its parent and to the
 * joins of its children to it. Every join is then resolved again, so joined
 * children follow the new box by the rule in `joinedWorld.ts`.
 */

import {
  type LegoConnector,
  pieceConnectors,
  resolveConnections,
} from "./connectors";
import type { LegoPiece, LegoProject } from "./model";
import { type LegoPartInfo, type LoadedPack, shapeVariants } from "./pack";
import { currentPivot, pivotChoices } from "./pivot";
import type { Vec3 } from "./snapping";

export interface SwapResult {
  project: LegoProject;
  /** Names of the anchors that fell outside the new part and were dropped. */
  droppedAnchors: string[];
  /** Pieces whose join this swap left unable to be made. */
  broken: string[];
}

/** How closely two unit facings must agree to count as the same direction. */
const SAME_DIRECTION = 1 - 1e-3;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The id a join through `was` should use among `now`: the same id when it is
 * still there, else the connector that faces the same way, the nearest when
 * several do, else the id unchanged.
 */
export function carriedId(
  id: string,
  was: readonly LegoConnector[],
  now: readonly LegoConnector[],
): string {
  if (now.some((c) => c.id === id)) return id;
  const old = was.find((c) => c.id === id);
  if (!old) return id;
  const alike = now
    .filter((c) => dot(c.facing, old.facing) > SAME_DIRECTION)
    .sort(
      (a, b) =>
        distance(a.position, old.position) - distance(b.position, old.position),
    );
  return alike[0]?.id ?? id;
}

/** Where a pivot goes on the new part. */
function carriedPivot(
  from: LegoPartInfo,
  to: LegoPartInfo,
  pivot: Vec3 | undefined,
): Vec3 | undefined {
  if (!pivot) return undefined;
  const named = currentPivot(from, pivot);
  const choice = named && pivotChoices(to).find((c) => c.id === named);
  if (choice) return choice.position;
  return pivot.map((value, axis) => {
    const extent = from.bbox.max[axis] - from.bbox.min[axis];
    const at = extent > 0 ? (value - from.bbox.min[axis]) / extent : 0.5;
    return to.bbox.min[axis] + at * (to.bbox.max[axis] - to.bbox.min[axis]);
  }) as Vec3;
}

function inside(part: LegoPartInfo, point: Vec3): boolean {
  return point.every(
    (value, axis) =>
      value >= part.bbox.min[axis] && value <= part.bbox.max[axis],
  );
}

/**
 * The project with one piece made of another part, or null when there is
 * nothing to swap: no such piece, a piece with no pack part (empty, or from an
 * imported unit), a part the pack does not have, or the part it already is.
 */
export function swapPart(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  partId: string,
): SwapResult | null {
  const piece = project.pieces.find((p) => p.id === pieceId);
  if (!piece?.partId || piece.meshId || piece.partId === partId) return null;
  const from = pack.byId.get(piece.partId);
  const to = pack.byId.get(partId);
  if (!from || !to) return null;

  const droppedAnchors: string[] = [];
  const kept = piece.customAnchors?.filter((anchor) => {
    if (inside(to, anchor.position)) return true;
    droppedAnchors.push(anchor.name);
    return false;
  });

  const pivot = carriedPivot(from, to, piece.pivot);
  const swapped: LegoPiece = {
    ...piece,
    partId,
    ...(pivot ? { pivot } : {}),
    ...(kept ? { customAnchors: kept } : {}),
  };
  const was = pieceConnectors(pack, piece);
  const now = pieceConnectors(pack, swapped);

  const pieces = project.pieces.map((other) => {
    if (other.id === pieceId) {
      const { connection } = other;
      return connection
        ? {
            ...swapped,
            connection: {
              ...connection,
              connector: carriedId(connection.connector, was, now),
            },
          }
        : swapped;
    }
    if (other.parentId === pieceId && other.connection) {
      return {
        ...other,
        connection: {
          ...other.connection,
          to: carriedId(other.connection.to, was, now),
        },
      };
    }
    return other;
  });

  const before = new Set(resolveConnections(project, pack).broken);
  const resolved = resolveConnections({ ...project, pieces }, pack);
  return {
    project: resolved.project,
    droppedAnchors,
    broken: resolved.broken.filter((id) => !before.has(id)),
  };
}

/**
 * Parts to offer in place of a piece's part: the other colourways of its shape
 * first, since a colour change moves no geometry, then the rest in the order
 * given. The part the piece already has is left out.
 */
export function variantsFirst(
  pack: LoadedPack,
  current: LegoPartInfo,
  parts: readonly LegoPartInfo[],
): LegoPartInfo[] {
  const variants = new Set(
    shapeVariants(pack, current.shapeId).map((part) => part.id),
  );
  const others = parts.filter((part) => part.id !== current.id);
  return [
    ...others.filter((part) => variants.has(part.id)),
    ...others.filter((part) => !variants.has(part.id)),
  ];
}
