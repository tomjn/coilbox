/**
 * Driving the map without a pointer: what a key does to the document, and what
 * is said about it (issue #2269).
 *
 * A blind author gets nothing at all from the 3D view, so speech is the whole
 * interface rather than a courtesy on top of one. That is why the sentences are
 * here beside the edits and tested with them: an announcement that has drifted
 * from what the key actually did is worse than no announcement, because it is
 * the only account of the map anybody is going to get.
 *
 * Every position said out loud is read back out of the document after the edit
 * has been applied to it rather than predicted from the key press. A base's
 * building is put on the engine's build grid on the way down, so where an arrow
 * lands it is not always the square arithmetic would name (issue #1517), and
 * announcing the arithmetic would be announcing a lie.
 *
 * Arithmetic and strings only, so all of it can be tested without a GPU. The
 * key table itself is `@/placement/mapKeys`, and the wiring is
 * `useMapKeyboard.ts`.
 */

import type { FootprintMark, SnapBuilding } from "@/blueprint/footprint";
import type { LayoutEdit } from "@/lib/scenarioEditing/bases";
import {
  canTurn,
  movePlacement,
  removePlacement,
  turnPlacement,
} from "@/lib/scenarioEditing/editing";
import type { Heading } from "@/placement/mapKeys";
import { type Placement, parsePlacementKey } from "@/placement/placements";
import { previewCount, unjudgedClause } from "@/placement/preview";
import {
  baseBuildings,
  type Facing,
  type Point,
  type Scenario,
  type ScenarioZone,
} from "../../model";
import type { ContentEntry } from "./contents";
import { contentsSelection } from "./contents";
import { orderWaypoints, parsePathKey, pathKey } from "./groups";
import {
  movePathWaypoint,
  type PathSource,
  pathLabel,
  pathPointPosition,
  removePathWaypoint,
} from "./orderPaths";
import { moveZone, parseZoneKey, removeZone, resizeZone } from "./zones";

/** Everything the keys need to read: the document, and the three lists the map
 *  draws it as. */
export interface MapThings {
  scenario: Scenario;
  /** What the contents list holds, which is the order the keys cycle in. */
  entries: ContentEntry[];
  /** Every unit currently drawn, for naming the one that is selected. */
  placements: Placement[];
  /** Every path the map draws, for naming a selected point on one. */
  paths: PathSource[];
}

/** How an edit to a base is written: as the layout every base placed from it
 *  shares, or as a copy of that base's own. */
export type LayoutEditFor = (id: string | null | undefined) => LayoutEdit;

/**
 * The document with the thing a key names moved.
 *
 * One entry point for the three kinds of thing the map can move, because a
 * pointer drag and an arrow press are the same edit made two ways and must not
 * drift apart. The pointer's own handler calls this too.
 */
export function moveOnMap(
  scenario: Scenario,
  key: string,
  delta: Point,
  snap: SnapBuilding | undefined,
  layoutEdit: LayoutEditFor,
): Scenario {
  if (parseZoneKey(key)) return moveZone(scenario, key, delta);
  if (parsePathKey(key)) return movePathWaypoint(scenario, key, delta);
  return movePlacement(
    scenario,
    key,
    delta,
    snap,
    layoutEdit(parsePlacementKey(key)?.id),
  );
}

/** The document with the zone this key names grown or shrunk `step` elmos in
 *  the direction named. The same document back when the key does not name a
 *  zone still on it, exactly the entry point `moveOnMap` is for a move
 *  (issue #2313). Nothing else on the map resizes, so there is no other kind
 *  to dispatch across. */
export function resizeOnMap(
  scenario: Scenario,
  key: string,
  heading: Heading,
  step: number,
): Scenario {
  return resizeZone(scenario, key, heading, step);
}

/** The document without the thing a key names. */
export function removeOnMap(
  scenario: Scenario,
  key: string,
  layoutEdit: LayoutEditFor,
): Scenario {
  const zone = parseZoneKey(key);
  if (zone) return removeZone(scenario, zone.id);
  if (parsePathKey(key)) return removePathWaypoint(scenario, key);
  return removePlacement(scenario, key, layoutEdit(parsePlacementKey(key)?.id));
}

/** The document with the thing a key names turned a quarter turn, or the same
 *  document when it is not a thing with a facing. */
