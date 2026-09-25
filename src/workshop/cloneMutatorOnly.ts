/**
 * Copies sent through the mutator route whole, because one of their changes
 * has no edit a file can take (issue #3035).
 *
 * A copy is written as a file or not at all (see `inplace_clone.rs`): sending
 * part of one to the mutator would leave the game with a unit whose file and
 * mutator disagree. So the mark is against the whole copy, by its key, rather
 * than against one of its fields the way `mutatorOnly.ts` marks a field. The
 * unit page finds an unwritable change with a dry run and offers to send the
 * whole copy that way. This records the answer.
 *
 * A mark sits on the project beside `edits`, like `mutatorOnly`. It changes
 * where the copy goes, not what the project changes, so the compiler never
 * reads it and a mutator carries the copy as it always did. The in-place
 * write (`inplace.rs`) skips a marked copy instead of refusing the whole
 * batch over it, and the Checks drawer says a mutator is still needed for it.
 *
 * A mark can outlive the copy it named, the same way a field mark can:
 * deleting the copy leaves the mark unused rather than removing it, and
 * nothing reads a mark for a copy that is not there.
 */

/** The copies sent through the mutator route, by key. */
export type CloneMutatorOnly = string[];

export function isCloneMutatorOnly(
  marks: CloneMutatorOnly | undefined,
  unit: string,
): boolean {
  return marks?.includes(unit) ?? false;
}

/**
 * Mark one copy, or take the mark off. Returns `marks` itself when nothing
 * changed.
 */
export function setCloneMutatorOnly(
  marks: CloneMutatorOnly | undefined,
  unit: string,
  on: boolean,
): CloneMutatorOnly {
  const current = marks ?? [];
  if (current.includes(unit) === on) return current;
  return on ? [...current, unit].sort() : current.filter((u) => u !== unit);
}

/**
 * Read the marks out of untrusted JSON. Anything that is not a string is
 * dropped, and so are duplicates.
 */
export function parseCloneMutatorOnly(value: unknown): CloneMutatorOnly {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((v): v is string => typeof v === "string")),
  ].sort();
}
