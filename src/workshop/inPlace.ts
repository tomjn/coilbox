/**
 * Writing a project's field changes into a loose `.sdd` game's own unit files
 * (issue #2635), the edit-in-place route `deliveryRoutes.ts` offers.
 *
 * `inplace.rs` does the work. Before the first write to a file it renames the
 * original aside, so undo and accept read the backups on disk and work after
 * a restart. A write is all or nothing: if the patcher refuses any change,
 * nothing is written and `refused` lists every change that stopped it.
 *
 * `workshop_in_place_diffs` (issue #2636) reads a line diff of every file that
 * carries a backup or created marker, computed in `diff.rs` so the frontend
 * needs no diff library of its own.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import type { BuildMenuOp } from "./buildMenus";
import type { UnitClone } from "./clones";
import type { ModProject } from "./project";

/** A place in a unit file. Lines and columns count from 1. */
export interface FilePoint {
  line: number;
  column: number;
  byte: number;
}

/** One change that stopped a write. */
export interface RefusedChange {
  unit: string;
  /** The field's dotted path, as the project holds it. */
  field: string;
  /** The file the refusal is about, relative to the game: the unit's file,
   *  or the file it includes for its table when the refusal is about that
   *  one. Null when no file was found. */
  file: string | null;
  kind: string;
  message: string;
  location: { start: FilePoint; end: FilePoint } | null;
}

/** One field change the game's files hold once a write has gone through,
 *  whether the write put it there or the file already said the same. */
export interface CarriedChange {
  unit: string;
  /** The field's dotted path, as the project holds it. */
  field: string;
  /** Whether the unit's file has a workshop backup, so undo takes the change
   *  back out of the game. */
  undoable: boolean;
}

/** A copy the game now holds as a unit file of its own (issue #2634). Undo
 *  always reaches it: the file is marked as created, and every builder's file
 *  has a backup. */
export interface WrittenCopy {
  unit: string;
  /** The new file, relative to the game. */
  file: string;
  /** The game units whose build lists it was added to. */
  builders: string[];
}

/** What `workshop_write_in_place` did. */
export interface InPlaceWriteOutcome {
  /** Files written, relative to the game. Empty when anything was refused. */
  written: string[];
  /** Field changes the written files now carry. */
  changed: number;
  /** Field changes the files already held. */
  unchanged: number;
  refused: RefusedChange[];
  /** Parts of the project this route cannot carry yet, one sentence each. */
  notCarried: string[];
  /** Every field change the game's files now hold (issue #3023). Empty when
   *  anything was refused. */
  carried: CarriedChange[];
  /** Every copy written as a unit file of its own (issue #2634). Empty when
   *  anything was refused. */
  copies: WrittenCopy[];
}

/** How many files carry a workshop backup, or a marker saying coilbox
 *  created them. */
export interface InPlaceStatus {
  backups: number;
  created: number;
}

/**
 * `sources` is the game's own read of each unit a copy was made from. A copy's
 * changes are worked out against it, since the unit's file leaves out every
 * field the unit inherits (see `inplace_clone.rs`).
 */
export const workshopWriteInPlace = defineCommand<
  {
    gameDir: string;
    project: ModProject;
    sources: Record<string, Record<string, unknown>>;
  },
  InPlaceWriteOutcome
>("coilbox-workshop", "workshop_write_in_place");

/**
 * The copies an in-place write carries as new unit files (issue #2634): those
 * copied from a game unit under a name the game did not use. A copy that
 * stands in for a game unit stays with the mutator route, as `inplace.rs`
 * says after a write.
 */
export function copiesToWrite(project: ModProject | undefined): UnitClone[] {
  return Object.values(project?.edits.clones ?? {}).filter(
    (clone) => clone.source !== undefined && !clone.replacesGameUnit,
  );
}

/** Whether a field path goes through a list position: a step of digits. */
const throughAPosition = (path: string) =>
  path.split(".").some((step) => /^\d+$/.test(step));

/**
 * The game's read of every unit the write needs one for: each unit
 * `project`'s copies were made from, and each game unit with a field change
 * through a list position. A digit step is a position counted from zero in a
 * list numbered 1 to n, and the Lua key itself in a table with a gap in it,
 * so the write reads it against the table the page showed (issue #3041).
 */
