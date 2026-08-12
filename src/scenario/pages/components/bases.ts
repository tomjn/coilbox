/**
 * Bases as the editor edits them: what a base is made of, where its buildings
 * sit relative to it, and what a factory in one is told to build.
 *
 * Arithmetic on plain values, so the rules can be tested without a GPU. Moving
 * and turning a single building already live in `editing.ts`, because a base's
 * building is picked on the map the way an actor is. What is here is everything
 * that is about the base rather than about one of its buildings.
 *
 * A base is two things in the document (issue #1310): a blueprint holding the
 * layout, and a placement naming that blueprint plus the team, the origin and
 * the mission-only fields on each building. The editor puts one down as a pair
 * and every operation here keeps the pair in step, so an author still works on
 * one base. Which half an edit lands in is the point of the split: changing the
 * team or moving the whole base touches the placement, and adding a building or
 * moving one within the base changes the layout, which is what makes that layout
 * worth keeping and using somewhere else.
 *
 * Two things come from the runtime and are not the editor's to decide. A
 * building's `offset` is measured from the base's origin, so moving one building
 * and moving the whole base are different edits. And the runtime only puts a def
 * the game calls a building through `Spring.Pos2BuildPos`: anything else spawns
 * where it is put, off the build grid, so the picker offers buildings only and
 * {@link strayDefs} says so about a document that already names something else.
 */

import { BUILD_SQUARE } from "@/blueprint/footprint";
import type { BaseBlueprint, BlueprintBuilding } from "@/blueprint/model";
import type { UnitDatasetEntry } from "@/content/bindings";
import type {
  BaseBuildingRole,
  PlacedBuilding,
  Point,
  Scenario,
  ScenarioBase,
} from "../../model";

/** Whole elmos. The engine takes fractions, but an author never means
 *  1023.9997. */
function round(pos: Point): Point {
  return { x: Math.round(pos.x), z: Math.round(pos.z) };
}

/** Replace one entry of a registry by id, dropping it when the update returns
 *  `null`. The list's own identity back when there is nothing to change. */
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
 * The mission-only half of a building, with the fields nothing has set left out,
 * so a base nobody has named anything in stays free of empty entries.
 */
function buildingRole(building: PlacedBuilding): BaseBuildingRole {
  const role: BaseBuildingRole = {};
  if (building.id !== undefined) role.id = building.id;
  if (building.queue !== undefined) role.queue = building.queue;
  if (building.repeat !== undefined) role.repeat = building.repeat;
  return role;
}

/**
 * The document without the layouts nothing places any more.
 *
 * Called wherever a base goes, because a blueprint the editor minted for one
 * base is that base's layout and nothing else. A layout an author saved for its
 * own sake will have somewhere else to be listed, and this only ever drops one
 * that no base names.
 */
export function pruneBlueprints(scenario: Scenario): Scenario {
  const used = new Set(scenario.bases.map((base) => base.blueprint));
  const blueprints = scenario.blueprints.filter((b) => used.has(b.id));
  return blueprints.length === scenario.blueprints.length
    ? scenario
    : { ...scenario, blueprints };
}

/** The document with one base's layout changed. */
function editLayout(
  scenario: Scenario,
  id: string,
  update: (buildings: BlueprintBuilding[]) => BlueprintBuilding[],
): Scenario {
  const base = scenario.bases.find((entry) => entry.id === id);
  if (!base) return scenario;
  const blueprints = edit<BaseBlueprint>(
    scenario.blueprints,
    base.blueprint,
    (blueprint) => ({ ...blueprint, buildings: update(blueprint.buildings) }),
  );
  return blueprints === scenario.blueprints
    ? scenario
    : { ...scenario, blueprints };
}

/* -------------------------------------------------------------------------- *
 * The document. Every one of these hands the same document back when the id
 * names nothing, so a caller can compare identities to decide whether there is
 * anything to save.
 * -------------------------------------------------------------------------- */

/**
 * The document with one more base on it, and the layout it is placed from.
 *
 * Both ids are passed in so the caller can select the building it just placed.
 * The layout gets one of its own rather than sharing the base's, because the two
 * are separate registries and a base is free to be pointed at a different layout
 * later without its own id moving.
 */
