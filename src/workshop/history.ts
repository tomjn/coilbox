/**
 * Undo and redo over a tweak project (issue #1282).
 *
 * The difference between an editor people trust and one people take a backup
 * before using, and the part of this issue most easily got subtly wrong. Three
 * decisions, each of which could have gone the other way:
 *
 * **One stack, not one per store.** The five stores are edited independently,
 * so a stack each looks natural, and it is wrong. Nobody presses undo meaning
 * "undo my last override" - they mean "undo the last thing I did", and a
 * keystroke that has to pick a stack has no way to know which. Worse, several
 * actions touch more than one store at once: deleting a copied unit clears its
 * overrides, its text edits and its disabled mark alongside removing the copy,
 * and renaming a unit lands in the override set or the text set depending on
 * the game. Per store stacks would tear those apart and hand back a copy with
 * its edits missing. So a step is a whole {@link GameEdits}, and an action that
 * touches four stores is still one step.
 *
 * **Snapshots, not inverse operations.** All five stores are already immutable
 * and sparse, so a snapshot shares structure with the one before it: a step
 * that changes one field retains one small object, not a copy of the project.
 * Inverse operations would need a sixth implementation per store, kept in step
 * with every store added later, to buy back memory that was never spent.
 *
 * **A stack per project, not one for the app.** Every store is scoped to one
 * game and refuses to say anything about another (issue #2664), and a project
 * is scoped to one game for the same reason. An undo that reached across
 * projects would put back an edit to a game the user is not looking at, which
 * is the contamination the stores spend their whole design avoiding. Switching
 * project and switching back leaves the stack where it was, so the history
 * follows the work.
 *
 * Nothing here is persisted. The project is, the history is not: reopening the
 * app gives you your edits, not the road you took to them. Undoing your way
 * back past a restart would need every intermediate state on disk, which is
 * more than the edits themselves cost, for something nobody comes back for.
 *
 * The stacks are not capped. A step retains only what it changed, and the one
 * expensive change a project can make - copying a unit, which is a whole
 * definition - is retained once however many steps refer to it.
 */
import { useCallback, useState } from "react";
import type { GameEdits } from "./project";

interface Stacks {
  past: GameEdits[];
  future: GameEdits[];
}

const NO_STACKS: Stacks = { past: [], future: [] };

/**
 * Stacks only. The present state lives in the saved project, because that is
 * what is on screen and what is persisted, and a second copy of it here is a
 * second thing to keep in step. So the caller passes in what is current and
 * writes back what comes out.
 */
export interface EditHistory {
  /**
   * Record `current` as a step, on the way to replacing it. Called by whoever
   * is about to write, and only when the write is a real change.
   */
  push(key: string, current: GameEdits): void;
  /** The state before the last step, or undefined when there is none. */
  undo(key: string, current: GameEdits): GameEdits | undefined;
  /** The state undone away from, or undefined when nothing was undone. */
  redo(key: string, current: GameEdits): GameEdits | undefined;
  canUndo(key: string): boolean;
  canRedo(key: string): boolean;
  /** Drop a deleted project's history, so a new project cannot inherit it. */
  forget(key: string): void;
}

export function useEditHistory(): EditHistory {
  const [stacks, setStacks] = useState<Record<string, Stacks>>({});

  const push = useCallback((key: string, current: GameEdits) => {
    setStacks((all) => {
      const stack = all[key] ?? NO_STACKS;
      // A new edit is the end of the road not taken. Keeping the redo stack
      // would offer to jump to a state this edit was never made from.
      return { ...all, [key]: { past: [...stack.past, current], future: [] } };
    });
  }, []);

  const undo = useCallback(
    (key: string, current: GameEdits): GameEdits | undefined => {
      const stack = stacks[key] ?? NO_STACKS;
      const previous = stack.past[stack.past.length - 1];
      if (previous === undefined) return undefined;
      setStacks((all) => {
        const live = all[key] ?? NO_STACKS;
        if (live.past.length === 0) return all;
        return {
          ...all,
          [key]: {
            past: live.past.slice(0, -1),
            future: [current, ...live.future],
          },
        };
      });
      return previous;
    },
    [stacks],
  );

  const redo = useCallback(
    (key: string, current: GameEdits): GameEdits | undefined => {
      const stack = stacks[key] ?? NO_STACKS;
      const next = stack.future[0];
      if (next === undefined) return undefined;
      setStacks((all) => {
        const live = all[key] ?? NO_STACKS;
        if (live.future.length === 0) return all;
        return {
          ...all,
          [key]: {
            past: [...live.past, current],
            future: live.future.slice(1),
          },
        };
      });
      return next;
    },
    [stacks],
  );

  const canUndo = useCallback(
    (key: string) => (stacks[key]?.past.length ?? 0) > 0,
    [stacks],
  );
  const canRedo = useCallback(
    (key: string) => (stacks[key]?.future.length ?? 0) > 0,
    [stacks],
  );

  const forget = useCallback((key: string) => {
    setStacks((all) => {
      if (!Object.hasOwn(all, key)) return all;
      const { [key]: _dropped, ...rest } = all;
      return rest;
    });
  }, []);

  return { push, undo, redo, canUndo, canRedo, forget };
}
