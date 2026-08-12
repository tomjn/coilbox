/**
 * Groups as the editor edits them: what a group is made of, what it is told to
 * do, and where the points of a waypoint order sit on the map.
 *
 * Arithmetic on plain values, so it can be tested without a GPU. The three.js
 * half, drawing an order's path on the terrain, lives in `pathsLayer.ts`.
 *
 * Two things about a group come from the runtime and are not the editor's to
 * decide. A group holds counts, not positions: the runtime lays its units out
 * around `pos`, which is why nothing here writes a position per unit. And
 * `dormant` means only "not on the map at start": a dormant group waits for a
 * `spawn_group`, and waking a group is a separate thing a trigger does, so the
 * editor never offers dormancy as if it were sleep.
 */

import {
  baseBuildings,
  type GroupUnit,
  type PlacedBuilding,
  type Point,
  type Scenario,
  type ScenarioGroup,
  type ScenarioOrder,
} from "../../model";

/** The order kinds that carry a path, and the ones that carry a target. */
export type WaypointKind = "move" | "patrol" | "fight";
export type TargetKind = "guard" | "attack";
export type OrderKind = ScenarioOrder["kind"];

/** Every order kind, in the order the picker lists them. */
export const ORDER_KINDS: OrderKind[] = [
  "move",
  "patrol",
  "fight",
  "guard",
  "attack",
];

/** How many of a unit a freshly drawn group holds, and the most one entry may
 *  count. The cap is not the engine's, it is what an author can still see as one
 *  block on the map. */
export const DEFAULT_GROUP_COUNT = 4;
export const MAX_GROUP_COUNT = 200;

/** Whole elmos. The engine takes fractions, but an author never means
 *  1023.9997. */
function round(pos: Point): Point {
  return { x: Math.round(pos.x), z: Math.round(pos.z) };
}

/** A count held to something a group can be made of. */
export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(MAX_GROUP_COUNT, Math.max(1, Math.trunc(count)));
}

/** The waypoints an order carries, or null when it is a target order. */
export function orderWaypoints(order: ScenarioOrder): Point[] | null {
  return "waypoints" in order ? order.waypoints : null;
}

/**
 * The same order under a different kind.
 *
 * A path is kept when one waypoint kind becomes another, because "patrol this
 * route rather than drive it" is the commonest change an author makes and
 * redrawing the route to say it would be daft. Everything else starts empty.
 */
export function orderOfKind(
  kind: OrderKind,
  previous?: ScenarioOrder,
): ScenarioOrder {
  if (kind === "guard" || kind === "attack") {
    const target =
      previous && !("waypoints" in previous) ? previous.target : "";
    return { kind, target };
  }
  return { kind, waypoints: previous ? (orderWaypoints(previous) ?? []) : [] };
}

/* -------------------------------------------------------------------------- *
 * Lists. The editing a control does to a group's own two lists, kept out of the
 * component so the rules are testable.
 * -------------------------------------------------------------------------- */

/** One entry's fields changed, with its count held to a sane range. */
export function withUnit(
  units: GroupUnit[],
  index: number,
  patch: Partial<GroupUnit>,
): GroupUnit[] {
  if (!units[index]) return units;
  const out = units.slice();
  const next = { ...units[index], ...patch };
  out[index] = { ...next, count: clampCount(next.count) };
  return out;
}

/** One entry gone. An empty list is allowed: the caller decides whether a group
 *  with nothing in it is deleted. */
export function withoutUnit(units: GroupUnit[], index: number): GroupUnit[] {
  if (!units[index]) return units;
  return units.filter((_, i) => i !== index);
}

/**
 * One more of a unit type.
 *
 * A def the group already holds is one more of that entry rather than a second
 * entry of the same def, so the list stays as short as the group is varied.
 */
export function plusUnit(
  units: GroupUnit[],
  def: string,
  count = 1,
): GroupUnit[] {
  if (!def) return units;
  const at = units.findIndex((entry) => entry.def === def);
  if (at < 0) return [...units, { def, count: clampCount(count) }];
  return withUnit(units, at, { count: units[at].count + clampCount(count) });
}

/** How many units a group puts on the map. */
export function groupSize(group: Pick<ScenarioGroup, "units">): number {
  return group.units.reduce((sum, entry) => sum + entry.count, 0);
}

/** One order replaced. */
export function withOrder(
  orders: ScenarioOrder[],
  index: number,
  order: ScenarioOrder,
): ScenarioOrder[] {
  if (!orders[index]) return orders;
  const out = orders.slice();
  out[index] = order;
  return out;
}

/** One order gone. */
export function withoutOrder(
  orders: ScenarioOrder[],
  index: number,
): ScenarioOrder[] {
  if (!orders[index]) return orders;
  return orders.filter((_, i) => i !== index);
}

