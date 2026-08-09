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

/**
 * The lines to send, or why the draft can't be sent.
 *
 * `maxChars` is the protocol's own limit on one message, where it has one
 * (Tachyon caps a message at 512). Over it, the draft is refused with the count
 * rather than truncated: a message cut off mid-sentence is worse than one the
 * user is asked to shorten.
 */
export function composeDraft(
  draft: string,
  maxChars: number | null = null,
): Compose {
  const text = draft.trim();
  if (text === "") return { kind: "send", lines: [] };

  if (ACTION.test(text)) {
    // An emote is one line by nature: `* alice waves` split over three lines is
    // nonsense, and there is no second command to send the rest as. Refuse
    // rather than silently flatten or drop what the user typed.
    if (text.includes("\n")) {
      return { kind: "error", reason: "an emote can't span multiple lines" };
    }
    return tooLong([text], maxChars) ?? { kind: "send", lines: [text] };
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
  return tooLong(lines, maxChars) ?? { kind: "send", lines };
}

/** The refusal for the first line over `maxChars`, or null when every line fits.
 *
 * Each line is sent as its own message, so the limit is per line rather than
 * per draft. Characters, not bytes, because that is what the schema counts. */
function tooLong(lines: string[], maxChars: number | null): Compose | null {
  if (maxChars == null) return null;
  const over = lines.find((line) => [...line].length > maxChars);
  if (over == null) return null;
  return {
    kind: "error",
    reason: `a message can be at most ${maxChars} characters (this one is ${[...over].length})`,
  };
}
