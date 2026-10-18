import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WALK_BIPED, WALK_FITTED, WALK_QUAD } from "./animPresets";
import { BIPED, type BodyPlan, projectFromPlan, QUADRUPED } from "./bodyPlans";
import { buildLuaScript } from "./luaScript";
import type { LegoProject } from "./model";
import {
  fittedParams,
  fitWalk,
  overridesFit,
  shownParams,
  walkBody,
  withoutFitOverrides,
} from "./walkFit";

const FPS = 30;
const DEG = Math.PI / 180;

let ids = 0;
function newId(): string {
  ids += 1;
  return `id${ids}`;
}

function fromPlan(
  plan: BodyPlan,
  proportions?: Record<string, number>,
  speed?: number,
  name = plan.label,
): LegoProject {
  const unit = projectFromPlan(plan, {
    id: "unit",
    rootPieceId: "root",
    name,
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
    newId,
    ...(proportions ? { proportions } : {}),
  });
  return speed === undefined
    ? unit
    : { ...unit, movement: { moveClass: "BOT2", speed } };
}

/** The fitted period's ground sweep: the ankle's travel back while down. */
function sweep(legLength: number, strideDeg: number): number {
  return 2 * legLength * Math.sin(strideDeg * DEG);
}

describe("fitting a walk to the unit's body", () => {
  it("fits nothing to a unit with no skeleton or no speed", () => {
    const bare = fromPlan(BIPED);
    expect(walkBody(bare)).toBeNull();
    expect(
      walkBody({ ...bare, skeleton: undefined, movement: undefined }),
    ).toBe(null);
    expect(
      walkBody({ ...fromPlan(BIPED, undefined, 45), skeleton: undefined }),
    ).toBeNull();
    const params = { period: 1.2 };
    expect(fittedParams(bare, "walk.biped", params)).toBe(params);
  });

  it("leaves every preset but the walks alone", () => {
    const params = { period: 3 };
    expect(
      fittedParams(fromPlan(BIPED, undefined, 45), "buildarm", params),
    ).toBe(params);
  });

  it("works the period out from the leg and the speed, in whole frames", () => {
    const fitted = fitWalk({ legLength: 18.8, speed: 45 }, {});
    // 2 * 18.8 * sin(25°) / (45 * 0.5) is 0.7062 s, which is 21.2 frames,
    // and the nearest even number of frames is 22.
    expect(fitted.period).toBeCloseTo(22 / FPS, 12);
    expect(fitted.duty).toBe(50);
    expect(fitted[WALK_FITTED]).toBe(1);
  });

  it("fits the swing to the rounded period, so the foot moves at the unit's speed", () => {
    for (const [legLength, speed] of [
      [18.8, 45],
      [8, 30],
      [36, 90],
    ]) {
      const fitted = fitWalk({ legLength, speed }, {});
      expect(sweep(legLength, fitted.stride)).toBeCloseTo(
        (speed * fitted.period * fitted.duty) / 100,
        9,
      );
      expect((fitted.period * FPS) % 2).toBeCloseTo(0, 9);
    }
  });

  it("gives longer legs a longer stride and a longer period at the same speed", () => {
    const short = fitWalk({ legLength: 10, speed: 45 }, {});
    const long = fitWalk({ legLength: 30, speed: 45 }, {});
    expect(long.period).toBeGreaterThan(short.period);
    expect(sweep(30, long.stride)).toBeGreaterThan(sweep(10, short.stride));
  });

  it("keeps a period set by hand and fits the swing to it", () => {
    const fitted = fitWalk({ legLength: 18.8, speed: 45 }, { period: 1 });
    expect(fitted.period).toBe(1);
    expect(sweep(18.8, fitted.stride)).toBeCloseTo(45 * 1 * 0.5, 9);
  });

  it("keeps a swing set by hand and fits the period to it", () => {
    const fitted = fitWalk({ legLength: 18.8, speed: 45 }, { stride: 40 });
    expect(fitted.stride).toBe(40);
    const frames = ((2 * 18.8 * Math.sin(40 * DEG)) / 22.5) * FPS;
    expect(fitted.period).toBeCloseTo((2 * Math.round(frames / 2)) / FPS, 12);
  });

  it("uses both as given when both are set", () => {
    const fitted = fitWalk(
      { legLength: 18.8, speed: 45 },
      { stride: 40, period: 2, knee: 12 },
    );
    expect(fitted).toEqual({
      stride: 40,
      period: 2,
      knee: 12,
      duty: 50,
      fitted: 1,
    });
  });

  it("takes longer over a stride with more time on the ground", () => {
    const walk = fitWalk({ legLength: 18.8, speed: 45 }, { duty: 70 });
    const run = fitWalk({ legLength: 18.8, speed: 45 }, { duty: 40 });
    expect(walk.period).toBeLessThan(run.period);
    // 70% of an even number of frames is a whole number only every tenth, so
    // the share is rounded to a whole frame and the swing fitted to that.
    const frames = walk.period * FPS;
    expect(Math.abs(walk.duty - 70)).toBeLessThanOrEqual(50 / frames);
    expect(sweep(18.8, walk.stride)).toBeCloseTo(
      (45 * walk.period * walk.duty) / 100,
      9,
    );
  });

  it("holds the period to its slider and cuts a stride the leg cannot reach", () => {
    // Short legs at a high speed want a period under the slider's 0.2 s, and
    // then a swing past its 70° to keep up.
    const fast = fitWalk({ legLength: 5, speed: 200 }, {});
    expect(fast.period).toBe(0.2);
    expect(fast.stride).toBe(70);
    const slow = fitWalk({ legLength: 40, speed: 2 }, {});
    expect(slow.period).toBe(4);
  });
});

