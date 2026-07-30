/**
 * The builder's document: React state, autosave, and lifting a subtree for
 * copy, paste and duplicate.
 *
 * The document lives in memory for the length of a session and is written
 * shortly after the last edit, so a drag is not a hundred disk writes and
 * leaving the page never loses work. The overview stays in step because saving
 * goes through the shared store. Every transition it makes is in `document.ts`.
 * Copy and paste themselves, the system clipboard and the parts pack, are the
 * page's concern: see `BuilderPage.tsx` and `clipboard.ts`.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  insertCompound,
  insertCompoundAt,
  selectionAsCompound,
  subtreeAsCompound,
} from "./compounds";
import { emptyDocument, primarySelection, reduceDocument } from "./document";
import { type LegoProject, pieceById } from "./model";
import { saveProject, saveThumbnail, useLegoProjects } from "./projects";

export interface LegoDocumentSession {
  /** Still reading the stored units, so nothing can be said about this one. */
  loading: boolean;
  project: LegoProject | null;
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Every selected piece, oldest first. */
  selectedIds: string[];
  /** The last piece clicked, which is what the single-piece panel is about. */
  selectedId: string | null;
  /** Replaces the selection, which is what a plain click does. */
  select: (id: string | null) => void;
  /** Adds a piece to the selection, or takes it out again. */
  toggleSelect: (id: string) => void;
  edit: (change: (project: LegoProject) => LegoProject) => void;
  undo: () => void;
  redo: () => void;
  save: () => void;
  /** Copies the given pieces and everything under them into a self-contained
   *  document, ready to serialize onto the system clipboard. Null when none of
   *  them are in the document, same as everything else keyed by piece id. */
  lift: (pieceIds: string[]) => LegoProject | null;
  /** Replaces the selection with a whole set at once. */
  selectMany: (ids: string[]) => void;
  /** Puts a cutting under `parentId`, answering with its new root pieces. */
  insert: (cutting: LegoProject, parentId: string) => string[];
  /** Copies each piece and its subtree alongside itself, in one edit, and
   *  answers the copies so the selection can move onto them. */
  duplicate: (pieceIds: string[]) => string[];
  /** How the viewport hands over the means to grab a thumbnail. */
  onCapture: (capture: () => HTMLCanvasElement) => void;
}

/**
 * The document behind the builder: edits, history, selection, clipboard and
 * saving.
 */
export function useLegoDocument(id: string | undefined): LegoDocumentSession {
  const { projects, loading } = useLegoProjects();
  const stored = projects.find((project) => project.id === id);

  const [state, dispatch] = useReducer(reduceDocument, emptyDocument);
  const [saving, setSaving] = useState(false);
  const captureRef = useRef<(() => HTMLCanvasElement) | null>(null);
  const project = state.project;

  useEffect(() => {
    if (stored) dispatch({ type: "open", project: stored });
  }, [stored]);

  const edit = useCallback((change: (project: LegoProject) => LegoProject) => {
    dispatch({ type: "edit", change, at: Date.now() });
  }, []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const select = useCallback(
    (id: string | null) => dispatch({ type: "select", ids: id ? [id] : [] }),
    [],
  );
  const selectMany = useCallback(
    (ids: string[]) => dispatch({ type: "select", ids }),
    [],
  );
  const toggleSelect = useCallback(
    (id: string) => dispatch({ type: "toggle-select", id }),
    [],
  );

  const persist = useCallback(async (target: LegoProject) => {
    setSaving(true);
    try {
      const written = await saveProject(target);
      dispatch({ type: "saved" });
      // Draw a fresh frame and copy it in the same breath. The viewport's
      // drawing buffer is gone the moment its frame is composited, so a
      // thumbnail taken from the canvas at any other time is blank.
      const capture = captureRef.current;
      if (capture) await saveThumbnail(written.id, capture());
    } finally {
      setSaving(false);
    }
  }, []);

  // Write shortly after the last edit rather than on every one, so a drag is
  // not a hundred disk writes but navigating away never loses work. Leaving the
  // page saves immediately, because the timer dies with the component.
  useEffect(() => {
    if (!state.dirty || !project) return;
    const timer = setTimeout(() => void persist(project), 800);
    return () => clearTimeout(timer);
  }, [state.dirty, project, persist]);

  const projectRef = useRef(project);
  projectRef.current = project;
  const dirtyRef = useRef(state.dirty);
  dirtyRef.current = state.dirty;

  useEffect(() => {
    return () => {
      // Leaving before the timer fires still writes the document. The canvas is
      // already going, so this one cannot refresh the thumbnail.
      if (dirtyRef.current && projectRef.current)
        void saveProject(projectRef.current);
    };
  }, []);

  /**
   * Copy and duplicate are the compound machinery without the file. A subtree
   * lifted out and put back is the same operation whether it goes via the
   * system clipboard or straight back into the unit.
   */
  function lift(pieceIds: string[]): LegoProject | null {
    if (!project) return null;
    return selectionAsCompound(project, pieceIds, {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
  }

  function insert(cutting: LegoProject, parentId: string): string[] {
    if (!project) return [];
    const inserted = insertCompound(project, cutting, parentId, () =>
      crypto.randomUUID(),
    );
    // One edit however many roots the cutting has, so a paste of several pieces
    // takes one undo step.
    edit(() => inserted.project);
    return inserted.rootPieceIds;
  }

  return {
    loading,
    project,
    dirty: state.dirty,
    saving,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    selectedIds: state.selectedIds,
    selectedId: primarySelection(state),
    select,
    selectMany,
    toggleSelect,
    edit,
    undo,
    redo,
    save: () => {
      if (project) void persist(project);
    },
    lift,
    insert,
    duplicate: (pieceIds) => {
      if (!project) return [];
      // Each copy is lifted out of the document the one before it produced,
      // so a set duplicates in a single edit and undoes in a single step.
      let next = project;
      const copies: string[] = [];
      for (const pieceId of pieceIds) {
        const source = pieceById(next, pieceId);
        const cutting = subtreeAsCompound(next, pieceId, {
          id: crypto.randomUUID(),
          now: new Date().toISOString(),
          newId: () => crypto.randomUUID(),
        });
        if (!source || !cutting) continue;
        // Alongside the original rather than inside it, which is what duplicate
        // means everywhere else.
        const parentId = source.parentId ?? next.rootPieceId;
        // Lifting drops the subtree root's transform, which is right for
        // something bound for the library but not for a copy that is meant to
        // sit exactly where the original does until it is dragged elsewhere.
        const inserted = insertCompoundAt(
          next,
          cutting,
          parentId,
          {
            position: source.position,
            rotation: source.rotation,
            scale: source.scale,
          },
          () => crypto.randomUUID(),
        );
        next = inserted.project;
        copies.push(inserted.rootPieceId);
      }
      if (copies.length === 0) return [];
      edit(() => next);
      return copies;
    },
    onCapture: (capture) => {
      captureRef.current = capture;
    },
  };
}
