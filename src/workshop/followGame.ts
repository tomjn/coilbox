/**
 * Work a project's relative changes out again when it is opened against its
 * game (issue #3174). `relativeEdits.ts` holds the arithmetic. This is the
 * part that decides when it runs and remembers what it found.
 *
 * It runs once per project per read of the game: the first time a page holds
 * both the project and a finished read of the project's own game, and again
 * only if the game is read again with a different checksum. Whatever it
 * changes is one undo step. What it found is kept for the session, keyed by
 * project, so the checks still list it after the page that did the work is
 * left, and after `base` has caught up with the game so there is nothing
 * left to compare.
 */
import { useEffect, useRef, useState } from "react";
import type { CompatFinding } from "./compatibility";
import type { GameEdits, ModProject } from "./project";
import {
  describeFollow,
  followGame,
  type RelativeFollow,
} from "./relativeEdits";

/** A follow as a review finding, so it is counted, linked to its field and
 *  marked on the unit list the same way a compatibility finding is. */
export function followFinding(follow: RelativeFollow): CompatFinding {
  return {
    id: `relative:${follow.kind}:${follow.unit}:${follow.path}`,
    store: "overrides",
    severity: "review",
    subject: `${follow.unit}.${follow.path}`,
    detail: describeFollow(follow),
  };
}

/** What each project's last follow found, for the session. */
const found = new Map<string, CompatFinding[]>();
/** Which project and game reads have already been followed. */
const followed = new Set<string>();
const NONE: CompatFinding[] = [];

/** Forget everything, for tests. */
export function resetFollowGameSession() {
  found.clear();
  followed.clear();
}

export function useFollowGame({
  project,
  units,
  checksum,
  applyEdits,
  onStep,
}: {
  project: ModProject | undefined;
  /** The project's own game's unit table, or `undefined` until a finished
   *  read of that game is on the page. Never another game's. */
  units: Record<string, Record<string, unknown>> | undefined;
  checksum: string | undefined;
  applyEdits: (
    id: string,
    update: (current: GameEdits) => GameEdits,
  ) => { before: GameEdits; after: GameEdits } | null;
  /** Record the undo step, with the edits the follow was folded over. */
  onStep: (id: string, before: GameEdits) => void;
}): CompatFinding[] {
  const [, rerender] = useState(0);
  const latest = useRef({ applyEdits, onStep });
  latest.current = { applyEdits, onStep };
  const id = project?.id;

  useEffect(() => {
    if (!id || !units) return;
    const key = `${id}\u0000${checksum ?? ""}`;
    if (followed.has(key)) return;
    followed.add(key);
    let follows: RelativeFollow[] = [];
    const changed = latest.current.applyEdits(id, (current) => {
      const result = followGame(current, units);
      follows = result.follows;
      return result.edits;
    });
    if (changed) latest.current.onStep(id, changed.before);
    if (follows.length > 0) {
      found.set(id, follows.map(followFinding));
      rerender((n) => n + 1);
    }
  }, [id, units, checksum]);

  return id ? (found.get(id) ?? NONE) : NONE;
}
