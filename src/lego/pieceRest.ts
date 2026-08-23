/**
 * Where a unit's pieces sit, for the runtimes that play its script.
 *
 * A script may ask where one of its own pieces is, and both runtimes move
 * pieces without ever reading a model: they are handed piece names and nothing
 * else. So the shape has to travel with the run. Beyond All Reason's commander
 * decides which arm to aim with by asking how high a piece is and comparing it
 * to sea level, and a runtime answering zero has it conclude its arms are
 * underwater.
 *
 * Offsets are the ones the project already holds, each relative to its parent,
 * and the parent is an index into the same array of pieces the names came from.
 */

import type { LegoProject } from "./model";

export interface PieceRest {
  /** Index of the piece this one hangs off, or null for the root. */
  parent: number | null;
  /** Its offset from that parent, in elmos. */
  position: [number, number, number];
}

/**
 * The project's pieces as the runtimes want them, in the array's own order.
 *
 * That order is what the caller passes as `pieces`, so the two line up index
 * for index. A piece whose parent is not in the project is treated as a root,
 * which is what the builder itself does with one.
 */
export function pieceRest(project: LegoProject): PieceRest[] {
  const index = new Map(project.pieces.map((piece, at) => [piece.id, at]));
  return project.pieces.map((piece) => ({
    parent:
      piece.parentId === null ? null : (index.get(piece.parentId) ?? null),
    position: piece.position,
  }));
}