/* -------------------------------------------------------------------------- *
 * The document. Every one of these hands the same document back when the id
 * names nothing, so a caller can compare identities to decide whether there is
 * anything to save.
 * -------------------------------------------------------------------------- */

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

/** The document with one more group on it. The id is passed in so the caller can
 *  select what it just placed. */
export function addGroup(
  scenario: Scenario,
  id: string,
  group: Omit<ScenarioGroup, "id">,
): Scenario {
  return {
    ...scenario,
    groups: [...scenario.groups, { ...group, id, pos: round(group.pos) }],
  };
}

/** The document with one group's fields changed. A patch that empties the unit
 *  list deletes the group, because a group with nothing in it draws nothing and
 *  could never be selected again. */
export function editGroup(
  scenario: Scenario,
  id: string,
  patch: Partial<Omit<ScenarioGroup, "id">>,
): Scenario {
  const groups = edit<ScenarioGroup>(scenario.groups, id, (group) => {
    const next = { ...group, ...patch };
    return next.units.length === 0 ? null : next;
  });
  return groups === scenario.groups ? scenario : { ...scenario, groups };
}

/** The document without a group. Triggers naming it are left alone, exactly as
 *  deleting a zone leaves them alone: the runtime says so at load rather than
 *  silently doing nothing, and an author who deleted the wrong group would not
 *  want their triggers rewritten. */
export function removeGroup(scenario: Scenario, id: string): Scenario {
  const groups = scenario.groups.filter((group) => group.id !== id);
  return groups.length === scenario.groups.length
    ? scenario
    : { ...scenario, groups };
}

/* -------------------------------------------------------------------------- *
 * Waypoints, which are pointed at on the map and so need a key of their own.
 * -------------------------------------------------------------------------- */

/**
 * The key a drawn waypoint is picked by.
 *
 * The same namespace as unit placements and zones, so one selection covers all
 * three, and distinct from both: `parsePlacementKey` reads nothing that starts
 * `path:`, `parseZoneKey` reads nothing that does not start `zone:`, and this
 * reads nothing that does not start `path:`.
 */
export function pathKey(
  groupId: string,
  order: number,
  waypoint: number,
): string {
  return `path:${groupId}#${order}@${waypoint}`;
}

/**
 * The key a drawn path line is picked by: what the path belongs to, and nothing
 * more.
 *
 * A group's units are a few pixels across on a big map while its path is a line
 * across half of it, so the line is the way back to the group (#842). It is the
 * same `path:` namespace as a waypoint's key and cannot be mistaken for one:
 * this carries no order and no point, so `parsePathKey` reads nothing from it.
 */
export function pathLineKey(holderId: string): string {
  return `path:${holderId}`;
}

/** What a drawn path line belongs to, or `null` when the key names something
 *  else. */
export function parsePathLineKey(key: string): string | null {
  if (!key.startsWith("path:")) return null;
  const rest = key.slice("path:".length);
  return rest && !rest.includes("#") ? rest : null;
}

export interface PathRef {
  groupId: string;
  order: number;
  waypoint: number;
}

/** The waypoint a key names, or `null` when it names none. */
export function parsePathKey(key: string): PathRef | null {
  if (!key.startsWith("path:")) return null;
  const rest = key.slice("path:".length);
  const at = rest.lastIndexOf("@");
  const hash = rest.lastIndexOf("#", at);
  if (hash <= 0 || at <= hash + 1) return null;
  const order = Number(rest.slice(hash + 1, at));
  const waypoint = Number(rest.slice(at + 1));
  if (!Number.isInteger(order) || order < 0) return null;
  if (!Number.isInteger(waypoint) || waypoint < 0) return null;
  return { groupId: rest.slice(0, hash), order, waypoint };
}

/** Apply a change to one order's waypoint list, or hand the document back when
 *  the group, the order or the point is not there. */
function editWaypoints(
  scenario: Scenario,
  groupId: string,
  index: number,
  update: (waypoints: Point[]) => Point[] | null,
): Scenario {
  const groups = edit<ScenarioGroup>(scenario.groups, groupId, (group) => {
    const order = group.orders[index];
    if (!order || !("waypoints" in order)) return group;
    const next = update(order.waypoints);
    if (!next) return group;
    const orders = group.orders.slice();
    orders[index] = { ...order, waypoints: next };
    return { ...group, orders };
  });
  return groups === scenario.groups ? scenario : { ...scenario, groups };
}

/** The document with one more point on the end of an order's path. */
export function addWaypoint(
  scenario: Scenario,
  groupId: string,
  order: number,
  pos: Point,
): Scenario {
  return editWaypoints(scenario, groupId, order, (waypoints) => [
    ...waypoints,
    round(pos),
  ]);
}

