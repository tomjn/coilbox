import type { ChatMsg, LobbyState, User } from "../bindings";

/** Which conversation a chat surface is bound to. `battle` is reserved for the
 * future battle GUI and not used by the hub. */
export type ConversationDescriptor =
  | { kind: "channel"; name: string }
  | { kind: "dm"; peer: string };

/** Stable string id for unread bookkeeping and selection. */
export function convId(d: ConversationDescriptor): string {
  return d.kind === "channel" ? `channel:${d.name}` : `dm:${d.peer}`;
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

/** Resolve members of a conversation from the snapshot (empty for DMs). */
export function conversationMembers(
  state: LobbyState,
  d: ConversationDescriptor,
): User[] {
  if (d.kind !== "channel") return [];
  const ch = state.channels[d.name];
  if (!ch) return [];
  return ch.users
    .map((u) => state.users[u])
    .filter((u): u is User => Boolean(u));
}

/** Messages of a conversation from the snapshot. */
export function conversationMessages(
  state: LobbyState,
  d: ConversationDescriptor,
): ChatMsg[] {
  if (d.kind === "channel") return state.channels[d.name]?.messages ?? [];
  return state.dms?.[d.peer] ?? [];
}
