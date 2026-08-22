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
  // Set on as many pieces as the unit has. A game model usually carries these
  // as empty pieces called nano1, nano2 and so on: they have no geometry and
  // exist only as the coordinate the build spray comes out of, which is why
  // they are their own role rather than the nozzle. A nozzle swings and gets
  // counter-rotated by `BUILDARM`. A nano point never moves.
  { id: "buildarm.nano", label: "Nano emit point", group: "Build arm" },
  { id: "door", label: "Door", group: "Structure" },
];

const ROLE_IDS = new Set(ROLES.map((role) => role.id));

export function isRole(value: string): boolean {
  return ROLE_IDS.has(value);
}

export interface PresetParam {
  id: string;
  label: string;
  /**
   * Degrees, seconds, turns per second, metres, or degrees per second.
   * Converted inside `track`.
   *
   * `deg/s` is a rate rather than an angle. A preset using it hands the angle
   * itself straight to the engine, which works it out from the build target,
   * and only decides how fast the piece gets there. `track` reads it to time
   * the preview's swing, so the slider changes what you watch as well as what
   * is exported.
   */
  unit: "deg" | "s" | "hz" | "m" | "deg/s";
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

/**
 * The order the three angles in a `TrackDelta` compose in, as a three.js Euler
 * order, because that is what the engine does with a piece's script rotation.
 *
 * `S3DModelPiece::ComposeTransform` builds `T(pos) * R(baked) * R(script)`
 * with the script rotation as `CQuaternion::FromEulerYPR`, whose four terms
 * are `sp*cy*cr + cp*sy*sr`, `cp*sy*cr - sp*cy*sr`, `cp*cy*sr - sp*sy*cr` and
 * `cp*cy*cr + sp*sy*sr` for pitch about x, yaw about y and roll about z. Those
 * are three.js's own `YXZ` terms exactly.
 *
 * Three's default is `XYZ`, which agrees only while a piece turns about one
 * axis at a time.
 */
export const ENGINE_ROTATION_ORDER = "YXZ";

/** Callins a preset can contribute to in a generated unit script. */
export type LuaHook =
  | "Create"
  | "StartMoving"
  | "StopMoving"
  | "Activate"
  | "Deactivate"
  | "AimWeapon1"
  | "AimFromWeapon1"
  | "QueryWeapon1"
  | "Shot1"
  // A builder is handed a heading and a pitch to point at, a factory is handed
  // nothing at all, and both arrive through this one name. See `BUILD_AIM`.
  | "StartBuilding"
  | "StopBuilding"
  | "QueryNanoPiece"
  | "Killed";

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
        // Working, not merely switched on. This used to hang off Activate,
        // which is the engine's "on" and for a builder is nearly always true,
        // so the arm swept the whole time and stopped for nothing. A build is
        // what StartBuilding and StopBuilding bracket.
        StartBuilding: [`  Signal(${ctx.signal})`, "  StartThread(buildArm)"],
        StopBuilding: [`  Signal(${ctx.signal})`, "  buildArmStop()"],
      },
    };
  },
};

/**
 * How long one leg of the build preview runs, in seconds.
 *
 * A builder in a game aims once and then holds for as long as the job takes, so
 * a preview that only showed the swing would be over before it was noticed and
 * one that only showed the hold would look like nothing. Each leg is a swing
 * followed by a hold, and the two legs aim opposite ways.
 */
const BUILD_PREVIEW_LEG = 3;
/** The most of a leg the swing may take, so there is always a hold to see. */
const BUILD_PREVIEW_SWING = 2 / 3;

/** Where the preview aims on each leg, in degrees of heading and pitch. */
const BUILD_PREVIEW_AIM: [number, number][] = [
  [40, -12],
  [-35, 8],
];

/**
 * Eased 0 to 1 over the swing, then held at 1, given a position within one leg.
 *
 * How long the swing takes is the angle divided by the speed, which is what
 * `Turn` does in a game, so the sliders change the preview and not only the
 * exported script. Capped at part of a leg, because a preview whose swing fills
 * the whole leg never shows the hold, and a hold is most of what a builder does.
 *
 * Cosine rather than linear, because a piece starts and stops against the rest
 * of the model, and a linear ramp in a six second loop reads as a machine part
 * sliding rather than an arm swinging.
 */
