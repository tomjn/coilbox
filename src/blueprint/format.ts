/**
 * One game's own blueprint file, as coilbox reads and writes it (issue #1312).
 *
 * A layout is not a Beyond All Reason feature. It is a shape made of buildings,
 * and any game with a widget that saves one will save it in its own file in its
 * own shape. So the file is behind an adapter: coilbox's own model is what the
 * rest of the app works in, and a format says how to get a layout out of one
 * game's file and back into it.
 *
 * There is one adapter today, `./bar.ts`, because Beyond All Reason's is the
 * only format anybody has. A second one is a second entry in {@link
 * BLUEPRINT_FORMATS} and nothing else.
 *
 * Every function here is pure text and plain values. The file itself is read and
 * written in `./gameFile.ts`, which is also where the care a merge needs lives.
 */

import type { BaseBuildingRole, Facing, Point } from "../scenario/model";
import { barFormat } from "./bar";
import type { SnapBuilding } from "./footprint";
import type { BaseBlueprint } from "./model";
import type { KnownUnits, UnknownBuilding } from "./units";

/**
 * One layout out of a game's file, and what reading it changed.
 *
 * An import is a conversion, so it is allowed to change what it read. What it is
 * not allowed to do is change it quietly, which is what everything but `layout`
 * is for.
 */
export interface ImportedBlueprint {
  /**
   * The layout, with no id. The id is minted by whoever puts it in a document,
   * so reading the same file twice does not produce two different answers.
   */
  layout: Omit<BaseBlueprint, "id">;
  /** The quarter turns the file's own facing was worth, applied to the layout
   *  rather than kept, because coilbox layouts do not carry one. 0 for most. */
  turned: Facing;
  /** Buildings the build grid moved, by their place in the layout. Empty when
   *  the file's positions were already where the engine would put them, and
   *  when no footprints were available to judge by. */
  snapped: { index: number; def: string; from: Point; to: Point }[];
  /** What the file said that a coilbox layout has nowhere to keep, in words a
   *  person can read. */
  dropped: string[];
  /** Buildings naming a unit the game being imported into has not got, by their
   *  place in the layout. Empty when the game has all of them, and when there
   *  was no unit dataset to check against, which {@link ImportReport.checked}
   *  is how a reader tells apart. */
  unknown: UnknownBuilding[];
}

/** Everything one game's file holds, as coilbox can use it. */
export interface ImportReport {
  blueprints: ImportedBlueprint[];
  /** How many entries the file holds that this reader could not make a layout
   *  of. They are still in the file and a merge still writes them back. */
  unreadable: number;
  /** Whether the unit names were checked against a game at all. False when
   *  there was no dataset, and then an empty `unknown` means nothing was
   *  looked at rather than that everything is there. */
  checked: boolean;
}

/** A file's new text, and what merging into it did. */
export interface MergePlan {
  /** The whole file, ready to write. */
  text: string;
  /** Layouts that were already in the file under these names, now replaced. */
  replaced: string[];
  /** Layouts the file did not have. */
  added: string[];
  /** Entries the file held that this adapter cannot read, carried through
   *  untouched rather than dropped. */
  kept: number;
}

/** How to read and write one game's blueprint file. */
export interface BlueprintFormat {
  /** Stable id, for a setting or a picker. */
  id: string;
  /** The game this is the format of. */
  label: string;
  /** Where the game keeps the file, under whichever directory it writes to. */
  file: string;
  /**
   * The layouts in a file's text. Throws when the text is not this format at
   * all, because a caller about to merge into that file must not be told it
   * holds nothing.
   *
   * `snap` puts each building where the engine would build it. Without one the
   * positions come through exactly as the file has them, which is what a caller
   * with no unit footprints to hand should get rather than a confident guess.
   *
   * `known` is the units of the game being imported into, and a layout naming
   * anything else is still read: which of them are worth taking is the caller's
   * question, not this one's. Without it nothing is checked and the report says
   * so. Both come from the unit dataset, so a caller has both or neither.
   */
  read(text: string, snap?: SnapBuilding, known?: KnownUnits): ImportReport;
  /**
   * The file's text with these layouts merged into it, matched by name.
   * `existing` is empty when the game has no file yet. Throws rather than
   * writing over text it cannot read.
   */
  merge(existing: string, layouts: BaseBlueprint[]): MergePlan;
  /**
   * What this format cannot carry about a base, given the mission-only fields
   * its buildings hold. Empty when nothing would be lost.
   */
  stripped(roles: BaseBuildingRole[]): string[];
}

/** Every format coilbox can read and write. */
export const BLUEPRINT_FORMATS: BlueprintFormat[] = [barFormat];
