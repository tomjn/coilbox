/**
 * Changing a scenario's skirmish setup: its map, its game and its participants.
 *
 * The setup is not just launch data. The map is the space every coordinate in the
 * document is measured in, the game is what every unit def is looked up in, and a
 * participant id is what every actor, group, prefab and `teams` entry is keyed
 * on. So each of the three costs something, and this module is the arithmetic
 * that says what, and the rewrites that pay it.
 *
 * Arithmetic on plain values, so it can be tested without a browser. The panel
 * that shows it is `SetupPanel.tsx`.
 */

import type { SkirmishDraft } from "@/play/drafts";
import {
  baseBuildings,
  type Point,
  type Scenario,
  type ScenarioOrder,
  type ScenarioParam,
  type ScenarioTeam,
  type TriggerStep,
} from "../../model";
import { ACTION_TYPES, CONDITION_TYPES } from "../../triggerTypes";

/**
 * Elmos per unit of `MapItem.width`.
 *
 * A scanned map's proportions come from the metal infomap, which is sampled once
 * per two map squares, and a square is 8 elmos. So a map's width in elmos is its
 * scanned width times sixteen, which is the same number `mapSizeLabel` divides by
 * 32 to print the map's size in the community's own units.
 */
export const ELMOS_PER_MAP_SAMPLE = 16;

/** A map's size in elmos, which is the space a scenario's points are in. */
export interface MapExtent {
  x: number;
  z: number;
}

/** A scanned map's extent, or null when the scan did not report its size. */
export function mapExtent(
  map?: { width?: number; height?: number } | null,
): MapExtent | null {
  if (!map?.width || !map.height) return null;
  return {
    x: map.width * ELMOS_PER_MAP_SAMPLE,
    z: map.height * ELMOS_PER_MAP_SAMPLE,
  };
}

/* -------------------------------------------------------------------------- *
 * The map.
 * -------------------------------------------------------------------------- */

/** The absolute map coordinates one trigger step holds, by parameter name. */
function pointParams(step: TriggerStep, table: Record<string, unknown>) {
  const spec = (
    table as Record<string, Record<string, { kind: string }> | undefined>
  )[step.type];
  if (!spec) return { points: [] as string[], orders: [] as string[] };
  const points: string[] = [];
  const orders: string[] = [];
  for (const [name, param] of Object.entries(spec)) {
    if (param.kind === "point") points.push(name);
    if (param.kind === "orders") orders.push(name);
  }
  return { points, orders };
}

const isPoint = (v: unknown): v is Point =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Point).x === "number" &&
  typeof (v as Point).z === "number";

/** An `orders` parameter's value with every waypoint moved. Read loosely: the
 *  value came out of the document as open JSON, so a malformed one is handed
 *  back untouched rather than throwing. */
function moveOrderWaypoints(
  value: ScenarioParam,
  move: (p: Point) => Point,
): ScenarioParam {
  if (!Array.isArray(value)) return value;
  return value.map((order) => {
    if (typeof order !== "object" || order === null || Array.isArray(order))
      return order;
    const record = order as Record<string, ScenarioParam>;
    if (!Array.isArray(record.waypoints)) return order;
    return {
      ...record,
      waypoints: record.waypoints.map((p) => (isPoint(p) ? move(p) : p)),
    };
  });
}

/** A step's parameters with every map coordinate in them moved. */
function moveStepPoints(
  step: TriggerStep,
  table: Record<string, unknown>,
  move: (p: Point) => Point,
): TriggerStep {
  const { points, orders } = pointParams(step, table);
  if (points.length === 0 && orders.length === 0) return step;
  const params = { ...step.params };
  for (const name of points) {
    const value = params[name];
    if (isPoint(value)) params[name] = move(value);
  }
  for (const name of orders) {
    const value = params[name];
    if (value !== undefined) params[name] = moveOrderWaypoints(value, move);
  }
  return { ...step, params };
}

