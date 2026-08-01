/**
 * Editing a scenario by pointing at the map: what a click and a drag mean, and
 * what each of them does to the document.
 *
 * Everything here is arithmetic on plain values, so the rules a mode relies on
 * can be tested without a GPU. The three.js half, turning a pointer event into a
 * point on the ground and a hit on a drawn unit, lives in `useMapEditing.ts`.
 *
 * The three shapes a document places do not all move the same way. An actor is a
 * unit at a point, so it moves on its own. A group's units are a formation
 * around one point and carry no positions of their own, so dragging any of them
 * moves the whole group. A prefab's buildings are offsets from an origin, so
 * dragging one moves that building within the prefab and leaves the rest where
 * they are.
 */

import type {
  ActorState,
  Facing,
  Point,
  Scenario,
  ScenarioActor,
  ScenarioGroup,
  ScenarioPrefab,
} from "../../model";
import type { Placement } from "./placements";

/** How far a pointer may travel between press and release and still count as a
 *  click, in CSS pixels. Wide enough to survive a shaky hand, narrow enough that
 *  a deliberate nudge of a unit is not read as a click. */
export const CLICK_SLOP_PX = 4;

/** A point in the surface's own pixels. */
export interface PointerPos {
  x: number;
  y: number;
}

/**
 * What a press on the map begins: picking something up, drawing on the ground,
 * or moving the camera.
 *
 * One button does all three, so what is under it decides. Only something a press
 * can pick up wins it: a zone's sheet is drawn over the ground and can cover the
 * whole view, so it is selected by a click and moved by its own handle, and a
 * drag that starts on one belongs to the camera or to the zone being drawn
 * inside it (#910, #837).
 */
export type PressGesture = "grab" | "draw" | "camera";

export function pressGesture(opts: {
  /** What the pointer is over, or null for bare ground. */
  key: string | null;
  /** Whether a press on that thing picks it up. False for something that can
   *  only be selected. */
  grabbable: boolean;
  /** Whether the current mode draws a shape by dragging across the ground. */
  draws: boolean;
}): PressGesture {
  if (opts.key && opts.grabbable) return "grab";
  return opts.draws ? "draw" : "camera";
}

/**
 * Whether a press and release were the same gesture.
 *
 * The camera pans on the left button, so a left press is not free: press and
 * release have to be compared to tell "I clicked here" from "I dragged the map".
 */
export function isClick(
  from: PointerPos,
  to: PointerPos,
  slop = CLICK_SLOP_PX,
): boolean {
  return Math.abs(to.x - from.x) <= slop && Math.abs(to.y - from.y) <= slop;
}

/** A pointer position in normalised device coordinates, which is what a
 *  raycaster takes: -1 to 1 across the canvas, y up. */
export function pointerNdc(
  client: PointerPos,
  rect: { left: number; top: number; width: number; height: number },
): PointerPos {
  return {
    x: rect.width > 0 ? ((client.x - rect.left) / rect.width) * 2 - 1 : 0,
    y: rect.height > 0 ? -(((client.y - rect.top) / rect.height) * 2 - 1) : 0,
  };
}

/** A point held on the map, so a ray that lands past the coastline still edits
 *  somewhere the engine can spawn a unit. */
export function clampToMap(
  pos: Point,
  worldWidth: number,
  worldHeight: number,
): Point {
  return {
    x: Math.min(worldWidth, Math.max(0, pos.x)),
    z: Math.min(worldHeight, Math.max(0, pos.z)),
  };
}

/** Positions are whole elmos. The engine takes fractions, but nothing in an
 *  editor gains from writing 1023.9997 into a document. */
function round(pos: Point): Point {
  return { x: Math.round(pos.x), z: Math.round(pos.z) };
}

/** Which document entry a drawn object belongs to. */
export interface PlacementRef {
  kind: Placement["kind"];
  id: string;
  index: number;
}

/**
 * The entry a placement key names, or `null` if it names nothing.
 *
 * The inverse of `placementKey`. Ids are UUIDs, so the separators cannot appear
 * inside one, but the index is still read off the end rather than by splitting
 * blindly.
 */
