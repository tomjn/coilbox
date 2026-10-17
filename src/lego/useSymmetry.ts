/**
 * Symmetry mode: gives a piece a mirrored twin and keeps the two in step.
 *
 * `mirror.ts` answers where a twin belongs. This is the bookkeeping around it:
 * which pieces are still owed a twin, and moving a twin when its partner moves.
 * The pairing itself is saved on the pieces (`LegoPiece.twin`), so it survives a
 * change of selection and reopening the unit. Whether the mode is on is not
 * saved: it is a preference for the session, and toggling it would otherwise
 * be an undo step that marks the unit as changed.
 */

import { useEffect, useRef, useState } from "react";

import { adoptHeldPresets, type HeldPreset } from "./compounds";
import { followMirror, mirrorTwin } from "./mirror";
import { type LegoProject, pieceById } from "./model";
import type { LoadedPack } from "./pack";

export interface SymmetrySession {
  /** Whether a piece added now should get a twin. */
  on: boolean;
  /**
   * Switch symmetry on or off. Off forgets what was waiting, so turning it
   * back on hours later does not suddenly twin a piece added in an earlier
   * session. Saved pairs stay, and are not followed while it is off.
   */
  setOn: (on: boolean) => void;
  /**
   * Remember a piece that arrived while symmetry was on, so its first placement
   * mirrors it. Off, this is nothing: the piece is an ordinary piece.
   *
   * `held` is what the insert that brought the piece could not add to the unit
   * for want of roles. The twin may supply them, so they are judged again once
   * it exists.
   */
  queueTwin: (pieceId: string, held?: HeldPreset[]) => void;
  /**
   * Apply a placement, then let symmetry mode answer for each piece it moved:
   * bring the piece's twin along, or give it one if it is still owed one.
   *
   * One `edit` either way, so a piece and its twin arrive together, move
   * together and take one undo step between them.
   *
   * A piece owed a twin keeps its place in the queue until it is somewhere a
   * mirror means something. Dropped down the middle it is its own reflection,
   * so it waits there rather than spending its turn.
   */
  place: (
    pieceIds: string[],
    change: (project: LegoProject) => LegoProject,
  ) => void;
}

export function useSymmetry(options: {
  project: LegoProject | null;
  edit: (change: (project: LegoProject) => LegoProject) => void;
  /** What a twin's join to a face is measured by. With none, twins are free. */
  pack?: LoadedPack | null;
}): SymmetrySession {
  const { project, edit, pack = null } = options;

  /**
   * A preference for the session rather than something the unit carries, so it
   * is state here rather than a field on the document.
   */
  const [on, setOn] = useState(false);
  /**
   * The pieces added since symmetry came on that have not been placed off the
   * centre line yet.
   *
   * Every piece arrives at its parent's origin and is dragged into place after,
   * so the moment a piece is added is too early to know where its twin belongs.
   * These wait here until they are somewhere, and are twinned then. A ref, not
   * state: nothing on screen reads it, and it is written from the same handlers
   * that edit the document.
   */
  const awaitingTwin = useRef(new Map<string, HeldPreset[]>());
  // A piece that has left the document is not waiting for anything and has
  // nothing following it: deleting it, or undoing the add that made it, takes it
  // off both rather than leaving an id that could be twinned or moved if a redo
  // brought it back.
  useEffect(() => {
    if (!project) return;
    const present = new Set(project.pieces.map((piece) => piece.id));
    for (const pieceId of awaitingTwin.current.keys()) {
      if (!present.has(pieceId)) awaitingTwin.current.delete(pieceId);
    }
  }, [project]);

  return {
    on,
    setOn: (next: boolean) => {
      setOn(next);
      if (!next) awaitingTwin.current.clear();
    },
    queueTwin: (pieceId: string, held: HeldPreset[] = []) => {
      if (on) awaitingTwin.current.set(pieceId, held);
    },
    place: (pieceIds, change) => {
      if (!project) return;
      let next = change(project);
      for (const pieceId of pieceIds) {
        // The pairing is in the document, so it holds across selections and
        // reopening. A twin placed in the same go has already been moved.
        const twinId = pieceById(next, pieceId)?.twin;
        if (twinId) {
          if (on && !pieceIds.includes(twinId)) {
            next = followMirror(next, pieceId, twinId, pack);
          }
          continue;
        }
        const held = awaitingTwin.current.get(pieceId);
        if (!held) continue;
        const twinned = mirrorTwin(
          next,
          pieceId,
          () => crypto.randomUUID(),
          pack,
        );
        if (!twinned) continue;
        awaitingTwin.current.delete(pieceId);
        next = adoptHeldPresets(twinned.project, held);
      }
      edit(() => next);
    },
  };
}
