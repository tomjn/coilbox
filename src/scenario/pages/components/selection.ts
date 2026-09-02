/**
 * More than one thing selected on the map at once (issue #2279).
 *
 * The map had one selection, so removing six misplaced actors was six
 * select-then-delete cycles and moving a cluster of bases was one drag per base.
 * This is the set behind the new one, and the rules for acting on all of it.
 *
 * Arithmetic on plain values, so every rule here is tested without a GPU. The
 * pointer half is `useMapEditing.ts`, the drawing is the units layer's, and what
 * is said out loud is built from `words` below.
 *
 * Three rules are worth writing down, because they are what a mixed selection
 * turns on.
 *
 * A move is applied once per thing that moves rather than once per key. A group
 * stands at one point and the runtime lays its formation out around it, so ten
 * of its units in the selection are still one move, and applying the move ten
 * times would carry the group ten times as far.
 *
 * A delete is applied high index first inside each entry. A base's buildings and
 * a group's units are addressed by their place in the entry, so removing the
 * third building renumbers the fourth, and a list walked forwards would delete
 * the wrong ones.
 *
 * A turn turns each thing about its own centre and never about the selection's.
 * Turning a building writes its facing and nothing else on purpose (issue
 * #1523): the point its layout names is what the engine is asked about at every
 * facing, and writing a new position instead makes a building creep a square per
 * full circle. Swinging a whole selection about a common centre would write a
 * new position for every building in it, which is that creep on every turn, and
 * would ask a zone to rotate when a zone is an axis-aligned box that cannot.
 * Rotating a selection as one rigid body is a different operation and is not
 * this one.
 */

import type { FootprintMark, SnapBuilding } from "@/blueprint/footprint";
import {
  type Placement,
  parsePlacementKey,
  placementKey,
} from "@/placement/placements";
import {
  baseBuildings,
  type Point,
  type Scenario,
  type ScenarioZone,
} from "../../model";
import type { ContentEntry } from "./contents";
import { groupSize, orderWaypoints, parsePathKey, pathKey } from "./groups";
import {
  buildTrouble,
  type LayoutEditFor,
  moveOnMap,
  removeOnMap,
  turnOnMap,
} from "./mapKeyboard";
import type { PathSource } from "./orderPaths";
import { parseZoneKey, zoneKey } from "./zones";

/**
 * What is selected on the map, in the order it was chosen.
 *
 * The last key is the primary: the one the selection bar describes, the one the
 * panels below the map open for, and the one every part of the editor that only
 * ever handled one thing keeps seeing. That is what keeps a multi-selection an
 * addition rather than a rewrite of the bars, the zone resize mode and the
 * footprint highlighting.
 */
export type MapSelection = readonly string[];

/** Nothing selected. */
export const NO_SELECTION: MapSelection = [];

/** The one the bars describe, or null when nothing is selected. */
export function primaryKey(selection: MapSelection): string | null {
  return selection.length > 0 ? selection[selection.length - 1] : null;
}

/** Whether a key is in the selection. */
export function inSelection(
  selection: MapSelection,
  key: string | null,
): boolean {
  return !!key && selection.includes(key);
}

/** The selection a plain click makes: this and nothing else, or nothing. */
export function selectOne(key: string | null): MapSelection {
  return key ? [key] : NO_SELECTION;
}

/**
 * The selection a Shift-click makes: this key in if it was out, out if it was
 * in.
 *
 * A key added goes on the end, so it becomes the primary and the bars follow the
 * thing that was just clicked. A key removed leaves whatever is now last as the
 * primary, so shift-clicking the same thing twice puts an author back where they
 * were.
 */
export function toggleKey(
  selection: MapSelection,
  key: string | null,
): MapSelection {
  if (!key) return selection;
  if (selection.includes(key)) return selection.filter((one) => one !== key);
  return [...selection, key];
}

/** The selection with more keys in it, skipping any already there so the order
 *  an author built it in survives. */
