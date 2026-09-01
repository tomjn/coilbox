/**
 * Minting the readable ids a trigger, an objective and a dialogue line go under,
 * so a number is never handed out twice (issue #2250).
 *
 * Deleting one of those three leaves the steps pointing at it alone, on purpose:
 * the validator reports the dangling reference rather than the editor rewriting
 * triggers nobody asked it to touch. That is only safe while the id stays gone.
 * Taking the first free number gave a deleted id straight back to the next
 * thing added, and a stale `enable_trigger` then resolved, quietly, to a trigger
 * it was never written for. The mission plays. It just arms the wrong thing.
 *
 * So the document remembers the numbers it has used. `idCounters` is a high
 * water mark per prefix, written when something is deleted, and the next id is
 * one past it. A document already on disk carries no mark and keeps every id it
 * has: the first delete writes the mark from the ids present, which is the most
 * that can be known about a document written before this existed.
 *
 * The ids stay readable rather than becoming UUIDs. `trigger-3` is what a
 * developer reads in the compiled `mission.lua` and in the path a mission
 * problem is reported at, and a hex blob in both would be a real loss for a
 * problem a counter solves. A zone, an actor, a group and a base take a UUID
 * because nothing reads those in the compiled output, which is why none of them
 * is here.
 */

import type { Scenario } from "../../model";

/** The prefix of each kind of minted id. These are the keys of `idCounters`. */
export type IdPrefix = "trigger" | "objective" | "line";

/** The entries a prefix numbers. `line` is the dialogue list, because a line is
 *  what the author reads and `dialogue-1` for one line of it would not be. */
function entries(scenario: Scenario, prefix: IdPrefix): { id: string }[] {
  if (prefix === "trigger") return scenario.triggers;
  if (prefix === "objective") return scenario.objectives;
  return scenario.dialogue;
}

/** The number in `<prefix>-<n>`, or 0 when the id is not one of those. An
 *  author's own id, `spring-ambush` say, numbers nothing and holds nothing
 *  back. */
function numberIn(id: string, prefix: IdPrefix): number {
  const head = `${prefix}-`;
  if (!id.startsWith(head)) return 0;
  const tail = id.slice(head.length);
  return /^\d+$/.test(tail) ? Number(tail) : 0;
}

/**
 * The highest number this document has used for a prefix: the mark it carries,
 * or the ids it holds, whichever is further on.
 *
 * Both, rather than the mark alone, because a document written before the mark
 * existed has none, and an imported one can carry a mark lower than its own ids.
 */
function highest(scenario: Scenario, prefix: IdPrefix): number {
  let top = scenario.idCounters?.[prefix] ?? 0;
  for (const entry of entries(scenario, prefix)) {
    top = Math.max(top, numberIn(entry.id, prefix));
  }
  return top;
}

/** The id to give the next thing of this kind. */
export function nextMintedId(scenario: Scenario, prefix: IdPrefix): string {
  return `${prefix}-${highest(scenario, prefix) + 1}`;
}

/**
 * The document remembering the numbers it is using, so deleting one does not
 * free it. Called on the way into a delete, while the entry being removed is
 * still in the list.
 *
 * The document comes back unchanged when the mark it already carries is far
 * enough on, so deleting from a document that mints nothing writes nothing.
 */
export function markIdsUsed(scenario: Scenario, prefix: IdPrefix): Scenario {
  const mark = highest(scenario, prefix);
  if ((scenario.idCounters?.[prefix] ?? 0) >= mark) return scenario;
  return {
    ...scenario,
    idCounters: { ...scenario.idCounters, [prefix]: mark },
  };
}
