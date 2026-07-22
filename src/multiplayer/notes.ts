import { useSetting } from "@picoframe/frame";
import { useCallback } from "react";

/**
 * Private, client-side per-player notes ("smurf", "good teammate", …) — issue
 * #341. Purely local: never sent to the server or any other client. Keyed by
 * `serverKey` (a note about "Bob" on one server says nothing about "Bob" on
 * another), then by account id when known, falling back to the (lowercased)
 * name when it isn't — e.g. a note jotted from a chat roster that hasn't
 * resolved `userId` yet. An empty/whitespace-only note deletes the entry
 * rather than storing a blank string.
 */

/** Hard cap so a pasted wall of text can't bloat the settings store. */
export const NOTE_MAX_LENGTH = 280;

const STORAGE_KEY = "multiplayer.notes";

/** serverKey -> identity key -> note text. */
export type NotesMap = Record<string, Record<string, string>>;

/**
 * The identity key a note is filed under: the account id when known and
 * non-blank, otherwise the name, case-insensitive (nicks are case-insensitive
 * on the wire, same as `ignore.ts`).
 */
export function noteKey(userId: string | undefined, name: string): string {
  const id = userId?.trim();
  return id ? `id:${id}` : `name:${name.toLowerCase()}`;
}

/** The note for a player, or "" when there isn't one. */
export function getNote(
  map: NotesMap,
  serverKey: string,
  userId: string | undefined,
  name: string,
): string {
  return map[serverKey]?.[noteKey(userId, name)] ?? "";
}

/**
 * Set a player's note. A blank (trimmed-empty) `text` removes the entry
 * instead of storing it — "empty note" means "no note". Returns a new map;
 * `map` is left untouched.
 */
export function setNote(
  map: NotesMap,
  serverKey: string,
  userId: string | undefined,
  name: string,
  text: string,
): NotesMap {
  const key = noteKey(userId, name);
  const trimmed = text.trim().slice(0, NOTE_MAX_LENGTH);
  const server = { ...(map[serverKey] ?? {}) };

  if (!trimmed) {
    if (!(key in server)) return map;
    delete server[key];
  } else {
    server[key] = trimmed;
  }

  if (Object.keys(server).length === 0) {
    if (!(serverKey in map)) return map;
    const next = { ...map };
    delete next[serverKey];
    return next;
  }
  return { ...map, [serverKey]: server };
}

/** The full notes store, persisted like `ignore.ts`'s settings-backed map. */
export function useNotes() {
  return useSetting<NotesMap>(STORAGE_KEY, {});
}

/**
 * Note read/write bound to a connection's `serverKey` (or null when
 * disconnected, in which case reads are always empty and writes are no-ops).
 */
export function useNoteActions(serverKey: string | null) {
  const [map, setMap] = useNotes();

  const get = useCallback(
    (userId: string | undefined, name: string) =>
      serverKey ? getNote(map, serverKey, userId, name) : "",
    [map, serverKey],
  );

  const set = useCallback(
    (userId: string | undefined, name: string, text: string) => {
      if (!serverKey) return;
      setMap(setNote(map, serverKey, userId, name, text));
    },
    [map, serverKey, setMap],
  );

  return { get, set };
}
