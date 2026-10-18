import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type AnimPreset,
  BUILD_PREVIEW_AIM,
  BUILD_PREVIEW_LEG,
  cycleSteps,
  PRESETS,
  RECOIL_PREVIEW_PAUSE,
  type TrackDelta,
} from "./animPresets";
import { buildLuaScript } from "./luaScript";
import { type LegoPiece, type LegoProject, newProject } from "./model";
import { at, CREATED, type ScriptEvent } from "./scriptPlayback";
import { fitWalk } from "./walkFit";

/**
 * Every preset moves the same in the Lua it writes as in its own `track()`
 * (#3242).
 *
 * This file builds a unit for each preset, generates its script, works out the
 * call-ins that set it going and writes down where `track()` says each piece
 * should be on every frame. The Lua is run by coilbox's own runtime, which
 * vitest cannot reach, so all of that goes into a fixture and
 * `crates/coilbox-springlua/tests/preset_parity.rs` runs the scripts and
 * compares. The test here fails when the fixture is out of date, so a change to
 * a preset cannot leave the Rust side checking the old one.
 *
 * Regenerate after an intended change with:
 *   UPDATE_PRESET_PARITY=1 bun run test presetParity
 * then run the Rust side:
 *   cargo test -p coilbox-springlua --test preset_parity -- --nocapture
 *
 * How close is close enough comes from two things, both measured rather than
 * picked:
 *
 * - One frame of the preview's own motion. The engine moves a piece once a
 *   frame, at 30 frames a second, so a pose that lands one frame early or late
 *   is as near as a script can get. The allowance is the furthest `track()`
 *   itself moves in one frame over what is compared.
 * - The four decimal places `lua()` writes every angle, distance and speed to.
 *   A destination can be off by half the last place, and a speed off by the
 *   same per second, which adds up over a run. So the allowance grows by that
 *   much for every second the run lasts.
 *
 * Where the Lua is meant to move in straight lines and `track()` is a curve, a
 * Turn or a Move going at one speed cannot follow it. The gap between the curve
 * and the straight line is measured from `track()` and added, and the cycle
 * presets assert that gap stays inside one frame of motion.
 */

const FIXTURE = join(
  __dirname,
  "../../crates/coilbox-springlua/tests/fixtures/preset-parity.json",
);

/** The engine's `GAME_SPEED`, and the runtime's `FPS`. */
const FPS = 30;
/** The runtime's `MAX_FRAMES` in `crates/coilbox-unitpose`: it runs no more. */
const MAX_FRAMES = FPS * 30;
/** Half the last of the four decimal places `lua()` writes. */
const LUA_ROUNDING = 0.5e-4;
/** When the call-in that starts a preset fires, after `Create` has finished. */
const CALLIN = at(0.5);

/**
 * Where a target sits when a sweep or lift slider is at 0. The piece is meant
 * to hold still, so the call-in is given a heading and pitch it would snap to
 * if the script turned it (#4120).
 */
const UNTRAVELLED_HEADING = 30;
const UNTRAVELLED_PITCH = 10;

const deg = (degrees: number) => (degrees * Math.PI) / 180;

function param(
  preset: AnimPreset,
  params: Record<string, number>,
  id: string,
): number {
  return (
    params[id] ?? preset.params.find((entry) => entry.id === id)?.fallback ?? 0
  );
}

/** A delta as the runtime lays a pose out: x, y, z offset then rotation. */
function channels(delta: TrackDelta | null): number[] {
  return [...(delta?.position ?? [0, 0, 0]), ...(delta?.rotation ?? [0, 0, 0])];
}

/** One piece per role the preset touches, named after the role. */
function unitFor(
  preset: AnimPreset,
  params: Record<string, number>,
): LegoProject {
  const roles = [
    ...new Set([
      ...preset.animates,
      ...preset.requires.map((need) => need.role),
    ]),
  ];
  const base = newProject({
    id: "parity",
    rootPieceId: "root",
    name: "parity",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-16T00:00:00Z",
  });
  const pieces: LegoPiece[] = roles.map((role) => ({
    id: role,
    // The root is already called base, so the body role gets another name.
    name: role === "base" ? "body" : role.replace(/\./g, "_"),
    parentId: "root",
    partId: "x",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role,
  }));
  return {
    ...base,
    pieces: [...base.pieces, ...pieces],
    animations: [{ presetId: preset.id, params }],
  };
}

