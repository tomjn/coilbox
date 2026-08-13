/**
 * One side's layout said in another side's units (issue #1314).
 *
 * A layout naming Armada buildings is no use to a Cortex player, and rebuilding
 * it by hand is the work the layout was supposed to save. Swapping each def for
 * the other side's equivalent is the whole of the fix, and it is two separate
 * problems that are worth keeping separate:
 *
 * - Which building is which side's equivalent of which. That is per game data,
 *   and nothing here can work it out. Coilbox does not ship a table for any game
 *   and does not pretend to have one.
 * - Whether the layout still stands up once the names have changed. That is
 *   arithmetic coilbox already does, because the unit dataset carries each def's
 *   footprint, and it is the half that decides whether a converted layout is
 *   usable or quietly broken.
 *
 * ## Where a mapping comes from
 *
 * From the person, one building at a time, which is a {@link SubstitutionPlan}
 * however it was arrived at. That is slower than a table and still far faster
 * than drawing the layout again, and it is the answer for every game.
 *
 * {@link planForSide} fills that in where a game's own names allow it, which is
 * a suggestion rather than a mapping. Games in the Total Annihilation line name
 * a side's units with a shared prefix, and the sides' start units are what says
 * what those prefixes are: `armcom` and `corcom` differ by `arm` and `cor`, so
 * `armsolar` has a candidate called `corsolar`. Every candidate is checked
 * against the game's own units before it is offered, so nothing is proposed that
 * the game does not have, and a game whose sides are not named that way gets no
 * suggestions rather than wrong ones.
 *
 * ## What a substitution does to the shape
 *
 * The two sides' equivalents are not the same size often enough that this is the
 * risk rather than a footnote. A footprint spanning three squares centres in the
 * middle of a build square where one spanning two centres on the corner between
 * them, so a building whose substitute is one square wider does not stay where
 * it was: the engine stands it on the nearest squares that fit. Two of those and
 * the layout that used to be touching is now overlapping, and the engine builds
 * one of the pair and refuses the rest.
 *
 * So every substitution is re-snapped and re-checked here, and the report names
 * both what moved and what is now fighting over ground. Nothing is applied
 * silently. Where the footprints have not been read, `checked` is false and the
 * offsets are left exactly as they are, because an unchecked layout that says so
 * is worth more than one that looks clean.
 *
 * Pure arithmetic over plain values. The surface is
 * `./pages/components/SubstituteBlueprintForm.tsx`.
 */

import type { ArrivalNote } from "./arrival";
import { type Footprint, footprintMarks, snapToBuildGrid } from "./footprint";
import type { BaseBlueprint, BlueprintBuilding } from "./model";
import type { KnownUnits } from "./units";

/** A side of a game and the prefix its unit names start with. */
export interface SideUnits {
  /** The side's own name, as `unitsyncGameInfo` reports it. */
  side: string;
  /** Lower case, because a def is written however its author felt like. */
  prefix: string;
}

/** The longest ending every one of these strings shares. */
function commonSuffix(values: string[]): string {
  const first = values[0];
  let length = 0;
  while (length < first.length) {
    const at = first[first.length - 1 - length];
    if (values.some((v) => v[v.length - 1 - length] !== at)) break;
    length += 1;
  }
  return first.slice(first.length - length);
}

/**
 * What each side's units are called, read off the start units.
 *
 * The sides' commanders are the one unit every side is guaranteed to have and to
 * have its own version of, so what they share is the thing that is not the side
 * and what is left is the thing that is: `armcom`, `corcom` and `legcom` leave
 * `arm`, `cor` and `leg`.
 *
 * Empty rather than approximate whenever that reasoning does not hold: fewer
 * than two sides to tell apart, start units with no shared ending, a prefix that
 * would be nothing at all, or two sides that would end up with the same prefix.
 * Empty means this game offers no mapping, and the surface asks the person
 * instead.
 */
