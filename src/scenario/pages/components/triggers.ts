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
 * - Two triggers sharing an id is refused the same way, so a new trigger's id is
 *   minted clear of the ids already in the document.
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
import {
  amountVar,
  type Point,
  type Scenario,
  type ScenarioOrder,
  type ScenarioParam,
  type ScenarioTrigger,
  type TriggerStep,
} from "../../model";
import {
  ACTION_TYPES,
  CONDITION_TYPES,
  isUnitDefParam,
  type ParamKind,
  type ParamSpec,
  type TypeSpec,
} from "../../triggerTypes";
import { copyName } from "./duplicate";
import {
  buildingTargets,
  groupSize,
  type TargetOption,
  uniqueLabels,
} from "./groups";
import { markIdsUsed, nextMintedId } from "./ids";

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

/**
 * A stable id for a new trigger. Nothing renames it, so it is minted once here
 * and then only read.
 *
 * Readable rather than a UUID because it is the name a trigger goes under in the
 * compiled mission and in the paths the validator reports problems at, and
 * `trigger-3` is a far better thing to find in `mission.lua` than a hex blob.
 * The author's own name for it is a separate field.
 *
 * One past the highest number the document has used, deleted triggers included,
 * so a stale `enable_trigger` never finds a different trigger under the id it
 * names. See `ids.ts` for why the document has to remember that.
 */
export function nextTriggerId(scenario: Scenario): string {
  return nextMintedId(scenario, "trigger");
}

/** The document with one more trigger on the end: armed, firing once, named
 *  after its id until the author says otherwise, and waiting for the conditions
 *  and actions the panel adds next. */
export function addTrigger(scenario: Scenario, id: string): Scenario {
  const trigger: ScenarioTrigger = {
    id,
    name: id,
    enabled: true,
    repeat: false,
    conditions: { op: "all", conditions: [] },
    actions: [],
  };
  return { ...scenario, triggers: [...scenario.triggers, trigger] };
}

/**
 * A copy of a trigger, placed right after the one it came from (issue #2278).
 * The most common reason to want a second trigger is that it is nearly the
 * same as one that exists, so this is the shortcut around rebuilding it
 * condition by condition and action by action.
 *
 * `newId` is minted by the caller with {@link nextTriggerId}, the same way
 * `addTrigger` takes its id, so the panel can select the copy the moment it is
 * on screen without searching the document back for it.
 *
 * The name is suffixed with {@link copyName}, the scenario list's own way of
 * telling two copies apart, so duplicating the same trigger three times reads
 * as three distinct rows rather than "wave" repeated three times.
 *
 * Everything else is `structuredClone`d rather than spread, because a
 * trigger's conditions, actions and difficulty range are all nested objects: a
 * shallow copy would leave the copy's step list and the original's as the same
 * array, and editing a parameter on one would edit the other.
 *
 * A reference the trigger carries, `enable_trigger` naming another trigger, or
 * a condition naming a zone or an objective, is left pointing at what it
 * always pointed at. The copy is a copy of this trigger's behaviour, not a
 * copy of everything it touches, so rewriting those would change what the
 * duplicate does instead of only adding a second one that does it.
 */
export function duplicateTrigger(
  scenario: Scenario,
  id: string,
  newId: string,
): Scenario {
  const at = scenario.triggers.findIndex((t) => t.id === id);
  if (at < 0) return scenario;
  const copy: ScenarioTrigger = {
    ...structuredClone(scenario.triggers[at]),
    id: newId,
    name: copyName(
      scenario.triggers[at].name,
      scenario.triggers.map((t) => t.name),
    ),
  };
  const triggers = scenario.triggers.slice();
  triggers.splice(at + 1, 0, copy);
  return { ...scenario, triggers };
}

/** The document without a trigger. Actions naming it are left alone, exactly as
 *  deleting a zone leaves the conditions naming it alone: the validator says so
 *  rather than the editor rewriting triggers nobody asked it to touch. The id
 *  goes with it and is not handed out again, so an action left naming it stays
 *  a dangling reference the validator can report (issue #2250). */