/**
 * A run of frames compared against `track()`.
 *
 * `t0` is the preset's time on frame `from`, and the time moves on a frame per
 * frame from there unless `hold` keeps it still.
 */
interface Span {
  from: number;
  to: number;
  t0: number;
  hold?: boolean;
  /**
   * Preset times the Lua is meant to pass through in straight lines. Between
   * two of them `track()` may bow away from that line, and the furthest it
   * does is part of the allowance. Wrapped by `period` when there is one.
   */
  knots?: number[];
  period?: number;
}

interface Plan {
  events: ScriptEvent[];
  frames: number;
  spans: Span[];
  /** What is not compared, and why. Written into the fixture so the Rust side
   *  says it alongside its result. */
  exceptions: string[];
}

const FIRST_LAP =
  "The first lap starts from rest rather than from the cycle's first pose, so it is not compared. Every lap after it is.";

function cyclePlan(
  preset: AnimPreset,
  params: Record<string, number>,
  callin: string,
  frame: number,
): Plan {
  const period = Math.max(param(preset, params, "period"), 0.05);
  const lap = Math.round(period * FPS);
  const frames = Math.min(frame + 2 * lap + 1, MAX_FRAMES);
  return {
    events: [
      ...CREATED.filter((event) => !(callin === "Create" && event.frame === 0)),
      { frame, callin },
    ],
    frames,
    spans: [
      {
        from: frame + lap,
        to: frames - 1,
        t0: lap / FPS,
        // The poses `cycleThread` samples, as preset times.
        knots: cycleSteps(preset, params, period).map((frame) => frame / FPS),
        period,
      },
    ],
    exceptions: [FIRST_LAP],
  };
}

/** Turret sweep and aim point, which aim once and hold. */
function aimPlan(preset: AnimPreset, params: Record<string, number>): Plan {
  const period = param(preset, params, "period");
  // Where the preview's sweep is furthest out, and so the aim it stands for.
  const lands = period / 4;
  const landFrame = CALLIN + Math.round(lands * FPS);
  const frames = landFrame + FPS + 1;
  // Half a turn is as short one way round as the other, and the engine's
  // `CUnitScript::TurnToward` and the runtime both take it as backwards, where
  // the preview sweeps forwards. Either is a fair way to get behind the unit.
  const halfTurn = param(preset, params, "sweep") >= 180;
  return {
    events: [
      ...CREATED,
      {
        frame: CALLIN,
        callin: "AimWeapon1",
        args: [
          deg(param(preset, params, "sweep") || UNTRAVELLED_HEADING),
          deg(param(preset, params, "pitch") || UNTRAVELLED_PITCH),
        ],
      },
    ],
    frames,
    spans: [
      ...(halfTurn
        ? []
        : [{ from: CALLIN, to: landFrame, t0: 0, knots: [0, lands] }]),
      { from: landFrame, to: frames - 1, t0: lands, hold: true },
    ],
    exceptions: [
      "Aimed at the sweep's furthest point, which is the pose the preview stands for. On the way there the preview follows a curve and Turn moves at one speed, so the gap between the two is part of the allowance.",
      "After it lands the preview sweeps back for its demonstration. The Lua holds until it is aimed again, so it is compared with the landing pose.",
      ...(halfTurn
        ? [
            "A sweep of half a turn is as short backwards as forwards, and the engine turns backwards where the preview sweeps forwards, so only the landing is compared.",
          ]
        : []),
    ],
  };
}

function recoilPlan(preset: AnimPreset, params: Record<string, number>): Plan {
  const cycle =
    Math.max(param(preset, params, "kickTime"), 0.01) +
    Math.max(param(preset, params, "returnTime"), 0.01) +
    RECOIL_PREVIEW_PAUSE;
  const gap = Math.round(cycle * FPS);
  const frames = CALLIN + 2 * gap + 1;
  return {
    events: [
      ...CREATED,
      { frame: CALLIN, callin: "Shot1" },
      { frame: CALLIN + gap, callin: "Shot1" },
    ],
    frames,
    spans: [{ from: CALLIN, to: frames - 1, t0: 0 }],
    exceptions: [
      "The preview repeats the kick after RECOIL_PREVIEW_PAUSE. A game kicks once per shot, so this fires two shots that far apart.",
    ],
  };
}

