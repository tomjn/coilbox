/**
 * The starting unit tracks (#1160): which units have one, what a track holds,
 * how it ends, and what a time window keeps of it.
 *
 * The lines are shaped like the ones a real run wrote for a Metal Factions
 * match of three AIs: unit ids as the engine dealt them, a position every 60
 * frames while a unit moved, a starting unit the game's script replaced, and a
 * unit that was given away.
 */
import { describe, expect, it } from "vitest";
import type { LogEvent } from "./replayAnalysisEvents";
import {
  KILLED_BY_SCRIPT_WEAPON,
  placeTrack,
  START_UNIT_KINDS,
  startUnitEnds,
  startUnitTracks,
  startUnitUpgrades,
  trackInRange,
  trackLength,
} from "./replayStartUnits";
import { WHOLE_MATCH } from "./replayTimeWindow";

const LOG: LogEvent[] = [
  {
    kind: "unit_created",
    frame: 0,
    unit: 13532,
    def: 30,
    team: 0,
    x: 600,
    y: 239,
    z: 7300,
    startUnit: true,
  },
  {
    kind: "unit_created",
    frame: 0,
    unit: 2693,
    def: 382,
    team: 1,
    x: 5500,
    y: 240,
    z: 900,
    startUnit: true,
  },
  {
    kind: "unit_created",
    frame: 40,
    unit: 29579,
    def: 91,
    team: 0,
    x: 620,
    y: 239,
    z: 7320,
    builder: 13532,
  },
  {
    kind: "start_unit_position",
    frame: 60,
    unit: 13532,
    team: 0,
    x: 650,
    z: 7250,
  },
  {
    kind: "start_unit_position",
    frame: 120,
    unit: 13532,
    team: 0,
    x: 700,
    z: 7200,
  },
  {
    kind: "start_unit_position",
    frame: 120,
    unit: 2693,
    team: 1,
    x: 5440,
    z: 960,
  },
  // Stood still from frame 120 to 600, so nothing was written between.
  {
    kind: "start_unit_position",
    frame: 660,
    unit: 13532,
    team: 0,
    x: 760,
    z: 7200,
  },
  {
    kind: "unit_given",
    frame: 900,
    unit: 2693,
    def: 382,
    team: 0,
    x: 5000,
    y: 240,
    z: 1400,
    from: 1,
    captured: true,
  },
  {
    kind: "start_unit_position",
    frame: 960,
    unit: 2693,
    team: 0,
    x: 4950,
    z: 1450,
  },
  {
    kind: "unit_destroyed",
    frame: 2559,
    unit: 13532,
    def: 30,
    team: 0,
    x: 760,
    y: 239,
    z: 7200,
    startUnit: true,
    weapon: KILLED_BY_SCRIPT_WEAPON,
  },
  // The engine hands the id out again. This is another unit, and no start unit.
  {
    kind: "unit_created",
    frame: 2600,
    unit: 13532,
    def: 44,
    team: 0,
    x: 100,
    y: 0,
    z: 100,
    builder: 29579,
  },
  {
    kind: "unit_destroyed",
    frame: 2700,
    unit: 13532,
    def: 44,
    team: 0,
    x: 120,
    y: 0,
    z: 100,
    attacker: 2693,
    attackerTeam: 1,
    weapon: 7,
  },
  {
    kind: "unit_destroyed",
    frame: 3000,
    unit: 2693,
    def: 382,
    team: 0,
    x: 4900,
    y: 240,
    z: 1500,
    startUnit: true,
    attacker: 29579,
    attackerDef: 91,
    attackerTeam: 2,
    weapon: 12,
  },
];

describe("which units have a track", () => {
  it("reads the kinds a track is built from and no others", () => {
    expect(START_UNIT_KINDS).toEqual([
      "unit_created",
      "unit_destroyed",
      "unit_given",
      "start_unit_position",
      "start_unit_replaced",
    ]);
  });

  it("makes one for each unit flagged as a starting unit, under the team that started with it", () => {
    const tracks = startUnitTracks(LOG);
    expect(tracks.map((t) => [t.unit, t.team])).toEqual([
      [13532, 0],
      [2693, 1],
    ]);
  });

  it("makes none from a log with no flag, which is what an older logger wrote", () => {
    const old = LOG.map(({ startUnit: _flag, ...rest }) => rest as LogEvent);
    expect(startUnitTracks(old)).toEqual([]);
  });

  it("does not take a flag that is not true for one", () => {
    expect(
      startUnitTracks([{ ...LOG[0], startUnit: "yes" } as LogEvent]),
    ).toEqual([]);
  });
});