export function addBase(
  scenario: Scenario,
  id: string,
  blueprintId: string,
  base: {
    team: string;
    origin: Point;
    /** What the layout is called. Its id when the caller has nothing better,
     *  which is what a base drawn on the map has until it is saved by name. */
    name?: string;
    buildings: PlacedBuilding[];
  },
): Scenario {
  return {
    ...scenario,
    blueprints: [
      ...scenario.blueprints,
      {
        id: blueprintId,
        name: base.name ?? blueprintId,
        buildings: base.buildings.map((b) => ({
          def: b.def,
          offset: round(b.offset),
          facing: b.facing,
        })),
      },
    ],
    bases: [
      ...scenario.bases,
      {
        id,
        blueprint: blueprintId,
        team: base.team,
        origin: round(base.origin),
        buildings: base.buildings.map(buildingRole),
      },
    ],
  };
}

/**
 * The document with one more building in a base.
 *
 * The offset is measured from the base's origin, which is what the caller has to
 * work out: a click on the map is a point, and what goes in the document is that
 * point less the origin. The new building is the last one, so its index is the
 * building count before this call.
 */
export function addBuilding(
  scenario: Scenario,
  id: string,
  building: PlacedBuilding,
): Scenario {
  const base = scenario.bases.find((entry) => entry.id === id);
  const layout = base
    ? scenario.blueprints.find((b) => b.id === base.blueprint)
    : undefined;
  if (!base || !layout) return scenario;

  const at = layout.buildings.length;
  const roles = base.buildings.slice();
  // Filled out to the layout's length first. A placement's list is allowed to
  // stop short where the buildings before this one say nothing, which is what a
  // layout dropped in from outside looks like, and without the padding the new
  // building's id would land on one of them.
  while (roles.length < at) roles.push({});
  roles[at] = buildingRole(building);

  const withLayout = editLayout(scenario, id, (buildings) => [
    ...buildings,
    {
      def: building.def,
      offset: round(building.offset),
      facing: building.facing,
    },
  ]);
  return editBase(withLayout, id, { buildings: roles });
}

/** The document with one base's own fields changed. Its buildings are edited
 *  through {@link addBuilding}, {@link setQueue} and the shared move, turn and
 *  remove in `editing.ts`. */
export function editBase(
  scenario: Scenario,
  id: string,
  patch: Partial<Pick<ScenarioBase, "team" | "origin" | "buildings">>,
): Scenario {
  const bases = edit<ScenarioBase>(scenario.bases, id, (base) => ({
    ...base,
    ...patch,
  }));
  return bases === scenario.bases ? scenario : { ...scenario, bases };
}

/**
 * The document with a whole base moved towards `pos`.
 *
 * The buildings keep their offsets, which is the difference between this and
 * dragging one of them: the cluster arrives with its layout intact, its first
 * building near the point that was clicked.
 *
 * Near, rather than on, because the move is in whole build squares. Every
 * building in the base stands on the grid where it was put, and the grid repeats
 * every 16 elmos, so a base shifted by anything else arrives with all of it off
 * the grid and the engine free to shuffle each building up to half a square on
 * its own. Stopping on the square is what keeps a layout a layout.
 */
export function setOrigin(
  scenario: Scenario,
  id: string,
  pos: Point,
): Scenario {
  const from = scenario.bases.find((entry) => entry.id === id)?.origin;
  if (!from) return scenario;
  const squares = (was: number, wanted: number) =>
    was + Math.round((wanted - was) / BUILD_SQUARE) * BUILD_SQUARE;
  return editBase(scenario, id, {
    origin: round({ x: squares(from.x, pos.x), z: squares(from.z, pos.z) }),
  });
}

/** The document without a base, buildings and queues and all. */
export function removeBase(scenario: Scenario, id: string): Scenario {
  const bases = scenario.bases.filter((base) => base.id !== id);
  return bases.length === scenario.bases.length
    ? scenario
    : pruneBlueprints({ ...scenario, bases });
}

/**
 * The document with one of a base's buildings gone, from both halves at once.
 *
 * The base goes with its last building, because an empty cluster is not a thing
 * an author can see or select again, and its layout goes with it.
 */
export function removeBuilding(
  scenario: Scenario,
  id: string,
  index: number,
): Scenario {
  const base = scenario.bases.find((entry) => entry.id === id);
  const layout = base
    ? scenario.blueprints.find((b) => b.id === base.blueprint)
    : undefined;
  if (!base || !layout?.buildings[index]) return scenario;
  if (layout.buildings.length === 1) return removeBase(scenario, id);

  const next = editLayout(scenario, id, (buildings) =>
    buildings.filter((_, i) => i !== index),
  );
  return editBase(next, id, {
    buildings: base.buildings.filter((_, i) => i !== index),
  });
}

/* -------------------------------------------------------------------------- *
 * Build queues. A factory in a base can be handed a list of units to build and
 * told to loop it, which the runtime issues as build orders once the base is on
 * the map.
 * -------------------------------------------------------------------------- */

