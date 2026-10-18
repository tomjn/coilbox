import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { parseLegRole, WALK_SHIN, WALK_THIGH } from "./animPresets";
import { convexHull, signedDistanceToHull } from "./balance";
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
import { plantedFeet } from "./plantedFeet";
import { fittedParams, jointOf } from "./walkFit";

/**
 * The gaits of the walk for any number of legs under luajit (#3351).
 *
 * Each unit's generated script runs with the engine's piece motion stood in
 * for, as `walkFit.test.ts` does for #3350, and every leg's ankle is placed
 * from its thigh's and shin's angles on every frame. A foot counts as down
 * when its ankle is on the ground to within what rounding the poses allows.
 * From that alone, with nothing taken from the gait's own table, the checks
 * are that each leg comes down when the table says, that a foot does not slip
 * while it is down, and for the gaits that stand on their feet, that the feet
 * down on every frame surround the body.
 */

const FPS = 30;
const SPEED = 45;

let ids = 0;
const newId = () => {
  ids += 1;
  return `id${ids}`;
};

function walker(
  plan: BodyPlan,
  params: Record<string, number>,
  proportions?: Record<string, number>,
): LegoProject {
  const unit = projectFromPlan(plan, {
    ...(proportions ? { proportions } : {}),
    id: "unit",
    rootPieceId: "root",
    name: plan.label,
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
    newId,
  });
  return {
    ...unit,
    movement: { moveClass: "BOT2", speed: SPEED },
    animations: [{ presetId: "walk.legs", params }],
  };
}

interface Leg {
  role: string;
  side: "l" | "r";
  pair: number;
  thigh: string;
  shin: string;
  /** The hip joint, x and z in the unit. */
  hip: [number, number];
  thighId: string;
}

function legsOf(unit: LegoProject): Leg[] {
  const named = (role: string) => {
    const piece = unit.pieces.find((entry) => entry.role === role);
    if (!piece) throw new Error(`no ${role}`);
    return piece;
  };
  return unit.pieces.flatMap((piece) => {
    const leg = parseLegRole(piece.role ?? "");
    if (leg?.segment !== "thigh") return [];
    const [x, , z] = jointOf(unit, piece);
    return [
      {
        role: piece.role as string,
        side: leg.side,
        pair: leg.pair,
        thigh: piece.name,
        shin: named(`leg.${leg.side}${leg.pair}.shin`).name,
        hip: [x, z] as [number, number],
        thighId: piece.id,
      },
    ];
  });
}

/**
 * Runs the script for `frames` frames from `StartMoving` on frame 0 and returns,
 * per frame, the body's y offset and each leg's thigh and shin x angles in the
 * order of `legs`. `Turn` and `Move` with a speed head for their target at
 * speed / 30 a frame (`CUnitScript::TickTurnAnim`), and `Sleep(ms)` wakes the
 * thread `floor(ms / 33)` frames later, as the unit script gadget's does.
 */
function run(
  lua: string,
  body: string,
  legs: Leg[],
  frames: number,
): { body: number; angles: [number, number][] }[] {
  const outputs = legs
    .map(
      (leg) =>
        `" ", anim("turn", "${leg.thigh}", x_axis).at, " ", anim("turn", "${leg.shin}", x_axis).at`,
    )
    .join(", ");
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
SFX = { SHATTER = 1 }
COB = {}
local frame = 0
local anims = {}
local threads = {}
local current = nil
function anim(kind, p, axis)
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
  io.write(anim("move", "${body}", y_axis).at, ${outputs}, "\\n")
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
      const [bodyY, ...rest] = line.trim().split(/\s+/).map(Number);
      return {
        body: bodyY,
        angles: legs.map(
          (_, i) => [rest[2 * i], rest[2 * i + 1]] as [number, number],
        ),
      };
    });
}

/** `walkFit.test.ts`'s allowance for what rounding poses and speeds to four
 *  places can move the ankle, the bound #3350 holds a planted foot to. */
