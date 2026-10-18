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
import { isMount, mountPartRefusal } from "./mountPoints";
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
 * face is missing, the part has no connectors, or the face is a mount point,
 * which takes modules only (#3279).
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
  if (mountPartRefusal(project, parent.id, target.to)) return null;
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

/**
 * The order a part added from the strip takes a parent's faces in: the top
 * first, since most builds grow upward from a hull, then the front, the back,
 * the left, the right and the bottom. A connector with another id comes after
 * these, in the order its part lists them.
 */
const FACE_ORDER = ["+y", "+z", "-z", "+x", "-x", "-y"];

function rank(id: string): number {
  const at = FACE_ORDER.indexOf(id);
  return at < 0 ? FACE_ORDER.length : at;
}

/**
 * The face of a piece the next part from the strip joins: the first in
 * `FACE_ORDER` that no child is connected to. Judged from saved connections
 * alone, so a child placed freely beside the piece does not take a face. When
 * every face has a child, the one with the fewest, and `crowded` says so. Null
 * for a piece with no part or no faces. A mount point is never picked, since
 * it is filled on purpose (#3279).
 */
export function freeFace(
  project: LegoProject,
  pack: LoadedPack,
  parentId: string,
): { to: string; crowded: boolean } | null {
  const parent = pieceById(project, parentId);
  if (!parent) return null;
  const faces = pieceConnectors(pack, parent)
    .map((connector, index) => ({ id: connector.id, index }))
    .filter((face) => !isMount(project, parentId, face.id))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index);
  if (faces.length === 0) return null;
  const used = new Map<string, number>();
  for (const piece of project.pieces) {
    if (piece.parentId !== parentId || !piece.connection) continue;
    used.set(piece.connection.to, (used.get(piece.connection.to) ?? 0) + 1);
  }
  let best = faces[0];
  for (const face of faces) {
    if ((used.get(face.id) ?? 0) < (used.get(best.id) ?? 0)) best = face;
  }
  return { to: best.id, crowded: (used.get(best.id) ?? 0) > 0 };
}

/**
 * The document with `part` added to a free face of the piece, as `pieceId`, and
 * whether every face already had a child. Null when the piece has no face to
 * join, so the caller can add the part at the piece's origin instead.
 */
export function attachToFreeFace(
  project: LegoProject,
  pack: LoadedPack,
  part: LegoPartInfo,
  parentId: string,
  pieceId: string,
): { project: LegoProject; crowded: boolean } | null {
  const face = freeFace(project, pack, parentId);
  if (!face) return null;
  const next = placePart(
    project,
    pack,
    part,
    { parentId, to: face.to },
    { cycle: 0, twist: 0 },
    pieceId,
  );
  return next && { project: next, crowded: face.crowded };
}
