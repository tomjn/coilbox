/**
 * Whether the builder's side panel and parts drawer are open, remembered
 * between runs.
 *
 * This is a preference about how someone likes to work, not something about
 * the unit, so it belongs neither in the project file nor in the session. It
 * goes to `localStorage`, the same place the notification history and the
 * sidebar-collapsed flag already live.
 *
 * Only open or closed is kept. Which of the side panel's three tabs was last
 * shown is not: reopening on Collision because that is where you were three
 * days ago would be wrong, so the panel always comes back on Pieces.
 */

import { useState } from "react";

const PREFIX = "coilbox.lego.panel.";

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
