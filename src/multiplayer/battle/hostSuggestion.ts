/**
 * A `!balance`/`!lock`/`!unlock` chat line, recognised the same way
 * `mapSuggestion.ts` recognises `!map <name>` (issue #2871). A direct room
 * runs no autohost, so these arrive as a joiner's request rather than a
 * command a bot answers, and the founder is the one who can honour them by
 * hand: Balance through the same force calls `GameTypePresetsControls`
 * already uses (`balanceLayoutForRows` + `applyLayoutDirectly`), Lock
 * through the battle room header's own toggle.
 *
 * `!fixcolors` and `!ring` are deliberately not matched here. Fix colours
 * has no founder-direct equivalent: nothing in this codebase computes a
 * colour-conflict layout the way `balanceLayout` computes a seating one, and
 * building one speculatively for this ticket would be new colour-assignment
 * logic, not wiring. Ring unready pings a player's own client to remind them
 * they're not ready, and coilbox has no way to reach into another member's
 * session to do that. Both stay plain, unanswered chat lines, on the same
 * "a button that does nothing is worse than no button" reasoning that hid
 * this whole panel in #2738.
 */

export type HostSuggestionKind = "balance" | "lock" | "unlock";

export interface HostSuggestion {
  kind: HostSuggestionKind;
}

const KIND_BY_COMMAND: Record<string, HostSuggestionKind> = {
  "!balance": "balance",
  "!lock": "lock",
  "!unlock": "unlock",
};

/**
 * Read a chat line as a host suggestion: an exact (trimmed,
 * case-insensitive) match on one of the commands `AutohostControls` and the
 * Balance button already send. Returns null for anything else, including a
 * `!balance` with extra words tacked on, since SPADS itself takes no
 * arguments on these either, so a line that isn't exactly one of them isn't
 * the command.
 */
export function matchHostSuggestion(text: string): HostSuggestion | null {
  const kind = KIND_BY_COMMAND[text.trim().toLowerCase()];
  return kind ? { kind } : null;
}

/** The friendly sentence captioning the founder's Accept/Reject buttons
 *  (`HostSuggestionAction`), read alongside the plain command rather than
 *  replacing it (issue #2871): the chat line itself stays exactly what was
 *  sent, so it is still there to select or copy. */
export function hostSuggestionText(kind: HostSuggestionKind): string {
  switch (kind) {
    case "balance":
      return "Asked to balance the teams.";
    case "lock":
      return "Asked to lock the room.";
    case "unlock":
      return "Asked to unlock the room.";
  }
}

/** What accepting a suggestion does, in words. Used for the Accept button's
 *  own label and for the line posted back when the founder rejects one. */
export function hostSuggestionActionLabel(kind: HostSuggestionKind): string {
  switch (kind) {
    case "balance":
      return "balance the teams";
    case "lock":
      return "lock the room";
    case "unlock":
      return "unlock the room";
  }
}
