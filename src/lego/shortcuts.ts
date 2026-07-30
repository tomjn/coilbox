/**
 * The single source of truth for every keyboard shortcut in the unit
 * builder.
 *
 * `ModelViewport` and `BuilderPage` each run their own keydown handler, but
 * both dispatch by calling {@link shortcutMatches} against an entry here
 * rather than comparing `event.key` inline, and the shortcut sheet lists the
 * same entries by mapping over {@link SHORTCUTS}. A shortcut can't fire from
 * a handler without a matching row here, and a row here can't silently stop
 * matching what its handler does, because they read the same combo.
 */

export type ShortcutGroup = "Transform" | "View" | "Edit" | "Help";

/**
 * One key combination. `mod` and `shift` are tri-state: `true` requires the
 * modifier, `false` requires its absence, and leaving it out means the
 * handler this reproduces never checked it either way.
 *
 * `mod` is Cmd on macOS and Ctrl elsewhere, exactly as the handlers already
 * treat `event.metaKey || event.ctrlKey` as one and the same key.
 */
export interface KeyCombo {
  /** What `event.key` produces for the unshifted key, e.g. "g", "z", "?". */
  key: string;
  mod?: boolean;
  shift?: boolean;
}

export interface Shortcut {
  id: string;
  group: ShortcutGroup;
  description: string;
  combos: KeyCombo[];
  /**
   * Overrides the generic combo match. Only `snap-hold` needs this: it reads
   * `event.altKey`, which is true on every keydown while Alt is held, not
   * just the keydown for Alt itself, so it cannot be expressed as "the key
   * pressed was Alt".
   */
  matches?: (event: KeyboardEvent) => boolean;
}

/** Whether `event` carries the platform's "command" modifier, held or not. */
function hasMod(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function comboMatches(combo: KeyCombo, event: KeyboardEvent): boolean {
  if (combo.mod === true && !hasMod(event)) return false;
  if (combo.mod === false && hasMod(event)) return false;
  if (combo.shift === true && !event.shiftKey) return false;
  if (combo.shift === false && event.shiftKey) return false;
  return event.key.toLowerCase() === combo.key.toLowerCase();
}

/** Whether `event` fires `shortcut`, by its combos or its override. */
export function shortcutMatches(
  shortcut: Shortcut,
  event: KeyboardEvent,
): boolean {
  if (shortcut.matches) return shortcut.matches(event);
  return shortcut.combos.some((combo) => comboMatches(combo, event));
}

/** Look up a shortcut by id and test it in one call, for use in a handler. */
export function isShortcut(id: string, event: KeyboardEvent): boolean {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`Unknown shortcut id: ${id}`);
  return shortcutMatches(shortcut, event);
}

export const SHORTCUTS: Shortcut[] = [
  {
    id: "translate",
    group: "Transform",
    description: "Move the selection",
    combos: [{ key: "g", shift: false }],
  },
  {
    id: "rotate",
    group: "Transform",
    description: "Turn the selection",
    combos: [{ key: "r", shift: false }],
  },
  {
    id: "scale",
    group: "Transform",
    description: "Scale the selection",
    combos: [{ key: "s", shift: false }],
  },
  {
    id: "snap-hold",
    group: "Transform",
    description: "Hold to place freely, off the grid",
    combos: [{ key: "Alt" }],
    matches: (event) => event.altKey,
  },
  {
    id: "symmetry",
    group: "Transform",
    description: "Mirror new pieces as they are placed",
    combos: [{ key: "m", mod: false, shift: false }],
  },
  {
    id: "frame",
    group: "View",
    description: "Frame the selection",
    combos: [{ key: "f", mod: false, shift: false }],
  },
  {
    id: "shortcuts",
    group: "Help",
    description: "Show this sheet",
    combos: [{ key: "?" }],
  },
  {
    id: "undo",
    group: "Edit",
    description: "Undo",
    combos: [{ key: "z", mod: true, shift: false }],
  },
  {
    id: "redo",
    group: "Edit",
    description: "Redo",
    combos: [
      { key: "z", mod: true, shift: true },
      { key: "y", mod: true },
    ],
  },
  {
    id: "copy",
    group: "Edit",
    description: "Copy the selected piece",
    combos: [{ key: "c", mod: true }],
  },
  {
    id: "paste",
    group: "Edit",
    description: "Paste",
    combos: [{ key: "v", mod: true }],
  },
  {
    id: "duplicate",
    group: "Edit",
    description: "Duplicate the selection",
    combos: [{ key: "d", mod: true }],
  },
  {
    id: "delete",
    group: "Edit",
    description: "Delete the selection",
    combos: [{ key: "Backspace" }, { key: "Delete" }],
  },
  {
    // The one entry here no handler looks up: it is a modified click, in the
    // viewport and in the piece tree, rather than a key. It is listed all the
    // same, because the sheet is where anyone looks for it and a shortcut
    // nothing prints is a shortcut nobody finds.
    id: "add-to-selection",
    group: "Edit",
    description: "Add a piece to the selection, or take it out",
    combos: [
      { key: "Click", shift: true },
      { key: "Click", mod: true },
    ],
  },
];

/**
 * Whether key labels should read as macOS does. No `@tauri-apps/plugin-os`
 * dependency here, so sniff the user agent, the same way `assetUrl.ts`'s
 * `isWindows` does for the same reason.
 */
export function isMac(): boolean {
  return /mac/i.test(navigator.userAgent);
}

/** How a key reads in the sheet: single characters upper-cased, named keys
 *  (Backspace, Delete, Alt) left as they are. */
function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A combo as the sheet should print it, e.g. "Cmd Z" / "Ctrl Z", "G". */
export function comboLabel(combo: KeyCombo, mac: boolean): string {
  const parts: string[] = [];
  if (combo.mod) parts.push(mac ? "Cmd" : "Ctrl");
  if (combo.shift) parts.push("Shift");
  parts.push(keyLabel(combo.key));
  return parts.join(" ");
}
