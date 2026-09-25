/**
 * What a project does once the edit-in-place route has changed its game
 * (issue #3023).
 *
 * A write puts the project's field changes into the game's own unit files.
 * From then on the game carries them, so two things the project records stop
 * being true: its override set repeats the game's own values, and its
 * `authoredChecksum` names a game that no longer exists because coilbox
 * changed it. Left alone, the change ledger lists fields the user already
 * shipped, the mutator route ships them a second time, and the Checks drawer
 * says the game was updated from outside.
 *
 * The project follows the game straight after the write rather than waiting
 * for accept. The page reads the written game again as soon as the write
 * lands (issue #2637), so that is the moment the project and the game start
 * to disagree. Waiting for accept would keep both symptoms on screen between
 * the two, and backups survive a restart, so that can be a long time. Undo
 * has to put the fields back, so the ones a write moved out are kept in
 * {@link ModProject.writtenInPlace} until accept forgets them.
 *
 * The checksum cannot be moved at the same moment, because only unitsync can
 * say what the written game checksums to and the page asks it afterwards. So
 * the write records the checksum it was made from, and {@link adoptChecksum}
 * takes the next read that answers something else. Accept deletes the backup
 * files, and undo puts the original files back, and both change the checksum
 * too, so all three actions follow it the same way.
 */
import type { CarriedChange } from "./inPlace";
import { clearOverride, type UnitOverrides } from "./overrides";
import type { ModProject } from "./project";

/** What one of the edit-in-place route's three actions did. */
export type InPlaceDone =
  | {
      kind: "write";
      /** The field changes the game's files now hold. */
      carried: CarriedChange[];
      /** Whether any file on disk changed. */
      changed: boolean;
    }
  | { kind: "undo"; changed: boolean }
  | { kind: "accept"; changed: boolean };

/** `project` without the kept fields, dropping the key rather than leaving
 *  an empty table behind. */
function withoutWritten(project: ModProject): ModProject {
  if (project.writtenInPlace === undefined) return project;
  const { writtenInPlace: _dropped, ...rest } = project;
  return rest;
}

/** Move each carried field out of the override set, keeping the ones undo
 *  can reach. */
function settleWrite(project: ModProject, carried: CarriedChange[]) {
  let overrides = project.edits.overrides;
  let kept: UnitOverrides = project.writtenInPlace ?? {};
  for (const { unit, field, undoable } of carried) {
    const fields = overrides[unit];
    if (!fields || !Object.hasOwn(fields, field)) continue;
    // A field the file already held, with no backup under it, is the game's
    // own value. Nothing will ever take it back out, so there is nothing to
    // put back either.
    if (undoable)
      kept = { ...kept, [unit]: { ...kept[unit], [field]: fields[field] } };
    overrides = clearOverride(overrides, unit, field);
  }
  if (overrides === project.edits.overrides) return project;
  return {
    ...withoutWritten(project),
    edits: { ...project.edits, overrides },
    ...(Object.keys(kept).length > 0 ? { writtenInPlace: kept } : {}),
  };
}

/** Put the kept fields back. A field edited again since the write keeps the
 *  newer value, because that is the last thing the user asked for. */
function settleUndo(project: ModProject): ModProject {
  const kept = project.writtenInPlace;
  if (kept === undefined) return project;
  const current = project.edits.overrides;
  const overrides: UnitOverrides = { ...current };
  for (const [unit, fields] of Object.entries(kept))
    overrides[unit] = { ...fields, ...current[unit] };
  return {
    ...withoutWritten(project),
    edits: { ...project.edits, overrides },
  };
}

/**
 * Follow what one in-place action did.
 *
 * `checksum` is what the game checksummed to when the action was pressed.
 * When the project was written against exactly that and a file changed, the
 * next read that differs is coilbox's own doing. A project whose game had
 * already moved keeps its checksum, so an update from outside is still
 * reported rather than hidden behind coilbox's.
 *
 * Returns `project` itself when nothing changed.
 */
export function settleInPlace(
  project: ModProject,
  done: InPlaceDone,
  checksum: string | undefined,
): ModProject {
  const settled =
    done.kind === "write"
      ? settleWrite(project, done.carried)
      : done.kind === "undo"
        ? settleUndo(project)
        : withoutWritten(project);
  if (
    !done.changed ||
    checksum === undefined ||
    project.authoredChecksum !== checksum ||
    settled.checksumBeforeInPlace === checksum
  )
    return settled;
  return { ...settled, checksumBeforeInPlace: checksum };
}

/**
 * Take `read` as the project's checksum when it is the game coilbox itself
 * just wrote. A read that still answers the checksum from before is the old
 * game served from a cache, so the project keeps waiting.
 *
 * Returns `project` itself when nothing changed.
 */
export function adoptChecksum(
  project: ModProject,
  read: string | undefined,
): ModProject {
  const before = project.checksumBeforeInPlace;
  if (before === undefined || read === undefined || read === before)
    return project;
  const { checksumBeforeInPlace: _dropped, ...rest } = project;
  return project.authoredChecksum === before
    ? { ...rest, authoredChecksum: read }
    : rest;
}
