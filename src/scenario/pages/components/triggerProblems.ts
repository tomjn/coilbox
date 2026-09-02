/**
 * Which of a mission's problems belong to a trigger's own field, or to one
 * parameter of one of its steps, so the panel that owns the fault can say so
 * next to it rather than leaving that to the drawer alone (issue #2287).
 *
 * A dangling reference is not a typo a field can quietly absorb the way a
 * refused rename is: a zone dropdown pointed at a zone that has been deleted
 * just shows nothing picked, and nothing on the row says that is why. The
 * validator already knows, in `MissionIssue.path`, so this reads the same
 * compiled path `MissionProblemsList` reads and narrows it to the one field
 * on screen it names.
 *
 * The paths themselves are `compile.ts`'s: a trigger is `triggers["<id>"]`,
 * because `trigger()` writes the document's own id straight through, and a
 * step is `.conditions[<i>]` or `.actions[<i>]` by its position in that
 * trigger's list, because `trigger()` maps each list in order with no
 * reindexing. A parameter sits under `.params.<name>`, which also catches
 * what `validate.ts` reports underneath it: an `amount`'s `.var`, and an
 * `orders` parameter's `[n].target`.
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

/** The compiled path a trigger's own field sits at. */
function triggerPath(triggerId: string): string {
  return `triggers[${JSON.stringify(triggerId)}]`;
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
  return messagesUnder(issues, `${triggerPath(triggerId)}.${field}`);
}
