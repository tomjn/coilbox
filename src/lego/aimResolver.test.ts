import { describe, expect, it } from "vitest";

import {
  type AimContext,
  aimDirection,
  aimsOf,
  aimWeaponAngles,
  expandForWeapons,
  resolveScenario,
  startBuildingAngles,
  type WorldContext,
  weaponCount,
  withWorld,
  worldAt,
} from "./aimResolver";
import {
  type Scenario,
  type ScriptEvent,
  STAND_IN_UNIT_ID,
  type StandInTrack,
} from "./scriptPlayback";
import { standInHeight } from "./standIn";

/**
 * The unit's own axes in the editor: `+z` front, `+y` up, `+x` its left. Pinned
 * by the headless engine run on issue #565 and recorded in `buildPlate.ts`.
 *
 * Everything below is checked against the engine's formula rather than against
 * a number somebody once read off a run, because a recorded output cannot tell
 * a sign error from a convention.
 */
const LEFT: [number, number, number] = [10, 0, 0];
const RIGHT: [number, number, number] = [-10, 0, 0];
const FRONT: [number, number, number] = [0, 0, 10];
const ORIGIN: [number, number, number] = [0, 0, 0];

describe("aimWeaponAngles", () => {
  /**
   * `rts/Sim/Weapons/Weapon.cpp:410-424`:
   *
   *   heading = GetHeadingFromVectorF(dir·rightdir, dir·frontdir)
   *   script->AimWeapon(n, ClampRadPi(-heading), asin(dir·updir))
   *
   * `rightdir` is `(-1,0,0)` for a unit at heading zero
   * (`rts/Sim/Objects/SolidObject.cpp:440`), so a target at `+x` gives
   * `dir·rightdir = -1`, a heading of `-PI/2`, and `+PI/2` after the negation.
   */
  it("is positive for a target to the unit's left", () => {
    expect(aimWeaponAngles(ORIGIN, LEFT).heading).toBeCloseTo(Math.PI / 2);
  });

  it("is negative for a target to the unit's right", () => {
    expect(aimWeaponAngles(ORIGIN, RIGHT).heading).toBeCloseTo(-Math.PI / 2);
  });

  it("is zero straight ahead", () => {
    expect(aimWeaponAngles(ORIGIN, FRONT).heading).toBeCloseTo(0);
  });

  /** `pitch = asin(dir · updir)`, so above the aim piece is positive. */
  it("pitches up for a target above the aim piece", () => {
    expect(aimWeaponAngles(ORIGIN, [0, 10, 10]).pitch).toBeCloseTo(Math.PI / 4);
  });

  it("pitches down for one below it", () => {
    expect(aimWeaponAngles(ORIGIN, [0, -10, 10]).pitch).toBeCloseTo(
      -Math.PI / 4,
    );
  });

  /** The aim is measured from the piece, not from the unit's origin: a turret
   *  high on the hull looks down at something the hull would look level at. */
  it("measures from the piece it is given", () => {
    expect(aimWeaponAngles([0, 10, 0], FRONT).pitch).toBeCloseTo(-Math.PI / 4);
  });
});

describe("startBuildingAngles", () => {
  /**
   * `rts/Sim/Units/UnitTypes/Builder.cpp:942-955`:
   *
   *   h = GetHeadingFromVectorF(dir.x, dir.z)
   *   script->StartBuilding(ClampRadPi(h - heading*TAANG2RAD), p - pitch)
   *
   * No projection onto `rightdir` and no negation, so `h` is `atan2(x, z)`
   * directly. The unit's own heading is zero in the editor, and `pitch` is
   * `asin(frontdir·updir)`, which is zero on flat ground. Both conventions
   * still agree: a target at `+x` is to the unit's left and gives `+PI/2`.
   */
  it("is positive for a target to the unit's left", () => {
    expect(startBuildingAngles(ORIGIN, LEFT).heading).toBeCloseTo(Math.PI / 2);
  });

  it("is negative for a target to the unit's right", () => {
    expect(startBuildingAngles(ORIGIN, RIGHT).heading).toBeCloseTo(
      -Math.PI / 2,
    );
  });

  /** Measured from `midPos`, which is the whole reason the engine uses it: a
   *  unit whose mid is up in the air aims down at a build on the ground. */
  it("moves with the unit's mid point", () => {
    const level = startBuildingAngles(ORIGIN, FRONT).pitch;
    const raised = startBuildingAngles([0, 20, 0], FRONT).pitch;
    expect(level).toBeCloseTo(0);
    expect(raised).toBeLessThan(-0.5);
  });
});