export function parsePlacementKey(key: string): PlacementRef | null {
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const kind = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  if (kind === "actor") return rest ? { kind, id: rest, index: 0 } : null;
  if (kind !== "group" && kind !== "prefab") return null;
  const hash = rest.lastIndexOf("#");
  if (hash <= 0) return null;
  const index = Number(rest.slice(hash + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { kind, id: rest.slice(0, hash), index };
}

/**
 * Every drawn object that moves when this one is dragged.
 *
 * One key for an actor or a prefab building, the whole formation for a group's
 * unit, so the scene shows the group moving as a block while the pointer is
 * down.
 */
export function dragKeys(placements: Placement[], key: string): string[] {
  const ref = parsePlacementKey(key);
  if (!ref) return [];
  if (ref.kind !== "group")
    return placements.some((p) => p.key === key) ? [key] : [];
  return placements
    .filter((p) => p.kind === "group" && p.id === ref.id)
    .map((p) => p.key);
}

/** Which of a group's `units` entries the `index`th drawn unit came from, or
 *  `-1` when the group has fewer units than that. */
function groupEntryAt(group: ScenarioGroup, index: number): number {
  let seen = 0;
  for (let i = 0; i < group.units.length; i++) {
    seen += group.units[i].count;
    if (index < seen) return i;
  }
  return -1;
}

/** Replace one entry of a registry by id, dropping it when the update returns
 *  `null`. Returns the original list when the id is not in it, or when the
 *  update decided there was nothing to change. */
function edit<T extends { id: string }>(
  list: T[],
  id: string,
  update: (entry: T) => T | null,
): T[] {
  const at = list.findIndex((entry) => entry.id === id);
  if (at < 0) return list;
  const next = update(list[at]);
  if (next === list[at]) return list;
  const out = list.slice();
  if (next === null) out.splice(at, 1);
  else out[at] = next;
  return out;
}

/**
 * The document with the thing this key names moved by `delta` elmos.
 *
 * The same document back when the key names nothing, so a caller can compare
 * identities to decide whether there is anything to save.
 */
export function movePlacement(
  scenario: Scenario,
  key: string,
  delta: Point,
): Scenario {
  const ref = parsePlacementKey(key);
  if (!ref) return scenario;
  const shift = (pos: Point): Point =>
    round({ x: pos.x + delta.x, z: pos.z + delta.z });

  if (ref.kind === "actor") {
    const actors = edit<ScenarioActor>(scenario.actors, ref.id, (actor) => ({
      ...actor,
      pos: shift(actor.pos),
    }));
    return actors === scenario.actors ? scenario : { ...scenario, actors };
  }

  if (ref.kind === "group") {
    const groups = edit<ScenarioGroup>(scenario.groups, ref.id, (group) => ({
      ...group,
      pos: shift(group.pos),
    }));
    return groups === scenario.groups ? scenario : { ...scenario, groups };
  }

  const prefabs = edit<ScenarioPrefab>(scenario.prefabs, ref.id, (prefab) => {
    const building = prefab.buildings[ref.index];
    if (!building) return prefab;
    const buildings = prefab.buildings.slice();
    buildings[ref.index] = { ...building, offset: shift(building.offset) };
    return { ...prefab, buildings };
  });
  return prefabs === scenario.prefabs ? scenario : { ...scenario, prefabs };
}

/** Whether the thing a key names has a facing to turn. A group's units are
 *  spawned facing south together, so a group has none. */
export function canTurn(key: string): boolean {
  const ref = parsePlacementKey(key);
  return ref?.kind === "actor" || ref?.kind === "prefab";
}

/** A facing turned `steps` quarter turns clockwise, staying in the engine's
 *  0 south, 1 east, 2 north, 3 west. */
export function turnFacing(facing: Facing, steps: number): Facing {
  const turned = (((facing + steps) % 4) + 4) % 4;
  return turned as Facing;
}

/** The document with the thing this key names turned, or the same document when
 *  it has no facing. */
export function turnPlacement(
  scenario: Scenario,
  key: string,
  steps = 1,
): Scenario {
  const ref = parsePlacementKey(key);
  if (!ref) return scenario;

  if (ref.kind === "actor") {
    const actors = edit<ScenarioActor>(scenario.actors, ref.id, (actor) => ({
      ...actor,
      facing: turnFacing(actor.facing, steps),
    }));
    return actors === scenario.actors ? scenario : { ...scenario, actors };
  }

  if (ref.kind === "prefab") {
    const prefabs = edit<ScenarioPrefab>(scenario.prefabs, ref.id, (prefab) => {
      const building = prefab.buildings[ref.index];
      if (!building) return prefab;
      const buildings = prefab.buildings.slice();
      buildings[ref.index] = {
        ...building,
        facing: turnFacing(building.facing, steps),
      };
      return { ...prefab, buildings };
    });
    return prefabs === scenario.prefabs ? scenario : { ...scenario, prefabs };
  }

  return scenario;
}

/**
 * The document with the thing this key names removed.
 *
 * What "removed" means follows what was clicked. An actor goes. One of a group's
 * units is one off that def's count, and the group goes when its last unit does.
 * A prefab's building goes, and the prefab goes with its last building, because
 * an empty cluster is not a thing an author can see or select again.
 */
export function removePlacement(scenario: Scenario, key: string): Scenario {
  const ref = parsePlacementKey(key);
  if (!ref) return scenario;

  if (ref.kind === "actor") {
    const actors = scenario.actors.filter((actor) => actor.id !== ref.id);
    return actors.length === scenario.actors.length
      ? scenario
      : { ...scenario, actors };
  }

  if (ref.kind === "group") {
    const groups = edit<ScenarioGroup>(scenario.groups, ref.id, (group) => {
      const at = groupEntryAt(group, ref.index);
      if (at < 0) return group;
      const units = group.units.slice();
      const entry = units[at];
      if (entry.count > 1) units[at] = { ...entry, count: entry.count - 1 };
      else units.splice(at, 1);
      return units.length === 0 ? null : { ...group, units };
    });
    return groups === scenario.groups ? scenario : { ...scenario, groups };
  }

  const prefabs = edit<ScenarioPrefab>(scenario.prefabs, ref.id, (prefab) => {
    if (!prefab.buildings[ref.index]) return prefab;
    const buildings = prefab.buildings.filter((_, i) => i !== ref.index);
    return buildings.length === 0 ? null : { ...prefab, buildings };
  });
  return prefabs === scenario.prefabs ? scenario : { ...scenario, prefabs };
}

/**
 * The document with one more actor on it.
 *
 * The id is passed in rather than minted here so the caller can select what it
 * just placed, and so this stays a pure function of its arguments.
 */
export function addActor(
  scenario: Scenario,
  id: string,
  actor: Omit<ScenarioActor, "id">,
): Scenario {
  return {
    ...scenario,
    actors: [...scenario.actors, { ...actor, id, pos: round(actor.pos) }],
  };
}

/**
 * The document with one actor's fields changed, or the same document when no
 * actor has that id.
 *
 * The patch is applied as given, so the caller decides what a field means.
 * Position and state have their own paths: {@link movePlacement} rounds, and
 * {@link setActorState} drops what does not need saying.
 */
export function editActor(
  scenario: Scenario,
  id: string,
  patch: Partial<Omit<ScenarioActor, "id">>,
): Scenario {
  const actors = edit<ScenarioActor>(scenario.actors, id, (actor) => ({
    ...actor,
    ...patch,
  }));
  return actors === scenario.actors ? scenario : { ...scenario, actors };
}

/**
 * The least health an actor can be placed with, as a fraction of its maximum.
 *
 * The runtime sets health to `max * hp` at spawn, and a unit set to nothing dies
 * the moment it is created, which is not what "nearly dead" means to whoever
 * dragged the slider to the bottom.
 */
export const MIN_ACTOR_HP = 0.01;

/**
 * An actor's overrides as they are worth writing down, or `undefined` when it
 * has none.
 *
 * Every field here overrides what the game would do on its own, so a field
 * holding the game's own answer is dropped rather than stored: full health, not
 * invulnerable, selectable, no display name. That keeps a document readable, and
 * keeps an actor nobody has touched free of a `state` block that says nothing.
 */
export function normaliseActorState(state: ActorState): ActorState | undefined {
  const out: ActorState = {};
  const hp = state.hp;
  if (hp !== undefined && Number.isFinite(hp) && hp < 1) {
    out.hp = Math.max(MIN_ACTOR_HP, hp);
  }
  if (state.invulnerable) out.invulnerable = true;
  if (state.unselectable) out.unselectable = true;
  const name = state.name?.trim();
  if (name) out.name = name;
  return Object.keys(out).length ? out : undefined;
}

/** The document with one actor's overrides replaced by {@link
 *  normaliseActorState} of what was given. */
export function setActorState(
  scenario: Scenario,
  id: string,
  state: ActorState,
): Scenario {
  return editActor(scenario, id, { state: normaliseActorState(state) });
}
