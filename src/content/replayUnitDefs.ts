/**
 * The unit list a replay was read against, kept so the replay stays readable
 * when its game is updated or uninstalled (#1176).
 *
 * The store is in Rust (`demo/def_sets.rs`). This is the frontend's half: the
 * shape a list goes over in, the shape it comes back in for the code that reads
 * a unit dataset, and the check that says whether a list fits a replay at all.
 */

import type {
  BuildOrder,
  ReplayUnitDefSets,
  StoredUnitDef,
  UnitDatasetEntry,
  UnitDefLink,
} from "./bindings";

/** The numbers a stored unit keeps, under the names the dataset and the engine
 *  share. The costs are kept apart because a cost of nothing is still a cost. */
const STAT_KEYS = [
  "transportCapacity",
  "metalMake",
  "energyMake",
  "makesMetal",
  "extractsMetal",
  "windGenerator",
  "tidalGenerator",
  "metalUpkeep",
  "energyUpkeep",
  "metalStorage",
  "energyStorage",
  "radarDistance",
  "sonarDistance",
  "radarDistanceJam",
  "sonarDistanceJam",
  "seismicDistance",
] as const;

const COST_KEYS = ["metalCost", "energyCost"] as const;

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * A dataset unit as the store keeps it. What is dropped is everything the
 * replay page does not read: the model, the footprint, the weapons' own
 * numbers, which units it can build and what it turns into.
 */
export function unitToStored(unit: UnitDatasetEntry): StoredUnitDef {
  const stats = (unit.stats ?? {}) as Record<string, unknown>;
  const stored: StoredUnitDef = { name: unit.name };
  if (unit.fullName) stored.humanName = unit.fullName;
  for (const key of COST_KEYS) {
    const n = finite(stats[key]);
    if (n !== undefined) stored[key] = n;
  }
  if (unit.mobile) stored.mobile = true;
  if (stats.builder === true) stored.builder = true;
  if ((unit.buildOptions?.length ?? 0) > 0) stored.builds = true;
  if (Array.isArray(stats.weapons) && stats.weapons.length > 0) {
    stored.armed = true;
  }
  for (const key of STAT_KEYS) {
    const n = finite(stats[key]);
    if (n !== undefined) stored[key] = n;
  }
  return stored;
}

/**
 * A stored unit as the dataset entry the replay page's code reads, so one
 * classifier and one cost reader serve both.
 *
 * A stored unit says only whether it has a build menu and whether it has a
 * weapon, so `buildOptions` holds one empty name and `weapons` one empty weapon
 * when it has any. Nothing on the replay page reads past whether those lists
 * are empty. There is no model, footprint or picture here: a picture comes from
 * a game's files and is asked of an installed game by the unit's key.
 */
export function storedToUnit(def: StoredUnitDef): UnitDatasetEntry {
  const stats: Record<string, unknown> = {};
  for (const key of [...COST_KEYS, ...STAT_KEYS]) {
    const n = finite(def[key]);
    if (n !== undefined) stats[key] = n;
  }
  if (def.builder) stats.builder = true;
  if (def.armed) stats.weapons = [{}];
  return {
    name: def.name,
    ...(def.humanName ? { fullName: def.humanName } : {}),
    buildOptions: def.builds ? [""] : [],
    mobile: def.mobile === true,
    stats,
  } as UnitDatasetEntry;
}

/** A stored list a replay can be read against, with where it came from. */
export interface StoredUnitList {
  link: UnitDefLink;
  /** The units in id order, in the dataset's shape. */
  units: UnitDatasetEntry[];
}

/**
 * Which ids a reader names. A replay's own stream holds the recorded game's
 * ids. An analysis run's events hold the ids of whatever game the run used,
 * which is another version when the recorded one was not installed.
 */
export type UnitIds = "stream" | "events";

/** The stored list that names `ids` for a replay, or null when none does. */
export function storedListFor(
  sets: ReplayUnitDefSets | null | undefined,
  ids: UnitIds,
): StoredUnitList | null {
  const link = sets?.[ids];
  const stored = link ? sets?.sets[link.digest] : undefined;
  return link && stored ? { link, units: stored.map(storedToUnit) } : null;
}

/** How well a unit list fits the build orders of a replay. */
export interface OrderFit {
  /** Orders looked at. */
  orders: number;
  /** Orders whose id is past the end of the list. */
  outOfRange: number;
  /** Placed orders that name a unit that moves. */
  placedMobile: number;
  /** Factory queue orders that name a unit that does not move. */
  queuedStatic: number;
}

/**
 * Check a unit list against a replay's build orders (#3847).
 *
 * A build order holds a position when a builder was told where to put a
 * building, and none when a factory was told to make a unit. So with the right
 * list every placed order names a unit that does not move, every queue order
 * names one that does, and no id is past the end. With a list that is off by
 * one somewhere, some do not. It is the only check there is that needs nothing
 * but the replay and the list, and it is how the id numbering was first
 * confirmed: 110 of 110 orders fitted on seven Splinter Faction replays.
 *
 * It can pass on a wrong list, when the ids that moved are not ones the
 * players ordered. It cannot fail on a right one, unless a game's factories
 * make units that do not move.
 */
export function orderFit(
  orders: readonly Pick<BuildOrder, "unitDefId" | "position">[],
  units: readonly UnitDatasetEntry[],
): OrderFit {
  const fit: OrderFit = {
    orders: orders.length,
    outOfRange: 0,
    placedMobile: 0,
    queuedStatic: 0,
  };
  for (const order of orders) {
    const unit = units[order.unitDefId - 1];
    if (!unit) fit.outOfRange++;
    else if (order.position && unit.mobile) fit.placedMobile++;
    else if (!order.position && !unit.mobile) fit.queuedStatic++;
  }
  return fit;
}

/** How many orders do not fit the list. */
export function misfits(fit: OrderFit): number {
  return fit.outOfRange + fit.placedMobile + fit.queuedStatic;
}

/** A stored list's date as the page writes it. */
export function listDate(link: Pick<UnitDefLink, "takenAtMs">): string {
  return new Date(link.takenAtMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Where a stored list came from, as one short sentence for the page. The
 * engine's list says so, a packaged archive's needs no caveat, and a loose
 * folder's says the folder can change. The explanation of why that matters is
 * in the section's help, not here.
 */
export function storedListSentence(
  link: UnitDefLink,
  subject = "Unit names",
): string {
  const date = listDate(link);
  if (link.origin === "engine") {
    return `${subject} come from the unit list the engine wrote when this replay was analysed on ${date}, on ${link.game}.`;
  }
  if (link.origin === "folder") {
    return `${subject} come from the unit list recorded when this replay was read on ${date}, from ${link.game}, a loose game folder that can change under that name.`;
  }
  return `${subject} come from the unit list recorded when this replay was read on ${date}, from ${link.game}.`;
}