export function sideUnitPrefixes(
  sides: readonly { name: string; startUnit?: string }[],
): SideUnits[] {
  const named = sides.filter(
    (side) => side.name.trim() !== "" && (side.startUnit ?? "").trim() !== "",
  );
  if (named.length !== sides.length || named.length < 2) return [];

  const starts = named.map((side) =>
    (side.startUnit ?? "").trim().toLowerCase(),
  );
  const suffix = commonSuffix(starts);
  if (suffix === "") return [];

  const out = named.map((side, at) => ({
    side: side.name,
    prefix: starts[at].slice(0, starts[at].length - suffix.length),
  }));
  if (out.some((one) => one.prefix === "")) return [];
  if (new Set(out.map((one) => one.prefix)).size !== out.length) return [];
  return out;
}

/** Which side a def's name says it belongs to, or nothing for one that belongs
 *  to none: a game's shared units are nobody's to swap. */
export function sideOfDef(
  def: string,
  sides: readonly SideUnits[],
): SideUnits | undefined {
  const name = def.toLowerCase();
  let found: SideUnits | undefined;
  for (const side of sides) {
    if (!name.startsWith(side.prefix)) continue;
    if (!found || side.prefix.length > found.prefix.length) found = side;
  }
  return found;
}

/**
 * What each def of a layout becomes, keyed by the def in lower case.
 *
 * A def the plan says nothing about is left alone, which is what makes a partly
 * converted layout a thing that can exist: a side with no equivalent of a
 * building keeps the building.
 */
export type SubstitutionPlan = Record<string, string>;

/** Every def a layout names, once each, in the order they are built. */
export function layoutDefs(layout: BaseBlueprint): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const building of layout.buildings) {
    const key = building.def.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(building.def);
  }
  return out;
}

/**
 * A suggested plan for converting these defs to a side, from the game's own
 * naming.
 *
 * Only a candidate the game actually has is offered, so this proposes nothing
 * for a building the other side has no version of and nothing at all for a game
 * whose sides {@link sideUnitPrefixes} could not tell apart. The person still
 * sees every line of it before it is applied.
 */
export function planForSide(
  defs: readonly string[],
  toSide: string,
  sides: readonly SideUnits[],
  known: KnownUnits,
): SubstitutionPlan {
  const to = sides.find((one) => one.side === toSide);
  if (!to) return {};
  const plan: SubstitutionPlan = {};
  for (const def of defs) {
    const from = sideOfDef(def, sides);
    if (!from || from.prefix === to.prefix) continue;
    const candidate = to.prefix + def.toLowerCase().slice(from.prefix.length);
    if (!known(candidate)) continue;
    plan[def.toLowerCase()] = candidate;
  }
  return plan;
}

/** One building that changed hands. */
export interface SubstitutedBuilding {
  /** Its place in the layout, which is how an author counts buildings. */
  index: number;
  from: string;
  to: string;
}

export interface SubstitutionReport {
  substituted: SubstitutedBuilding[];
  /** The defs nothing was substituted for, once each. */
  kept: string[];
  /** Buildings the engine will not stand where they stand now, by their place in
   *  the layout. A substitute on a different footprint snaps to a different part
   *  of the build grid, so the layout moves under the author. */
  moved: number[];
  /** Buildings standing on ground another building wants once the swap is done.
   *  The engine builds one of a pair and refuses the rest. */
  overlapping: number[];
  /** Whether the footprints were known. False is not a clean result: it is a
   *  layout nothing was able to check, so `moved` and `overlapping` are empty
   *  because nothing looked rather than because nothing is wrong. */
  checked: boolean;
}

export interface Substituted {
  layout: BaseBlueprint;
  report: SubstitutionReport;
}

/**
 * The layout with each building put through `pick`, re-snapped and re-checked.
 *
 * `pick` returning nothing, or the name the building already has, leaves it
 * exactly as it is. The name a building was first drawn as is what survives:
 * converting a converted layout keeps the original rather than the last step, so
 * one revert always gets back to what the author drew.
 */
