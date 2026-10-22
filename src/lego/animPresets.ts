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

import { plural, select, t } from "@lingui/core/macro";
import { formatFixed } from "@/lib/format";
import { EVERY_CUT, WRECK_STAGES } from "./breakApart";
import {
  clampedHeading,
  clampedPitch,
  headingOutside,
  pitchOutside,
  pitchRange,
  yawRange,
} from "./jointLimits";
import type { LegoPieceLimits } from "./model";

export interface LegoRole {
  id: string;
  label: string;
  /** Grouped in the picker, because there are more roles than fit a flat list. */
  group: string;
}

/**
 * A leg role's label. Pair 1 is always the front pair, so it says so. A later
 * pair is front or rear or in between depending on how many the unit has, so
 * it is only numbered.
 */
export function legRoleLabel(side: "l" | "r", pair: number, segment: string) {
  if (pair === 1) {
    return side === "l"
      ? select(segment, {
          thigh: "Front left thigh",
          shin: "Front left shin",
          foot: "Front left foot",
          other: `Front left ${segment}`,
        })
      : select(segment, {
          thigh: "Front right thigh",
          shin: "Front right shin",
          foot: "Front right foot",
          other: `Front right ${segment}`,
        });
  }
  return side === "l"
    ? select(segment, {
        thigh: `Left thigh, pair ${pair}`,
        shin: `Left shin, pair ${pair}`,
        foot: `Left foot, pair ${pair}`,
        other: `Left ${segment}, pair ${pair}`,
      })
    : select(segment, {
        thigh: `Right thigh, pair ${pair}`,
        shin: `Right shin, pair ${pair}`,
        foot: `Right foot, pair ${pair}`,
        other: `Right ${segment}, pair ${pair}`,
      });
}

/** The picker's entries for every leg of pairs 1 to `pairs`, front first. */
export function legRoleEntries(pairs: number): LegoRole[] {
  const entries: LegoRole[] = [];
  for (let pair = 1; pair <= pairs; pair++) {
    for (const side of ["l", "r"] as const) {
      for (const segment of ["thigh", "shin", "foot"]) {
        entries.push({
          id: `leg.${side}${pair}.${segment}`,
          label: legRoleLabel(side, pair, segment),
          group: "Legs",
        });
      }
    }
  }
  return entries;
}

/**
 * Legs are numbered as well as sided, which the plan's `leg.<l|r>.<segment>`
 * did not allow for. A quadruped needs a second pair, and without an index
 * there is no way to say which is which. Pair 1 is at the front and the
 * numbers go back along the body (#3351). Two pairs are listed here, and a
 * unit may have any number: `isRole` takes any pair, and `pickerRoles` lists
 * one pair past the unit's last.
 */
export const ROLES: LegoRole[] = [
  {
    id: "base",
    get label() {
      return t`Body`;
    },
    group: "Structure",
  },
  {
    id: "turret",
    get label() {
      return t`Turret`;
    },
    group: "Weapon",
  },
  {
    id: "barrel",
    get label() {
      return t`Barrel`;
    },
    group: "Weapon",
  },
  {
    id: "flare",
    get label() {
      return t`Muzzle flare`;
    },
    group: "Weapon",
  },
  {
    id: "aim",
    get label() {
      return t`Aim point`;
    },
    group: "Weapon",
  },
  {
    id: "wheel",
    get label() {
      return t`Wheel`;
    },
    group: "Movement",
  },
  // The tread a tracked unit stands on. Nothing animates it, since a unit
  // script cannot scroll a texture, so it only tells the balance check where
  // the ground contact is.
  {
    id: "track",
    get label() {
      return t`Track`;
    },
    group: "Movement",
  },
  // A ship's rudder, at the stern with its joint at the hinge. It swings about
  // the vertical axis with the ship's turning, by `RUDDER_FOLLOWS`.
  {
    id: "rudder",
    get label() {
      return t`Rudder`;
    },
    group: "Movement",
  },
  // Where a ship's or hovercraft's wake comes from, usually an empty piece at
  // the stern on the waterline. Nothing moves it. `WAKE_WHILE_MOVING` emits a
  // wake from it while the unit moves.
  {
    id: "wake",
    get label() {
      return t`Wake point`;
    },
    group: "Movement",
  },
  // An aircraft's landing gear, each piece's joint at the hinge. `LANDING_GEAR`
  // turns it up on take off and down on landing.
  {
    id: "gear",
    get label() {
      return t`Landing gear`;
    },
    group: "Movement",
  },
  // A gunship's rotor, its joint on the shaft. `ROTOR_SPIN` spins it about the
  // vertical axis while the aircraft is up.
  {
    id: "rotor",
    get label() {
      return t`Rotor`;
    },
    group: "Movement",
  },
  ...legRoleEntries(2),
  {
    id: "buildarm.base",
    get label() {
      return t`Build arm base`;
    },
    group: "Build arm",
  },
  {
    id: "buildarm.arm",
    get label() {
      return t`Build arm`;
    },
    group: "Build arm",
  },
  {
    id: "buildarm.nozzle",
    get label() {
      return t`Build nozzle`;
    },
    group: "Build arm",
  },
  // Set on as many pieces as the unit has. A game model usually carries these
  // as empty pieces called nano1, nano2 and so on: they have no geometry and
  // exist only as the coordinate the build spray comes out of, which is why
  // they are their own role rather than the nozzle. A nozzle swings and gets
  // counter-rotated by `BUILDARM`. A nano point never moves.
  {
    id: "buildarm.nano",
    get label() {
      return t`Nano emit point`;
    },
    group: "Build arm",
  },
  {
    id: "door",
    get label() {
      return t`Door`;
    },
    group: "Structure",
  },
];

const ROLE_IDS = new Set(ROLES.map((role) => role.id));

export function isRole(value: string): boolean {
  return ROLE_IDS.has(value) || parseLegRole(value) !== null;
}

/** The highest leg pair number any of `roles` names, 0 for none. */
export function lastLegPair(roles: Iterable<string | undefined>): number {
  let last = 0;
  for (const role of roles) {
    const leg = parseLegRole(role ?? "");
    if (leg && leg.pair > last) last = leg.pair;
  }
  return last;
}

/**
 * The roles the piece panel offers: `ROLES`, with the legs running to one pair
 * past the last the unit has, so a pair can always be added and the list stays
 * as long as the unit needs.
 */
export function pickerRoles(pieces: { role?: string }[]): LegoRole[] {
  const pairs = Math.max(2, lastLegPair(pieces.map((piece) => piece.role)) + 1);
  const legs = legRoleEntries(pairs);
  const first = ROLES.findIndex((role) => role.group === "Legs");
  return [
    ...ROLES.slice(0, first),
    ...legs,
    ...ROLES.slice(first).filter((role) => role.group !== "Legs"),
  ];
}

