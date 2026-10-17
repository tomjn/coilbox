/**
 * What a finished drag does to a piece's join (issue #3290).
 *
 * A drag that ends with two faces snapped together saves the join. A drag that
 * ends anywhere else moves the piece, and a piece that moved on its own is no
 * longer where its join puts it, so the join goes. Without that the next edit
 * would resolve the join and carry the piece straight back.
 */

import { editJoined, freePiece, same, twistOf } from "./connectors";
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
 * The document after a piece is dragged to `transform`.
 *
 * With a seat, the piece hangs off the piece it seated against, in the place it
 * was dropped, and carries a join to it that replaces any join it had before.
 * Without one, a piece that slid along its face (issue #3285) keeps its join
 * with the new offset. Any other piece that was moved or turned is freed from
 * its join. A piece that was only scaled keeps its join, since the join places a scaled piece
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
  slide: [number, number] | null = null,
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

  // A slide along the face keeps the join and moves it, so the piece is not
  // freed. Alt gives no slide, and the piece is freed where it is dropped.
  if (slide && before.connection) {
    const [along, across] = before.connection.offset ?? [0, 0];
    if (slide[0] === along && slide[1] === across) return next;
    return {
      ...next,
      pieces: next.pieces.map((piece) =>
        piece.id === pieceId && piece.connection
          ? { ...piece, connection: { ...piece.connection, offset: slide } }
          : piece,
      ),
    };
  }

  // A turn about the face is the join's twist, so the rotate handle keeps the
  // join for it and frees the piece for any other turn (issue #4281).
  if (
    before.connection &&
    same(before.position, transform.position) &&
    !same(before.rotation, transform.rotation)
  ) {
    return editJoined(project, pack, pieceId, {
      rotation: transform.rotation,
      scale: transform.scale,
    }).project;
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

/**
 * The document after a number is typed into a piece's transform fields, and the
 * one line to show when that freed the piece (issue #4281).
 *
 * A joined piece keeps its join where it can: a position along its face is the
 * join's offset and a turn about the face is its twist. A position off the face
 * or any other turn frees the piece where it was typed, or the join would put
 * it straight back. A new scale keeps the join (issue #3309). Without a pack
 * there is nothing to measure a join by, so any move or turn frees the piece.
 */
export function typedJoinedTransform(
  project: LegoProject,
  pack: LoadedPack | null,
  pieceId: string,
  change: Partial<LegoPiece>,
): { project: LegoProject; detached: string | null } {
  if (pack) return editJoined(project, pack, pieceId, change);
  const next = typedTransform(project, pieceId, change);
  const was = pieceById(project, pieceId)?.connection;
  return {
    project: next,
    detached:
      was && !pieceById(next, pieceId)?.connection
        ? "Detached: moved off its face."
        : null,
  };
}

/**
 * The document after a number is typed into a piece's transform fields. A
 * joined piece that the new number moves or turns is freed where it was typed
 * to, as a drag frees it, or its join would put it straight back. A new scale
 * keeps the join (issue #3309).
 */
export function typedTransform(
  project: LegoProject,
  pieceId: string,
  change: Partial<LegoPiece>,
): LegoProject {
  return freeMoved(project, {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === pieceId ? { ...piece, ...change } : piece,
    ),
  });
}
