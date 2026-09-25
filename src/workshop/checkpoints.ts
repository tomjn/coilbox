/**
 * A checkpoint is a named, described snapshot of a project's edits that a
 * person can go back to in one action (issue #2657, sitting between #1282's
 * saving and its undo stack).
 *
 * Balancing is experimental. Someone tries a set of numbers, plays a game, and
 * wants back to how things were an hour ago without hunting through undo
 * history or a folder of exported files. A checkpoint is that "an hour ago":
 * pressed on purpose, named, and restorable without walking the undo stack one
 * step at a time.
 *
 * **Kept apart from the project, not inside it.** `ModProject.edits` is
 * rewritten on every keystroke through `useModProjects`, and a checkpoint
 * copies the whole of it. Holding checkpoints on the project would mean every
 * save touched a growing list it did not otherwise need to read, and would
 * make `updatedAt` and the undo stack's own snapshots harder to reason about
 * next to a second copy sitting right beside them. Storing them under their
 * own settings key, by project id, keeps a checkpoint's cost where it belongs:
 * paid only when a checkpoint is actually taken.
 *
 * **Never exported.** Like `ModProject.writtenInPlace` and
 * `distributionVersion`, a checkpoint is bookkeeping for this machine, not
 * something to carry across a share. Keeping it in a settings key the
 * container never reads is what makes that automatic, rather than one more
 * field `modProjectPayload` has to remember to leave out.
 *
 * **Autosave skips when nothing changed**, checked by comparing serialised
 * `edits` rather than by reference. `applyEdits` can tell two states apart by
 * object identity because it never leaves memory. A checkpoint does: the read
 * that folds an autosave over what is already stored (`updateStoredSetting`,
 * for the reason its own doc comment gives) goes through the settings store's
 * JSON round trip, which hands back a deserialised copy of the last
 * checkpoint's `edits` that can never be the same object the running page
 * holds even when nothing has changed. A structural comparison is the only
 * one that survives that round trip.
 *
 * **Restoring is a single undo step**, done by the caller: it hands a
 * checkpoint's `edits` to the same `commit` every other change on the page
 * goes through, so the state a restore replaces is one `undo` press away.
 * Nothing here performs the restore itself.
 *
 * **What a restore leaves alone.** `ModProject.writtenInPlace`,
 * `copiesWrittenInPlace` and `checksumBeforeInPlace` describe what is already
 * on disk in the game's own folder, not what `edits` says the project wants.
 * A checkpoint has no opinion about the game folder and restoring one does
 * not touch it. Undoing a write already accepted onto disk is what the Checks
 * drawer's own undo is for (issue #3027), not something a checkpoint should
 * do as a side effect of putting `edits` back.
 */
import { useSetting } from "@picoframe/frame";
import { updateStoredSetting } from "../lib/storedSetting";
import type { GameEdits } from "./project";

/** Where the checkpoints for every project are kept in the frame settings
 *  store, one key holding all of them the way `PROJECTS_KEY` holds every
 *  project. */
export const CHECKPOINTS_KEY = "workshop.checkpoints";

/**
 * How often an open project autosaves a checkpoint, and how many of those
 * autosaves are kept.
 *
 * Five minutes and five kept: an assumption, not a measurement. Short enough
 * that a crash costs minutes of work rather than a session, long enough that
 * moving a slider ten times does not fill the list with near-duplicates.
 * Manual checkpoints are never capped: a person naming one has already
 * decided it is worth keeping.
 */
export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
export const AUTOSAVE_LIMIT = 5;

/** One named snapshot of a project's edits. */
export interface Checkpoint {
  /** Stable identity, because two checkpoints may share a name. */
  id: string;
  name: string;
  /** What the checkpoint is for, in the author's own words. Optional, the
   *  same way a project's own description is: an autosave writes itself with
   *  none. */
  description?: string;
  /** Whether a person pressed the button, or the timer did. An autosave is
   *  capped and rotates. A manual checkpoint is kept until deleted. */
  kind: "manual" | "autosave";
  /** The whole of `GameEdits` at the moment the checkpoint was taken. The
   *  same object a project's own `edits` held, so an unrelated store's
   *  update between two checkpoints costs only the reference to the parts
   *  that did not change, not a deep copy. */
  edits: GameEdits;
  createdAt: string;
}

/** Every project's checkpoints, newest first, by project id. A project with
 *  none is simply absent rather than mapped to an empty array. */
export type ProjectCheckpoints = Record<string, Checkpoint[]>;

/** A stable empty, so a project with no checkpoints does not hand back a
 *  fresh array on every read. */
const NO_CHECKPOINTS: Checkpoint[] = [];

/** A project's checkpoints, newest first. */
export function checkpointsFor(
  all: ProjectCheckpoints,
  projectId: string,
): Checkpoint[] {
  return all[projectId] ?? NO_CHECKPOINTS;
}

/** Drop the oldest autosaves past {@link AUTOSAVE_LIMIT}, keeping every manual
 *  checkpoint regardless of how many there are. Manual checkpoints keep their
 *  position in the list. Only the autosaves among the trailing entries are
 *  trimmed. */
function capAutosaves(list: Checkpoint[]): Checkpoint[] {
  let seen = 0;
  const out: Checkpoint[] = [];
  for (const checkpoint of list) {
    if (checkpoint.kind === "autosave") {
      seen += 1;
      if (seen > AUTOSAVE_LIMIT) continue;
    }
    out.push(checkpoint);
  }
  return out;
}

/** Add a checkpoint to the front of a project's list, capping autosaves as
 *  it goes. `id` and `createdAt` are minted here, the same way
 *  `createProject` mints a project's. */
