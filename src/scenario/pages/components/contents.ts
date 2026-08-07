/**
 * What a scenario has put on its map, as a list.
 *
 * Units are drawn true to size, which is right, so a factory on a 16km map is a
 * few pixels across at the zoom the whole map is framed at and an author has to
 * hunt for their own placements (#830). This is the other way in: everything the
 * document holds, by name, in one list, so a thing is found by what it is rather
 * than by hitting the right pixel.
 *
 * Arithmetic on plain values, so it can be tested without a GPU. The panel that
 * shows it is `ContentsList.tsx`, and where the camera goes when an entry is
 * picked is `focusCamera` in `scene.ts`.
 */

import type { Point, Scenario } from "../../model";
import { parsePlacementKey } from "./editing";
import { groupSize, uniqueLabels } from "./groups";
import { placementKey } from "./placements";

/** The kinds of thing the list holds, in the order it lists them. */
export type ContentKind = "actor" | "group" | "prefab";

/** One thing the document put on the map. */
export interface ContentEntry {
  /**
   * What picking this entry selects, in the surface's one selection namespace,
   * so a pick from the list and a click on the map say the same thing.
   */
  key: string;
  kind: ContentKind;
  /** The id of the actor, group or prefab, for matching a selection back to
   *  the entry it belongs to. */
  id: string;
  label: string;
  /** What it is made of, in a few words. */
  detail: string;
  /** Where the camera goes to look at it, in elmos. */
  pos: Point;
  /** The participant it belongs to. */
  team: string;
}

/** What a group is made of, and whether it has anywhere to go. The orders are
 *  worth saying here because a group's path is the thing an author comes back
 *  to a group for (#842). */
function groupDetail(group: Scenario["groups"][number]): string {
  const size = groupSize(group);
  const units = `${size} unit${size === 1 ? "" : "s"}`;
  const orders = group.orders.length;
  return orders === 0
    ? units
    : `${units} · ${orders} order${orders === 1 ? "" : "s"}`;
}

/**
 * Everything the document places, in the order the map draws it: actors, then
 * groups, then bases.
 *
 * An actor goes by its display name when it has one, the way every other picker
 * in the editor offers one, and a group and a base by their place in the
 * document, which is the only thing telling two of the same apart.
 */
export function sceneContents(
  scenario: Pick<Scenario, "actors" | "groups" | "prefabs">,
): ContentEntry[] {
  const actorLabels = uniqueLabels(
    scenario.actors.map((actor) => actor.state?.name?.trim() || actor.unitDef),
  );
  const actors = scenario.actors.map<ContentEntry>((actor, i) => ({
    key: placementKey("actor", actor.id),
    kind: "actor",
    id: actor.id,
    label: actorLabels[i],
    detail: actor.unitDef,
    pos: actor.pos,
    team: actor.team,
  }));
  const groups = scenario.groups.map<ContentEntry>((group, i) => ({
    key: placementKey("group", group.id, 0),
    kind: "group",
    id: group.id,
    label: `Group ${i + 1}`,
    detail: groupDetail(group),
    pos: group.pos,
    team: group.team,
  }));
  const prefabs = scenario.prefabs.map<ContentEntry>((prefab, i) => ({
    key: placementKey("prefab", prefab.id, 0),
    kind: "prefab",
    id: prefab.id,
    label: `Base ${i + 1}`,
    detail: `${prefab.buildings.length} building${
      prefab.buildings.length === 1 ? "" : "s"
    }`,
    pos: prefab.origin,
    team: prefab.team,
  }));
  return [...actors, ...groups, ...prefabs];
}

/**
 * The entry the current selection belongs to, or null when the selection is
 * nothing this list holds.
 *
 * A group's fifth unit and its first are the same entry, so clicking a unit on
 * the map lights the list up the same way picking from the list does.
 */
export function contentsSelection(
  entries: ContentEntry[],
  selected: string | null,
): string | null {
  if (!selected) return null;
  const ref = parsePlacementKey(selected);
  if (!ref) return null;
  return (
    entries.find((entry) => entry.kind === ref.kind && entry.id === ref.id)
      ?.key ?? null
  );
}