function buildSwing(phase: number, angle: number, speed: number): number {
  const swing = Math.min(
    BUILD_PREVIEW_LEG * BUILD_PREVIEW_SWING,
    Math.abs(angle) / Math.max(speed, 1),
  );
  if (phase >= swing) return 1;
  return (1 - Math.cos((phase / swing) * Math.PI)) * 0.5;
}

export const BUILD_AIM: AnimPreset = {
  id: "build.aim",
  label: "Aim while building",
  description:
    "Points the build arm at whatever the unit is building and holds it there until the job stops. A builder only.",
  requires: [{ role: "buildarm.arm", count: 1 }],
  animates: ["buildarm.base", "buildarm.arm"],
  params: [
    {
      id: "turnSpeed",
      label: "Turn speed",
      unit: "deg/s",
      min: 15,
      max: 720,
      step: 15,
      fallback: 120,
    },
    {
      id: "liftSpeed",
      label: "Lift speed",
      unit: "deg/s",
      min: 15,
      max: 720,
      step: 15,
      fallback: 90,
    },
  ],
  /**
   * Two aims, swung to and held, over and over.
   *
   * In a game the heading and pitch come from the build target and the hold
   * lasts as long as the job, so this is a demonstration in the same way
   * `turret.track`'s sweep is. What it shows honestly is which piece takes the
   * heading, which takes the pitch, and how long each takes to get there: the
   * swing runs at the speed that piece's slider sets, so a slow arm is slow to
   * watch rather than only slow in the exported script.
   */
  track(t, params, role) {
    const cycle = BUILD_PREVIEW_LEG * BUILD_PREVIEW_AIM.length;
    const at = t - Math.floor(t / cycle) * cycle;
    const leg = Math.floor(at / BUILD_PREVIEW_LEG);
    const [heading, pitch] = BUILD_PREVIEW_AIM[leg];
    const phase = at - leg * BUILD_PREVIEW_LEG;

    if (role === "buildarm.base") {
      const towards = buildSwing(
        phase,
        heading,
        value(this, params, "turnSpeed"),
      );
      return { rotation: [0, deg(heading) * towards, 0] };
    }
    // The same sign the emitted script uses, so the viewport and a game agree
    // about which way an arm lifts. See `emit`.
    if (role === "buildarm.arm") {
      const towards = buildSwing(
        phase,
        pitch,
        value(this, params, "liftSpeed"),
      );
      return { rotation: [deg(-pitch) * towards, 0, 0] };
    }
    return null;
  },
  /**
   * Hangs off `StartBuilding` directly, with no thread of its own, because the
   * unit script framework already wraps that call-in in one: it is listed in
   * `thread_wrap` in `LuaGadgets/Gadgets/unit_script.lua`, which is what makes
   * `WaitForTurn` legal here.
   *
   * The `if heading` guard is not defensive noise. A factory's `StartBuilding`
   * is called with no arguments at all (`CFactory::StartBuild`), and both
   * shapes arrive through this one function name, so a unit carrying this and
   * the factory preset would otherwise turn to a nil heading on every build.
   *
   * Waiting for both turns before returning is what lets the build stance line
   * the generator appends mean something: the unit says it is in stance once
   * the arm is actually pointing, rather than while it is still swinging.
   */
  emit(ctx) {
    const arm = ctx.pieces("buildarm.arm")[0];
    if (!arm) return null;
    const base = ctx.pieces("buildarm.base")[0];
    const turn = lua(deg(value(this, ctx.params, "turnSpeed")));
    const lift = lua(deg(value(this, ctx.params, "liftSpeed")));

    const aim: string[] = [];
    const rest: string[] = [];
    if (base) {
      aim.push(`    Turn(${base}, y_axis, heading, ${turn})`);
      rest.push(`  Turn(${base}, y_axis, 0, ${turn})`);
    }
    aim.push(`    Turn(${arm}, x_axis, -pitch, ${lift})`);
    rest.push(`  Turn(${arm}, x_axis, 0, ${lift})`);
    if (base) aim.push(`    WaitForTurn(${base}, y_axis)`);
    aim.push(`    WaitForTurn(${arm}, x_axis)`);

    return {
      functions: [],
      hooks: {
        StartBuilding: ["  if heading then", ...aim, "  end"],
        StopBuilding: rest,
      },
    };
  },
};