export function addKeys(
  selection: MapSelection,
  keys: readonly string[],
): MapSelection {
  const out = [...selection];
  for (const key of keys) if (!out.includes(key)) out.push(key);
  return out;
}

/** The selection with everything the document no longer holds dropped, so a
 *  delete or an undo never leaves keys pointing at things that are gone. */
export function stillThere(
  selection: MapSelection,
  placements: Placement[],
  scenario: Pick<Scenario, "zones">,
): MapSelection {
  const drawn = new Set(placements.map((one) => one.key));
  const zones = new Set(scenario.zones.map((one) => one.id));
  return selection.filter((key) => {
    const zone = parseZoneKey(key);
    if (zone) return zones.has(zone.id);
    if (parsePathKey(key)) return true;
    return drawn.has(key);
  });
}

/** The ground a marquee covers, in elmos. */
export interface SelectionBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The box a drag from one point to another covers, whichever corner it started
 *  from. */
export function boxFromDrag(from: Point, to: Point): SelectionBox {
  return {
    minX: Math.min(from.x, to.x),
    maxX: Math.max(from.x, to.x),
    minZ: Math.min(from.z, to.z),
    maxZ: Math.max(from.z, to.z),
  };
}

/** Whether a point is inside the box, edges counted, the same way a press on the
 *  edge of a building's own square counts (`onGround` in `pointer.ts`). */
export function inBox(box: SelectionBox, pos: Point): boolean {
  return (
    pos.x >= box.minX &&
    pos.x <= box.maxX &&
    pos.z >= box.minZ &&
    pos.z <= box.maxZ
  );
}

/**
 * Whether a zone is caught by a marquee: the box has to cover the whole of
 * it, not merely touch it.
 *
 * A zone is a sheet of ground rather than a point, so "the box touches it" is
 * the wrong question to ask: a zone kilometres across would be swept up by a
 * box drawn anywhere inside it, and an author dragging a box round a few
 * actors standing in a landing zone would get the zone too, and everything
 * else it overlaps. Requiring the box to cover the zone whole is the rule
 * most drawing programs use for a shape rather than a point, and it is also
 * why a zone bigger than the box is never caught this way: only a box at
 * least as big as the zone can cover it. A circle is covered the same way, by
 * its whole rim rather than its centre, so a box has to reach a whole radius
 * past the middle on every side.
 */
function zoneInBox(zone: ScenarioZone, box: SelectionBox): boolean {
  if (zone.shape === "circle") {
    return (
      zone.center.x - zone.radius >= box.minX &&
      zone.center.x + zone.radius <= box.maxX &&
      zone.center.z - zone.radius >= box.minZ &&
      zone.center.z + zone.radius <= box.maxZ
    );
  }
  return (
    zone.min.x >= box.minX &&
    zone.max.x <= box.maxX &&
    zone.min.z >= box.minZ &&
    zone.max.z <= box.maxZ
  );
}

/**
 * Every waypoint of every path standing inside a marquee, whichever order or
 * path source it belongs to.
 *
 * A point is caught on its own rather than with the rest of its path or the
 * group that owns it. A waypoint already moves and deletes on its own
 * (`moveTarget` and `removalPlace` below never fold one into its neighbours
 * the way a group's units are folded into one move), so a box that catches
 * some of a path's points and leaves the rest asks nothing of the move and
 * delete rules that they do not already answer correctly.
 */
function pathKeysInBox(paths: PathSource[], box: SelectionBox): string[] {
  const out: string[] = [];
  for (const source of paths) {
    source.orders.forEach((order, orderIndex) => {
      orderWaypoints(order)?.forEach((point, waypointIndex) => {
        if (inBox(box, point))
          out.push(pathKey(source.id, orderIndex, waypointIndex));
      });
    });
  }
  return out;
}