export function turnOnMap(
  scenario: Scenario,
  key: string,
  steps: number,
  layoutEdit: LayoutEditFor,
): Scenario {
  if (!canTurn(key)) return scenario;
  return turnPlacement(
    scenario,
    key,
    steps,
    layoutEdit(parsePlacementKey(key)?.id),
  );
}

/**
 * Where the thing a key names stands, read out of the document.
 *
 * Out of the document rather than out of the drawn list, because that is the
 * half that is up to date the moment an edit is applied. A key press announces
 * itself in the same tick it lands, and the drawn units are a render behind
 * until the scene is rebuilt from the new document.
 *
 * Null when the key names nothing the document still holds, which is what a key
 * pointing at something just deleted names.
 */
export function positionIn(things: MapThings, key: string): Point | null {
  return positionOn(things.scenario, key);
}

/** {@link positionIn} for a caller holding only the document, which is all
 *  either of them ever reads. */
export function positionOn(scenario: Scenario, key: string): Point | null {
  const zone = parseZoneKey(key);
  if (zone) {
    const found = scenario.zones.find((one) => one.id === zone.id);
    if (!found) return null;
    return found.shape === "circle"
      ? found.center
      : {
          x: (found.min.x + found.max.x) / 2,
          z: (found.min.z + found.max.z) / 2,
        };
  }

  // Out of the document rather than out of `things.paths`: that list is a
  // snapshot the caller may be holding from before this call's own edit, and
  // only the document is guaranteed to have caught up with it (issue #2314).
  if (parsePathKey(key)) {
    return pathPointPosition(scenario, key);
  }

  const ref = parsePlacementKey(key);
  if (!ref) return null;
  if (ref.kind === "actor")
    return scenario.actors.find((one) => one.id === ref.id)?.pos ?? null;
  // A group's units carry no positions of their own: the group stands at one
  // point and the runtime lays the formation out around it, so the point that
  // moved is the group's.
  if (ref.kind === "group")
    return scenario.groups.find((one) => one.id === ref.id)?.pos ?? null;
  const base = scenario.bases.find((one) => one.id === ref.id);
  if (!base) return null;
  const building = baseBuildings(scenario.blueprints, base)[ref.index];
  if (!building) return null;
  return {
    x: base.origin.x + building.offset.x,
    z: base.origin.z + building.offset.z,
  };
}

/** Which way the thing a key names is facing, or null for the things that have
 *  no facing: a group, a zone, a point on a path. */
export function facingIn(things: MapThings, key: string): Facing | null {
  if (!canTurn(key)) return null;
  const ref = parsePlacementKey(key);
  if (!ref) return null;
  const { scenario } = things;
  if (ref.kind === "actor")
    return scenario.actors.find((one) => one.id === ref.id)?.facing ?? null;
  const base = scenario.bases.find((one) => one.id === ref.id);
  if (!base) return null;
  return baseBuildings(scenario.blueprints, base)[ref.index]?.facing ?? null;
}

/** The engine's facings as words: 0 south, 1 east, 2 north, 3 west. */
export function facingWords(facing: Facing): string {
  return ["south", "east", "north", "west"][facing];
}

/** A position as it is read out. Named axes rather than a bare pair, because
 *  "1024, 2048" on its own says nothing about which way either number runs. */
export function spotWords(pos: Point): string {
  return `x ${Math.round(pos.x)}, z ${Math.round(pos.z)}`;
}

/**
 * What the thing a key names is called, in the words the map already uses for
 * it on screen.
 *
 * A placement is named twice: by the entry it belongs to, which is what the
 * contents list calls it, and by its place inside that entry, which is what the
 * selection bar calls it. Both, because "base building 3" alone does not say
 * which base and "Ridge outpost" alone does not say which building.
 */