export interface PresetParam {
  id: string;
  label: string;
  /**
   * Degrees, seconds, turns per second, metres, degrees per second, or a
   * percentage of a cycle. Converted inside `track`.
   *
   * `deg/s` is a rate rather than an angle. A preset using it hands the angle
   * itself straight to the engine, which works it out from the build target,
   * and only decides how fast the piece gets there. `track` reads it to time
   * the preview's swing, so the slider changes what you watch as well as what
   * is exported.
   */
  unit: "deg" | "s" | "hz" | "m" | "deg/s" | "%";
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
  // The engine calls this after a weapon fires, with the direction opposite
  // the shot in the unit's own space (#3357). A unit that defines it pays for
  // the call on every shot, so the script writes it only when a preset uses it.
  | "RockUnit"
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
   * The weapon's flare when it is not under the weapon's barrel, or undefined.
   * A flare under the barrel is carried by it, so it needs no move of its own.
   * One beside the barrel stays where it was when the barrel kicks, unless the
   * script moves it too. Asking marks it used, as `piece` does.
   */
  looseFlare(): string | undefined;
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
  /** The module instance's id, or "" for pieces that came from no module. */
  id: string;
  /** The preset's params for this instance: the shared ones with the
   *  instance's own laid over them. The same values as `EmitContext.params`
   *  for an instance with none of its own. */
  params: Record<string, number>;
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

/** One of the unit's wheels, measured (#3352). See `wheelFit.ts`. */
export interface EmitWheel {
  /** The Lua name of the piece. */
  piece: string;
  /** Its radius in elmos, or null when its shape does not give one. */
  radius: number | null;
  /** Whether it is ahead of the middle of the unit's wheels, so it steers. */
  front: boolean;
}

/** Pieces that leave a destroyed unit together (#3354). See `breakApart.ts`. */
export interface EmitBreakGroup {
  /** The Lua names of the pieces, the top piece first. Asking marks them used. */
  readonly pieces: string[];
  /** Whether it is a whole branch, which one `Explode` with `SFX.RECURSIVE`
   *  throws. Otherwise each piece is exploded on its own. */
  whole: boolean;
}

export interface EmitContext {
  /** The Lua name of the root piece, or undefined for a unit with none. */
  readonly root: string | undefined;
  /**
   * The groups the unit breaks into along its connections when cut at every
   * place with at most `depth` places between it and the root, weakest first.
   * Empty for a unit with only a root.
   */
  breakGroups(depth: number): EmitBreakGroup[];
  /**
   * Names of the pieces carrying a role, in document order. Asking marks them
   * used, so the script declares a local for exactly what it references.
   */
  pieces(role: string): string[];
  /** The pieces with the wheel role, in document order, with what the wheel
   *  presets need to know about each. Asking marks them used. */
  wheels(): EmitWheel[];
  /** How fast the unit speeds up and brakes, in elmos a frame squared. */
  motion: { accRate: number; decRate: number };
  /** The unit's weapons, in slot order. */
  weapons(): EmitWeapon[];
  /**
   * The module instances carrying the roles this preset animates or needs, in
   * the order their pieces appear. Pieces that came from no module are one
   * instance between them, so a unit with no modules, or with one, has a
   * single instance and the script it always had.
   */
  instances(): EmitInstance[];
  /**
   * How far a piece may turn (#3353), by the Lua name a piece method returned.
   * Absent on a context built without a document, which then limits nothing.
   */
  limits?(piece: string): LegoPieceLimits | undefined;
  params: Record<string, number>;
  /** A signal number of this preset's own, for stopping its threads. */
  signal: string;
}

export interface EmitResult {
  /** Threads and helpers, written above the callins. */
  functions: string[];
  hooks: Partial<Record<LuaHook, string[]>>;
  /**
   * Lines that go at the top of a callin, ahead of every preset's `hooks`. An
   * aim ends in `return true`, so a preset that only has to note the aim
   * happened cannot add its line after it, and it has to run before the aim's
   * own turns start.
   */
  first?: Partial<Record<LuaHook, string[]>>;
}

/** What a preset is written once for, when that can be more than once. */
export interface PresetCopies {
  /** Each of the unit's weapons, or each module instance. */
  per: "weapon" | "instance";
  /** The role one copy cannot do without. Absent means any role the preset
   *  animates. */
  role?: string;
  /** What the Animation panel calls this many, as in "2 turrets". */
  count(copies: number): string;
}

export interface AnimPreset {
  id: string;
  label: string;
  description: string;
  /** Absent for a preset written once whatever the unit holds. */
  copies?: PresetCopies;
  /** Roles that must be filled, with how many pieces each needs at least. */
  requires: { role: string; count: number }[];
  /**
   * More roles that must be filled, which depend on what the unit holds, such
   * as a thigh and a shin for every leg up to the unit's last pair (#3351).
   * `unmetRequirements` checks these with `requires`.
   */
  requiresFor?(roleCounts: Map<string, number>): {
    role: string;
    count: number;
  }[];
  /** Every role this preset may move, or for one with `moves`, the roles it
   *  moves on every unit it can be applied to. */
  animates: string[];
  /**
   * Whether the preset also moves a role not in `animates`, for a preset
   * whose roles have no fixed number, such as legs counted from 1 with no last
   * pair (#3351). `presetMovesRole` asks both.
   */
  moves?(role: string): boolean;
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
  /**
   * Frames of a cycle `frames` long that a generated thread must have a pose
   * on, where the motion turns a corner a straight Turn would cut. Absent, or
   * empty, for a cycle whose poses can fall anywhere.
   */
  poses?(params: Record<string, number>, frames: number): number[];
  /**
   * The preset as fixed poses in time, one motion per copy, which is what
   * converting it into an action writes (#4512). A string says why it cannot
   * be, for the Animation panel to show.
   */
  motions: ((ctx: EmitContext) => PresetMotion[]) | string;
}

/** Where a preset has each piece it moves at one key, in the units `Turn` and
 *  `Move` take. Keyed by the piece's Lua name. */
export type PresetKeyPieces = Map<string, { turn?: number[]; move?: number[] }>;

/** A preset's motion as an action's keys (#4512). */
export interface PresetMotion {
  trigger: LuaHook;
  loop: boolean;
  keys: { seconds: number; pieces: PresetKeyPieces }[];
}

/** A preset as applied to a unit, which is what the document stores. */
export interface AppliedPreset {
  presetId: string;
  params: Record<string, number>;
  /**
   * Settings for single module instances (#4315), keyed by instance id, each
   * holding only the params that differ from `params`. An instance with no
   * entry uses `params`. Absent on a unit that has none, so a saved unit
   * reads and writes as it did before.
   */
  instances?: Record<string, Record<string, number>>;
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
  roles: string[] = preset.animates,
): number[] {
  const frames = Math.max(1, Math.round(period * ENGINE_FPS));
  const fixed = preset.poses?.(params, frames) ?? [];
  const curves: number[][] = [];
  for (const role of roles) {
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
      ...new Set([
        ...Array.from({ length: steps + 1 }, (_, step) =>
          Math.round((step * frames) / steps),
        ),
        ...fixed,
      ]),
    ].sort((a, b) => a - b);
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
  options: { name: string; period: number; roles?: string[] },
): string[] | null {
  const sampled = cycleSamples(preset, params, instance, options);
  if (!sampled) return null;
  const { bounds, poses } = sampled;
  const count = poses.length;

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
 * The poses a `cycleThread` heads for, one per step of the cycle, keyed by the
 * piece's Lua name, and the frames they fall on. Null when the instance has
 * none of the roles.
 */
function cycleSamples(
  preset: AnimPreset,
  params: Record<string, number>,
  instance: EmitInstance,
  options: { period: number; roles?: string[] },
): { bounds: number[]; poses: Map<string, CyclePose>[] } | null {
  const roles = options.roles ?? preset.animates;
  const targets = roles.flatMap((role) =>
    instance.pieces(role).map((piece) => ({ role, piece })),
  );
  if (targets.length === 0) return null;

  const bounds = cycleSteps(preset, params, options.period, roles);
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

  return { bounds, poses };
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
  options: {
    name: string;
    start: LuaHook;
    /** More call-ins that start the thread too, such as `Create` for motion
     *  that must play on a unit that has not yet done what `start` waits for. */
    alsoStart?: LuaHook[];
    stop?: LuaHook;
    /** The roles to move, when not the preset's `animates`. */
    roles?: string[];
    /** The params one instance is written with, when not its own. */
    params?: (instance: EmitInstance) => Record<string, number>;
  },
): EmitResult | null {
  const functions: string[] = [];
  const started: string[] = [];
  const stopped: string[] = [];
  for (const instance of ctx.instances()) {
    const name = instance.name(options.name);
    const params = options.params?.(instance) ?? instance.params;
    const period = Math.max(value(preset, params, "period"), 0.05);
    const thread = cycleThread(preset, params, instance, {
      name,
      period,
      ...(options.roles ? { roles: options.roles } : {}),
    });
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
      ...Object.fromEntries(
        (options.alsoStart ?? []).map((hook) => [hook, started]),
      ),
      ...(options.stop ? { [options.stop]: stopped } : {}),
    },
  };
}

/**
 * `cycleThreads` as an action's keys, one motion per module instance, for
 * converting the preset into actions (#4512).
 *
 * The keys are where the thread's `Turn` and `Move` calls send each piece on a
 * lap after the first, in the order it sends them: the second pose first and
 * the first pose last. An action goes from rest to its first key and then
 * loops from its last key back round, so that order puts it on the thread's
 * own lap one lap after the call-in, with the same destinations, speeds and
 * sleeps. An axis the thread never turns stays at rest, as it does in the
 * thread.
 */
function cycleMotions(
  preset: AnimPreset,
  ctx: EmitContext,
  options: {
    start: LuaHook;
    roles?: string[];
    params?: (instance: EmitInstance) => Record<string, number>;
  },
): PresetMotion[] {
  const motions: PresetMotion[] = [];
  for (const instance of ctx.instances()) {
    const params = options.params?.(instance) ?? instance.params;
    const period = Math.max(value(preset, params, "period"), 0.05);
    const sampled = cycleSamples(preset, params, instance, {
      period,
      ...(options.roles ? { roles: options.roles } : {}),
    });
    if (!sampled) continue;
    const { bounds, poses } = sampled;
    const count = poses.length;

    // Where each piece has been sent, run as the thread runs it. The second
    // lap's are the keys, because an axis sent only late in a lap is still
    // where it was sent at the start of the next.
    const sent = new Map<string, { turn: number[]; move: number[] }>();
    const moved = new Map<string, { turn: boolean; move: boolean }>();
    const keys: PresetMotion["keys"] = [];
    for (let lap = 0; lap < 2; lap++) {
      for (let step = 1; step <= count; step++) {
        const before = poses[step - 1];
        for (const [piece, pose] of poses[step % count]) {
          const was = before.get(piece);
          const at = sent.get(piece) ?? { turn: [0, 0, 0], move: [0, 0, 0] };
          const marks = moved.get(piece) ?? { turn: false, move: false };
          for (const [kind, key] of [
            ["turn", "rotation"],
            ["move", "position"],
          ] as const) {
            const to = pose[key];
            if (!to) continue;
            const from = was?.[key] ?? [0, 0, 0];
            for (let axis = 0; axis < 3; axis++) {
              if (to[axis] === from[axis]) continue;
              at[kind][axis] = to[axis];
              marks[kind] = true;
            }
          }
          sent.set(piece, at);
          moved.set(piece, marks);
        }
        if (lap === 0) continue;
        const pieces: PresetKeyPieces = new Map();
        for (const [piece, at] of sent) {
          const marks = moved.get(piece);
          if (!marks?.turn && !marks?.move) continue;
          pieces.set(piece, {
            ...(marks.turn ? { turn: [...at.turn] } : {}),
            ...(marks.move ? { move: [...at.move] } : {}),
          });
        }
        keys.push({
          seconds: (bounds[step] - bounds[step - 1]) / ENGINE_FPS,
          pieces,
        });
      }
    }
    motions.push({ trigger: options.start, loop: true, keys });
  }
  return motions;
}

const LEG_SEGMENTS = ["thigh", "shin", "foot"] as const;
type LegSegment = (typeof LEG_SEGMENTS)[number];

export interface LegRole {
  side: "l" | "r";
  /** Counted from 1 at the front, with no last pair. */
  pair: number;
  segment: LegSegment;
}

export function parseLegRole(role: string): LegRole | null {
  const match = /^leg\.([lr])([1-9]\d*)\.(thigh|shin|foot)$/.exec(role);
  if (!match) return null;
  return {
    side: match[1] as "l" | "r",
    pair: Number(match[2]),
    segment: match[3] as LegSegment,
  };
}

/** A walk's gait: the two fixed ones, and the wave gait `walk.legs` plays. */
export type Gait = "biped" | "quad" | "wave";

/**
 * Where a leg sits in the cycle.
 *
 * A biped's two legs are opposite each other. A quadruped moves diagonal pairs
 * together, front left with rear right, which is what a trot is and what stops
 * the model rocking. The wave gait's legs are placed by `waveTouchdown`.
 */
export function legPhase(
  leg: LegRole,
  gait: Gait,
  duty = 0.5,
  frames?: number,
): number {
  if (gait === "biped") return leg.side === "l" ? 0 : Math.PI;
  if (gait === "quad") {
    const diagonal = (leg.side === "l") === (leg.pair === 1);
    return diagonal ? 0 : Math.PI;
  }
  const down = waveTouchdown(leg, duty, frames);
  return down === 0 ? 0 : TAU * (1 - down);
}

/**
 * When a leg of the wave gait puts its foot down, as a share of the cycle
 * after the front left foot does (#3351).
 *
 * This is the wave gait of a walker with 2n legs as Song and Choi give it
 * ("The optimally stable ranges of 2n-legged wave gaits", IEEE Transactions on
 * Systems, Man, and Cybernetics 20(4), 1990, after McGhee and Frank 1968 for
 * four legs). With the legs counted front to back and `duty` the share of the
 * cycle a foot is down, the left leg of pair k comes down `(k - 1) * duty`
 * after the front left, and each right leg half a cycle after its left. So a
 * pair comes down as the pair in front of it lifts, and the lifts run from the
 * rear to the front along each side, as an insect's do.
 *
 * The time on the ground picks the gait. At half the cycle it is the
 * alternating gait: two legs in opposition, the trot on four, the tripod on
 * six (front and rear left with middle right, then the others) and the
 * alternating tetrapod on eight. Longer on the ground it slows into the
 * ripple and then the wave, where one leg on each side is in the air at a
 * time and at the most only one foot at all.
 *
 * `frames`, when given, is the cycle's length in frames, and the answer is put
 * on the nearest whole frame, so a fitted walk's feet land on its poses.
 */
export function waveTouchdown(
  leg: Pick<LegRole, "side" | "pair">,
  duty: number,
  frames?: number,
): number {
  const share = (leg.pair - 1) * duty + (leg.side === "r" ? 0.5 : 0);
  const cycle = share - Math.floor(share);
  if (frames === undefined) return cycle;
  return (Math.round(cycle * frames) % frames) / frames;
}

/**
 * The param `walkFit.ts` sets to 1 on a walk it has fitted to the unit's body
 * and speed. It is not a slider and is never saved: it is laid over the
 * saved params when the script is written. A fitted walk keeps the ankle on
 * a straight line at one speed while the foot is down and the knee straight,
 * where the walk it replaces swings the thigh along a sine all the way round.
 */
export const WALK_FITTED = "fitted";

/**
 * The other params `walkFit.ts` lays over a fitted walk, none of them sliders
 * and none saved (#3350). The thigh's and the shin's lengths, in elmos, from
 * the leg's joints. The unit's speed in elmos a second. How far the body is
 * lowered while walking, in elmos, so a foot can reach the ground at both
 * ends of its time on it. A fitted walk with no leg lengths keeps the knee
 * straight on the ground as #3349 did.
 */
export const WALK_THIGH = "thighLength";
export const WALK_SHIN = "shinLength";
export const WALK_SPEED = "speed";
export const WALK_DROP = "drop";

/** How far a fitted foot moves back while it is down: the unit's speed over
 *  its time on the ground, so it stays put on the ground. */
export function walkSweep(params: Record<string, number>): number {
  const period = Math.max(value(WALK_BIPED, params, "period"), 0.05);
  return (
    value(WALK_BIPED, params, WALK_SPEED) *
    period *
    (value(WALK_BIPED, params, "duty") / 100)
  );
}

/**
 * The thigh's and the shin's angles that put the ankle at `z` ahead of the hip
 * and `y` above it, for a leg of those two lengths hanging straight down at
 * rest. A Turn about x by `a` puts a point `l` below the joint `l * sin(a)`
 * behind it and `l * cos(a)` below, so the ankle's direction from the hip is
 * the angle `atan2(-z, -y)`, and the thigh sits back from that by the angle
 * the bent knee puts between the thigh and the line from hip to ankle. The
 * knee bends forward. A target past the leg's reach gets the straight leg
 * pointed at it, and one nearer the hip than the leg folds gets the folded
 * leg, so the angles are always finite.
 */
export function legAngles(
  thighLength: number,
  shinLength: number,
  z: number,
  y: number,
): { thigh: number; shin: number } {
  const a = thighLength;
  const b = shinLength;
  const reach = Math.min(Math.max(Math.hypot(z, y), Math.abs(a - b)), a + b);
  const cosKnee = (reach * reach - a * a - b * b) / (2 * a * b);
  const knee = Math.acos(Math.min(1, Math.max(-1, cosKnee)));
  const bend = Math.atan2(b * Math.sin(knee), a + b * Math.cos(knee));
  return { thigh: Math.atan2(-z, -y) - bend, shin: knee };
}

/**
 * Where a fitted leg's ankle is meant to be, as `z` ahead of the hip and `y`
 * above it, `share` of the way round its stride (`strideShare`).
 *
 * On the ground the target stays put in the world while the body moves over
 * it at the unit's speed, so under the body it moves back in a straight line
 * at that speed, from half the sweep ahead of the hip to half behind. The
 * ground is the leg's length below the hip at rest, less the body's drop.
 *
 * In the air it comes forward again on an arc, easing out and in so it
 * leaves and lands at rest, and rising at the middle by what the knee bend
 * lifts the foot when the thigh hangs straight, `shin * (1 - cos(knee))`.
 */
function ankleTarget(
  params: Record<string, number>,
  share: number,
  knee: number,
): { z: number; y: number } {
  const half = walkSweep(params) / 2;
  const ground =
    -((params[WALK_THIGH] ?? 0) + (params[WALK_SHIN] ?? 0)) +
    (params[WALK_DROP] ?? 0);
  if (share < 0.5) return { z: half * (1 - 4 * share), y: ground };
  const air = 2 * share - 1;
  return {
    z: -half * Math.cos(Math.PI * air),
    y:
      ground +
      (params[WALK_SHIN] ?? 0) * (1 - Math.cos(knee)) * Math.sin(Math.PI * air),
  };
}

/** Whether a fitted walk has the leg lengths to solve its legs with. */
function solvesLegs(params: Record<string, number>): boolean {
  return (params[WALK_THIGH] ?? 0) > 0 && (params[WALK_SHIN] ?? 0) > 0;
}

/**
 * How far round its stride a leg is, from 0 to 1. The first half is the foot
 * on the ground, moving back, and the second half the foot in the air, coming
 * forward. `duty` is the share of the time the foot spends on the ground, so
 * the first half takes that share of the period and the second the rest.
 *
 * `turn` is how many cycles it is since the leg last put its foot down.
 */
function strideShare(turn: number, duty: number): number {
  const time = turn - Math.floor(turn);
  return time < duty
    ? (0.5 * time) / duty
    : 0.5 + (0.5 * (time - duty)) / (1 - duty);
}

/**
 * The frames of a fitted walk's cycle on which a foot comes down or lifts, so
 * the thread has a pose on each and holds the knee straight from one to the
 * other. `walkFit.ts` makes the period an even number of frames and the time
 * on the ground a whole number, so each of these is a whole frame. A fitted
 * leg puts its foot down at the start of its cycle, half a cycle apart for
 * legs that move against each other.
 */
function walkPoses(
  preset: AnimPreset,
  params: Record<string, number>,
  frames: number,
  gait: Gait,
): number[] {
  if (value(preset, params, WALK_FITTED) !== 1) return [];
  const down = Math.round((value(preset, params, "duty") / 100) * frames);
  const half = Math.round(frames / 2);
  if (gait === "wave") {
    // Each leg comes down on a frame of its own, so the poses are the frames
    // each lands and lifts on, or every frame for a solved leg.
    if (solvesLegs(params)) return Array.from({ length: frames }, (_, f) => f);
    const pairs = Math.max(1, Math.round(value(preset, params, WALK_PAIRS)));
    const landings = new Set<number>();
    for (let pair = 1; pair <= pairs; pair++) {
      for (const side of ["l", "r"] as const) {
        landings.add(
          Math.round(
            waveTouchdown({ side, pair }, down / frames, frames) * frames,
          ),
        );
      }
    }
    return [...landings].flatMap((frame) => [frame, (frame + down) % frames]);
  }
  if (!solvesLegs(params)) {
    return [0, down, half, half + down].map((frame) => frame % frames);
  }
  // A solved leg has a pose on every frame its foot is down (#3350). The
  // engine moves a piece once a frame, so a Turn written a frame ahead lands
  // on the solved angles on every frame, which is as still as the engine can
  // hold the foot. Between poses two frames apart the angles go in a straight
  // line and the foot does not. Measured for #3350 on legs of 12, 18.8 and 30
  // elmos at 40 and 45 elmos a second, it strays up to 0.17 elmos along the
  // ground and 0.32 up and down.
  return Array.from({ length: down + 1 }, (_, frame) => [
    frame,
    (frame + half) % frames,
  ]).flat();
}

function walkTrack(
  preset: AnimPreset,
  t: number,
  params: Record<string, number>,
  role: string,
  gait: Gait,
): TrackDelta | null {
  const leg = parseLegRole(role);
  if (!leg) return null;
  if (gait === "biped" && leg.pair !== 1) return null;
  if (gait === "quad" && leg.pair > 2) return null;

  const period = Math.max(value(preset, params, "period"), 0.05);
  const swing = deg(value(preset, params, "stride"));
  const knee = deg(value(preset, params, "knee"));
  const duty = Math.min(
    Math.max(value(preset, params, "duty") / 100, 0.05),
    0.95,
  );
  const fitted = value(preset, params, WALK_FITTED) === 1;
  const phase =
    (t / period) * TAU +
    legPhase(
      leg,
      gait,
      duty,
      fitted ? Math.round(period * ENGINE_FPS) : undefined,
    );

  let thigh: number;
  let shin: number;
  if (!fitted && duty === 0.5) {
    // The thigh swings, the knee folds only as the leg comes forward, and the
    // foot undoes both so it stays flat to the ground. Kept exactly as it was,
    // so a walk nobody has fitted writes the script it always did.
    thigh = swing * Math.sin(phase);
    shin = knee * (1 - Math.cos(phase)) * 0.5;
  } else {
    // An unfitted walk's foot is down from -90 to 90 degrees of its phase. A
    // fitted one comes down at 0, so its poses fall on whole frames.
    const share = strideShare(
      (fitted ? phase : phase + Math.PI / 2) / TAU,
      duty,
    );
    if (!fitted) {
      const warped = share * TAU - Math.PI / 2;
      thigh = swing * Math.sin(warped);
      shin = knee * (1 - Math.cos(warped)) * 0.5;
    } else if (solvesLegs(params)) {
      // Each leg solved for where its ankle is meant to be (#3350), so a foot
      // on the ground stays put with the knee bent.
      const { z, y } = ankleTarget(params, share, knee);
      ({ thigh, shin } = legAngles(
        params[WALK_THIGH],
        params[WALK_SHIN],
        z,
        y,
      ));
    } else if (share < 0.5) {
      // On the ground. The ankle moves back in a straight line at one speed,
      // from as far forward as the swing reaches to as far back, which is what
      // the unit's speed asks of it. A straight leg of length `l` puts the
      // ankle `-l * sin(thigh)` ahead of the hip, so the thigh angle that does
      // that is an arcsine, and the leg's length cancels out of it.
      thigh = -Math.asin(Math.sin(swing) * (1 - 4 * share));
      shin = 0;
    } else {
      // In the air. The thigh swings forward again and the knee folds and
      // unfolds once, most at the middle of the swing, where it lifts the
      // foot highest.
      thigh = swing * Math.sin(share * TAU - Math.PI / 2);
      shin = knee * (1 - Math.cos((share - 0.5) * 2 * TAU)) * 0.5;
    }
  }

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
    get label() {
      return t`Stride time`;
    },
    unit: "s",
    min: 0.2,
    max: 4,
    step: 0.1,
    fallback: 1,
  },
  {
    id: "stride",
    get label() {
      return t`Thigh swing`;
    },
    unit: "deg",
    min: 0,
    max: 70,
    step: 1,
    fallback: 25,
  },
  {
    id: "knee",
    get label() {
      return t`Knee bend`;
    },
    unit: "deg",
    min: 0,
    max: 90,
    step: 1,
    fallback: 30,
  },
  {
    // A walk keeps each foot down for more than half the time and a run for
    // less. Half is the walk this preset always made.
    id: "duty",
    get label() {
      return t`Time on the ground`;
    },
    unit: "%",
    min: 30,
    max: 80,
    step: 5,
    fallback: 50,
  },
];