/** The document with the waypoint this key names moved by `delta` elmos. */
export function moveWaypoint(
  scenario: Scenario,
  key: string,
  delta: Point,
): Scenario {
  const ref = parsePathKey(key);
  if (!ref) return scenario;
  return editWaypoints(scenario, ref.groupId, ref.order, (waypoints) => {
    const at = waypoints[ref.waypoint];
    if (!at) return null;
    const out = waypoints.slice();
    out[ref.waypoint] = round({ x: at.x + delta.x, z: at.z + delta.z });
    return out;
  });
}

/** The document without the waypoint this key names. The order is kept even
 *  when its last point goes: an order with no path is one waiting for a path,
 *  which is what an author who cleared it meant. */
export function removeWaypoint(scenario: Scenario, key: string): Scenario {
  const ref = parsePathKey(key);
  if (!ref) return scenario;
  return editWaypoints(scenario, ref.groupId, ref.order, (waypoints) =>
    waypoints[ref.waypoint]
      ? waypoints.filter((_, i) => i !== ref.waypoint)
      : null,
  );
}

/**
 * A path cut into steps no longer than `spacing` elmos.
 *
 * A path is drawn on the terrain, and a straight line between two points a
 * kilometre apart disappears into every hill between them. Cutting it up gives
 * the layer somewhere to sample the ground. `closed` leaves out the repeat of
 * the first point, because a patrol is drawn as a loop that closes itself.
 */
export function drapePoints(
  points: Point[],
  spacing: number,
  closed = false,
): Point[] {
  if (points.length < 2) return points.slice();
  const out: Point[] = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / spacing),
    );
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      out.push({
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
      });
    }
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

/* -------------------------------------------------------------------------- *
 * Names. A guard or an attack order carries an id, which is not a thing an
 * author can read, so everything that offers one offers a name instead.
 * -------------------------------------------------------------------------- */

/** What a group is called: its place in the document, which is the only thing
 *  distinguishing two groups of the same units. */
export function groupLabel(groups: ScenarioGroup[], id: string): string {
  const at = groups.findIndex((group) => group.id === id);
  return at < 0 ? "a group that is gone" : `Group ${at + 1}`;
}

/** One thing an order can be pointed at. */
export interface TargetOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Labels made unique by numbering the repeats.
 *
 * Two actors of the same unit type carry the same name, and a picker offering
 * "armcom" twice tells an author nothing about which one they are about to
 * guard.
 */
export function uniqueLabels(labels: string[]): string[] {
  const total = new Map<string, number>();
  for (const label of labels) total.set(label, (total.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if ((total.get(label) ?? 0) < 2) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${label} ${n}`;
  });
}

/**
 * Every base building a trigger or an order can name, labelled by the base it
 * sits in. Only the buildings that carry an id: one without is part of a base
 * and nothing else, and the runtime records nothing about it.
 */
export function buildingTargets(
  scenario: Pick<Scenario, "bases" | "blueprints">,
): { id: string; label: string; def: string }[] {
  const found = scenario.bases.flatMap((base, i) =>
    baseBuildings(scenario.blueprints, base)
      .filter((building): building is PlacedBuilding & { id: string } =>
        Boolean(building.id),
      )
      .map((building) => ({
        id: building.id,
        label: `Base ${i + 1}'s ${building.def}`,
        def: building.def,
      })),
  );
  const labels = uniqueLabels(found.map((building) => building.label));
  return found.map((building, i) => ({ ...building, label: labels[i] }));
}

/**
 * Everything a guard or attack order can name: the document's actors, its named
 * base buildings and its groups, less the group doing the ordering, which
 * cannot guard itself.
 *
 * An actor goes by its display name when it has one, because a named character
 * is exactly the sort of thing a mission tells a group to escort.
 */
export function targetOptions(
  scenario: Pick<Scenario, "actors" | "groups" | "bases" | "blueprints">,
  exceptGroup?: string,
): TargetOption[] {
  const actorLabels = uniqueLabels(
    scenario.actors.map((actor) => actor.state?.name?.trim() || actor.unitDef),
  );
  const actors = scenario.actors.map((actor, i) => ({
    value: actor.id,
    label: actorLabels[i],
    description: `actor · ${actor.unitDef}`,
  }));
  const buildings = buildingTargets(scenario).map((building) => ({
    value: building.id,
    label: building.label,
    description: `building · ${building.def}`,
  }));
  const groups = scenario.groups
    .map((group, i) => ({ group, label: `Group ${i + 1}` }))
    .filter(({ group }) => group.id !== exceptGroup)
    .map(({ group, label }) => ({
      value: group.id,
      label,
      description: `group · ${groupSize(group)} units`,
    }));
  return [...actors, ...buildings, ...groups];
}

/** What an order's target is called, for showing beside an order that has one.
 *  An id naming nothing says so rather than showing a UUID. */
export function targetLabel(
  scenario: Pick<Scenario, "actors" | "groups" | "bases" | "blueprints">,
  target: string,
): string {
  if (!target) return "nothing yet";
  return (
    targetOptions(scenario).find((option) => option.value === target)?.label ??
    "something that is gone"
  );
}
