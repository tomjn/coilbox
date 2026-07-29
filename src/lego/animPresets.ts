/**
 * Roles a piece can take, and the canned animations that drive them.
 *
 * A preset is pure: `track` returns a transform delta from a piece's rest pose
 * at a given moment, and knows nothing about three, the document or the
 * viewport. Playback resets each piece to rest and adds the delta, so stopping
 * always restores exactly what was built and nothing is written to the project.
 *
 * Roles are a fixed vocabulary rather than free text. A preset can then say
 * what it needs, and the panel can say what is missing.
 */

export interface LegoRole {
  id: string;
  label: string;
  /** Grouped in the picker, because there are more roles than fit a flat list. */
  group: string;
}

/**
 * Legs are numbered as well as sided, which the plan's `leg.<l|r>.<segment>`
 * did not allow for. A quadruped needs a second pair, and without an index
 * there is no way to say which is which.
 */
export const ROLES: LegoRole[] = [
  { id: "base", label: "Body", group: "Structure" },
  { id: "turret", label: "Turret", group: "Weapon" },
  { id: "barrel", label: "Barrel", group: "Weapon" },
  { id: "flare", label: "Muzzle flare", group: "Weapon" },
  { id: "aim", label: "Aim point", group: "Weapon" },
  { id: "wheel", label: "Wheel", group: "Movement" },
  { id: "leg.l1.thigh", label: "Front left thigh", group: "Legs" },
  { id: "leg.l1.shin", label: "Front left shin", group: "Legs" },
  { id: "leg.l1.foot", label: "Front left foot", group: "Legs" },
  { id: "leg.r1.thigh", label: "Front right thigh", group: "Legs" },
  { id: "leg.r1.shin", label: "Front right shin", group: "Legs" },
  { id: "leg.r1.foot", label: "Front right foot", group: "Legs" },
  { id: "leg.l2.thigh", label: "Rear left thigh", group: "Legs" },
  { id: "leg.l2.shin", label: "Rear left shin", group: "Legs" },
  { id: "leg.l2.foot", label: "Rear left foot", group: "Legs" },
  { id: "leg.r2.thigh", label: "Rear right thigh", group: "Legs" },
  { id: "leg.r2.shin", label: "Rear right shin", group: "Legs" },
  { id: "leg.r2.foot", label: "Rear right foot", group: "Legs" },
  { id: "buildarm.base", label: "Build arm base", group: "Build arm" },
  { id: "buildarm.arm", label: "Build arm", group: "Build arm" },
  { id: "buildarm.nozzle", label: "Build nozzle", group: "Build arm" },
  { id: "door", label: "Door", group: "Structure" },
];

const ROLE_IDS = new Set(ROLES.map((role) => role.id));

export function isRole(value: string): boolean {
  return ROLE_IDS.has(value);
}

export interface PresetParam {
  id: string;
  label: string;
  /** Degrees, seconds, turns per second or metres. Converted inside `track`. */
  unit: "deg" | "s" | "hz" | "m";
  min: number;
  max: number;
  step: number;
  fallback: number;
}

/** A change from the piece's rest pose. Radians, and metres in engine axes. */
export interface TrackDelta {
  position?: [number, number, number];
  rotation?: [number, number, number];
}

/** Callins a preset can contribute to in a generated unit script. */
export type LuaHook =
  | "Create"
  | "StartMoving"
  | "StopMoving"
  | "Activate"
  | "Deactivate"
  | "AimWeapon1"
  | "AimFromWeapon1"
  | "QueryWeapon1";

export interface EmitContext {
  /**
   * Names of the pieces carrying a role, in document order. Asking marks them
   * used, so the script declares a local for exactly what it references.
   */
  pieces(role: string): string[];
  params: Record<string, number>;
  /** A signal number of this preset's own, for stopping its threads. */
  signal: string;
}

export interface EmitResult {
  /** Threads and helpers, written above the callins. */
  functions: string[];
  hooks: Partial<Record<LuaHook, string[]>>;
}

