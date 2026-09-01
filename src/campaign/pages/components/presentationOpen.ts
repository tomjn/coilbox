/**
 * Whether the campaign editor's Presentation disclosure is open, remembered
 * between visits.
 *
 * Liking that section open is a preference about how someone works, not a fact
 * about a particular campaign, so it goes to `localStorage` next to the lego
 * builder's panels and the sidebar-collapsed flag rather than into the campaign
 * document. Writing it into the document would also mean opening a disclosure
 * queued a save and stamped `updatedAt`, which is a real edit for a thing that
 * changed nothing.
 *
 * One key for every campaign, for the same reason. Someone who wants the art
 * pickers open wants them open wherever they are, and a key per campaign id
 * would leave 50 of them behind.
 *
 * Nothing stored is a third answer, not a false. It lets the page fall back to
 * a default that depends on the campaign, which is how an empty campaign gets
 * the section open without anyone having to ask for it. See
 * {@link presentationOpen}.
 */

import { useState } from "react";

const KEY = "coilbox.campaign.presentationOpen";

/**
 * Parse a stored flag: `true`/`false` if it was set, `null` for every way there
 * is no answer - never set, cleared, or junk left by something else.
 */
export function storedPresentationOpen(raw: string | null): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * The open state to render, given what was stored and whether the campaign has
 * any missions.
 *
 * With no missions there is nothing below the section to push out of sight, and
 * a campaign with none is still being set up (issue #2190 calls it a Draft), so
 * the art is what the author is most likely there for. Once there are missions
 * the section is in the way of them, so it closes itself. Either way an explicit
 * choice wins, because someone who opened it said what they wanted.
 */
export function presentationOpen(
  stored: boolean | null,
  missionCount: number,
): boolean {
  return stored ?? missionCount === 0;
}

/** What was last stored, and a setter that remembers the answer. */
export function useStoredPresentationOpen(): [
  boolean | null,
  (open: boolean) => void,
] {
  const [stored, setStored] = useState<boolean | null>(() => {
    try {
      return storedPresentationOpen(localStorage.getItem(KEY));
    } catch {
      // Storage unavailable (private mode / quota). The choice still applies,
      // it just lasts for the session.
      return null;
    }
  });

  return [
    stored,
    (next: boolean) => {
      setStored(next);
      try {
        localStorage.setItem(KEY, String(next));
      } catch {}
    },
  ];
}

/**
 * What the collapsed row says is set, so closing the section never hides the
 * fact that there is art to set. An author who has never opened it reads "No
 * icon or background yet", which is a better prompt than the two "Choose image"
 * buttons it replaces.
 */
export function presentationSummary(
  icon: boolean,
  background: boolean,
): string {
  if (icon && background) return "Icon and background set";
  if (icon) return "Icon set, no background";
  if (background) return "Background set, no icon";
  return "No icon or background yet";
}
