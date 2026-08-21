/**
 * The builder's editing shortcuts: undo, redo, copy, paste, duplicate,
 * symmetry and delete, off the window.
 *
 * Off the window rather than off the viewport, because the tree, the panel and
 * the parts drawer are all places somebody expects Cmd Z to work. Two things
 * follow from that and both are silent when they go wrong.
 *
 * The listener is registered once, for the life of the page, and reaches the
 * handlers through a ref that every render rewrites. Bind it to the handlers it
 * was created with instead and delete goes on deleting whatever was selected
 * when the unit opened.
 *
 * And a key aimed at a text field is never a shortcut. Without that, typing a
 * piece's name starts deleting pieces on the first backspace.
 *
 * Which key is which is `shortcuts.ts`, so this and the shortcut sheet cannot
 * disagree about what Cmd D does.
 */

import { useEffect, useRef } from "react";

import { isShortcut } from "./shortcuts";

export interface EditShortcuts {
  remove: () => void;
  undo: () => void;
  redo: () => void;
  copy: () => void | Promise<void>;
  paste: () => void | Promise<void>;
  duplicate: () => void;
  symmetry: () => void;
}

/** Whether a key pressed here belongs to whoever is typing. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useEditShortcuts(handlers: EditShortcuts): void {
  // Rewritten every render, so a shortcut always runs against the current
  // selection rather than the one the listener was created with.
  const ref = useRef(handlers);
  ref.current = handlers;

  // Backspace deletes the selected piece, which is what it does in every other
  // 3D tool. Without this the webview treats it as browser Back and the whole
  // page navigates away mid-edit.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a key from a field. Undo in a text box is the browser's.
      if (isTyping(event.target)) return;

      const shortcuts = ref.current;

      if (isShortcut("undo", event)) {
        event.preventDefault();
        shortcuts.undo();
        return;
      }
      if (isShortcut("redo", event)) {
        event.preventDefault();
        shortcuts.redo();
        return;
      }
      if (isShortcut("copy", event)) {
        event.preventDefault();
        void shortcuts.copy();
        return;
      }
      if (isShortcut("paste", event)) {
        event.preventDefault();
        void shortcuts.paste();
        return;
      }
      if (isShortcut("duplicate", event)) {
        event.preventDefault();
        shortcuts.duplicate();
        return;
      }
      if (isShortcut("symmetry", event)) {
        event.preventDefault();
        shortcuts.symmetry();
        return;
      }
      if (isShortcut("delete", event)) {
        event.preventDefault();
        shortcuts.remove();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
