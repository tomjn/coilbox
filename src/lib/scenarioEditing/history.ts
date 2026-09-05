/**
 * Undo and redo for an editor that saves as it goes.
 *
 * Written for the scenario editor and used by the standalone blueprint editor
 * too (issue #1442), which holds a layout rather than a scenario. Nothing here
 * reads a document, so the document is whatever the editor holds: what a step
 * back hands over is the thing that editor already knows how to show and save.
 *
 * The editor has no save button: every change is written to disk as it is made,
 * so before this there was no way back from a mistaken drag or a delete. History
 * is a session's worth of whole documents rather than a log of what changed,
 * which is what the unit builder settled on too, and it works here for the same
 * reason: a scenario is small JSON, and every edit already produces a fresh one.
 *
 * Two things it has to get right.
 *
 * An entry is pushed by the one funnel every edit goes through, so the panels
 * are covered as well as the map, and the entry is the document as it was
 * *before* the edit. Undo therefore writes to disk exactly as an edit does. The
 * document on screen stays the document on disk, which is the whole point of
 * saving on every change.
 *
 * A drag needs no special handling. The pointer layer moves the drawn objects
 * during a gesture and writes the document once on release, so one drag is one
 * edit and one step back.
 */

/** How many steps back a session keeps. Whole documents, so the cap is about
 *  memory rather than about how far anyone would sensibly go. */
export const HISTORY_LIMIT = 100;

/** Where the editor has been, and where it has been brought back from. Both
 *  newest last. */
export interface EditHistory<T> {
  past: T[];
  future: T[];
}

export const emptyHistory: EditHistory<never> = { past: [], future: [] };

/** A document without the stamp a save puts on it, for a document that carries
 *  one. */
function content(doc: unknown): unknown {
  if (!doc || typeof doc !== "object") return doc;
  const { updatedAt: _stamp, ...rest } = doc as Record<string, unknown>;
  return rest;
}

/**
 * Whether two documents say the same thing.
 *
 * `updatedAt` is ignored, because saving stamps it and re-saving an untouched
 * document would otherwise be a step in the history that undoes to itself.
 * Blurring the name field does exactly that. A document with no such stamp, such
 * as a blueprint, is compared whole.
 */
export function sameEdit<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(content(a)) === JSON.stringify(content(b));
}

/**
 * Remember `before` as the way back from an edit that produced `after`.
 *
 * The future is dropped, because editing after an undo is a new branch and the
 * old one is no longer reachable from here.
 */
export function recordEdit<T>(
  history: EditHistory<T>,
  before: T,
  after: T,
): EditHistory<T> {
  if (sameEdit(before, after)) return history;
  return {
    past: [...history.past, before].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** A step taken: the history that remains, and the document to write. */
export interface HistoryStep<T> {
  history: EditHistory<T>;
  document: T;
}

/** One step back from `current`, or null when there is nowhere to go. */
export function undoEdit<T>(
  history: EditHistory<T>,
  current: T,
): HistoryStep<T> | null {
  const previous = history.past.at(-1);
  if (!previous) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
    },
    document: previous,
  };
}

/** One step forward from `current`, or null when there is nowhere to go. */
export function redoEdit<T>(
  history: EditHistory<T>,
  current: T,
): HistoryStep<T> | null {
  const next = history.future.at(-1);
  if (!next) return null;
  return {
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
    },
    document: next,
  };
}

/** The parts of a key press these shortcuts read. Narrowed so they can be
 *  tested without a DOM. */
export type EditKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey"
>;

/** Cmd on macOS, Ctrl elsewhere, treated as one key the way the unit builder's
 *  shortcuts do. */
const hasMod = (event: EditKey) => event.metaKey || event.ctrlKey;

/** Cmd/Ctrl Z, matching the unit builder's `undo` shortcut. */
export function isUndoKey(event: EditKey): boolean {
  return hasMod(event) && !event.shiftKey && event.key.toLowerCase() === "z";
}

/** Cmd/Ctrl Shift Z or Cmd/Ctrl Y, matching the unit builder's `redo`. */
export function isRedoKey(event: EditKey): boolean {
  if (!hasMod(event)) return false;
  const key = event.key.toLowerCase();
  return (event.shiftKey && key === "z") || key === "y";
}

/** What this platform calls that modifier, for a tooltip. Sniffed from the user
 *  agent the way the unit builder's shortcut sheet does, rather than pulling in
 *  the OS plugin for one word. */
export function modKeyLabel(): string {
  return /mac/i.test(navigator.userAgent) ? "Cmd" : "Ctrl";
}

/**
 * Whether a key press is somebody typing, in which case the editor keeps its
 * hands off it: a text box has an undo stack of its own and it is the one the
 * author means.
 */
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