describe("resolveScenario", () => {
  function context(overrides: Partial<AimContext> = {}): AimContext {
    return {
      radius: 10,
      mid: ORIGIN,
      pieceRest: new Map([["flare", [0, 0, 0] as [number, number, number]]]),
      probed: (callin) => (callin === "AimFromWeapon1" ? "flare" : null),
      ...overrides,
    };
  }

  const firing: Scenario = {
    id: "t",
    label: "t",
    description: "t",
    events: [
      { frame: 0, callin: "Create" },
      {
        frame: 10,
        callin: "AimWeapon1",
        aimAtStandIn: { from: "AimFromWeapon" },
      },
    ],
    standIn: { keys: [{ frame: 10, pos: [1, 0, 2] }] },
  };

  it("replaces the marker with the two angles the engine would hand over", () => {
    const { events } = resolveScenario(firing, context());
    const aim = events.find((e) => e.callin === "AimWeapon1");
    expect(aim?.aimAtStandIn).toBeUndefined();
    // The stand-in's middle is one radius to the left and two ahead, plus the
    // height of its own middle above its base.
    expect(aim?.args?.[0]).toBeCloseTo(Math.atan2(10, 20));
    expect(aim?.args).toHaveLength(2);
  });

  it("leaves an event with no marker exactly as it was", () => {
    const { events } = resolveScenario(firing, context());
    expect(events[0]).toEqual({ frame: 0, callin: "Create" });
  });

  /**
   * The rest position of the piece the probe names, not the unit's origin. A
   * turret on top of a hull aims down at a stand-in the origin would aim level
   * at, which is the difference the whole preview exists to show.
   */
  it("aims from the piece the probe named", () => {
    const high = context({
      pieceRest: new Map([["flare", [0, 30, 0] as [number, number, number]]]),
    });
    const { events } = resolveScenario(firing, high);
    const aim = events.find((e) => e.callin === "AimWeapon1");
    expect(aim?.args?.[1]).toBeLessThan(-0.5);
  });

  /** A script that names no aim piece still gets angles, measured from the
   *  unit's origin, and the panel is told why they are approximate. */
  it("falls back to the unit's origin and says so", () => {
    const blind = context({ probed: () => null });
    const { events, notes } = resolveScenario(firing, blind);
    const aim = events.find((e) => e.callin === "AimWeapon1");
    expect(aim?.args).toHaveLength(2);
    expect(notes.join(" ")).toContain("AimFromWeapon1");
  });

  it("uses the builder's own formula for a midPos marker", () => {
    const building: Scenario = {
      ...firing,
      events: [
        {
          frame: 10,
          callin: "StartBuilding",
          aimAtStandIn: { from: "midPos" },
        },
      ],
    };
    const raised = context({ mid: [0, 40, 0] });
    const { events } = resolveScenario(building, raised);
    expect(events[0].args?.[1]).toBeLessThan(-0.5);
  });

  /** A re-aim can fire many times with the same cause, and the panel keys its
   *  note list on the note text, so a repeated cause must not repeat the
   *  note. */
  it("pushes a repeated note once, even when several events hit the same cause", () => {
    const blind = context({ probed: () => null });
    const repeated: Scenario = {
      ...firing,
      events: [
        {
          frame: 10,
          callin: "AimWeapon1",
          aimAtStandIn: { from: "AimFromWeapon" },
        },
        {
          frame: 20,
          callin: "AimWeapon1",
          aimAtStandIn: { from: "AimFromWeapon" },
        },
      ],
    };
    const { notes } = resolveScenario(repeated, blind);
    expect(notes).toHaveLength(1);
  });

  it("has nothing to aim at in a scenario with no track", () => {
    const { events, notes } = resolveScenario(
      { ...firing, standIn: undefined },
      context(),
    );
    expect(events.find((e) => e.callin === "AimWeapon1")?.args).toEqual([0, 0]);
    expect(notes.join(" ")).toContain("no stand-in");
  });

  /** The track is in radii, so where to put the stand-in down depends on the
   *  unit, and has to be worked out rather than written as elmos. */
  it("puts the stand-in down where the track had it", () => {
    const putting: Scenario = {
      ...firing,
      events: [
        { frame: 300, callin: "TransportDrop", dropAtStandIn: { frame: 120 } },
      ],
      standIn: { keys: [{ frame: 0, pos: [0, 0, 3] }] },
    };
    const { events } = resolveScenario(putting, context());
    expect(events[0]).toEqual({
      frame: 300,
      callin: "TransportDrop",
      args: [STAND_IN_UNIT_ID, 0, 0, 30],
    });
  });

  it("puts it down at the origin, and says so, when the track has nowhere", () => {
    const putting: Scenario = {
      ...firing,
      events: [
        { frame: 300, callin: "TransportDrop", dropAtStandIn: { frame: 120 } },
      ],
      standIn: { keys: [] },
    };
    const { events, notes } = resolveScenario(putting, context());
    expect(events[0].args).toEqual([STAND_IN_UNIT_ID, 0, 0, 0]);
    expect(notes.join(" ")).toContain("TransportDrop");
  });

  /** A weapon's own aim, measured from that weapon's own `AimFromWeapon<n>`
   *  piece rather than always weapon 1's. */
  it("measures an AimWeapon2 marker from AimFromWeapon2's own piece", () => {
    const secondWeapon: Scenario = {
      ...firing,
      events: [
        {
          frame: 10,
          callin: "AimWeapon2",
          aimAtStandIn: { from: "AimFromWeapon" },
        },
      ],
    };
    const ctx = context({
      pieceRest: new Map([["cannon", [0, 30, 0]]]),
      probed: (callin) => (callin === "AimFromWeapon2" ? "cannon" : null),
    });
    const { events } = resolveScenario(secondWeapon, ctx);
    const aim = events.find((e) => e.callin === "AimWeapon2");
    // Weapon 1's probe names nothing here, so a pitch measured from the
    // origin instead would come out level rather than steeply down.
    expect(aim?.args?.[1]).toBeLessThan(-0.5);
  });
});

