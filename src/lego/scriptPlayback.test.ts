import { describe, expect, it } from "vitest";

import {
  at,
  clampFrame,
  frameAt,
  hiddenAt,
  PREVIEW_FRAMES,
  playable,
  poseAt,
  SCENARIOS,
  type ScriptTimeline,
  scenarioById,
} from "./scriptPlayback";

/** Two pieces, three frames, the second piece turning a tenth per frame. */
function timeline(overrides: Partial<ScriptTimeline> = {}): ScriptTimeline {
  return {
    fps: 30,
    pieces: ["base", "turret"],
    frames: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0],
    ],
    hidden: [],
    error: null,
    warnings: [],
    asked: [],
    functions: [],
    linesRun: [],
    offsetsRun: [],
    ...overrides,
  };
}

describe("scenarios", () => {
  it("all create the unit first, because the engine does", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.events[0]).toEqual({ frame: 0, callin: "Create" });
    }
  });

  it("never fire anything past the end of the preview", () => {
    for (const scenario of SCENARIOS) {
      for (const event of scenario.events) {
        expect(event.frame).toBeLessThan(PREVIEW_FRAMES);
      }
    }
  });

  it("are found by id, and an unknown one is not invented", () => {
    expect(scenarioById("moving")?.label).toBe("Moving");
    expect(scenarioById("nope")).toBeUndefined();
  });

  /**
   * A unit is told what it is standing on by the engine rather than working it
   * out. A script that branches on it gets nothing, matches no branch, and
   * stands still: Expand and Exterminate's construction mech does exactly that.
   */
  it("all tell the unit it is standing on land", () => {
    for (const scenario of SCENARIOS) {
      const told = scenario.events.find((e) => e.callin === "setSFXoccupy");
      expect(told, scenario.id).toBeDefined();
      expect(told?.args, scenario.id).toEqual([4]);
      // After Create, not alongside it: a script routinely starts its own
      // `setSFXoccupy` with no argument from Create, and a started thread runs
      // after the call that started it, so the same frame is too early.
      expect(told?.frame, scenario.id).toBe(1);
    }
  });

  /**
   * A `Create` that sleeps is suspended part way through setting the unit up,
   * and the lines after the sleep are often the ones the move animation reads.
   * flove's mushrooms set their rest pose in a sleeping call and then work out
   * how fast to walk, so a unit told to move on the frame it was made reads a
   * speed that has not been written yet.
   */
  it("never tell a unit to move before it has finished being created", () => {
    for (const scenario of SCENARIOS) {
      const moving = scenario.events.find((e) => e.callin === "StartMoving");
      if (!moving) continue;
      expect(moving.frame, scenario.id).toBeGreaterThan(1);
    }
  });

  /**
   * A factory and a mobile builder are driven differently. A factory is opened
   * with `Activate` first and then told to build with no arguments at all, and
   * most factory scripts will not animate until the yard is open.
   */
  it("offer a factory its own way of building", () => {
    const factory = scenarioById("building-factory");

    expect(factory).toBeDefined();
    const callins = factory?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("Activate");
    const build = factory?.events.find((e) => e.callin === "StartBuilding");
    expect(build?.args).toBeUndefined();
    expect(callins.indexOf("Activate")).toBeLessThan(
      callins.indexOf("StartBuilding"),
    );
  });

  /**
   * A death is the biggest animation most units have, and nearly every script
   * has one: 829 of the 848 compiled scripts Beyond All Reason ships define
   * `Killed`. A script reads the severity as the ratio of the two numbers it is
   * handed, so they only matter against each other.
   */
  it("offer a death, hit first", () => {
    const events = scenarioById("destroyed")?.events ?? [];
    const callins = events.map((e) => e.callin);

    expect(callins).toContain("HitByWeapon");
    expect(callins.indexOf("HitByWeapon")).toBeLessThan(
      callins.indexOf("Killed"),
    );
    const killed = events.find((e) => e.callin === "Killed");
    expect(killed?.args).toHaveLength(2);
    // Half of the health it had, which is the middle band of the three or four
    // every script written from the same template picks between.
    expect(killed?.args?.[0]).toBe((killed?.args?.[1] ?? 0) / 2);
  });

  /** The mobile builder aims at the stand-in rather than at two numbers
   *  somebody picked, which is the only way a wrong aim is visible. */
  it("aims the mobile builder at its stand-in", () => {
    const build = scenarioById("building")?.events.find(
      (e) => e.callin === "StartBuilding",
    );

    expect(build?.aimAtStandIn).toEqual({ from: "midPos" });
    expect(build?.args).toBeUndefined();
  });

  it("aims the weapon at its stand-in from the aim piece", () => {
    const aim = scenarioById("firing")?.events.find(
      (e) => e.callin === "AimWeapon1",
    );

    expect(aim?.aimAtStandIn).toEqual({ from: "AimFromWeapon" });
    expect(aim?.args).toBeUndefined();
  });

  /** Every event that aims at a stand-in is in a scenario that has one, and
   *  every track's keys are inside the preview. */
  it("never aims at a stand-in a scenario does not place", () => {
    for (const scenario of SCENARIOS) {
      for (const event of scenario.events) {
        if (!event.aimAtStandIn) continue;
        expect(scenario.standIn?.keys.length ?? 0).toBeGreaterThan(0);
      }
      for (const key of scenario.standIn?.keys ?? []) {
        expect(key.frame).toBeGreaterThanOrEqual(0);
        // A closing key lands on `PREVIEW_FRAMES` itself, which is the frame
        // the preview wraps to. That is one past the last frame drawn, and it
        // is the only key allowed there.
        expect(key.frame).toBeLessThanOrEqual(PREVIEW_FRAMES);
      }
    }
  });

  /**
   * A stand-in that moves has to end where it began, or it leaps across the
   * scene on the frame the preview loops. The unit itself snaps back to its
   * rest pose there, which is a cut everything in the scene shares. A stand-in
   * sliding through that boundary and then jumping is the thing that reads as
   * a bug rather than as a restart.
   *
   * Checked against the first and last keys rather than against the comment on
   * each track, since a comment cannot be wrong in a way a run notices.
   */
  it("brings a moving stand-in back to where it started", () => {
    for (const scenario of SCENARIOS) {
      const keys = scenario.standIn?.keys ?? [];
      if (keys.length < 2) continue;
      const first = keys[0];
      const last = keys[keys.length - 1];

      expect(last.frame).toBe(PREVIEW_FRAMES);
      expect(last.pos).toEqual(first.pos);
      expect(last.fromAttachPiece ?? false).toBe(
        first.fromAttachPiece ?? false,
      );
    }
  });

  /**
   * A factory spawns what it builds at the piece `QueryBuildInfo` names
   * (`rts/Sim/Units/UnitTypes/Factory.cpp:95-101,178`), and leaves it there.
   * It does not carry it, so the stand-in sits at the piece's rest position
   * rather than riding it.
   */
  it("puts a factory's stand-in on its build piece, sitting still", () => {
    expect(scenarioById("building-factory")?.standIn?.attach).toEqual({
      from: "QueryBuildInfo",
      frame: at(2),
      until: null,
      follow: false,
    });
  });

  /**
   * Air transport, which is the only kind in scope. The engine's air arm calls
   * `BeginTransport` then attaches with the piece `QueryTransport` names
   * (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1448-1455`). `TransportPickup` is
   * the ground and ship arm and is deliberately absent.
   */
  it("loads a transport the way the engine's air arm does", () => {
    const load = scenarioById("transport-load");
    const callins = load?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("BeginTransport");
    expect(callins).not.toContain("TransportPickup");
    expect(load?.standIn?.attach?.from).toBe("QueryTransport");
    expect(load?.standIn?.attach?.follow).toBe(true);
    // Attached from the frame the transport is told it has a passenger.
    const begin = load?.events.find((e) => e.callin === "BeginTransport");
    expect(load?.standIn?.attach?.frame).toBe(begin?.frame);
  });

  /**
   * `StartUnload` is not here on purpose: nothing in `rts/` outside the script
   * interface files calls it, the same reason `QueryLandingPad` has no
   * scenario.
   */
  it("unloads with the two call-ins the engine actually fires", () => {
    const unload = scenarioById("transport-unload");
    const callins = unload?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("TransportDrop");
    expect(callins).toContain("EndTransport");
    expect(callins).not.toContain("StartUnload");
    // It comes off on the frame it is dropped, and not before.
    const drop = unload?.events.find((e) => e.callin === "TransportDrop");
    expect(unload?.standIn?.attach?.until).toBe(drop?.frame);
  });

  /** `TransportDrop` takes a unit id then x, y and z in Lua, which is the form
   *  the scenarios are written in. `LuaUnitScript.cpp:806-826`. */
  it("writes the transport call-ins in their Lua form", () => {
    expect(
      scenarioById("transport-unload")?.events.find(
        (e) => e.callin === "TransportDrop",
      )?.args,
    ).toHaveLength(4);
    expect(
      scenarioById("transport-load")?.events.find(
        (e) => e.callin === "BeginTransport",
      )?.args,
    ).toHaveLength(1);
  });

  /**
   * Every transport that is not a `CHoverAirMoveType` is handed
   * `TransportPickup(unit)` once the passenger is in range, and attaches the
   * passenger itself (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1459-1463`).
   * Nothing tells it which piece, so the scenario attaches nothing.
   */
  it("loads a ship or hover transport the way the engine's other arm does", () => {
    const pickup = scenarioById("transport-pickup");
    const callins = pickup?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("TransportPickup");
    expect(callins).not.toContain("BeginTransport");
    expect(pickup?.standIn?.attach ?? null).toBeNull();
    // Lua's form is the unit id alone.
    expect(
      pickup?.events.find((e) => e.callin === "TransportPickup")?.args,
    ).toHaveLength(1);
  });

  /** The engine calls it once the passenger has stopped, so the stand-in is
   *  parked for as long as the transport might be reading where it is. */
  it("parks the passenger before the pickup and keeps it there", () => {
    const pickup = scenarioById("transport-pickup");
    const frame =
      pickup?.events.find((e) => e.callin === "TransportPickup")?.frame ?? -1;
    const keys = pickup?.standIn?.keys ?? [];
    const parked = keys.filter(
      (key) => key.frame >= frame && key.frame <= at(11),
    );
    expect(parked.length).toBeGreaterThanOrEqual(1);
    const before = keys.filter((key) => key.frame < frame).at(-1);
    for (const key of parked) expect(key.pos).toEqual(before?.pos);
  });
});