export interface AnimPreset {
  id: string;
  label: string;
  description: string;
  /** Roles that must be filled, with how many pieces each needs at least. */
  requires: { role: string; count: number }[];
  /** Every role this preset may move, so playback knows what to reset. */
  animates: string[];
  params: PresetParam[];
  /** Null when the preset does not move that role. */
  track(
    t: number,
    params: Record<string, number>,
    role: string,
  ): TrackDelta | null;
  /** Lua for a unit script. Null when the unit has none of its pieces. */
  emit(ctx: EmitContext): EmitResult | null;
}

/** A preset as applied to a unit, which is what the document stores. */
export interface AppliedPreset {
  presetId: string;
  params: Record<string, number>;
}

const TAU = Math.PI * 2;

function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Read a param, falling back to the preset's default when it is not set. */
function value(
  preset: AnimPreset,
  params: Record<string, number>,
  id: string,
): number {
  const given = params[id];
  if (typeof given === "number" && Number.isFinite(given)) return given;
  return preset.params.find((param) => param.id === id)?.fallback ?? 0;
}

const AXES = ["x_axis", "y_axis", "z_axis"];
/**
 * Poses per cycle in a generated thread.
 *
 * Four is the fewest that reads as motion. Two would sample a sine at its
 * zero crossings and emit a thread that stands still.
 */
const CYCLE_STEPS = 4;

function lua(n: number): string {
  // Fixed precision, so the same project always writes the same file.
  return Number(n.toFixed(4)).toString();
}

interface CyclePose {
  rotation?: number[];
  position?: number[];
}

/**
 * A looping thread that walks a preset's own `track` around one cycle.
 *
 * Sampling `track` rather than writing the motion out a second time means the
 * script and the viewport cannot drift apart: change the maths and both follow.
 * Turn and Move speeds are worked out from how far each piece has to travel in
 * the time the step allows, so the pose is reached rather than overshot or
 * lagged.
 */
function cycleThread(
  preset: AnimPreset,
  ctx: EmitContext,
  options: { name: string; period: number },
): EmitResult | null {
  const targets = preset.animates.flatMap((role) =>
    ctx.pieces(role).map((piece) => ({ role, piece })),
  );
  if (targets.length === 0) return null;

  const stepSeconds = options.period / CYCLE_STEPS;

  // Sample the whole cycle before writing any of it. A step's move is measured
  // against the step before it, and the first step follows the last, because
  // the thread loops. Measuring the first against a rest pose would be right
  // once and wrong on every lap after that.
  const poses = Array.from({ length: CYCLE_STEPS }, (_, step) => {
    const t = (step / CYCLE_STEPS) * options.period;
    const pose = new Map<string, CyclePose>();
    for (const { role, piece } of targets) {
      const delta = preset.track(t, ctx.params, role);
      if (!delta) continue;
      // Rounded before anything is compared, or floating point dust reads as
      // movement and emits a turn or move of nothing at a speed of nothing.
      const entry: CyclePose = {
        rotation: delta.rotation?.map((r) => Number(r.toFixed(4))),
        position: delta.position?.map((p) => Number(p.toFixed(4))),
      };
      if (entry.rotation || entry.position) pose.set(piece, entry);
    }
    return pose;
  });

  const body: string[] = [];
  const movedRotation = new Map<string, Set<number>>();
  const movedPosition = new Map<string, Set<number>>();

  for (let step = 0; step < CYCLE_STEPS; step++) {
    const before = poses[(step + CYCLE_STEPS - 1) % CYCLE_STEPS];
    for (const [piece, pose] of poses[step]) {
      const was = before.get(piece);
      if (pose.rotation) {
        const from = was?.rotation ?? [0, 0, 0];
        for (let axis = 0; axis < 3; axis++) {
          if (pose.rotation[axis] === from[axis]) continue;
          const speed =
            Math.abs(pose.rotation[axis] - from[axis]) / stepSeconds;
          body.push(
            `    Turn(${piece}, ${AXES[axis]}, ${lua(pose.rotation[axis])}, ${lua(speed)})`,
          );
          movedRotation.set(
            piece,
            (movedRotation.get(piece) ?? new Set()).add(axis),
          );
        }
      }
      if (pose.position) {
        const from = was?.position ?? [0, 0, 0];
        for (let axis = 0; axis < 3; axis++) {
          if (pose.position[axis] === from[axis]) continue;
          const speed =
            Math.abs(pose.position[axis] - from[axis]) / stepSeconds;
          body.push(
            `    Move(${piece}, ${AXES[axis]}, ${lua(pose.position[axis])}, ${lua(speed)})`,
          );
          movedPosition.set(
            piece,
            (movedPosition.get(piece) ?? new Set()).add(axis),
          );
        }
      }
    }
    body.push(`    Sleep(${Math.round(stepSeconds * 1000)})`);
  }

  // Back to rest on stop, or the unit keeps whatever pose it stopped in. Only
  // the axes this preset actually moves, so the reset does not fight another
  // preset holding the same piece on a different axis.
  const rest = [
    ...[...movedRotation].flatMap(([piece, axes]) =>
      [...axes].map((axis) => `  Turn(${piece}, ${AXES[axis]}, 0, 4)`),
    ),
    ...[...movedPosition].flatMap(([piece, axes]) =>
      [...axes].map((axis) => `  Move(${piece}, ${AXES[axis]}, 0, 4)`),
    ),
  ];

  return {
    functions: [
      `local function ${options.name}()`,
      `  SetSignalMask(${ctx.signal})`,
      "  while true do",
      ...body,
      "  end",
      "end",
      "",
      `local function ${options.name}Stop()`,
      ...rest,
      "end",
    ],
    hooks: {},
  };
}