describe("weaponCount", () => {
  it("counts the highest numbered slot a unit definition fills", () => {
    expect(
      weaponCount(
        { weapons: { "1": { name: "gatling" }, "2": { name: "cannon" } } },
        [],
      ),
    ).toBe(2);
  });

  it("tolerates an empty slot among the first four", () => {
    expect(
      weaponCount(
        { weapons: { "1": { name: "gatling" }, "2": {}, "3": { name: "c" } } },
        [],
      ),
    ).toBe(3);
  });

  it("stops at a gap past the first four slots, missing a weapon named beyond it", () => {
    expect(
      weaponCount({ weapons: { "1": { name: "gatling" }, "5": {} } }, []),
    ).toBe(1);
  });

  it("counts a plain string entry as a weapon", () => {
    expect(weaponCount({ weapons: { "1": "very-heavy-gatling" } }, [])).toBe(1);
  });

  it("caps the scan at MAX_WEAPONS_PER_UNIT, ignoring a key past it", () => {
    const weapons: Record<string, { name: string }> = {};
    for (let slot = 1; slot <= 40; slot++) {
      weapons[String(slot)] = { name: `weapon${slot}` };
    }
    expect(weaponCount({ weapons }, [])).toBe(32);
  });

  it("is 1 for a definition with no weapons table", () => {
    expect(weaponCount({}, ["AimWeapon3"])).toBe(1);
  });

  it("without a definition, counts the script's own numbered functions", () => {
    expect(
      weaponCount(null, ["AimWeapon1", "FireWeapon2", "QueryWeapon3"]),
    ).toBe(3);
  });

  it("without a definition, counts a Recoil ordinal call-in as its own slot", () => {
    expect(weaponCount(null, ["AimPrimary", "FireSecondary"])).toBe(2);
  });

  it("does not count a bare ordinal name no script defines", () => {
    expect(weaponCount(null, ["Primary", "Secondary"])).toBe(1);
  });

  it("is 1 for a plain script with no definition and no numbered names", () => {
    expect(weaponCount(null, ["AimWeapon", "FireWeapon"])).toBe(1);
  });
});

