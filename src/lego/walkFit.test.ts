import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  WALK_BIPED,
  WALK_DROP,
  WALK_FITTED,
  WALK_PAIRS,
  WALK_QUAD,
  WALK_SHIN,
  WALK_THIGH,
} from "./animPresets";
import {
  BIPED,
  type BodyPlan,
  HEXAPOD,
  OCTOPOD,
  projectFromPlan,
  QUADRUPED,
} from "./bodyPlans";
import { buildLuaScript } from "./luaScript";
import type { LegoProject } from "./model";
import { problemTexts } from "./problems";
import {
  fittedParams,
  fitWalk,
  legLengths,
  overridesFit,
  pastReach,
  shownParams,
  walkBody,
  walkProblems,
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

describe("the walk for any number of legs (#3351)", () => {
  it("counts the pairs from the unit's leg roles and starts at the time on the ground for that many", () => {
    for (const [plan, pairs, duty] of [
      [BIPED, 1, 50],
      [QUADRUPED, 2, 75],
      [HEXAPOD, 3, 50],
      [OCTOPOD, 4, 50],
    ] as const) {
      const params = fittedParams(fromPlan(plan), "walk.legs", {});
      expect(params[WALK_PAIRS]).toBe(pairs);
      expect(params.duty).toBe(duty);
    }
  });

  it("keeps a time on the ground set by hand", () => {
    const params = fittedParams(fromPlan(HEXAPOD), "walk.legs", { duty: 70 });
    expect(params.duty).toBe(70);
  });

  it("fits the walk to the legs of every pair", () => {
    const unit = fromPlan(OCTOPOD, undefined, 45);
    const params = fittedParams(unit, "walk.legs", {});
    expect(params[WALK_FITTED]).toBe(1);
    expect(params[WALK_THIGH]).toBeCloseTo(18.8 * 0.395, 9);
    expect(walkProblems(unit)).toEqual([]);
  });

  it("leaves the fixed walks without a pair count", () => {
    expect(fittedParams(fromPlan(QUADRUPED), "walk.quad", {})).toEqual({});
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

describe("a fitted walk's track with no leg lengths to solve with", () => {
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

/** One frame of the left leg and the body as the script left them. */
interface LegFrame {
  frame: number;
  thigh: number;
  shin: number;
  /** The body piece's y offset, from the walk lowering it. */
  body: number;
}

/**
 * Runs the unit's script under luajit with the engine's piece motion stood in
 * for: `Turn` and `Move` with a speed move the piece toward its target by
 * speed / 30 a frame and stop there (`CUnitScript::TickTurnAnim` and
 * `TurnToward`), and `Sleep(ms)` wakes the thread `floor(ms / 33)` frames
 * later, as the unit script gadget's `Sleep` does. `StartMoving` fires on
 * frame 0. Returns the left thigh's and shin's x angles and the body's y
 * offset on every frame.
 */
function walkLeg(
  lua: string,
  thigh: string,
  shin: string,
  body: string,
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
local function anim(kind, p, axis)
  local key = kind .. ":" .. p .. ":" .. axis
  anims[key] = anims[key] or { at = 0, dest = 0, speed = 0 }
  return anims[key]
end
local function head(a, dest, speed)
  a.dest = dest
  if speed == nil or speed == 0 then a.at = dest a.speed = 0 else a.speed = speed end
end
function piece(name) return name end
function Turn(p, axis, dest, speed) head(anim("turn", p, axis), dest, speed) end
function Move(p, axis, dest, speed) head(anim("move", p, axis), dest, speed) end
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
  io.write(f, " ", anim("turn", "${thigh}", x_axis).at, " ", anim("turn", "${shin}", x_axis).at, " ", anim("move", "${body}", y_axis).at, "\\n")
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
      const [frame, thighAngle, shinAngle, bodyY] = line.split(" ").map(Number);
      return { frame, thigh: thighAngle, shin: shinAngle, body: bodyY };
    });
}

/** A biped whose thigh is `share` of its `legLength`, at `speed`. */
function walker(legLength: number, share: number, speed: number): LegoProject {
  const unit = fromPlan(BIPED, { legLength }, speed);
  const thigh = legLength * share;
  return {
    ...unit,
    pieces: unit.pieces.map((piece) =>
      /^[lr]shin$/.test(piece.name)
        ? { ...piece, position: [0, -thigh, 0] }
        : /^[lr]foot$/.test(piece.name)
          ? { ...piece, position: [0, -(legLength - thigh), 0] }
          : piece,
    ),
    animations: [{ presetId: "walk.biped", params: {} }],
  };
}

/** How far a run of numbers spreads, the furthest two apart. */
function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

interface Stance {
  /** Where on the ground the ankle is, the body's travel added in. */
  along: number[];
  /** The ankle's height above the ground, the body's drop counted. */
  height: number[];
}

/**
 * The left foot's times on the ground after the first lap, which starts from
 * rest, found by when they are meant to be: the frames from a lap's start to
 * `down` after it. The script's thread runs a frame behind the preset's time
 * or level with it depending on when it woke, so the lap's start is the frame
 * whose thigh angle is the cycle's first pose.
 *
 * The ankle's place comes from the leg's own pieces: the shin hangs the
 * thigh's length below the hip and the foot the shin's length below the knee,
 * and a Turn about x by `a` puts a point `l` below the joint `l * sin(a)`
 * behind it and `l * cos(a)` below. The hip rests `legLength` above the
 * ground, lowered by the body's Move.
 */
function stancesOf(
  legs: LegFrame[],
  unit: LegoProject,
  speed: number,
  params: Record<string, number>,
): Stance[] {
  const lap = Math.round(params.period * FPS);
  const down = Math.round((params.duty / 100) * lap);
  const lengths = legLengths(unit);
  if (!lengths) throw new Error("the walker has no leg lengths");
  const { thighLength: a, shinLength: b } = lengths;
  const first = WALK_BIPED.track(0, params, "leg.l1.thigh")?.rotation?.[0];
  const start = [lap, lap + 1, lap - 1].find(
    (frame) => Math.abs(legs[frame].thigh - (first ?? 0)) < 1e-3,
  );
  if (start === undefined) throw new Error("no lap starts on the first pose");
  const stances: Stance[] = [];
  for (let from = start; from + down < legs.length; from += lap) {
    const run = legs.slice(from, from + down + 1);
    stances.push({
      along: run.map(
        (leg) =>
          (speed * leg.frame) / FPS -
          a * Math.sin(leg.thigh) -
          b * Math.sin(leg.thigh + leg.shin),
      ),
      height: run.map(
        (leg) =>
          a +
          b +
          leg.body -
          a * Math.cos(leg.thigh) -
          b * Math.cos(leg.thigh + leg.shin),
      ),
    });
  }
  return stances;
}

/**
 * How far rounding alone can move the ankle. `lua()` writes each angle and
 * each speed to four decimal places, so a pose lands up to half the last
 * place off, and a speed half the last place per second slow, which is that
 * over 30 in a frame. The thigh's error moves the whole leg and the shin's
 * the shin, and a spread is two such errors in opposite directions.
 */
function roundingAllowance(a: number, b: number): number {
  const angle = 0.5e-4 * (1 + 1 / FPS);
  return 2 * (a * angle + b * 2 * angle);
}

describe("a fitted walk under luajit (#3350)", () => {
  /**
   * Two legs of different lengths and proportions at one speed, stepped for
   * long enough to give several strides after the first, which starts from
   * rest. The script has a pose on every frame a foot is down, so a planted
   * foot is held to what rounding the poses to four places allows.
   */
  for (const [legLength, share] of [
    [12, 0.395],
    [30, 0.6],
  ]) {
    it(`plants a ${legLength} elmo leg's foot with a thigh ${share} of it and the knee bent`, () => {
      const speed = 40;
      const unit = walker(legLength, share, speed);
      const fitted = fittedParams(unit, "walk.biped", {});
      expect(fitted[WALK_THIGH]).toBeCloseTo(legLength * share, 9);
      expect(fitted[WALK_SHIN]).toBeCloseTo(legLength * (1 - share), 9);
      const lap = Math.round(fitted.period * FPS);
      const legs = walkLeg(
        buildLuaScript(unit),
        "lthigh",
        "lshin",
        "hip",
        lap * 6,
      );
      const stances = stancesOf(legs, unit, speed, fitted);
      expect(stances.length).toBeGreaterThanOrEqual(4);

      const allowance = roundingAllowance(
        fitted[WALK_THIGH],
        fitted[WALK_SHIN],
      );
      for (const { along, height } of stances) {
        expect(spread(along)).toBeLessThan(allowance);
        expect(spread(height)).toBeLessThan(allowance);
        // On the ground, with the body lowered to it.
        for (const h of height) expect(Math.abs(h)).toBeLessThan(allowance);
      }

      // The knee bends while the foot is down, where #3349 kept it straight.
      const knee = (frame: number) =>
        WALK_BIPED.track(frame / FPS, fitted, "leg.l1.shin")?.rotation?.[0] ??
        0;
      const down = Math.round((fitted.duty / 100) * lap);
      expect(knee(0)).toBeCloseTo(0, 6);
      expect(knee(down / 2)).toBeGreaterThan(0);
      console.log(
        `#3350 ${legLength} elmo leg, thigh ${share}: knee ${(knee(down / 2) / DEG).toFixed(1)} degrees at mid stance, along ${Math.max(...stances.map((run) => spread(run.along))).toFixed(5)}, height ${Math.max(...stances.map((run) => spread(run.height))).toFixed(5)}, allowance ${allowance.toFixed(5)}`,
      );

      // All a planted foot's travel in a cycle is the step it takes in the
      // air, which is the unit's speed times the period.
      for (let index = 1; index < stances.length; index++) {
        const lifted = stances[index - 1].along.at(-1) ?? 0;
        const landed = stances[index].along[0];
        expect(Math.abs(landed - lifted - speed * fitted.period)).toBeLessThan(
          allowance,
        );
      }
    });
  }

  it("flags a stride past the legs' reach and slides the foot only then", () => {
    // Both set by hand: 40 elmos a second for half of 1 s is a 20 elmo
    // sweep, where a 12 elmo leg swung 20 degrees either side covers 8.2.
    const speed = 40;
    const reaching = walker(12, 0.395, speed);
    const unit: LegoProject = {
      ...reaching,
      animations: [
        { presetId: "walk.biped", params: { period: 1, stride: 20 } },
      ],
    };
    const fitted = fittedParams(unit, "walk.biped", { period: 1, stride: 20 });
    expect(pastReach(fitted)).toBe(true);
    expect(problemTexts(walkProblems(unit))).toEqual([
      '"Walk, two legs" strides further than the legs reach, so the feet slide.',
    ]);
    expect(walkProblems(reaching)).toEqual([]);

    const legs = walkLeg(
      buildLuaScript(unit),
      "lthigh",
      "lshin",
      "hip",
      30 * 6,
    );
    for (const leg of legs) {
      expect(Number.isFinite(leg.thigh) && Number.isFinite(leg.shin)).toBe(
        true,
      );
    }
    // The straight leg is pointed at the foot it cannot reach, so at each
    // end of the stance the ankle falls short along the line from the hip.
    const half = (speed * fitted.period * fitted.duty) / 100 / 2;
    const leg = fitted[WALK_THIGH] + fitted[WALK_SHIN];
    const reached = (leg * half) / Math.hypot(half, leg - fitted[WALK_DROP]);
    const allowance = roundingAllowance(fitted[WALK_THIGH], fitted[WALK_SHIN]);
    const stances = stancesOf(legs, unit, speed, fitted);
    expect(stances.length).toBeGreaterThanOrEqual(4);
    for (const { along } of stances) {
      expect(Math.abs(spread(along) - 2 * (half - reached))).toBeLessThan(
        allowance,
      );
    }
  });

  it("says so when the leg joints give the solve no lengths", () => {
    const unit = walker(12, 0.395, 40);
    const upside: LegoProject = {
      ...unit,
      pieces: unit.pieces.map((piece) =>
        piece.name === "lshin" ? { ...piece, position: [0, 3, 0] } : piece,
      ),
    };
    expect(legLengths(upside)).toBeNull();
    expect(problemTexts(walkProblems(upside))).toEqual([
      'The legs do not hang down from their joints, so "Walk, two legs" cannot keep the feet planted.',
    ]);
  });
});