const LEG_SEGMENTS = ["thigh", "shin", "foot"] as const;
type LegSegment = (typeof LEG_SEGMENTS)[number];

interface LegRole {
  side: "l" | "r";
  pair: 1 | 2;
  segment: LegSegment;
}

function parseLegRole(role: string): LegRole | null {
  const match = /^leg\.([lr])([12])\.(thigh|shin|foot)$/.exec(role);
  if (!match) return null;
  return {
    side: match[1] as "l" | "r",
    pair: Number(match[2]) as 1 | 2,
    segment: match[3] as LegSegment,
  };
}

/**
 * Where a leg sits in the cycle.
 *
 * A biped's two legs are opposite each other. A quadruped moves diagonal pairs
 * together, front left with rear right, which is what a trot is and what stops
 * the model rocking.
 */
function legPhase(leg: LegRole, gait: "biped" | "quad"): number {
  if (gait === "biped") return leg.side === "l" ? 0 : Math.PI;
  const diagonal = (leg.side === "l") === (leg.pair === 1);
  return diagonal ? 0 : Math.PI;
}

function walkTrack(
  preset: AnimPreset,
  t: number,
  params: Record<string, number>,
  role: string,
  gait: "biped" | "quad",
): TrackDelta | null {
  const leg = parseLegRole(role);
  if (!leg) return null;
  if (gait === "biped" && leg.pair === 2) return null;

  const period = Math.max(value(preset, params, "period"), 0.05);
  const phase = (t / period) * TAU + legPhase(leg, gait);

  // The thigh swings, the knee folds only as the leg comes forward, and the
  // foot undoes both so it stays flat to the ground.
  const thigh = deg(value(preset, params, "stride")) * Math.sin(phase);
  const shin = deg(value(preset, params, "knee")) * (1 - Math.cos(phase)) * 0.5;

  const angle: Record<LegSegment, number> = {
    thigh,
    shin,
    foot: -(thigh + shin),
  };
  return { rotation: [angle[leg.segment], 0, 0] };
}

const WALK_PARAMS: PresetParam[] = [
  {
    id: "period",
    label: "Stride time",
    unit: "s",
    min: 0.2,
    max: 4,
    step: 0.1,
    fallback: 1,
  },
  {
    id: "stride",
    label: "Thigh swing",
    unit: "deg",
    min: 0,
    max: 70,
    step: 1,
    fallback: 25,
  },
  {
    id: "knee",
    label: "Knee bend",
    unit: "deg",
    min: 0,
    max: 90,
    step: 1,
    fallback: 30,
  },
];