/**
 * Every drawn unit, whole zone and path point standing inside a marquee.
 *
 * The box is ground rather than screen, because it is the box the drag drew on
 * the ground and drawing one shape while selecting by another would be a lie
 * about what is about to be selected.
 *
 * Where a unit stands is enough, so nothing is raycast and no mesh is walked: a
 * `Placement` already carries the point the engine will stand it on. A building
 * whose middle is outside the box but whose footprint reaches into it is not
 * taken, which is the same rule as a click, which takes what it lands on.
 *
 * Every unit is kept, including all of a group's, rather than one key per entry.
 * A delete works through the keys it is given, so a whole group swept up this
 * way is a whole group deleted, and a move dedupes for itself.
 *
 * A zone is a shape rather than a point, so it is caught by `zoneInBox`
 * instead: the box has to cover it whole. A path point is a point, the same
 * as a unit, so it is caught by `pathKeysInBox` one at a time.
 */
export function keysInBox(
  placements: Placement[],
  zones: ScenarioZone[],
  paths: PathSource[],
  box: SelectionBox,
): string[] {
  const units = placements
    .filter((placement) => inBox(box, placement.pos))
    .map((placement) => placement.key);
  const caughtZones = zones
    .filter((zone) => zoneInBox(zone, box))
    .map((zone) => zoneKey(zone.id));
  return [...units, ...caughtZones, ...pathKeysInBox(paths, box)];
}

/**
 * Every key a contents row stands for (issue #2279).
 *
 * A row is one thing an author can name, so adding one to the selection adds the
 * whole of it: all of a base's buildings, all of a group's units. That makes a
 * selection built in the popover the same kind of selection a marquee round the
 * same thing would make, which is what lets the two be one selection rather than
 * two that behave differently.
 */
export function entryKeys(
  scenario: Pick<Scenario, "groups" | "bases" | "blueprints">,
  entry: ContentEntry,
): string[] {
  if (entry.kind === "group") {
    const group = scenario.groups.find((one) => one.id === entry.id);
    if (!group) return [entry.key];
    return Array.from({ length: groupSize(group) }, (_, at) =>
      placementKey("group", entry.id, at),
    );
  }
  if (entry.kind === "base") {
    const base = scenario.bases.find((one) => one.id === entry.id);
    if (!base) return [entry.key];
    const buildings = baseBuildings(scenario.blueprints, base);
    return buildings.map((_, at) => placementKey("base", entry.id, at));
  }
  return [entry.key];
}

/**
 * What one key moves, as an id two keys naming the same movement share.
 *
 * A group is the only thing on the map where two keys move one thing, because
 * its units carry no positions of their own. Everything else moves for itself: a
 * base's buildings are separate offsets, and two of them dragged together really
 * do both move.
 */
function moveTarget(key: string): string {
  const zone = parseZoneKey(key);
  if (zone) return `zone:${zone.id}`;
  if (parsePathKey(key)) return key;
  const ref = parsePlacementKey(key);
  if (ref?.kind === "group") return `group:${ref.id}`;
  return key;
}

/** One key per thing that would move, in the order they were selected. */
export function movedKeys(selection: MapSelection): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of selection) {
    const target = moveTarget(key);
    if (seen.has(target)) continue;
    seen.add(target);
    out.push(key);
  }
  return out;
}

/** Which entry a key is addressed inside, and where in it, for the ordering a
 *  delete needs. Zones and actors are whole things and have no place in
 *  anything, so they sort as one. */
function removalPlace(key: string): { owner: string; index: number } {
  const path = parsePathKey(key);
  if (path)
    return {
      owner: `path:${path.groupId}#${path.order}`,
      index: path.waypoint,
    };
  const ref = parsePlacementKey(key);
  if (ref && ref.kind !== "actor")
    return { owner: `${ref.kind}:${ref.id}`, index: ref.index };
  return { owner: key, index: 0 };
}

/**
 * The keys in the order they can safely be deleted.
 *
 * Highest index first inside each entry, because a base's buildings, a group's
 * units and a path's points are all addressed by their place in the entry and
 * removing one renumbers everything after it. Entries themselves keep the order
 * they were selected in, so the work is only ever reordered where reordering it
 * changes the answer.
 */