function buildAimPlan(
  preset: AnimPreset,
  params: Record<string, number>,
): Plan {
  const leg = Math.round(BUILD_PREVIEW_LEG * FPS);
  const [first, second] = BUILD_PREVIEW_AIM;
  // Long enough for the arm to swing home at its own speeds, plus the frame
  // the swing is issued on.
  const home =
    Math.ceil(
      Math.max(
        Math.abs(first[0]) / param(preset, params, "turnSpeed"),
        Math.abs(first[1]) / param(preset, params, "liftSpeed"),
      ) * FPS,
    ) + 1;
  const again = CALLIN + leg + home;
  const frames = again + leg;
  return {
    events: [
      ...CREATED,
      {
        frame: CALLIN,
        callin: "StartBuilding",
        args: [deg(first[0]), deg(first[1])],
      },
      { frame: CALLIN + leg, callin: "StopBuilding" },
      {
        frame: again,
        callin: "StartBuilding",
        args: [deg(second[0]), deg(second[1])],
      },
    ],
    frames,
    spans: [
      { from: CALLIN, to: CALLIN + leg - 1, t0: 0 },
      { from: again, to: frames - 1, t0: BUILD_PREVIEW_LEG },
    ],
    exceptions: [
      "Between the two builds the Lua swings the arm home. The preview's loop starts each leg from rest instead, so the swing home is not compared.",
    ],
  };
}

function factoryPlan(): Plan {
  const leg = Math.round(BUILD_PREVIEW_LEG * FPS);
  const frames = CALLIN + 2 * leg;
  return {
    events: [
      ...CREATED,
      { frame: CALLIN, callin: "StartBuilding" },
      { frame: CALLIN + leg, callin: "StopBuilding" },
    ],
    frames,
    spans: [{ from: CALLIN, to: frames - 1, t0: 0 }],
    exceptions: [],
  };
}

function wreckPlan(): Plan {
  const frames = CALLIN + FPS + 1;
  return {
    events: [...CREATED, { frame: CALLIN, callin: "Killed", args: [50, 100] }],
    frames,
    spans: [{ from: CALLIN, to: frames - 1, t0: 0 }],
    exceptions: [
      "The preview shows the wreck pose at every moment, because it has no moment of death. A unit is alive and at rest until Killed, so it is compared from then on.",
    ],
  };
}

function nanoPlan(): Plan {
  const stop = CALLIN + Math.round(BUILD_PREVIEW_LEG * FPS);
  const frames = stop + FPS;
  return {
    events: [
      ...CREATED,
      { frame: CALLIN, callin: "StartBuilding", args: [0, 0] },
      { frame: CALLIN, engine: "nano-start" },
      { frame: stop, callin: "StopBuilding" },
      { frame: stop, engine: "nano-stop" },
    ],
    frames,
    spans: [{ from: 0, to: frames - 1, t0: 0 }],
    exceptions: [],
  };
}

function wheelsPlan(): Plan {
  const frames = CALLIN + 10 * FPS;
  return {
    events: [...CREATED, { frame: CALLIN, callin: "StartMoving" }],
    frames,
    spans: [{ from: CALLIN, to: frames - 1, t0: 0 }],
    exceptions: [],
  };
}

/**
 * No drive, so the heading reads 0 throughout and the rudder holds straight.
 * `track()` cannot say more, since the rudder follows the heading and not the
 * time. What this checks is that the script runs under the runtime.
 */
function rudderPlan(): Plan {
  const frames = CALLIN + 5 * FPS;
  return {
    events: [...CREATED, { frame: CALLIN, callin: "StartMoving" }],
    frames,
    spans: [{ from: CALLIN, to: frames - 1, t0: 0 }],
    exceptions: [
      "The unit is not driven, so its heading does not change and the rudder stays straight. A turning heading is checked in rudder.test.ts.",
    ],
  };
}

/**
 * The wake emits a particle and moves no piece, so what is checked is that the
 * script runs under the runtime, with a reversing unit's flag, and leaves the
 * wake point where it was.
 */
function wakePlan(): Plan {
  const frames = CALLIN + 5 * FPS;
  return {
    events: [...CREATED, { frame: CALLIN, callin: "StartMoving", args: [1] }],
    frames,
    spans: [{ from: CALLIN, to: frames - 1, t0: 0 }],
    exceptions: [
      "The wake is a particle, so nothing moves. The emitted types are checked in wake.test.ts.",
    ],
  };
}

