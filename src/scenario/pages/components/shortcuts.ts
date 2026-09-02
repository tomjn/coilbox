/**
 * The editor's page-level keyboard shortcuts (issue #2277): Cmd/Ctrl
 * combinations and the mode-switching digits, answered outside the map's own
 * keyboard interface in `@/placement/mapKeys`.
 *
 * That file's own key table declines anything carrying Ctrl or Cmd, on
 * purpose, so undo, redo and every shortcut here keep working while the map
 * has the focus. The digits are declined too, simply because the map has
 * nothing of its own bound to them, so a mode switch reaches the author
 * wherever their focus is, map included - the same place the most common
 * reason to switch mode finds them (issue #2277).
 *
 * `editorShortcuts` is the one place the combos are written down for display,
 * so a button's tooltip and the overflow menu's list read the same words.
 */

import { modKeyLabel } from "./history";

/** The parts of a key press these read, so they can be tested without a DOM,
 *  the same narrowing `history.ts`'s shortcuts use. */
export type EditKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey"
>;

/** Cmd on macOS, Ctrl elsewhere, treated as one key throughout this editor. */
const hasMod = (event: EditKey) => event.metaKey || event.ctrlKey;

/** Cmd/Ctrl Enter: open Test in game. */
export function isTestKey(event: EditKey): boolean {
  return hasMod(event) && !event.shiftKey && event.key === "Enter";
}

/** Cmd/Ctrl D: duplicate the selected placement, or the trigger being
 *  edited. */
export function isDuplicateKey(event: EditKey): boolean {
  return hasMod(event) && !event.shiftKey && event.key.toLowerCase() === "d";
}

/**
 * The mode strip index (0 to 5) a plain "1" to "6" press names, or null for
 * anything else: a different key, or the same digit with Cmd or Ctrl held,
 * which is left alone so a browser or window shortcut on that combination
 * keeps working.
 *
 * Shift is not read here. On a layout where a digit needs Shift, `event.key`
 * already reads as the digit itself, exactly as `mapKeys.ts` takes "." and its
 * shifted ">" as the one key.
 */
export function modeDigit(event: EditKey): number | null {
  if (hasMod(event)) return null;
  const n = Number(event.key);
  if (!Number.isInteger(n) || n < 1 || n > 6) return null;
  return n - 1;
}

/** One row of the shortcut list the overflow menu shows. */
export interface EditorShortcut {
  description: string;
  keys: string;
}

/**
 * Every page-level shortcut, worded for the overflow menu's list (issue
 * #2277 asks that they be found somewhere, not only guessed at). Undo and
 * redo are here too, alongside the three this issue adds, so an author has
 * one place that lists all of them rather than the newest three only. Each
 * also carries its own combo in its button's tooltip.
 *
 * The map's own keys - stepping through placements, moving, turning,
 * deleting - are a second list, not this one: "?" reads it out once the map
 * has the focus, which is where those keys mean anything. Printing it here
 * too would be a second copy of the map's own words to keep in step with the
 * first.
 */
export function editorShortcuts(): EditorShortcut[] {
  const mod = modKeyLabel();
  return [
    { description: "Test in game", keys: `${mod} Enter` },
    {
      description:
        "Switch mode: Select, Zones, Actors, Groups, Bases, Blueprints",
      keys: "1 – 6",
    },
    {
      description:
        "Duplicate the selected placement, or the trigger you are editing",
      keys: `${mod} D`,
    },
    { description: "Undo", keys: `${mod} Z` },
    { description: "Redo", keys: `${mod} Shift Z` },
  ];
}