/** A group order with every waypoint moved. */
function moveOrder(order: ScenarioOrder, move: (p: Point) => Point) {
  return "waypoints" in order
    ? { ...order, waypoints: order.waypoints.map(move) }
    : order;
}

/**
 * Every absolute map coordinate in the document moved by one function.
 *
 * A blueprint building's `offset` is deliberately left alone: it is measured
 * from the base's origin and describes a layout, which a building footprint
 * fixes in elmos. Moving the origin moves the base, and that is the whole of it.
 */
export function moveScenarioPoints(
  scenario: Scenario,
  move: (p: Point) => Point,
): Scenario {
  return {
    ...scenario,
    zones: scenario.zones.map((zone) =>
      zone.shape === "box"
        ? { ...zone, min: move(zone.min), max: move(zone.max) }
        : { ...zone, center: move(zone.center) },
    ),
    actors: scenario.actors.map((a) => ({ ...a, pos: move(a.pos) })),
    groups: scenario.groups.map((g) => ({
      ...g,
      pos: move(g.pos),
      orders: g.orders.map((o) => moveOrder(o, move)),
    })),
    bases: scenario.bases.map((b) => ({ ...b, origin: move(b.origin) })),
    triggers: scenario.triggers.map((t) => ({
      ...t,
      conditions: {
        ...t.conditions,
        conditions: t.conditions.conditions.map((c) =>
          moveStepPoints(c, CONDITION_TYPES, move),
        ),
      },
      actions: t.actions.map((a) => moveStepPoints(a, ACTION_TYPES, move)),
    })),
  };
}

/** Whole elmos inside the map, because a coordinate of zero is the edge the
 *  engine clamps to and a negative one is off the map entirely (issue #868). */
function insideExtent(value: number, limit: number): number {
  return Math.min(Math.max(Math.round(value), 1), Math.max(1, limit - 1));
}

/**
 * The document rescaled from one map's extent onto another's.
 *
 * Proportional in each axis, so a layout keeps its shape relative to the map it
 * was authored against: a base a quarter of the way in stays a quarter of the way
 * in. A circular zone takes the smaller of the two factors, because a circle
 * cannot become an ellipse and the smaller factor is the one that never covers
 * more of the map than it did.
 */
export function scaleScenarioToMap(
  scenario: Scenario,
  from: MapExtent,
  to: MapExtent,
): Scenario {
  const fx = to.x / from.x;
  const fz = to.z / from.z;
  const scaled = moveScenarioPoints(scenario, (p) => ({
    x: insideExtent(p.x * fx, to.x),
    z: insideExtent(p.z * fz, to.z),
  }));
  const radiusFactor = Math.min(fx, fz);
  return {
    ...scaled,
    zones: scaled.zones.map((zone) =>
      zone.shape === "circle"
        ? {
            ...zone,
            radius: Math.max(1, Math.round(zone.radius * radiusFactor)),
          }
        : zone,
    ),
  };
}

/** Every absolute map coordinate the document holds, in no particular order. */
export function scenarioPoints(scenario: Scenario): Point[] {
  const out: Point[] = [];
  moveScenarioPoints(scenario, (p) => {
    out.push(p);
    return p;
  });
  for (const base of scenario.bases) {
    for (const building of baseBuildings(scenario.blueprints, base)) {
      out.push({
        x: base.origin.x + building.offset.x,
        z: base.origin.z + building.offset.z,
      });
    }
  }
  return out;
}

/** What changing the map costs: how much of the document is pinned to a
 *  coordinate, and how much of it the new map has no room for. */
export interface MapCost {
  /** Entries that stand somewhere: zones, actors, groups and bases. */
  placed: number;
  /** Coordinates that fall outside the new map, where the engine clamps them
   *  onto the edge. Zero when the new map's size is unknown. */
  offMap: number;
}

export function mapCost(scenario: Scenario, extent: MapExtent | null): MapCost {
  const placed =
    scenario.zones.length +
    scenario.actors.length +
    scenario.groups.length +
    scenario.bases.length;
  if (!extent) return { placed, offMap: 0 };
  const offMap = scenarioPoints(scenario).filter(
    (p) => p.x <= 0 || p.z <= 0 || p.x >= extent.x || p.z >= extent.z,
  ).length;
  return { placed, offMap };
}