/**
 * `Activate` at the start of the loop `track()` plays and `Deactivate` when it
 * has held stowed. The loop ends on a held second at rest, so the last frames
 * check the gear stays down.
 */
function gearPlan(preset: AnimPreset, params: Record<string, number>): Plan {
  const time = param(preset, params, "stowTime");
  const down = CALLIN + Math.round((time + 1) * FPS);
  const frames = CALLIN + Math.round(2 * (time + 1) * FPS);
  return {
    events: [
      ...CREATED,
      { frame: CALLIN, callin: "Activate" },
      { frame: down, callin: "Deactivate" },
    ],
    frames,
    spans: [{ from: CALLIN, to: frames - 1, t0: 0 }],
    exceptions: [],
  };
}

function plan(preset: AnimPreset, params: Record<string, number>): Plan {
  switch (preset.id) {
    case "walk.biped":
    case "walk.quad":
      return cyclePlan(preset, params, "StartMoving", CALLIN);
    case "buildarm":
      return cyclePlan(preset, params, "StartBuilding", CALLIN);
    case "open.close":
      return cyclePlan(preset, params, "Activate", CALLIN);
    // Hovering starts on Create, which every run fires on its first frame.
    case "hover.bob":
      return cyclePlan(preset, params, "Create", 0);
    case "idle.sway":
      return cyclePlan(preset, params, "StopMoving", CALLIN);
    case "turret.track":
    case "aim.track":
      return aimPlan(preset, params);
    case "recoil":
      return recoilPlan(preset, params);
    case "build.aim":
      return buildAimPlan(preset, params);
    case "build.factory":
      return factoryPlan();
    case "wreck.pose":
      return wreckPlan();
    case "build.nano":
      return nanoPlan();
    case "wheels.roll":
      return wheelsPlan();
    case "rudder.follow":
      return rudderPlan();
    case "wake.moving":
      return wakePlan();
    case "gear.stow":
      return gearPlan(preset, params);
  }
  throw new Error(`no parity plan for ${preset.id}`);
}

interface Check {
  piece: string;
  channel: number;
  from: number;
  to: number;
  expected?: number[];
  constant?: number;
  tolerance: number;
}

interface Measured {
  checks: Check[];
  /** Per piece and channel: the furthest the curve bows from the straight
   *  line, and the furthest it moves in one frame. */
  bows: { piece: string; channel: number; gap: number; travel: number }[];
}

function timeAt(span: Span, frame: number): number {
  return span.hold ? span.t0 : span.t0 + (frame - span.from) / FPS;
}

/** Where the straight line through `span.knots` is at time `t`. */
function straight(
  span: Span,
  t: number,
  value: (t: number) => number,
): number | null {
  const knots = span.knots;
  if (!knots) return null;
  const local = span.period ? t - Math.floor(t / span.period) * span.period : t;
  for (let index = 0; index + 1 < knots.length; index++) {
    const [a, b] = [knots[index], knots[index + 1]];
    if (local < a || local > b) continue;
    const share = b === a ? 0 : (local - a) / (b - a);
    return value(a) + (value(b) - value(a)) * share;
  }
  return null;
}

function round(n: number): number {
  return Number(n.toFixed(6));
}

function measure(
  preset: AnimPreset,
  params: Record<string, number>,
  unit: LegoProject,
  planned: Plan,
): Measured {
  const checks: Check[] = [];
  const bows: Measured["bows"] = [];
  const growth = LUA_ROUNDING * (1 + planned.frames / FPS);

  for (const piece of unit.pieces) {
    for (let channel = 0; channel < 6; channel++) {
      const value = (t: number) =>
        piece.role ? channels(preset.track(t, params, piece.role))[channel] : 0;

      const series = planned.spans.map((span) => {
        const values: number[] = [];
        for (let frame = span.from; frame <= span.to; frame++) {
          values.push(value(timeAt(span, frame)));
        }
        return values;
      });

      let travel = 0;
      let gap = 0;
      planned.spans.forEach((span, index) => {
        const values = series[index];
        for (let i = 1; i < values.length; i++) {
          travel = Math.max(travel, Math.abs(values[i] - values[i - 1]));
        }
        values.forEach((v, i) => {
          const line = straight(span, timeAt(span, span.from + i), value);
          if (line !== null) gap = Math.max(gap, Math.abs(v - line));
        });
      });
      if (planned.spans.some((span) => span.knots)) {
        bows.push({ piece: piece.name, channel, gap, travel });
      }

      const tolerance = round(gap + travel + growth);
      planned.spans.forEach((span, index) => {
        const values = series[index].map(round);
        const flat = values.every((v) => v === values[0]);
        checks.push({
          piece: piece.name,
          channel,
          from: span.from,
          to: span.to,
          ...(flat ? { constant: values[0] } : { expected: values }),
          tolerance,
        });
      });
    }
  }
  return { checks, bows };
}

