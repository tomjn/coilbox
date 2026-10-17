/**
 * Placing a part on a face of another part (issue #3277).
 *
 * The pointer picks a connector on a piece, and the part is seated on it with a
 * saved join, so the placement is the same resolved join a snapped drag leaves.
 * Everything here works on the document and the pack, so the ghost the viewport
 * draws and the piece a click adds come from the one function.
 */

import {
  connectPiece,
  type LegoConnector,
  pieceConnectors,
} from "./connectors";
import {
  type LegoPiece,
  type LegoProject,
  pieceById,
  uniquePieceName,
} from "./model";
import type { LegoPartInfo, LoadedPack } from "./pack";
import type { Vec3 } from "./snapping";

/**
 * How closely a surface must face the way a connector does to count as that
 * face, as a dot product of the two unit directions. The same 0.9 that
 * `defaultUp` in `connectors.ts` uses for "close to an axis".
 */
const FACES = 0.9;

/** The face of a piece that was hit, or null on a slope no connector faces. */
export interface FaceTarget {
  parentId: string;
  /** The connector on the parent. */
  to: string;
}

export interface PlaceOptions {
  /** How many of the part's own faces to step on from the one facing back at
   *  the target. Wraps round. */
  cycle: number;
  /** Quarter turns about the joined face. */
  twist: number;
}

/**
 * The connector of `piece` that a hit is on.
 *
 * `point` and `normal` are in the piece's part space, the frame connectors are
 * written in. Of the connectors facing the way the surface does, the nearest to
 * the point wins, so a part that states several faces the same way still picks
 * the one under the pointer.
 */
export function faceUnder(
  pack: LoadedPack,
  piece: LegoPiece,
  point: Vec3,
  normal: Vec3,
): LegoConnector | null {
  const length = Math.hypot(...normal);
  if (!(length > 0)) return null;
  let best: { connector: LegoConnector; distance: number } | null = null;
  for (const connector of pieceConnectors(pack, piece)) {
    const dot =
      (connector.facing[0] * normal[0] +
        connector.facing[1] * normal[1] +
        connector.facing[2] * normal[2]) /
      length;
    if (dot < FACES) continue;
    const distance = Math.hypot(
      connector.position[0] - point[0],
      connector.position[1] - point[1],
      connector.position[2] - point[2],
    );
    if (!best || distance < best.distance) best = { connector, distance };
  }
  return best?.connector ?? null;
}

/** A part as the piece it would become, for asking what it joins by. */
function standIn(part: LegoPartInfo): LegoPiece {
  return {
    id: "",
    name: part.shape,
    parentId: null,
    partId: part.id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

/**
 * The part's own connector that joins `theirs`: the one facing most nearly
 * back at it, so the two sit flush, then stepped on by `cycle`. Null for a part
 * with no connectors.
 */
export function ownFace(
  pack: LoadedPack,
  part: LegoPartInfo,
  theirs: LegoConnector,
  cycle: number,
): LegoConnector | null {
  const own = pieceConnectors(pack, standIn(part));
  if (own.length === 0) return null;
  let first = 0;
  let lowest = Number.POSITIVE_INFINITY;
  own.forEach((connector, index) => {
    const dot =
      connector.facing[0] * theirs.facing[0] +
      connector.facing[1] * theirs.facing[1] +
      connector.facing[2] * theirs.facing[2];
    if (dot < lowest) {
      lowest = dot;
      first = index;
    }
  });
  return own[(((first + cycle) % own.length) + own.length) % own.length];
}

/**
 * The document with `part` added as a child of the target's piece and joined to
 * its face, as `pieceId`. Null when there is nothing to join: the piece or its
 * face is missing, or the part has no connectors.
 */
export function placePart(
  project: LegoProject,
  pack: LoadedPack,
  part: LegoPartInfo,
  target: FaceTarget,
  options: PlaceOptions,
  pieceId: string,
): LegoProject | null {
  const parent = pieceById(project, target.parentId);
  if (!parent) return null;
  const theirs = pieceConnectors(pack, parent).find((c) => c.id === target.to);
  if (!theirs) return null;
  const own = ownFace(pack, part, theirs, options.cycle);
  if (!own) return null;

  const quarter = ((options.twist % 4) + 4) % 4;
  const piece: LegoPiece = {
    ...standIn(part),
    id: pieceId,
    name: uniquePieceName(
      part.shape,
      project.pieces.map((p) => p.name),
    ),
    parentId: parent.id,
  };
  return connectPiece(
    { ...project, pieces: [...project.pieces, piece] },
    pack,
    pieceId,
    {
      connector: own.id,
      to: theirs.id,
      ...(quarter ? { twist: (quarter * Math.PI) / 2 } : {}),
    },
  );
}
