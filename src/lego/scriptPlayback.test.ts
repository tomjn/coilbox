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
  type ScriptEvent,
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
    events: [],
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
   * with `Activate` first, and the runtime queues its build and starts it once
   * the script sets build stance, rather than a fixed `StartBuilding` frame.
   */
  it("offer a factory its own way of building", () => {
    const factory = scenarioById("building-factory");

    expect(factory).toBeDefined();
    const events = factory?.events ?? [];
    expect(events.map((e) => e.callin)).toContain("Activate");
    expect(events.map((e) => e.callin)).not.toContain("StartBuilding");
    const activate = events.findIndex((e) => e.callin === "Activate");
    const build = events.findIndex((e) => e.engine === "factory-build");
    expect(activate).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(-1);
    expect(activate).toBeLessThanOrEqual(build);
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

  it("fires weapon 1 through the engine in the firing scenario", () => {
    const firing = SCENARIOS.find((scenario) => scenario.id === "firing");
    const fires = firing?.events.filter((event) => event.engine === "fire");
    const firstVolley = [1, 1.5, 2, 2.5, 3, 3.5, 4].map(
      (seconds) => [at(seconds), [1]] as const,
    );
    const secondVolley = [7, 7.5, 8, 8.5, 9, 9.5, 10].map(
      (seconds) => [at(seconds), [1]] as const,
    );
    expect(fires?.map((event) => [event.frame, event.args])).toEqual([
      ...firstVolley,
      ...secondVolley,
    ]);
    expect(firing?.events.some((event) => event.callin === "Shot1")).toBe(
      false,
    );
  });

  /** The engine calls a weapon's `AimWeapon` again every `reaimTime` frames,
   *  15 by default, while it still has a target (`Weapon.cpp:137,352-357,380`),
   *  so a script whose own `AimPrimary` stands the arm down after a fixed
   *  delay is kept aiming for as long as the volley runs. */
  it("re-aims the weapon every 15 frames across each volley", () => {
    const firing = scenarioById("firing");
    const aims = firing?.events.filter(
      (event) => event.callin === "AimWeapon1",
    );

    const firstVolley: number[] = [];
    for (let frame = at(0.5); frame <= at(4); frame += 15) {
      firstVolley.push(frame);
    }
    const secondVolley: number[] = [];
    for (let frame = at(6); frame <= at(10); frame += 15) {
      secondVolley.push(frame);
    }

    expect(aims?.map((event) => event.frame)).toEqual([
      ...firstVolley,
      ...secondVolley,
    ]);
    for (const aim of aims ?? []) {
      expect(aim.aimAtStandIn).toEqual({ from: "AimFromWeapon" });
    }
  });

  it("aims before firing when an aim and a fire land on the same frame", () => {
    const firing = scenarioById("firing");
    const byFrame = new Map<number, ScriptEvent[]>();
    for (const event of firing?.events ?? []) {
      byFrame.set(event.frame, [...(byFrame.get(event.frame) ?? []), event]);
    }

    for (const group of byFrame.values()) {
      const aimIndex = group.findIndex(
        (event) => event.callin === "AimWeapon1",
      );
      const fireIndex = group.findIndex((event) => event.engine === "fire");
      if (aimIndex === -1 || fireIndex === -1) continue;
      expect(aimIndex).toBeLessThan(fireIndex);
    }
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
      expect(last.fromRelease ?? false).toBe(first.fromRelease ?? false);
    }
  });

  /**
   * `UpdateBuild` moves the buildee to the build piece's world position and
   * turns it with the piece, every frame of the build
   * (`rts/Sim/Units/UnitTypes/Factory.cpp:209-244`). The attach carries no
   * frame of its own: the preview starts riding from the run's `build-start`.
   */
  it("puts a factory's stand-in on its build piece, riding it", () => {
    expect(scenarioById("building-factory")?.standIn?.attach).toEqual({
      from: "QueryBuildInfo",
      until: null,
    });
  });

  /**
   * The engine's air arm calls `BeginTransport`, then attaches with the piece
   * `QueryTransport` names, itself (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453`).
   * `TransportPickup` is the ground and ship arm and is deliberately absent.
   */
  it("loads a transport the way the engine's air arm does", () => {
    const load = scenarioById("transport-load");
    const events = load?.events ?? [];
    const begin = events.findIndex((e) => e.callin === "BeginTransport");
    expect(begin).toBeGreaterThan(-1);
    expect(events.map((e) => e.callin)).not.toContain("TransportPickup");
    expect(events[begin + 1]).toEqual({
      frame: events[begin].frame,
      engine: "attach",
    });
    expect(events.some((e) => e.engine === "detach")).toBe(true);
    expect(load?.standIn?.attach ?? null).toBeNull();
  });

  /**
   * `StartUnload` is not here on purpose: nothing in `rts/` outside the script
   * interface files calls it. Landing calls `TransportDrop` and then detaches
   * (`MobileCAI.cpp:2090-2091`), and the last passenger off ends the
   * transport (`MobileCAI.cpp:2094-2098`).
   */
  it("lands and lets go, then ends the transport", () => {
    const load = scenarioById("transport-load");
    const events = load?.events ?? [];
    expect(events.map((e) => e.callin)).not.toContain("StartUnload");
    const drop = events.findIndex((e) => e.callin === "TransportDrop");
    expect(drop).toBeGreaterThan(-1);
    expect(events[drop]).toEqual(
      expect.objectContaining({ dropAtStandIn: { frame: at(4) } }),
    );
    expect(events[drop + 1]).toEqual({
      frame: events[drop].frame,
      engine: "detach",
    });
    const end = events.findIndex((e) => e.callin === "EndTransport");
    expect(end).toBeGreaterThan(drop);
  });

  /** `BeginTransport` takes a unit id alone in Lua, which is the form the
   *  scenarios are written in. `TransportDrop`'s own Lua form, a unit id then
   *  x, y and z, is checked where it is resolved, in
   *  `aimResolver.test.ts`. */
  it("writes BeginTransport in its Lua form", () => {
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
   * Nothing tells it which piece, so the scenario attaches nothing. It plays
   * the Hulk's whole cycle, so a `TransportDrop` puts the passenger back down
   * where it was picked up.
   */
  it("loads a ship or hover transport the way the engine's other arm does", () => {
    const pickup = scenarioById("transport-pickup");
    const callins = pickup?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("TransportPickup");
    expect(callins).not.toContain("BeginTransport");
    expect(pickup?.standIn?.attach ?? null).toBeNull();
    // Lua's form is the unit id alone.
    const pickupEvent = pickup?.events.find(
      (e) => e.callin === "TransportPickup",
    );
    expect(pickupEvent?.args).toHaveLength(1);
    const drop = pickup?.events.find((e) => e.callin === "TransportDrop");
    expect(drop?.dropAtStandIn).toEqual({ frame: pickupEvent?.frame });
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

  /**
   * A transport's passenger is set smaller than the usual size, so it does not
   * read as half the transport's own length, and a factory's buildee is set
   * smaller still, to fit its build pad. Every other scenario keeps the usual
   * size, since it was tuned by eye for aiming.
   */
  it("sizes only a transport's and a factory's stand-in smaller than usual", () => {
    const sized = ["transport-load", "transport-pickup", "building-factory"];
    for (const id of sized) {
      const size = scenarioById(id)?.standIn?.size;
      expect(size).toBeDefined();
      expect(size).toBeLessThan(7 / 30);
    }
    for (const scenario of SCENARIOS) {
      if (sized.includes(scenario.id)) continue;
      expect(scenario.standIn?.size).toBeUndefined();
    }
  });

  /**
   * A stand-in waiting beside a transport keeps a fixed gap from the
   * transport's edge rather than a distance that scales with the unit, so
   * its first key is measured `fromEdge` rather than from the unit's origin.
   */
  it("waits a fixed gap clear of the transport's edge before pickup", () => {
    expect(scenarioById("transport-pickup")?.standIn?.keys[0].fromEdge).toBe(5);
    expect(scenarioById("transport-load")?.standIn?.keys[0].fromEdge).toBe(5);
  });
});

describe("nano spans", () => {
  function span(id: string) {
    const scenario = scenarioById(id);
    if (!scenario) throw new Error(`no scenario ${id}`);
    const frames = (name: string) =>
      scenario.events.filter((e) => e.callin === name).map((e) => e.frame);
    const engine = (name: string) =>
      scenario.events.filter((e) => e.engine === name).map((e) => e.frame);
    return { scenario, frames, engine };
  }

  it("sprays for as long as a construction unit builds", () => {
    const { scenario, frames, engine } = span("building");
    expect(scenario.nano).toBe("builder");
    expect(engine("nano-start")).toEqual(frames("StartBuilding"));
    expect(engine("nano-stop")).toEqual(frames("StopBuilding"));
  });

  it("queues a factory's build off its own script rather than a fixed frame", () => {
    const { scenario, frames, engine } = span("building-factory");
    expect(scenario.nano).toBe("factory");
    expect(frames("StartBuilding")).toEqual([]);
    expect(frames("StopBuilding")).toEqual([]);
    expect(engine("nano-start")).toEqual([]);
    expect(engine("nano-stop")).toEqual([]);
    expect(engine("factory-build")).toEqual(frames("Activate"));
    expect(engine("factory-finish").length).toBe(1);
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