function roundingAllowance(a: number, b: number): number {
  const angle = 0.5e-4 * (1 + 1 / FPS);
  return 2 * (a * angle + b * 2 * angle);
}

/**
 * The frame of the cycle a leg's foot comes down on after the front left's, by
 * the 2n legged wave gait as Song and Choi (1990) give it, written out again
 * here rather than read from `waveTouchdown`: the left leg of pair k lands
 * `(k - 1) * duty` of a cycle after the front left, and each right leg half a
 * cycle after its left.
 */
function tableLanding(
  side: "l" | "r",
  pair: number,
  down: number,
  lap: number,
) {
  const share = ((pair - 1) * down) / lap + (side === "r" ? 0.5 : 0);
  return Math.round((share - Math.floor(share)) * lap) % lap;
}

interface Gait {
  name: string;
  plan: BodyPlan;
  duty?: number;
  proportions?: Record<string, number>;
  /** Whether the body stays over the feet on every frame, false for a gait
   *  that does not stand on its own feet, and "falls" for one whose feet the
   *  check should find do not surround the body. */
  standing: boolean | "falls";
}

const GAITS: Gait[] = [
  {
    name: "the tripod, six legs at the default",
    plan: HEXAPOD,
    standing: true,
  },
  { name: "six legs at 70%", plan: HEXAPOD, duty: 70, standing: true },
  {
    name: "the alternating tetrapod, eight legs at the default",
    plan: OCTOPOD,
    standing: true,
  },
  { name: "eight legs at 80%", plan: OCTOPOD, duty: 80, standing: true },
  {
    name: "the crawl, four legs at the default",
    plan: QUADRUPED,
    standing: true,
  },
  // Neither stands on its own feet, so only the phases and the slip are checked.
  {
    name: "the trot, four legs at 50%",
    plan: QUADRUPED,
    duty: 50,
    standing: false,
  },
  { name: "two legs in opposition", plan: BIPED, standing: false },
  // The balance check's own falsification. With the pairs 10 elmos apart, a
  // tripod's feet move further back under the body than the gap between
  // pairs, and the body tips out of the three feet at the end of each stance.
  {
    name: "a tripod with its pairs too close for its stride",
    plan: HEXAPOD,
    proportions: { legGap: 10 },
    standing: "falls",
  },
];