/**
 * The defaults, then every time and speed at its lowest, then every param at
 * its highest, so the edges of each slider are run as well as the middle.
 *
 * Angles and distances keep their defaults in the lowest set, because most of
 * them go down to nothing and a preset that moves nothing agrees with anything.
 */
function paramSets(
  preset: AnimPreset,
): { label: string; params: Record<string, number> }[] {
  if (preset.params.length === 0) return [{ label: "defaults", params: {} }];
  const timing = new Set(["s", "hz", "deg/s"]);
  return [
    { label: "defaults", params: {} },
    ...(preset.params.some((entry) => entry.id === "sweep")
      ? [
          {
            label: "no travel",
            params: { sweep: 0, pitch: 0 },
          },
        ]
      : []),
    {
      label: "lowest",
      params: Object.fromEntries(
        preset.params
          .filter((entry) => timing.has(entry.unit))
          .map((entry) => [entry.id, entry.min]),
      ),
    },
    {
      label: "highest",
      params: Object.fromEntries(
        preset.params.map((entry) => [entry.id, entry.max]),
      ),
    },
    // A walk fitted to a body (#3349) moves in a shape of its own, so it is
    // run as `buildLuaScript` writes it for the default legs at a walker's
    // speed, and again for a run.
    ...(preset.id.startsWith("walk.")
      ? [
          {
            label: "fitted",
            params: fitWalk(FITTED_BODY, {}),
          },
          {
            label: "fitted, running",
            params: fitWalk(FITTED_BODY, { duty: 35 }),
          },
        ]
      : []),
  ];
}

/** The plans' default leg length and a walker's speed, for the fitted walks. */
const FITTED_BODY = { legLength: 18.8, speed: 45 };

function buildCases() {
  return PRESETS.flatMap((preset) =>
    paramSets(preset).map(({ label, params }) => {
      const unit = unitFor(preset, params);
      const planned = plan(preset, params);
      const { checks, bows } = measure(preset, params, unit, planned);
      return {
        preset,
        bows,
        fixture: {
          name: `${preset.id}, ${label}`,
          script: buildLuaScript(unit),
          pieces: unit.pieces.map((piece) => piece.name),
          events: planned.events,
          frames: planned.frames,
          exceptions: planned.exceptions,
          checks,
        },
      };
    }),
  );
}

describe("preset parity fixture", () => {
  const cases = buildCases();

  it("covers all 17 presets", () => {
    expect(new Set(cases.map((entry) => entry.preset.id)).size).toBe(17);
    expect(PRESETS).toHaveLength(17);
  });

  it("matches what the presets generate today", () => {
    const emitted = `${JSON.stringify(
      {
        generatedBy:
          "src/lego/presetParity.test.ts. Regenerate with UPDATE_PRESET_PARITY=1 bun run test presetParity",
        cases: cases.map((entry) => entry.fixture),
      },
      null,
      1,
    )}\n`;
    if (process.env.UPDATE_PRESET_PARITY) writeFileSync(FIXTURE, emitted);
    expect(emitted === readFileSync(FIXTURE, "utf8")).toBe(true);
  });

  it("keeps each straight Turn of a cycle within one frame of the curve", () => {
    const wide = cases.flatMap((entry) =>
      entry.bows
        .filter((bow) => bow.gap > bow.travel)
        .map(
          (bow) =>
            `${entry.fixture.name}: ${bow.piece} channel ${bow.channel} bows ${bow.gap.toFixed(4)} from its straight line, one frame moves ${bow.travel.toFixed(4)}`,
        ),
    );
    // The aim presets' approach is one straight Turn by design, and says so
    // in its exceptions, so only the looping cycles are held to this.
    const cycles = wide.filter(
      (line) =>
        !line.startsWith("turret.track") && !line.startsWith("aim.track"),
    );
    expect(cycles).toEqual([]);
  });
});
