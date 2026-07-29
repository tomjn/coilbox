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

import { insertCompound, subtreeAsCompound } from "./compounds";
import { emptyDocument, reduceDocument } from "./document";
import type { LegoProject } from "./model";
import { saveProject, saveThumbnail, useLegoProjects } from "./projects";

export interface LegoDocumentSession {
  /** Still reading the stored units, so nothing can be said about this one. */
  loading: boolean;
  project: LegoProject | null;
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selectedId: string | null;
  select: (id: string | null) => void;
  edit: (change: (project: LegoProject) => LegoProject) => void;
  undo: () => void;
  redo: () => void;
  save: () => void;
  /** Copies a piece and everything under it into a self-contained document,
   *  ready to serialize onto the system clipboard. Null off the edge of the
   *  document, same as everything else keyed by piece id. */
  lift: (pieceId: string) => LegoProject | null;
  /** Puts a subtree under `parentId`, answering with its new root piece. */
  insert: (cutting: LegoProject, parentId: string) => string | null;
  duplicate: (pieceId: string) => string | null;
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
    (id: string | null) => dispatch({ type: "select", id }),
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
  function lift(pieceId: string): LegoProject | null {
    if (!project) return null;
    return subtreeAsCompound(project, pieceId, {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
  }

  function insert(cutting: LegoProject, parentId: string): string | null {
    if (!project) return null;
    const inserted = insertCompound(project, cutting, parentId, () =>
      crypto.randomUUID(),
    );
    edit(() => inserted.project);
    return inserted.rootPieceId;
  }

  return {
    loading,
    project,
    dirty: state.dirty,
    saving,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    selectedId: state.selectedId,
    select,
    edit,
    undo,
    redo,
    save: () => {
      if (project) void persist(project);
    },
    lift,
    insert,
    duplicate: (pieceId) => {
      const cutting = lift(pieceId);
      if (!cutting || !project) return null;
      // Alongside the original rather than inside it, which is what duplicate
      // means everywhere else.
      const parentId =
        project.pieces.find((piece) => piece.id === pieceId)?.parentId ??
        project.rootPieceId;
      return insert(cutting, parentId);
    },
    onCapture: (capture) => {
      captureRef.current = capture;
    },
  };
}
