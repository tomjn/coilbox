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
 *
 * A copy written as a unit file of its own (issue #2634) is followed the same
 * way as a field. Once the game holds the file, the copy is a unit of the
 * game's, so it leaves the project's copies, taking its own field changes and
 * build menu with it, along with the build menu additions the write made to
 * the game's own builders. {@link ModProject.copiesWrittenInPlace} keeps all
 * of it for undo, which puts the copy back as it was.
 */
import type { BuildMenuOp, BuildMenus } from "./buildMenus";
import type { UnitClone } from "./clones";
import type { CarriedChange, WrittenCopy } from "./inPlace";
import { clearOverride, type UnitOverrides } from "./overrides";
import type { GameEdits, ModProject } from "./project";

/** What one of the edit-in-place route's three actions did. */
export type InPlaceDone =
  | {
      kind: "write";
      /** The field changes the game's files now hold. */
      carried: CarriedChange[];
      /** The copies the game now holds as unit files (issue #2634). */
      copies: WrittenCopy[];
      /** Whether any file on disk changed. */
      changed: boolean;
    }
  | { kind: "undo"; changed: boolean }
  | { kind: "accept"; changed: boolean };

/** A copy an in-place write moved out of the project, as undo puts it back. */
export interface KeptCopy {
  clone: UnitClone;
  /** Its own field changes, which the file was written with. */
  overrides?: Record<string, unknown>;
  /** Its own build menu, which the file was written with. */
  menu?: BuildMenuOp[];
  /** The game units whose build menus the write added it to. */
  builders: string[];
}

/** `project` without what a write kept for undo, dropping the keys rather
 *  than leaving empty tables behind. */
function withoutWritten(project: ModProject): ModProject {
  if (
    project.writtenInPlace === undefined &&
    project.copiesWrittenInPlace === undefined
  )
    return project;
  const {
    writtenInPlace: _fields,
    copiesWrittenInPlace: _copies,
    ...rest
  } = project;
  return rest;
}

/** `menus` without `builder`'s additions of `unit`, dropping a builder left
 *  with nothing. */
function withoutAdd(
  menus: BuildMenus,
  builder: string,
  unit: string,
): BuildMenus {
  const ops = (menus[builder] ?? []).filter(
    (op) => !(op.op === "add" && op.unit === unit),
  );
  const { [builder]: _dropped, ...rest } = menus;
  return ops.length > 0 ? { ...rest, [builder]: ops } : rest;
}

/** Move each written copy out of the project, keeping what undo puts back. */
function moveCopies(
  edits: GameEdits,
  kept: Record<string, KeptCopy>,
  copies: WrittenCopy[],
): { edits: GameEdits; kept: Record<string, KeptCopy> } {
  for (const { unit, builders } of copies) {
    const clone = edits.clones[unit];
    if (!clone) continue;
    const overrides = edits.overrides[unit];
    const menu = edits.menus[unit];
    kept = {
      ...kept,
      [unit]: {
        clone,
        builders,
        ...(overrides ? { overrides } : {}),
        ...(menu ? { menu } : {}),
      },
    };
    const { [unit]: _clone, ...clones } = edits.clones;
    const { [unit]: _fields, ...rest } = edits.overrides;
    const { [unit]: _menu, ...others } = edits.menus;
    let menus: BuildMenus = others;
    for (const builder of builders) menus = withoutAdd(menus, builder, unit);
    edits = { ...edits, clones, overrides: rest, menus };
  }
  return { edits, kept };
}

/** Move each carried field and copy out of the project, keeping the ones
 *  undo can reach. */
function settleWrite(
  project: ModProject,
  carried: CarriedChange[],
  copies: WrittenCopy[],
) {
  const moved = moveCopies(
    project.edits,
    project.copiesWrittenInPlace ?? {},
    copies,
  );
  let overrides = moved.edits.overrides;
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
  if (overrides === project.edits.overrides && moved.edits === project.edits)
    return project;
  return {
    ...withoutWritten(project),
    edits: { ...moved.edits, overrides },
    ...(Object.keys(kept).length > 0 ? { writtenInPlace: kept } : {}),
    ...(Object.keys(moved.kept).length > 0
      ? { copiesWrittenInPlace: moved.kept }
      : {}),
  };
}

/** Put a kept copy back, unless the project has made another under the same
 *  name since, which is the newer thing the user asked for. */
function restoreCopy(edits: GameEdits, unit: string, kept: KeptCopy) {
  if (Object.hasOwn(edits.clones, unit)) return edits;
  let menus: BuildMenus = { ...edits.menus };
  if (kept.menu && !menus[unit]) menus[unit] = kept.menu;
  for (const builder of kept.builders) {
    const ops = menus[builder] ?? [];
    if (!ops.some((op) => op.op === "add" && op.unit === unit))
      menus = { ...menus, [builder]: [...ops, { op: "add", unit }] };
  }
  return {
    ...edits,
    clones: { ...edits.clones, [unit]: kept.clone },
    overrides: kept.overrides
      ? {
          ...edits.overrides,
          [unit]: { ...kept.overrides, ...edits.overrides[unit] },
        }
      : edits.overrides,
    menus,
  };
}

/** Put the kept fields and copies back. A field edited again since the write
 *  keeps the newer value, because that is the last thing the user asked
 *  for. */
function settleUndo(project: ModProject): ModProject {
  const kept = project.writtenInPlace;
  const copies = project.copiesWrittenInPlace;
  if (kept === undefined && copies === undefined) return project;
  let edits = project.edits;
  if (kept !== undefined) {
    const current = edits.overrides;
    const overrides: UnitOverrides = { ...current };
    for (const [unit, fields] of Object.entries(kept))
      overrides[unit] = { ...fields, ...current[unit] };
    edits = { ...edits, overrides };
  }
  for (const [unit, copy] of Object.entries(copies ?? {}))
    edits = restoreCopy(edits, unit, copy);
  return { ...withoutWritten(project), edits };
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
      ? settleWrite(project, done.carried, done.copies)
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
