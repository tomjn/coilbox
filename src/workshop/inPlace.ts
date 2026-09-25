/**
 * Writing a project's field changes into a loose `.sdd` game's own unit files
 * (issue #2635), the edit-in-place route `deliveryRoutes.ts` offers.
 *
 * `inplace.rs` does the work. Before the first write to a file it renames the
 * original aside, so undo and accept read the backups on disk and work after
 * a restart. A write is all or nothing: if the patcher refuses any change,
 * nothing is written and `refused` lists every change that stopped it.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
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
  /** The unit's file, relative to the game, when one was found. */
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
}

/** How many files carry a workshop backup, or a marker saying coilbox
 *  created them. */
export interface InPlaceStatus {
  backups: number;
  created: number;
}

export const workshopWriteInPlace = defineCommand<
  { gameDir: string; project: ModProject },
  InPlaceWriteOutcome
>("coilbox-workshop", "workshop_write_in_place");

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

export const workshopCheckInPlace = defineCommand<
  { gameDir: string; unit: string; fields: FieldProbe[] },
  InPlaceCheck
>("coilbox-workshop", "workshop_check_in_place");

/** One refused change as a line a person reads. */
export function describeRefusal(r: RefusedChange): string {
  const where = r.file
    ? ` (${r.file}${r.location ? `, line ${r.location.start.line}` : ""})`
    : "";
  return `${r.unit} ${r.field}${where}: ${r.message}`;
}