describe("expandForWeapons", () => {
  const events: ScriptEvent[] = [
    { frame: 0, callin: "Create" },
    {
      frame: 15,
      callin: "AimWeapon1",
      aimAtStandIn: { from: "AimFromWeapon" },
    },
    { frame: 30, engine: "fire", args: [1] },
  ];

  /** A fire interval chosen so `(n - 1) * interval / weapons` lands on a
   *  whole frame for both the 3- and 4-weapon cases below. */
  const INTERVAL_FRAMES = 12;

  it("leaves events alone for one weapon", () => {
    expect(expandForWeapons(events, 1, INTERVAL_FRAMES)).toEqual(events);
  });

  it("gives every other weapon its own aim on the same frame", () => {
    const expanded = expandForWeapons(events, 3, INTERVAL_FRAMES);
    const aims = expanded.filter((e) => e.frame === 15);
    expect(aims.map((e) => e.callin)).toEqual([
      "AimWeapon1",
      "AimWeapon2",
      "AimWeapon3",
    ]);
    expect(aims[1].aimAtStandIn).toEqual({ from: "AimFromWeapon" });
  });

  it("spreads each other weapon's shot evenly across the fire interval", () => {
    const expanded = expandForWeapons(events, 3, INTERVAL_FRAMES);
    const fires = expanded.filter((e) => e.engine === "fire");
    expect(fires.map((e) => [e.frame, e.args])).toEqual([
      [30, [1]],
      [34, [2]],
      [38, [3]],
    ]);
  });

  it("keeps the last weapon's shot inside the interval rather than growing past it", () => {
    const expanded = expandForWeapons(events, 4, INTERVAL_FRAMES);
    const fires = expanded.filter((e) => e.engine === "fire");
    const frames = fires.map((e) => e.frame);
    expect(frames).toEqual([30, 33, 36, 39]);
    // The next volley's own weapon 1 shot would land at 30 + interval: every
    // weapon here fires before it.
    expect(Math.max(...frames)).toBeLessThan(30 + INTERVAL_FRAMES);
  });

  it("keeps events in frame order with an aim before a fire on the same frame", () => {
    const expanded = expandForWeapons(events, 2, INTERVAL_FRAMES);
    const frames = expanded.map((e) => e.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });
});

const CTX: WorldContext = {
  radius: 10,
  self: { radius: 60, height: 40 },
  attachPiece: (from) => (from === "QueryBuildInfo" ? [0, 20, -5] : null),
};

const PARKED: StandInTrack = {
  keys: [
    { frame: 0, pos: [0, 0, 5] },
    { frame: 90, pos: [0, 0, 3] },
    { frame: 330, pos: [0, 0, 3] },
  ],
};

describe("worldAt", () => {
  it("puts the stand-in where its track does, in elmos", () => {
    const world = worldAt(PARKED, 120, CTX);
    expect(world.standIn).toEqual({
      id: STAND_IN_UNIT_ID,
      pos: [0, 0, 30],
      radius: 10,
      height: standInHeight(10),
    });
    expect(world.self).toEqual({ radius: 60, height: 40 });
  });

  /** A carried unit is where its attach piece is, so a factory's stand-in
   *  reads the build piece rather than the ground. */
  it("puts a factory's stand-in on its build piece", () => {
    const riding: StandInTrack = {
      ...PARKED,
      attach: { from: "QueryBuildInfo", frame: 0, until: 150 },
    };
    expect(worldAt(riding, 120, CTX).standIn?.pos).toEqual([0, 20, -5]);
  });

  it("measures a fromRelease key from the origin before anything is let go", () => {
    const leaving: StandInTrack = {
      keys: [{ frame: 0, pos: [0, -1, 0], fromRelease: true }],
    };
    expect(worldAt(leaving, 0, CTX).standIn?.pos).toEqual([0, -10, 0]);
  });

  it("keeps the stand-in's id on a frame with nowhere to put it", () => {
    const world = worldAt({ keys: [] }, 0, CTX);
    expect(world.standIn?.id).toBe(STAND_IN_UNIT_ID);
    expect(world.standIn?.pos).toBeNull();
  });

  it("has no stand-in at all when the scenario has none", () => {
    expect(worldAt(null, 0, CTX).standIn).toBeNull();
  });

  /** The rule is kept for the factory, as in `worldAt`: a stand-in is not on
   *  the build piece on the attach's own frame. */
  it("keeps a passenger off the piece on the attach's own frame", () => {
    const loading: StandInTrack = {
      keys: [
        { frame: 0, pos: [0, 0, 5] },
        { frame: 120, pos: [0, 0, 1] },
      ],
      attach: { from: "QueryBuildInfo", frame: 120, until: null },
    };
    expect(worldAt(loading, 120, CTX).standIn?.pos).toEqual([0, 0, 10]);
    expect(worldAt(loading, 121, CTX).standIn?.pos).toEqual([0, 20, -5]);
  });

  /**
   * `building-factory`'s own attach carries no `frame`, since the real start
   * is the run's `build-start`, which this pre-run world cannot know. Before
   * construction starts the buildee does not exist, so `worldAt` takes the
   * scenario's own `factory-build` event frame instead: nothing before it,
   * the build piece's rest position from it on.
   */
  it("has no stand-in before a frame-less factory attach's build-start, then its rest position", () => {
    const noStart: StandInTrack = {
      ...PARKED,
      attach: { from: "QueryBuildInfo", until: 150 },
    };
    expect(worldAt(noStart, 30, CTX, 60).standIn).toBeNull();
    expect(worldAt(noStart, 60, CTX, 60).standIn?.pos).toEqual([0, 20, -5]);
    expect(worldAt(noStart, 90, CTX, 60).standIn?.pos).toEqual([0, 20, -5]);
  });

  /** With no `factory-build` event to read at all, a frame-less attach never
   *  reports a stand-in. */
  it("has no stand-in for a frame-less attach with no build-start given", () => {
    const noStart: StandInTrack = {
      ...PARKED,
      attach: { from: "QueryBuildInfo", until: 150 },
    };
    expect(worldAt(noStart, 120, CTX).standIn).toBeNull();
  });
});

describe("withWorld", () => {
  it("gives every event the scene on its own frame", () => {
    const events = withWorld(
      [
        { frame: 0, callin: "Create" },
        { frame: 120, callin: "TransportPickup", args: [STAND_IN_UNIT_ID] },
      ],
      PARKED,
      CTX,
    );
    expect(events[0].world?.standIn?.pos).toEqual([0, 0, 50]);
    expect(events[1].world?.standIn?.pos).toEqual([0, 0, 30]);
  });

  /** Reads the frame-less attach's start out of the events themselves, since
   *  `worldAt` has nowhere else to learn it before the run. */
  it("reads a frame-less factory attach's start off its own factory-build event", () => {
    const noStart: StandInTrack = {
      ...PARKED,
      attach: { from: "QueryBuildInfo", until: 150 },
    };
    const events = withWorld(
      [
        { frame: 10, callin: "Create" },
        { frame: 30, callin: "Activate" },
        { frame: 30, engine: "factory-build" },
        { frame: 90, callin: "Deactivate" },
      ],
      noStart,
      CTX,
    );
    expect(events[0].world?.standIn).toBeNull();
    expect(events[3].world?.standIn?.pos).toEqual([0, 20, -5]);
  });
});

describe("aimDirection", () => {
  it("undoes aimWeaponAngles", () => {
    const from: [number, number, number] = [1, 2, 3];
    const to: [number, number, number] = [-7, 5, 11];
    const { heading, pitch } = aimWeaponAngles(from, to);
    const dir = aimDirection(heading, pitch);
    const length = Math.hypot(-8, 3, 8);
    expect(dir[0]).toBeCloseTo(-8 / length);
    expect(dir[1]).toBeCloseTo(3 / length);
    expect(dir[2]).toBeCloseTo(8 / length);
  });
});

describe("aimsOf", () => {
  it("reads each resolved AimWeapon's direction, and nothing else", () => {
    const aims = aimsOf([
      { frame: 0, callin: "Create" },
      { frame: 15, callin: "AimWeapon1", args: [0, 0] },
      { frame: 20, callin: "StartBuilding", args: [1, 0] },
      { frame: 30, callin: "AimWeapon2", args: [Math.PI / 2, 0] },
    ]);
    expect(aims.map((aim) => aim.frame)).toEqual([15, 30]);
    expect(aims[0].dir[2]).toBeCloseTo(1);
    expect(aims[1].dir[0]).toBeCloseTo(1);
  });
});