export function removalOrder(selection: MapSelection): string[] {
  const owners: string[] = [];
  const byOwner = new Map<string, { key: string; index: number }[]>();
  for (const key of selection) {
    const { owner, index } = removalPlace(key);
    const held = byOwner.get(owner);
    if (held) held.push({ key, index });
    else {
      owners.push(owner);
      byOwner.set(owner, [{ key, index }]);
    }
  }
  return owners.flatMap((owner) =>
    (byOwner.get(owner) ?? [])
      .slice()
      .sort((a, b) => b.index - a.index)
      .map((one) => one.key),
  );
}

/**
 * The document with everything selected moved by the same amount, as one edit.
 *
 * One edit rather than one per key, so the editor's history takes one step back
 * over the whole move. History is a stack of whole documents pushed by the
 * funnel every change goes through (`history.ts`), so what makes a multi-move
 * one undo is folding it into one call rather than anything the history knows
 * about selections.
 */
export function moveSelection(
  scenario: Scenario,
  selection: MapSelection,
  delta: Point,
  snap: SnapBuilding | undefined,
  layoutEdit: LayoutEditFor,
): Scenario {
  return movedKeys(selection).reduce(
    (doc, key) => moveOnMap(doc, key, delta, snap, layoutEdit),
    scenario,
  );
}

/** The document with everything selected turned a quarter turn about its own
 *  centre, as one edit. What has no facing is left alone, which is a group, a
 *  zone and a point on a path. */
export function turnSelection(
  scenario: Scenario,
  selection: MapSelection,
  steps: number,
  layoutEdit: LayoutEditFor,
): Scenario {
  return selection.reduce(
    (doc, key) => turnOnMap(doc, key, steps, layoutEdit),
    scenario,
  );
}

/** The document without any of it, as one edit. */
export function removeSelection(
  scenario: Scenario,
  selection: MapSelection,
  layoutEdit: LayoutEditFor,
): Scenario {
  return removalOrder(selection).reduce(
    (doc, key) => removeOnMap(doc, key, layoutEdit),
    scenario,
  );
}

/** How many things of each kind are selected, counted as an author counts them
 *  rather than as keys: a group is one group however many of its units were
 *  swept up, and a base's buildings are as many buildings as were. */
export interface SelectionCount {
  actors: number;
  groups: number;
  buildings: number;
  zones: number;
  points: number;
  /** All of the above added up, which is the number an announcement leads
   *  with. */
  total: number;
}

export function countSelection(selection: MapSelection): SelectionCount {
  const actors = new Set<string>();
  const groups = new Set<string>();
  const buildings = new Set<string>();
  const zones = new Set<string>();
  const points = new Set<string>();
  for (const key of selection) {
    const zone = parseZoneKey(key);
    if (zone) {
      zones.add(zone.id);
      continue;
    }
    if (parsePathKey(key)) {
      points.add(key);
      continue;
    }
    const ref = parsePlacementKey(key);
    if (!ref) continue;
    if (ref.kind === "actor") actors.add(ref.id);
    else if (ref.kind === "group") groups.add(ref.id);
    else buildings.add(key);
  }
  return {
    actors: actors.size,
    groups: groups.size,
    buildings: buildings.size,
    zones: zones.size,
    points: points.size,
    total:
      actors.size + groups.size + buildings.size + zones.size + points.size,
  };
}

/** A count and its noun, singular or plural. */
function some(count: number, one: string, many = `${one}s`): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * What is selected, as a tally rather than as a list.
 *
 * A blind author needs the size and shape of the selection, not six sentences
 * naming six actors. "4 actors, 1 group and 2 base buildings" is one breath and
 * says everything an author is about to act on.
 *
 * Empty for an empty selection, so a caller decides what "nothing" sounds like
 * in its own sentence.
 */