describe("the walk in the Animation panel", () => {
  const unit = fromPlan(BIPED, undefined, 45);

  it("shows the fitted numbers for a walk nobody has overridden", () => {
    const entry = { presetId: "walk.biped", params: {} };
    expect(shownParams(unit, entry, null).period).toBeCloseTo(22 / FPS, 12);
    expect(overridesFit(unit, entry, null)).toBe(false);
  });

  it("offers the fit back once a period is set by hand, and drops only the override", () => {
    const entry = {
      presetId: "walk.biped",
      params: { period: 1.5, knee: 20 },
      instances: { left: { stride: 30 }, right: { knee: 10 } },
    };
    expect(overridesFit(unit, entry, null)).toBe(true);
    expect(overridesFit(unit, entry, "left")).toBe(true);
    expect(overridesFit(unit, entry, "right")).toBe(false);
    expect(withoutFitOverrides(entry, null).params).toEqual({ knee: 20 });
    expect(withoutFitOverrides(entry, "left").instances).toEqual({
      right: { knee: 10 },
    });
    expect(shownParams(unit, entry, "left").stride).toBe(30);
  });

  it("never offers it for a unit that cannot be fitted", () => {
    const entry = { presetId: "walk.biped", params: { period: 1.5 } };
    expect(overridesFit(fromPlan(BIPED), entry, null)).toBe(false);
    expect(
      overridesFit(unit, { presetId: "buildarm", params: { period: 2 } }, null),
    ).toBe(false);
  });
});

describe("a longer leg in the preview", () => {
  it("writes a slower, longer walk, so the preview changes with the skeleton", () => {
    const short = buildLuaScript(fromPlan(BIPED, { legLength: 12 }, 45));
    const long = buildLuaScript(fromPlan(BIPED, { legLength: 30 }, 45));
    expect(short).not.toBe(long);
    const frames = (lua: string) =>
      Number(/a stride every (\d+) frames/.exec(lua)?.[1]);
    expect(frames(long)).toBeGreaterThan(frames(short));
  });
});

