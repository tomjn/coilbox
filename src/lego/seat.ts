/**
 * What a finished drag does to a piece's join (issue #3290).
 *
 * A drag that ends with two faces snapped together saves the join. A drag that
 * ends anywhere else moves the piece, and a piece that moved on its own is no
 * longer where its join puts it, so the join goes. Without that the next edit
 * would resolve the join and carry the piece straight back.
 */

import * as THREE from "three";

import { freePiece, pieceConnectors, same } from "./connectors";
import { type LegoPiece, type LegoProject, pieceById } from "./model";
import type { LoadedPack } from "./pack";
import { reparentPiece, worldMatrix } from "./reparent";
import type { Vec3 } from "./snapping";

/** The pair of faces a drag ended snapped together. */
export interface Seat {
  /** The piece the dragged piece seated against, which it now hangs off. */
  parentId: string;
  /** The dragged piece's own connector. */
  connector: string;
  /** The connector on the parent. */
  to: string;
}

export interface DraggedTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/**
 * The angle about the parent's connector that leaves the piece turned as it is.
 *
 * The piece's up direction is carried into the parent's child space, which is
 * where the join is written, and measured from the parent connector's up.
 * Nothing in a drag sets a twist, so this is what stops a join resolving to a
 * quarter turn from where the piece was dropped.
 */
function twistOf(
  project: LegoProject,
  pack: LoadedPack,
  piece: LegoPiece,
  pieceWorld: THREE.Matrix4,
  parent: LegoPiece,
  seat: Seat,
): number {
  const own = pieceConnectors(pack, piece).find((c) => c.id === seat.connector);
  const theirs = pieceConnectors(pack, parent).find((c) => c.id === seat.to);
  if (!own || !theirs) return 0;

  // The piece will be joined, so it takes the parent's turn and not its scale.
  const parentTurn = new THREE.Quaternion();
  worldMatrix(project, parent.id).decompose(
    new THREE.Vector3(),
    parentTurn,
    new THREE.Vector3(),
  );
  const up = new THREE.Vector3(...own.up)
    .transformDirection(pieceWorld)
    .applyQuaternion(parentTurn.invert());
  const facing = new THREE.Vector3(...theirs.facing).normalize();
  up.addScaledVector(facing, -up.dot(facing)).normalize();

  const from = new THREE.Vector3(...theirs.up).normalize();
  const twist = Math.atan2(
    facing.dot(new THREE.Vector3().crossVectors(from, up)),
    from.dot(up),
  );
  return Number.isFinite(twist) ? twist : 0;
}

/**
 * The document after a piece is dragged to `transform`.
 *
 * With a seat, the piece hangs off the piece it seated against, in the place it
 * was dropped, and carries a join to it that replaces any join it had before.
 * Without one, a piece that was moved or turned is freed from its join. A piece
 * that was only scaled keeps its join, since the join places a scaled piece
 * correctly. A piece that did not move at all, as with a click on the handles
 * that goes nowhere, is left joined.
 *
 * Done as one change, so the move, the new parent and the join undo together.
 */
export function dragPiece(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  transform: DraggedTransform,
  seat: Seat | null,
): LegoProject {
  const before = pieceById(project, pieceId);
  if (!before) return project;

  const moved =
    !same(before.position, transform.position) ||
    !same(before.rotation, transform.rotation);
  let next: LegoProject = {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === pieceId ? { ...piece, ...transform } : piece,
    ),
  };

  if (seat) {
    // Where the piece was dropped, read before a reparent rewrites its transform.
    const droppedWorld = worldMatrix(next, pieceId);
    if (before.parentId !== seat.parentId) {
      const reparented = reparentPiece(next, pieceId, seat.parentId, true);
      // A parent the piece cannot hang off leaves it free where it was dropped.
      if (reparented === next) return freeAt(next, pieceId);
      next = reparented;
    }
    const piece = pieceById(next, pieceId);
    const parent = pieceById(next, seat.parentId);
    if (!piece || !parent) return freeAt(next, pieceId);
    const twist = twistOf(next, pack, piece, droppedWorld, parent, seat);
    return {
      ...next,
      pieces: next.pieces.map((p) =>
        p.id === pieceId
          ? {
              ...p,
              connection: {
                connector: seat.connector,
                to: seat.to,
                ...(Math.abs(twist) > 1e-9 ? { twist } : {}),
              },
            }
          : p,
      ),
    };
  }

  return moved ? freeAt(next, pieceId) : next;
}

function freeAt(project: LegoProject, pieceId: string): LegoProject {
  return {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === pieceId ? freePiece(piece) : piece,
    ),
  };
}

/**
 * Free every piece in `after` that a group drag moved or turned from where it
 * was in `before`, for the same reason `dragPiece` frees a single one.
 */
export function freeMoved(
  before: LegoProject,
  after: LegoProject,
): LegoProject {
  const was = new Map(before.pieces.map((piece) => [piece.id, piece]));
  let changed = false;
  const pieces = after.pieces.map((piece) => {
    const earlier = was.get(piece.id);
    if (
      !piece.connection ||
      !earlier ||
      (same(earlier.position, piece.position) &&
        same(earlier.rotation, piece.rotation))
    ) {
      return piece;
    }
    changed = true;
    return freePiece(piece);
  });
  return changed ? { ...after, pieces } : after;
}