describe("frameAt", () => {
  it("loops rather than running out", () => {
    const played = timeline();
    expect(frameAt(played, 0)).toBe(0);
    expect(frameAt(played, 2 / 30)).toBe(2);
    // Three frames at 30fps is a tenth of a second, so the fourth is the first.
    expect(frameAt(played, 3 / 30)).toBe(0);
    expect(frameAt(played, 4 / 30)).toBe(1);
  });

  it("has no frame at all for a run that produced none", () => {
    expect(frameAt(timeline({ frames: [] }), 0)).toBe(-1);
  });
});

describe("poseAt", () => {
  it("reads the six numbers belonging to one piece", () => {
    expect(poseAt(timeline(), 2, 1)).toEqual([0, 0, 0, 0, 0.2, 0]);
  });

  it("is nothing for a frame or a piece that is not there", () => {
    expect(poseAt(timeline(), 9, 0)).toBeNull();
    expect(poseAt(timeline(), 0, 7)).toBeNull();
  });
});

describe("hiddenAt", () => {
  it("hides nothing when the script hid nothing", () => {
    expect(hiddenAt(timeline(), 0, 0)).toBe(false);
  });

  it("reads the flag when there is one", () => {
    const played = timeline({
      hidden: [
        [false, true],
        [false, false],
        [false, false],
      ],
    });
    expect(hiddenAt(played, 0, 1)).toBe(true);
    expect(hiddenAt(played, 1, 1)).toBe(false);
  });
});

describe("clampFrame", () => {
  it("leaves a frame that is already in range alone", () => {
    expect(clampFrame(timeline(), 1)).toBe(1);
  });

  it("pulls a frame before the start up to the first frame", () => {
    expect(clampFrame(timeline(), -4)).toBe(0);
  });

  it("pulls a frame past the end back to the last frame", () => {
    expect(clampFrame(timeline(), 99)).toBe(2);
  });

  it("has nowhere to land in a timeline with no frames", () => {
    expect(clampFrame(timeline({ frames: [] }), 5)).toBe(0);
  });
});

describe("playable", () => {
  it("is what has frames, whether or not it also failed", () => {
    expect(playable(null)).toBe(false);
    expect(playable(timeline({ frames: [] }))).toBe(false);
    expect(playable(timeline({ error: "it threw" }))).toBe(true);
  });
});