function legRoles(pairs: (1 | 2)[]): string[] {
  const roles: string[] = [];
  for (const pair of pairs) {
    for (const side of ["l", "r"] as const) {
      for (const segment of LEG_SEGMENTS) {
        roles.push(`leg.${side}${pair}.${segment}`);
      }
    }
  }
  return roles;
}

export const WALK_BIPED: AnimPreset = {
  id: "walk.biped",
  label: "Walk, two legs",
  description:
    "Swings the legs in opposition and keeps the feet flat. Needs a thigh and a shin on each side.",
  requires: [
    { role: "leg.l1.thigh", count: 1 },
    { role: "leg.l1.shin", count: 1 },
    { role: "leg.r1.thigh", count: 1 },
    { role: "leg.r1.shin", count: 1 },
  ],
  animates: legRoles([1]),
  params: WALK_PARAMS,
  track(t, params, role) {
    return walkTrack(this, t, params, role, "biped");
  },
  emit(ctx) {
    return walkEmit(this, ctx);
  },
};

export const WALK_QUAD: AnimPreset = {
  id: "walk.quad",
  label: "Walk, four legs",
  description:
    "A trot: diagonal pairs move together, so the body does not rock. Needs both pairs of legs.",
  requires: [
    { role: "leg.l1.thigh", count: 1 },
    { role: "leg.r1.thigh", count: 1 },
    { role: "leg.l2.thigh", count: 1 },
    { role: "leg.r2.thigh", count: 1 },
  ],
  animates: legRoles([1, 2]),
  params: WALK_PARAMS,
  track(t, params, role) {
    return walkTrack(this, t, params, role, "quad");
  },
  emit(ctx) {
    return walkEmit(this, ctx);
  },
};

/** Walking starts and stops with the unit, so it hangs off the move callins. */
function walkEmit(preset: AnimPreset, ctx: EmitContext): EmitResult | null {
  const thread = cycleThread(preset, ctx, {
    name: "walk",
    period: Math.max(value(preset, ctx.params, "period"), 0.05),
  });
  if (!thread) return null;
  return {
    functions: thread.functions,
    hooks: {
      StartMoving: [`  Signal(${ctx.signal})`, "  StartThread(walk)"],
      StopMoving: [`  Signal(${ctx.signal})`, "  walkStop()"],
    },
  };
}

export const TURRET_TRACK: AnimPreset = {
  id: "turret.track",
  label: "Turret sweep",
  description:
    "Turns the turret and lifts the barrel, the motion a turret makes tracking a target.",
  requires: [{ role: "turret", count: 1 }],
  animates: ["turret", "barrel"],
  params: [
    {
      id: "period",
      label: "Sweep time",
      unit: "s",
      min: 0.5,
      max: 12,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "sweep",
      label: "Turn",
      unit: "deg",
      min: 0,
      max: 180,
      step: 5,
      fallback: 60,
    },
    {
      id: "pitch",
      label: "Barrel lift",
      unit: "deg",
      min: 0,
      max: 60,
      step: 1,
      fallback: 12,
    },
  ],
  track(t, params, role) {
    const period = Math.max(value(this, params, "period"), 0.05);
    const phase = (t / period) * TAU;
    if (role === "turret") {
      return {
        rotation: [0, deg(value(this, params, "sweep")) * Math.sin(phase), 0],
      };
    }
    if (role === "barrel") {
      // Lifts and settles twice per sweep, never dipping below rest.
      const lift = (1 - Math.cos(phase * 2)) * 0.5;
      return { rotation: [-deg(value(this, params, "pitch")) * lift, 0, 0] };
    }
    return null;
  },
  /**
   * A turret aims rather than loops, so this is the one preset that emits
   * callins instead of a thread. The sweep in the viewport is a demonstration
   * of the motion. In a game the target decides where it points.
   */
  emit(ctx) {
    const turret = ctx.pieces("turret")[0];
    if (!turret) return null;
    const barrel = ctx.pieces("barrel")[0];
    const flare = ctx.pieces("flare")[0];
    const speed = lua(deg(value(this, ctx.params, "sweep")));

    const aim = [
      `  Signal(${ctx.signal})`,
      `  SetSignalMask(${ctx.signal})`,
      `  Turn(${turret}, y_axis, heading, ${speed})`,
      ...(barrel ? [`  Turn(${barrel}, x_axis, -pitch, ${speed})`] : []),
      `  WaitForTurn(${turret}, y_axis)`,
      ...(barrel ? [`  WaitForTurn(${barrel}, x_axis)`] : []),
      "  return true",
    ];

    return {
      functions: [],
      hooks: {
        AimWeapon1: aim,
        AimFromWeapon1: [`  return ${turret}`],
        QueryWeapon1: [`  return ${flare ?? barrel ?? turret}`],
      },
    };
  },
};

