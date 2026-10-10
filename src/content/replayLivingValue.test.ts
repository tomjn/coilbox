/**
 * Living value by kind (#1174): that it is a running sum over the events the
 * log already holds, sampled on the trailer's period, with metal and energy
 * kept apart.
 */
import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import type { LogEvent } from "./replayAnalysisEvents";
import {
  LIVING_VALUE_KINDS,
  livingValue,
  peakOf,
  valueRows,
} from "./replayLivingValue";

/** Definition ids count from 1: an extractor, a tank, a turret, a factory, and
 *  a thing with no cost. */
const UNITS = [
  { name: "mex", stats: { metalCost: 50, energyCost: 500, extractsMetal: 1 } },
  {
    name: "tank",
    mobile: true,
    stats: { metalCost: 100, energyCost: 1000, weapons: [{}] },
  },
  { name: "turret", stats: { metalCost: 80, energyCost: 0, weapons: [{}] } },
  {
    name: "factory",
    buildOptions: ["tank"],
    stats: { metalCost: 600, energyCost: 2000, builder: true },
  },
  { name: "rock", stats: {} },
] as unknown as UnitDatasetEntry[];

const SEC = 30;
const ev = (kind: string, sec: number, unit: number, over: object = {}) =>
  ({
    kind,
    frame: sec * SEC,
    unit,
    team: 0,
    def: 1,
    x: 0,
    y: 0,
    z: 0,
    ...over,
  }) as LogEvent;

const LOG = [
  ev("unit_created", 1, 10, { def: 2 }),
  ev("unit_finished", 5, 11, { def: 1 }),
  ev("unit_finished", 20, 10, { def: 2 }),
  ev("unit_finished", 20, 12, { def: 3, team: 1 }),
  ev("unit_finished", 31, 13, { def: 5 }),
  ev("unit_given", 40, 10, { def: 2, team: 1, from: 0 }),
  ev("unit_destroyed", 50, 11, { def: 1 }),
  ev("unit_destroyed", 55, 99, { def: 2 }),
];

const at = (value: ReturnType<typeof livingValue>, team: number, sec: number) =>
  value.teams.get(team)?.[value.seconds.indexOf(sec)];

describe("what it reads", () => {
  it("asks for the three kinds the sum is built from", () => {
    expect(LIVING_VALUE_KINDS).toEqual([
      "unit_finished",
      "unit_destroyed",
      "unit_given",
    ]);
  });
});

describe("the samples", () => {
  const value = livingValue(LOG, UNITS, 15, 60 * SEC);

  it("fall on the period from zero to the end of the match", () => {
    expect(value.seconds).toEqual([0, 15, 30, 45, 60]);
    expect(value.teams.get(0)).toHaveLength(5);
    expect(value.teams.get(1)).toHaveLength(5);
  });

  it("count a unit from the moment it is finished, not from when it was started", () => {
    expect(at(value, 0, 0)?.economy).toEqual({ metal: 0, energy: 0 });
    expect(at(value, 0, 15)?.economy).toEqual({ metal: 50, energy: 500 });
    // The tank was started at 0:01 and finished at 0:20.
    expect(at(value, 0, 15)?.offence).toEqual({ metal: 0, energy: 0 });
    expect(at(value, 0, 30)?.offence).toEqual({ metal: 100, energy: 1000 });
  });

  it("keep metal and energy apart", () => {
    expect(at(value, 1, 30)?.defence).toEqual({ metal: 80, energy: 0 });
  });

  it("move a unit that changed hands to its new owner from that moment", () => {
    expect(at(value, 0, 45)?.offence).toEqual({ metal: 0, energy: 0 });
    expect(at(value, 1, 45)?.offence).toEqual({ metal: 100, energy: 1000 });
  });

  it("stop counting a unit when it is destroyed", () => {
    expect(at(value, 0, 45)?.economy).toEqual({ metal: 50, energy: 500 });
    expect(at(value, 0, 60)?.economy).toEqual({ metal: 0, energy: 0 });
  });

  it("ignore the death of a unit that was never finished", () => {
    expect(at(value, 0, 60)?.offence).toEqual({ metal: 0, energy: 0 });
  });

  it("count a unit with no cost as unpriced, against every finished unit", () => {
    expect(value.unpriced).toBe(1);
    expect(value.finished).toBe(4);
  });

  it("include an event on the very frame of a sample in that sample", () => {
    const onTheDot = livingValue(
      [ev("unit_finished", 15, 1, { def: 1 })],
      UNITS,
      15,
      30 * SEC,
    );
    expect(at(onTheDot, 0, 15)?.economy.metal).toBe(50);
  });

  it("have nothing to say without a period", () => {
    expect(livingValue(LOG, UNITS, 0, 60 * SEC).seconds).toEqual([]);
  });

  it("give a team first seen late a zero for every earlier sample", () => {
    const late = livingValue(
      [ev("unit_finished", 40, 1, { def: 1, team: 3 })],
      UNITS,
      15,
      60 * SEC,
    );
    expect(late.teams.get(3)?.map((s) => s.economy.metal)).toEqual([
      0, 0, 0, 50, 50,
    ]);
  });
});

describe("rows for a chart", () => {
  const value = livingValue(LOG, UNITS, 15, 60 * SEC);

  it("are one resource for one line's teams", () => {
    expect(valueRows(value, [0], "metal")[2]).toEqual({
      timeSec: 30,
      economy: 50,
      defence: 0,
      offence: 100,
      other: 0,
      unclassified: 0,
    });
    expect(valueRows(value, [0], "energy")[2].offence).toBe(1000);
  });

  it("add a side's teams together", () => {
    const row = valueRows(value, [0, 1], "metal")[2];
    expect([row.economy, row.defence, row.offence]).toEqual([50, 80, 100]);
  });

  it("give the tallest stack, for a scale every panel shares", () => {
    expect(peakOf(valueRows(value, [0, 1], "metal"))).toBe(230);
    expect(peakOf([])).toBe(0);
  });
});
