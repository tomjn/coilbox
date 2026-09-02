/**
 * Which panel, if any, owns a mission problem, from the path the validator
 * gave it (issue #2271).
 *
 * `MissionIssue.path` is `compile.ts`'s own spelling, and every registry it
 * writes opens the same way: `<list>["<id>"]`, the id being the document's own,
 * because `zone()`, `group()`, `objective()` and `trigger()` all write it
 * straight through the way `triggerProblems.ts` already leans on for
 * `triggers["<id>"]`. This is that same grammar read the other way: not "what
 * does this trigger's path say", but "which registry does this path belong to
 * at all, and so which panel is it for".
 *
 * A trigger, an objective and a variable are opened by a panel of their own,
 * so the caller is left an id to select there. An actor, a group, a base and a
 * zone have no panel: they live on the map, and the key returned for one is the
 * same selection key `sceneContents` hands `ContentsList`, so asking the map to
 * open it is asking it to do what a Contents pick already does.
 *
 * A path this does not recognise, `"mission"` itself, a dialogue line, a team,
 * names something with no single row to click through to, and the caller
 * leaves it as plain text.
 */

import { placementKey } from "@/placement/placements";
import { zoneKey } from "./zones";

export type ProblemTarget =
  | { kind: "trigger"; triggerId: string }
  | { kind: "objective"; id: string }
  | { kind: "variable"; name: string }
  | { kind: "map"; key: string };

/**
 * A request to a panel, or the map, to open and land on one specific row: the
 * row's own id in whatever namespace that panel already selects by (a
 * trigger's id, an objective's id, a variable's name, a placement's selection
 * key). `token` changes on every request, including a repeat of the same id, so
 * clicking the same problem row twice still scrolls and focuses the second
 * time rather than being a no-op because the id did not change.
 */
export interface RowFocus {
  id: string;
  token: number;
}

/** A compiled path's leading `<list>["<id>"]`, the one shape every registry
 *  `compile.ts` writes an id into. */
const HEAD = /^([A-Za-z_][A-Za-z0-9_]*)\["((?:[^"\\]|\\.)*)"\]/;

/** Where `path` points, or `null` when nothing on screen owns it. */
export function problemTarget(path: string): ProblemTarget | null {
  const match = HEAD.exec(path);
  if (!match) return null;
  const [, list, quoted] = match;
  let id: string;
  try {
    id = JSON.parse(`"${quoted}"`);
  } catch {
    return null;
  }
  switch (list) {
    case "triggers":
      return { kind: "trigger", triggerId: id };
    case "objectives":
      return { kind: "objective", id };
    case "vars":
      return { kind: "variable", name: id };
    case "zones":
      return { kind: "map", key: zoneKey(id) };
    case "actors":
      return { kind: "map", key: placementKey("actor", id) };
    case "groups":
      return { kind: "map", key: placementKey("group", id, 0) };
    // The compiled mission spells a base "prefabs", the key `at()` in
    // validate.ts writes it under and the one `PART` there shows as "Base".
    case "prefabs":
      return { kind: "map", key: placementKey("base", id, 0) };
    default:
      return null;
  }
}
