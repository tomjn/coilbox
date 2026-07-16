import type { ChatMsg, LobbyState, User } from "../bindings";

/** Which conversation a chat surface is bound to. A `battle` is backed by its
 * server-side `__battle__<id>` channel but carries the battle `id` so the UI can
 * show the battle title and offer "leave battle" instead of "leave channel". */
export type ConversationDescriptor =
  | { kind: "channel"; name: string }
  | { kind: "dm"; peer: string }
  | { kind: "battle"; id: number; channel: string };

/** The TASServer auto-joins a per-battle channel named `__battle__<id>`; these
 * are surfaced as battle conversations, not listed among real channels. */
export function isBattleChannel(name: string): boolean {
  return name.startsWith("__battle__");
}

/** Stable string id for unread bookkeeping and selection. */
export function convId(d: ConversationDescriptor): string {
  switch (d.kind) {
    case "channel":
      return `channel:${d.name}`;
    case "dm":
      return `dm:${d.peer}`;
    case "battle":
      return `battle:${d.id}`;
  }
}

/** All conversation ids present in a snapshot, with their current message counts. */
export function conversationCounts(state: LobbyState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(state.channels)) {
    out[`channel:${name}`] = state.channels[name].messages.length;
  }
  for (const peer of Object.keys(state.dms ?? {})) {
    out[`dm:${peer}`] = state.dms[peer].length;
  }
  return out;
}

/** Per-conversation count of messages replayed from the server's channel history
 * (those carrying an `id`), keyed as `conversationCounts` keys them.
 *
 * A backlog is history, not news, so unread bookkeeping has to discount it. This
 * counts rather than assuming the backlog sits at the head of the array: a live
 * message can land mid-burst, and a count doesn't care where. Only channels can
 * have any — DMs are never replayed by the server. */
export function backfilledCounts(state: LobbyState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(state.channels)) {
    const n = state.channels[name].messages.filter((m) => m.id != null).length;
    if (n > 0) out[`channel:${name}`] = n;
  }
  return out;
}

/** Resolve members of a conversation from the snapshot (empty for DMs). */
export function conversationMembers(
  state: LobbyState,
  d: ConversationDescriptor,
): User[] {
  const channel =
    d.kind === "channel" ? d.name : d.kind === "battle" ? d.channel : null;
  if (channel == null) return [];
  const ch = state.channels[channel];
  if (!ch) return [];
  return ch.users
    .map((u) => state.users[u])
    .filter((u): u is User => Boolean(u));
}

/** Messages of a conversation from the snapshot. Battle chat lives in the
 * synthetic `__battle__<id>` channel bucket, keyed by the descriptor's channel. */
export function conversationMessages(
  state: LobbyState,
  d: ConversationDescriptor,
): ChatMsg[] {
  if (d.kind === "dm") return state.dms?.[d.peer] ?? [];
  const channel = d.kind === "channel" ? d.name : d.channel;
  return state.channels[channel]?.messages ?? [];
}
