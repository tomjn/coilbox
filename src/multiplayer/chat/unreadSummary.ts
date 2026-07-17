/**
 * Sidebar nav-badge derivations (issue #273). Pure summaries over the lobby state
 * mirror, computing the counts shown on the Chat and Battle Room sidebar items.
 *
 * These reuse the store's existing read bookkeeping: callers pass `unreadOf`
 * (the store's `unreadFor`), from which each conversation's seen index is derived
 * as `total - unreadOf(id, total)`. Kept store-free so they can be unit-tested and
 * so the badge components stay thin. Keys mirror `conversationCounts`.
 */
import type { ChatMsg, LobbyState } from "../bindings";
import { isBattleChannel } from "./conversation";
import { matchesHighlight } from "./highlight";

/** Highlight-word settings, as read from the frame settings store. */
export interface HighlightConfig {
  words: string[];
  ownEnabled: boolean;
}

/**
 * Count of unread "news" in a message list: messages after the `seen` index that
 * are not the user's own lines, optionally restricted to those matching `pred`.
 * Excluding own lines drops both messages the user sent and the server's echo of
 * their own JOIN — neither is news to them (mirrors `ConversationSidebar`).
 */
export function unreadNews(
  msgs: ChatMsg[],
  seen: number,
  me: string | null,
  pred?: (m: ChatMsg) => boolean,
): number {
  const from = Math.max(0, Math.min(seen, msgs.length));
  let n = 0;
  for (let i = from; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.from === me) continue;
    if (pred && !pred(m)) continue;
    n++;
  }
  return n;
}

/** Derive the seen index for a conversation id from the store's `unreadOf`. */
function seenIndex(
  id: string,
  total: number,
  unreadOf: (id: string, total: number) => number,
): number {
  return total - unreadOf(id, total);
}

/** The current battle, or undefined when not in one. */
function currentBattle(state: LobbyState) {
  return state.currentBattle != null
    ? state.battles[String(state.currentBattle)]
    : undefined;
}

/**
 * Chat nav badge count: signal-focused unread — direct messages (skipping ignored
 * peers) plus highlight-word hits across joined channels. General channel chatter
 * that doesn't mention you is deliberately not counted, so a busy channel can't
 * inflate the badge. Battle chat is excluded here; it feeds the Battle Room badge.
 */
export function chatBadgeCount(
  state: LobbyState,
  unreadOf: (id: string, total: number) => number,
  hl: HighlightConfig,
  isIgnoredPeer: (peer: string) => boolean,
): number {
  const me = state.myUsername;
  let n = 0;

  const dms = state.dms ?? {};
  for (const peer of Object.keys(dms)) {
    if (isIgnoredPeer(peer)) continue;
    const msgs = dms[peer];
    const id = `dm:${peer}`;
    n += unreadNews(msgs, seenIndex(id, msgs.length, unreadOf), me);
  }

  for (const name of Object.keys(state.channels)) {
    if (isBattleChannel(name)) continue;
    const msgs = state.channels[name].messages;
    const id = `channel:${name}`;
    n += unreadNews(msgs, seenIndex(id, msgs.length, unreadOf), me, (m) =>
      matchesHighlight(m.text, hl.words, me, hl.ownEnabled),
    );
  }

  return n;
}

/**
 * Battle Room nav badge count: unread news in the current battle's chat channel
 * (its synthetic `__battle__<id>` bucket). Zero when not in a battle or the
 * channel has no bucket yet.
 */
export function battleBadgeCount(
  state: LobbyState,
  unreadOf: (id: string, total: number) => number,
): number {
  const battle = currentBattle(state);
  const channel = battle?.channel;
  if (!channel) return 0;
  const ch = state.channels[channel];
  if (!ch) return 0;
  const id = `channel:${channel}`;
  return unreadNews(
    ch.messages,
    seenIndex(id, ch.messages.length, unreadOf),
    state.myUsername,
  );
}

/**
 * Whether the current battle's game is running, i.e. its host is in-game. Drives
 * the Battle Room status dot: an actionable "your game has started" cue while you
 * are on another page. False when not in a battle or the host is unknown.
 */
export function battleLive(state: LobbyState): boolean {
  const battle = currentBattle(state);
  if (!battle) return false;
  return state.users[battle.host]?.status.ingame ?? false;
}
