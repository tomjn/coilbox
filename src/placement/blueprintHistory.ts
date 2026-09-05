/**
 * Undo and redo for a layout edited on its own (issue #1442).
 *
 * The scenario editor's history, holding layouts instead of scenarios. Not a
 * second implementation of it: `history.ts` never read a document, so the same
 * whole document snapshots, the same cap, the same shortcuts and the same "an
 * edit after an undo is a new branch" apply here, and the two cannot drift.
 *
 * What is new is the funnel. An edit is made to the document the layout is
 * placed in, because that is the only thing the editing rules know how to
 * change, and the layout that comes back out is what goes into the history and
 * out through `onChange`. So a step back is a layout, which is the thing the
 * editor is given and the thing whoever owns it saves.
 *
 * The history belongs to the editor rather than to a page, because a layout has
 * no panels beside the surface for it to cover: everything the history holds was
 * done on the surface it is drawn on. An editor mounted inside one that already
 * has a history is the exception, and says so with `owned`.
 *
 * A drag needs no special handling here either. The pointer layer moves the
 * drawn objects during the gesture and calls `onMove` once, on release, so one
 * drag is one edit and one press back.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { BaseBlueprint } from "@/blueprint/model";
import {
  type EditHistory,
  emptyHistory,
  isRedoKey,
  isTypingTarget,
  isUndoKey,
  recordEdit,
  redoEdit,
  undoEdit,
} from "@/lib/scenarioEditing/history";
import type { Scenario } from "@/scenario/model";
import { blueprintDocument, documentLayout } from "./blueprintDocument";

/** An edit to the document a layout is placed in, which is what every rule in
 *  `editing.ts` and `bases.ts` takes and returns. */
export type LayoutEdit = (current: Scenario) => Scenario;

/** The layout an edit makes of the one it is applied to. */
function editedLayout(
  current: BaseBlueprint,
  gameName: string,
  edit: LayoutEdit,
): BaseBlueprint {
  return documentLayout(edit(blueprintDocument(current, gameName)), current);
}

/** An edit applied: the layout to show and save, and the history to keep. */
export function applyLayoutEdit(
  current: BaseBlueprint,
  history: EditHistory<BaseBlueprint>,
  gameName: string,
  edit: LayoutEdit,
): { layout: BaseBlueprint; history: EditHistory<BaseBlueprint> } {
  const layout = editedLayout(current, gameName, edit);
  return { layout, history: recordEdit(history, current, layout) };
}

/** The undo and redo the surface shows, or null when the caller holds the
 *  history and shows its own. */
export interface LayoutHistoryControls {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export interface LayoutHistory {
  /** Make an edit to the layout, as a change to the document it is held in. */
  apply: (edit: LayoutEdit) => void;
  controls: LayoutHistoryControls | null;
}

export function useLayoutHistory({
  blueprint,
  gameName,
  owned,
  onChange,
}: {
  blueprint: BaseBlueprint;
  gameName: string;
  /** Whether this editor keeps the history. False inside an editor that already
   *  has one covering these edits, so one press is one step back. */
  owned: boolean;
  onChange: (blueprint: BaseBlueprint) => void;
}): LayoutHistory {
  const [history, setHistory] =
    useState<EditHistory<BaseBlueprint>>(emptyHistory);

  /**
   * The latest layout rather than this render's, for the same reason the
   * scenario editor reads its own document through a ref: two clicks can both be
   * handled before React renders either of them, and the second has to be built
   * on the first. A press of the shortcut reads both of these at the moment it
   * happens too, which is why the history is here as well as in state.
   */
  const latest = useRef(blueprint);
  latest.current = blueprint;
  const historyRef = useRef(history);
  historyRef.current = history;

  // A different layout opened in the same editor is a different history. Without
  // this, undoing would hand the layout that was open before back to whoever
  // owns the one that is open now.
  const opened = useRef(blueprint.id);
  useEffect(() => {
    if (opened.current === blueprint.id) return;
    opened.current = blueprint.id;
    historyRef.current = emptyHistory;
    setHistory(emptyHistory);
  }, [blueprint.id]);

  const apply = useCallback(
    (edit: LayoutEdit) => {
      const was = latest.current;
      const applied = applyLayoutEdit(was, historyRef.current, gameName, edit);
      if (owned) {
        historyRef.current = applied.history;
        setHistory(applied.history);
      }
      latest.current = applied.layout;
      onChange(applied.layout);
    },
    [gameName, owned, onChange],
  );

  const step = useCallback(
    (take: typeof undoEdit) => {
      const taken = take(historyRef.current, latest.current);
      if (!taken) return;
      historyRef.current = taken.history;
      setHistory(taken.history);
      latest.current = taken.document;
      onChange(taken.document);
    },
    [onChange],
  );

  const undo = useCallback(() => step(undoEdit), [step]);
  const redo = useCallback(() => step(redoEdit), [step]);

  useEffect(() => {
    if (!owned) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target as HTMLElement | null)) return;
      if (isUndoKey(event)) {
        event.preventDefault();
        undo();
      } else if (isRedoKey(event)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [owned, undo, redo]);

  return {
    apply,
    controls: owned
      ? {
          canUndo: history.past.length > 0,
          canRedo: history.future.length > 0,
          undo,
          redo,
        }
      : null,
  };
}