/**
 * A queue and its repeat flag as they are worth writing down.
 *
 * Both fields are optional in the format and mean nothing when the queue is
 * empty, so an empty one is left out rather than stored as `[]`, and `repeat`
 * goes with it: looping a queue with nothing in it is not a thing to say about a
 * building.
 */
export function normaliseQueue(
  queue: string[],
  repeat: boolean,
): Pick<BaseBuildingRole, "queue" | "repeat"> {
  const kept = queue.filter((def) => def.trim().length > 0);
  if (kept.length === 0) return { queue: undefined, repeat: undefined };
  return { queue: kept, repeat: repeat ? true : undefined };
}

/** The document with one building's queue replaced, dropping what
 *  {@link normaliseQueue} decides is not worth storing. */
export function setQueue(
  scenario: Scenario,
  id: string,
  index: number,
  queue: string[],
  repeat: boolean,
): Scenario {
  const bases = edit<ScenarioBase>(scenario.bases, id, (base) => {
    const layout = scenario.blueprints.find((b) => b.id === base.blueprint);
    if (!layout?.buildings[index]) return base;
    const buildings = base.buildings.slice();
    while (buildings.length <= index) buildings.push({});
    buildings[index] = {
      ...buildings[index],
      ...normaliseQueue(queue, repeat),
    };
    return { ...base, buildings };
  });
  return bases === scenario.bases ? scenario : { ...scenario, bases };
}

/** One more unit on the end of a queue. A queue is a list of build orders, so
 *  the same def twice is two of it rather than a mistake to fold up. */
export function plusQueued(queue: string[], def: string): string[] {
  return def ? [...queue, def] : queue;
}

/** One unit gone from a queue. */
export function withoutQueued(queue: string[], index: number): string[] {
  if (index < 0 || index >= queue.length) return queue;
  return queue.filter((_, i) => i !== index);
}

/**
 * One unit moved `delta` places along a queue.
 *
 * The queue back when the move would go off either end, so the panel can compare
 * identities and the ends are a no-op rather than a wrap around. Order is the
 * opening build: a factory told to make a builder before a scout makes the
 * builder first (issue #844).
 */
export function movedQueued(
  queue: string[],
  index: number,
  delta: number,
): string[] {
  const to = index + delta;
  if (index < 0 || index >= queue.length || to < 0 || to >= queue.length) {
    return queue;
  }
  const out = queue.slice();
  const [def] = out.splice(index, 1);
  out.splice(to, 0, def);
  return out;
}

/* -------------------------------------------------------------------------- *
 * The game's units, as a base can use them.
 * -------------------------------------------------------------------------- */

/**
 * The units a base may be built from: the game's static ones.
 *
 * The runtime snaps a def to the build grid only when the game calls it a
 * building, so offering an author a tank here would offer them something that
 * lands off the grid and cannot be rebuilt where it stood. Mobile units belong
 * in actors and groups, which is where the editor puts them. A def the dataset
 * says nothing about is kept, because an unread dataset is not evidence.
 */
export function buildingUnits(units: UnitDatasetEntry[]): UnitDatasetEntry[] {
  return units.filter((unit) => unit.mobile !== true);
}

/**
 * The defs in a base that the game does not call buildings.
 *
 * The picker cannot put one there, but an imported or hand-edited document can,
 * and one that does is worth saying out loud rather than drawing as though it
 * were fine. Empty while the dataset is unread, so a slow read does not accuse a
 * perfectly good base.
 */
export function strayDefs(
  units: UnitDatasetEntry[],
  buildings: { def: string }[],
): string[] {
  if (units.length === 0) return [];
  const mobile = new Set(
    units.filter((unit) => unit.mobile === true).map((unit) => unit.name),
  );
  return [...new Set(buildings.map((b) => b.def).filter((d) => mobile.has(d)))];
}

/**
 * What a building can be told to build, or `null` when the game has not said.
 *
 * A queue only means anything on a factory, and a factory's own `buildoptions`
 * are what it can be asked for, so the picker offers those rather than every
 * unit in the game. `null` is "the dataset does not have this def", which is a
 * different answer from "this def builds nothing" and is shown as one: the first
 * is the editor not knowing, the second is the game saying no.
 */
export function buildableBy(
  units: UnitDatasetEntry[],
  def: string,
): UnitDatasetEntry[] | null {
  const factory = units.find((unit) => unit.name === def);
  if (!factory) return null;
  const options = new Set(factory.buildOptions ?? []);
  return units.filter((unit) => options.has(unit.name));
}
