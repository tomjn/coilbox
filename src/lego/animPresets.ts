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
  /** Degrees, seconds or turns per second. Converted inside `track`. */
  unit: "deg" | "s" | "hz";
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
};

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
};

export const PRESETS: AnimPreset[] = [
  WALK_BIPED,
  WALK_QUAD,
  TURRET_TRACK,
  WHEELS_ROLL,
  BUILDARM,
  OPEN_CLOSE,
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