export const WHEELS_ROLL: AnimPreset = {
  id: "wheels.roll",
  label: "Wheels turning",
  description: "Spins every wheel at a steady rate, as it would while moving.",
  requires: [{ role: "wheel", count: 1 }],
  animates: ["wheel"],
  params: [
    {
      id: "rate",
      label: "Turns per second",
      unit: "hz",
      min: 0.1,
      max: 6,
      step: 0.1,
      fallback: 1.2,
    },
  ],
  track(t, params, role) {
    if (role !== "wheel") return null;
    return { rotation: [TAU * value(this, params, "rate") * t, 0, 0] };
  },
  /** Continuous, so `Spin` rather than a thread of `Turn` calls. */
  emit(ctx) {
    const wheels = ctx.pieces("wheel");
    if (wheels.length === 0) return null;
    const speed = lua(TAU * value(this, ctx.params, "rate"));
    return {
      functions: [],
      hooks: {
        StartMoving: wheels.map(
          (wheel) => `  Spin(${wheel}, x_axis, ${speed})`,
        ),
        StopMoving: wheels.map((wheel) => `  StopSpin(${wheel}, x_axis)`),
      },
    };
  },
};

export const BUILDARM: AnimPreset = {
  id: "buildarm",
  label: "Build arm",
  description:
    "Sweeps the arm and keeps the nozzle level, the idle motion of a builder at work.",
  requires: [{ role: "buildarm.arm", count: 1 }],
  animates: ["buildarm.base", "buildarm.arm", "buildarm.nozzle"],
  params: [
    {
      id: "period",
      label: "Cycle time",
      unit: "s",
      min: 0.5,
      max: 10,
      step: 0.5,
      fallback: 3,
    },
    {
      id: "swing",
      label: "Base swing",
      unit: "deg",
      min: 0,
      max: 90,
      step: 5,
      fallback: 35,
    },
    {
      id: "lift",
      label: "Arm lift",
      unit: "deg",
      min: 0,
      max: 60,
      step: 1,
      fallback: 20,
    },
  ],
  track(t, params, role) {
    const period = Math.max(value(this, params, "period"), 0.05);
    const phase = (t / period) * TAU;
    const lift =
      deg(value(this, params, "lift")) * Math.sin(phase + Math.PI / 2);
    if (role === "buildarm.base") {
      return {
        rotation: [0, deg(value(this, params, "swing")) * Math.sin(phase), 0],
      };
    }
    if (role === "buildarm.arm") return { rotation: [lift, 0, 0] };
    // The nozzle undoes the arm's lift, so it keeps pointing where it was.
    if (role === "buildarm.nozzle") return { rotation: [-lift, 0, 0] };
    return null;
  },
  emit(ctx) {
    const thread = cycleThread(this, ctx, {
      name: "buildArm",
      period: Math.max(value(this, ctx.params, "period"), 0.05),
    });
    if (!thread) return null;
    return {
      functions: thread.functions,
      hooks: {
        // A builder animates while it is working, which is what Activate means.
        Activate: [`  Signal(${ctx.signal})`, "  StartThread(buildArm)"],
        Deactivate: [`  Signal(${ctx.signal})`, "  buildArmStop()"],
      },
    };
  },
};

