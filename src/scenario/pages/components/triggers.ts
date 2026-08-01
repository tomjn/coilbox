/**
 * Triggers as the editor edits them: the list, the two step lists inside a
 * trigger, and the parameters inside a step.
 *
 * Arithmetic on plain values, so it can be tested without a browser. The panel
 * that shows it is `TriggerPanel.tsx`.
 *
 * Two rules run through everything here, and both come from the parser:
 *
 * - A required parameter that is missing or empty makes `parseScenario` refuse
 *   the whole document, so the editor must never write one. That is why a step
 *   is added with a full set of parameters, and why a type whose references
 *   cannot be filled in is offered as unavailable rather than added empty.
 * - Two triggers sharing an id is refused the same way, so renaming one checks
 *   first.
 *
 * Which parameter is which is read from `triggerTypes.ts` throughout, never from
 * a list of type names written out again here, so a type added to that table
 * arrives in the panel with no change to this file.
 */

import {
  type ExtensionTypes,
  extensionSpecs,
  NO_EXTENSIONS,
} from "../../extensions";
import type {
  Point,
  Scenario,
  ScenarioOrder,
  ScenarioParam,
  ScenarioTrigger,
  TriggerStep,
} from "../../model";
import {
  ACTION_TYPES,
  CONDITION_TYPES,
  type ParamKind,
  type ParamSpec,
  type TypeSpec,
} from "../../triggerTypes";
import { groupSize, type TargetOption, uniqueLabels } from "./groups";

/** Which of a trigger's two step lists a step sits in. */
export type StepList = "conditions" | "actions";

/** Where one condition or action sits in the document. */
export interface StepRef {
  triggerId: string;
  list: StepList;
  index: number;
}

/**
 * The type table one of the two lists is drawn from: coilbox's own, plus the
 * ones the scenario's game declares in its `missions/extensions.lua`.
 *
 * Coilbox's win a collision, though `parseExtensions` has already refused one,
 * because an engine-level type is never an extension's to redefine and the
 * palette should not be the place that rule is first noticed.
 */
export function stepTypes(
  list: StepList,
  extensions: ExtensionTypes = NO_EXTENSIONS,
): Record<string, TypeSpec> {
  const declared = extensionSpecs(
    list === "conditions" ? extensions.conditions : extensions.actions,
  );
  const own = list === "conditions" ? CONDITION_TYPES : ACTION_TYPES;
  return Object.keys(declared).length === 0 ? own : { ...declared, ...own };
}

/** What a condition or action type is called on screen. A game's own type is
 *  called what its declaration says. Coilbox's own, and one nothing declares,
 *  are read off the type name. */