export function countWords(selection: MapSelection): string {
  const count = countSelection(selection);
  const parts = [
    some(count.actors, "actor"),
    some(count.groups, "group"),
    some(count.buildings, "base building"),
    some(count.zones, "zone"),
    some(count.points, "path point"),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** How many things are selected, said in full: the number and what they are.
 *  What every announcement about a selection of more than one ends with. */
export function selectionCountWords(selection: MapSelection): string {
  const count = countSelection(selection);
  if (count.total === 0) return "Nothing selected.";
  if (count.total === 1) return `${countWords(selection)} selected.`;
  return `${count.total} selected: ${countWords(selection)}.`;
}

/** Just the tally, for a sentence that has already said what happened. */
function howMany(selection: MapSelection): string {
  const count = countSelection(selection);
  return count.total === 0 ? "Nothing selected." : `${count.total} selected.`;
}

/**
 * What a Shift-click added, said after it landed.
 *
 * The thing is named because the author picked it out one at a time and wants to
 * hear they got the right one. The rest is a number rather than the whole tally,
 * because hearing the shape of the selection read out on every one of six clicks
 * is six times longer than it needs to be. `what` is the caller's own name for
 * it, which for the map is `thingWords`.
 */
export function addedWords(what: string, after: MapSelection): string {
  return `Added ${what}. ${howMany(after)}`;
}

/** What a second Shift-click took back out. */
export function removedWords(what: string, after: MapSelection): string {
  return `Removed ${what}. ${howMany(after)}`;
}

/**
 * What a marquee caught, said after the box was let go of.
 *
 * The whole tally here, unlike a Shift-click: nothing was named on the way in,
 * so the tally is the only account of what is now selected. A box that caught
 * nothing says so, because an empty box and a box the author misjudged feel the
 * same and only one of them is worth trying again.
 */
export function marqueeWords(caught: number, after: MapSelection): string {
  if (caught === 0) return `Nothing in that box. ${howMany(after)}`;
  return selectionCountWords(after);
}

/**
 * How many of a selection's things cannot be built where they now stand, said
 * as one tally rather than as one sentence per building (issue #2315).
 *
 * What a blind author needs from a move or a turn of several things at once is
 * the shape of the trouble, not `buildTrouble`'s single sentence repeated once
 * per building: "6 cannot be built where they stand" is one breath, and six
 * bases each read out in full is not. A selection that turned up clean says
 * nothing, the same silence `buildTrouble` keeps for one thing that is fine.
 */
function manyBuildTrouble(
  selection: MapSelection,
  marks: readonly FootprintMark[],
): string {
  const troubled = selection.filter(
    (key) => buildTrouble(marks, key) !== "",
  ).length;
  if (troubled === 0) return "";
  const stand = troubled === 1 ? "it stands" : "they stand";
  return ` ${troubled} cannot be built where ${stand}.`;
}

/** What a move of more than one thing did. No position, because there is no one
 *  position for four things to now be at. `marks` is read off the document as
 *  it stands after the move, the same as a single move reads it (issue
 *  #2315). */
export function movedManyWords(
  before: MapSelection,
  heading: string,
  step: number,
  marks: readonly FootprintMark[],
): string {
  const count = countSelection(before);
  return `Moved ${count.total} things ${step} ${heading}.${manyBuildTrouble(before, marks)}`;
}

/**
 * What a turn of more than one thing did.
 *
 * Both halves, because a mixed selection usually has something in it that does
 * not turn, and a turn that silently did less than was asked is the thing an
 * author needs to hear about. `selection` and `marks` carry the buildability
 * tally the same way {@link movedManyWords} does (issue #2315).
 */
export function turnedManyWords(
  turned: number,
  left: number,
  selection: MapSelection,
  marks: readonly FootprintMark[],
): string {
  if (turned === 0)
    return "None of these turn. A group's units all face south.";
  const done = `Turned ${turned}.`;
  const rest =
    left === 0 ? "" : ` ${left} ${left === 1 ? "does" : "do"} not turn.`;
  return `${done}${rest}${manyBuildTrouble(selection, marks)}`;
}

/** What a delete of more than one thing removed. The tally rather than a list,
 *  and named before it goes because afterwards there is nothing left to name it
 *  by. */
export function deletedManyWords(before: MapSelection): string {
  const count = countSelection(before);
  return `Deleted ${count.total}: ${countWords(before)}. Nothing selected.`;
}