export function thingWords(things: MapThings, key: string): string {
  const zone = parseZoneKey(key);
  if (zone) {
    const found = things.scenario.zones.find((one) => one.id === zone.id);
    return found ? `zone ${found.name}` : "a zone that is gone";
  }

  const path = parsePathKey(key);
  if (path) {
    const source = things.paths.find((one) => one.id === path.groupId);
    const order = source?.orders[path.order];
    const total = order && orderWaypoints(order)?.length;
    const of = total ? ` of ${total}` : "";
    return `${pathLabel(things.paths, path.groupId)}, point ${
      path.waypoint + 1
    }${of}`;
  }

  const placement = things.placements.find((one) => one.key === key);
  if (!placement) return "nothing";
  const entry = things.entries.find(
    (one) => one.kind === placement.kind && one.id === placement.id,
  );
  const where =
    placement.kind === "actor"
      ? "actor"
      : placement.kind === "group"
        ? `unit ${placement.index + 1}`
        : `building ${placement.index + 1}`;
  // An actor nobody has named is listed under its own unit type, so saying the
  // entry's name as well would be saying "armcom, actor, armcom".
  const named =
    entry && entry.label !== placement.def ? `${entry.label}, ` : "";
  return `${named}${where}, ${placement.def}`;
}

/** What is selected, said in full: what it is, which way it faces, and where it
 *  stands. The sentence an author hears every time the selection moves. */
export function selectionWords(things: MapThings, key: string | null): string {
  if (!key) return "Nothing selected.";
  const pos = positionIn(things, key);
  if (!pos) return "Nothing selected.";
  const facing = facingIn(things, key);
  const way = facing === null ? "" : `, facing ${facingWords(facing)}`;
  return `${thingWords(things, key)}${way}, at ${spotWords(pos)}.`;
}

/**
 * Whether the base building a key names is one the ground, or another
 * building, will actually take, read off the marks `baseFootprints` already
 * worked out for the document as it now stands (issue #2315). The same
 * verdict its footprint square is coloured with, in words.
 *
 * Said as an addition only when it is bad news. A building that is fine adds
 * nothing, the same way a move that lands cleanly says nothing about the
 * buildings it did not touch, so an author is not told "and it can be built
 * here" after every single arrow press: silence is what fine sounds like. A
 * building still in trouble after the press that was meant to fix it says so
 * again, because that repeat is the one an author needs.
 *
 * Nothing here that the ground has not judged: the game's units not being
 * read, the map's heights not reading, and this def having no slope to check
 * are all a gap in what is known rather than a refusal, and are said once
 * about the whole map by {@link mapProblemsWords} rather than on every move of
 * every building while the reads are still in flight.
 *
 * Silent for everything else the map holds too: an actor, a group, a zone and
 * a path point stand on no footprint at all, so no mark ever names one.
 */
export function buildTrouble(
  marks: readonly FootprintMark[],
  key: string,
): string {
  const mark = marks.find((one) => one.key === key);
  if (!mark) return "";
  const reasons: string[] = [];
  if (mark.overlapping) reasons.push("overlapping another building, in red");
  if (mark.standing === "slope") {
    reasons.push("on ground too steep for it, in amber");
  } else if (mark.standing === "too-deep") {
    reasons.push("in water too deep for it, in cyan");
  } else if (mark.standing === "too-shallow") {
    reasons.push("not in deep enough water, in cyan");
  }
  if (reasons.length === 0) return "";
  return ` Cannot be built here: ${reasons.join(", ")}.`;
}

/** What a move did, said after the document has taken it. */
export function movedWords(
  things: MapThings,
  key: string,
  heading: Heading,
  step: number,
  marks: readonly FootprintMark[],
): string {
  const pos = positionIn(things, key);
  if (!pos) return "Nothing moved.";
  return `Moved ${step} ${heading}, now at ${spotWords(pos)}.${buildTrouble(marks, key)}`;
}

/**
 * What adding a point to a path being drawn said, read out of the order once
 * the point has landed on it (issue #2359).
 *
 * A point is only ever added at the end, so the order's length after the edit
 * is both which point this is and how many there now are. Read from `after`
 * rather than counted before the click, so it cannot say a number the
 * document does not hold. The shape, "point N of M", is the one the cycle
 * already says when it steps onto a path's point (issue #2314). A second
 * shape for the same fact would be a second thing to learn.
 */
export function addedPointWords(
  paths: PathSource[],
  after: Scenario,
  groupId: string,
  order: number,
): string {
  const found = after.groups.find((group) => group.id === groupId)?.orders[
    order
  ];
  const total = found && orderWaypoints(found)?.length;
  if (!total) return "Nothing added.";
  return `Added ${pathLabel(paths, groupId)}, point ${total} of ${total}.`;
}