export const BUILD_FACTORY: AnimPreset = {
  id: "build.factory",
  label: "Factory build cycle",
  description:
    "Opens the doors while a factory is building and shuts them when it stops. No aiming: the engine hands a factory nothing to point at.",
  requires: [{ role: "door", count: 1 }],
  animates: ["door"],
  params: [
    {
      id: "open",
      label: "Opening",
      unit: "deg",
      min: 10,
      max: 180,
      step: 5,
      fallback: 100,
    },
    {
      id: "openTime",
      label: "Opening time",
      unit: "s",
      min: 0.2,
      max: 8,
      step: 0.2,
      fallback: 1.2,
    },
  ],
  /** Open for the first build, shut for the gap, on the same legs the aim
   *  preview uses so a unit carrying both reads as one motion. */
  track(t, params, role) {
    if (role !== "door") return null;
    const cycle = BUILD_PREVIEW_LEG * 2;
    const at = t - Math.floor(t / cycle) * cycle;
    const building = at < BUILD_PREVIEW_LEG;
    const phase = at - (building ? 0 : BUILD_PREVIEW_LEG);
    const open = value(this, params, "open");
    // The doors travel their whole opening in the time the slider asks for,
    // whichever way they are going, so the preview matches the emitted speed.
    const speed = open / Math.max(value(this, params, "openTime"), 0.05);
    const towards = building
      ? buildSwing(phase, open, speed)
      : 1 - buildSwing(phase, open, speed);
    return { rotation: [0, deg(open) * towards, 0] };
  },
  emit(ctx) {
    const doors = ctx.pieces("door");
    if (doors.length === 0) return null;
    const open = value(this, ctx.params, "open");
    const speed = lua(
      deg(open) / Math.max(value(this, ctx.params, "openTime"), 0.05),
    );
    const angle = lua(deg(open));

    return {
      functions: [],
      hooks: {
        // No wait: a factory's build starts whether or not the doors have
        // finished, and holding the call-in open would only delay the unit
        // appearing behind them.
        StartBuilding: doors.map(
          (door) => `  Turn(${door}, y_axis, ${angle}, ${speed})`,
        ),
        // Shutting is not optional: a door left open is a hole in the model.
        StopBuilding: doors.map(
          (door) => `  Turn(${door}, y_axis, 0, ${speed})`,
        ),
      },
    };
  },
};

