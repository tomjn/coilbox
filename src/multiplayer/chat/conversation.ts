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

/** Stable string id for unread bookkeeping and selection.
 *
 * A battle is keyed by its channel rather than by its battle id, because that
 * is what every counter around it uses: the seen baseline, the backlog discount
 * and the nav badge all read battle chat out of `state.channels`. An id of its
 * own read as a conversation nobody had ever seen a message in, so the room's
 * badge counted on while you sat in the room reading it. */
export function convId(d: ConversationDescriptor): string {
  switch (d.kind) {
    case "channel":
      return `channel:${d.name}`;
    case "dm":
      return `dm:${d.peer}`;
    case "battle":
      return `channel:${d.channel}`;
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

/** The chat page's address for a conversation (issue #2406): the `/chat`
 * route with the conversation named in the query string, read once by
 * `useConversationParam`. A mention in another channel, a message
 * notification, and the match-result drawer's link to a debriefing channel
 * all resolve to this, so any of them can send somebody to the chat page
 * without it knowing which one sent them.
 *
 * A battle points here by its underlying channel, the same one `convId`
 * uses. Arriving this way opens it as a plain channel rather than the
 * battle-flavoured view the room itself shows, which is close enough for
 * "read what was said here", the only thing an outside link needs. */
export function conversationHref(d: ConversationDescriptor): string {
  const params =
    d.kind === "dm"
      ? new URLSearchParams({ dm: d.peer })
      : new URLSearchParams({
          channel: d.kind === "channel" ? d.name : d.channel,
        });
  return `/chat?${params.toString()}`;
}

/** What answering a `?channel=`/`?dm=` request (`useConversationParam`) does
 * against live state: open the conversation it names, or explain why not.
 * `null` means there is not yet enough state to tell (the mirror hasn't
 * loaded), so try again once more of the snapshot has arrived.
 *
 * Only a channel already joined this session may be opened this way (issue
 * #2406). The query names an intent, not permission to join on the reader's
 * behalf, so a channel absent from the snapshot is a clean rejection rather
 * than an autojoin. Whether arriving somewhere should join you to it is a
 * separate question this does not answer. A DM has no "joined" state to
 * check, so it always resolves once it is one. */
export type ConversationRequestResult =
  | { ok: true; descriptor: ConversationDescriptor }
  | { ok: false; reason: string };

export function resolveConversationRequest(
  requested: ConversationDescriptor,
  state: LobbyState | null | undefined,
): ConversationRequestResult | null {
  if (requested.kind !== "channel") return { ok: true, descriptor: requested };
  if (!state) return null;
  if (!state.channels[requested.name]) {
    return {
      ok: false,
      reason: `You have not joined ${requested.name}.`,
    };
  }
  return { ok: true, descriptor: requested };
}
