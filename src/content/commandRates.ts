/**
 * Commands per minute, from the replay's order stream rather than its trailer
 * (#1149).
 *
 * The unit is one order. The engine's own APM figure, `numCommands`, is raised
 * once for each command the player gives through the selection, which is a
 * click and a widget calling `Spring.GiveOrder`, so one order is the nearest
 * thing the stream can count. Orders sent by a widget through
 * `Spring.GiveOrderToUnit` and its siblings are a different sender, and so is
 * an AI, so each is its own series and none is added to another.
 *
 * Each bucket is one statistics period of match time, the period the chart's
 * own samples are taken at, so the points sit on the chart's time axis with no
 * resampling. A bucket's count is turned into a rate for display.
 */

import type { DemoCommandRates, OrderSource } from "./bindings";
import type { ChartRow } from "./matchStats";

const SEC_PER_MINUTE = 60;

/** What each sender is called, and what it is. */
export const SENDER_LABEL: Record<OrderSource, string> = {
  selection: "Player's own",
  lua: "Widgets",
  ai: "AI",
};

export const SENDER_NOTE: Record<OrderSource, string> = {
  selection:
    "Orders the player gave through the engine's own interface, and from a widget calling Spring.GiveOrder. The engine's actions per minute counts these.",
  lua: "Orders a widget on the player's machine sent to named units. The engine's actions per minute does not count these, and a widget can send thousands a minute.",
  ai: "Orders a skirmish AI gave. This is an AI's rate and is not comparable with a person's.",
};

/** The senders that gave at least one order, in the order they are offered. */
export function sendersPresent(rates: DemoCommandRates): OrderSource[] {
  const order: OrderSource[] = ["selection", "lua", "ai"];
  return order.filter((source) =>
    rates.series.some(
      (s) => s.source === source && s.counts.some((count) => count > 0),
    ),
  );
}

/** A line the rows are built for: the chart's own id, and the engine teams it stands for. */
export interface RateLine {
  id: string;
  teams: readonly number[];
}

/**
 * One row per bucket, one value per line: the orders its teams gave in that
 * bucket, as a rate per minute. A bucket's point is at its end, which is where
 * the trailer's sample for the same stretch sits.
 *
 * A line whose teams gave no order from this sender is left out of `ids`,
 * rather than drawn flat at zero, which would claim a person played at no
 * speed when it was somebody else's series that was asked for.
 */
export function commandRows(
  rates: DemoCommandRates,
  lines: readonly RateLine[],
  source: OrderSource,
): { rows: ChartRow[]; ids: string[] } {
  const wanted = rates.series.filter((s) => s.source === source);
  const perLine = lines
    .map((line) => {
      const counts = new Array<number>(rates.buckets).fill(0);
      let any = false;
      for (const s of wanted) {
        if (!line.teams.includes(s.team)) continue;
        s.counts.forEach((c, i) => {
          counts[i] += c;
          if (c > 0) any = true;
        });
      }
      return { id: line.id, counts, any };
    })
    .filter((l) => l.any);
  const rows: ChartRow[] = [];
  for (let i = 0; i < rates.buckets; i++) {
    const row: ChartRow = { timeSec: (i + 1) * rates.periodSec };
    for (const l of perLine)
      row[l.id] = (l.counts[i] * SEC_PER_MINUTE) / rates.periodSec;
    rows.push(row);
  }
  return { rows, ids: perLine.map((l) => l.id) };
}
