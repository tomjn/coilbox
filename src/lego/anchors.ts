/**
 * A piece's own snap anchors.
 *
 * An anchor marks a seat the part's bounding box does not describe: the mouth
 * of a curved intake, the tip of a rounded nose. `snapping.ts` decides what a
 * piece then offers to snap against. This is only how the points get onto the
 * piece.
 *
 * An anchor is stored in the part's own space, the same frame as `pivot` and as
 * the box anchors, so it sits on the geometry rather than beside it. That is
 * what makes it move, turn and scale with the piece, and stay where it was put
 * when the pivot moves. A piece with no part has no part space, and its own
 * space is the same thing.
 *
 * Editor only, like every other anchor: nothing here reaches the export. An
 * anchor that has to survive into the engine is an empty piece.
 */

import type { LegoAnchor, LegoPiece, LegoProject } from "./model";
import type { Vec3 } from "./snapping";

/** Add an anchor to a piece, at a point in the part's own space. */
export function addAnchor(
  project: LegoProject,
  pieceId: string,
  position: Vec3,
  id: string,
): LegoProject {
  return withAnchors(project, pieceId, (anchors) => [
    ...anchors,
    { id, name: nextName(anchors), position },
  ]);
}

/** Rename an anchor, move it, or both. */
export function updateAnchor(
  project: LegoProject,
  pieceId: string,
  anchorId: string,
  change: Partial<Omit<LegoAnchor, "id">>,
): LegoProject {
  return withAnchors(project, pieceId, (anchors) =>
    anchors.map((anchor) =>
      anchor.id === anchorId ? { ...anchor, ...change } : anchor,
    ),
  );
}

export function removeAnchor(
  project: LegoProject,
  pieceId: string,
  anchorId: string,
): LegoProject {
  return withAnchors(project, pieceId, (anchors) =>
    anchors.filter((anchor) => anchor.id !== anchorId),
  );
}

/**
 * Replace one piece's anchors.
 *
 * An empty list is stored as no key at all, the way `role` and `hidden` are
 * dropped rather than written empty, so a piece that had an anchor and lost it
 * is indistinguishable from one that never had any: both go back to the box.
 */
function withAnchors(
  project: LegoProject,
  pieceId: string,
  change: (anchors: LegoAnchor[]) => LegoAnchor[],
): LegoProject {
  return {
    ...project,
    pieces: project.pieces.map((piece): LegoPiece => {
      if (piece.id !== pieceId) return piece;
      const next = change(piece.customAnchors ?? []);
      const { customAnchors: _dropped, ...rest } = piece;
      return next.length > 0 ? { ...rest, customAnchors: next } : rest;
    }),
  };
}

/** The next unused default, so three anchors are not all called "anchor". */
function nextName(anchors: readonly LegoAnchor[]): string {
  const taken = new Set(anchors.map((anchor) => anchor.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? "anchor" : `anchor${n}`;
    if (!taken.has(name)) return name;
  }
}