function legRoles(pairs: number[]): string[] {
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
  get label() {
    return t`Walk, two legs`;
  },
  get description() {
    return t`Swings the legs in opposition and keeps the feet flat. Needs a thigh and a shin on each side.`;
  },
  requires: [
    { role: "leg.l1.thigh", count: 1 },
    { role: "leg.l1.shin", count: 1 },
    { role: "leg.r1.thigh", count: 1 },
    { role: "leg.r1.shin", count: 1 },
  ],
  copies: {
    per: "instance",
    count(copies: number) {
      return plural(copies, {
        one: "# set of legs",
        other: "# sets of legs",
      });
    },
  },
  animates: legRoles([1]),
  params: WALK_PARAMS,
  track(t, params, role) {
    return walkTrack(this, t, params, role, "biped");
  },
  poses(params, frames) {
    return walkPoses(this, params, frames, "biped");
  },
  motions(ctx) {
    return walkMotions(this, ctx);
  },
  emit(ctx) {
    return walkEmit(this, ctx);
  },
};

export const WALK_QUAD: AnimPreset = {
  id: "walk.quad",
  get label() {
    return t`Walk, four legs`;
  },
  get description() {
    return t`A trot: diagonal pairs move together, so the body does not rock. Needs both pairs of legs.`;
  },
  requires: [
    { role: "leg.l1.thigh", count: 1 },
    { role: "leg.r1.thigh", count: 1 },
    { role: "leg.l2.thigh", count: 1 },
    { role: "leg.r2.thigh", count: 1 },
  ],
  copies: {
    per: "instance",
    count(copies: number) {
      return plural(copies, {
        one: "# set of legs",
        other: "# sets of legs",
      });
    },
  },
  animates: legRoles([1, 2]),
  params: WALK_PARAMS,
  track(t, params, role) {
    return walkTrack(this, t, params, role, "quad");
  },
  poses(params, frames) {
    return walkPoses(this, params, frames, "quad");
  },
  motions(ctx) {
    return walkMotions(this, ctx);
  },
  emit(ctx) {
    return walkEmit(this, ctx);
  },
};

/**
 * The leg roles of pairs 1 to `pairs`, front first, which is what a wave gait
 * walk moves on a unit with that many pairs.
 */
export function legRoleIds(pairs: number): string[] {
  return legRoles(Array.from({ length: Math.max(1, pairs) }, (_, i) => i + 1));
}

/**
 * The time on the ground a walk with any number of legs starts at for a unit
 * with `pairs` leg pairs, as a percentage (#3351).
 *
 * A body stands on its feet only while three or more are down around it.
 * With `2 * pairs` legs each down for `duty` of the cycle, `2 * pairs * duty`
 * feet are down on average, so three takes a duty of at least
 * `3 / (2 * pairs)`. Less than half the cycle on the ground is a run, so the
 * duty is never below half. That gives the tripod for six legs and the
 * alternating tetrapod for eight, both at half, and the crawl at three
 * quarters for four, where the range McGhee and Frank (1968) found the four
 * legged wave gait most stable over begins. Two legs cannot stand on two feet
 * in any gait and keep the half a biped always walked at. `gaits.test.ts`
 * checks the body stays over the feet on every frame of these.
 */
export function waveDuty(pairs: number): number {
  return pairs < 2 ? 50 : Math.max(50, 300 / (2 * pairs));
}

/** How many leg pairs the unit has, laid over a `walk.legs` walk's params by
 *  `walkFit.ts`. Not a slider, and never saved. */
export const WALK_PAIRS = "legPairs";

const WALK_LEGS_PARAMS: PresetParam[] = WALK_PARAMS.map((param) =>
  // Up to the wave gait of eight legs, seven eighths of the cycle on the
  // ground, so the slow gaits of six and eight legs are in reach.
  param.id === "duty" ? { ...param, max: 90 } : param,
);

/**
 * A walk for any number of leg pairs (#3351), in the wave gait
 * (`waveTouchdown`). The pairs are counted from the unit's own leg roles, and
 * the time on the ground, which picks the gait, starts at `waveDuty`'s for that
 * many. It stands beside the two fixed walks, which saved units still name.
 */
export const WALK_LEGS: AnimPreset = {
  id: "walk.legs",
  get label() {
    return t`Walk, any number of legs`;
  },
  get description() {
    return t`A wave of steps from the rear to the front along each side. Half the time on the ground is the tripod on six legs, more is slower and steadier. Needs a thigh and a shin on each leg.`;
  },
  requires: [
    { role: "leg.l1.thigh", count: 1 },
    { role: "leg.l1.shin", count: 1 },
    { role: "leg.r1.thigh", count: 1 },
    { role: "leg.r1.shin", count: 1 },
  ],
  requiresFor(roleCounts) {
    return legRoles(
      Array.from({ length: lastLegPair(roleCounts.keys()) }, (_, i) => i + 1),
    )
      .filter((role) => !role.endsWith(".foot"))
      .map((role) => ({ role, count: 1 }));
  },
  copies: {
    per: "instance",
    count(copies: number) {
      return plural(copies, {
        one: "# set of legs",
        other: "# sets of legs",
      });
    },
  },
  animates: legRoles([1]),
  moves: (role) => parseLegRole(role) !== null,
  params: WALK_LEGS_PARAMS,
  track(t, params, role) {
    return walkTrack(this, t, params, role, "wave");
  },
  poses(params, frames) {
    return walkPoses(this, params, frames, "wave");
  },
  motions(ctx) {
    return walkMotions(
      this,
      ctx,
      legRoleIds(Math.round(value(this, ctx.params, WALK_PAIRS))),
    );
  },
  emit(ctx) {
    return walkEmit(
      this,
      ctx,
      legRoleIds(Math.round(value(this, ctx.params, WALK_PAIRS))),
    );
  },
};

/**
 * Walking starts and stops with the unit, so it hangs off the move callins.
 * Each module instance of legs walks in a thread of its own, all started by
 * the same `StartMoving`, so a leg's phase still comes from its role alone.
 *
 * A walk fitted to the unit says so above its thread, with the numbers it was
 * fitted to, so whoever edits the script knows the timing is not arbitrary.
 */
function walkEmit(
  preset: AnimPreset,
  ctx: EmitContext,
  roles?: string[],
): EmitResult | null {
  const { fitted, drop, params } = walkDrop(preset, ctx);
  const result = cycleThreads(preset, ctx, {
    name: "walk",
    start: "StartMoving",
    stop: "StopMoving",
    ...(roles ? { roles } : {}),
    ...params,
  });
  if (!result || !fitted) return result;
  const period = Math.max(value(preset, ctx.params, "period"), 0.05);
  const frames = Math.round(period * ENGINE_FPS);
  const down = Math.round((value(preset, ctx.params, "duty") / 100) * frames);
  // The body goes down by the drop over one foot's time on the ground, and
  // back up as fast when the unit stops. A unit with no body piece cannot be
  // lowered, so its feet sit the drop above the ground.
  const [body] = drop > 0 ? ctx.pieces("base") : [];
  const lower = body
    ? {
        StartMoving: [
          ...(result.hooks.StartMoving ?? []),
          `  Move(${body}, y_axis, ${lua(-drop)}, ${lua((drop * ENGINE_FPS) / down)})`,
        ],
        StopMoving: [
          ...(result.hooks.StopMoving ?? []),
          `  Move(${body}, y_axis, 0, ${lua((drop * ENGINE_FPS) / down)})`,
        ],
      }
    : {};
  return {
    functions: [
      `-- Fitted to the unit's legs and speed: a stride every ${frames} frames, each foot down for ${down} of them.`,
      ...(body
        ? [
            `-- Each foot stays put while it is down, with the body ${lua(drop)} elmos lower so it reaches the ground.`,
          ]
        : []),
      ...result.functions,
    ],
    hooks: { ...result.hooks, ...lower },
  };
}

