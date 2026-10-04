import type { Battle } from "../bindings";

/**
 * Which battles have a friend in them, as the friends' names by battle id, in
 * name order. A battle with no friend has no entry. The host counts as being in
 * their battle. A names string rather than an array, so a row that is handed it
 * does not re-render when an unrelated battle changes.
 */
export function friendsInBattles(
  battles: (Pick<Battle, "id" | "host"> & {
    members: Record<string, unknown>;
  })[],
  friends: ReadonlySet<string>,
): Map<number, string> {
  const found = new Map<number, string>();
  if (friends.size === 0) return found;
  for (const b of battles) {
    const here = [...friends].filter(
      (name) => name === b.host || Object.hasOwn(b.members, name),
    );
    if (here.length > 0) {
      found.set(b.id, here.sort((a, c) => a.localeCompare(c)).join(", "));
    }
  }
  return found;
}
