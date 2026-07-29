/**
 * The unit being edited, its undo history, its selection and its clipboard.
 *
 * A plain reducer with no React and no disk in it, so undo, redo and the
 * coalescing that folds a drag into one step can be exercised directly.
 * `useLegoDocument` is the wiring around it: React state, a timer and the disk.
 */

import { type LegoProject, pieceById } from "./model";

/** Undo steps kept. Whole documents, but a unit is a few hundred numbers. */
export const HISTORY_LIMIT = 60;
/** Edits closer together than this are one gesture, so they undo together. */
export const COALESCE_MS = 400;

/**
 * Undo history: whole documents, not a log of operations.
 *
 * A unit is small and every edit already returns a fresh one, so keeping copies
 * costs little and cannot drift from the operations the way a replay log can.
 * Bounded, because a long session should not grow without end.
 */
export interface LegoDocument {
  project: LegoProject | null;
  past: LegoProject[];
  future: LegoProject[];
  /** A lifted subtree waiting to be pasted. In memory, not the OS clipboard. */
  clipboard: LegoProject | null;
  dirty: boolean;
  /** When the last edit landed, so a gesture can fold into one undo step. */
  editedAt: number;
  /**
   * The piece the builder is pointed at. Lives here, not in the page, because
   * every transition that can remove a piece has to decide what becomes of a
   * selection that named it. Reseated to the nearest surviving ancestor,
   * because that is where the pieces it lost were hanging off.
   */
  selectedId: string | null;
}

export const emptyDocument: LegoDocument = {
  project: null,
  past: [],
  future: [],
  clipboard: null,
  dirty: false,
  editedAt: 0,
  selectedId: null,
};

export type LegoDocumentAction =
  | { type: "open"; project: LegoProject }
  | { type: "edit"; change: (project: LegoProject) => LegoProject; at: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "copy"; cutting: LegoProject | null }
  | { type: "saved" }
  | { type: "select"; id: string | null };

/**
 * What a selection becomes when the piece it names is gone from `to`.
 *
 * Walks up the vanished piece's ancestors as they stood in `from`, the project
 * it is leaving, and lands on the first one that still exists on the other
 * side. Falls all the way back to the root, or to nothing if even that is
 * gone. A parent is where the missing piece was hanging off, so it is the
 * nearest thing left to "where the builder was working".
 */
function reseatSelection(
  selectedId: string | null,
  from: LegoProject,
  to: LegoProject,
): string | null {
  if (selectedId === null) return null;
  const survives = new Set(to.pieces.map((piece) => piece.id));
  if (survives.has(selectedId)) return selectedId;

  let piece = pieceById(from, selectedId);
  while (piece?.parentId) {
    if (survives.has(piece.parentId)) return piece.parentId;
    piece = pieceById(from, piece.parentId);
  }
  return survives.has(to.rootPieceId) ? to.rootPieceId : null;
}

export function reduceDocument(
  state: LegoDocument,
  action: LegoDocumentAction,
): LegoDocument {
  switch (action.type) {
    case "open":
      // Take a copy once the document arrives. Later refreshes of the shared
      // list must not overwrite edits in progress.
      return state.project
        ? state
        : {
            ...state,
            project: action.project,
            selectedId: action.project.rootPieceId,
          };

    case "edit": {
      const current = state.project;
      if (!current) return state;
      const next = action.change(current);
      if (next === current) return state;

      // Edits in quick succession are one gesture. Dragging a slider should
      // undo in a single step, not sixty.
      const continues =
        action.at - state.editedAt < COALESCE_MS && state.past.length > 0;
      return {
        ...state,
        project: next,
        past: continues
          ? state.past
          : [...state.past, current].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
        editedAt: action.at,
        selectedId: reseatSelection(state.selectedId, current, next),
      };
    }

    case "undo": {
      const current = state.project;
      const previous = state.past.at(-1);
      if (!current || !previous) return state;
      return {
        ...state,
        project: previous,
        past: state.past.slice(0, -1),
        future: [...state.future, current],
        dirty: true,
        // The next edit starts a fresh step rather than folding into whatever
        // was being done before the undo.
        editedAt: 0,
        selectedId: reseatSelection(state.selectedId, current, previous),
      };
    }

    case "redo": {
      const current = state.project;
      const next = state.future.at(-1);
      if (!current || !next) return state;
      return {
        ...state,
        project: next,
        past: [...state.past, current],
        future: state.future.slice(0, -1),
        dirty: true,
        editedAt: 0,
        selectedId: reseatSelection(state.selectedId, current, next),
      };
    }

    case "copy":
      return { ...state, clipboard: action.cutting };

    case "saved":
      return { ...state, dirty: false };

    case "select":
      return { ...state, selectedId: action.id };
  }
}
