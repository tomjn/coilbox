import { useSetting } from "@picoframe/frame";
import { useMemo } from "react";

/**
 * One replay in a set. The filename is the key, because it is the one thing
 * every row of the replay list has (the same key `replayUserState` uses). The
 * game id, which the engine writes into the demo and which survives a rename,
 * is kept alongside when a stat record supplied it, so a renamed file can still
 * be found again.
 */
export interface ReplaySetMember {
  filename: string;
  gameId?: string;
}

/** A named set of replays. It can be empty, renamed and described. */
export interface ReplaySet {
  id: string;
  name: string;
  description?: string;
  members: ReplaySetMember[];
}

export type SetResult =
  | { ok: true; sets: ReplaySet[] }
  | { ok: false; error: string };

/** The least a thing needs to be matched against a set's members. */
export interface SetCandidate {
  filename: string;
  gameId?: string;
  /** A remix is a new file of the same match, so it never claims a member by game id. */
  remixed?: boolean;
}

export const REPLAY_SETS_KEY = "content.replaySets";

/**
 * Read whatever is stored as a list of sets. Anything that is not a list, and
 * any entry without an id and a name, is dropped. A missing members list reads
 * as empty, so a value written by an older build never throws.
 */
export function normaliseSets(raw: unknown): ReplaySet[] {
  if (!Array.isArray(raw)) return [];
  const sets: ReplaySet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    const members: ReplaySetMember[] = [];
    if (Array.isArray(o.members)) {
      for (const m of o.members) {
        if (!m || typeof m !== "object") continue;
        const mm = m as Record<string, unknown>;
        if (typeof mm.filename !== "string" || !mm.filename) continue;
        members.push(
          typeof mm.gameId === "string" && mm.gameId
            ? { filename: mm.filename, gameId: mm.gameId }
            : { filename: mm.filename },
        );
      }
    }
    sets.push({
      id: o.id,
      name: o.name,
      ...(typeof o.description === "string" && o.description
        ? { description: o.description }
        : {}),
      members,
    });
  }
  return sets;
}

/** The reason a name cannot be used, or null. Names are compared trimmed and ignoring case. */
export function validateSetName(
  name: string,
  sets: ReplaySet[],
  exceptId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the set a name.";
  const lower = trimmed.toLowerCase();
  if (sets.some((s) => s.id !== exceptId && s.name.toLowerCase() === lower)) {
    return `A set called “${trimmed}” already exists.`;
  }
  return null;
}

export function createSet(
  sets: ReplaySet[],
  id: string,
  name: string,
  description?: string,
): SetResult {
  const error = validateSetName(name, sets);
  if (error) return { ok: false, error };
  const desc = description?.trim();
  return {
    ok: true,
    sets: [
      ...sets,
      {
        id,
        name: name.trim(),
        ...(desc ? { description: desc } : {}),
        members: [],
      },
    ],
  };
}

/** Change a set's name and description together. An empty description clears it. */
export function updateSet(
  sets: ReplaySet[],
  id: string,
  name: string,
  description: string,
): SetResult {
  const error = validateSetName(name, sets, id);
  if (error) return { ok: false, error };
  const desc = description.trim();
  return {
    ok: true,
    sets: sets.map((s) => {
      if (s.id !== id) return s;
      const { description: _old, ...rest } = s;
      return {
        ...rest,
        name: name.trim(),
        ...(desc ? { description: desc } : {}),
      };
    }),
  };
}

/** Delete the set only. Nothing here touches a replay file. */
export function deleteSet(sets: ReplaySet[], id: string): ReplaySet[] {
  return sets.filter((s) => s.id !== id);
}

/**
 * Add replays to a set. A filename already in the set stays once, and gains a
 * game id if it had none.
 */
export function addMembers(
  sets: ReplaySet[],
  id: string,
  add: ReplaySetMember[],
): ReplaySet[] {
  return sets.map((s) => {
    if (s.id !== id) return s;
    const members = [...s.members];
    for (const m of add) {
      const at = members.findIndex((x) => x.filename === m.filename);
      if (at === -1) members.push(m);
      else if (!members[at].gameId && m.gameId) members[at] = m;
    }
    return { ...s, members };
  });
}

export function removeMembers(
  sets: ReplaySet[],
  id: string,
  filenames: string[],
): ReplaySet[] {
  const drop = new Set(filenames);
  return sets.map((s) =>
    s.id === id
      ? { ...s, members: s.members.filter((m) => !drop.has(m.filename)) }
      : s,
  );
}

export interface ResolvedSet<T> {
  /** Items that are members, in the order they were given. */
  present: T[];
  /** Members with no matching item: moved out of the library, deleted, or not listed yet. */
  missing: ReplaySetMember[];
}

/**
 * Match a set's members against the items in view. A member matches the item
 * with its filename. Failing that, it matches an item with the same game id,
 * which finds a file that was renamed. A remix never matches by game id, so
 * adding a match does not pull in its remixes.
 */
export function resolveSet<T extends SetCandidate>(
  set: ReplaySet,
  items: T[],
  gameIdOf: (item: T) => string | undefined = (i) => i.gameId,
): ResolvedSet<T> {
  const byName = new Map(items.map((i) => [i.filename, i]));
  const claimed = new Set<T>();
  const unmatched: ReplaySetMember[] = [];
  for (const m of set.members) {
    const hit = byName.get(m.filename);
    if (hit) claimed.add(hit);
    else unmatched.push(m);
  }
  const missing: ReplaySetMember[] = [];
  for (const m of unmatched) {
    const hit = m.gameId
      ? items.find(
          (i) => !claimed.has(i) && !i.remixed && gameIdOf(i) === m.gameId,
        )
      : undefined;
    if (hit) claimed.add(hit);
    else missing.push(m);
  }
  return { present: items.filter((i) => claimed.has(i)), missing };
}

/** The set with this id, or undefined (a saved pick whose set was since deleted). */
export function findSet(sets: ReplaySet[], id: string): ReplaySet | undefined {
  return id ? sets.find((s) => s.id === id) : undefined;
}

let counter = 0;
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  counter += 1;
  return `set-${Date.now().toString(36)}-${counter}`;
}

/**
 * The user's replay sets, persisted through the frame settings store like
 * `useReplayUserState`. Each action returns an error message or null, so a form
 * can show why a name was refused.
 */
export function useReplaySets() {
  const [stored, setStored] = useSetting<ReplaySet[]>(REPLAY_SETS_KEY, []);
  const sets = useMemo(() => normaliseSets(stored), [stored]);

  const apply = (r: SetResult): string | null => {
    if (!r.ok) return r.error;
    setStored(r.sets);
    return null;
  };

  return {
    sets,
    /** Returns the new set's id, or an error message. Members go in with the
     * set, because two writes in one tick would overwrite each other. */
    create: (
      name: string,
      description?: string,
      members: ReplaySetMember[] = [],
    ): { id: string } | { error: string } => {
      const id = newId();
      const r = createSet(sets, id, name, description);
      if (!r.ok) return { error: r.error };
      setStored(addMembers(r.sets, id, members));
      return { id };
    },
    update: (id: string, name: string, description: string) =>
      apply(updateSet(sets, id, name, description)),
    remove: (id: string) => setStored(deleteSet(sets, id)),
    add: (id: string, members: ReplaySetMember[]) =>
      setStored(addMembers(sets, id, members)),
    removeFrom: (id: string, filenames: string[]) =>
      setStored(removeMembers(sets, id, filenames)),
  };
}

export type ReplaySetsApi = ReturnType<typeof useReplaySets>;