function substitute(
  layout: BaseBlueprint,
  pick: (building: BlueprintBuilding) => string | undefined,
  footprintOf?: (def: string) => Footprint,
): Substituted {
  const substituted: SubstitutedBuilding[] = [];
  const kept: string[] = [];
  const moved: number[] = [];

  const buildings = layout.buildings.map((building, index) => {
    const next = pick(building);
    if (!next || next.toLowerCase() === building.def.toLowerCase()) {
      if (!kept.some((def) => def.toLowerCase() === building.def.toLowerCase()))
        kept.push(building.def);
      return building;
    }

    substituted.push({ index, from: building.def, to: next });
    const was = building.originalName ?? building.def;
    const offset = footprintOf
      ? snapToBuildGrid(building.offset, footprintOf(next), building.facing)
      : building.offset;
    if (offset.x !== building.offset.x || offset.z !== building.offset.z) {
      moved.push(index);
    }
    return {
      def: next,
      offset,
      facing: building.facing,
      // Back to what it was drawn as is not a substitution, so it stops being
      // recorded as one and the layout stops offering to undo nothing.
      ...(was.toLowerCase() === next.toLowerCase()
        ? {}
        : { originalName: was }),
    };
  });

  const overlapping: number[] = [];
  if (footprintOf) {
    const marks = footprintMarks(
      buildings.map((building, index) => ({
        key: String(index),
        def: building.def,
        pos: building.offset,
        facing: building.facing,
      })),
      footprintOf,
    );
    marks.forEach((mark, index) => {
      if (mark.overlapping) overlapping.push(index);
    });
  }

  return {
    layout: { ...layout, buildings },
    report: {
      substituted,
      kept,
      moved,
      overlapping,
      checked: footprintOf !== undefined,
    },
  };
}

/** This layout with a plan applied to it. */
export function substituteBlueprint(
  layout: BaseBlueprint,
  plan: SubstitutionPlan,
  footprintOf?: (def: string) => Footprint,
): Substituted {
  return substitute(
    layout,
    (building) => plan[building.def.toLowerCase()],
    footprintOf,
  );
}

/** This layout with every substituted building back under the name it was drawn
 *  as. The grid is the grid, so a building put back on a smaller footprint lands
 *  on the nearest squares that fit rather than exactly where it began, and the
 *  report says which ones those are. */
export function revertSubstitution(
  layout: BaseBlueprint,
  footprintOf?: (def: string) => Footprint,
): Substituted {
  return substitute(layout, (building) => building.originalName, footprintOf);
}

/** How many of a layout's buildings stand in for something else, which is what
 *  decides whether there is anything to revert. */
export function substitutedCount(layout: BaseBlueprint): number {
  return layout.buildings.filter((one) => one.originalName !== undefined)
    .length;
}

/** Buildings named by their place in the layout, the way an author counts them.
 *  Same counting as `../placement/LayoutControls.tsx`, because it is the same
 *  layout being talked about. */
function listed(at: readonly number[]): string {
  return at.map((n) => n + 1).join(", ");
}

/**
 * What a person needs to know before a substitution is applied, worst first.
 *
 * Same two sentences the editor already says about a layout standing on ground
 * it cannot have, because they are the same facts said before the swap rather
 * than after it. Nothing here refuses: a layout that moves is still a layout
 * somebody may want, and the buildings that moved can be dragged back.
 */
export function substitutionNotes(report: SubstitutionReport): ArrivalNote[] {
  const notes: ArrivalNote[] = [];

  if (report.overlapping.length > 0) {
    notes.push({
      tone: "warn",
      text: `Building${report.overlapping.length === 1 ? " " : "s "}${listed(report.overlapping)} will stand on ground another building wants. The engine builds one of them and refuses the rest.`,
    });
  }

  if (report.moved.length > 0) {
    notes.push({
      tone: "warn",
      text: `Building${report.moved.length === 1 ? " " : "s "}${listed(report.moved)} will not stand where they do now: their substitutes cover different ground, so the engine puts them on the nearest build squares that will take them.`,
    });
  }

  if (report.kept.length > 0 && report.substituted.length > 0) {
    notes.push({
      tone: "note",
      text: `Nothing was picked for ${report.kept.join(", ")}, so ${report.kept.length === 1 ? "it stays" : "they stay"} as ${report.kept.length === 1 ? "it is" : "they are"}.`,
    });
  }

  if (!report.checked && report.substituted.length > 0) {
    notes.push({
      tone: "note",
      text: "Coilbox has not read this game's units, so nothing has been checked against what the substitutes stand on.",
    });
  }

  return notes;
}
