import { describe, expect, it } from "vitest";
import type { DemoCommandRates } from "./bindings";
import { commandRows, sendersPresent } from "./commandRates";

const rates = (over: Partial<DemoCommandRates> = {}): DemoCommandRates => ({
  periodSec: 15,
  periodIsDefault: false,
  buckets: 3,
  series: [],
  pregame: 0,
  trailing: 0,
  unattributed: 0,
  lastFrame: 1400,
  incomplete: false,
  ...over,
});

describe("commands per minute rows", () => {
  it("turns a bucket's count into a rate and puts it at the bucket's end", () => {
    const { rows, ids } = commandRows(
      rates({
        series: [{ team: 0, source: "selection", counts: [15, 30, 0] }],
      }),
      [{ id: "team0", teams: [0] }],
      "selection",
    );
    expect(ids).toEqual(["team0"]);
    // 15 orders in 15 seconds is 60 a minute.
    expect(rows).toEqual([
      { timeSec: 15, team0: 60 },
      { timeSec: 30, team0: 120 },
      { timeSec: 45, team0: 0 },
    ]);
  });

  it("adds the teams a line stands for, as a side's line does", () => {
    const { rows } = commandRows(
      rates({
        series: [
          { team: 0, source: "selection", counts: [1, 0, 0] },
          { team: 1, source: "selection", counts: [2, 0, 0] },
        ],
      }),
      [{ id: "ally0", teams: [0, 1] }],
      "selection",
    );
    expect(rows[0].ally0).toBe(12);
  });

  it("keeps the senders apart", () => {
    const series = [
      { team: 0, source: "selection" as const, counts: [1, 1, 1] },
      { team: 0, source: "lua" as const, counts: [100, 100, 100] },
      { team: 4, source: "ai" as const, counts: [5, 5, 5] },
    ];
    const lines = [
      { id: "team0", teams: [0] },
      { id: "team4", teams: [4] },
    ];
    expect(commandRows(rates({ series }), lines, "selection").rows[0]).toEqual({
      timeSec: 15,
      team0: 4,
    });
    expect(commandRows(rates({ series }), lines, "lua").rows[0].team0).toBe(
      400,
    );
    // An AI's team has no line of the player's own orders.
    expect(commandRows(rates({ series }), lines, "ai").ids).toEqual(["team4"]);
  });

  it("leaves out a line that has no orders from this sender", () => {
    const { ids, rows } = commandRows(
      rates({ series: [{ team: 0, source: "lua", counts: [0, 0, 0] }] }),
      [{ id: "team0", teams: [0] }],
      "lua",
    );
    expect(ids).toEqual([]);
    expect(rows).toHaveLength(3);
  });

  it("offers only the senders that gave an order", () => {
    expect(
      sendersPresent(
        rates({
          series: [
            { team: 0, source: "selection", counts: [1] },
            { team: 0, source: "lua", counts: [0] },
          ],
        }),
      ),
    ).toEqual(["selection"]);
  });
});