describe("the walk a skeleton gives no reason to change", () => {
  /** Written by main before #3349, for the plan's defaults and these names. */
  const fromMain = (name: string) =>
    readFileSync(join(__dirname, "fixtures", name), "utf8");

  it("writes the same script for a walker with no speed", () => {
    expect(buildLuaScript(fromPlan(BIPED, undefined, undefined, "Biped"))).toBe(
      fromMain("walkBipedUnfitted.lua"),
    );
    expect(
      buildLuaScript(fromPlan(QUADRUPED, undefined, undefined, "Quad")),
    ).toBe(fromMain("walkQuadUnfitted.lua"));
  });

  it("writes the same script for a walker with a speed and no skeleton", () => {
    const { skeleton: _gone, ...bare } = fromPlan(
      BIPED,
      undefined,
      45,
      "Biped",
    );
    expect(buildLuaScript(bare)).toBe(fromMain("walkBipedUnfitted.lua"));
  });

  it("moves the legs the same at half the time on the ground as it did with no such setting", () => {
    for (const t of [0, 0.13, 0.5, 0.77, 1.31]) {
      for (const role of ["leg.l1.thigh", "leg.r1.shin", "leg.l1.foot"]) {
        expect(WALK_BIPED.track(t, { duty: 50 }, role)).toEqual(
          WALK_BIPED.track(t, {}, role),
        );
      }
    }
  });
});

describe("a fitted walk's track", () => {
  const params = fitWalk({ legLength: 18.8, speed: 45 }, {});

  it("keeps the knee straight while the foot is down and bends it only in the air", () => {
    const period = params.period;
    let bent = 0;
    for (let frame = 0; frame < period * FPS; frame++) {
      const knee =
        WALK_BIPED.track(frame / FPS, params, "leg.l1.shin")?.rotation?.[0] ??
        0;
      expect(knee).toBeGreaterThanOrEqual(0);
      if (knee > 0) bent++;
    }
    // Half the time on the ground, so the knee is bent about half the frames.
    expect(bent / (period * FPS)).toBeCloseTo(0.5, 1);
  });

  it("still keeps the foot flat", () => {
    const at = (role: string) =>
      WALK_QUAD.track(0.31, params, role)?.rotation?.[0] ?? 0;
    expect(at("leg.r2.foot")).toBeCloseTo(
      -(at("leg.r2.thigh") + at("leg.r2.shin")),
      12,
    );
  });
});

/** One frame of the left leg as the script left it. */
interface LegFrame {
  frame: number;
  thigh: number;
  shin: number;
}

/**
 * Runs the unit's script under luajit with the engine's piece motion stood in
 * for: `Turn` with a speed moves the piece toward its target by speed / 30 a
 * frame and stops there (`CUnitScript::TickTurnAnim` and `TurnToward`), and
 * `Sleep(ms)` wakes the thread `floor(ms / 33)` frames later, as the unit
 * script gadget's `Sleep` does. `StartMoving` fires on frame 0. Returns the
 * left thigh and shin's x angles on every frame.
 */
function walkLeg(
  lua: string,
  thigh: string,
  shin: string,
  frames: number,
): LegFrame[] {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
SFX = { SHATTER = 1 }
COB = {}
local frame = 0
local anims = {}
local threads = {}
local current = nil
local function anim(p, axis)
  local key = p .. ":" .. axis
  anims[key] = anims[key] or { at = 0, dest = 0, speed = 0 }
  return anims[key]
end
function piece(name) return name end
function Turn(p, axis, dest, speed)
  local a = anim(p, axis)
  a.dest = dest
  if speed == nil or speed == 0 then a.at = dest a.speed = 0 else a.speed = speed end
end
function Move() end
function Spin() end
function StopSpin() end
function Explode() end
function WaitForTurn() end
function WaitForMove() end
function SetUnitValue() end
function SetSignalMask(mask) current.mask = mask end
function Signal(mask)
  for _, t in ipairs(threads) do
    if t.mask == mask then t.dead = true end
  end
end
function Sleep(ms) coroutine.yield(math.floor(ms / 33)) end
local function resume(t)
  current = t
  local ok, wait = coroutine.resume(t.co)
  assert(ok, wait)
  t.wake = frame + (wait or 0)
end
function StartThread(fn, ...)
  local t = { co = coroutine.create(fn) }
  threads[#threads + 1] = t
  resume(t)
end
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()
script.Create()
script.StartMoving()
for f = 0, ${frames - 1} do
  frame = f
  for _, t in ipairs(threads) do
    if not t.dead and coroutine.status(t.co) == "suspended" and t.wake <= f then
      resume(t)
    end
  end
  for _, a in pairs(anims) do
    if a.speed > 0 then
      local step = a.speed / 30
      if math.abs(a.dest - a.at) <= step then a.at = a.dest
      elseif a.dest > a.at then a.at = a.at + step
      else a.at = a.at - step end
    end
  end
  io.write(f, " ", anim("${thigh}", x_axis).at, " ", anim("${shin}", x_axis).at, "\\n")
end
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  return result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [frame, thighAngle, shinAngle] = line.split(" ").map(Number);
      return { frame, thigh: thighAngle, shin: shinAngle };
    });
}

