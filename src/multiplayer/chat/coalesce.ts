import type { ChatKind, ChatMsg } from "../bindings";

/**
 * Merge a burst of one sender's messages back into a single multi-line message.
 *
 * The lobby protocol has no multi-line message: a newline is the wire's own
 * delimiter, so anything paragraph-shaped - a SPADS command list, a stats table,
 * or our own composer's multi-line send - arrives as one message per line. This
 * is purely a presentation concern: the reducer keeps storing one `ChatMsg` per
 * wire line (deltas index into that array positionally), and this reassembles
 * the block for display.
 */

/** Maximum gap between two adjacent lines of one block. Paced bot output and a
 * round-trip to the server both fit inside this; a reply to something typed
 * before it does not. */
export const COALESCE_WINDOW_MS = 1500;

/** Runaway guard: a longer run starts a new block rather than growing without
 * bound. Deliberately above the composer's own 10-line cap - bot output is not
 * limited by what we can compose, and this exists to bound the blob, not to
 * express a policy about block length. */
export const MAX_MERGE_PARTS = 20;

/** Kinds that can be part of a multi-line block.
 *
 * `saidEx` is excluded: an emote is inherently one line, and `* alice waves`
 * split across three of them is nonsense. Notices (`system`/`join`/`leave`)
 * aren't a sender's prose at all. */
const MERGEABLE: ReadonlySet<ChatKind> = new Set<ChatKind>([
  "said",
  "saidBattle",
  "private",
]);

/**
 * Whether `b` continues the block `a` started.
 *
 * The `at === 0` guard is load-bearing: `at` is 0 whenever the reducer ran
 * without a clock, and two such messages have a gap of 0, which sails through
 * the window check - an unguarded implementation would merge an entire
 * untimestamped history into one blob.
 */
function continues(a: ChatMsg, b: ChatMsg): boolean {
  if (!MERGEABLE.has(a.kind) || !MERGEABLE.has(b.kind)) return false;
  if (a.kind !== b.kind) return false;
  if (a.from !== b.from) return false;
  if (!a.at || !b.at) return false;
  return b.at - a.at <= COALESCE_WINDOW_MS;
}

/**
 * Fold runs of adjacent messages into multi-line ones. Callers are already
 * per-conversation, so channel identity needs no check here.
 *
 * The window applies to each adjacent gap, not to a run's total span: a paced
 * ten-line send legitimately takes longer end to end than one gap allows. The
 * merged message keeps the first part's fields (so `at` - and therefore the
 * block's position and its day divider - is where the run started) and carries
 * the parts' text joined by newlines.
 */
export function coalesceMessages(msgs: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  let parts: ChatMsg[] = [];

  const flush = () => {
    if (parts.length === 0) return;
    out.push(
      parts.length === 1
        ? parts[0]
        : { ...parts[0], text: parts.map((p) => p.text).join("\n") },
    );
    parts = [];
  };

  for (const m of msgs) {
    // Compared against the last part, not the block's first: the window is
    // per-gap, and `parts` holds the unmerged originals until flush.
    const prev = parts[parts.length - 1];
    if (prev && parts.length < MAX_MERGE_PARTS && continues(prev, m)) {
      parts.push(m);
      continue;
    }
    flush();
    parts.push(m);
  }
  flush();
  return out;
}
