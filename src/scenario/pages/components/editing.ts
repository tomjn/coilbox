/**
 * Editing a scenario by pointing at the map: what a click, a drag and a delete
 * do to the document.
 *
 * Everything here is arithmetic on plain values, so the rules a mode relies on
 * can be tested without a GPU. What the gesture itself was is read in
 * `@/placement/pointer`, and the three.js half that turns a pointer event into a
 * point on the ground and a hit on a drawn unit lives in `useMapEditing.ts`.
 *
 * The three shapes a document places do not all move the same way. An actor is a
 * unit at a point, so it moves on its own. A group's units are a formation
 * around one point and carry no positions of their own, so dragging any of them
 * moves the whole group. A base's buildings are offsets from an origin held in
 * the blueprint it was placed from, so dragging one changes that layout and
 * leaves the rest of the base where it is.
 */

import type { SnapBuilding } from "@/blueprint/footprint";
import type { BlueprintBuilding } from "@/blueprint/model";
import { type PlacementRef, parsePlacementKey } from "@/placement/placements";
import type {
  ActorState,
  Facing,
  Point,
  Scenario,
  ScenarioActor,
  ScenarioGroup,
} from "../../model";
import { editBaseLayout, type LayoutEdit, removeBuilding } from "./bases";

/** Positions are whole elmos. The engine takes fractions, but nothing in an
 *  editor gains from writing 1023.9997 into a document. */
function round(pos: Point): Point {
  return { x: Math.round(pos.x), z: Math.round(pos.z) };
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
 * The document with one building of a base changed, in the blueprint the base
 * was placed from.
 *
 * Where a building stands and which way it faces are the layout, not the
 * placement, so this is the half of a base that a saved blueprint carries and
 * that another mission placing the same one would get. Which is why it goes
 * through {@link editBaseLayout}: a base sharing its layout with another gets a
 * copy of its own rather than dragging the other base's building with it.
 */
function editBaseBuilding(
  scenario: Scenario,
  ref: PlacementRef,
  how: LayoutEdit,
  update: (building: BlueprintBuilding) => BlueprintBuilding,
): Scenario {
  return editBaseLayout(scenario, ref.id, how, (buildings) => {
    const building = buildings[ref.index];
    if (!building) return null;
    const next = buildings.slice();
    next[ref.index] = update(building);
    return next;
  });
}

/**
 * The document with the thing this key names moved by `delta` elmos.
 *
 * The same document back when the key names nothing, so a caller can compare
 * identities to decide whether there is anything to save.
 *
 * A base's building is put on the build grid on the way down, because that is
 * where the engine will stand it and a layout drawn anywhere else is a layout
 * that cannot be built. Without a `snap` it lands where it was dropped, which is
 * what happens while the game's units are still being read.
 *
 * It is carried from the square it is drawn on rather than from the point its
 * layout names (issue #1517). The two are up to half a build square apart on any
 * layout coilbox did not author, and a drag is somebody moving the building they
 * can see: measured from the other point, a drag of two elmos landed a whole
 * square away. So the first drag of such a building writes its own square down,
 * which changes the number on the axis that was not dragged without moving the
 * building along it.
 */
export function movePlacement(
  scenario: Scenario,
  key: string,
  delta: Point,
  snap?: SnapBuilding,
  how: LayoutEdit = "own",
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

  const origin = scenario.bases.find((entry) => entry.id === ref.id)?.origin;
  if (!origin) return scenario;
  return editBaseBuilding(scenario, ref, how, (building) => {
    const named = {
      x: origin.x + building.offset.x,
      z: origin.z + building.offset.z,
    };
    const drawn = snap ? snap(named, building.def, building.facing) : named;
    const moved = shift(drawn);
    const at = snap ? snap(moved, building.def, building.facing) : moved;
    return {
      ...building,
      offset: round({ x: at.x - origin.x, z: at.z - origin.z }),
    };
  });
}

/** Whether the thing a key names has a facing to turn. A group's units are
 *  spawned facing south together, so a group has none. */
export function canTurn(key: string): boolean {
  const ref = parsePlacementKey(key);
  return ref?.kind === "actor" || ref?.kind === "base";
}

/** A facing turned `steps` quarter turns clockwise, staying in the engine's
 *  0 south, 1 east, 2 north, 3 west. */
export function turnFacing(facing: Facing, steps: number): Facing {
  const turned = (((facing + steps) % 4) + 4) % 4;
  return turned as Facing;
}

/**
 * The document with the thing this key names turned, or the same document when
 * it has no facing.
 *
 * Turning a building moves it, and there is no way to turn one without moving
 * it. A footprint's sides swap on an odd facing, so a rectangle that centred in
 * the middle of a build square on one axis centres on the corner between four
 * of them once it is on its side, and both answers are half a build square from
 * where it was drawn.
 *
 * So a turn writes the facing and nothing else (issue #1523). The point the
 * layout names is what the engine is asked about at every facing, which is what
 * makes a turn mean one thing: the same facing always puts the building on the
 * same square, turning back puts it back, and a full circle leaves it where it
 * started. Writing the new square down instead re-asked the engine about its
 * own last answer, and the engine breaks the tie the same way every time, so
 * four quarter turns walked a fusion plant a square east and two squares south.
 *
 * Which is why this takes no `snap`. A drag has to be measured from the square
 * the building is drawn on, because a drag is a distance and the author is
 * moving what they can see (issue #1517). A turn is not a distance, and
 * measuring it from the drawn square is what makes it creep.
 */
export function turnPlacement(
  scenario: Scenario,
  key: string,
  steps = 1,
  how: LayoutEdit = "own",
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

  if (ref.kind === "base") {
    return editBaseBuilding(scenario, ref, how, (building) => ({
      ...building,
      facing: turnFacing(building.facing, steps),
    }));
  }

  return scenario;
}

/**
 * The document with the thing this key names removed.
 *
 * What "removed" means follows what was clicked. An actor goes. One of a group's
 * units is one off that def's count, and the group goes when its last unit does.
 * A base's building goes, and the base goes with its last building, because an
 * empty cluster is not a thing an author can see or select again.
 */
export function removePlacement(
  scenario: Scenario,
  key: string,
  how: LayoutEdit = "own",
): Scenario {
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

  return removeBuilding(scenario, ref.id, ref.index, how);
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
