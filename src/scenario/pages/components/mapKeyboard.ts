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

import type { SnapBuilding } from "@/blueprint/footprint";
import type { Heading } from "@/placement/mapKeys";
import { type Placement, parsePlacementKey } from "@/placement/placements";
import {
  baseBuildings,
  type Facing,
  type Point,
  type Scenario,
} from "../../model";
import type { LayoutEdit } from "./bases";
import type { ContentEntry } from "./contents";
import { contentsSelection } from "./contents";
import {
  canTurn,
  movePlacement,
  removePlacement,
  turnPlacement,
} from "./editing";
import { orderWaypoints, parsePathKey } from "./groups";
import {
  movePathWaypoint,
  type PathSource,
  pathLabel,
  removePathWaypoint,
} from "./orderPaths";
import { moveZone, parseZoneKey, removeZone } from "./zones";

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
  const { scenario } = things;

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

  const path = parsePathKey(key);
  if (path) {
    const source = things.paths.find((one) => one.id === path.groupId);
    const order = source?.orders[path.order];
    const points = order ? orderWaypoints(order) : null;
    return points?.[path.waypoint] ?? null;
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
    return `${pathLabel(things.paths, path.groupId)}, point ${
      path.waypoint + 1
    }`;
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

/** What a move did, said after the document has taken it. */
export function movedWords(
  things: MapThings,
  key: string,
  heading: Heading,
  step: number,
): string {
  const pos = positionIn(things, key);
  if (!pos) return "Nothing moved.";
  return `Moved ${step} ${heading}, now at ${spotWords(pos)}.`;
}

/** What a turn did. The position comes with it because a turn does not move a
 *  building but does change which squares it covers. */
export function turnedWords(things: MapThings, key: string): string {
  const facing = facingIn(things, key);
  if (facing === null) return "This does not turn.";
  return `Facing ${facingWords(facing)}.`;
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
  "Map keys. Full stop and comma step through what is on the map. " +
  "Arrow keys move what is selected one build square north, south, east or west; " +
  "hold Shift for ten squares, Alt for one elmo. " +
  "With nothing selected the arrows move the view's cursor instead. " +
  "R turns, Shift R turns the other way. Delete removes. " +
  "Enter acts at the cursor: it answers whatever the map is waiting for, or places what the current mode places. " +
  "Escape lets go of the selection. Question mark reads this out again.";
