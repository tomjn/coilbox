import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { PRESETS } from "./animPresets";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";

const FPS = 30;
const DEG = Math.PI / 180;

function piece(
  name: string,
  role: string | undefined,
  parentId: string,
  extra: Partial<LegoPiece> = {},
): LegoPiece {
  return {
    id: name,
    name,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...(role ? { role } : {}),
    ...extra,
  };
}

/** A hull carrying a turret that carries a barrel, with a flare on the barrel
 *  or beside it. */
function unit(
  animations: { presetId: string; params?: Record<string, number> }[],
  options: {
    turretLimits?: LegoPiece["limits"];
    looseFlare?: boolean;
    second?: boolean;
  } = {},
): LegoProject {
  const base = newProject({
    id: "tank",
    rootPieceId: "root",
    name: "Tank",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-18T00:00:00Z",
  });
  const pieces = [
    piece("hull", "base", "root"),
    piece("turret", "turret", "hull", {
      ...(options.turretLimits ? { limits: options.turretLimits } : {}),
    }),
    piece("barrel", "barrel", "turret"),
    piece("flare", "flare", options.looseFlare ? "turret" : "barrel"),
    ...(options.second
      ? [
          piece("turret2", "turret", "hull"),
          piece("barrel2", "barrel", "turret2"),
        ]
      : []),
  ];
  return {
    ...base,
    pieces: [...base.pieces, ...pieces],
    animations: animations.map((entry) => ({
      presetId: entry.presetId,
      params: entry.params ?? {},
    })),
  };
}

interface Event {
  frame: number;
  call: string;
  args?: number[];
}

interface Watch {
  piece: string;
  /** "Move" or "Turn". */
  kind: "Move" | "Turn";
  axis: 1 | 2 | 3;
}

interface Sample {
  /** Per watch, the value at the end of each frame. */
  series: number[][];
  /** Every Move and Turn call: frame, kind, piece, axis, destination, speed. */
  calls: {
    frame: number;
    kind: string;
    piece: string;
    axis: number;
    dest: number;
    speed: number;
  }[];
}

/**
 * Runs a generated script under luajit with the engine stubbed. Pieces move
 * the way the engine moves them: a Move or Turn heads for its destination at
 * its speed a second, one frame at a time, and WaitForMove and WaitForTurn
 * hold the thread until it arrives. `Create` fires on frame 0. Threads sleep,
 * wake and are killed by Signal as the unit script framework's are.
 */
function run(
  lua: string,
  events: Event[],
  frames: number,
  watch: Watch[],
): Sample {
  const harness = `
x_axis, y_axis, z_axis = 1, 2, 3
local frame = 0
local threads = {}
local current = nil
local anims = {}
local state = {}
local calls = {}
function piece(name) return name end
local function key(p, axis, kind) return kind .. " " .. p .. " " .. axis end
local function start(kind, p, axis, dest, speed)
  assert(type(speed) == "number" or speed == nil, kind .. " speed")
  calls[#calls + 1] = string.format("C %d %s %s %d %.9g %.9g", frame, kind, p, axis, dest, speed or -1)
  local k = key(p, axis, kind)
  if speed == nil or speed == 0 then
    state[k] = dest
    anims[k] = nil
  else
    anims[k] = { dest = dest, speed = speed }
  end
end
function Move(p, axis, dest, speed) start("Move", p, axis, dest, speed) end
function Turn(p, axis, dest, speed) start("Turn", p, axis, dest, speed) end
function MoveNow(p, axis, dest) start("Move", p, axis, dest, nil) end
function TurnNow(p, axis, dest) start("Turn", p, axis, dest, nil) end
function Spin() end
function StopSpin() end
function Explode() end
function Hide() end
function Show() end
function GetUnitValue() return 0 end
function SetUnitValue() end
local function arrived(kind, p, axis) return anims[key(p, axis, kind)] == nil end
function WaitForMove(p, axis) current.waiting = { "Move", p, axis }; coroutine.yield(0) end
function WaitForTurn(p, axis) current.waiting = { "Turn", p, axis }; coroutine.yield(0) end
function SetSignalMask(mask) current.mask = mask end
function Signal(mask)
  for _, t in ipairs(threads) do
    if t.mask == mask then t.dead = true end
  end
end
function Sleep(ms) coroutine.yield(math.floor(ms / 33)) end
local function resume(t)
  local previous = current
  current = t
  t.waiting = nil
  local ok, wait = coroutine.resume(t.co)
  current = previous
  assert(ok, wait)
  t.wake = frame + (wait or 0)
end
function StartThread(fn, ...)
  local args = { ... }
  local t = { co = coroutine.create(function() fn(unpack(args)) end) }
  threads[#threads + 1] = t
  resume(t)
end
SFX = { SHATTER = 1 }
script = {}
local chunk = assert(loadstring(io.read("*a")))
chunk()

-- A call-in runs as its own thread, as the unit script gadget runs it.
local function fire(name, args)
  local fn = script[name]
  if not fn then return end
  StartThread(fn, unpack(args))
end

local events = {}
${events
  .map(
    (event) =>
      `events[#events + 1] = { frame = ${event.frame}, call = "${event.call}", args = {${(event.args ?? []).join(",")}} }`,
  )
  .join("\n")}