/**
 * What moving a base's origin said, read out of the base once it has landed
 * (issue #2359).
 *
 * A base's origin snaps to the engine's build grid on the way down, the same
 * as one of its buildings dragged by an arrow key (issue #1517), so where it
 * lands is not always the point that was clicked. Read from `after` rather
 * than the click, so the words cannot disagree with where the base actually
 * stands.
 */
export function originMovedWords(after: Scenario, baseId: string): string {
  const base = after.bases.find((one) => one.id === baseId);
  if (!base) return "Nothing moved.";
  return `Moved the base's origin, now at ${spotWords(base.origin)}.`;
}

/** What a turn did. The position comes with it because a turn does not move a
 *  building but does change which squares it covers. */
export function turnedWords(
  things: MapThings,
  key: string,
  marks: readonly FootprintMark[],
): string {
  const facing = facingIn(things, key);
  if (facing === null) return "This does not turn.";
  return `Facing ${facingWords(facing)}.${buildTrouble(marks, key)}`;
}

/**
 * What is wrong with the buildings on the whole map, on demand rather than
 * only for whichever one happens to be selected (issue #2315): the same tally
 * a carried layout's preview gives, `previewCount`, read off the marks
 * `baseFootprints` already worked out for the document as it stands.
 *
 * The unchecked note in the map's corner already says this much to an author
 * who can see it (issue #2350). This is the same fact, read out on request
 * for one who cannot.
 */
export function mapProblemsWords(marks: readonly FootprintMark[]): string {
  const count = previewCount(marks);
  if (count.total === 0) return "Nothing built yet.";
  const bad =
    count.clashes +
    count.unstable +
    count.tooDeep +
    count.tooShallow +
    count.absent;
  if (bad === 0) {
    const room =
      count.total === 1
        ? "1 building, and it can be built where it stands."
        : `${count.total} buildings, and every one of them can be built where it stands.`;
    return room + unjudgedClause(count);
  }
  const parts: string[] = [];
  if (count.clashes > 0) {
    parts.push(
      count.clashes === 1
        ? "1 overlapping another building"
        : `${count.clashes} overlapping other buildings`,
    );
  }
  if (count.unstable > 0) {
    parts.push(
      count.unstable === 1
        ? "1 on ground too steep for it"
        : `${count.unstable} on ground too steep for them`,
    );
  }
  if (count.tooDeep > 0) {
    parts.push(
      count.tooDeep === 1
        ? "1 in water too deep for it"
        : `${count.tooDeep} in water too deep for them`,
    );
  }
  if (count.tooShallow > 0) {
    parts.push(
      count.tooShallow === 1
        ? "1 without enough water under it"
        : `${count.tooShallow} without enough water under them`,
    );
  }
  if (count.absent > 0) {
    parts.push(
      count.absent === 1
        ? "1 a unit this game has not got"
        : `${count.absent} units this game has not got`,
    );
  }
  const of = bad === count.total ? "" : ` of ${count.total}`;
  const stand = bad === 1 ? "it stands" : "they stand";
  return (
    `${bad}${of} cannot be built where ${stand}: ${parts.join(", ")}.` +
    unjudgedClause(count)
  );
}

/** A zone's size, in elmos: what a resize changed and the number a resize
 *  announcement has to carry. A box says width and height because a resize
 *  can leave the two different. A circle says its one radius. */
function zoneSizeWords(zone: ScenarioZone): string {
  if (zone.shape === "circle") return `radius ${Math.round(zone.radius)} elmos`;
  const width = Math.round(zone.max.x - zone.min.x);
  const height = Math.round(zone.max.z - zone.min.z);
  return `${width} by ${height} elmos`;
}

/** The zone a key names, read out of the document, or null when the key does
 *  not name a zone still on it. */
function zoneNamed(things: MapThings, key: string): ScenarioZone | null {
  const ref = parseZoneKey(key);
  if (!ref) return null;
  return things.scenario.zones.find((one) => one.id === ref.id) ?? null;
}

/** What a resize did, said after the document has taken it: the size read
 *  back out of the document rather than reasoned out from the key press, the
 *  same rule `movedWords` follows for a move. */
