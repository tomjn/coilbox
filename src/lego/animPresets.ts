/**
 * Roles a piece can take, and the canned animations that drive them.
 *
 * A preset is pure: `track` returns a transform delta from a piece's rest pose
 * at a given moment, and knows nothing about three, the document or the
 * viewport. The preview does not play it. It runs the Lua the preset writes,
 * and `track` is what `presetParity.test.ts` holds that Lua to, and what
 * `cycleThread` samples to write the looping presets.
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
  // The tread a tracked unit stands on. Nothing animates it, since a unit
  // script cannot scroll a texture, so it only tells the balance check where
  // the ground contact is.
  { id: "track", label: "Track", group: "Movement" },
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
  // One of each per weapon, numbered from 1 in the order of the unit
  // definition's `weapons` table. See `WeaponHook`.
  | WeaponHook
  // A builder is handed a heading and a pitch to point at, a factory is handed
  // nothing at all, and both arrive through this one name. See `BUILD_AIM`.
  | "StartBuilding"
  | "StopBuilding"
  | "QueryNanoPiece"
  | "Killed";

/**
 * The call-ins the engine asks once per weapon. The unit script gadget
 * (`LuaGadgets/Gadgets/unit_script.lua`) dispatches the engine's one
 * `AimWeapon(weaponNum, ...)` to `AimWeapon<weaponNum>`, and the same for the
 * others, for every slot of the unit definition's `weapons` table.
 */
export type WeaponHook =
  | `AimWeapon${number}`
  | `AimFromWeapon${number}`
  | `QueryWeapon${number}`
  | `Shot${number}`;

/** The roles a weapon's own pieces carry. */
export type WeaponRole = "turret" | "aim" | "barrel" | "flare";

/** One weapon of the unit, with the pieces that are its own. */
export interface EmitWeapon {
  /** Its slot, counted from 1, which is the n in `AimWeapon<n>`. */
  number: number;
  /**
   * The weapon's own piece in a role, or undefined when it has none. Asking
   * marks it used, as `EmitContext.pieces` does.
   */
  piece(role: WeaponRole): string | undefined;
  /**
   * A signal of this preset's own for this weapon alone. Each weapon needs its
   * own, because aiming starts with `Signal`, which would otherwise cancel
   * another weapon's aim still turning.
   */
  signal: string;
}

/**
 * One module instance's share of a preset's pieces (#3302).
 *
 * A unit holding the same module twice has two of each of its roles, and a
 * preset written for one build arm or one set of legs works on each instance
 * in turn rather than on the first piece it finds.
 */
export interface EmitInstance {
  /** Counted from 1, in the order the instances' pieces appear in the unit. */
  number: number;
  /** This instance's pieces carrying a role, in document order. Asking marks
   *  them used, as `EmitContext.pieces` does. */
  pieces(role: string): string[];
  /**
   * A signal of this preset's own for this instance alone, so one instance's
   * `Signal` does not stop another's thread. The first instance's is the
   * preset's own `signal`, which keeps a unit with one instance's script as it
   * was.
   */
  signal: string;
  /** A Lua name for one of this instance's functions: `base` for the first
   *  instance and `base<n>` for the others, so no two clash. */
  name(base: string): string;
}

export interface EmitContext {
  /**
   * Names of the pieces carrying a role, in document order. Asking marks them
   * used, so the script declares a local for exactly what it references.
   */
  pieces(role: string): string[];
  /** The unit's weapons, in slot order. */
  weapons(): EmitWeapon[];
  /**
   * The module instances carrying the roles this preset animates or needs, in
   * the order their pieces appear. Pieces that came from no module are one
   * instance between them, so a unit with no modules, or with one, has a
   * single instance and the script it always had.
   */
  instances(): EmitInstance[];
  params: Record<string, number>;
  /** A signal number of this preset's own, for stopping its threads. */
  signal: string;
}

export interface EmitResult {
  /** Threads and helpers, written above the callins. */
  functions: string[];
  hooks: Partial<Record<LuaHook, string[]>>;
}

