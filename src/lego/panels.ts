/**
 * Whether the builder's side panel and parts drawer are open, and how tall the
 * drawer is, remembered between runs.
 *
 * This is a preference about how someone likes to work, not something about
 * the unit, so it belongs neither in the project file nor in the session. It
 * goes to `localStorage`, the same place the notification history and the
 * sidebar-collapsed flag already live.
 *
 * Only open or closed is kept. Which of the side panel's three tabs was last
 * shown is not: reopening on Collision because that is where you were three
 * days ago would be wrong, so the panel always comes back on Pieces.
 *
 * The drawer filling the window is not kept either. That is a thing you do to
 * read one script, not a way of working, and coming back to a builder with no
 * model in it would read as a broken page.
 */

import { useState } from "react";

const PREFIX = "coilbox.lego.panel.";
const HEIGHT_PREFIX = "coilbox.lego.height.";

/** The drawer's height before anyone drags it: the 18rem it was fixed at when
 *  it could not be dragged at all. */
export const STRIP_HEIGHT = 288;

/** The shortest the drawer goes. Its own header row is 40px, so this leaves a
 *  usable band of content under it rather than a header with a sliver. */
export const MIN_PANEL_HEIGHT = 120;

/**
 * How much of the model view a drag always leaves behind.
 *
 * Dragging the view away entirely is what the maximise button is for, and it
 * comes back with one press. A drag has no such undo, so it stops short.
 *
 * Not enough for the whole tool rail, which is 340px with every group showing
 * (nine `h-9` buttons and two 8px gaps) and scrolls by design. Enough that the
 * chrome card, the key and a band of model are all still there. The figure is
 * a judgement rather than a measurement: 160px, which this replaces, was short
 * enough that the overlays met in the middle.
 */
export const KEEP_VIEW = 240;

/**
 * Read a stored flag, treating everything that is not exactly "false" as open.
 *
 * That covers the three ways there is no answer - never set, cleared, or junk
 * left by something else - with the default the issue asks for: both panels
 * open, exactly as before any of this existed.
 */
export function panelOpenFrom(stored: string | null): boolean {
  return stored !== "false";
}

/** Whether `name`'s panel is open, and a setter that remembers the answer. */
export function usePanelOpen(name: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return panelOpenFrom(localStorage.getItem(PREFIX + name));
    } catch {
      // Storage unavailable (private mode / quota). Open is the default, and
      // the choice simply lasts for the session.
      return true;
    }
  });

  return [
    open,
    (next: boolean) => {
      setOpen(next);
      try {
        localStorage.setItem(PREFIX + name, String(next));
      } catch {}
    },
  ];
}

/**
 * A height a drag asked for, brought inside what the window can show.
 *
 * `available` is the space the drawer and the model view share. A stored
 * height outlives the window it was set in, so this runs on the way out of
 * storage as well as during a drag: a drawer dragged tall on a big screen
 * must not fill a small one on the next run.
 */
export function clampPanelHeight(height: number, available: number): number {
  return Math.min(
    Math.max(Math.round(height), MIN_PANEL_HEIGHT),
    maxPanelHeight(available),
  );
}

/** The tallest a drag leaves the drawer when the two share `available`. */
export function maxPanelHeight(available: number): number {
  return Math.max(MIN_PANEL_HEIGHT, available - KEEP_VIEW);
}

/** A stored height, falling back to `STRIP_HEIGHT` for the three ways there
 *  is no answer: never set, cleared, or junk left by something else. */
export function panelHeightFrom(stored: string | null): number {
  const height = Number(stored);
  return stored !== null && Number.isFinite(height) && height > 0
    ? height
    : STRIP_HEIGHT;
}

/** How tall `name`'s panel is, and a setter that remembers the answer. */
export function usePanelHeight(
  name: string,
): [number, (height: number) => void] {
  const [height, setHeight] = useState(() => {
    try {
      return panelHeightFrom(localStorage.getItem(HEIGHT_PREFIX + name));
    } catch {
      return STRIP_HEIGHT;
    }
  });

  return [
    height,
    (next: number) => {
      setHeight(next);
      try {
        localStorage.setItem(HEIGHT_PREFIX + name, String(next));
      } catch {}
    },
  ];
}
