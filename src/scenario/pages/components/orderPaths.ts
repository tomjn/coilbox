/**
 * Every path the editor draws, wherever the orders that drew it live.
 *
 * A group carries orders and so does a `give_orders` action, and the trigger
 * panel edits both with the same row, so both can be given waypoints by clicking
 * the map. Only a group's were drawn, which left an author drawing a trigger's
 * path clicking blind after the first point (#847). So the layer is fed a list
 * of path sources rather than a list of groups, and a trigger's orders are one
 * more source.
 *
 * A source is named by an id the waypoint keys hang off. A group's is its own
 * id. A trigger's is where the orders sit in the document, because an action has
 * no id of its own: the trigger, which of its two lists, which step, and which
 * parameter. That is written out of indices and a parameter name, none of which
 * can hold the separators a key is read with.
 *
 * Arithmetic on plain values, so it can be tested without a GPU. The three.js
 * half is `pathsLayer.ts`.
 */

import { type ExtensionTypes, NO_EXTENSIONS } from "../../extensions";
import type {
  Point,
  Scenario,
  ScenarioOrder,
  ScenarioParam,
} from "../../model";
import type { ParamKind } from "../../triggerTypes";
import {
  moveWaypoint as moveGroupWaypoint,
  parsePathKey,
  removeWaypoint as removeGroupWaypoint,
} from "./groups";
import {
  ordersParam,
  paramOrders,
  type StepList,
  setStepParam,
  stepLabel,
  stepsOf,
  stepTypes,
} from "./triggers";

/** Orders the editor draws a path for, and where that path starts. */
export interface PathSource {
  /** What the drawn line and its waypoint keys hang off. */
  id: string;
  /** What it is called, for the bar that names a selected point. */
  label: string;
  /** Where the path starts: where a group stands, or where the group a trigger
   *  is ordering stands. Left out when nothing says, and then the line runs
   *  between the points the author drew and no further. */
  from?: Point;
  orders: ScenarioOrder[];
}

/** Where a trigger keeps orders the map draws. */
export interface OrderPathRef {
  /** Which trigger, by its place in the document. */
  trigger: number;
  list: StepList;
  /** Which step of that list. */
  step: number;
  /** Which of the step's parameters holds the orders. */
  param: string;
}

const STEP_PREFIX = "step:";

/** The id a trigger's orders parameter is keyed by. */
export function orderPathId(ref: OrderPathRef): string {
  return `${STEP_PREFIX}${ref.trigger}:${ref.list}:${ref.step}:${ref.param}`;
}

/** The orders parameter an id names, or null when the id names a group's own
 *  orders instead. */
export function parseOrderPathId(id: string): OrderPathRef | null {
  if (!id.startsWith(STEP_PREFIX)) return null;
  const [trigger, list, step, param] = id.slice(STEP_PREFIX.length).split(":");
  if (list !== "conditions" && list !== "actions") return null;
  if (!param) return null;
  const at = Number(trigger);
  const index = Number(step);
  if (!Number.isInteger(at) || at < 0) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return { trigger: at, list, step: index, param };
}

/** The parameters of a step that hold one kind of thing, as the type table
 *  declares them. A type neither coilbox nor the game has a table for holds
 *  nothing this can find, which is the same thing the trigger panel says about
 *  it. */
function paramsOfKind(
  type: string,
  list: StepList,
  kind: ParamKind,
  extensions: ExtensionTypes,
): string[] {
  const spec = stepTypes(list, extensions)[type];
  if (!spec) return [];
  return Object.entries(spec)
    .filter(([, param]) => param.kind === kind)
    .map(([name]) => name);
}

/** The group a step is ordering, which is where its path starts. */
function stepGroup(
  scenario: Scenario,
  type: string,
  list: StepList,
  params: Record<string, ScenarioParam>,
  extensions: ExtensionTypes,
): Point | undefined {
  for (const name of paramsOfKind(type, list, "groupId", extensions)) {
    const id = params[name];
    const group = scenario.groups.find((one) => one.id === id);
    if (group) return group.pos;
  }
  return undefined;
}

/**
 * Every path the map draws: a group's own orders, then the orders every trigger
 * hands out.
 *
 * A trigger's path starts where the group it is ordering stands, which is where
 * those units will be unless something else has moved them. That is a guess, but
 * it is the same guess a group's own path makes and it is the one that makes the
 * drawn line mean something.
 *
 * `extensions` is what the scenario's game declares for itself, so an action a
 * game declared carrying orders draws a line like `give_orders` does (issue
 * #957). Without them only coilbox's own tables are read, which is what a caller
 * that has not resolved the game yet has.
 */