describe("what a track holds", () => {
  const [first, second] = startUnitTracks(LOG);

  it("starts where the unit was created and follows each position written for it", () => {
    expect(first.points).toEqual([
      { frame: 0, x: 600, z: 7300 },
      { frame: 60, x: 650, z: 7250 },
      { frame: 120, x: 700, z: 7200 },
      { frame: 660, x: 760, z: 7200 },
      { frame: 2559, x: 760, z: 7200 },
    ]);
  });

  it("keeps a unit that changed hands under the team that started with it, and says it changed", () => {
    expect(second.team).toBe(1);
    expect(second.changedTeam).toBe(true);
    expect(first.changedTeam).toBe(false);
    expect(second.points.map((p) => p.frame)).toEqual([0, 120, 900, 960, 3000]);
  });

  it("stops at the unit's death and ignores a later unit with the same id", () => {
    expect(first.points[first.points.length - 1].frame).toBe(2559);
    expect(first.points.some((p) => p.x === 100 || p.x === 120)).toBe(false);
  });

  it("measures how far the unit went", () => {
    expect(
      trackLength([
        { frame: 0, x: 0, z: 0 },
        { frame: 60, x: 30, z: 40 },
      ]),
    ).toBe(50);
    expect(trackLength([{ frame: 0, x: 5, z: 5 }])).toBe(0);
  });
});

describe("how a track ends", () => {
  const tracks = startUnitTracks(LOG);

  it("calls a unit the game's script took away removed, and not destroyed", () => {
    expect(tracks[0].end).toEqual({
      frame: 2559,
      x: 760,
      z: 7200,
      cause: "removed",
    });
  });

  it("names the team that destroyed one", () => {
    expect(tracks[1].end).toMatchObject({
      frame: 3000,
      cause: "destroyed",
      attackerTeam: 2,
    });
  });

  it("calls a script kill with an attacker destroyed", () => {
    const [track] = startUnitTracks([
      LOG[0],
      { ...LOG[9], attackerTeam: 1 } as LogEvent,
    ]);
    expect(track.end?.cause).toBe("destroyed");
  });

  it("has no end for a unit alive when the match ended", () => {
    const [track] = startUnitTracks(LOG.slice(0, 5));
    expect(track.end).toBeNull();
    expect(startUnitEnds([track])).toEqual([]);
  });

  it("lists the ends in the order they happened, each with whose unit it was", () => {
    expect(
      startUnitEnds([...tracks].reverse()).map((e) => [
        e.unit,
        e.team,
        e.frame,
      ]),
    ).toEqual([
      [13532, 0, 2559],
      [2693, 1, 3000],
    ]);
  });
});

