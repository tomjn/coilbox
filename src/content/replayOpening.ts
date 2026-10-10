/**
 * The opening of a match as a player's build orders collapsed into a short
 * sequence, and what those orders add up to (#1150).
 *
 * Everything here describes orders given, never buildings completed. The
 * replay does not say whether an order was carried out, and nothing here tries
 * to simulate a builder's queue.
 */

import type { BuildOrder, UnitDatasetEntry } from "./bindings";
import { resolveBuildUnit } from "./replayBuildOrders";

/** Simulation frames per second of match time. */
const FRAMES_PER_SECOND = 30;

/** One stretch of identical orders, shown as a unit and a count. */
export interface OpeningEntry {
  unitDefId: number;
  /** Units asked for: the sum of the `count` of every order in the entry. */
  count: number;
  /** How many orders were folded into the entry. */
  orders: number;
  /** The frame of the entry's first order. */
  frame: number;
  /** The first order, which says where in the queue the entry started and what
   *  gave it. */
  first: BuildOrder;
}

/**
 * Whether `next` carries on the entry that `last` ended. Orders join when they
 * ask for the same unit from the same kind of source and `next` goes to the end
 * of the queue. Anything else starts a new entry:
 *
 * - An order that replaced the queue cancelled what was queued before it for
 *   those builders, so what came earlier was not part of the same plan.
 * - An order put at the front or inserted mid-queue is out of line with its
 *   neighbours, and a later append does not continue it.
 * - An order from a widget and one from the player's own click are different
 *   things to read, even when they ask for the same unit.
 */
function continues(last: BuildOrder, next: BuildOrder): boolean {
  if (next.unitDefId !== last.unitDefId) return false;
  if (next.slot.kind !== "append") return false;
  if (last.slot.kind !== "append" && last.slot.kind !== "replace") return false;
  return next.origin.kind === last.origin.kind;
}

/** A seat's orders in the order they were given, folded into entries. */
export function collapseOrders(orders: BuildOrder[]): OpeningEntry[] {
  const entries: OpeningEntry[] = [];
  let last: BuildOrder | null = null;
  for (const order of orders) {
    const current = entries.at(-1);
    if (current && last && continues(last, order)) {
      current.count += order.count;
      current.orders += 1;
    } else {
      entries.push({
        unitDefId: order.unitDefId,
        count: order.count,
        orders: 1,
        frame: order.frame,
        first: order,
      });
    }
    last = order;
  }
  return entries;
}

/**
 * Read the "up to minute" a reader typed. Empty, or anything that is not a
 * number from zero up, means no cut.
 */
export function parseCutMinutes(text: string): number | null {
  if (text.trim() === "") return null;
  const minutes = Number(text);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

/**
 * The orders given up to and including `minutes` of match time. Orders from
 * before the game started are always inside. `null` is the whole list: the
 * opening has no default length, the reader picks one.
 */
export function ordersUpTo(
  orders: BuildOrder[],
  minutes: number | null,
): BuildOrder[] {
  if (minutes === null) return orders;
  const last = minutes * 60 * FRAMES_PER_SECOND;
  return orders.filter((o) => o.frame <= last);
}

/** What a set of orders asked for, by resource. */
export interface OrderedCost {
  metal: number;
  energy: number;
  /** Units ordered whose definition carries a cost. */
  priced: number;
  /** Units ordered with no cost to add: the unit is not in the dataset, or its
   *  definition declares neither cost. */
  unpriced: number;
}

function stat(unit: UnitDatasetEntry, key: string): number | null {
  const value = unit.stats?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The cost of what `orders` asked for: each unit's cost times the order's
 * `count`. Metal and energy stay apart, since no exchange rate between them is
 * agreed across games. An order is not a purchase, so this counts orders that
 * were cancelled or never reached. Queue removals are not orders and are not
 * passed in.
 */
export function orderedCost(
  orders: BuildOrder[],
  units: UnitDatasetEntry[] | null | undefined,
): OrderedCost {
  const total: OrderedCost = { metal: 0, energy: 0, priced: 0, unpriced: 0 };
  for (const order of orders) {
    const unit = resolveBuildUnit(order.unitDefId, units);
    const metal = unit ? stat(unit, "metalCost") : null;
    const energy = unit ? stat(unit, "energyCost") : null;
    if (metal === null && energy === null) {
      total.unpriced += order.count;
      continue;
    }
    total.metal += (metal ?? 0) * order.count;
    total.energy += (energy ?? 0) * order.count;
    total.priced += order.count;
  }
  return total;
}