/** A run of frames with the left foot down: the knee straight. */
function stances(legs: LegFrame[]): LegFrame[][] {
  const runs: LegFrame[][] = [];
  let run: LegFrame[] = [];
  for (const leg of legs) {
    if (leg.shin === 0) {
      run.push(leg);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  // The last run may have been cut off by the end of the frames.
  return runs;
}

describe("a fitted walk under luajit", () => {
  /**
   * Two skeletons with different legs at one speed, stepped for long enough
   * to give several strides after the first, which starts from rest.
   *
   * Where the ankle is comes from the leg's own pieces: the shin hangs the
   * thigh's length below the hip and the foot the shin's length below the
   * knee, and a Turn about x by `a` puts a point `l` below the joint `l *
   * sin(a)` behind it, a positive thigh angle being the leg swung back. The
   * ground moves past the body at the unit's speed, so where the ankle is on
   * the ground is the body's travel plus the ankle's place under the body.
   *
   * The allowance is one frame of the unit's own travel, speed / 30. The
   * engine moves the unit and its pieces once a frame, so a foot cannot be
   * held any closer to one spot than the distance the body moves in a frame.
   * It covers the Turns going in straight lines between the poses the script
   * samples, the four decimal places the poses are written to, and the frame
   * a foot comes down on.
   */
  for (const legLength of [12, 30]) {
    it(`plants a ${legLength} elmo leg's foot and steps the unit's speed times the period each stride`, () => {
      const speed = 40;
      const unit = fromPlan(BIPED, { legLength }, speed);
      const fitted = fittedParams(unit, "walk.biped", {});
      const lap = Math.round(fitted.period * FPS);
      const legs = walkLeg(buildLuaScript(unit), "lthigh", "lshin", lap * 6);

      const thighLength = -(
        unit.pieces.find((piece) => piece.name === "lshin")?.position[1] ?? 0
      );
      const shinLength = -(
        unit.pieces.find((piece) => piece.name === "lfoot")?.position[1] ?? 0
      );
      expect(thighLength + shinLength).toBeCloseTo(legLength, 9);

      const ground = (leg: LegFrame) =>
        (speed * leg.frame) / FPS -
        thighLength * Math.sin(leg.thigh) -
        shinLength * Math.sin(leg.thigh + leg.shin);
      const allowance = speed / FPS;

      // The first stance starts from rest, so it is left out. Every other one
      // holds the knee straight from the frame the foot comes down to the
      // frame it lifts. A Turn's speed is written to four decimal places, so
      // the knee can straighten a frame late and the run be a frame shorter.
      const planted = stances(legs).slice(1);
      expect(planted.length).toBeGreaterThanOrEqual(4);
      const down = Math.round((fitted.duty / 100) * lap);
      for (const run of planted) {
        expect(run.length).toBeGreaterThanOrEqual(down);
        expect(run.length).toBeLessThanOrEqual(down + 1);
      }

      for (const run of planted) {
        const spots = run.map(ground);
        expect(Math.max(...spots) - Math.min(...spots)).toBeLessThan(allowance);
      }

      // All a planted foot's travel in a cycle is the step it takes in the
      // air, from where it lifted to where it comes down next. That is the
      // unit's speed times the period when the foot did not slide.
      const steps = planted.slice(1).map((run, index) => {
        const lifted = planted[index][planted[index].length - 1];
        return ground(run[0]) - ground(lifted);
      });
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (const step of steps) {
        expect(Math.abs(step - speed * fitted.period)).toBeLessThan(allowance);
      }
    });
  }

  it("takes a longer stride on the longer leg", () => {
    const stride = (legLength: number) =>
      fittedParams(fromPlan(BIPED, { legLength }, 40), "walk.biped", {})
        .period * 40;
    expect(stride(30)).toBeGreaterThan(stride(12) * 2);
  });
});
