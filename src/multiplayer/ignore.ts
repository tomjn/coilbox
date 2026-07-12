import { useSetting } from "@picoframe/frame";
import { useCallback } from "react";
import { mpIgnore, mpUnignore } from "./bindings";

/**
 * The local ignore list: usernames whose channel and private messages are hidden
 * client-side. Purely local for now — issue #188 stacks server-side IGNORE/UNIGNORE
 * sync on top of this store as the base layer. Keyed by `serverKey`
 * (`username@host:port`), since ignores are per-account. Names are stored raw
 * (canonical casing) but compared case-insensitively, since nicks are
 * case-insensitive on the wire.
 */

/** Case-insensitive membership test for a single serverKey's list. */
export function isIgnored(
  map: Record<string, string[]>,
  serverKey: string,
  name: string,
): boolean {
  const lower = name.toLowerCase();
  return (map[serverKey] ?? []).some((n) => n.toLowerCase() === lower);
}

/** The (raw) ignored names for a serverKey; empty when none / missing. */
export function ignoredFor(
  map: Record<string, string[]>,
  serverKey: string,
): string[] {
  return map[serverKey] ?? [];
}

/**
 * Add a name to a serverKey's ignore list. Deduped case-insensitively (an existing
 * entry keeps its stored casing). Blank names are ignored. Returns a new map.
 */
export function addIgnore(
  map: Record<string, string[]>,
  serverKey: string,
  name: string,
): Record<string, string[]> {
  const trimmed = name.trim();
  if (!trimmed) return map;
  const list = map[serverKey] ?? [];
  if (isIgnored(map, serverKey, trimmed)) return map;
  return { ...map, [serverKey]: [...list, trimmed] };
}

/** Remove a name (case-insensitively) from a serverKey's list. Returns a new map. */
export function removeIgnore(
  map: Record<string, string[]>,
  serverKey: string,
  name: string,
): Record<string, string[]> {
  const lower = name.toLowerCase();
  const list = map[serverKey] ?? [];
  return {
    ...map,
    [serverKey]: list.filter((n) => n.toLowerCase() !== lower),
  };
}

/**
 * The per-`serverKey` ignore list. A client-side preference, so it lives in the
 * frame settings store rather than backend state and persists across restarts.
 */
export function useIgnored() {
  return useSetting<Record<string, string[]>>("multiplayer.ignored", {});
}

/**
 * Ignore actions bound to a connection's `serverKey` (or null when disconnected).
 * Wraps the local settings-store mutation so it ALSO syncs with the server's
 * IGNORE/UNIGNORE commands (issue #188): the local change is authoritative for
 * client-side hiding and always applied, while the server call is best-effort —
 * failures (e.g. a server without ignore support) are swallowed so hiding still
 * works locally. `serverKey` is passed in rather than read from the store to keep
 * this module free of a `store` import cycle.
 */
export function useIgnoreActions(serverKey: string | null) {
  const [map, setMap] = useIgnored();

  const list = serverKey ? ignoredFor(map, serverKey) : [];

  const has = useCallback(
    (name: string) => (serverKey ? isIgnored(map, serverKey, name) : false),
    [map, serverKey],
  );

  const ignore = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!serverKey || !trimmed) return;
      setMap(addIgnore(map, serverKey, trimmed));
      // Best-effort server sync; local hiding above works regardless of support.
      mpIgnore({ serverKey, username: trimmed }).catch(() => {});
    },
    [map, serverKey, setMap],
  );

  const unignore = useCallback(
    (name: string) => {
      if (!serverKey) return;
      setMap(removeIgnore(map, serverKey, name));
      mpUnignore({ serverKey, username: name }).catch(() => {});
    },
    [map, serverKey, setMap],
  );

  const toggle = useCallback(
    (name: string) => {
      if (!serverKey) return;
      if (isIgnored(map, serverKey, name)) unignore(name);
      else ignore(name);
    },
    [map, serverKey, ignore, unignore],
  );

  return { list, has, ignore, unignore, toggle };
}