/** The document on a different map. Coordinates are left where they are: the
 *  caller decides whether to rescale them first. */
export function setScenarioMap(scenario: Scenario, mapName: string): Scenario {
  if (scenario.setup.mapName === mapName) return scenario;
  return { ...scenario, setup: { ...scenario.setup, mapName } };
}

/* -------------------------------------------------------------------------- *
 * The game.
 * -------------------------------------------------------------------------- */

/**
 * The document under a different game.
 *
 * Mod option values go with the old game, exactly as they do on the skirmish
 * launcher: they are keyed by a mod option the new game very likely does not
 * declare, and a stale value would be written into the start script unseen.
 * Everything the document places stays, because a unit def a game does not have
 * is something the author has to see and decide about rather than lose.
 */
export function setScenarioGame(
  scenario: Scenario,
  gameName: string,
): Scenario {
  if (scenario.setup.gameName === gameName) return scenario;
  return {
    ...scenario,
    setup: { ...scenario.setup, gameName, modOptionValues: {} },
  };
}

/* -------------------------------------------------------------------------- *
 * The participants.
 * -------------------------------------------------------------------------- */

/** What one participant holds, which is what removing it would take with it. */
export interface ParticipantHoldings {
  actors: number;
  groups: number;
  bases: number;
  /** Trigger conditions and actions that name it. */
  triggers: number;
  /** It has a `teams` entry: start units, resources, income or no commander. */
  team: boolean;
}

/** True when a participant holds nothing, so removing it costs nothing. */
export function holdsNothing(h: ParticipantHoldings): boolean {
  return (
    h.actors === 0 &&
    h.groups === 0 &&
    h.bases === 0 &&
    h.triggers === 0 &&
    !h.team
  );
}

/** The parameter names of one step that name a participant. */
function teamParams(step: TriggerStep, table: Record<string, unknown>) {
  const spec = (
    table as Record<string, Record<string, { kind: string }> | undefined>
  )[step.type];
  if (!spec) return [];
  return Object.entries(spec)
    .filter(([, param]) => param.kind === "teamId")
    .map(([name]) => name);
}

export function participantHoldings(
  scenario: Scenario,
  id: string,
): ParticipantHoldings {
  let triggers = 0;
  for (const trigger of scenario.triggers) {
    for (const step of trigger.conditions.conditions) {
      if (teamParams(step, CONDITION_TYPES).some((n) => step.params[n] === id))
        triggers++;
    }
    for (const step of trigger.actions) {
      if (teamParams(step, ACTION_TYPES).some((n) => step.params[n] === id))
        triggers++;
    }
  }
  return {
    actors: scenario.actors.filter((a) => a.team === id).length,
    groups: scenario.groups.filter((g) => g.team === id).length,
    bases: scenario.bases.filter((b) => b.team === id).length,
    triggers,
    team: id in scenario.teams,
  };
}

/** Rewrite every parameter of a step that names a participant the map renames. */
function rewriteTeamParams(
  step: TriggerStep,
  table: Record<string, unknown>,
  rename: (id: string) => string | undefined,
): TriggerStep {
  let params = step.params;
  for (const name of teamParams(step, table)) {
    const value = params[name];
    const to = typeof value === "string" ? rename(value) : undefined;
    if (to !== undefined) params = { ...params, [name]: to };
  }
  return params === step.params ? step : { ...step, params };
}

/** Every participant a trigger names put through one renaming. */
function rewriteTriggerTeams(
  scenario: Scenario,
  rename: (id: string) => string | undefined,
): Scenario {
  return {
    ...scenario,
    triggers: scenario.triggers.map((trigger) => ({
      ...trigger,
      conditions: {
        ...trigger.conditions,
        conditions: trigger.conditions.conditions.map((c) =>
          rewriteTeamParams(c, CONDITION_TYPES, rename),
        ),
      },
      actions: trigger.actions.map((a) =>
        rewriteTeamParams(a, ACTION_TYPES, rename),
      ),
    })),
  };
}

