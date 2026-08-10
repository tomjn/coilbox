import { useSetting } from "@picoframe/frame";
import { updateStoredSetting } from "../lib/storedSetting";
import type { ProfileLobby } from "../profile/profile";
import { getProfile } from "../profile/profile";

/**
 * A channel the user auto-joins on connect, optionally with a key/password. This is
 * both the "remembered" list (manual joins add to it) and the settings-managed
 * autojoin list — they are one and the same (issue #194). Keys are shared, low-
 * sensitivity secrets stored in the plaintext settings JSON alongside the name,
 * matching SpringLobby's `GetChannelsJoin`.
 */
export interface JoinedChannel {
  name: string;
  /** Optional channel key/password sent with `JOIN <chan> <key>`. */
  key?: string;
}

/**
 * A stored entry, tolerant of the legacy shape. The list used to persist bare
 * channel names (`string[]`); reads coerce those to `{ name }` so old settings
 * files keep working, and writes always emit the object form.
 */
export type StoredChannel = string | JoinedChannel;

/** Coerce one stored entry (possibly a legacy bare string) into a `JoinedChannel`. */
export function normalizeChannelEntry(entry: StoredChannel): JoinedChannel {
  return typeof entry === "string" ? { name: entry } : entry;
}

/** Coerce a stored list (possibly legacy / missing) into normalized entries. */
export function normalizeChannelList(
  raw: StoredChannel[] | undefined,
): JoinedChannel[] {
  return (raw ?? []).map(normalizeChannelEntry);
}

/**
 * Add (or update) a channel in the list, keyed by name. Adding an existing channel
 * with a key updates that entry's key rather than duplicating the row, so a manual
 * join and a later settings edit converge on one entry. Returns a new list.
 */
export function addChannel(
  list: JoinedChannel[],
  name: string,
  key?: string,
): JoinedChannel[] {
  const normalized = normalizeChannelList(list);
  const entry: JoinedChannel = key ? { name, key } : { name };
  const idx = normalized.findIndex((c) => c.name === name);
  if (idx === -1) return [...normalized, entry];
  // Preserve an existing key when no new key is supplied.
  const merged = key ? entry : normalized[idx];
  return normalized.map((c, i) => (i === idx ? merged : c));
}

/** Remove a channel by name. Returns a new list. */
export function removeChannel(
  list: JoinedChannel[],
  name: string,
): JoinedChannel[] {
  return normalizeChannelList(list).filter((c) => c.name !== name);
}

/**
 * The distribution's seed channels from a profile `lobby.channels` block, normalized
 * to {@link JoinedChannel}s. Pure (takes the block, not the singleton) so it's
 * unit-testable; entries may be bare names or `{ name, key }`, and blank names drop.
 */
export function defaultChannelsFrom(
  lobby: ProfileLobby | undefined,
): JoinedChannel[] {
  const out: JoinedChannel[] = [];
  for (const c of lobby?.channels ?? []) {
    const name = (typeof c === "string" ? c : c.name)?.trim();
    if (!name) continue;
    const key = typeof c === "string" ? undefined : c.key;
    out.push(key ? { name, key } : { name });
  }
  return out;
}

/** The profile's seed channels (from the load-once profile singleton). */
export function profileDefaultChannels(): JoinedChannel[] {
  return defaultChannelsFrom(getProfile().lobby);
}

/**
 * The per-`serverKey` autojoin/remembered channel list. A preference (re-derivable
 * by rejoining), so it lives in the frame settings store rather than backend state.
 * The value tolerates the legacy `string[]` shape on read via `normalizeChannelList`.
 */
export function useJoinedChannels() {
  return useSetting<JoinedChannels>(JOINED_CHANNELS_KEY, {});
}

export const JOINED_CHANNELS_KEY = "multiplayer.joinedChannels";

/** The stored autojoin lists, keyed by `serverKey`. */
export type JoinedChannels = Record<string, StoredChannel[]>;

/**
 * Add a channel to a server's stored list, folding it into the lists as stored
 * rather than the lists a render read. Joins are persisted one confirmation at a
 * time, so a first connect that joins several channels writes several times
 * before anything re-renders. Folding over the render's copy remembered only the
 * last channel (issue #1375). `write` is the setter `useJoinedChannels` returns.
 */
export function rememberJoinedChannel(
  serverKey: string,
  name: string,
  key: string | undefined,
  write: (next: JoinedChannels) => void,
) {
  updateStoredSetting<JoinedChannels>(
    JOINED_CHANNELS_KEY,
    {},
    write,
    (all) => ({
      ...all,
      [serverKey]: addChannel(normalizeChannelList(all[serverKey]), name, key),
    }),
  );
}

/** Drop a channel from a server's stored list. Folds over storage, as
 * {@link rememberJoinedChannel} does and for the same reason. */
export function forgetJoinedChannel(
  serverKey: string,
  name: string,
  write: (next: JoinedChannels) => void,
) {
  updateStoredSetting<JoinedChannels>(
    JOINED_CHANNELS_KEY,
    {},
    write,
    (all) => ({
      ...all,
      [serverKey]: removeChannel(normalizeChannelList(all[serverKey]), name),
    }),
  );
}