export function resizedWords(
  things: MapThings,
  key: string,
  heading: Heading,
  step: number,
): string {
  const zone = zoneNamed(things, key);
  if (!zone) return "Nothing resized.";
  const verb = heading === "north" || heading === "east" ? "Grew" : "Shrank";
  return `${verb} ${step}, now ${zoneSizeWords(zone)}.`;
}

/** What is said when a resize asked for no change at all: the zone is already
 *  as small as one gets to be. Growing has no such ceiling. */
export function resizeLimitWords(things: MapThings, key: string): string {
  const zone = zoneNamed(things, key);
  if (!zone) return "Nothing resized.";
  return `Already as small as a zone gets, ${zoneSizeWords(zone)}.`;
}

/**
 * What is said when resize mode is switched on or off for the zone that is
 * selected (issue #2313).
 *
 * Arrows move a selected zone by default, the same key every other thing on
 * the map moves by, so trading that for a resize has to say so in words. An
 * author who cannot see the map has nothing else to tell the two apart by.
 */
export function resizeModeWords(
  things: MapThings,
  key: string,
  on: boolean,
): string {
  const zone = zoneNamed(things, key);
  if (!zone) return "Nothing selected.";
  if (!on) return "Move mode. Arrows move it again.";
  return (
    `Resize mode, ${zoneSizeWords(zone)}. Arrows change its size instead of its position: ` +
    "north and east make it bigger, south and west make it smaller. Press S again for move."
  );
}

/** Where the view's own cursor is, for an author placing something without a
 *  pointer. The ground height comes with it because whether a spot is a hilltop
 *  or a valley floor is the thing the 3D view says and speech cannot. */
export function cursorWords(pos: Point, height: number): string {
  return `Cursor at ${spotWords(pos)}, ground height ${Math.round(height)}.`;
}

/**
 * The next thing to select, walking the contents list.
 *
 * The contents list order is used rather than an order of this file's own,
 * because that list is the other keyboard way into the same selection and two
 * orders for one thing would be two things to learn. Wraps, so the list is a
 * ring rather than something an author falls off the end of.
 *
 * Where the walk starts is the entry the current selection belongs to, so
 * stepping on from a base's third building goes to the next entry rather than
 * to that base's fourth building.
 */
export function nextEntry(
  entries: ContentEntry[],
  selected: string | null,
  by: 1 | -1,
): ContentEntry | null {
  if (entries.length === 0) return null;
  const here = contentsSelection(entries, selected);
  const at = here ? entries.findIndex((entry) => entry.key === here) : -1;
  if (at < 0) return by === 1 ? entries[0] : entries[entries.length - 1];
  const next = (at + by + entries.length) % entries.length;
  return entries[next];
}

/**
 * A stop the keyboard's cycle can land on: a contents entry, or a point on a
 * path. A path's points are not contents entries of their own (issue #2314),
 * so this is the smaller shape `mapSteps` and `nextStep` need to put both on
 * one ring: enough to select the thing and look at it, nothing a path point
 * does not have.
 */
export interface MapStep {
  key: string;
  pos: Point;
  span: number;
}

/** The points of one path, each a stop of its own, in the order they are
 *  drawn. */
function pathSteps(source: PathSource): MapStep[] {
  return source.orders.flatMap((order, orderIndex) => {
    const points = orderWaypoints(order);
    if (!points) return [];
    return points.map<MapStep>((point, waypoint) => ({
      key: pathKey(source.id, orderIndex, waypoint),
      pos: point,
      span: 0,
    }));
  });
}

/**
 * The full ring the cycle walks: the contents list, with a group's own path
 * points following the group they belong to, and a trigger's held orders --
 * which own no place in that list -- carried after everything else (issue
 * #2314).
 *
 * A group's points sit right after the group rather than in a list of their
 * own, because the group is already how a click or a cycle says which path is
 * meant: putting the points anywhere else would be a second way to reach the
 * same thing, and PR #2316 already chose one selection model over two.
 */
export function mapSteps(
  entries: ContentEntry[],
  paths: PathSource[],
): MapStep[] {
  const owned = new Map(
    paths
      .filter((source) =>
        entries.some(
          (entry) => entry.kind === "group" && entry.id === source.id,
        ),
      )
      .map((source) => [source.id, source] as const),
  );
  const held = paths.filter((source) => !owned.has(source.id));
  const woven = entries.flatMap((entry): MapStep[] => {
    const source = entry.kind === "group" ? owned.get(entry.id) : undefined;
    return source ? [entry, ...pathSteps(source)] : [entry];
  });
  return [...woven, ...held.flatMap(pathSteps)];
}