function addCheckpoint(
  all: ProjectCheckpoints,
  projectId: string,
  input: {
    kind: Checkpoint["kind"];
    name: string;
    description?: string;
    edits: GameEdits;
  },
): ProjectCheckpoints {
  const checkpoint: Checkpoint = {
    id: crypto.randomUUID(),
    name: input.name,
    ...(input.description?.trim()
      ? { description: input.description.trim() }
      : {}),
    kind: input.kind,
    edits: input.edits,
    createdAt: new Date().toISOString(),
  };
  const list = capAutosaves([checkpoint, ...checkpointsFor(all, projectId)]);
  return { ...all, [projectId]: list };
}

/** Save a checkpoint a person named on purpose. Always added, never capped,
 *  even when its edits match the newest checkpoint already held: pressing the
 *  button is the point, not a fact only inferred from a changed value. */
export function saveCheckpoint(
  all: ProjectCheckpoints,
  projectId: string,
  name: string,
  description: string | undefined,
  edits: GameEdits,
): ProjectCheckpoints {
  return addCheckpoint(all, projectId, {
    kind: "manual",
    name: name.trim() || "Checkpoint",
    description,
    edits,
  });
}

/**
 * Take an autosave, or leave `all` unchanged when there is nothing new to
 * keep.
 *
 * Skips when `edits` is structurally equal to the newest checkpoint of
 * either kind already held for the project: nothing has changed since that
 * snapshot was taken, manual or automatic, so a fresh copy would only be a
 * duplicate. Reference equality cannot make this call, since `all` reaches
 * here through a JSON round trip (see the module doc comment). A
 * `JSON.stringify` comparison is the structural test that survives it, and
 * costs nothing next to a copy nobody would keep. Also skips a project with
 * no edits yet, so opening a project and never touching it does not spend an
 * autosave slot on an empty snapshot.
 */
export function autosaveCheckpoint(
  all: ProjectCheckpoints,
  projectId: string,
  edits: GameEdits,
  isEmpty: boolean,
): ProjectCheckpoints {
  if (isEmpty) return all;
  const [latest] = checkpointsFor(all, projectId);
  if (latest && JSON.stringify(latest.edits) === JSON.stringify(edits))
    return all;
  return addCheckpoint(all, projectId, {
    kind: "autosave",
    name: `Autosave ${new Date().toLocaleString()}`,
    edits,
  });
}

/** Change what a checkpoint is called and what it says it is for. Left alone
 *  for a blank name or an id the project does not hold, the same as
 *  `updateProjectDetails`. */
export function renameCheckpoint(
  all: ProjectCheckpoints,
  projectId: string,
  id: string,
  details: { name: string; description?: string },
): ProjectCheckpoints {
  const name = details.name.trim();
  if (!name) return all;
  const list = checkpointsFor(all, projectId);
  if (!list.some((c) => c.id === id)) return all;
  const description = details.description?.trim() ?? "";
  return {
    ...all,
    [projectId]: list.map((c) => {
      if (c.id !== id) return c;
      const { description: _dropped, ...rest } = c;
      return { ...rest, name, ...(description ? { description } : {}) };
    }),
  };
}

/** Remove one checkpoint. */
export function removeCheckpoint(
  all: ProjectCheckpoints,
  projectId: string,
  id: string,
): ProjectCheckpoints {
  const list = checkpointsFor(all, projectId);
  if (!list.some((c) => c.id === id)) return all;
  const next = list.filter((c) => c.id !== id);
  if (next.length === 0) {
    const { [projectId]: _dropped, ...rest } = all;
    return rest;
  }
  return { ...all, [projectId]: next };
}

/** Drop a deleted project's checkpoints, the way `forgetEditHistory` drops
 *  its undo stack. Called by whoever deletes the project. */
export function forgetProjectCheckpoints(
  all: ProjectCheckpoints,
  projectId: string,
): ProjectCheckpoints {
  if (!Object.hasOwn(all, projectId)) return all;
  const { [projectId]: _dropped, ...rest } = all;
  return rest;
}

/**
 * Every project's checkpoints, and everything that changes them.
 *
 * Folds over storage rather than this render's value, the same reason
 * `useModProjects` gives: an autosave firing from a timer and a manual save
 * pressed moments apart must not let one overwrite the other.
 */
export function useCheckpoints() {
  const [all, setAll] = useSetting<ProjectCheckpoints>(CHECKPOINTS_KEY, {});

  const write = (change: (prev: ProjectCheckpoints) => ProjectCheckpoints) =>
    updateStoredSetting<ProjectCheckpoints>(
      CHECKPOINTS_KEY,
      {},
      setAll,
      change,
    );

  const save = (
    projectId: string,
    name: string,
    description: string | undefined,
    edits: GameEdits,
  ) =>
    write((prev) => saveCheckpoint(prev, projectId, name, description, edits));

  const autosave = (projectId: string, edits: GameEdits, isEmpty: boolean) =>
    write((prev) => autosaveCheckpoint(prev, projectId, edits, isEmpty));

  const rename = (
    projectId: string,
    id: string,
    details: { name: string; description?: string },
  ) => write((prev) => renameCheckpoint(prev, projectId, id, details));

  const remove = (projectId: string, id: string) =>
    write((prev) => removeCheckpoint(prev, projectId, id));

  const forget = (projectId: string) =>
    write((prev) => forgetProjectCheckpoints(prev, projectId));

  return {
    checkpoints: all,
    checkpointsFor: (projectId: string) => checkpointsFor(all, projectId),
    saveCheckpoint: save,
    autosaveCheckpoint: autosave,
    renameCheckpoint: rename,
    removeCheckpoint: remove,
    forget,
  };
}
