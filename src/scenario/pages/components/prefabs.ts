/**
 * Prefab bases as the editor edits them: what a base is made of, where its
 * buildings sit relative to it, and what a factory in one is told to build.
 *
 * Arithmetic on plain values, so the rules can be tested without a GPU. Moving
 * and turning a single building already live in `editing.ts`, because a prefab
 * building is picked on the map the way an actor is. What is here is everything
 * that is about the base rather than about one of its buildings.
 *
 * Two things come from the runtime and are not the editor's to decide. A
 * building's `offset` is measured from the base's origin, so moving one building
 * and moving the whole base are different edits. And the runtime only puts a def
 * the game calls a building through `Spring.Pos2BuildPos`: anything else spawns
 * where it is put, off the build grid, so the picker offers buildings only and
 * {@link strayDefs} says so about a document that already names something else.
 */

import type { UnitDatasetEntry } from "@/content/bindings";
import type {
  Point,
  PrefabBuilding,
  Scenario,
  ScenarioPrefab,
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

/* -------------------------------------------------------------------------- *
 * The document. Every one of these hands the same document back when the id
 * names nothing, so a caller can compare identities to decide whether there is
 * anything to save.
 * -------------------------------------------------------------------------- */

/** The document with one more base on it. The id is passed in so the caller can
 *  select the building it just placed. */
export function addPrefab(
  scenario: Scenario,
  id: string,
  prefab: Omit<ScenarioPrefab, "id">,
): Scenario {
  return {
    ...scenario,
    prefabs: [
      ...scenario.prefabs,
      {
        ...prefab,
        id,
        origin: round(prefab.origin),
        buildings: prefab.buildings.map((b) => ({
          ...b,
          offset: round(b.offset),
        })),
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
  building: PrefabBuilding,
): Scenario {
  const prefabs = edit<ScenarioPrefab>(scenario.prefabs, id, (prefab) => ({
    ...prefab,
    buildings: [
      ...prefab.buildings,
      { ...building, offset: round(building.offset) },
    ],
  }));
  return prefabs === scenario.prefabs ? scenario : { ...scenario, prefabs };
}

/** The document with one base's own fields changed. Its buildings are edited
 *  through {@link addBuilding}, {@link setQueue} and the shared move, turn and
 *  remove in `editing.ts`. */
export function editPrefab(
  scenario: Scenario,
  id: string,
  patch: Partial<Pick<ScenarioPrefab, "team" | "origin">>,
): Scenario {
  const prefabs = edit<ScenarioPrefab>(scenario.prefabs, id, (prefab) => ({
    ...prefab,
    ...patch,
  }));
  return prefabs === scenario.prefabs ? scenario : { ...scenario, prefabs };
}

/**
 * The document with a whole base moved so its origin sits at `pos`.
 *
 * The buildings keep their offsets, which is the difference between this and
 * dragging one of them: the cluster arrives with its layout intact, its first
 * building on the point that was clicked.
 */
export function setOrigin(
  scenario: Scenario,
  id: string,
  pos: Point,
): Scenario {
  return editPrefab(scenario, id, { origin: round(pos) });
}

/** The document without a base, buildings and queues and all. */
export function removePrefab(scenario: Scenario, id: string): Scenario {
  const prefabs = scenario.prefabs.filter((prefab) => prefab.id !== id);
  return prefabs.length === scenario.prefabs.length
    ? scenario
    : { ...scenario, prefabs };
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
): Pick<PrefabBuilding, "queue" | "repeat"> {
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
  const prefabs = edit<ScenarioPrefab>(scenario.prefabs, id, (prefab) => {
    const building = prefab.buildings[index];
    if (!building) return prefab;
    const buildings = prefab.buildings.slice();
    buildings[index] = { ...building, ...normaliseQueue(queue, repeat) };
    return { ...prefab, buildings };
  });
  return prefabs === scenario.prefabs ? scenario : { ...scenario, prefabs };
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
 * A prefab is a base, and the runtime snaps a def to the build grid only when
 * the game calls it a building, so offering an author a tank here would offer
 * them something that lands off the grid and cannot be rebuilt where it stood.
 * Mobile units belong in actors and groups, which is where the editor puts them.
 * A def the dataset says nothing about is kept, because an unread dataset is not
 * evidence.
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
  buildings: PrefabBuilding[],
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
