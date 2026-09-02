/**
 * Which of a mission's problems belong to a trigger's own field, to one
 * parameter of one of its steps, or to a field of an actor, a group or a base
 * the validator names by id the same way, so the panel that owns the fault
 * can say so next to it rather than leaving that to the drawer alone (issue
 * #2287, extended to actors, groups and bases by issue #2307).
 *
 * A dangling reference is not a typo a field can quietly absorb the way a
 * refused rename is: a zone dropdown pointed at a zone that has been deleted
 * just shows nothing picked, and nothing on the row says that is why. The
 * validator already knows, in `MissionIssue.path`, so this reads the same
 * compiled path `MissionProblemsList` reads and narrows it to the one field
 * on screen it names.
 *
 * The paths themselves are `compile.ts`'s: a trigger is `triggers["<id>"]`,
 * an actor is `actors["<id>"]`, a group is `groups["<id>"]` and a base is
 * `prefabs["<id>"]`, because every registry writes the document's own id
 * straight through and `at()` in `validate.ts` names each entry the same way.
 * A step is `.conditions[<i>]` or `.actions[<i>]` by its position in a
 * trigger's list, because `trigger()` maps each list in order with no
 * reindexing. A parameter sits under `.params.<name>`, which also catches
 * what `validate.ts` reports underneath it: an `amount`'s `.var`, and an
 * `orders` parameter's `[n].target`. A group's own `orders` field is checked
 * the same `checkOrders` way, directly under `groups["<id>"].orders`, with no
 * `.params` in between.
 */

import type { MissionIssue } from "../../validate";
import type { StepList, StepRef } from "./triggers";

/** Whether `path` is `prefix`, or sits under it: a doc that continues with a
 *  `.` or a `[` rather than merely sharing its first characters, so a
 *  parameter called `group` does not also claim one called `group2`. */
function underPrefix(path: string, prefix: string): boolean {
  if (path === prefix) return true;
  if (!path.startsWith(prefix)) return false;
  const next = path[prefix.length];
  return next === "." || next === "[";
}

/** Every issue's message whose path sits at or under `prefix`, joined into the
 *  one line `FieldProblem` shows. More than one issue on the same field (rare,
 *  but a parameter can fail more than one check) reads as one sentence each
 *  rather than picking one and dropping the rest. */
function messagesUnder(issues: MissionIssue[], prefix: string): string | null {
  const found = issues.filter((issue) => underPrefix(issue.path, prefix));
  return found.length === 0
    ? null
    : found.map((issue) => issue.message).join(" ");
}

/** The compiled path an entry of a registry list sits at, keyed by its own
 *  id: `actors["hero"]`, `groups["g1"]`, `prefabs["b1"]`, `triggers["open"]`.
 *  Every registry `compile.ts` writes spells it this way, because `at()` in
 *  `validate.ts` names each entry by the same id the document gave it. */
function entryPath(list: string, id: string): string {
  return `${list}[${JSON.stringify(id)}]`;
}

/** The compiled path a trigger's own field sits at. */
function triggerPath(triggerId: string): string {
  return entryPath("triggers", triggerId);
}

/** The compiled path a condition or action sits at. */
function stepPath(triggerId: string, list: StepList, index: number): string {
  return `${triggerPath(triggerId)}.${list}[${index}]`;
}

/**
 * What is wrong with one parameter of one step, in the drawer's own words but
 * without the drawer's location prefix: the field's position on the panel
 * already says which trigger, which step and which parameter this is, so
 * repeating "Trigger X, condition 1, zone" next to the zone field itself
 * would read as noise rather than an answer.
 */
export function paramProblem(
  issues: MissionIssue[],
  ref: StepRef,
  name: string,
): string | null {
  return messagesUnder(
    issues,
    `${stepPath(ref.triggerId, ref.list, ref.index)}.params.${name}`,
  );
}

/** What is wrong with one of a trigger's own fields, addressed directly rather
 *  than through one of its steps (its difficulty range is the one of these
 *  today). */
export function triggerFieldProblem(
  issues: MissionIssue[],
  triggerId: string,
  field: string,
): string | null {
  return entryFieldProblem(issues, "triggers", triggerId, field);
}

/**
 * What is wrong with one field of one entry of a registry the validator names
 * by id: an actor's, a group's or a base's own `team`, an actor's, a group's
 * or a base's own `difficulty`, or one of a group's own `orders[<i>].target`
 * (issue #2307). The same match {@link triggerFieldProblem} makes for a
 * trigger's own field, generalised to `list` so a caller names the registry
 * it is asking about: `"actors"`, `"groups"` or `"prefabs"` (the compiled
 * name a base placement takes, per `validate.ts`'s `PART` table).
 */
export function entryFieldProblem(
  issues: MissionIssue[],
  list: string,
  id: string,
  field: string,
): string | null {
  return messagesUnder(issues, `${entryPath(list, id)}.${field}`);
}

/**
 * What is wrong with a whole entry of a registry the validator names by id,
 * addressed directly rather than through one of its fields: a team with no
 * engine number, which `validateMission` reports against `teams["<id>"]`
 * itself rather than against a field within it (issue #2343).
 *
 * Matched by the entry's own path exactly, unlike {@link entryFieldProblem}'s
 * "at or under": a team whose start units also name a def the game has not
 * got is reported under `teams["<id>"].startUnits[<n>]`, and that is a
 * different question with a different answer, not a second sentence about
 * the same field.
 */
export function entryProblem(
  issues: MissionIssue[],
  list: string,
  id: string,
): string | null {
  const at = entryPath(list, id);
  const found = issues.filter((issue) => issue.path === at);
  return found.length === 0
    ? null
    : found.map((issue) => issue.message).join(" ");
}