export const BUILD_NANO: AnimPreset = {
  id: "build.nano",
  label: "Nano from the nozzle",
  description:
    "Sends the build spray out of the pieces marked as nano emit points, taking each in turn, rather than out of the model's origin.",
  requires: [{ role: "buildarm.nano", count: 1 }],
  // Moves nothing. It answers a question the engine asks rather than posing
  // the model, which is why there is no track below either.
  animates: [],
  params: [],
  track() {
    return null;
  },
  /**
   * `QueryNanoPiece` is the one call-in here that is not thread-wrapped: it is
   * commented out of `thread_wrap` in `unit_script.lua`, so it has to return
   * straight away and may not wait for anything.
   *
   * Cycling rather than answering with one piece is what a builder with more
   * than one nozzle does, and it is why the role takes many pieces. The counter
   * is a file-scope local, which is per unit rather than shared: the framework
   * compiles the chunk once and re-runs it in each unit's own environment.
   */
  emit(ctx) {
    const nano = ctx.pieces("buildarm.nano");
    if (nano.length === 0) return null;
    return {
      functions: [
        `local nanoPieces = { ${nano.join(", ")} }`,
        "local nanoIndex = 0",
      ],
      hooks: {
        QueryNanoPiece: [
          "  nanoIndex = nanoIndex % #nanoPieces + 1",
          "  return nanoPieces[nanoIndex]",
        ],
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

/**
 * Rest between test-fires in the preview, once the kick has eased home.
 *
 * Not a param: it has no counterpart in the emitted script, which fires
 * whenever the weapon does and nothing else. It only exists so a preview at
 * rest keeps demonstrating the motion instead of firing once and going still.
 */
const RECOIL_PREVIEW_PAUSE = 0.6;

export const RECOIL: AnimPreset = {
  id: "recoil",
  label: "Recoil on firing",
  description:
    "Kicks the barrel back along its own bore when the weapon fires, and eases it home. A one-shot, not a loop: the preview repeats it on a timer so there is something to watch.",
  requires: [{ role: "barrel", count: 1 }],
  animates: ["barrel"],
  params: [
    {
      id: "kick",
      label: "Kick distance",
      unit: "m",
      min: 0.02,
      max: 1,
      step: 0.02,
      fallback: 0.2,
    },
    {
      id: "kickTime",
      label: "Kick time",
      unit: "s",
      min: 0.02,
      max: 0.3,
      step: 0.01,
      fallback: 0.05,
    },
    {
      id: "returnTime",
      label: "Return time",
      unit: "s",
      min: 0.05,
      max: 1.5,
      step: 0.05,
      fallback: 0.35,
    },
  ],
  /**
   * Turret sweep already claims y_axis for heading and x_axis for pitch, and a
   * barrel modelled the way Spring content is built points down its own rest
   * z_axis. That leaves z as the barrel's bore, which is what recoil pulls
   * back along.
   *
   * The preview loops the kick and its return on a fixed cycle, exactly the
   * demonstration turret.track already gives its own sweep: in a game this
   * runs once per shot, but a preview with nothing to watch after the first
   * frame is not a preview.
   */
  track(t, params, role) {
    if (role !== "barrel") return null;
    const kick = value(this, params, "kick");
    const kickTime = Math.max(value(this, params, "kickTime"), 0.01);
    const returnTime = Math.max(value(this, params, "returnTime"), 0.01);
    const cycle = kickTime + returnTime + RECOIL_PREVIEW_PAUSE;
    const phase = t - Math.floor(t / cycle) * cycle;

    let depth = 0;
    if (phase < kickTime) {
      depth = kick * (phase / kickTime);
    } else if (phase < kickTime + returnTime) {
      depth = kick * (1 - (phase - kickTime) / returnTime);
    }
    return { position: [0, 0, -depth] };
  },
  /**
   * A one-shot hangs off Shot1 directly, the same as turret.track's aim hangs
   * off AimWeapon1: no thread, because the callin is already its own thread,
   * started fresh by the engine every time the weapon fires. Signal and
   * SetSignalMask stop a kick still easing home from an earlier shot, so rapid
   * fire restarts the motion cleanly rather than piling moves on top of it.
   */
  emit(ctx) {
    const barrel = ctx.pieces("barrel")[0];
    if (!barrel) return null;
    const kick = value(this, ctx.params, "kick");
    const kickTime = Math.max(value(this, ctx.params, "kickTime"), 0.01);
    const returnTime = Math.max(value(this, ctx.params, "returnTime"), 0.01);

    return {
      functions: [],
      hooks: {
        Shot1: [
          `  Signal(${ctx.signal})`,
          `  SetSignalMask(${ctx.signal})`,
          `  Move(${barrel}, z_axis, -${lua(kick)}, ${lua(kick / kickTime)})`,
          `  WaitForMove(${barrel}, z_axis)`,
          `  Move(${barrel}, z_axis, 0, ${lua(kick / returnTime)})`,
        ],
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

export const WRECK_POSE: AnimPreset = {
  id: "wreck.pose",
  label: "Wreck pose",
  description:
    "Poses the body as a collapsed wreck the instant the unit is killed. Not an animation: there is nothing to sample over time, so the piece snaps straight into the pose and stays there.",
  requires: [{ role: "base", count: 1 }],
  animates: ["base"],
  params: [
    {
      id: "sink",
      label: "Sink",
      unit: "m",
      min: 0,
      max: 1,
      step: 0.05,
      fallback: 0.15,
    },
    {
      id: "tilt",
      label: "Tilt",
      unit: "deg",
      min: 0,
      max: 45,
      step: 1,
      fallback: 12,
    },
  ],
  /**
   * `t` is accepted, as every preset's `track` must, but not read: a wreck is
   * a single pose, not a cycle, so the delta is the same whatever moment it
   * is asked for. That is what lets the viewport preview it with the existing
   * playback loop and no change to how presets are sampled.
   */
  track(_t, params, role) {
    if (role !== "base") return null;
    return {
      position: [0, -value(this, params, "sink"), 0],
      rotation: [0, 0, deg(value(this, params, "tilt"))],
    };
  },
  /**
   * Killed is the real death callin (`bos2lua.ts` keeps its name unchanged
   * converting BOS to Lua, the same evidence that placed recoil on `Shot1`).
   * It already runs once, so this needs no thread and no signal, unlike a
   * looping preset or one that might restart mid-flight.
   *
   * The pose is written as an instant `Move`/`Turn`, with no speed argument,
   * because a wreck does not ease into place: it is simply what the unit
   * looks like once it stops being alive.
   */
  emit(ctx) {
    const base = ctx.pieces("base")[0];
    if (!base) return null;
    const sink = value(this, ctx.params, "sink");
    const tilt = value(this, ctx.params, "tilt");

    return {
      functions: [],
      hooks: {
        Killed: [
          `  Move(${base}, y_axis, -${lua(sink)})`,
          `  Turn(${base}, z_axis, ${lua(deg(tilt))})`,
        ],
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
  BUILD_AIM,
  BUILD_FACTORY,
  BUILD_NANO,
  OPEN_CLOSE,
  HOVER_BOB,
  AIM_TRACK,
  RECOIL,
  IDLE_SWAY,
  WRECK_POSE,
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

/**
 * Which local axes (0 = x, 1 = y, 2 = z) a role's rotation actually turns
 * about, read off every preset's `track` above rather than assumed.
 *
 * Most roles turn about exactly one axis, but two do not. `base` turns about
 * y under idle sway and z under hover-and-bob or a wreck pose, because those
 * are different presets claiming the same role, and `aim` turns about both x
 * and y at once, standing in for a turret's separate pitch and heading on a
 * single piece. A role missing here, such as `flare`, is never itself turned.
 */
const ROLE_ROTATION_AXES: Record<string, readonly number[]> = {
  turret: [1],
  barrel: [0],
  wheel: [0],
  "buildarm.base": [1],
  "buildarm.arm": [0],
  "buildarm.nozzle": [0],
  door: [1],
  base: [1, 2],
  aim: [0, 1],
};

const LEG_ROLE = /^leg\.[lr][12]\.(?:thigh|shin|foot)$/;

/** The axes a role's rest rotation should sit on a right angle for. Empty for
 *  a role no preset ever turns. Leg roles turn about x regardless of side or
 *  pair, so they match by pattern rather than one table entry each. */
function roleRotationAxes(role: string): readonly number[] {
  if (LEG_ROLE.test(role)) return [0];
  return ROLE_ROTATION_AXES[role] ?? [];
}

const AXIS_LETTERS = ["X", "Y", "Z"];

/**
 * How far off a right angle a rest rotation can sit before it is worth
 * mentioning. A drag rarely lands on exactly 90 degrees, and the gizmo's own
 * rotation snap steps in 15 degree increments, so this stays well inside half
 * of that or a deliberate 15 degree piece would nag too.
 */
const REST_ANGLE_TOLERANCE_DEG = 2;

/**
 * Whether a piece's rest rotation is a clean right angle on every axis its
 * role turns about, as sentences meant to be shown next to the role picker.
 *
 * A piece's rest rotation is baked into its vertices on export (see
 * `s3oBuild.ts`'s `bakeGeometry`). The engine keeps no separate record of it,
 * so a `Turn` call always measures its target from that baked pose. Someone
 * reading the viewport and typing a target relative to what they see needs
 * the baked value to be a clean, memorable number. 90 degrees is one, 37.284
 * is not, and a hand-edited `Turn` on that axis will not land where it looks
 * like it should.
 *
 * Advice, not validation. A piece is free to sit at any angle, this warns and
 * nothing more, and export is unaffected either way.
 */
export function restAngleWarnings(piece: {
  role?: string;
  rotation: [number, number, number];
}): string[] {
  if (!piece.role) return [];
  const warnings: string[] = [];
  for (const axis of roleRotationAxes(piece.role)) {
    const degrees = (piece.rotation[axis] * 180) / Math.PI;
    const nearest = Math.round(degrees / 90) * 90;
    if (Math.abs(degrees - nearest) <= REST_ANGLE_TOLERANCE_DEG) continue;
    const clean = ((nearest % 360) + 360) % 360;
    warnings.push(
      `${roleLabel(piece.role)} turns about ${AXIS_LETTERS[axis]}, and this piece's rest rotation there is ${degrees.toFixed(1)}°, not a right angle. A hand-edited Turn call may not land where it looks like it should. The nearest clean angle is ${clean}°.`,
    );
  }
  return warnings;
}
