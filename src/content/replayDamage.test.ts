/**
 * The damage layer's arithmetic (#1175): reading the logger's lines, adding
 * them up on the grid, what a time window keeps, and the sums the help states.
 *
 * The first lines are the ones the logger's own upgrade match writes, in
 * `lua/replay-logger/tests/fixtures/upgrade.jsonl`, so the reader is held to
 * what the logger really produces.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHeatFieldFromCounts } from "@/lib/heatField";
import type { LogEvent } from "./replayAnalysisEvents";
import {
  DAMAGE_KINDS,
  damageGrid,
  damageInRange,
  damageLegend,
  damageLog,
  damageTotals,
  gridFits,
} from "./replayDamage";
import { WHOLE_MATCH } from "./replayTimeWindow";

const FIXTURE: LogEvent[] = readFileSync(
  "lua/replay-logger/tests/fixtures/upgrade.jsonl",
  "utf8",
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// The logger's stub map: 4096 by 2048 elmos, so 256 by 128 cells.
const WORLD = { worldWidth: 4096, worldHeight: 2048 };

describe("reading the logger's damage lines", () => {
  const log = damageLog(FIXTURE);

  it("asks for the header and the damage and nothing else", () => {
    expect(DAMAGE_KINDS).toEqual(["header", "damage"]);
  });

  it("takes the grid and the length of a stretch from the header", () => {
    expect(log.grid).toEqual({ width: 256, height: 128 });
    expect(log.frames).toBe(450);
    expect(gridFits(log, WORLD)).toBe(true);
  });

  it("will not place cells on a map of another shape", () => {
    expect(gridFits(log, { worldWidth: 4096, worldHeight: 4096 })).toBe(false);
    expect(gridFits({ ...log, grid: null }, WORLD)).toBe(false);
  });

  it("reads each line's stretch, teams and cells", () => {
    expect(log.lines).toHaveLength(4);
    expect(log.lines[1]).toEqual({
      frame: 0,
      team: 1,
      target: 0,
      at: [11064, 5.5],
      origin: [28915, 5.5],
      off: 0,
    });
    // Damage nothing dealt: no team, and nowhere it came from.
    expect(log.lines[3].team).toBeUndefined();
    expect(log.lines[3].origin).toEqual([]);
  });

  it("drops a line with no frame or target, and a list that is not pairs", () => {
    const odd = damageLog([
      { kind: "damage", team: 0, target: 1, at: [1, 2] },
      { kind: "damage", frame: 0, team: 0, at: [1, 2] },
      { kind: "damage", frame: 0, target: 1, at: [1, 2, 3], origin: "x" },
    ]);
    expect(odd.lines).toEqual([
      { frame: 0, team: undefined, target: 1, at: [], origin: [], off: 0 },
    ]);
    expect(odd.grid).toBeNull();
  });
});

describe("adding damage up on the grid", () => {
  const log = damageLog(FIXTURE);
  const size = { width: 256, height: 128 };

  it("puts what landed in the cells the units hit stood in", () => {
    const { binned, total } = damageGrid(log.lines, size, "at");
    // 20, then 30 and the 46 a 500 damage hit found left, then 4 from nothing.
    expect(binned[28915]).toBe(100);
    expect(binned[11064]).toBe(5.5);
    expect(total).toBe(105.5);
  });

  it("puts what was dealt in the cells the attackers stood in, and leaves out what nothing dealt", () => {
    const { binned, total } = damageGrid(log.lines, size, "origin");
    expect(binned[11064]).toBe(96);
    expect(binned[28915]).toBe(5.5);
    expect(total).toBe(101.5);
  });

  it("leaves out a cell that is not on the grid and an amount that is not damage", () => {
    const { total } = damageGrid(
      [
        {
          frame: 0,
          team: 0,
          target: 1,
          at: [-1, 5, 256 * 128, 5, 1.5, 5, 3, -2, 4, 9],
          origin: [],
          off: 0,
        },
      ],
      size,
      "at",
    );
    expect(total).toBe(9);
  });

  it("makes a field the heat layers can draw", () => {
    const { binned } = damageGrid(log.lines, size, "at");
    const field = buildHeatFieldFromCounts(binned, WORLD);
    expect(field.peak).toBeGreaterThan(0);
    expect(Math.round(field.peakWithinRadius ?? 0)).toBe(100);
  });
});

describe("damage in a time window", () => {
  const log = damageLog(FIXTURE);

  it("is every line for the whole match, as the same array", () => {
    expect(damageInRange(log.lines, WHOLE_MATCH)).toBe(log.lines);
  });

  it("keeps a stretch by the frame it begins on", () => {
    expect(damageInRange(log.lines, { from: 0, to: 449 })).toHaveLength(2);
    expect(damageInRange(log.lines, { from: 450, to: 900 })).toHaveLength(2);
    expect(damageInRange(log.lines, { from: 451, to: 900 })).toHaveLength(0);
  });
});

describe("what the picture leaves out", () => {
  it("adds up what landed, what nothing dealt, what a team did to itself and what was off the map", () => {
    expect(damageTotals(damageLog(FIXTURE).lines)).toEqual({
      landed: 105.5,
      unattacked: 4,
      own: 0,
      offMap: 0,
    });
    expect(
      damageTotals([
        { frame: 0, team: 2, target: 2, at: [1, 10], origin: [], off: 5 },
      ]),
    ).toEqual({ landed: 15, unattacked: 0, own: 15, offMap: 5 });
  });
});

describe("the legend", () => {
  const field = { peakWithinRadius: 1234.4, radius: 128 };

  it("names which end of the damage is drawn and states the peak", () => {
    expect(damageLegend(field, "at", false)).toEqual({
      label: "Where damage landed",
      peak: "1,234 damage landed within 128 elmos of one spot",
    });
    expect(damageLegend(field, "origin", true)).toEqual({
      label: "Where damage came from",
      peak: "1,234 damage was dealt from within 128 elmos of one spot in this window",
    });
  });
});
