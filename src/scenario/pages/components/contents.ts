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

import { parsePlacementKey, placementKey } from "@/placement/placements";
import {
  baseBuildings,
  type PlacedBuilding,
  type Point,
  type Scenario,
} from "../../model";
import { baseLabels, groupSize, parsePathKey, uniqueLabels } from "./groups";
import { GROUP_SPACING } from "./placements";
import { parseZoneKey, zoneCenter, zoneExtent, zoneKey } from "./zones";

/** The kinds of thing the list holds, in the order it lists them. */
export type ContentKind = "actor" | "group" | "base" | "zone";

/** One thing the document put on the map. */
export interface ContentEntry {
  /**
   * What picking this entry selects, in the surface's one selection namespace,
   * so a pick from the list and a click on the map say the same thing.
   */
  key: string;
  kind: ContentKind;
  /** The id of the actor, group or base, for matching a selection back to
   *  the entry it belongs to. */
  id: string;
  label: string;
  /** What it is made of, in a few words. */
  detail: string;
  /** Where the camera goes to look at it, in elmos. */
  pos: Point;
  /** How far it reaches from `pos`, in elmos, so the camera can stand back far
   *  enough to show all of it. A zone is kilometres across. */
  span: number;
  /** The participant it belongs to, or null for a zone, which is a piece of
   *  ground and belongs to nobody. */
  team: string | null;
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

/** How far a group's formation reaches from its point, in elmos. The runtime
 *  lays its counts out in a square-ish grid, which is what the editor draws. */
function groupSpan(group: Scenario["groups"][number]): number {
  const side = Math.ceil(Math.sqrt(Math.max(1, groupSize(group))));
  return ((side - 1) / 2) * GROUP_SPACING;
}

/** How far a base's buildings reach from its origin, in elmos. */
function baseSpan(buildings: PlacedBuilding[]): number {
  return buildings.reduce(
    (far, building) =>
      Math.max(far, Math.abs(building.offset.x), Math.abs(building.offset.z)),
    0,
  );
}

/**
 * Everything the document puts on the map, in the order the map draws it:
 * actors, then groups, then bases, then zones.
 *
 * An actor goes by its display name when it has one, the way every other picker
 * in the editor offers one, and a group by its place in the document, which is
 * the only thing telling two of the same apart. A base goes by the layout it
 * places (issue #1423), numbered only when two bases place the same one. A
 * zone goes by the name it was given, which is what a trigger names it by.
 *
 * Zones are here for a reason of their own. A click picks whichever zone's sheet
 * the ray reaches first, which is decided by how the sheets drape, so a zone
 * drawn inside another can be impossible to select by clicking at all (#911).
 * Picking it out of a list does not depend on hitting the right pixel.
 */
export function sceneContents(
  scenario: Pick<
    Scenario,
    "actors" | "groups" | "bases" | "blueprints" | "zones"
  >,
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
    span: 0,
    team: actor.team,
  }));
  const groups = scenario.groups.map<ContentEntry>((group, i) => ({
    key: placementKey("group", group.id, 0),
    kind: "group",
    id: group.id,
    label: `Group ${i + 1}`,
    detail: groupDetail(group),
    pos: group.pos,
    span: groupSpan(group),
    team: group.team,
  }));
  const baseNames = baseLabels(scenario.blueprints, scenario.bases);
  const bases = scenario.bases.map<ContentEntry>((base, i) => {
    const buildings = baseBuildings(scenario.blueprints, base);
    return {
      key: placementKey("base", base.id, 0),
      kind: "base",
      id: base.id,
      label: baseNames[i],
      detail: `${buildings.length} building${buildings.length === 1 ? "" : "s"}`,
      pos: base.origin,
      span: baseSpan(buildings),
      team: base.team,
    };
  });
  const zoneLabels = uniqueLabels(scenario.zones.map((zone) => zone.name));
  const zones = scenario.zones.map<ContentEntry>((zone, i) => ({
    key: zoneKey(zone.id),
    kind: "zone",
    id: zone.id,
    label: zoneLabels[i],
    detail: zone.shape,
    pos: zoneCenter(zone),
    span: Math.max(...Object.values(zoneExtent(zone))),
    team: null,
  }));
  return [...actors, ...groups, ...bases, ...zones];
}

/** A layout the scenario holds that no base is placed from. */
export interface LayoutEntry {
  /** The `blueprints` id, which is what deleting it names. */
  id: string;
  name: string;
  /** What it is made of, in a few words. */
  detail: string;
  /** Nothing in it, so there is no base to place from it (issue #1450). A base
   *  with no buildings draws nothing and can never be selected again. */
  empty: boolean;
}

/**
 * The layouts this scenario is carrying and not currently placing (issue #1424).
 *
 * A scenario keeps a layout after the last base placed from it goes, so an
 * author who deletes a base while they rethink where it stands still has the
 * geometry to put back. Kept means findable: without this the layout is in the
 * document and nowhere on screen, which is worse than losing it, so the list of
 * what a scenario holds carries these underneath what is on the map.
 *
 * Findable also means usable. A row is where an author puts one back on the map
 * (issue #1450), which is what `empty` is for.
 */
export function unplacedLayouts(
  scenario: Pick<Scenario, "blueprints" | "bases">,
): LayoutEntry[] {
  const placed = new Set(scenario.bases.map((base) => base.blueprint));
  return scenario.blueprints
    .filter((layout) => !placed.has(layout.id))
    .map((layout) => {
      const count = layout.buildings.length;
      return {
        id: layout.id,
        name: layout.name,
        detail: `${count} building${count === 1 ? "" : "s"}${
          layout.ordered ? " · build order" : ""
        }`,
        empty: count === 0,
      };
    });
}

/**
 * The entry the current selection belongs to, or null when the selection is
 * nothing this list holds.
 *
 * A group's fifth unit and its first are the same entry, and so is a point on
 * one of its paths, so working on a group any of the three ways lights the list
 * up the same way picking from the list does.
 */
export function contentsSelection(
  entries: ContentEntry[],
  selected: string | null,
): string | null {
  if (!selected) return null;
  const ref = parsePlacementKey(selected);
  if (ref)
    return (
      entries.find((entry) => entry.kind === ref.kind && entry.id === ref.id)
        ?.key ?? null
    );
  const path = parsePathKey(selected);
  if (path)
    return (
      entries.find(
        (entry) => entry.kind === "group" && entry.id === path.groupId,
      )?.key ?? null
    );
  // A zone key names either the zone or one of its handles, and both mean the
  // same zone is what is being worked on.
  const zone = parseZoneKey(selected);
  if (zone)
    return (
      entries.find((entry) => entry.kind === "zone" && entry.id === zone.id)
        ?.key ?? null
    );
  return null;
}