describe("the walk for any number of legs under luajit (#3351)", () => {
  for (const gait of GAITS) {
    it(`walks ${gait.name}`, () => {
      const unit = walker(
        gait.plan,
        gait.duty === undefined ? {} : { duty: gait.duty },
        gait.proportions,
      );
      const params = fittedParams(
        unit,
        "walk.legs",
        unit.animations?.[0]?.params ?? {},
      );
      const a = params[WALK_THIGH];
      const b = params[WALK_SHIN];
      expect(a).toBeGreaterThan(0);
      const lap = Math.round(params.period * FPS);
      const down = Math.round((params.duty / 100) * lap);
      const legs = legsOf(unit);
      const body = unit.pieces.find((piece) => piece.role === "base");
      if (!body) throw new Error("no body");
      const laps = 7;
      const frames = run(buildLuaScript(unit), body.name, legs, lap * laps);
      const allowance = roundingAllowance(a, b);

      // Where each ankle is on each frame: x and z on the ground under the
      // body, its height above the ground, and z with the body's travel added
      // so a planted foot's stays still.
      const placed = frames.map((frame, f) =>
        legs.map((leg, i) => {
          const [thigh, shin] = frame.angles[i];
          const ahead = -a * Math.sin(thigh) - b * Math.sin(thigh + shin);
          return {
            x: leg.hip[0],
            z: leg.hip[1] + ahead,
            along: leg.hip[1] + ahead + (SPEED * f) / FPS,
            height:
              a +
              b +
              frame.body -
              a * Math.cos(thigh) -
              b * Math.cos(thigh + shin),
          };
        }),
      );
      const from = 2 * lap;
      const isDown = (f: number, i: number) =>
        Math.abs(placed[f][i].height) < allowance;

      // Each leg's runs of frames down, after the first laps from rest.
      let slipAlong = 0;
      let slipHeight = 0;
      const landings = legs.map((_, i) => {
        const starts: number[] = [];
        for (let f = from; f < frames.length; f++) {
          if (!isDown(f, i) || isDown(f - 1, i)) continue;
          let end = f;
          while (end + 1 < frames.length && isDown(end + 1, i)) end++;
          if (end + 1 >= frames.length) break;
          starts.push(f);
          const run = placed.slice(f, end + 1).map((frame) => frame[i]);
          const spread = (values: number[]) =>
            Math.max(...values) - Math.min(...values);
          slipAlong = Math.max(slipAlong, spread(run.map((p) => p.along)));
          slipHeight = Math.max(slipHeight, spread(run.map((p) => p.height)));
          // Down for the share of the cycle the walk says.
          expect(end - f).toBe(down);
        }
        return starts;
      });
      expect(slipAlong).toBeLessThan(allowance);
      expect(slipHeight).toBeLessThan(allowance);

      // Each leg comes down the table's share of a cycle after the front left.
      const front = legs.findIndex((leg) => leg.side === "l" && leg.pair === 1);
      const phases: string[] = [];
      legs.forEach((leg, i) => {
        expect(landings[i].length).toBeGreaterThanOrEqual(laps - 4);
        const measured =
          (((landings[i][0] - landings[front][0]) % lap) + lap) % lap;
        expect(measured).toBe(tableLanding(leg.side, leg.pair, down, lap));
        phases.push(`${leg.side}${leg.pair} ${measured}`);
        // Every lap, not only the first.
        for (let k = 1; k < landings[i].length; k++) {
          expect(landings[i][k] - landings[i][k - 1]).toBe(lap);
        }
      });

      // The feet down on every frame surround the body's centre, the body
      // joint, which the plans put midway between the hips.
      let margin = Number.POSITIVE_INFINITY;
      let fewest = Number.POSITIVE_INFINITY;
      if (gait.standing) {
        for (let f = from; f < frames.length; f++) {
          const feet = placed[f].filter((_, i) => isDown(f, i));
          fewest = Math.min(fewest, feet.length);
          const hull = convexHull(feet.map((p) => [p.x, p.z]));
          const inside = -signedDistanceToHull([0, 0], hull);
          margin = Math.min(margin, inside);
        }
        if (gait.standing === "falls") {
          expect(margin).toBeLessThan(0);
        } else {
          expect(fewest).toBeGreaterThanOrEqual(3);
          expect(margin).toBeGreaterThan(0);
        }
      }

      // The preview's marker is on every leg that is down, and only those,
      // give or take the one frame the script's thread runs off the preset's
      // time depending on when it woke. That frame is the same for every leg
      // and every lap.
      const events = [
        { frame: 0, callin: "Create" },
        { frame: 0, callin: "StartMoving" },
      ];
      const marks = plantedFeet(unit, events, frames.length);
      if (!marks) throw new Error("no planted feet marked");
      const shifts = [-1, 0, 1].filter((shift) => {
        for (let f = from; f + 1 < frames.length; f++) {
          for (let i = 0; i < legs.length; i++) {
            if (marks[f].has(legs[i].thighId) !== isDown(f + shift, i)) {
              return false;
            }
          }
        }
        return true;
      });
      expect(shifts).toHaveLength(1);

      console.log(
        `#3351 ${gait.name}: ${legs.length} legs, lap ${lap} frames, down ${down}, landings ${phases.join(", ")}, slip along ${slipAlong.toFixed(5)}, up and down ${slipHeight.toFixed(5)}, allowance ${allowance.toFixed(5)}${gait.standing ? `, fewest feet down ${fewest}, centre inside the feet by at least ${margin.toFixed(2)} elmos (negative is outside)` : ""}`,
      );
    });
  }
});