/** Where in `steps` the current selection sits: the stop whose own key
 *  matches, which a path point's always does, or -- for a sub-key a step's
 *  key carries no index for, such as a base's third building -- the entry it
 *  belongs to, the same rule `nextEntry` follows. */
function stepIndex(
  steps: MapStep[],
  entries: ContentEntry[],
  selected: string | null,
): number {
  if (!selected) return -1;
  const exact = steps.findIndex((step) => step.key === selected);
  if (exact >= 0) return exact;
  const canonical = contentsSelection(entries, selected);
  return canonical ? steps.findIndex((step) => step.key === canonical) : -1;
}

/** The next stop on the ring `mapSteps` lays out. Wraps, the same as
 *  `nextEntry`, so an author never falls off the end of a path any more than
 *  off the end of the contents list. */
export function nextStep(
  steps: MapStep[],
  entries: ContentEntry[],
  selected: string | null,
  by: 1 | -1,
): MapStep | null {
  if (steps.length === 0) return null;
  const at = stepIndex(steps, entries, selected);
  if (at < 0) return by === 1 ? steps[0] : steps[steps.length - 1];
  return steps[(at + by + steps.length) % steps.length];
}

/** How far through the list the selection is, so an author knows where they
 *  are rather than only what they are on. */
export function placeInList(
  entries: ContentEntry[],
  selected: string | null,
): string {
  const here = contentsSelection(entries, selected);
  const at = here ? entries.findIndex((entry) => entry.key === here) : -1;
  if (at < 0) return "";
  return ` ${at + 1} of ${entries.length}.`;
}

/**
 * The point two typed fields name, or null when they do not name one on this
 * map.
 *
 * The answer to a question the map is waiting for that needs no map at all
 * (issue #2269). A trigger's point is often one the author already has, copied
 * off another trigger or read off a start position, and it is the one way of
 * answering that asks nothing of eyesight or of a steady hand.
 *
 * Held to the map, because a point off it is a point the mission cannot use, and
 * rounded to whole elmos, which is what a scenario stores.
 */
export function pointFrom(
  x: string,
  z: string,
  worldWidth: number,
  worldHeight: number,
): Point | null {
  const east = Number(x.trim());
  const south = Number(z.trim());
  if (!x.trim() || !z.trim()) return null;
  if (!Number.isFinite(east) || !Number.isFinite(south)) return null;
  if (east < 0 || east > worldWidth) return null;
  if (south < 0 || south > worldHeight) return null;
  return { x: Math.round(east), z: Math.round(south) };
}

/**
 * The key list, read out on demand.
 *
 * Also what the surface is described by, so it is said once when the map takes
 * the focus and again whenever the author asks. A keyboard interface nobody can
 * discover is not one.
 */
export const MAP_KEY_HELP =
  "Map keys. Full stop and comma step through what is on the map, " +
  "including a path's points, which follow the group they belong to. " +
  "Arrow keys move what is selected one build square north, south, east or west. " +
  "Hold Shift for ten squares, Alt for one elmo. " +
  "With nothing selected the arrows move the view's cursor instead. " +
  "R turns, Shift R turns the other way. Delete removes. " +
  "T turns everything selected as one shape instead, so a base swings round " +
  "its own middle rather than each building spinning where it stands, and " +
  "Shift T swings it the other way. " +
  "S toggles resize mode on a selected zone: arrows then change its size instead of its position, in the same steps. " +
  "North and east make it bigger, south and west make it smaller. " +
  "Enter acts at the cursor: it answers whatever the map is waiting for, or places what the current mode places. " +
  "Escape lets go of the selection. " +
  "More than one thing can be selected at once, and then every one of those keys acts on all of it. " +
  "Full stop and comma replace the selection rather than growing it. " +
  "A steps to the next thing and adds it to what is already selected, Shift A steps to the previous thing and adds it the same way; landing on something already selected takes it back out. " +
  "Contents' Shift with Enter on a row adds that row the same way. " +
  "P reads how many of the buildings on the map cannot be built where they stand. " +
  "Question mark reads this out again.";