export function scenarioPaths(
  scenario: Scenario,
  extensions: ExtensionTypes = NO_EXTENSIONS,
): PathSource[] {
  const groups = scenario.groups
    .map<PathSource>((group, i) => ({
      id: group.id,
      label: `Group ${i + 1}`,
      from: group.pos,
      orders: group.orders,
    }))
    .filter((source) => source.orders.length > 0);

  const held: PathSource[] = [];
  scenario.triggers.forEach((trigger, at) => {
    for (const list of ["conditions", "actions"] as StepList[]) {
      stepsOf(trigger, list).forEach((step, index) => {
        for (const param of paramsOfKind(
          step.type,
          list,
          "orders",
          extensions,
        )) {
          const orders = paramOrders(step.params[param]);
          if (orders.length === 0) continue;
          held.push({
            id: orderPathId({ trigger: at, list, step: index, param }),
            label: `${trigger.id} · ${stepLabel(step.type, extensions)}`,
            from: stepGroup(scenario, step.type, list, step.params, extensions),
            orders,
          });
        }
      });
    }
  });

  return [...groups, ...held];
}

/** What the path a key belongs to is called, for the bar that names a selected
 *  point. A path that has gone says so rather than showing an id. */
export function pathLabel(sources: PathSource[], id: string): string {
  return (
    sources.find((source) => source.id === id)?.label ?? "a path that is gone"
  );
}

/** The orders a path's id points at, wherever they live: a group's own, or
 *  the ones a trigger holds. Undefined when the id names neither. */
function ordersAt(
  scenario: Pick<Scenario, "groups" | "triggers">,
  id: string,
): ScenarioOrder[] | undefined {
  const held = parseOrderPathId(id);
  if (!held) return scenario.groups.find((group) => group.id === id)?.orders;
  const trigger = scenario.triggers[held.trigger];
  const step = trigger && stepsOf(trigger, held.list)[held.step];
  return step ? paramOrders(step.params[held.param]) : undefined;
}

/**
 * Where the waypoint a key names stands, read straight out of the document
 * (issue #2314).
 *
 * Not out of a `PathSource` list a caller may be holding: an edit just made to
 * the document moves a waypoint in a freshly built copy of it, and a
 * `PathSource` computed before that edit still describes the copy that came
 * before. Reading it back from the document is the only way an announcement
 * of what a move just did can be trusted, the same rule every other kind of
 * thing on the map follows.
 */
export function pathPointPosition(
  scenario: Pick<Scenario, "groups" | "triggers">,
  key: string,
): Point | null {
  const ref = parsePathKey(key);
  if (!ref) return null;
  const order = ordersAt(scenario, ref.groupId)?.[ref.order];
  if (!order || !("waypoints" in order)) return null;
  return order.waypoints[ref.waypoint] ?? null;
}

/** Apply a change to the orders a trigger holds, or hand the document back when
 *  the key names nothing it has. */
function editHeldOrders(
  scenario: Scenario,
  ref: OrderPathRef,
  update: (orders: ScenarioOrder[]) => ScenarioOrder[] | null,
): Scenario {
  const trigger = scenario.triggers[ref.trigger];
  if (!trigger) return scenario;
  const step = stepsOf(trigger, ref.list)[ref.step];
  if (!step) return scenario;
  const next = update(paramOrders(step.params[ref.param]));
  if (!next) return scenario;
  return setStepParam(
    scenario,
    { triggerId: trigger.id, list: ref.list, index: ref.step },
    ref.param,
    ordersParam(next),
  );
}

/** One order's waypoints changed, wherever they live. */
function editWaypoints(
  scenario: Scenario,
  key: string,
  update: (waypoints: Point[], at: number) => Point[] | null,
  onGroup: (scenario: Scenario, key: string) => Scenario,
): Scenario {
  const ref = parsePathKey(key);
  if (!ref) return scenario;
  const held = parseOrderPathId(ref.groupId);
  if (!held) return onGroup(scenario, key);
  return editHeldOrders(scenario, held, (orders) => {
    const order = orders[ref.order];
    if (!order || !("waypoints" in order)) return null;
    const waypoints = update(order.waypoints, ref.waypoint);
    if (!waypoints) return null;
    const out = orders.slice();
    out[ref.order] = { ...order, waypoints };
    return out;
  });
}

/** Whole elmos, exactly as a group's own waypoints are kept. */
function round(pos: Point): Point {
  return { x: Math.round(pos.x), z: Math.round(pos.z) };
}

/** The document with the waypoint this key names moved by `delta` elmos,
 *  whether it belongs to a group or to a trigger. */
export function movePathWaypoint(
  scenario: Scenario,
  key: string,
  delta: Point,
): Scenario {
  return editWaypoints(
    scenario,
    key,
    (waypoints, at) => {
      const point = waypoints[at];
      if (!point) return null;
      const out = waypoints.slice();
      out[at] = round({ x: point.x + delta.x, z: point.z + delta.z });
      return out;
    },
    (doc, one) => moveGroupWaypoint(doc, one, delta),
  );
}

/** The document without the waypoint this key names. The order is kept when its
 *  last point goes, exactly as a group's is. */
export function removePathWaypoint(scenario: Scenario, key: string): Scenario {
  return editWaypoints(
    scenario,
    key,
    (waypoints, at) =>
      waypoints[at] ? waypoints.filter((_, i) => i !== at) : null,
    removeGroupWaypoint,
  );
}
