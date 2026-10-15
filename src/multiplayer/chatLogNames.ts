import type { LobbyServer } from "../lobby-servers/config";
import type { ChatLogThread, LobbyState } from "./bindings";
import { isBattleChannel } from "./chat/conversation";
import { serverNameFor } from "./store";

/**
 * The folder name coilbox gives an account's chat logs: the `serverKey`
 * (`user@host:port`) with every character other than a letter, digit, dot or
 * hyphen turned into an underscore. Mirrors `sanitize_key` in the multiplayer
 * crate's `dmlog.rs`.
 */
export function sanitizeKey(serverKey: string): string {
  return serverKey.replace(/[^A-Za-z0-9.-]/g, "_");
}

/**
 * "NAME on Server name" for a chat log folder, the same wording the live Chat
 * page uses for a connection. The folder name `NAME__host_port` loses the
 * `@` and `:` as underscores, so this reads the port off the end and the host
 * before it (a host holds no underscores), and what is left is the username. A folder that
 * does not fit that shape is shown as it is.
 */
export function accountLabel(stem: string, servers: LobbyServer[]): string {
  const m = /^(.+)_([A-Za-z0-9.-]+)_(\d+)$/.exec(stem);
  if (!m) return stem;
  const [, user, host, port] = m;
  return `${user} on ${serverNameFor(`${user}@${host}:${port}`, servers)}`;
}

/**
 * What a saved conversation is called. Battle chat is saved under
 * `__battle__<id>`, which says nothing to a player, so it takes the battle's
 * title when a live connection for the same account still lists that battle
 * (the Chat page names it the same way) and otherwise reads "Battle chat <id>".
 */
export function threadLabel(
  thread: ChatLogThread,
  stem: string,
  liveStates: Record<string, LobbyState | null | undefined>,
): string {
  if (thread.kind !== "channel" || !isBattleChannel(thread.name)) {
    return thread.name;
  }
  const id = thread.name.slice("__battle__".length);
  const key = Object.keys(liveStates).find((k) => sanitizeKey(k) === stem);
  const title = key ? liveStates[key]?.battles[id]?.title : undefined;
  return title ? `${title} (battle chat)` : `Battle chat ${id}`;
}