/**
 * A participant removed, and everything that named it dealt with.
 *
 * `to` names another participant to hand its actors, groups, bases and
 * triggers to. `null` deletes them instead. Either way its `teams` entry goes:
 * start units and resources belong to the participant that was removed, and
 * giving them to somebody else would silently overwrite what that participant
 * was set up with.
 *
 * The first participant is "you" and cannot be removed, exactly as the skirmish
 * launcher's own table has no remove button on that row.
 */
export function removeScenarioParticipant(
  scenario: Scenario,
  id: string,
  to: string | null,
): Scenario {
  const participants = scenario.setup.participants;
  const at = participants.findIndex((p) => p.id === id);
  if (at <= 0 || to === id) return scenario;
  if (to !== null && !participants.some((p) => p.id === to)) return scenario;

  const teams = { ...scenario.teams };
  delete teams[id];

  const next: Scenario = {
    ...scenario,
    setup: {
      ...scenario.setup,
      participants: participants.filter((p) => p.id !== id),
    },
    teams,
    actors:
      to === null
        ? scenario.actors.filter((a) => a.team !== id)
        : scenario.actors.map((a) => (a.team === id ? { ...a, team: to } : a)),
    groups:
      to === null
        ? scenario.groups.filter((g) => g.team !== id)
        : scenario.groups.map((g) => (g.team === id ? { ...g, team: to } : g)),
    bases:
      to === null
        ? scenario.bases.filter((b) => b.team !== id)
        : scenario.bases.map((b) => (b.team === id ? { ...b, team: to } : b)),
  };
  // The layouts of the bases that went with the participant stay, which is the
  // same rule deleting one base at a time follows: a layout belongs to the
  // scenario rather than to whoever happened to have it on the map (#1424).
  if (to === null) return next;
  return rewriteTriggerTeams(next, (named) => (named === id ? to : undefined));
}

/**
 * A saved skirmish preset copied in as the whole setup.
 *
 * A preset's participants are a different set of ids from the ones the document
 * is keyed on, so copying one in used to leave every actor, group, base and
 * `teams` entry pointing at somebody who no longer existed. They are handed over
 * in list order instead: the first participant's things become the preset's
 * first participant's, and so on. A participant the preset does not reach as far
 * as hands its things to the preset's first, who is the player, because
 * something has to own them.
 *
 * The setup is deep-copied the way a campaign mission snapshots one, so editing
 * the preset afterwards cannot reach into the scenario.
 */
export function applyPresetSetup(
  scenario: Scenario,
  preset: SkirmishDraft,
): Scenario {
  const setup: SkirmishDraft = structuredClone({
    participants: preset.participants,
    gameName: preset.gameName,
    mapName: preset.mapName,
    startPosType: preset.startPosType,
    modOptionValues: preset.modOptionValues,
  });
  const incoming = setup.participants;
  if (incoming.length === 0) return { ...scenario, setup };

  const rename = new Map<string, string>();
  scenario.setup.participants.forEach((p, index) => {
    rename.set(p.id, (incoming[index] ?? incoming[0]).id);
  });
  const to = (id: string) => rename.get(id);

  const teams: Record<string, ScenarioTeam> = {};
  for (const [id, team] of Object.entries(scenario.teams)) {
    const renamed = to(id);
    if (renamed !== undefined) teams[renamed] = team;
  }

  const next: Scenario = {
    ...scenario,
    setup,
    teams,
    actors: scenario.actors.map((a) => ({ ...a, team: to(a.team) ?? a.team })),
    groups: scenario.groups.map((g) => ({ ...g, team: to(g.team) ?? g.team })),
    bases: scenario.bases.map((b) => ({
      ...b,
      team: to(b.team) ?? b.team,
    })),
  };
  return rewriteTriggerTeams(next, to);
}
