/**
 * What a destroyed unit breaks into (issue #3354).
 *
 * A unit comes apart along its connections: a piece joined to its parent by a
 * connector (`LegoPiece.connection`) is a place the unit can break, and
 * everything hanging off it goes with it. A unit with no connections at all
 * breaks along its piece tree instead, so every piece but the root is a place
 * it can break.
 *
 * The engine draws a thrown piece on its own, or with every piece beneath it
 * when `SFX.RECURSIVE` is set, always in the model's bind pose rather than the
 * pose the script left it in (`ProjectileDrawer.cpp:1147-1159` draws
 * `PieceProjectile::omp`, the model's own piece). So a branch that is thrown
 * whole has to be thrown from its top piece with `RECURSIVE`, and a branch that
 * is split has to be thrown a piece at a time, or the pieces beneath would be
 * drawn twice.
 */

import type { LegoPiece, LegoProject } from "./model";

/** Pieces that leave the unit together. */
export interface BreakGroup {
  /** Piece names. The top piece is first, and is the one that is exploded when
   *  `whole` is set. */
  pieces: string[];
  /**
   * Whether the group is a whole branch: the top piece and everything beneath
   * it. A whole branch of more than one piece is one `Explode` with
   * `SFX.RECURSIVE`. Any other group is one `Explode` for each of its pieces.
   */
  whole: boolean;
}

/**
 * How many wreck stages the unit's export writes: the wreck itself, with no
 * `featuredead` heap behind it (`wreck.ts`). The wreck level `Killed` returns
 * counts steps down that chain, so a level past this leaves no wreck.
 */
export const WRECK_STAGES = 1;

/** The depth that cuts at every place the unit can break. */
export const EVERY_CUT = Number.POSITIVE_INFINITY;

/**
 * The places a unit can break: its joined pieces, or every piece but the root
 * when none is joined. The root is never one, since it is what is left.
 */
function cutPieces(project: LegoProject): LegoPiece[] {
  const beneath = project.pieces.filter(
    (piece) => piece.id !== project.rootPieceId && piece.parentId !== null,
  );
  const joined = beneath.filter((piece) => piece.connection);
  return joined.length > 0 ? joined : beneath;
}

/**
 * The groups the unit breaks into when it is cut at every place that has at
 * most `depth` places between it and the root, weakest first.
 *
 * Depth 1 cuts only where a branch leaves the unit's body, so every group is a
 * whole branch. A greater depth also cuts the branches themselves, so a group
 * is what is left of a branch once the deeper cuts are taken from it. The
 * weakest group is the smallest, then the one that comes first in the
 * document.
 */
export function breakGroups(project: LegoProject, depth: number): BreakGroup[] {
  const cuts = cutPieces(project);
  const cutIds = new Set(cuts.map((piece) => piece.id));
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));
  const children = new Map<string, LegoPiece[]>();
  for (const piece of project.pieces) {
    if (piece.parentId === null) continue;
    children.set(piece.parentId, [
      ...(children.get(piece.parentId) ?? []),
      piece,
    ]);
  }

  // How many places lie between a piece and the root, itself included. A
  // parent loop in a hand edited document would never reach the root, so the
  // walk stops after as many steps as there are pieces.
  const depthOf = (piece: LegoPiece): number => {
    let count = 0;
    let at: LegoPiece | undefined = piece;
    for (let step = 0; at && step <= project.pieces.length; step++) {
      if (cutIds.has(at.id)) count++;
      at = at.parentId === null ? undefined : byId.get(at.parentId);
    }
    return count;
  };

  const taken = new Set(
    cuts.filter((piece) => depthOf(piece) <= depth).map((piece) => piece.id),
  );

  const order = new Map(
    project.pieces.map((piece, index) => [piece.id, index]),
  );
  return cuts
    .filter((piece) => taken.has(piece.id))
    .map((top) => {
      const pieces: string[] = [];
      let whole = true;
      const seen = new Set<string>();
      const walk = (piece: LegoPiece) => {
        if (seen.has(piece.id)) return;
        seen.add(piece.id);
        pieces.push(piece.name);
        for (const child of children.get(piece.id) ?? []) {
          // Another place the unit breaks starts its own group.
          if (taken.has(child.id)) whole = false;
          else walk(child);
        }
      };
      walk(top);
      return { at: order.get(top.id) ?? 0, group: { pieces, whole } };
    })
    .sort(
      (a, b) => a.group.pieces.length - b.group.pieces.length || a.at - b.at,
    )
    .map(({ group }): BreakGroup => group);
}
