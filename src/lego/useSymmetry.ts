/**
 * Symmetry mode: the pairing that gives a piece a mirrored twin and keeps the
 * two in step.
 *
 * `mirror.ts` answers where a twin belongs. This is the bookkeeping around it,
 * which is the part that can go silently wrong: which pieces are still owed a
 * twin, which pairs are being held together, and when each of those is
 * forgotten. Nothing here is written to the document, so a unit reopened
 * tomorrow has two pieces and no memory of which made which.
 */

import { useEffect, useRef, useState } from "react";

import { followMirror, mirrorTwin } from "./mirror";
import type { LegoProject } from "./model";

export interface SymmetrySession {
  /** Whether a piece added now should get a twin. */
  on: boolean;
  /**
   * Switch symmetry on or off. Off forgets what was waiting and lets go of
   * every pair: those pieces are ordinary pieces now, and turning it back on
   * hours later should not suddenly twin one of them.
   */
  setOn: (on: boolean) => void;
  /**
   * Remember a piece that arrived while symmetry was on, so its first placement
   * mirrors it. Off, this is nothing: the piece is an ordinary piece.
   */
  queueTwin: (pieceId: string) => void;
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
  selectedIds: string[];
  edit: (change: (project: LegoProject) => LegoProject) => void;
}): SymmetrySession {
  const { project, selectedIds, edit } = options;

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
  const awaitingTwin = useRef(new Set<string>());
  /**
   * The pairs symmetry mode is currently holding together: a piece and the twin
   * that follows it.
   *
   * Kept only while the piece stays selected. Moving on to something else ends
   * it, and the two are ordinary pieces from then on.
   */
  const twins = useRef(new Map<string, string>());

  // A piece that has left the document is not waiting for anything and has
  // nothing following it: deleting it, or undoing the add that made it, takes it
  // off both rather than leaving an id that could be twinned or moved if a redo
  // brought it back.
  useEffect(() => {
    if (!project) return;
    const present = new Set(project.pieces.map((piece) => piece.id));
    for (const pieceId of awaitingTwin.current) {
      if (!present.has(pieceId)) awaitingTwin.current.delete(pieceId);
    }
    for (const [pieceId, twinId] of twins.current) {
      if (!present.has(pieceId) || !present.has(twinId))
        twins.current.delete(pieceId);
    }
  }, [project]);

  // Selecting something else ends whatever symmetry was holding together. Read
  // during the render that brings the new selection in, so the pair is already
  // broken by the time anything can act on it, and compared by the contents of
  // the selection rather than the array, which is rebuilt on every edit and
  // would otherwise break the pair on the first drag.
  const selectionKey = selectedIds.join(" ");
  const pairedFor = useRef(selectionKey);
  if (pairedFor.current !== selectionKey) {
    pairedFor.current = selectionKey;
    twins.current.clear();
  }

  return {
    on,
    setOn: (next: boolean) => {
      setOn(next);
      if (!next) {
        awaitingTwin.current.clear();
        twins.current.clear();
      }
    },
    queueTwin: (pieceId: string) => {
      if (on) awaitingTwin.current.add(pieceId);
    },
    place: (pieceIds, change) => {
      if (!project) return;
      let next = change(project);
      for (const pieceId of pieceIds) {
        const twinId = twins.current.get(pieceId);
        if (twinId) {
          next = followMirror(next, pieceId, twinId);
          continue;
        }
        if (!awaitingTwin.current.has(pieceId)) continue;
        const twinned = mirrorTwin(next, pieceId, () => crypto.randomUUID());
        if (!twinned) continue;
        awaitingTwin.current.delete(pieceId);
        twins.current.set(pieceId, twinned.twinId);
        next = twinned.project;
      }
      edit(() => next);
    },
  };
}