local watch = {
${watch.map((w) => `  { kind = "${w.kind}", piece = "${w.piece}", axis = ${w.axis} },`).join("\n")}
}
local series = {}
for i = 1, #watch do series[i] = {} end

fire("Create", {})
for f = 0, ${frames - 1} do
  frame = f
  for _, event in ipairs(events) do
    if event.frame == f then fire(event.call, event.args) end
  end
  for _, t in ipairs(threads) do
    if not t.dead and coroutine.status(t.co) == "suspended" then
      local ready
      if t.waiting then
        ready = arrived(t.waiting[1], t.waiting[2], t.waiting[3])
      else
        ready = t.wake <= f
      end
      if ready then resume(t) end
    end
  end
  for k, a in pairs(anims) do
    local now = state[k] or 0
    local step = a.speed / ${FPS}
    if math.abs(a.dest - now) <= step then
      state[k] = a.dest
      anims[k] = nil
    else
      state[k] = now + (a.dest > now and step or -step)
    end
  end
  for i, w in ipairs(watch) do
    series[i][#series[i] + 1] = state[key(w.piece, w.axis, w.kind)] or 0
  end
end
for i = 1, #watch do io.write("S " .. i .. " " .. table.concat(series[i], " ") .. "\\n") end
for _, c in ipairs(calls) do io.write(c .. "\\n") end
`;
  const result = spawnSync("luajit", ["-e", harness], { input: lua });
  if (result.status !== 0) {
    throw new Error(`luajit failed: ${result.stderr.toString()}`);
  }
  const sample: Sample = { series: watch.map(() => []), calls: [] };
  for (const line of result.stdout.toString().split("\n").filter(Boolean)) {
    const parts = line.split(" ");
    if (parts[0] === "S") {
      sample.series[Number(parts[1]) - 1] = parts.slice(2).map(Number);
    } else if (parts[0] === "C") {
      sample.calls.push({
        frame: Number(parts[1]),
        kind: parts[2],
        piece: parts[3],
        axis: Number(parts[4]),
        dest: Number(parts[5]),
        speed: Number(parts[6]),
      });
    }
  }
  return sample;
}

describe("the presets exist and are opt in", () => {
  it("adds body.settle and idle.look, and leaves the others' ids alone", () => {
    const ids = PRESETS.map((preset) => preset.id);
    expect(ids).toContain("body.settle");
    expect(ids).toContain("idle.look");
    expect(ids).toContain("recoil");
    expect(ids).toContain("idle.sway");
  });

  it("writes no RockUnit into a unit that has not asked for the settle", () => {
    for (const animations of [
      [],
      [{ presetId: "recoil" }],
      [{ presetId: "idle.look" }],
      [{ presetId: "body.rock" }],
    ]) {
      expect(buildLuaScript(unit(animations))).not.toContain("RockUnit");
    }
  });
});

describe("recoil", () => {
  const kick = 0.5;
  const kickTime = 0.1;
  const returnTime = 0.6;
  const lua = buildLuaScript(
    unit([{ presetId: "recoil", params: { kick, kickTime, returnTime } }]),
  );
  const barrel: Watch = { piece: "barrel", kind: "Move", axis: 3 };

  it("moves the barrel back by the distance and home in the return time", () => {
    const shot = 10;
    const { series } = run(lua, [{ frame: shot, call: "Shot1" }], 60, [barrel]);
    const z = series[0];
    const oneFrame = kick / (kickTime * FPS);
    // At rest before the shot.
    expect(z[shot - 1]).toBe(0);
    // Back by the distance, within a frame of the move.
    const deepest = Math.min(...z);
    expect(deepest).toBeCloseTo(-kick, 6);
    // The kick takes the kick time to the frame.
    const reached = z.findIndex((v) => v <= -kick + 1e-9);
    expect(Math.abs(reached - shot - kickTime * FPS)).toBeLessThanOrEqual(1);
    // Home again after the return time, within a frame.
    const home = z.findIndex((v, i) => i > reached && v >= -1e-9);
    expect(home).toBeGreaterThan(reached);
    expect(Math.abs(home - reached - returnTime * FPS)).toBeLessThanOrEqual(2);
    expect(Math.abs(z[home])).toBeLessThanOrEqual(oneFrame);
    // And it stays home.
    expect(z[z.length - 1]).toBe(0);
  });

  it("kicks each weapon's own barrel and no other", () => {
    const two = buildLuaScript(
      unit([{ presetId: "recoil", params: { kick, kickTime, returnTime } }], {
        second: true,
      }),
    );
    const first: Watch = { piece: "barrel", kind: "Move", axis: 3 };
    const other: Watch = { piece: "barrel2", kind: "Move", axis: 3 };
    const { series } = run(two, [{ frame: 5, call: "Shot2" }], 40, [
      first,
      other,
    ]);
    expect(Math.min(...series[0])).toBe(0);
    expect(Math.min(...series[1])).toBeCloseTo(-kick, 6);
  });

  it("restarts cleanly when the weapon fires again before the barrel is home", () => {
    const { series } = run(
      lua,
      [
        { frame: 5, call: "Shot1" },
        { frame: 12, call: "Shot1" },
      ],
      60,
      [barrel],
    );
    expect(Math.min(...series[0])).toBeCloseTo(-kick, 6);
    expect(series[0][series[0].length - 1]).toBe(0);
  });

  it("moves a flare beside the barrel with it, and leaves one on the barrel alone", () => {
    const params = { kick, kickTime, returnTime };
    const beside = buildLuaScript(
      unit([{ presetId: "recoil", params }], { looseFlare: true }),
    );
    const on = buildLuaScript(unit([{ presetId: "recoil", params }]));
    const flare: Watch = { piece: "flare", kind: "Move", axis: 3 };
    const movedBeside = run(beside, [{ frame: 5, call: "Shot1" }], 40, [flare]);
    const movedOn = run(on, [{ frame: 5, call: "Shot1" }], 40, [flare]);
    expect(Math.min(...movedBeside.series[0])).toBeCloseTo(-kick, 6);
    // A flare under the barrel is carried by it, and moving it too would
    // kick it twice.
    expect(Math.min(...movedOn.series[0])).toBe(0);
  });
});

describe("body.settle", () => {
  const lean = 6;
  const settle = 0.2;
  const lua = buildLuaScript(
    unit([{ presetId: "body.settle", params: { lean, settle } }]),
  );
  const pitch: Watch = { piece: "hull", kind: "Turn", axis: 1 };
  const roll: Watch = { piece: "hull", kind: "Turn", axis: 3 };

  it("defines RockUnit with the engine's two arguments", () => {
    expect(lua).toContain("function script.RockUnit(rockDir_x, rockDir_z)");
  });

  it("pitches the nose up when the shot goes forward, and settles level", () => {
    // Fired along +z, so the unit is pushed along -z.
    const { series } = run(
      lua,
      [{ frame: 5, call: "RockUnit", args: [0, -1] }],
      90,
      [pitch, roll],
    );
    const x = series[0];
    // The nose lifts, which is a negative turn about x (BODY_ROCK, AIM_TRACK).
    expect(Math.min(...x)).toBeCloseTo(-lean * DEG, 2);
    expect(Math.max(...x)).toBe(0);
    // No roll for a shot straight ahead.
    expect(Math.max(...series[1].map(Math.abs))).toBeLessThan(1e-9);
    // Settled to level and staying there.
    expect(x[x.length - 1]).toBe(0);
    // It eases back rather than snapping: part way down a settle time after
    // the peak, the lean has dropped by the share a first order lag leaves.
    const peak = x.indexOf(Math.min(...x));
    const after = x[peak + Math.round(settle * FPS)];
    expect(after / x[peak]).toBeGreaterThan(0.2);
    expect(after / x[peak]).toBeLessThan(0.55);
  });

  it("tips the other way for a shot the other way", () => {
    const back = run(lua, [{ frame: 5, call: "RockUnit", args: [0, 1] }], 90, [
      pitch,
    ]).series[0];
    expect(Math.max(...back)).toBeCloseTo(lean * DEG, 2);
  });

  it("rolls opposite the sideways part of the shot", () => {
    // Fired along +x, so the unit is pushed along -x. Its top goes with the
    // push, which is a positive turn about z.
    const { series } = run(
      lua,
      [{ frame: 5, call: "RockUnit", args: [-1, 0] }],
      90,
      [pitch, roll],
    );
    expect(Math.max(...series[1])).toBeCloseTo(lean * DEG, 2);
    expect(Math.max(...series[0].map(Math.abs))).toBeLessThan(1e-9);
  });

  it("splits a diagonal shot between pitch and roll in proportion", () => {
    const r = Math.SQRT1_2;
    const { series } = run(
      lua,
      [{ frame: 5, call: "RockUnit", args: [r, -r] }],
      90,
      [pitch, roll],
    );
    expect(Math.min(...series[0])).toBeCloseTo(-lean * DEG * r, 2);
    expect(Math.min(...series[1])).toBeCloseTo(-lean * DEG * r, 2);
  });
});

describe("idle.look", () => {
  const delay = 4;
  const params = { delay, speed: 30, pause: 1, turn: 40 };
  const limits = { yaw: { min: -20, max: 50 } };
  const lua = buildLuaScript(
    unit([{ presetId: "idle.look", params }], { turretLimits: limits }),
  );
  const yaw: Watch = { piece: "turret", kind: "Turn", axis: 2 };
  const turns = (sample: Sample) =>
    sample.calls.filter((c) => c.kind === "Turn" && c.piece === "turret");

  it("does nothing until the delay has passed, then starts", () => {
    const sample = run(lua, [], 20 * FPS, [yaw]);
    const first = turns(sample)[0];
    expect(first).toBeDefined();
    // Not before the delay, and within a poll of it.
    expect(first.frame).toBeGreaterThanOrEqual(delay * FPS);
    expect(first.frame).toBeLessThanOrEqual(delay * FPS + 10);
  });

  it("starts for a unit that has never moved, from Create alone", () => {
    expect(lua).toMatch(
      /function script\.Create\(\)\n {2}StartThread\(idleLook\)/,
    );
  });

  it("stays inside the turret's yaw range", () => {
    const sample = run(lua, [], 120 * FPS, [yaw]);
    const destinations = turns(sample).map((c) => c.dest / DEG);
    expect(destinations.length).toBeGreaterThan(3);
    for (const d of destinations) {
      expect(d).toBeGreaterThanOrEqual(limits.yaw.min - 1e-3);
      expect(d).toBeLessThanOrEqual(limits.yaw.max + 1e-3);
    }
    for (const value of sample.series[0]) {
      expect(value / DEG).toBeGreaterThanOrEqual(limits.yaw.min - 1e-3);
      expect(value / DEG).toBeLessThanOrEqual(limits.yaw.max + 1e-3);
    }
  });

  it("uses the turn slider each side of centre when the turret has no range", () => {
    const free = buildLuaScript(unit([{ presetId: "idle.look", params }]));
    const sample = run(free, [], 120 * FPS, [yaw]);
    const reach = Math.max(...turns(sample).map((c) => Math.abs(c.dest / DEG)));
    expect(reach).toBeGreaterThan(5);
    expect(reach).toBeLessThanOrEqual(params.turn + 1e-3);
  });

  it("looks slowly: no turn is faster than the speed slider", () => {
    const sample = run(lua, [], 60 * FPS, [yaw]);
    for (const c of turns(sample)) {
      expect(c.speed).toBeLessThanOrEqual(params.speed * DEG + 1e-3);
    }
  });

  it("stops on StartMoving, and brings the turret home", () => {
    const moveAt = 8 * FPS;
    const sample = run(
      lua,
      [{ frame: moveAt, call: "StartMoving" }],
      40 * FPS,
      [yaw],
    );
    const before = turns(sample).filter((c) => c.frame < moveAt);
    expect(before.length).toBeGreaterThan(0);
    const after = turns(sample).filter((c) => c.frame >= moveAt);
    // The one turn after is the one that centres the turret.
    expect(after.map((c) => c.dest)).toEqual([0]);
    expect(sample.series[0][sample.series[0].length - 1]).toBe(0);
  });

  it("starts again after StopMoving and the delay", () => {
    const sample = run(
      lua,
      [
        { frame: 8 * FPS, call: "StartMoving" },
        { frame: 12 * FPS, call: "StopMoving" },
      ],
      40 * FPS,
      [yaw],
    );
    const again = turns(sample).filter(
      (c) => c.frame > 12 * FPS && c.dest !== 0,
    );
    expect(again.length).toBeGreaterThan(0);
    // The thread counts on its own poll, so the delay is kept to within one.
    expect(again[0].frame).toBeGreaterThanOrEqual(12 * FPS + delay * FPS - 10);
    expect(again[0].frame).toBeLessThanOrEqual(12 * FPS + delay * FPS + 10);
  });

  it("stops on AimWeapon, and waits the delay again after it", () => {
    const aimAt = 8 * FPS;
    const sample = run(
      lua,
      [{ frame: aimAt, call: "AimWeapon1", args: [0, 0] }],
      40 * FPS,
      [yaw],
    );
    const during = turns(sample).filter(
      (c) => c.frame >= aimAt && c.frame < aimAt + delay * FPS,
    );
    expect(during).toEqual([]);
    const resumed = turns(sample).filter((c) => c.frame >= aimAt + delay * FPS);
    expect(resumed.length).toBeGreaterThan(0);
  });

  it("keeps still while the weapon keeps aiming and firing", () => {
    const events: Event[] = [];
    for (let f = 5 * FPS; f < 30 * FPS; f += 2 * FPS) {
      events.push({ frame: f, call: "AimWeapon1", args: [0, 0] });
      events.push({ frame: f + 15, call: "Shot1" });
    }
    const sample = run(lua, events, 30 * FPS, [yaw]);
    const late = turns(sample).filter((c) => c.frame >= 5 * FPS + 10);
    expect(late).toEqual([]);
  });

  it("gives each turret its own look", () => {
    const two = buildLuaScript(
      unit([{ presetId: "idle.look", params }], { second: true }),
    );
    const sample = run(two, [], 30 * FPS, [yaw]);
    const pieces = new Set(
      sample.calls.filter((c) => c.kind === "Turn").map((c) => c.piece),
    );
    expect(pieces).toEqual(new Set(["turret", "turret2"]));
  });
});

describe("idle.sway", () => {
  it("plays on a unit that has not moved, from Create", () => {
    const lua = buildLuaScript(unit([{ presetId: "idle.sway" }]));
    const sample = run(lua, [], 3 * FPS, [
      { piece: "hull", kind: "Turn", axis: 2 },
    ]);
    expect(Math.max(...sample.series[0].map(Math.abs))).toBeGreaterThan(0);
  });

  it("stands down on StartMoving", () => {
    const lua = buildLuaScript(unit([{ presetId: "idle.sway" }]));
    const sample = run(
      lua,
      [{ frame: 2 * FPS, call: "StartMoving" }],
      10 * FPS,
      [{ piece: "hull", kind: "Turn", axis: 2 }],
    );
    expect(sample.series[0][sample.series[0].length - 1]).toBe(0);
  });
});
