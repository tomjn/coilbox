/**
 * Turn a composer draft into the wire lines to send. Pure and React-free so it
 * can be unit-tested directly.
 *
 * There is no multi-line message on the wire - a newline is the protocol's own
 * delimiter - so a multi-line draft is sent as one command per line and put back
 * together by the reader (see `coalesce.ts`).
 */

/** How many lines one draft may become.
 *
 * Each line is a separate command, and no server in the uberserver family
 * promises to tolerate a burst of them, so this is a floodgate rather than a
 * style rule. It is well under `coalesce.ts`'s merge cap on purpose: what a bot
 * may legitimately emit is not a bound on what we should emit. */
export const MAX_COMPOSE_LINES = 10;

/** Either the lines to send in order, or why the draft can't be sent. An empty
 * `lines` means there was nothing to send (a blank draft), not a failure. */
export type Compose =
  | { kind: "send"; lines: string[] }
  | { kind: "error"; reason: string };

/** `/me <text>`, the IRC-style action. Mirrors `useConversation`'s routing. */
const ACTION = /^\/me(\s|$)/;

export function composeDraft(draft: string): Compose {
  const text = draft.trim();
  if (text === "") return { kind: "send", lines: [] };

  if (ACTION.test(text)) {
    // An emote is one line by nature: `* alice waves` split over three lines is
    // nonsense, and there is no second command to send the rest as. Refuse
    // rather than silently flatten or drop what the user typed.
    if (text.includes("\n")) {
      return { kind: "error", reason: "an emote can't span multiple lines" };
    }
    return { kind: "send", lines: [text] };
  }

  // Blank lines are dropped rather than sent: an empty SAY body is not
  // something to rely on servers accepting. The accepted cost is that interior
  // blank lines are lost, so paragraph breaks don't survive a send.
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

  if (lines.length > MAX_COMPOSE_LINES) {
    return {
      kind: "error",
      reason: `a message can be at most ${MAX_COMPOSE_LINES} lines (this one is ${lines.length})`,
    };
  }
  return { kind: "send", lines };
}
