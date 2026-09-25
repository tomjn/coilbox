/**
 * Whether a copy's own changes can be written into the game's own files,
 * asked while the copy is being edited (issue #3035).
 *
 * `workshop_check_clone_in_place` compares the copy's definition against its
 * source's values, the same way the write does, and reads no file. The unit
 * page asks it for the open copy so an unwritable change is shown before the
 * user reaches the write, the way `inPlaceCheck.ts` does for a game unit's
 * fields.
 *
 * Cached for the session, per game folder, per checksum, per copy, and per
 * the copy's own content: the check is a diff of the whole definition rather
 * than one field at a time, so unlike a field probe it has to be asked again
 * whenever the copy's own overrides or build menu change, not only when the
 * game does.
 */
import { useEffect, useState } from "react";
import type { BuildMenuOp } from "./buildMenus";
import type { UnitClone } from "./clones";
import { type CloneCheck, workshopCheckCloneInPlace } from "./inPlace";

const answers = new Map<string, CloneCheck>();
const asking = new Set<string>();
const listeners = new Set<() => void>();

function cacheKey(
  gameDir: string,
  checksum: string,
  clone: UnitClone,
  overrides: Record<string, unknown> | undefined,
  menuOps: BuildMenuOp[] | undefined,
): string {
  return [
    gameDir,
    checksum,
    clone.key,
    JSON.stringify(clone.def),
    JSON.stringify(overrides ?? {}),
    JSON.stringify(menuOps ?? []),
  ].join("\n");
}

/** Forget every answer. For tests. */
export function clearCloneInPlaceChecks() {
  answers.clear();
  asking.clear();
}

export interface CloneInPlaceCheckState {
  check: CloneCheck | null;
  error: string | null;
}

const NONE: CloneInPlaceCheckState = { check: null, error: null };

/**
 * Ask about `clone` in the game at `gameDir`. Pass `gameDir` or `sourceDef`
 * undefined when the route does not apply, or when the game's read of the
 * source has not landed, and nothing is asked.
 */
export function useCloneInPlaceCheck(
  gameDir: string | undefined,
  checksum: string | undefined,
  clone: UnitClone | undefined,
  overrides: Record<string, unknown> | undefined,
  menuOps: BuildMenuOp[] | undefined,
  sourceDef: Record<string, unknown> | undefined,
): CloneInPlaceCheckState {
  const key =
    gameDir && checksum && clone && sourceDef
      ? cacheKey(gameDir, checksum, clone, overrides, menuOps)
      : null;
  const [, setAnswered] = useState(0);
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );

  useEffect(() => {
    const heard = () => setAnswered((n) => n + 1);
    listeners.add(heard);
    return () => {
      listeners.delete(heard);
    };
  }, []);

  useEffect(() => {
    if (!key || !gameDir || !clone || !sourceDef) return;
    if (answers.has(key) || asking.has(key)) return;
    asking.add(key);
    workshopCheckCloneInPlace({ gameDir, clone, overrides, menuOps, sourceDef })
      .then((result) => {
        answers.set(key, result);
        setError(null);
      })
      .catch((e: unknown) => {
        setError({ key, message: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        asking.delete(key);
        for (const heard of listeners) heard();
      });
  }, [key, gameDir, clone, overrides, menuOps, sourceDef]);

  if (!key) return NONE;
  return {
    check: answers.get(key) ?? null,
    error: error?.key === key ? error.message : null,
  };
}
