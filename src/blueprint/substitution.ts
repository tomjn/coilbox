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
import type { BlueprintPayload } from "./payload";
import { blueprintFromPayload } from "./transfer";
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

/** These defs, once each, keeping the first spelling of each and the order they
 *  came in. A def is written however its author felt like, so the same unit
 *  twice in two cases is one unit to pick a substitute for. */
export function distinctDefs(defs: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const def of defs) {
    const key = def.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(def);
  }
  return out;
}

/** Every def a layout names, once each, in the order they are built. */
export function layoutDefs(layout: BaseBlueprint): string[] {
  return distinctDefs(layout.buildings.map((building) => building.def));
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

/**
 * The one side a whole layout is written in, or nothing.
 *
 * A layout is normally all one side's, and that is the fact worth having: it is
 * what lets an arriving layout be described as Armada's before anybody keeps it.
 * A building belonging to no side is skipped rather than counted against the
 * answer, because a game's shared buildings are nobody's and a layout of solars
 * and one shared radar is still an Armada layout.
 *
 * Nothing whenever that reasoning does not hold: a game whose sides
 * {@link sideUnitPrefixes} could not tell apart, a layout naming no side's
 * buildings at all, or one naming two sides' at once. Nothing means the side
 * could not be told, and a caller with nothing to say should say nothing rather
 * than guess.
 */
export function layoutSide(
  defs: readonly string[],
  sides: readonly SideUnits[],
): SideUnits | undefined {
  let found: SideUnits | undefined;
  for (const def of defs) {
    const side = sideOfDef(def, sides);
    if (!side) continue;
    if (found && found.side !== side.side) return undefined;
    found = side;
  }
  return found;
}

/** A layout's own side, and the sides it could be said in instead. */
export interface SideOffer {
  /** The side every building of it that belongs to one belongs to. */
  from: string;
  /** The other sides this game has a version of at least one of those
   *  buildings in, in the game's own order. Never empty. */
  to: string[];
}

/**
 * Which sides a layout is worth offering to be taken as (issue #1467).
 *
 * Two sides of one game live in one game, so a layout naming only one side's
 * buildings is not a layout with anything missing: every unit it names is
 * installed and every check coilbox makes of an arriving layout passes. The
 * thing worth saying to the person taking it is therefore not that something is
 * wrong, because nothing is, and coilbox does not know which side they play. It
 * is that this layout is one side's and can be had as another.
 *
 * Nothing at all unless the whole question can be answered: the game's sides
 * read, the layout's own side told, and a side the game really has substitutes
 * in. A side that would swap nothing is left out rather than offered as a
 * conversion that does nothing.
 */
export function sideOffer(
  defs: readonly string[],
  sides: readonly SideUnits[],
  known: KnownUnits,
): SideOffer | undefined {
  const from = layoutSide(defs, sides);
  if (!from) return undefined;
  const to = sides
    .filter((side) => side.side !== from.side)
    .filter(
      (side) => Object.keys(planForSide(defs, side.side, sides, known)).length,
    )
    .map((side) => side.side);
  return to.length > 0 ? { from: from.side, to } : undefined;
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

/** A shared layout with a plan applied to it, and what that did. */
export interface SubstitutedPayload {
  payload: BlueprintPayload;
  report: SubstitutionReport;
}

/**
 * A layout converted before it is kept rather than after (issue #1467).
 *
 * The same swap {@link substituteBlueprint} does, said in the shape a layout
 * travels in, because an import holds the payload and not the app's own layout.
 * Everything the payload carries that a layout does not, its game and the map it
 * was drawn on, is carried through untouched: a conversion changes which
 * buildings it names and nothing else about where it came from.
 *
 * The footprints are the one part that has to grow. A payload records how much
 * ground each def it names stands on, and the substitutes are defs it did not
 * name, so without this a converted layout would draw its new buildings one
 * square each. They can only be added where the game's units have been read,
 * which is the same condition on which anything here is checked at all.
 */
export function substitutePayload(
  payload: BlueprintPayload,
  plan: SubstitutionPlan,
  footprintOf?: (def: string) => Footprint,
): SubstitutedPayload {
  const done = substituteBlueprint(
    { id: "", ...blueprintFromPayload(payload) },
    plan,
    footprintOf,
  );
  const footprints = { ...payload.footprints };
  if (footprintOf) {
    for (const one of done.report.substituted) {
      footprints[one.to.toLowerCase()] = footprintOf(one.to);
    }
  }
  return {
    payload: {
      ...payload,
      buildings: done.layout.buildings.map((building) => ({
        def: building.def,
        offset: { x: building.offset.x, z: building.offset.z },
        facing: building.facing,
        ...(building.originalName
          ? { originalName: building.originalName }
          : {}),
      })),
      footprints,
    },
    report: done.report,
  };
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

/* -------------------------------------------------------------------------- *
 * Build queues (issue #1493).
 *
 * A factory placed in a mission carries a list of units to build, and that list
 * is the mission's half of the placement rather than part of the layout. So
 * converting the layout leaves a Cortex factory told to build Armada's units,
 * which it cannot, and the queue has to go through the same plan the buildings
 * did.
 *
 * A queued def is a def, so {@link planForSide} derives a candidate for it and
 * checks it against the game's units exactly as it does for a building. What
 * differs is how often that lands. Games in the Total Annihilation line name a
 * side's buildings for what they do, so `armsolar` and `corsolar` are the same
 * building twice, and name their units for what they are, so Armada's Pawn is
 * `armpw` and Cortex's answer to it is `corak`. The naming route reaches the
 * first and cannot reach the second, and rather than guess it offers nothing and
 * the person picks. That is the same rule everything here follows: a wrong
 * substitution is worse than none, because it silently changes what a mission
 * builds.
 *
 * Nothing here is re-snapped or re-checked, because a queue is a list of names
 * with no ground under it. A unit's footprint says where it comes off the pad,
 * not where it stands.
 * -------------------------------------------------------------------------- */

/** A queue with every def the plan names swapped, and every other left. */
export function substituteQueue(
  queue: readonly string[],
  plan: SubstitutionPlan,
): string[] {
  return queue.map((def) => plan[def.toLowerCase()] ?? def);
}

/** What a plan does to the units a base's factories are told to build. */
export interface QueueReport {
  /** How many queued orders change. Orders rather than units, because a queue is
   *  a list of build orders and the same unit twice is two of them. */
  swapped: number;
  /**
   * Queued units left as they are that the side being converted to has not got.
   *
   * The one thing here worth a warning. A factory that is now Cortex's cannot
   * build Armada's units, so an order left naming one sits in the queue and
   * builds nothing. A unit belonging to no side, or already to the side being
   * converted to, is left out: leaving it alone is the right answer rather than
   * a gap.
   */
  stranded: string[];
}

/** What {@link substituteQueue} would do to these orders, and what it would
 *  leave that the converted factory cannot build. */
export function queueReport(
  queued: readonly string[],
  plan: SubstitutionPlan,
  sides: readonly SideUnits[],
  toSide: string,
): QueueReport {
  const left = queued.filter((def) => !plan[def.toLowerCase()]);
  return {
    swapped: queued.length - left.length,
    stranded: distinctDefs(
      left.filter((def) => {
        const side = sideOfDef(def, sides);
        return side !== undefined && side.side !== toSide;
      }),
    ),
  };
}

/** What a person needs to know about the queues before a conversion is applied,
 *  or nothing when there is nothing wrong with them. */
export function queueNote(
  report: QueueReport,
  toSide: string,
): ArrivalNote | undefined {
  if (report.stranded.length === 0) return undefined;
  const one = report.stranded.length === 1;
  return {
    tone: "warn",
    text: `Nothing was picked for ${report.stranded.join(", ")}, so ${one ? "it stays" : "they stay"} queued. A factory converted to ${toSide} cannot build another side's units, so ${one ? "that order builds" : "those orders build"} nothing.`,
  };
}