describe("a starting unit the game swapped for another", () => {
  const replaced: LogEvent = {
    kind: "start_unit_replaced",
    frame: 2559,
    unit: 13532,
    by: 4001,
    team: 0,
    x: 760,
    z: 7200,
  };
  const successor: LogEvent = {
    kind: "unit_created",
    frame: 2559,
    unit: 4001,
    def: 31,
    team: 0,
    x: 760,
    y: 239,
    z: 7200,
  };
  const walked: LogEvent = {
    kind: "start_unit_position",
    frame: 2640,
    unit: 4001,
    team: 0,
    x: 900,
    z: 7000,
  };
  const killed: LogEvent = {
    kind: "unit_destroyed",
    frame: 5000,
    unit: 4001,
    def: 31,
    team: 0,
    x: 950,
    y: 239,
    z: 6900,
    startUnit: true,
    attacker: 9,
    attackerTeam: 1,
    weapon: 3,
  };
  const removal = LOG.findIndex(
    (e) => e.kind === "unit_destroyed" && e.unit === 13532,
  );
  // The new unit and the replaced line first, as a game that creates before it
  // destroys writes them.
  const createFirst = [
    ...LOG.slice(0, removal),
    successor,
    replaced,
    ...LOG.slice(removal),
    walked,
    killed,
  ];
  // The old unit destroyed first, then the replaced line, then the new unit's
  // created line, which already carries the flag.
  const destroyFirst = [
    ...LOG.slice(0, removal + 1),
    replaced,
    { ...successor, startUnit: true },
    ...LOG.slice(removal + 1),
    walked,
    killed,
  ];

  it.each([
    ["created first", createFirst],
    ["destroyed first", destroyFirst],
  ])("is one track through both units, %s", (_name, log) => {
    const tracks = startUnitTracks(log);
    expect(tracks.map((t) => [t.unit, t.team])).toEqual([
      [13532, 0],
      [2693, 1],
    ]);
    const track = tracks[0];
    expect(track.upgrades).toEqual([{ frame: 2559, x: 760, z: 7200 }]);
    // The path does not stop at the swap: it runs on to the new unit's death.
    const frames = track.points.map((p) => p.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    expect(frames[frames.length - 1]).toBe(5000);
    expect(track.points.some((p) => p.frame === 2640 && p.x === 900)).toBe(
      true,
    );
    expect(track.end).toEqual({
      frame: 5000,
      x: 950,
      z: 6900,
      cause: "destroyed",
      attackerTeam: 1,
    });
  });

  it("is no loss: only the real death is an end", () => {
    const ends = startUnitEnds(startUnitTracks(createFirst));
    expect(ends.map((e) => [e.unit, e.frame, e.cause])).toEqual([
      [2693, 3000, "destroyed"],
      [13532, 5000, "destroyed"],
    ]);
  });

  it("lists the swap as an upgrade, with whose unit it was", () => {
    expect(startUnitUpgrades(startUnitTracks(createFirst))).toEqual([
      { frame: 2559, x: 760, z: 7200, unit: 13532, team: 0 },
    ]);
    expect(startUnitUpgrades(startUnitTracks(LOG))).toEqual([]);
  });

  it("is still alive in a window after the swap", () => {
    const [track] = startUnitTracks(createFirst);
    const points = trackInRange(track, { from: 3000, to: 4000 });
    expect(points).toEqual([{ frame: 2640, x: 900, z: 7000 }]);
  });

  it("does not join a unit to one the log does not say replaced it", () => {
    // The same lines with no replaced line: a removal, and no second track.
    const tracks = startUnitTracks([
      ...LOG.slice(0, removal),
      successor,
      ...LOG.slice(removal),
      walked,
    ]);
    expect(tracks[0].end?.cause).toBe("removed");
    expect(tracks[0].upgrades).toEqual([]);
    expect(tracks).toHaveLength(2);
  });

  it("ignores a replaced line for a unit that is not a starting unit, or one already dead", () => {
    const stray = { ...replaced, unit: 29579, by: 4002 };
    expect(startUnitTracks([...LOG, stray])[0].upgrades).toEqual([]);
    const late = { ...replaced, frame: 3100, unit: 2693, by: 4003 };
    const tracks = startUnitTracks([...LOG, late]);
    expect(tracks[1].end?.cause).toBe("destroyed");
    expect(tracks[1].upgrades).toEqual([]);
  });
});

describe("a track in a time window", () => {
  const [first] = startUnitTracks(LOG);

  it("is the whole track for the whole match, as the same array", () => {
    expect(trackInRange(first, WHOLE_MATCH)).toBe(first.points);
  });

  it("opens at the last position written before the window, where the unit still was", () => {
    expect(trackInRange(first, { from: 300, to: 700 })).toEqual([
      { frame: 120, x: 700, z: 7200 },
      { frame: 660, x: 760, z: 7200 },
    ]);
  });

  it("is one point for a unit that stood still through the window", () => {
    expect(trackInRange(first, { from: 200, to: 500 })).toEqual([
      { frame: 120, x: 700, z: 7200 },
    ]);
  });

  it("is empty before the unit was created and after it ended", () => {
    expect(trackInRange(first, { from: 2600, to: 9000 })).toEqual([]);
    const late = startUnitTracks([{ ...LOG[0], frame: 448 } as LogEvent])[0];
    expect(trackInRange(late, { from: 0, to: 300 })).toEqual([]);
  });

  it("keeps the death when the window holds it", () => {
    const kept = trackInRange(first, { from: 2000, to: 2559 });
    expect(kept[kept.length - 1].frame).toBe(2559);
  });
});

describe("placing a track on the map", () => {
  it("turns elmos into fractions of the map and drops a point off it", () => {
    expect(
      placeTrack(
        [
          { frame: 0, x: 1024, z: 2048 },
          { frame: 60, x: -5, z: 10 },
          { frame: 120, x: 4096, z: 0 },
        ],
        { worldWidth: 4096, worldHeight: 8192 },
      ),
    ).toEqual([
      { left: 0.25, top: 0.25 },
      { left: 1, top: 0 },
    ]);
  });
});
