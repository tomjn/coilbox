import { describe, expect, it } from "vitest";

import {
  type AimContext,
  aimWeaponAngles,
  resolveScenario,
  startBuildingAngles,
  type WorldContext,
  withWorld,
  worldAt,
} from "./aimResolver";
import {
  type Scenario,
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

  it("has nothing to aim at in a scenario with no track", () => {
    const { events, notes } = resolveScenario(
      { ...firing, standIn: undefined },
      context(),
    );
    expect(events.find((e) => e.callin === "AimWeapon1")?.args).toEqual([0, 0]);
    expect(notes.join(" ")).toContain("no stand-in");
  });
});

const CTX: WorldContext = {
  radius: 10,
  self: { radius: 60, height: 40 },
  attachPiece: (from) => (from === "QueryTransport" ? [0, 20, -5] : null),
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

  /** A carried unit is where its attach piece is, so a transport dropping it
   *  reads the pad rather than the ground (the Hulk's `TransportDrop`). */
  it("puts an attached stand-in on the piece it rides", () => {
    const riding: StandInTrack = {
      ...PARKED,
      attach: { from: "QueryTransport", frame: 0, until: 150, follow: true },
    };
    expect(worldAt(riding, 120, CTX).standIn?.pos).toEqual([0, 20, -5]);
  });

  it("measures a key from the attach piece when the key says to", () => {
    const leaving: StandInTrack = {
      keys: [{ frame: 0, pos: [0, -1, 0], fromRelease: true }],
      attach: { from: "QueryTransport", frame: 100, until: null, follow: true },
    };
    expect(worldAt(leaving, 0, CTX).standIn?.pos).toEqual([0, 10, -5]);
  });

  it("keeps the stand-in's id on a frame with nowhere to put it", () => {
    const world = worldAt({ keys: [] }, 0, CTX);
    expect(world.standIn?.id).toBe(STAND_IN_UNIT_ID);
    expect(world.standIn?.pos).toBeNull();
  });

  it("has no stand-in at all when the scenario has none", () => {
    expect(worldAt(null, 0, CTX).standIn).toBeNull();
  });

  /** BeginTransport fires before AttachUnit in the engine, so a call-in on
   *  the attach's own frame still finds the passenger where it stood. */
  it("keeps a passenger off the piece on the attach's own frame", () => {
    const loading: StandInTrack = {
      keys: [
        { frame: 0, pos: [0, 0, 5] },
        { frame: 120, pos: [0, 0, 1] },
      ],
      attach: { from: "QueryTransport", frame: 120, until: null, follow: true },
    };
    expect(worldAt(loading, 120, CTX).standIn?.pos).toEqual([0, 0, 10]);
    expect(worldAt(loading, 121, CTX).standIn?.pos).toEqual([0, 20, -5]);
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
});