export function writeSources(
  project: ModProject | undefined,
  gameUnits: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const add = (unit: string) => {
    if (Object.hasOwn(gameUnits, unit)) out[unit] = gameUnits[unit];
  };
  for (const clone of copiesToWrite(project)) add(clone.source as string);
  const edits = project?.edits;
  for (const [unit, fields] of Object.entries(edits?.overrides ?? {})) {
    if (Object.hasOwn(edits?.clones ?? {}, unit)) continue;
    if (Object.keys(fields).some(throughAPosition)) add(unit);
  }
  return out;
}

export const workshopInPlaceStatus = defineCommand<
  { gameDir: string },
  InPlaceStatus
>("coilbox-workshop", "workshop_in_place_status");

export const workshopUndoInPlace = defineCommand<
  { gameDir: string },
  { restored: string[]; deleted: string[] }
>("coilbox-workshop", "workshop_undo_in_place");

export const workshopAcceptInPlace = defineCommand<
  { gameDir: string },
  { kept: string[] }
>("coilbox-workshop", "workshop_accept_in_place");

/** Some lines of a unit file around a refusal's location. */
export interface LuaExcerpt {
  /** The first line's number, counted from 1. */
  firstLine: number;
  lines: string[];
}

/** One field the unit page asks about, with the value to try: the project's
 *  change when it has one, otherwise the game's own. `null` stands for a
 *  field the game does not set. */
export interface FieldProbe {
  field: string;
  value: unknown;
}

/** Whether one field can be written in place, and why not when it cannot. */
export interface FieldCheck {
  field: string;
  refusal: RefusedChange | null;
  excerpt: LuaExcerpt | null;
}

/** What `workshop_check_in_place` found for one unit (issue #2633). */
export interface InPlaceCheck {
  /** The unit's file, relative to the game, when one defines it. */
  file: string | null;
  fields: FieldCheck[];
}

/**
 * `def` is the game's read of the unit, which a field through a list position
 * is read against (issue #3041). Without it, such a field is refused.
 */
export const workshopCheckInPlace = defineCommand<
  {
    gameDir: string;
    unit: string;
    fields: FieldProbe[];
    def?: Record<string, unknown>;
  },
  InPlaceCheck
>("coilbox-workshop", "workshop_check_in_place");

/** One of a copy's own changes that no edit to a file can make, with the
 *  sentence saying why (issue #3035). */
export interface CloneUnwritable {
  /** The field's dotted path, as the copy's definition spells it. */
  field: string;
  message: string;
}

/** What `workshop_check_clone_in_place` found for one copy (issue #3035). */
export interface CloneCheck {
  /** Every change the copy makes that no edit to a file can carry. Empty for
   *  a copy the write does not attempt in place at all. */
  unwritable: CloneUnwritable[];
}

/**
 * Whether a copy's own changes could be written into the game's own files, as
 * a dry run over values alone: no file is read (issue #3035). `overrides` and
 * `menuOps` are the project's own edits to this one copy, the same slices
 * `edits.overrides[unit]` and `edits.menus[unit]` hold. `sourceDef` is the
 * game's own read of the unit the copy was made from, the same as one entry
 * of what `writeSources` builds for the write.
 */
export const workshopCheckCloneInPlace = defineCommand<
  {
    gameDir: string;
    clone: UnitClone;
    overrides?: Record<string, unknown>;
    menuOps?: BuildMenuOp[];
    sourceDef: Record<string, unknown>;
  },
  CloneCheck
>("coilbox-workshop", "workshop_check_clone_in_place");

/** What one line of a diff is, from the old side, the new side, or both. */
export type LineChange = "equal" | "removed" | "added";

/** One line of a diff, numbered on whichever side(s) it appears on. Counted
 *  from 1. */
export interface DiffLine {
  kind: LineChange;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

/** One file's diff for the disk-diff drawer (issue #2636): either a workshop
 *  backup against the current file, or a whole file addition when coilbox
 *  created it. */
export interface FileDiff {
  /** The file, relative to the game. */
  file: string;
  /** Whether coilbox created this file rather than changing an existing one.
   *  A created file has no backup to diff against, so `lines` is the whole
   *  file as an addition. */
  created: boolean;
  lines: DiffLine[];
}

export const workshopInPlaceDiffs = defineCommand<
  { gameDir: string },
  FileDiff[]
>("coilbox-workshop", "workshop_in_place_diffs");

/** One refused change as a line a person reads. */
export function describeRefusal(r: RefusedChange): string {
  const where = r.file
    ? ` (${r.file}${r.location ? `, line ${r.location.start.line}` : ""})`
    : "";
  return `${r.unit} ${r.field}${where}: ${r.message}`;
}