export const OPEN_CLOSE: AnimPreset = {
  id: "open.close",
  label: "Doors",
  description:
    "Swings every door open and shut again, for hangars and silo covers.",
  requires: [{ role: "door", count: 1 }],
  animates: ["door"],
  params: [
    {
      id: "period",
      label: "Cycle time",
      unit: "s",
      min: 0.5,
      max: 12,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "open",
      label: "Opening",
      unit: "deg",
      min: 0,
      max: 170,
      step: 5,
      fallback: 80,
    },
  ],
  track(t, params, role) {
    if (role !== "door") return null;
    const period = Math.max(value(this, params, "period"), 0.05);
    // Shut at rest, so a unit that is not playing looks closed.
    const openness = (1 - Math.cos((t / period) * TAU)) * 0.5;
    return { rotation: [0, deg(value(this, params, "open")) * openness, 0] };
  },
  emit(ctx) {
    const thread = cycleThread(this, ctx, {
      name: "doors",
      period: Math.max(value(this, ctx.params, "period"), 0.05),
    });
    if (!thread) return null;
    return {
      functions: thread.functions,
      hooks: {
        Activate: [`  Signal(${ctx.signal})`, "  StartThread(doors)"],
        // Shutting is not optional: a door left open is a hole in the model.
        Deactivate: [`  Signal(${ctx.signal})`, "  doorsStop()"],
      },
    };
  },
};

export const HOVER_BOB: AnimPreset = {
  id: "hover.bob",
  label: "Hover and bob",
  description:
    "Bobs the body up and down and rocks it gently side to side, the way an aircraft or hovercraft sits while holding position.",
  requires: [{ role: "base", count: 1 }],
  animates: ["base"],
  params: [
    {
      id: "period",
      label: "Cycle time",
      unit: "s",
      min: 0.5,
      max: 8,
      step: 0.5,
      fallback: 2.5,
    },
    {
      id: "height",
      label: "Bob height",
      unit: "m",
      min: 0,
      max: 2,
      step: 0.05,
      fallback: 0.3,
    },
    {
      id: "sway",
      label: "Rock",
      unit: "deg",
      min: 0,
      max: 20,
      step: 1,
      fallback: 4,
    },
  ],
  track(t, params, role) {
    if (role !== "base") return null;
    const period = Math.max(value(this, params, "period"), 0.05);
    const phase = (t / period) * TAU;
    return {
      position: [0, value(this, params, "height") * Math.sin(phase), 0],
      // In phase with the bob, so the body is level at rest and rocks
      // furthest to one side exactly as it reaches the top of the bob.
      rotation: [0, 0, deg(value(this, params, "sway")) * Math.sin(phase)],
    };
  },
  emit(ctx) {
    const thread = cycleThread(this, ctx, {
      name: "hover",
      period: Math.max(value(this, ctx.params, "period"), 0.05),
    });
    if (!thread) return null;
    return {
      functions: thread.functions,
      // Holding position is what the unit does for its whole life, not
      // something it starts and stops, so this starts once on Create and is
      // never told to stand down.
      hooks: {
        Create: [`  Signal(${ctx.signal})`, "  StartThread(hover)"],
      },
    };
  },
};