export function removeTrigger(scenario: Scenario, id: string): Scenario {
  const marked = markIdsUsed(scenario, "trigger");
  const triggers = marked.triggers.filter((t) => t.id !== id);
  return triggers.length === marked.triggers.length
    ? scenario
    : { ...marked, triggers };
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
    // An amount holds the var it reads inside a table rather than as the
    // parameter itself, so renaming a var has to reach into one or a trigger
    // comparing against it is left pointing at a name nothing declares any
    // more (issue #808).
    if (kind === "varName") {
      for (const name of refParams(step, list, "amount", extensions)) {
        if (amountVar(params[name]) === from) {
          params = { ...params, [name]: { var: to } };
        }
      }
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
 * A trigger under a different name.
 *
 * A label and nothing more (issue #2205). `enable_trigger` points at the id, the
 * compiled mission is addressed by the id, and the id does not move, so a rename
 * rewrites nothing and leaves nothing pointing at a trigger that is gone.
 *
 * Two triggers may share a name. Nothing resolves a trigger by name any more, so
 * refusing a duplicate would be a rule with no reason behind it, and an author
 * who wants two "reinforcements" is not making a mistake. The picker tells them
 * apart the way it does for two zones with one name.
 *
 * The document comes back unchanged when the new name is empty or unchanged. An
 * empty one is refused rather than stored, because a row with no label in it
 * cannot be picked out of the list.
 */
export function renameTrigger(
  scenario: Scenario,
  id: string,
  to: string,
): Scenario {
  const wanted = to.trim();
  if (!wanted) return scenario;
  const trigger = scenario.triggers.find((t) => t.id === id);
  if (!trigger || trigger.name === wanted) return scenario;
  return editTrigger(scenario, id, { name: wanted });
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
 * Read a condition the other way round, or the right way up again
 * (issue #2422).
 *
 * The key is taken out rather than written `false` when it is off, so a
 * condition somebody turned on and off again compiles to the bytes it started
 * as, the same way `parseScenario` reads it.
 */
export function setStepNegate(
  scenario: Scenario,
  ref: StepRef,
  negate: boolean,
): Scenario {
  return editSteps(scenario, ref.triggerId, ref.list, (steps) => {
    const step = steps[ref.index];
    if (!step) return steps;
    const out = steps.slice();
    const { negate: _was, ...rest } = step;
    out[ref.index] = negate ? { ...rest, negate: true } : rest;
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
  actorId: "Needs an actor or a base",
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
    // Actors and named base buildings both, because the runtime holds them in
    // one table and a trigger naming either gets a unit back (issue #878).
    case "actorId": {
      const labels = uniqueLabels(
        scenario.actors.map((a) => a.state?.name?.trim() || a.unitDef),
      );
      return [
        ...scenario.actors.map((actor, i) => ({
          value: actor.id,
          label: labels[i],
          description: actor.unitDef,
        })),
        ...buildingTargets(scenario).map((building) => ({
          value: building.id,
          label: building.label,
          description: building.def,
        })),
      ];
    }
    case "groupId":
      return scenario.groups.map((group, i) => ({
        value: group.id,
        label: `Group ${i + 1}`,
        description: `${groupSize(group)} units`,
      }));
    // By name, with the id underneath as the value, the way a zone is picked.
    // Two triggers may share a name, so the labels are made to differ first,
    // otherwise the list offers the same word twice and neither is the one the
    // author means.
    case "triggerId": {
      const labels = uniqueLabels(scenario.triggers.map((t) => t.name));
      return scenario.triggers.map((trigger, i) => ({
        value: trigger.id,
        label: labels[i],
        description: triggerSummary(trigger),
      }));
    }
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
    // An amount opens as a plain number, because a scenario with no vars yet
    // still has to be able to add the step, and naming a var is the author
    // saying so.
    case "number":
    case "amount":
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
