/**
 * Telling a generated unit's pieces from the game maker's edits (#3235).
 *
 * A checked unit records a stamp of every piece as the generator left it. A
 * piece whose stamp no longer matches was edited by hand, and a piece with no
 * stamp was added by hand. The lock and whether the piece is hidden are left
 * out, because neither changes the unit.
 */

import type { LegoPiece, LegoProject } from "./model";
import { canonical, hash } from "./moduleUpdates";

/** A hash of everything about a piece but its lock and its visibility. A
 *  module piece's names its instance after a space, so deleting one piece of
 *  a module can be told from deleting the module. */
export function pieceStamp(piece: LegoPiece): string {
  const { locked: _locked, hidden: _hidden, ...rest } = piece;
  const stamp = hash(canonical(rest));
  return piece.module ? `${stamp} ${piece.module.instance}` : stamp;
}

/** The unit with a stamp of every piece. `keep` holds stamps to carry over as
 *  they are, by piece id, so a piece kept through a reroll stays edited. */
export function withStamps(
  project: LegoProject,
  keep: ReadonlyMap<string, string | undefined> = new Map(),
): LegoProject {
  if (!project.generated) return project;
  const stamps: Record<string, string> = {};
  for (const piece of project.pieces) {
    if (keep.has(piece.id)) {
      const kept = keep.get(piece.id);
      if (kept !== undefined) stamps[piece.id] = kept;
    } else {
      stamps[piece.id] = pieceStamp(piece);
    }
  }
  return { ...project, generated: { ...project.generated, stamps } };
}