export function stepLabel(
  type: string,
  extensions: ExtensionTypes = NO_EXTENSIONS,
): string {
  const declared = extensions.conditions[type] ?? extensions.actions[type];
  if (declared) return declared.label;
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Whole elmos. Points are clicked on the map, and nobody means 1023.9997. */
function round(pos: Point): Point {
  return { x: Math.round(pos.x), z: Math.round(pos.z) };
}

/* -------------------------------------------------------------------------- *
 * The trigger list.
 * -------------------------------------------------------------------------- */

/** A readable id for a new trigger. Readable rather than a UUID because a
 *  trigger's id is also its name: it is what the author reads in the list and
 *  what `enable_trigger` picks it out by. */
export function nextTriggerId(triggers: ScenarioTrigger[]): string {
  const taken = new Set(triggers.map((t) => t.id));
  for (let n = triggers.length + 1; ; n++) {
    const id = `trigger-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The document with one more trigger on the end: armed, firing once, and
 *  waiting for the conditions and actions the panel adds next. */
export function addTrigger(scenario: Scenario, id: string): Scenario {
  const trigger: ScenarioTrigger = {
    id,
    enabled: true,
    repeat: false,
    conditions: { op: "all", conditions: [] },
    actions: [],
  };
  return { ...scenario, triggers: [...scenario.triggers, trigger] };
}

/** The document without a trigger. Actions naming it are left alone, exactly as
 *  deleting a zone leaves the conditions naming it alone: the validator says so
 *  rather than the editor rewriting triggers nobody asked it to touch. */
export function removeTrigger(scenario: Scenario, id: string): Scenario {
  const triggers = scenario.triggers.filter((t) => t.id !== id);
  return triggers.length === scenario.triggers.length
    ? scenario
    : { ...scenario, triggers };
}

/** One trigger's fields changed. A cooldown that is not a wait is dropped, so
 *  clearing the box leaves the field out of the document rather than storing a
 *  zero the runtime would have to interpret. */
export function editTrigger(
  scenario: Scenario,
  id: string,
  patch: Partial<Omit<ScenarioTrigger, "id">>,
): Scenario {
  const at = scenario.triggers.findIndex((t) => t.id === id);
  if (at < 0) return scenario;
  const next: ScenarioTrigger = { ...scenario.triggers[at], ...patch };
  if (next.cooldown === undefined || !(next.cooldown > 0)) delete next.cooldown;
  const triggers = scenario.triggers.slice();
  triggers[at] = next;
  return { ...scenario, triggers };
}

/** An entry moved by `delta` places, or the list back when it cannot be. */
function moved<T>(list: T[], from: number, delta: number): T[] {
  const to = from + delta;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) {
    return list;
  }
  const out = list.slice();
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/**
 * A trigger moved up or down the list.
 *
 * Order is not cosmetic. The runtime evaluates triggers in document order within
 * one pass, so a trigger that sets a variable a later one reads has to come
 * first.
 */
export function moveTrigger(
  scenario: Scenario,
  id: string,
  delta: number,
): Scenario {
  const triggers = moved(
    scenario.triggers,
    scenario.triggers.findIndex((t) => t.id === id),
    delta,
  );
  return triggers === scenario.triggers ? scenario : { ...scenario, triggers };
}

/** The parameters of a step that hold the given reference kind. */
function refParams(
  step: TriggerStep,
  list: StepList,
  kind: ParamKind,
  extensions: ExtensionTypes,
) {
  const spec = stepTypes(list, extensions)[step.type];
  if (!spec) return [];
  return Object.entries(spec)
    .filter(([, param]) => param.kind === kind)
    .map(([name]) => name);
}

/**
 * Every parameter of one reference kind that names `from` pointed at `to`
 * instead, across every trigger in the document.
 *
 * The reference kind is what makes this general: a zone, an objective, a
 * dialogue line and a variable are all named by a parameter the type table
 * declares, so renaming any of them is this one rewrite with a different kind.
 * A reference a game extension declares is carried over too, when the caller
 * knows what the game declares.
 */
export function rewriteRefs(
  scenario: Scenario,
  kind: ParamKind,
  from: string,
  to: string,
  extensions: ExtensionTypes = NO_EXTENSIONS,
): Scenario {
  const rewrite = (list: StepList) => (step: TriggerStep) => {
    let params = step.params;
    for (const name of refParams(step, list, kind, extensions)) {
      if (params[name] === from) params = { ...params, [name]: to };
    }
    return params === step.params ? step : { ...step, params };
  };
  return {
    ...scenario,
    triggers: scenario.triggers.map((trigger) => ({
      ...trigger,
      conditions: {
        ...trigger.conditions,
        conditions: trigger.conditions.conditions.map(rewrite("conditions")),
      },
      actions: trigger.actions.map(rewrite("actions")),
    })),
  };
}

/**
 * A trigger under a different id.
 *
 * The id is the trigger's name: it is what `enable_trigger` and
 * `disable_trigger` point at, and the only thing about a trigger an author can
 * read. So renaming one rewrites every parameter that named it, found through
 * the type table rather than through the two actions that do it today, so a
 * trigger reference a game extension declares is carried over too.
 *
 * The document comes back unchanged when the new id is empty, unchanged, or
 * already taken, because two triggers sharing an id is a document the parser
 * refuses to load.
 */
export function renameTrigger(
  scenario: Scenario,
  from: string,
  to: string,
  extensions: ExtensionTypes = NO_EXTENSIONS,
): Scenario {
  const wanted = to.trim();
  if (!wanted || wanted === from) return scenario;
  if (!scenario.triggers.some((t) => t.id === from)) return scenario;
  if (scenario.triggers.some((t) => t.id === wanted)) return scenario;
  const rewritten = rewriteRefs(
    scenario,
    "triggerId",
    from,
    wanted,
    extensions,
  );
  return {
    ...rewritten,
    triggers: rewritten.triggers.map((t) =>
      t.id === from ? { ...t, id: wanted } : t,
    ),
  };
}

/* -------------------------------------------------------------------------- *
 * Conditions and actions.
 * -------------------------------------------------------------------------- */

/** The steps of one of a trigger's two lists. */
export function stepsOf(
  trigger: ScenarioTrigger,
  list: StepList,
): TriggerStep[] {
  return list === "conditions"
    ? trigger.conditions.conditions
    : trigger.actions;
}

/** The step a ref names, or null when it names none. Read loosely everywhere,
 *  so a panel still pointing at a deleted step does nothing rather than writing
 *  to whatever took its place. */
export function stepAt(scenario: Scenario, ref: StepRef): TriggerStep | null {
  const trigger = scenario.triggers.find((t) => t.id === ref.triggerId);
  return trigger ? (stepsOf(trigger, ref.list)[ref.index] ?? null) : null;
}

/** Apply a change to one of a trigger's step lists. */
function editSteps(
  scenario: Scenario,
  triggerId: string,
  list: StepList,
  update: (steps: TriggerStep[]) => TriggerStep[],
): Scenario {
  const trigger = scenario.triggers.find((t) => t.id === triggerId);
  if (!trigger) return scenario;
  const before = stepsOf(trigger, list);
  const steps = update(before);
  if (steps === before) return scenario;
  return editTrigger(
    scenario,
    triggerId,
    list === "conditions"
      ? { conditions: { ...trigger.conditions, conditions: steps } }
      : { actions: steps },
  );
}

/** The document with one more condition or action on the end of a list. */
export function addStep(
  scenario: Scenario,
  triggerId: string,
  list: StepList,
  step: TriggerStep,
): Scenario {
  return editSteps(scenario, triggerId, list, (steps) => [...steps, step]);
}

/** The document without the condition or action a ref names. */
export function removeStep(scenario: Scenario, ref: StepRef): Scenario {
  return editSteps(scenario, ref.triggerId, ref.list, (steps) =>
    steps[ref.index] ? steps.filter((_, i) => i !== ref.index) : steps,
  );
}

/** A step moved up or down its list. Actions run in list order, which is the
 *  difference between winning the mission before and after the dialogue that
 *  explains it. */
export function moveStep(
  scenario: Scenario,
  ref: StepRef,
  delta: number,
): Scenario {
  return editSteps(scenario, ref.triggerId, ref.list, (steps) =>
    moved(steps, ref.index, delta),
  );
}

/** One parameter of one step set, or taken out when the value is undefined,
 *  which is how an optional parameter is cleared. */
export function setStepParam(
  scenario: Scenario,
  ref: StepRef,
  name: string,
  value: ScenarioParam | undefined,
): Scenario {
  return editSteps(scenario, ref.triggerId, ref.list, (steps) => {
    const step = steps[ref.index];
    if (!step) return steps;
    const params = { ...step.params };
    if (value === undefined) delete params[name];
    else params[name] = value;
    const out = steps.slice();
    out[ref.index] = { ...step, params };
    return out;
  });
}

/**
 * The orders an `orders` parameter holds. A cast rather than a second
 * validation: `parseScenario` narrows the parameter with the same `parseOrders`
 * a group's own orders go through, so anything in the document is this shape
 * already.
 */
export function paramOrders(value: ScenarioParam | undefined): ScenarioOrder[] {
  return Array.isArray(value) ? (value as unknown as ScenarioOrder[]) : [];
}

/** Orders written back into a parameter. */
export function ordersParam(orders: ScenarioOrder[]): ScenarioParam {
  return orders as unknown as ScenarioParam;
}

/* -------------------------------------------------------------------------- *
 * Points, which are clicked on the map rather than typed.
 * -------------------------------------------------------------------------- */

/** What a click on the map is being asked for: a `point` parameter, or one more
 *  waypoint of one order inside an `orders` parameter. */
export interface PointTarget {
  ref: StepRef;
  param: string;
  /** Which order of an `orders` parameter, or undefined for the parameter
   *  itself. */
  order?: number;
}

/** Whether the map keeps waiting after a click. A path takes as many points as
 *  the author clicks. A single point is answered by the first one. */
export function pointRepeats(target: PointTarget): boolean {
  return target.order !== undefined;
}

/** The document with a clicked point written where it was asked for. Unchanged
 *  when the step, the order or the parameter is gone. */
export function applyPoint(
  scenario: Scenario,
  target: PointTarget,
  pos: Point,
): Scenario {
  const step = stepAt(scenario, target.ref);
  if (!step) return scenario;
  const at = round(pos);
  if (target.order === undefined) {
    return setStepParam(scenario, target.ref, target.param, at);
  }
  const orders = paramOrders(step.params[target.param]);
  const order = orders[target.order];
  if (!order || !("waypoints" in order)) return scenario;
  const next = orders.slice();
  next[target.order] = { ...order, waypoints: [...order.waypoints, at] };
  return setStepParam(scenario, target.ref, target.param, ordersParam(next));
}

/* -------------------------------------------------------------------------- *
 * The registries a reference is picked from.
 * -------------------------------------------------------------------------- */

/** What each reference kind is picked out of, in the words the picker greys a
 *  type out with. */
const NEEDS: Record<string, string> = {
  zoneId: "Needs a zone",
  actorId: "Needs an actor",
  groupId: "Needs a group",
  triggerId: "Needs a trigger",
  objectiveId: "Needs an objective",
  dialogueId: "Needs a dialogue line",
  teamId: "Needs a team",
  varName: "Needs a variable",
};

/**
 * Everything a parameter of this kind can name, by name rather than by id, or
 * null for a kind that is not a reference.
 *
 * This is what the panel is for: a zone is picked out of the zones the document
 * has, so it cannot be typed wrong and cannot name one that never existed.
 */
export function registryOptions(
  scenario: Scenario,
  kind: ParamKind,
): TargetOption[] | null {
  switch (kind) {
    case "zoneId": {
      const labels = uniqueLabels(scenario.zones.map((z) => z.name));
      return scenario.zones.map((zone, i) => ({
        value: zone.id,
        label: labels[i],
        description: zone.shape,
      }));
    }
    case "actorId": {
      const labels = uniqueLabels(
        scenario.actors.map((a) => a.state?.name?.trim() || a.unitDef),
      );
      return scenario.actors.map((actor, i) => ({
        value: actor.id,
        label: labels[i],
        description: actor.unitDef,
      }));
    }
    case "groupId":
      return scenario.groups.map((group, i) => ({
        value: group.id,
        label: `Group ${i + 1}`,
        description: `${groupSize(group)} units`,
      }));
    case "triggerId":
      return scenario.triggers.map((trigger) => ({
        value: trigger.id,
        label: trigger.id,
        description: triggerSummary(trigger),
      }));
    case "objectiveId":
      return scenario.objectives.map((objective) => ({
        value: objective.id,
        label: objective.text.trim() || objective.id,
        description: objective.kind,
      }));
    case "dialogueId":
      return scenario.dialogue.map((line) => ({
        value: line.id,
        label: line.speaker.trim() || line.id,
        description: line.text,
      }));
    case "teamId":
      return scenario.setup.participants.map((p) => ({
        value: p.id,
        label: p.name,
        description: p.spectator ? "spectator" : `ally team ${p.allyTeam}`,
      }));
    case "varName":
      return Object.keys(scenario.vars)
        .sort()
        .map((name) => ({
          value: name,
          label: name,
          description: `starts at ${scenario.vars[name]}`,
        }));
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- *
 * What a step starts as.
 * -------------------------------------------------------------------------- */

/** What the panel knows beyond the document, for filling a new step in. */
export interface StepContext {
  scenario: Scenario;
  /** The unit types the scenario's game has, for a parameter naming one. */
  unitDefs: string[];
}

/** A parameter that holds a unit type, which is picked from the game's units
 *  rather than typed. The table calls these plain strings because the runtime
 *  does, so the name is what says a unit belongs in them. */
export function isUnitDefParam(name: string): boolean {
  return name === "unitDef" || name === "unitDefs";
}

/** A full set of starting parameters, or what the type needs before it can be
 *  used at all. */
export type StepDefaults =
  | { params: Record<string, ScenarioParam>; needs?: undefined }
  | { params?: undefined; needs: string };

/** What one required parameter starts as, or null when nothing can be put
 *  there. */
function defaultParam(
  name: string,
  spec: ParamSpec,
  ctx: StepContext,
): ScenarioParam | null {
  switch (spec.kind) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "strings":
      return [];
    case "point":
      return { x: 0, z: 0 };
    case "orders":
      return [];
    case "enum":
      return spec.values?.[0] ?? null;
    case "string":
      // A required parameter cannot start empty, because an empty string is a
      // document the parser refuses to load. A unit type has a list to take the
      // first of. Anything else starts as its own name, which reads as the
      // blank it is and still loads.
      return isUnitDefParam(name) ? (ctx.unitDefs[0] ?? null) : name;
    default:
      return registryOptions(ctx.scenario, spec.kind)?.[0]?.value ?? null;
  }
}

/**
 * What a freshly added condition or action holds.
 *
 * Every required parameter is filled in, because a step with one missing makes
 * the whole document unreadable. Optional ones are left out, so the runtime
 * applies its own defaults and the panel shows them empty.
 *
 * A type whose required reference has nothing to point at comes back as `needs`
 * instead, which is what the picker greys it out with. Adding it blank is not an
 * option, because that is the document that will not load.
 */
export function stepDefaults(spec: TypeSpec, ctx: StepContext): StepDefaults {
  const params: Record<string, ScenarioParam> = {};
  for (const [name, param] of Object.entries(spec)) {
    if (param.optional) continue;
    const value = defaultParam(name, param, ctx);
    if (value === null) {
      return {
        needs:
          NEEDS[param.kind] ??
          (isUnitDefParam(name) ? "Needs the game's units" : `Needs ${name}`),
      };
    }
    params[name] = value;
  }
  return { params };
}

/** One line saying what a trigger holds, for the list and for the picker that
 *  points another trigger at it. */
export function triggerSummary(trigger: ScenarioTrigger): string {
  const conditions = trigger.conditions.conditions.length;
  const actions = trigger.actions.length;
  const when =
    conditions === 0
      ? "always"
      : conditions === 1
        ? "1 condition"
        : `${trigger.conditions.op} of ${conditions} conditions`;
  return `${when} · ${actions} action${actions === 1 ? "" : "s"}`;
}