/** What a preset is written once for, when that can be more than once. */
export interface PresetCopies {
  /** Each of the unit's weapons, or each module instance. */
  per: "weapon" | "instance";
  /** The role one copy cannot do without. Absent means any role the preset
   *  animates. */
  role?: string;
  /** What the Animation panel calls them, plural, as in "2 turrets". */
  noun: string;
}

export interface AnimPreset {
  id: string;
  label: string;
  description: string;
  /** Absent for a preset written once whatever the unit holds. */
  copies?: PresetCopies;
  /** Roles that must be filled, with how many pieces each needs at least. */
  requires: { role: string; count: number }[];
  /** Every role this preset may move. */
  animates: string[];
  params: PresetParam[];
  /**
   * Where the preset puts a piece at time `t`, null when it does not move that
   * role. Not played by the preview: it is the specification the parity test
   * compares the preset's Lua against.
   */
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
 * The fewest poses per cycle in a generated thread.
 *
 * Four is the fewest that reads as motion. Two would sample a sine at its
 * zero crossings and emit a thread that stands still. `cycleSteps` adds more
 * where four would cut the curve's corners by more than a frame.
 */
const CYCLE_STEPS = 4;

/** Sim frames per second, the engine's `GAME_SPEED`. */
const ENGINE_FPS = 30;

/**
 * Milliseconds per frame as `Sleep` counts them. The framework's `Sleep` waits
 * `floor(ms / 33)` frames (`LuaGadgets/Gadgets/unit_script.lua`), so a sleep
 * written as a whole number of these lasts exactly that many frames.
 */
const SLEEP_FRAME_MS = 33;

/**
 * The frames a cycle thread's poses fall on, from 0 to one whole cycle.
 *
 * Whole frames, because the engine moves a piece once a frame and `Sleep`
 * waits whole frames. A step whose length is not a whole number of frames
 * sleeps short, and the cycle runs faster than `track` says.
 *
 * A Turn or a Move goes at one speed, so between two poses the piece moves in
 * a straight line while `track` follows a curve. This takes the fewest steps,
 * starting at `CYCLE_STEPS`, for which no piece strays from the curve by more
 * than the curve itself moves in one frame. Closer than that is finer than the
 * engine can show. A slow cycle needs more steps than a fast one, because its
 * one frame of motion is smaller.
 */
export function cycleSteps(
  preset: AnimPreset,
  params: Record<string, number>,
  period: number,
): number[] {
  const frames = Math.max(1, Math.round(period * ENGINE_FPS));
  const curves: number[][] = [];
  for (const role of preset.animates) {
    const samples = Array.from({ length: frames + 1 }, (_, frame) =>
      preset.track(frame / ENGINE_FPS, params, role),
    );
    for (const key of ["position", "rotation"] as const) {
      for (let axis = 0; axis < 3; axis++) {
        curves.push(samples.map((delta) => delta?.[key]?.[axis] ?? 0));
      }
    }
  }

  for (let steps = Math.min(CYCLE_STEPS, frames); ; steps++) {
    const bounds = [
      ...new Set(
        Array.from({ length: steps + 1 }, (_, step) =>
          Math.round((step * frames) / steps),
        ),
      ),
    ];
    if (steps >= frames) return bounds;
    const close = curves.every((curve) => {
      let travel = 0;
      for (let frame = 1; frame <= frames; frame++) {
        travel = Math.max(travel, Math.abs(curve[frame] - curve[frame - 1]));
      }
      for (let index = 1; index < bounds.length; index++) {
        const [a, b] = [bounds[index - 1], bounds[index]];
        for (let frame = a; frame <= b; frame++) {
          const line =
            curve[a] + ((curve[b] - curve[a]) * (frame - a)) / (b - a);
          if (Math.abs(curve[frame] - line) > travel) return false;
        }
      }
      return true;
    });
    if (close) return bounds;
  }
}

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
 *
 * Each step turns towards the next pose and sleeps until it is there, so the
 * thread is where `track` is at the same time after it starts, once the first
 * lap has brought it in from rest. `presetParity.test.ts` checks that against
 * the runtime.
 */
function cycleThread(
  preset: AnimPreset,
  params: Record<string, number>,
  instance: EmitInstance,
  options: { name: string; period: number },
): string[] | null {
  const targets = preset.animates.flatMap((role) =>
    instance.pieces(role).map((piece) => ({ role, piece })),
  );
  if (targets.length === 0) return null;

  const bounds = cycleSteps(preset, params, options.period);
  const count = bounds.length - 1;

  // Sample the whole cycle before writing any of it. A step's move is measured
  // against the step before it, and the first step follows the last, because
  // the thread loops. Measuring the first against a rest pose would be right
  // once and wrong on every lap after that.
  const poses = Array.from({ length: count }, (_, step) => {
    const t = bounds[step] / ENGINE_FPS;
    const pose = new Map<string, CyclePose>();
    for (const { role, piece } of targets) {
      const delta = preset.track(t, params, role);
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

  // Step k heads for pose k, from pose k - 1, and the last heads back round to
  // the first, which is what the loop then starts from again.
  for (let step = 1; step <= count; step++) {
    const frames = bounds[step] - bounds[step - 1];
    const stepSeconds = frames / ENGINE_FPS;
    const before = poses[step - 1];
    for (const [piece, pose] of poses[step % count]) {
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
    body.push(`    Sleep(${frames * SLEEP_FRAME_MS})`);
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

  return [
    `local function ${options.name}()`,
    `  SetSignalMask(${instance.signal})`,
    "  while true do",
    ...body,
    "  end",
    "end",
    "",
    `local function ${options.name}Stop()`,
    ...rest,
    "end",
  ];
}

/**
 * One `cycleThread` per module instance, each started from `start` and, when
 * given, stood down from `stop`. Every instance's thread has its own name and
 * signal, so the threads run side by side and stopping one stops only that one.
 * A unit with one instance gets one thread called `name`, as it always did.
 */
function cycleThreads(
  preset: AnimPreset,
  ctx: EmitContext,
  options: { name: string; start: LuaHook; stop?: LuaHook },
): EmitResult | null {
  const period = Math.max(value(preset, ctx.params, "period"), 0.05);
  const functions: string[] = [];
  const started: string[] = [];
  const stopped: string[] = [];
  for (const instance of ctx.instances()) {
    const name = instance.name(options.name);
    const thread = cycleThread(preset, ctx.params, instance, { name, period });
    if (!thread) continue;
    if (functions.length > 0) functions.push("");
    functions.push(...thread);
    started.push(`  Signal(${instance.signal})`, `  StartThread(${name})`);
    stopped.push(`  Signal(${instance.signal})`, `  ${name}Stop()`);
  }
  if (functions.length === 0) return null;
  return {
    functions,
    hooks: {
      [options.start]: started,
      ...(options.stop ? { [options.stop]: stopped } : {}),
    },
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
  copies: { per: "instance", noun: "sets of legs" },
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
  copies: { per: "instance", noun: "sets of legs" },
  animates: legRoles([1, 2]),
  params: WALK_PARAMS,
  track(t, params, role) {
    return walkTrack(this, t, params, role, "quad");
  },
  emit(ctx) {
    return walkEmit(this, ctx);
  },
};

/**
 * Walking starts and stops with the unit, so it hangs off the move callins.
 * Each module instance of legs walks in a thread of its own, all started by
 * the same `StartMoving`, so a leg's phase still comes from its role alone.
 */
function walkEmit(preset: AnimPreset, ctx: EmitContext): EmitResult | null {
  return cycleThreads(preset, ctx, {
    name: "walk",
    start: "StartMoving",
    stop: "StopMoving",
  });
}

/**
 * How fast an aim preset turns and lifts, in radians per second, as Lua.
 *
 * Fast enough to land when the preview does. Its sweep is furthest out, at the
 * full turn and the full lift, a quarter of the sweep time in, and a Turn goes
 * at one speed, so each angle over that quarter is its own speed. An angle of
 * nothing gives a speed of nothing, which the engine takes as instant.
 */
function aimSpeeds(
  preset: AnimPreset,
  params: Record<string, number>,
): { turn: string | null; lift: string | null } {
  const quarter = Math.max(value(preset, params, "period"), 0.05) / 4;
  // A Turn at speed 0 is the engine's "turn there now", so a slider at 0 gets
  // no Turn at all and the piece holds still, as it does in the preview.
  const speed = (id: string) => {
    const angle = value(preset, params, id);
    return angle > 0 ? lua(deg(angle) / quarter) : null;
  };
  return { turn: speed("sweep"), lift: speed("pitch") };
}

export const TURRET_TRACK: AnimPreset = {
  id: "turret.track",
  label: "Turret sweep",
  description:
    "Turns the turret and lifts the barrel, the motion a turret makes tracking a target.",
  requires: [{ role: "turret", count: 1 }],
  copies: { per: "weapon", role: "turret", noun: "turrets" },
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
    const speed = aimSpeeds(this, ctx.params);
    const hooks: EmitResult["hooks"] = {};
    for (const weapon of ctx.weapons()) {
      const turret = weapon.piece("turret");
      if (!turret) continue;
      const barrel = weapon.piece("barrel");
      const flare = weapon.piece("flare");
      const n = weapon.number;
      hooks[`AimWeapon${n}`] = [
        `  Signal(${weapon.signal})`,
        `  SetSignalMask(${weapon.signal})`,
        ...(speed.turn
          ? [`  Turn(${turret}, y_axis, heading, ${speed.turn})`]
          : []),
        ...(barrel && speed.lift
          ? [`  Turn(${barrel}, x_axis, -pitch, ${speed.lift})`]
          : []),
        ...(speed.turn ? [`  WaitForTurn(${turret}, y_axis)`] : []),
        ...(barrel && speed.lift ? [`  WaitForTurn(${barrel}, x_axis)`] : []),
        "  return true",
      ];
      hooks[`AimFromWeapon${n}`] = [`  return ${turret}`];
      hooks[`QueryWeapon${n}`] = [`  return ${flare ?? barrel ?? turret}`];
    }
    return Object.keys(hooks).length > 0 ? { functions: [], hooks } : null;
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
  copies: { per: "instance", noun: "build arms" },
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
    // Working, not merely switched on. This used to hang off Activate, which
    // is the engine's "on" and for a builder is nearly always true, so the arm
    // swept the whole time and stopped for nothing. A build is what
    // StartBuilding and StopBuilding bracket.
    return cycleThreads(this, ctx, {
      name: "buildArm",
      start: "StartBuilding",
      stop: "StopBuilding",
    });
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
export const BUILD_PREVIEW_LEG = 3;

/** Where the preview aims on each leg, in degrees of heading and pitch. */
export const BUILD_PREVIEW_AIM: [number, number][] = [
  [40, -12],
  [-35, 8],
];

/**
 * How far through its swing a piece is, 0 to 1, given a position within one
 * leg.
 *
 * At one speed from start to finish, the angle divided by the speed, because
 * that is what `Turn` does in a game. The sliders change the preview and not
 * only the exported script, and a slow arm that would still be swinging when
 * the leg ends is still swinging in the preview too. This used to ease in and
 * out along a cosine and to cap the swing at two seconds, and neither has a
 * counterpart in the engine.
 */
function buildSwing(phase: number, angle: number, speed: number): number {
  if (angle === 0) return 1;
  return Math.min(1, (phase * Math.max(speed, 1)) / Math.abs(angle));
}

export const BUILD_AIM: AnimPreset = {
  id: "build.aim",
  label: "Aim while building",
  description:
    "Points the build arm at whatever the unit is building and holds it there until the job stops. A builder only.",
  requires: [{ role: "buildarm.arm", count: 1 }],
  copies: { per: "instance", role: "buildarm.arm", noun: "build arms" },
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
   *
   * Each module instance's arm aims, the first arm of its own instance with
   * that instance's base. Every arm is set turning before any is waited for,
   * so two arms swing together rather than one after the other.
   */
  emit(ctx) {
    const turn = lua(deg(value(this, ctx.params, "turnSpeed")));
    const lift = lua(deg(value(this, ctx.params, "liftSpeed")));

    const turns: string[] = [];
    const waits: string[] = [];
    const rest: string[] = [];
    for (const instance of ctx.instances()) {
      const arm = instance.pieces("buildarm.arm")[0];
      if (!arm) continue;
      const base = instance.pieces("buildarm.base")[0];
      if (base) {
        turns.push(`    Turn(${base}, y_axis, heading, ${turn})`);
        rest.push(`  Turn(${base}, y_axis, 0, ${turn})`);
      }
      turns.push(`    Turn(${arm}, x_axis, -pitch, ${lift})`);
      rest.push(`  Turn(${arm}, x_axis, 0, ${lift})`);
      if (base) waits.push(`    WaitForTurn(${base}, y_axis)`);
      waits.push(`    WaitForTurn(${arm}, x_axis)`);
    }
    if (turns.length === 0) return null;

    return {
      functions: [],
      hooks: {
        StartBuilding: ["  if heading then", ...turns, ...waits, "  end"],
        StopBuilding: rest,
      },
    };
  },
};

/**
 * The widest a factory's doors open, in degrees.
 *
 * Short of half a turn, because `Turn` takes the shortest way round
 * (`CUnitScript::TurnToward`), and from shut half a turn is as short backwards
 * as forwards. At 180 the engine swung the doors open the wrong way. 170 is
 * where the Doors preset's own slider stops.
 */
const FACTORY_MAX_OPEN = 170;

/** The opening a factory preset asks for, held under `FACTORY_MAX_OPEN` so a
 *  project saved while the slider went to 180 opens the right way too. */
function factoryOpening(
  preset: AnimPreset,
  params: Record<string, number>,
): number {
  return Math.min(value(preset, params, "open"), FACTORY_MAX_OPEN);
}

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
      max: FACTORY_MAX_OPEN,
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
    // The doors travel their whole opening in the time the slider asks for,
    // whichever way they are going, so the preview matches the emitted speed.
    // Doors slower than a leg are still opening when the build stops, and
    // `StopBuilding` shuts them from there, so the gap does too.
    const openTime = Math.max(value(this, params, "openTime"), 0.05);
    const reached = Math.min(1, BUILD_PREVIEW_LEG / openTime);
    const towards = building
      ? Math.min(1, phase / openTime)
      : Math.max(0, reached - phase / openTime);
    return { rotation: [0, deg(factoryOpening(this, params)) * towards, 0] };
  },
  emit(ctx) {
    const doors = ctx.pieces("door");
    if (doors.length === 0) return null;
    const open = factoryOpening(this, ctx.params);
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
  copies: { per: "instance", noun: "sets of doors" },
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
    // Shutting on Deactivate is not optional: a door left open is a hole in
    // the model.
    return cycleThreads(this, ctx, {
      name: "doors",
      start: "Activate",
      stop: "Deactivate",
    });
  },
};

export const HOVER_BOB: AnimPreset = {
  id: "hover.bob",
  label: "Hover and bob",
  description:
    "Bobs the body up and down and rocks it gently side to side, the way an aircraft or hovercraft sits while holding position.",
  requires: [{ role: "base", count: 1 }],
  copies: { per: "instance", noun: "bodies" },
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
    // Holding position is what the unit does for its whole life, not something
    // it starts and stops, so this starts once on Create and is never told to
    // stand down.
    return cycleThreads(this, ctx, { name: "hover", start: "Create" });
  },
};

export const AIM_TRACK: AnimPreset = {
  id: "aim.track",
  label: "Aim point",
  description:
    "Turns and lifts a single piece to face a target, for a unit with no separate turret and barrel.",
  requires: [{ role: "aim", count: 1 }],
  copies: { per: "weapon", role: "aim", noun: "aim points" },
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
    const speed = aimSpeeds(this, ctx.params);
    const hooks: EmitResult["hooks"] = {};
    for (const weapon of ctx.weapons()) {
      const aim = weapon.piece("aim");
      if (!aim) continue;
      const n = weapon.number;
      hooks[`AimWeapon${n}`] = [
        `  Signal(${weapon.signal})`,
        `  SetSignalMask(${weapon.signal})`,
        ...(speed.turn
          ? [`  Turn(${aim}, y_axis, heading, ${speed.turn})`]
          : []),
        ...(speed.lift
          ? [`  Turn(${aim}, x_axis, -pitch, ${speed.lift})`]
          : []),
        ...(speed.turn ? [`  WaitForTurn(${aim}, y_axis)`] : []),
        ...(speed.lift ? [`  WaitForTurn(${aim}, x_axis)`] : []),
        "  return true",
      ];
      hooks[`AimFromWeapon${n}`] = [`  return ${aim}`];
      hooks[`QueryWeapon${n}`] = [`  return ${aim}`];
    }
    return Object.keys(hooks).length > 0 ? { functions: [], hooks } : null;
  },
};

/**
 * Rest between test-fires in the preview, once the kick has eased home.
 *
 * Not a param: it has no counterpart in the emitted script, which fires
 * whenever the weapon does and nothing else. It only exists so a preview at
 * rest keeps demonstrating the motion instead of firing once and going still.
 */
export const RECOIL_PREVIEW_PAUSE = 0.6;

export const RECOIL: AnimPreset = {
  id: "recoil",
  label: "Recoil on firing",
  description:
    "Kicks the barrel back along its own bore when the weapon fires, and eases it home. A one-shot, not a loop: the preview repeats it on a timer so there is something to watch.",
  requires: [{ role: "barrel", count: 1 }],
  copies: { per: "weapon", role: "barrel", noun: "barrels" },
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
   * A one-shot hangs off each weapon's `Shot<n>` directly, the same as
   * turret.track's aim hangs off `AimWeapon<n>`, and kicks that weapon's own
   * barrel: no thread, because the callin is already its own thread,
   * started fresh by the engine every time the weapon fires. Signal and
   * SetSignalMask stop a kick still easing home from an earlier shot, so rapid
   * fire restarts the motion cleanly rather than piling moves on top of it.
   */
  emit(ctx) {
    const kick = value(this, ctx.params, "kick");
    const kickTime = Math.max(value(this, ctx.params, "kickTime"), 0.01);
    const returnTime = Math.max(value(this, ctx.params, "returnTime"), 0.01);
    const hooks: EmitResult["hooks"] = {};
    for (const weapon of ctx.weapons()) {
      const barrel = weapon.piece("barrel");
      if (!barrel) continue;
      hooks[`Shot${weapon.number}`] = [
        `  Signal(${weapon.signal})`,
        `  SetSignalMask(${weapon.signal})`,
        `  Move(${barrel}, z_axis, -${lua(kick)}, ${lua(kick / kickTime)})`,
        `  WaitForMove(${barrel}, z_axis)`,
        `  Move(${barrel}, z_axis, 0, ${lua(kick / returnTime)})`,
      ];
    }
    return Object.keys(hooks).length > 0 ? { functions: [], hooks } : null;
  },
};

export const IDLE_SWAY: AnimPreset = {
  id: "idle.sway",
  label: "Idle sway",
  description:
    "A slow turn back and forth while the unit stands still: a gentle body sway, or a scanning dish if that is what the piece is.",
  requires: [{ role: "base", count: 1 }],
  copies: { per: "instance", noun: "bodies" },
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
    // The opposite of walking: idle motion picks up once the unit stops, and
    // stands down the moment it moves again.
    return cycleThreads(this, ctx, {
      name: "idleSway",
      start: "StopMoving",
      stop: "StartMoving",
    });
  },
};

export const WRECK_POSE: AnimPreset = {
  id: "wreck.pose",
  label: "Wreck pose",
  description:
    "Sinks and tilts the body into the wreck the unit leaves when it dies. Export bakes this pose into the wreck's own model. Not an animation: the piece snaps straight into the pose and stays there.",
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
   * Killed is the real death callin (the BOS to Lua converter keeps its name,
   * the same evidence that placed recoil on `Shot1`).
   *
   * In a game nobody sees these lines. A `Killed` that returns a number marks
   * the death script finished (`CLuaUnitScript::Killed`), which is what
   * `CUnitHandler::QueueDeleteUnit` waits for to remove the unit, and the wreck
   * the engine puts in its place is a feature with no script.
   * The pose reaches the game through the wreck's model instead, which
   * `wreck.ts` bakes from `track` (issue #3310). The lines stay because the
   * preview runs this script, and they are what make its "Hit and destroyed"
   * run end on the wreck the game will draw.
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