/**
 * How far a fitted walk lowers the body, and the params each set of legs is
 * then solved with. One body, so one drop. Every set of legs is solved to the
 * ground the shared walk lowers the body to, even one with a swing of its own.
 */
function walkDrop(
  preset: AnimPreset,
  ctx: EmitContext,
): {
  fitted: boolean;
  drop: number;
  params: {
    params?: (instance: EmitInstance) => Record<string, number>;
  };
} {
  const fitted = value(preset, ctx.params, WALK_FITTED) === 1;
  const drop =
    fitted && solvesLegs(ctx.params) ? value(preset, ctx.params, WALK_DROP) : 0;
  return {
    fitted,
    drop,
    params:
      drop > 0
        ? {
            params: (instance: EmitInstance) =>
              solvesLegs(instance.params)
                ? { ...instance.params, [WALK_DROP]: drop }
                : instance.params,
          }
        : {},
  };
}

/**
 * A walk as actions (#4512). A fitted walk that lowers the body holds it the
 * drop lower on every key of the first set of legs, which is where the walk's
 * own `StartMoving` sends it. The action reaches it over its first key rather
 * than over one foot's time on the ground, and takes it back up at the speed
 * every action stands down at.
 */
function walkMotions(
  preset: AnimPreset,
  ctx: EmitContext,
  roles?: string[],
): PresetMotion[] {
  const { drop, params } = walkDrop(preset, ctx);
  const motions = cycleMotions(preset, ctx, {
    start: "StartMoving",
    ...(roles ? { roles } : {}),
    ...params,
  });
  const [body] = drop > 0 && motions.length > 0 ? ctx.pieces("base") : [];
  if (!body) return motions;
  const lowered = Number((-drop).toFixed(4));
  const [first, ...rest] = motions;
  return [
    {
      ...first,
      keys: first.keys.map((key) => ({
        ...key,
        pieces: new Map([...key.pieces, [body, { move: [0, lowered, 0] }]]),
      })),
    },
    ...rest,
  ];
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

/**
 * The lines that turn an aim away, for a turret held to a yaw range and a
 * barrel held to a pitch range. `false` is the weapon not being ready to fire,
 * which the engine's own arc test cannot do for a pitch, because a weapon
 * definition has no key for one. Written before the first `Signal`, so a
 * refused aim leaves a turn already under way alone.
 */
function refuseOutside(
  yaw: LegoPieceLimits | undefined,
  pitch: LegoPieceLimits | undefined,
): string[] {
  const heading = yawRange(yaw);
  const elevation = pitchRange(pitch);
  return [
    ...(heading
      ? [`  if ${headingOutside(heading)} then return false end`]
      : []),
    ...(elevation
      ? [`  if ${pitchOutside(elevation)} then return false end`]
      : []),
  ];
}

export const TURRET_TRACK: AnimPreset = {
  id: "turret.track",
  get label() {
    return t`Turret sweep`;
  },
  get description() {
    return t`Turns the turret and lifts the barrel, the motion a turret makes tracking a target.`;
  },
  requires: [{ role: "turret", count: 1 }],
  copies: {
    per: "weapon",
    role: "turret",
    count(copies: number) {
      return plural(copies, {
        one: "# turret",
        other: "# turrets",
      });
    },
  },
  animates: ["turret", "barrel"],
  params: [
    {
      id: "period",
      get label() {
        return t`Sweep time`;
      },
      unit: "s",
      min: 0.5,
      max: 12,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "sweep",
      get label() {
        return t`Turn`;
      },
      unit: "deg",
      min: 0,
      max: 180,
      step: 5,
      fallback: 60,
    },
    {
      id: "pitch",
      get label() {
        return t`Barrel lift`;
      },
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
  get motions() {
    return t`Follows the target the weapon aims at, which no fixed pose can hold.`;
  },
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
        ...refuseOutside(
          ctx.limits?.(turret),
          barrel ? ctx.limits?.(barrel) : undefined,
        ),
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

/**
 * How often the wheel presets read the unit's speed and heading, in frames. A
 * tenth of a second follows a change of speed closely enough that the wheels
 * do not visibly lag, and costs a third of the reads a poll every frame would.
 * A design choice. The engine's cost for it has not been measured.
 */
const WHEEL_POLL_FRAMES = 3;

/** `COBSCALE`: `CURRENT_SPEED` is elmos a frame times this
 *  (`UnitScript.cpp:1118`). */
const COBSCALE = 65536;

/**
 * The speed the preview answers `CURRENT_SPEED` with when nothing drives the
 * unit, in elmos a frame: `known` in `crates/coilbox-unitpose/src/unitvalue.rs`
 * says 65536, one elmo a frame. `track` plays the wheels at it.
 */
const UNDRIVEN_SPEED = 1;

/**
 * Wheels that roll at the unit's speed.
 *
 * A wheel rolling without slipping turns at the unit's speed over its radius,
 * so a script that reads `CURRENT_SPEED` while it runs gets the right rate at
 * every speed, speeding up, slowing down and backing up. The walks bake the
 * speed in when the script is written (`walkFit.ts`), which suits a walker
 * that moves at the one speed it was fitted for. A wheel has no cycle to fit,
 * and a unit that brakes to a stop would spin its wheels at full speed all the
 * way down if the rate were fixed. So the wheels read it. The preview answers
 * `CURRENT_SPEED` on every frame of a drive.
 *
 * The engine calls `StopMoving` when the unit is told to stop, not when it has
 * stopped: a unit rolls on at its brake rate (`GroundMoveType.cpp:2455` and
 * `StopEngine`, which sets only the wanted speed). So `StopMoving` only marks
 * the thread, and the thread ends once the speed reads 0.
 *
 * The rate is set outright on each poll. `Spin` takes an acceleration, but
 * the engine's reading of it is not one this was able to check, and a poll a
 * tenth of a second apart is close enough without it.
 *
 * The radius is measured from the wheel (`wheelFit.ts`). A wheel with none,
 * and no radius typed, keeps the fixed rate this preset always had.
 */
export const WHEELS_ROLL: AnimPreset = {
  id: "wheels.roll",
  get label() {
    return t`Wheels turning`;
  },
  get description() {
    return t`Turns every wheel at the unit's speed over the wheel's radius, backwards when it backs up. A wheel with no round shape to measure turns at a steady rate.`;
  },
  requires: [{ role: "wheel", count: 1 }],
  animates: ["wheel"],
  params: [
    {
      id: "rate",
      get label() {
        return t`Turns per second`;
      },
      unit: "hz",
      min: 0.1,
      max: 6,
      step: 0.1,
      fallback: 1.2,
    },
    {
      id: "radius",
      get label() {
        return t`Wheel radius (0 measures it)`;
      },
      unit: "m",
      min: 0,
      max: 30,
      step: 0.1,
      fallback: 0,
    },
  ],
  /**
   * The preview plays the script, so this is what the script does with nothing
   * driving the unit: the fixed rate, or the rate for the preview's own speed
   * when a radius is typed.
   */
  track(t, params, role) {
    if (role !== "wheel") return null;
    const radius = value(this, params, "radius");
    const rate =
      radius > 0
        ? (ENGINE_FPS * UNDRIVEN_SPEED) / radius
        : TAU * value(this, params, "rate");
    return { rotation: [rate * t, 0, 0] };
  },
  /** Continuous, so `Spin` rather than a thread of `Turn` calls. */
  get motions() {
    return t`Turns with the unit's speed, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const typed = value(this, ctx.params, "radius");
    const wheels = ctx.wheels().map((wheel) => ({
      piece: wheel.piece,
      radius: typed > 0 ? typed : wheel.radius,
    }));
    if (wheels.length === 0) return null;
    const rate = lua(TAU * value(this, ctx.params, "rate"));
    const fixed = wheels.filter((wheel) => wheel.radius === null);
    const following = wheels.filter((wheel) => wheel.radius !== null);
    const start = fixed.map(({ piece }) => `  Spin(${piece}, x_axis, ${rate})`);
    const stop = fixed.map(({ piece }) => `  StopSpin(${piece}, x_axis)`);
    if (following.length === 0) {
      return { functions: [], hooks: { StartMoving: start, StopMoving: stop } };
    }
    // Radians a second for each 65536th of an elmo a frame.
    const per = (radius: number) =>
      Number((ENGINE_FPS / COBSCALE / radius).toPrecision(6));
    const each = (line: (piece: string, radius: number) => string) =>
      following.map(({ piece, radius }) => line(piece, radius as number));
    return {
      functions: [
        "local wheelsRollStopped = true",
        "",
        "local function wheelsRoll()",
        `  SetSignalMask(${ctx.signal})`,
        "  while true do",
        "    local speed = GetUnitValue(COB.CURRENT_SPEED)",
        "    if wheelsRollStopped and speed == 0 then",
        ...each((piece) => `      StopSpin(${piece}, x_axis)`),
        "      return",
        "    end",
        "    if GetUnitValue(COB.REVERSING) == 1 then speed = -speed end",
        ...each(
          (piece, radius) =>
            `    Spin(${piece}, x_axis, speed * ${per(radius)})`,
        ),
        `    Sleep(${WHEEL_POLL_FRAMES * SLEEP_FRAME_MS})`,
        "  end",
        "end",
      ],
      hooks: {
        StartMoving: [
          `  Signal(${ctx.signal})`,
          "  wheelsRollStopped = false",
          "  StartThread(wheelsRoll)",
          ...start,
        ],
        StopMoving: ["  wheelsRollStopped = true", ...stop],
      },
    };
  },
};

/**
 * How often the rudder reads the unit's heading, in frames. A fifth of a
 * second is short enough to follow a turn and long enough to smooth over the
 * frame to frame wobble in a driven heading, which a shorter poll swings the
 * rudder with. A design choice, not an engine figure.
 */
const RUDDER_POLL_FRAMES = 6;

/**
 * Degrees of rudder for each degree a second the unit turns. A design choice:
 * the engine says only that a heading is 65536 to a circle and the sim runs 30
 * frames a second, so a turn of 60 degrees a second reads as 30 degrees of
 * rudder. The slider caps what that reaches.
 */
const RUDDER_PER_TURN_RATE = 0.5;

/** The rudder reaches its angle in this many seconds, then holds it. */
const RUDDER_SWING_SECONDS = 0.2;

/** `SPRING_CIRCLE_DIVS`: the engine's heading is this many to a circle. */
const HEADING_CIRCLE = 65536;

/**
 * Radians of rudder for each heading unit turned in one poll. Turned units a
 * poll are `turn rate * poll seconds` heading units, so this is
 * `rudder per turn rate * radians per heading unit / poll seconds`.
 */
const RUDDER_PER_HEADING =
  (RUDDER_PER_TURN_RATE * (TAU / HEADING_CIRCLE)) /
  (RUDDER_POLL_FRAMES / ENGINE_FPS);

/**
 * A rudder that swings as the unit turns.
 *
 * The engine sends a Lua unit script `ChangeHeading` only for a turn above
 * `minScriptChangeHeading`, which no unchanged game ever reaches
 * (`ENGINE_MIN_SCRIPT_CHANGE_HEADING`), and a COB script never. So this reads
 * the heading itself, with `GetUnitValue(COB.HEADING)`, which is the unit's
 * `heading` (`UnitScript.cpp:1175`) and is what the preview answers from each
 * frame of a drive. A positive heading is a turn to the left and a positive
 * `Turn` about y is the same way.
 */
export const RUDDER_FOLLOWS: AnimPreset = {
  id: "rudder.follow",
  get label() {
    return t`Rudder follows turns`;
  },
  get description() {
    return t`Swings each rudder with the unit's turning while it moves, and straightens it when the turn ends.`;
  },
  requires: [{ role: "rudder", count: 1 }],
  animates: ["rudder"],
  params: [
    {
      id: "max",
      get label() {
        return t`Largest angle`;
      },
      unit: "deg",
      min: 0,
      max: 45,
      step: 1,
      fallback: 30,
    },
  ],
  /**
   * The angle depends on the unit's heading, which a time cannot give. The
   * preview plays the script, and the parity test holds the unit straight.
   */
  track() {
    return null;
  },
  get motions() {
    return t`Follows the unit's turning, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const rudders = ctx.pieces("rudder");
    if (rudders.length === 0) return null;
    const most = deg(value(this, ctx.params, "max"));
    const speed = lua(most / RUDDER_SWING_SECONDS);
    const turnAll = (angle: string) =>
      rudders.map(
        (rudder) => `    Turn(${rudder}, y_axis, ${angle}, ${speed})`,
      );
    const half = HEADING_CIRCLE / 2;
    return {
      functions: [
        "local function rudderFollow()",
        `  SetSignalMask(${ctx.signal})`,
        "  local last = GetUnitValue(COB.HEADING)",
        "  while true do",
        `    Sleep(${RUDDER_POLL_FRAMES * SLEEP_FRAME_MS})`,
        "    local now = GetUnitValue(COB.HEADING)",
        // The heading is a signed short, so a turn across the wrap is the
        // short way round.
        `    local swing = ((now - last + ${half}) % ${HEADING_CIRCLE} - ${half}) * ${Number(RUDDER_PER_HEADING.toPrecision(6))}`,
        "    last = now",
        `    if swing > ${lua(most)} then swing = ${lua(most)} end`,
        `    if swing < -${lua(most)} then swing = -${lua(most)} end`,
        ...turnAll("swing"),
        "  end",
        "end",
        "",
        "local function rudderFollowStop()",
        ...turnAll("0"),
        "end",
      ],
      hooks: {
        StartMoving: [`  Signal(${ctx.signal})`, "  StartThread(rudderFollow)"],
        StopMoving: [`  Signal(${ctx.signal})`, "  rudderFollowStop()"],
      },
    };
  },
};

/**
 * Degrees of hull lean for each degree a second the unit turns. A design
 * choice, as the rudder's is: the engine says only that a heading is 65536 to a
 * circle. The slider caps what that reaches.
 */
const LEAN_PER_TURN_RATE = 0.25;

/** Radians of lean for each heading unit turned in one poll. */
const LEAN_PER_HEADING =
  (LEAN_PER_TURN_RATE * (TAU / HEADING_CIRCLE)) /
  (RUDDER_POLL_FRAMES / ENGINE_FPS);

/**
 * A hovercraft hull that leans into its turns.
 *
 * A hovercraft is a ground unit, and `CGroundMoveType::ChangeHeading` calls the
 * script's `ChangeHeading` only for a turn of `minScriptChangeHeading` or more
 * in one frame (`GroundMoveType.cpp:1452-1453`), which no unchanged game
 * reaches (`ENGINE_MIN_SCRIPT_CHANGE_HEADING`). So this reads the heading as the
 * rudder does, with `GetUnitValue(COB.HEADING)`, and leans the hull with the
 * turn it measures. The lean is a `Turn` about z, which is a roll to the unit's
 * right when positive, so a right turn (a falling heading) leans right.
 *
 * The slope tilt is the engine's and needs no script (`upDirSmoothing`). The
 * lean is added to it inside the piece.
 */
export const HOVER_LEAN: AnimPreset = {
  id: "hover.lean",
  get label() {
    return t`Hull leans into turns`;
  },
  get description() {
    return t`Leans the hull into the unit's turning while it moves, and eases it level when the turn ends.`;
  },
  requires: [{ role: "base", count: 1 }],
  animates: ["base"],
  params: [
    {
      id: "max",
      get label() {
        return t`Largest lean`;
      },
      unit: "deg",
      min: 0,
      max: 30,
      step: 1,
      fallback: 8,
    },
  ],
  /** The lean depends on the unit's heading, which a time cannot give. */
  track() {
    return null;
  },
  get motions() {
    return t`Follows the unit's turning, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const hulls = ctx.pieces("base");
    if (hulls.length === 0) return null;
    const most = deg(value(this, ctx.params, "max"));
    const speed = lua(most / RUDDER_SWING_SECONDS);
    const turnAll = (angle: string) =>
      hulls.map((hull) => `    Turn(${hull}, z_axis, ${angle}, ${speed})`);
    const half = HEADING_CIRCLE / 2;
    return {
      functions: [
        "local function hullLean()",
        `  SetSignalMask(${ctx.signal})`,
        "  local last = GetUnitValue(COB.HEADING)",
        "  while true do",
        `    Sleep(${RUDDER_POLL_FRAMES * SLEEP_FRAME_MS})`,
        "    local now = GetUnitValue(COB.HEADING)",
        // A signed short, so a turn across the wrap is the short way round.
        // A left turn raises the heading, so `lean` is its size to the left and
        // the roll is its negative.
        `    local lean = ((now - last + ${half}) % ${HEADING_CIRCLE} - ${half}) * ${Number(LEAN_PER_HEADING.toPrecision(6))}`,
        "    last = now",
        `    if lean > ${lua(most)} then lean = ${lua(most)} end`,
        `    if lean < -${lua(most)} then lean = -${lua(most)} end`,
        ...turnAll("-lean"),
        "  end",
        "end",
        "",
        "local function hullLeanStop()",
        ...turnAll("0"),
        "end",
      ],
      hooks: {
        StartMoving: [`  Signal(${ctx.signal})`, "  StartThread(hullLean)"],
        StopMoving: [`  Signal(${ctx.signal})`, "  hullLeanStop()"],
      },
    };
  },
};

/**
 * The steering reads the heading as the rudder does, every
 * `RUDDER_POLL_FRAMES`. A driven heading wobbles from frame to frame, and the
 * rudder's note says a shorter poll swings with it. A poll of 3 frames did:
 * round a steady circle the wheels swung between 0 and the slider's limit.
 */
const STEER_POLL_FRAMES = RUDDER_POLL_FRAMES;

/** Radians of steering for each heading unit turned in one poll, with the
 *  rudder's degrees of swing for each degree a second of turn. */
const STEER_PER_HEADING =
  (RUDDER_PER_TURN_RATE * (TAU / HEADING_CIRCLE)) /
  (STEER_POLL_FRAMES / ENGINE_FPS);

/**
 * The front wheels swinging with the unit's turning.
 *
 * Which wheels are in front comes from where they are (`frontWheels`): ahead
 * of the middle of the wheels along z. The heading is read the way the
 * rudder's is, and for the same reason. A wheel's steering is a `Turn` about
 * y, which composes outside the spin about x (`ENGINE_ROTATION_ORDER`), so a
 * wheel can spin and steer at once.
 *
 * Backing up reverses the steering. A unit reversing with its wheels turned
 * left swings its heading to the right, so a heading turning left while it
 * reverses is a wheel turned right.
 */
export const WHEELS_STEER: AnimPreset = {
  id: "wheels.steer",
  get label() {
    return t`Front wheels steer`;
  },
  get description() {
    return t`Swings the wheels ahead of the middle of the wheels with the unit's turning while it moves, and straightens them when the turn ends.`;
  },
  requires: [{ role: "wheel", count: 1 }],
  animates: ["wheel"],
  params: [
    {
      id: "max",
      get label() {
        return t`Largest angle`;
      },
      unit: "deg",
      min: 0,
      max: 45,
      step: 1,
      fallback: 30,
    },
  ],
  /** The angle depends on the unit's heading, which a time cannot give. */
  track() {
    return null;
  },
  get motions() {
    return t`Follows the unit's turning, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const front = ctx.wheels().filter((wheel) => wheel.front);
    if (front.length === 0) return null;
    const most = deg(value(this, ctx.params, "max"));
    const speed = lua(most / RUDDER_SWING_SECONDS);
    const turnAll = (angle: string) =>
      front.map(
        ({ piece }) => `    Turn(${piece}, y_axis, ${angle}, ${speed})`,
      );
    const half = HEADING_CIRCLE / 2;
    return {
      functions: [
        "local function wheelsSteer()",
        `  SetSignalMask(${ctx.signal})`,
        "  local last = GetUnitValue(COB.HEADING)",
        "  while true do",
        `    Sleep(${STEER_POLL_FRAMES * SLEEP_FRAME_MS})`,
        "    local now = GetUnitValue(COB.HEADING)",
        `    local swing = ((now - last + ${half}) % ${HEADING_CIRCLE} - ${half}) * ${Number(STEER_PER_HEADING.toPrecision(6))}`,
        "    last = now",
        "    if GetUnitValue(COB.REVERSING) == 1 then swing = -swing end",
        `    if swing > ${lua(most)} then swing = ${lua(most)} end`,
        `    if swing < -${lua(most)} then swing = -${lua(most)} end`,
        ...turnAll("swing"),
        "  end",
        "end",
        "",
        "local function wheelsSteerStop()",
        ...turnAll("0"),
        "end",
      ],
      hooks: {
        StartMoving: [`  Signal(${ctx.signal})`, "  StartThread(wheelsSteer)"],
        StopMoving: [`  Signal(${ctx.signal})`, "  wheelsSteerStop()"],
      },
    };
  },
};

/**
 * How long the body's lean takes to follow a change of acceleration, in
 * seconds: it closes 63 percent of the gap to where the acceleration points it
 * in this time. A design choice.
 */
const ROCK_SETTLE_SECONDS = 0.3;

/**
 * A lean smaller than this, in radians, is level. It is the last decimal place
 * `lua()` writes an angle to, so a smaller one would write as 0.
 */
const ROCK_LEVEL = 1e-4;

/**
 * The body pitching with the unit's acceleration.
 *
 * Speeding up pitches the nose up and braking pitches it down, which is a
 * negative `Turn` about x and a positive one (the barrel lifts with a negative
 * x, `AIM_TRACK`). The lean aims for the slider's angle times the share of the
 * unit's full acceleration, or full braking, the speed changed by over the
 * poll, and eases there and back on a first order lag. So the size of the rock
 * follows the unit's own `acceleration` and `brakeRate` (`rates` in
 * `drive.ts`, 0.5 elmos a frame squared each when the unit sets none) and the
 * slider says how far the body leans at full power.
 *
 * The acceleration is read from `CURRENT_SPEED` on each poll. The engine's
 * `StopMoving` comes when the unit is told to stop, before it has slowed, so
 * the thread runs on until the speed is 0 and the body level.
 */
export const BODY_ROCK: AnimPreset = {
  id: "body.rock",
  get label() {
    return t`Body rocks on starting and stopping`;
  },
  get description() {
    return t`Pitches the body back as the unit speeds up and forward as it brakes, in proportion to how hard, and eases it level again.`;
  },
  requires: [{ role: "base", count: 1 }],
  animates: ["base"],
  params: [
    {
      id: "strength",
      get label() {
        return t`Lean at full power`;
      },
      unit: "deg",
      min: 0,
      max: 20,
      step: 0.5,
      fallback: 6,
    },
  ],
  /** The lean depends on the unit's acceleration, which a time cannot give. */
  track() {
    return null;
  },
  get motions() {
    return t`Follows how hard the unit speeds up and brakes, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const bodies = ctx.pieces("base");
    if (bodies.length === 0) return null;
    const strength = lua(deg(value(this, ctx.params, "strength")));
    const { accRate, decRate } = ctx.motion;
    const poll = WHEEL_POLL_FRAMES;
    // The share of full power a change of speed over one poll is.
    const share = (rate: number) =>
      Number((1 / (COBSCALE * poll * rate)).toPrecision(6));
    const catchUp = 1 - Math.exp(-(poll / ENGINE_FPS) / ROCK_SETTLE_SECONDS);
    const turnAll = (angle: string, rate: string) =>
      bodies.map((body) => `    Turn(${body}, x_axis, ${angle}, ${rate})`);
    return {
      functions: [
        "local bodyRockStopped = true",
        "",
        "local function bodyRock()",
        `  SetSignalMask(${ctx.signal})`,
        "  local last = GetUnitValue(COB.CURRENT_SPEED)",
        "  local lean = 0",
        "  while true do",
        `    Sleep(${poll * SLEEP_FRAME_MS})`,
        "    local now = GetUnitValue(COB.CURRENT_SPEED)",
        "    local push = now - last",
        "    last = now",
        `    if push > 0 then push = push * ${share(accRate)} else push = push * ${share(decRate)} end`,
        "    if push > 1 then push = 1 end",
        "    if push < -1 then push = -1 end",
        "    local was = lean",
        `    lean = lean + (-${strength} * push - lean) * ${Number(catchUp.toPrecision(6))}`,
        `    local level = bodyRockStopped and now == 0 and lean < ${ROCK_LEVEL} and lean > -${ROCK_LEVEL}`,
        "    if level then lean = 0 end",
        "    local step = lean - was",
        "    if step < 0 then step = -step end",
        // Reaches the new angle by the next poll.
        ...turnAll("lean", `step * ${ENGINE_FPS / poll}`),
        "    if level then return end",
        "  end",
        "end",
      ],
      hooks: {
        StartMoving: [
          `  Signal(${ctx.signal})`,
          "  bodyRockStopped = false",
          "  StartThread(bodyRock)",
        ],
        StopMoving: ["  bodyRockStopped = true"],
      },
    };
  },
};

/** Seconds between wakes at full speed in Balanced Annihilation's ships. */
const WAKE_INTERVAL_SECONDS = 0.12;

/**
 * A wake from each wake point while the unit moves.
 *
 * The engine draws no wake of its own, so the script emits one from a piece
 * every few frames (`UnitScript.cpp:634-676`). It drops a wake emitted while
 * the unit is out of the water, so the script does not check. The engine hands
 * `StartMoving` whether the unit is reversing, as 1 or 0 (`LuaUnitScript.cpp:1004`),
 * so a reversing unit emits `SFX.REVERSE_WAKE` for the whole move.
 *
 * The default interval is Balanced Annihilation's: its ship scripts sleep
 * `12000 / waketime` between wakes, with `waketime` the percentage of full
 * speed, so 120 ms at full speed.
 *
 * `SFX.WAKE` is 2 and `SFX.REVERSE_WAKE` is 4. The engine's 3 and 5 are the
 * same wakes under other names (`CobDefines.h:10-13`), so there is one of each
 * to emit.
 */
export const WAKE_WHILE_MOVING: AnimPreset = {
  id: "wake.moving",
  get label() {
    return t`Wake while moving`;
  },
  get description() {
    return t`Emits a wake from each wake point while the unit moves, and a reverse wake while it backs up.`;
  },
  requires: [{ role: "wake", count: 1 }],
  animates: [],
  params: [
    {
      id: "interval",
      get label() {
        return t`Time between wakes`;
      },
      unit: "s",
      min: 0.05,
      max: 0.5,
      step: 0.01,
      fallback: WAKE_INTERVAL_SECONDS,
    },
  ],
  /** Nothing moves: the wake is a particle the preview draws. */
  track() {
    return null;
  },
  get motions() {
    return t`Emits a wake and moves no piece.`;
  },
  emit(ctx) {
    const points = ctx.pieces("wake");
    if (points.length === 0) return null;
    // The sleep is a whole number of frames, and never none.
    const frames = Math.max(
      1,
      Math.round(value(this, ctx.params, "interval") * ENGINE_FPS),
    );
    return {
      functions: [
        "local function wakeWhileMoving(reversing)",
        `  SetSignalMask(${ctx.signal})`,
        // The engine passes 1 or 0, and 0 is true in Lua. A preview event that
        // passes nothing is a unit going forwards.
        "  local sfx = SFX.WAKE",
        "  if reversing and reversing ~= 0 then sfx = SFX.REVERSE_WAKE end",
        "  while true do",
        ...points.map((point) => `    EmitSfx(${point}, sfx)`),
        `    Sleep(${frames * SLEEP_FRAME_MS})`,
        "  end",
        "end",
      ],
      hooks: {
        StartMoving: [
          `  Signal(${ctx.signal})`,
          "  StartThread(wakeWhileMoving, reversing)",
        ],
        StopMoving: [`  Signal(${ctx.signal})`],
      },
    };
  },
};

/** Seconds the gear sits at each end of the preview's loop. */
const GEAR_PREVIEW_HOLD = 1;

/**
 * Landing gear that stows on take off and lowers on landing.
 *
 * Both air move types call `Activate` on take off and `Deactivate` once landed
 * (`HoverAirMoveType.cpp:206,211`, `StrafeAirMoveType.cpp:1227,1235`), so the
 * gear turns once on each. It turns about x, so a left and a right leg fold the
 * same way, and the piece's joint is the hinge. A call that finds the gear
 * already where it is going does nothing.
 *
 * The defaults are Balanced Annihilation's Dragonfly (`armdfly.bos`), the one
 * aircraft script there that folds anything on `Activate`: its legs turn from
 * 30 to 135 degrees, 105, at 45 degrees a second, which is 2.3 seconds.
 */
export const LANDING_GEAR: AnimPreset = {
  id: "gear.stow",
  get label() {
    return t`Landing gear`;
  },
  get description() {
    return t`Stows the landing gear on take off and lowers it on landing, once each.`;
  },
  requires: [{ role: "gear", count: 1 }],
  animates: ["gear"],
  params: [
    {
      id: "stow",
      get label() {
        return t`Stowed angle`;
      },
      unit: "deg",
      min: 10,
      max: 170,
      step: 5,
      fallback: 105,
    },
    {
      id: "stowTime",
      get label() {
        return t`Stowing time`;
      },
      unit: "s",
      min: 0.2,
      max: 8,
      step: 0.1,
      fallback: 2.3,
    },
  ],
  /** Up, held, down, held: the take off and land scenario in a loop that does
   *  not depend on the preview's length. */
  track(t, params, role) {
    if (role !== "gear") return null;
    const time = Math.max(value(this, params, "stowTime"), 0.05);
    const cycle = 2 * (time + GEAR_PREVIEW_HOLD);
    const at = t - Math.floor(t / cycle) * cycle;
    const stowed =
      at < time
        ? at / time
        : at < time + GEAR_PREVIEW_HOLD
          ? 1
          : Math.max(0, 1 - (at - time - GEAR_PREVIEW_HOLD) / time);
    return { rotation: [deg(value(this, params, "stow")) * stowed, 0, 0] };
  },
  get motions() {
    return t`Lowers the gear on landing, and an action that plays once never goes back to rest.`;
  },
  emit(ctx) {
    const gear = ctx.pieces("gear");
    if (gear.length === 0) return null;
    const stow = value(this, ctx.params, "stow");
    const angle = lua(deg(stow));
    const speed = lua(
      deg(stow) / Math.max(value(this, ctx.params, "stowTime"), 0.05),
    );
    const turn = (to: string) =>
      gear.map((piece) => `    Turn(${piece}, x_axis, ${to}, ${speed})`);
    return {
      functions: ["local gearStowed = false"],
      hooks: {
        Activate: [
          "  if not gearStowed then",
          "    gearStowed = true",
          ...turn(angle),
          "  end",
        ],
        // Lowering is not optional: gear left up is a landing on the belly.
        Deactivate: [
          "  if gearStowed then",
          "    gearStowed = false",
          ...turn("0"),
          "  end",
        ],
      },
    };
  },
};

/**
 * Rotors that spin while the aircraft is up.
 *
 * A gunship's rotor turns whether it is moving or hovering still, so this
 * follows `Activate` and `Deactivate`, which the hovering air move type calls on
 * take off and on landing (`HoverAirMoveType.cpp:211,206`), and not
 * `StartMoving` and `StopMoving`, which it calls only as the speed leaves and
 * returns to zero (`HoverAirMoveType.cpp:996-997`). A rotor on a unit that
 * hovers would otherwise stop dead in the air.
 *
 * `Spin` and `StopSpin` take an acceleration that is gained every frame
 * (`UnitScript.cpp:187-188`), so the spin-up time sets it as
 * `speed / (time * frames a second)`. The rotor spins about its own y axis, so
 * its joint is the shaft.
 */
export const ROTOR_SPIN: AnimPreset = {
  id: "rotor.spin",
  get label() {
    return t`Rotors spin while flying`;
  },
  get description() {
    return t`Spins every rotor from take off to landing, spinning up when the aircraft lifts and winding down when it lands.`;
  },
  requires: [{ role: "rotor", count: 1 }],
  animates: ["rotor"],
  params: [
    {
      id: "rate",
      get label() {
        return t`Turns per second`;
      },
      unit: "hz",
      min: 0.5,
      max: 10,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "spinUp",
      get label() {
        return t`Spin up and down time`;
      },
      unit: "s",
      min: 0.1,
      max: 8,
      step: 0.1,
      fallback: 2,
    },
  ],
  /** Spinning up, then at full speed, as it is from `Activate`. */
  track(t, params, role) {
    if (role !== "rotor") return null;
    const top = TAU * value(this, params, "rate");
    const ramp = Math.max(value(this, params, "spinUp"), 0.05);
    const angle = t < ramp ? (top * t * t) / (2 * ramp) : top * (t - ramp / 2);
    return { rotation: [0, angle, 0] };
  },
  get motions() {
    return t`Spins without end, which fixed poses cannot do.`;
  },
  emit(ctx) {
    const rotors = ctx.pieces("rotor");
    if (rotors.length === 0) return null;
    const top = TAU * value(this, ctx.params, "rate");
    const ramp = Math.max(value(this, ctx.params, "spinUp"), 0.05);
    const speed = lua(top);
    const accel = lua(top / (ramp * ENGINE_FPS));
    return {
      functions: [],
      hooks: {
        Activate: rotors.map(
          (rotor) => `  Spin(${rotor}, y_axis, ${speed}, ${accel})`,
        ),
        Deactivate: rotors.map(
          (rotor) => `  StopSpin(${rotor}, y_axis, ${accel})`,
        ),
      },
    };
  },
};

export const BUILDARM: AnimPreset = {
  id: "buildarm",
  get label() {
    return t`Build arm`;
  },
  get description() {
    return t`Sweeps the arm and keeps the nozzle level, the idle motion of a builder at work.`;
  },
  requires: [{ role: "buildarm.arm", count: 1 }],
  copies: {
    per: "instance",
    count(copies: number) {
      return plural(copies, {
        one: "# build arm",
        other: "# build arms",
      });
    },
  },
  animates: ["buildarm.base", "buildarm.arm", "buildarm.nozzle"],
  params: [
    {
      id: "period",
      get label() {
        return t`Cycle time`;
      },
      unit: "s",
      min: 0.5,
      max: 10,
      step: 0.5,
      fallback: 3,
    },
    {
      id: "swing",
      get label() {
        return t`Base swing`;
      },
      unit: "deg",
      min: 0,
      max: 90,
      step: 5,
      fallback: 35,
    },
    {
      id: "lift",
      get label() {
        return t`Arm lift`;
      },
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
  motions(ctx) {
    return cycleMotions(this, ctx, { start: "StartBuilding" });
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
  get label() {
    return t`Aim while building`;
  },
  get description() {
    return t`Points the build arm at whatever the unit is building and holds it there until the job stops. A builder only.`;
  },
  requires: [{ role: "buildarm.arm", count: 1 }],
  copies: {
    per: "instance",
    role: "buildarm.arm",
    count(copies: number) {
      return plural(copies, {
        one: "# build arm",
        other: "# build arms",
      });
    },
  },
  animates: ["buildarm.base", "buildarm.arm"],
  params: [
    {
      id: "turnSpeed",
      get label() {
        return t`Turn speed`;
      },
      unit: "deg/s",
      min: 15,
      max: 720,
      step: 15,
      fallback: 120,
    },
    {
      id: "liftSpeed",
      get label() {
        return t`Lift speed`;
      },
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
  get motions() {
    return t`Points at whatever the unit is building, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const turns: string[] = [];
    const waits: string[] = [];
    const rest: string[] = [];
    for (const instance of ctx.instances()) {
      const arm = instance.pieces("buildarm.arm")[0];
      if (!arm) continue;
      const turn = lua(deg(value(this, instance.params, "turnSpeed")));
      const lift = lua(deg(value(this, instance.params, "liftSpeed")));
      const base = instance.pieces("buildarm.base")[0];
      // A builder is told where to point and has no way to refuse, so an angle
      // outside the piece's range is held to its nearest edge (#3353).
      const yaw = base ? yawRange(ctx.limits?.(base)) : null;
      const elevation = pitchRange(ctx.limits?.(arm));
      if (base) {
        turns.push(
          `    Turn(${base}, y_axis, ${yaw ? clampedHeading(yaw) : "heading"}, ${turn})`,
        );
        rest.push(`  Turn(${base}, y_axis, 0, ${turn})`);
      }
      turns.push(
        `    Turn(${arm}, x_axis, -${elevation ? `(${clampedPitch(elevation)})` : "pitch"}, ${lift})`,
      );
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
  get label() {
    return t`Factory build cycle`;
  },
  get description() {
    return t`Opens the doors while a factory is building and shuts them when it stops. No aiming: the engine hands a factory nothing to point at.`;
  },
  requires: [{ role: "door", count: 1 }],
  animates: ["door"],
  params: [
    {
      id: "open",
      get label() {
        return t`Opening`;
      },
      unit: "deg",
      min: 10,
      max: FACTORY_MAX_OPEN,
      step: 5,
      fallback: 100,
    },
    {
      id: "openTime",
      get label() {
        return t`Opening time`;
      },
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
  get motions() {
    return t`Shuts the doors when the build stops, and an action that plays once never goes back to rest.`;
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
  get label() {
    return t`Nano from the nozzle`;
  },
  get description() {
    return t`Sends the build spray out of the pieces marked as nano emit points, taking each in turn, rather than out of the model's origin.`;
  },
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
  get motions() {
    return t`Picks where the build spray comes from and moves no piece.`;
  },
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
  get label() {
    return t`Doors`;
  },
  get description() {
    return t`Swings every door open and shut again, for hangars and silo covers.`;
  },
  requires: [{ role: "door", count: 1 }],
  copies: {
    per: "instance",
    count(copies: number) {
      return plural(copies, {
        one: "# set of doors",
        other: "# sets of doors",
      });
    },
  },
  animates: ["door"],
  params: [
    {
      id: "period",
      get label() {
        return t`Cycle time`;
      },
      unit: "s",
      min: 0.5,
      max: 12,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "open",
      get label() {
        return t`Opening`;
      },
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
  motions(ctx) {
    return cycleMotions(this, ctx, { start: "Activate" });
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
  get label() {
    return t`Hover and bob`;
  },
  get description() {
    return t`Bobs the body up and down and rocks it gently side to side, the way an aircraft or hovercraft sits while holding position.`;
  },
  requires: [{ role: "base", count: 1 }],
  copies: {
    per: "instance",
    count(copies: number) {
      return plural(copies, {
        one: "# body",
        other: "# bodies",
      });
    },
  },
  animates: ["base"],
  params: [
    {
      id: "period",
      get label() {
        return t`Cycle time`;
      },
      unit: "s",
      min: 0.5,
      max: 8,
      step: 0.5,
      fallback: 2.5,
    },
    {
      id: "height",
      get label() {
        return t`Bob height`;
      },
      unit: "m",
      min: 0,
      max: 2,
      step: 0.05,
      fallback: 0.3,
    },
    {
      id: "sway",
      get label() {
        return t`Rock`;
      },
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
  motions(ctx) {
    return cycleMotions(this, ctx, { start: "Create" });
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
  get label() {
    return t`Aim point`;
  },
  get description() {
    return t`Turns and lifts a single piece to face a target, for a unit with no separate turret and barrel.`;
  },
  requires: [{ role: "aim", count: 1 }],
  copies: {
    per: "weapon",
    role: "aim",
    count(copies: number) {
      return plural(copies, {
        one: "# aim point",
        other: "# aim points",
      });
    },
  },
  animates: ["aim"],
  params: [
    {
      id: "period",
      get label() {
        return t`Sweep time`;
      },
      unit: "s",
      min: 0.5,
      max: 12,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "sweep",
      get label() {
        return t`Turn`;
      },
      unit: "deg",
      min: 0,
      max: 180,
      step: 5,
      fallback: 60,
    },
    {
      id: "pitch",
      get label() {
        return t`Lift`;
      },
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
  get motions() {
    return t`Follows the target the weapon aims at, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const speed = aimSpeeds(this, ctx.params);
    const hooks: EmitResult["hooks"] = {};
    for (const weapon of ctx.weapons()) {
      const aim = weapon.piece("aim");
      if (!aim) continue;
      const n = weapon.number;
      hooks[`AimWeapon${n}`] = [
        ...refuseOutside(ctx.limits?.(aim), ctx.limits?.(aim)),
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
  get label() {
    return t`Recoil on firing`;
  },
  get description() {
    return t`Kicks the barrel back along its own bore when the weapon fires, and eases it home. A one-shot, not a loop: the preview repeats it on a timer so there is something to watch.`;
  },
  requires: [{ role: "barrel", count: 1 }],
  copies: {
    per: "weapon",
    role: "barrel",
    count(copies: number) {
      return plural(copies, {
        one: "# barrel",
        other: "# barrels",
      });
    },
  },
  animates: ["barrel"],
  params: [
    {
      id: "kick",
      get label() {
        return t`Kick distance`;
      },
      unit: "m",
      min: 0.02,
      max: 1,
      step: 0.02,
      fallback: 0.2,
    },
    {
      id: "kickTime",
      get label() {
        return t`Kick time`;
      },
      unit: "s",
      min: 0.02,
      max: 0.3,
      step: 0.01,
      fallback: 0.05,
    },
    {
      id: "returnTime",
      get label() {
        return t`Return time`;
      },
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
  motions(ctx) {
    return recoilMotions(this, ctx);
  },
  emit(ctx) {
    const kick = value(this, ctx.params, "kick");
    const kickTime = Math.max(value(this, ctx.params, "kickTime"), 0.01);
    const returnTime = Math.max(value(this, ctx.params, "returnTime"), 0.01);
    const hooks: EmitResult["hooks"] = {};
    for (const weapon of ctx.weapons()) {
      const barrel = weapon.piece("barrel");
      if (!barrel) continue;
      // A flare beside the barrel moves with it, so it stays in front of the
      // muzzle. One under the barrel is carried by it already.
      const flare = weapon.looseFlare();
      hooks[`Shot${weapon.number}`] = [
        `  Signal(${weapon.signal})`,
        `  SetSignalMask(${weapon.signal})`,
        `  Move(${barrel}, z_axis, -${lua(kick)}, ${lua(kick / kickTime)})`,
        ...(flare
          ? [`  Move(${flare}, z_axis, -${lua(kick)}, ${lua(kick / kickTime)})`]
          : []),
        `  WaitForMove(${barrel}, z_axis)`,
        `  Move(${barrel}, z_axis, 0, ${lua(kick / returnTime)})`,
        ...(flare
          ? [`  Move(${flare}, z_axis, 0, ${lua(kick / returnTime)})`]
          : []),
      ];
    }
    return Object.keys(hooks).length > 0 ? { functions: [], hooks } : null;
  },
};

/**
 * Recoil as one action per weapon (#4512): the kick over its time, then home
 * over the return time, started by that weapon's `Shot`. The script's kick
 * waits for the barrel to arrive, where an action waits whole frames, so the
 * two can be a frame apart.
 */
function recoilMotions(preset: AnimPreset, ctx: EmitContext): PresetMotion[] {
  const kick = Number(value(preset, ctx.params, "kick").toFixed(4));
  const kickTime = Math.max(value(preset, ctx.params, "kickTime"), 0.01);
  const returnTime = Math.max(value(preset, ctx.params, "returnTime"), 0.01);
  return ctx.weapons().flatMap((weapon): PresetMotion[] => {
    const barrel = weapon.piece("barrel");
    if (!barrel) return [];
    const flare = weapon.looseFlare();
    const at = (z: number): PresetKeyPieces =>
      new Map(
        [barrel, ...(flare ? [flare] : [])].map((piece) => [
          piece,
          { move: [0, 0, z] },
        ]),
      );
    return [
      {
        trigger: `Shot${weapon.number}`,
        loop: false,
        keys: [
          { seconds: kickTime, pieces: at(-kick) },
          { seconds: returnTime, pieces: at(0) },
        ],
      },
    ];
  });
}

export const IDLE_SWAY: AnimPreset = {
  id: "idle.sway",
  get label() {
    return t`Idle sway`;
  },
  get description() {
    return t`A slow turn back and forth while the unit stands still: a gentle body sway, or a scanning dish if that is what the piece is.`;
  },
  requires: [{ role: "base", count: 1 }],
  copies: {
    per: "instance",
    count(copies: number) {
      return plural(copies, {
        one: "# body",
        other: "# bodies",
      });
    },
  },
  animates: ["base"],
  params: [
    {
      id: "period",
      get label() {
        return t`Cycle time`;
      },
      unit: "s",
      min: 1,
      max: 20,
      step: 0.5,
      fallback: 6,
    },
    {
      id: "turn",
      get label() {
        return t`Turn`;
      },
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
  get motions() {
    return t`Starts on Create and whenever the unit stops, and an action has one trigger.`;
  },
  emit(ctx) {
    // The opposite of walking: idle motion picks up once the unit stops, and
    // stands down the moment it moves again. It also starts from `Create`,
    // because a unit that has not moved yet has never stopped (#3357).
    return cycleThreads(this, ctx, {
      name: "idleSway",
      start: "StopMoving",
      alsoStart: ["Create"],
      stop: "StartMoving",
    });
  },
};

/**
 * The turn of the body, in radians, a shot of unit strength gives it at the
 * lean slider's default, in degrees. Balanced Annihilation's `RockUnit` turns
 * the base by the engine's argument, which for a script in COB is the shot's
 * direction times 500, and 500 of COB's 65536 angle units to a turn is 2.75
 * degrees (`CobInstance.cpp:269-273`). The Lua `RockUnit` is handed the
 * direction on its own, so the slider is that same angle.
 */
const SETTLE_LEAN_DEGREES = 2.75;

/**
 * How long the body takes to reach the lean after a shot, in frames. Balanced
 * Annihilation's rock turns at 50 degrees a second, so 2.75 degrees takes
 * about 2 frames. A design choice here, not a measurement.
 */
const SETTLE_KICK_FRAMES = 2;

/** Frames between the steps of the easing back. A design choice. */
const SETTLE_STEP_FRAMES = 3;

/**
 * The body tipping away from each shot and easing level.
 *
 * The engine calls `RockUnit(x, z)` after a weapon fires, if the script has
 * one (`Weapon.cpp:606-608`). `x` and `z` are the unit vector opposite the
 * shot, in the unit's own space, so firing straight ahead gives `(0, -1)`.
 * The body is pushed that way, so its top goes that way: a shot ahead lifts
 * the nose, which is a negative turn about x as in `BODY_ROCK`, and a shot
 * along +x pushes the top along -x, which is a positive turn about z. Balanced
 * Annihilation's `ROCKUNIT.H` turns about z by the argument's own sign, the
 * other way, so its roll leans into a sideways shot. The pitch agrees with it.
 *
 * The lean snaps to the shot's size in a couple of frames and decays on a first
 * order lag, the same shape as `BODY_ROCK`, in steps. The next shot replaces
 * the lean in progress.
 */
export const BODY_SETTLE: AnimPreset = {
  id: "body.settle",
  get label() {
    return t`Body settles after a shot`;
  },
  get description() {
    return t`Tips the body a little away from the shot each time a weapon fires, and eases it level again.`;
  },
  requires: [{ role: "base", count: 1 }],
  animates: ["base"],
  params: [
    {
      id: "lean",
      get label() {
        return t`Lean per shot`;
      },
      unit: "deg",
      min: 0,
      max: 15,
      step: 0.25,
      fallback: SETTLE_LEAN_DEGREES,
    },
    {
      id: "settle",
      get label() {
        return t`Settle time`;
      },
      unit: "s",
      min: 0.05,
      max: 1.5,
      step: 0.05,
      fallback: 0.25,
    },
  ],
  /** The lean follows the shot's direction, which a time cannot give. */
  track() {
    return null;
  },
  get motions() {
    return t`Leans away from each shot, which no fixed pose can hold.`;
  },
  emit(ctx) {
    const bodies = ctx.pieces("base");
    if (bodies.length === 0) return null;
    const lean = deg(value(this, ctx.params, "lean"));
    if (lean <= 0) return null;
    const settle = Math.max(value(this, ctx.params, "settle"), 0.01);
    const decay = Math.exp(-(SETTLE_STEP_FRAMES / ENGINE_FPS) / settle);
    const turnAll = (axis: string, angle: string) =>
      bodies.map((body) => `  Turn(${body}, ${axis}, ${angle}, speed)`);
    return {
      functions: [
        "local bodySettlePitch = 0",
        "local bodySettleRoll = 0",
        "",
        // `rate` is the steps a second, so the turn lands by the next step.
        "local function bodySettleTurn(pitch, roll, rate)",
        "  local speed = (pitch - bodySettlePitch) * rate",
        "  if speed < 0 then speed = -speed end",
        ...turnAll("x_axis", "pitch"),
        "  speed = (roll - bodySettleRoll) * rate",
        "  if speed < 0 then speed = -speed end",
        ...turnAll("z_axis", "roll"),
        "  bodySettlePitch = pitch",
        "  bodySettleRoll = roll",
        "end",
      ],
      hooks: {
        RockUnit: [
          `  Signal(${ctx.signal})`,
          `  SetSignalMask(${ctx.signal})`,
          `  local pitch = ${lua(lean)} * rockDir_z`,
          `  local roll = -${lua(lean)} * rockDir_x`,
          `  bodySettleTurn(pitch, roll, ${ENGINE_FPS / SETTLE_KICK_FRAMES})`,
          `  Sleep(${SETTLE_KICK_FRAMES * SLEEP_FRAME_MS})`,
          `  while pitch > ${ROCK_LEVEL} or pitch < -${ROCK_LEVEL} or roll > ${ROCK_LEVEL} or roll < -${ROCK_LEVEL} do`,
          `    pitch = pitch * ${Number(decay.toPrecision(6))}`,
          `    roll = roll * ${Number(decay.toPrecision(6))}`,
          `    bodySettleTurn(pitch, roll, ${ENGINE_FPS / SETTLE_STEP_FRAMES})`,
          `    Sleep(${SETTLE_STEP_FRAMES * SLEEP_FRAME_MS})`,
          "  end",
          "  bodySettleTurn(0, 0, 0)",
        ],
      },
    };
  },
};

/** The look-around's waypoints, as shares of the half range either side of the
 *  middle. An irregular order, so a turret does not seem to be swinging on a
 *  pendulum. A design choice. */
const IDLE_LOOK_SHARES = [0.6, -0.4, -0.7, 0.3];

/** Frames between the checks that the unit has been quiet long enough. */
const IDLE_LOOK_POLL_FRAMES = 10;

/**
 * The turret looking slowly around while the unit has nothing to do.
 *
 * After the unit has not moved, aimed or fired for the delay, each turret turns
 * to a waypoint inside its yaw range, rests there, and turns to the next. A
 * turret with no range looks the turn slider's angle either side of straight
 * ahead. The look stops at the next `StartMoving`, `AimWeapon` or `Shot`, and
 * starts again after the delay. `StartMoving` also turns the turret back to
 * centre, which `AimWeapon` does not, since the aim turns it to where it wants.
 *
 * One thread, started from `Create`, so a unit that has not moved looks around
 * too. It wakes every `IDLE_LOOK_POLL_FRAMES` frames to count the quiet, which
 * the engine's cost for has not been measured.
 *
 * The aim's `Turn` replaces the look's on the same axis, so a look under way
 * when a target appears gives way to the aim. The thread issues no more turns
 * until the unit has been quiet again.
 */
export const IDLE_LOOK: AnimPreset = {
  id: "idle.look",
  get label() {
    return t`Turret looks around when idle`;
  },
  get description() {
    return t`After the unit has stood still without aiming or firing for a while, each turret slowly looks around inside its range. It stops when the unit moves or a weapon aims.`;
  },
  requires: [{ role: "turret", count: 1 }],
  animates: ["turret"],
  params: [
    {
      id: "delay",
      get label() {
        return t`Idle time before looking`;
      },
      unit: "s",
      min: 1,
      max: 30,
      step: 0.5,
      fallback: 4,
    },
    {
      id: "speed",
      get label() {
        return t`Turn speed`;
      },
      unit: "deg",
      min: 1,
      max: 90,
      step: 1,
      fallback: 20,
    },
    {
      id: "pause",
      get label() {
        return t`Pause at each look`;
      },
      unit: "s",
      min: 0.1,
      max: 10,
      step: 0.1,
      fallback: 1.5,
    },
    {
      id: "turn",
      get label() {
        return t`Turn either side, with no range`;
      },
      unit: "deg",
      min: 5,
      max: 180,
      step: 5,
      fallback: 40,
    },
  ],
  /** What the turret does depends on how long the unit has been quiet. */
  track() {
    return null;
  },
  get motions() {
    return t`Waits until the unit has stood still without aiming for a while, which no action trigger does.`;
  },
  emit(ctx) {
    const turrets = ctx.pieces("turret");
    if (turrets.length === 0) return null;
    const delay = Math.max(
      1,
      Math.round(value(this, ctx.params, "delay") * ENGINE_FPS),
    );
    const speed = lua(deg(value(this, ctx.params, "speed")));
    const pause =
      Math.max(1, Math.round(value(this, ctx.params, "pause") * ENGINE_FPS)) *
      SLEEP_FRAME_MS;
    const sideways = value(this, ctx.params, "turn");

    // Each turret's waypoints, in degrees from straight ahead.
    const waypoints = turrets.map((turret, index) => {
      const range = yawRange(ctx.limits?.(turret));
      const middle = range ? (range.min + range.max) / 2 : 0;
      const half = range ? (range.max - range.min) / 2 : sideways;
      return IDLE_LOOK_SHARES.map(
        (_, step) =>
          middle +
          half * IDLE_LOOK_SHARES[(step + index) % IDLE_LOOK_SHARES.length],
      );
    });

    // Any aim or shot means the unit is busy, so the count starts again.
    const busy = Object.fromEntries(
      ctx.weapons().flatMap((weapon) => [
        [`AimWeapon${weapon.number}`, ["  idleLookQuiet = 0"]],
        [`Shot${weapon.number}`, ["  idleLookQuiet = 0"]],
      ]),
    ) as EmitResult["first"];
    return {
      functions: [
        "local idleLookQuiet = 0",
        "local idleLookMoving = false",
        "",
        "local function idleLookWait()",
        `  while idleLookMoving or idleLookQuiet < ${delay} do`,
        `    Sleep(${IDLE_LOOK_POLL_FRAMES * SLEEP_FRAME_MS})`,
        `    idleLookQuiet = idleLookQuiet + ${IDLE_LOOK_POLL_FRAMES}`,
        "  end",
        "end",
        "",
        "local function idleLook()",
        "  while true do",
        ...IDLE_LOOK_SHARES.flatMap((_, step) => [
          "    idleLookWait()",
          ...turrets.map(
            (turret, index) =>
              `    Turn(${turret}, y_axis, ${lua(deg(waypoints[index][step]))}, ${speed})`,
          ),
          ...turrets.map((turret) => `    WaitForTurn(${turret}, y_axis)`),
          `    Sleep(${pause})`,
        ]),
        "  end",
        "end",
      ],
      hooks: {
        Create: ["  StartThread(idleLook)"],
        StartMoving: [
          // Centred only when the look had begun. Before that the turret is
          // where something else left it.
          `  if idleLookQuiet >= ${delay} then`,
          ...turrets.map(
            (turret) => `    Turn(${turret}, y_axis, 0, ${speed})`,
          ),
          "  end",
          "  idleLookMoving = true",
          "  idleLookQuiet = 0",
        ],
        StopMoving: ["  idleLookMoving = false", "  idleLookQuiet = 0"],
      },
      first: busy,
    };
  },
};

export const WRECK_POSE: AnimPreset = {
  id: "wreck.pose",
  get label() {
    return t`Wreck pose`;
  },
  get description() {
    return t`Sinks and tilts the body into the wreck the unit leaves when it dies. Export bakes this pose into the wreck's own model. Not an animation: the piece snaps straight into the pose and stays there.`;
  },
  requires: [{ role: "base", count: 1 }],
  animates: ["base"],
  params: [
    {
      id: "sink",
      get label() {
        return t`Sink`;
      },
      unit: "m",
      min: 0,
      max: 1,
      step: 0.05,
      fallback: 0.15,
    },
    {
      id: "tilt",
      get label() {
        return t`Tilt`;
      },
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
  get motions() {
    return t`Plays on Killed, which no action can start from.`;
  },
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

/**
 * The grades a destroyed unit breaks apart in, lightest first (#3354).
 *
 * `share` is how much of the unit's weakest groups are thrown at that grade,
 * and `depth` how finely the unit is cut (`breakGroups`): light and medium
 * hits throw bigger groups, a heavy hit cuts at every connection. The shares
 * are thirds because Balanced Annihilation's scripts have three grades before
 * the one that repeats the last, and the game maker's `amount` scales them.
 *
 * `corpse` is the wreck level the grade returns: 1, 2 and 3, as the three bands
 * of Balanced Annihilation's scripts do. Of the 417 scripts in
 * balanced_annihilation-v15.9.8 with a `Killed`, 386 cut severity at 25, 50 and
 * 99 and set `corpsetype` to 1, 2 and 3 in those bands. The engine reads level `n` as `n - 1` steps down the wreck's
 * `featuredead` chain (`CUnit::~CUnit` calls `CreateWreck(level - 1)` and
 * `CFeatureHandler::CreateWreckage` walks `deathFeatureDefID`), so a level past
 * the stages the unit's export writes (`WRECK_STAGES`) leaves no wreck at all.
 * The export writes one, so every grade returns 1 until it writes a heap.
 */
interface BreakGrade {
  id: "light" | "medium" | "heavy";
  depth: number;
  share: number;
  /** The `SFX` names thrown pieces get. Debris always falls: `PF_Fall` is
   *  unused in the engine and `SFX.FALL` is 0. */
  flags: string[];
  /** What happens to the root, which is what is left when the groups are gone.
   *  `SFX.NONE` is a flash with no debris. */
  root: "SFX.NONE" | "SFX.SHATTER";
  corpse: number;
}

const BREAK_GRADES: BreakGrade[] = [
  {
    id: "light",
    depth: 1,
    share: 1 / 3,
    flags: ["SFX.SMOKE"],
    root: "SFX.NONE",
    corpse: 1,
  },
  {
    id: "medium",
    depth: 2,
    share: 2 / 3,
    flags: ["SFX.SMOKE", "SFX.FIRE"],
    root: "SFX.NONE",
    corpse: 2,
  },
  {
    id: "heavy",
    depth: EVERY_CUT,
    share: 1,
    flags: ["SFX.SMOKE", "SFX.FIRE", "SFX.EXPLODE_ON_HIT"],
    root: "SFX.SHATTER",
    corpse: 3,
  },
];

export const BREAK_APART: AnimPreset = {
  id: "wreck.breakApart",
  get label() {
    return t`Break apart`;
  },
  get description() {
    return t`When the unit dies it comes apart along its joins. A light hit throws off a few of the biggest groups of parts, a heavy hit throws off every part one by one, smallest first, and the wreck follows what the hit left. A unit with no joins breaks along its piece tree.`;
  },
  requires: [],
  animates: [],
  params: [
    {
      id: "amount",
      get label() {
        return t`How much breaks off`;
      },
      unit: "%",
      min: 10,
      max: 100,
      step: 5,
      fallback: 100,
    },
    {
      id: "light",
      get label() {
        return t`Light hit up to`;
      },
      unit: "%",
      min: 1,
      max: 100,
      step: 1,
      fallback: 25,
    },
    {
      id: "medium",
      get label() {
        return t`Medium hit up to`;
      },
      unit: "%",
      min: 1,
      max: 200,
      step: 1,
      fallback: 50,
    },
  ],
  /** Nothing moves: the pieces are thrown and hidden, which the preview marks
   *  on the scrubber. */
  track() {
    return null;
  },
  /**
   * Severity is `recentDamage / maxHealth` (`LuaUnitScript.cpp` documents it
   * so for Killed). `recentDamage` is the damage taken lately, decayed by 0.9
   * a slow update, and a self destruct adds twice the unit's health to it
   * (`Unit.cpp`). The engine's COB side passes the ratio as a percentage and
   * Balanced Annihilation's scripts cut it at 25, 50 and 99, so the defaults
   * are the first two, as percentages. Everything above the second is the
   * heavy grade: BA's third band and the one past it do the same thing.
   *
   * The groups are worked out here and written out flat, one `if` for each
   * grade, so the script shows what each grade throws and the game maker can
   * edit it. Every `if` returns, so `buildLuaScript` leaves out the
   * `Explode` and `return 1` it writes for a unit with nothing in `Killed`.
   */
  get motions() {
    return t`Throws pieces off when the unit dies, which no action can do.`;
  },
  emit(ctx) {
    const root = ctx.root;
    if (!root) return null;
    const amount = Math.min(
      1,
      Math.max(0.1, value(this, ctx.params, "amount") / 100),
    );
    const medium = Math.max(value(this, ctx.params, "medium"), 0) / 100;
    const light = Math.min(
      Math.max(value(this, ctx.params, "light"), 0) / 100,
      medium,
    );
    const limits = [light, medium];

    const lines: string[] = ["  local severity = recentDamage / maxHealth"];
    BREAK_GRADES.forEach((grade, index) => {
      const groups = ctx.breakGroups(grade.depth);
      const thrown =
        groups.length === 0
          ? 0
          : Math.max(1, Math.ceil(groups.length * grade.share * amount));
      const flags = grade.flags.join(" + ");
      const body: string[] = [];
      for (const group of groups.slice(0, thrown)) {
        const pieces = group.pieces;
        if (group.whole && pieces.length > 1) {
          body.push(`Explode(${pieces[0]}, SFX.RECURSIVE + ${flags})`);
        } else {
          for (const piece of pieces) body.push(`Explode(${piece}, ${flags})`);
        }
        for (const piece of pieces) body.push(`Hide(${piece})`);
      }
      body.push(
        `Explode(${root}, ${grade.root})`,
        `return ${Math.min(grade.corpse, WRECK_STAGES)}`,
      );
      const last = index === BREAK_GRADES.length - 1;
      if (last) {
        lines.push(...body.map((line) => `  ${line}`));
      } else {
        lines.push(
          `  if severity <= ${lua(limits[index])} then`,
          ...body.map((line) => `    ${line}`),
          "  end",
        );
      }
    });
    return { functions: [], hooks: { Killed: lines } };
  },
};

export const PRESETS: AnimPreset[] = [
  WALK_BIPED,
  WALK_QUAD,
  WALK_LEGS,
  TURRET_TRACK,
  WHEELS_ROLL,
  RUDDER_FOLLOWS,
  WAKE_WHILE_MOVING,
  LANDING_GEAR,
  ROTOR_SPIN,
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
  WHEELS_STEER,
  BODY_ROCK,
  HOVER_LEAN,
  BREAK_APART,
  BODY_SETTLE,
  IDLE_LOOK,
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
  const needs = [
    ...preset.requires,
    ...(preset.requiresFor?.(roleCounts) ?? []),
  ];
  return [
    ...new Set(
      needs
        .filter((need) => (roleCounts.get(need.role) ?? 0) < need.count)
        .map((need) => need.role),
    ),
  ];
}

/** Whether a preset moves a role: one it lists, or one its `moves` takes. */
export function presetMovesRole(preset: AnimPreset, role: string): boolean {
  return preset.animates.includes(role) || preset.moves?.(role) === true;
}

/** Whether a preset moves or needs a role. */
export function presetUsesRole(preset: AnimPreset, role: string): boolean {
  return (
    presetMovesRole(preset, role) ||
    preset.requires.some((need) => need.role === role)
  );
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
  const leg = parseLegRole(id);
  if (leg) return legRoleLabel(leg.side, leg.pair, leg.segment);
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
  rotor: [1],
  aim: [0, 1],
};

/** The axes a role's rest rotation should sit on a right angle for. Empty for
 *  a role no preset ever turns. Leg roles turn about x regardless of side or
 *  pair, so they match by pattern rather than one table entry each. */
function roleRotationAxes(role: string): readonly number[] {
  if (parseLegRole(role)) return [0];
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
    const role = roleLabel(piece.role);
    const letter = AXIS_LETTERS[axis];
    const rest = formatFixed(degrees, 1);
    warnings.push(
      t`${role} turns about ${letter}, and this piece's rest rotation there is ${rest}°, not a right angle. A hand-edited Turn call may not land where it looks like it should. The nearest clean angle is ${clean}°.`,
    );
  }
  return warnings;
}
