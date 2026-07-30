/**
 * The unit being edited, its undo history and its selection.
 *
 * A plain reducer with no React and no disk in it, so undo, redo and the
 * coalescing that folds a drag into one step can be exercised directly.
 * `useLegoDocument` is the wiring around it: React state, a timer and the disk.
 * Copy and paste live on the system clipboard, not here, so they cross windows
 * and survive a reload: see clipboard.ts.
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
  dirty: boolean;
  /** When the last edit landed, so a gesture can fold into one undo step. */
  editedAt: number;
  /**
   * The pieces the builder is pointed at, oldest first, so the last entry is
   * the one clicked most recently. Lives here, not in the page, because every
   * transition that can remove a piece has to decide what becomes of a
   * selection that named it. Reseated to the nearest surviving ancestor,
   * because that is where the pieces it lost were hanging off.
   */
  selectedIds: string[];
}

export const emptyDocument: LegoDocument = {
  project: null,
  past: [],
  future: [],
  dirty: false,
  editedAt: 0,
  selectedIds: [],
};

export type LegoDocumentAction =
  | { type: "open"; project: LegoProject }
  | { type: "edit"; change: (project: LegoProject) => LegoProject; at: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved" }
  /** Replaces the whole selection, which is what a plain click does. */
  | { type: "select"; ids: string[] }
  /** Adds a piece to the selection, or takes it out if it is already in it. */
  | { type: "toggle-select"; id: string };

/** The last piece clicked, which is the one a single-piece panel is about. */
export function primarySelection(state: LegoDocument): string | null {
  return state.selectedIds.at(-1) ?? null;
}

/**
 * What one selected piece becomes when it is gone from `to`.
 *
 * Walks up the vanished piece's ancestors as they stood in `from`, the project
 * it is leaving, and lands on the first one that still exists on the other
 * side. Falls all the way back to the root, or to nothing if even that is
 * gone. A parent is where the missing piece was hanging off, so it is the
 * nearest thing left to "where the builder was working".
 */
function reseatOne(
  selectedId: string,
  from: LegoProject,
  to: LegoProject,
  survives: Set<string>,
): string | null {
  if (survives.has(selectedId)) return selectedId;

  let piece = pieceById(from, selectedId);
  while (piece?.parentId) {
    if (survives.has(piece.parentId)) return piece.parentId;
    piece = pieceById(from, piece.parentId);
  }
  return survives.has(to.rootPieceId) ? to.rootPieceId : null;
}

/**
 * Reseat every selected piece, keeping the order they were selected in.
 *
 * Two pieces of the same branch can reseat onto the same surviving ancestor,
 * so the result is deduplicated: a selection holding one piece twice would
 * transform it twice.
 */
function reseatSelection(
  selectedIds: string[],
  from: LegoProject,
  to: LegoProject,
): string[] {
  const survives = new Set(to.pieces.map((piece) => piece.id));
  const out: string[] = [];
  for (const id of selectedIds) {
    const reseated = reseatOne(id, from, to, survives);
    if (reseated !== null && !out.includes(reseated)) out.push(reseated);
  }
  return out;
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
            selectedIds: [action.project.rootPieceId],
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
        selectedIds: reseatSelection(state.selectedIds, current, next),
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
        selectedIds: reseatSelection(state.selectedIds, current, previous),
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
        selectedIds: reseatSelection(state.selectedIds, current, next),
      };
    }

    case "saved":
      return { ...state, dirty: false };

    case "select":
      return { ...state, selectedIds: action.ids };

    case "toggle-select": {
      // Added at the end rather than in tree order, so the piece just clicked
      // is the one the panel is about.
      const without = state.selectedIds.filter((id) => id !== action.id);
      return {
        ...state,
        selectedIds:
          without.length === state.selectedIds.length
            ? [...state.selectedIds, action.id]
            : without,
      };
    }
  }
}