export const AIM_TRACK: AnimPreset = {
  id: "aim.track",
  label: "Aim point",
  description:
    "Turns and lifts a single piece to face a target, for a unit with no separate turret and barrel.",
  requires: [{ role: "aim", count: 1 }],
  animates: ["aim"],
  params: [
    {
      id: "period",
      label: "Sweep time",
      unit: "s",
      min: 0.5,
      max: 12,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "sweep",
      label: "Turn",
      unit: "deg",
      min: 0,
      max: 180,
      step: 5,
      fallback: 60,
    },
    {
      id: "pitch",
      label: "Lift",
      unit: "deg",
      min: 0,
      max: 60,
      step: 1,
      fallback: 12,
    },
  ],
  track(t, params, role) {
    if (role !== "aim") return null;
    const period = Math.max(value(this, params, "period"), 0.05);
    const phase = (t / period) * TAU;
    // Lifts and settles twice per sweep, never dipping below rest, the same
    // shape turret.track gives its barrel.
    const lift = (1 - Math.cos(phase * 2)) * 0.5;
    return {
      rotation: [
        -deg(value(this, params, "pitch")) * lift,
        deg(value(this, params, "sweep")) * Math.sin(phase),
        0,
      ],
    };
  },
  /**
   * Aims rather than loops, so this emits callins instead of a thread, exactly
   * as turret.track does for its own pair of pieces.
   */
  emit(ctx) {
    const aim = ctx.pieces("aim")[0];
    if (!aim) return null;
    const speed = lua(deg(value(this, ctx.params, "sweep")));

    return {
      functions: [],
      hooks: {
        AimWeapon1: [
          `  Signal(${ctx.signal})`,
          `  SetSignalMask(${ctx.signal})`,
          `  Turn(${aim}, y_axis, heading, ${speed})`,
          `  Turn(${aim}, x_axis, -pitch, ${speed})`,
          `  WaitForTurn(${aim}, y_axis)`,
          `  WaitForTurn(${aim}, x_axis)`,
          "  return true",
        ],
        AimFromWeapon1: [`  return ${aim}`],
        QueryWeapon1: [`  return ${aim}`],
      },
    };
  },
};

export const IDLE_SWAY: AnimPreset = {
  id: "idle.sway",
  label: "Idle sway",
  description:
    "A slow turn back and forth while the unit stands still: a gentle body sway, or a scanning dish if that is what the piece is.",
  requires: [{ role: "base", count: 1 }],
  animates: ["base"],
  params: [
    {
      id: "period",
      label: "Cycle time",
      unit: "s",
      min: 1,
      max: 20,
      step: 0.5,
      fallback: 6,
    },
    {
      id: "turn",
      label: "Turn",
      unit: "deg",
      min: 0,
      max: 60,
      step: 1,
      fallback: 8,
    },
  ],
  track(t, params, role) {
    if (role !== "base") return null;
    const period = Math.max(value(this, params, "period"), 0.05);
    const phase = (t / period) * TAU;
    return {
      rotation: [0, deg(value(this, params, "turn")) * Math.sin(phase), 0],
    };
  },
  emit(ctx) {
    const thread = cycleThread(this, ctx, {
      name: "idleSway",
      period: Math.max(value(this, ctx.params, "period"), 0.05),
    });
    if (!thread) return null;
    return {
      functions: thread.functions,
      hooks: {
        // The opposite of walking: idle motion picks up once the unit stops,
        // and stands down the moment it moves again.
        StopMoving: [`  Signal(${ctx.signal})`, "  StartThread(idleSway)"],
        StartMoving: [`  Signal(${ctx.signal})`, "  idleSwayStop()"],
      },
    };
  },
};

export const PRESETS: AnimPreset[] = [
  WALK_BIPED,
  WALK_QUAD,
  TURRET_TRACK,
  WHEELS_ROLL,
  BUILDARM,
  OPEN_CLOSE,
  HOVER_BOB,
  AIM_TRACK,
  IDLE_SWAY,
];

export function presetById(id: string): AnimPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/**
 * Which of a preset's requirements a unit does not meet, as role ids.
 *
 * `roleCounts` is how many pieces carry each role, which is all a requirement
 * looks at. Empty means the preset can be applied.
 */
export function unmetRequirements(
  preset: AnimPreset,
  roleCounts: Map<string, number>,
): string[] {
  return preset.requires
    .filter((need) => (roleCounts.get(need.role) ?? 0) < need.count)
    .map((need) => need.role);
}

/** How many pieces carry each role. */
export function countRoles(pieces: { role?: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const piece of pieces) {
    if (!piece.role) continue;
    counts.set(piece.role, (counts.get(piece.role) ?? 0) + 1);
  }
  return counts;
}

/** A role's label, or the raw id if a document carries one we dropped. */
export function roleLabel(id: string): string {
  return ROLES.find((role) => role.id === id)?.label ?? id;
}
