/**
 * A walk fitted to the unit's legs and speed (#3349).
 *
 * The engine moves a walker at its `speed` whatever its legs do, so a walk
 * whose numbers ignore the unit slides its feet. While a foot is down it has
 * to move back under the body at the unit's speed, which ties three things
 * together:
 *
 *   ground sweep = speed * period * duty
 *
 * The ground sweep is how far the ankle travels back while the foot is down.
 * A straight leg of length `L` swinging `A` either side of upright sweeps
 * `2 * L * sin(A)`, so with the swing angle and the time on the ground fixed,
 * the period follows from the leg and the speed:
 *
 *   period = 2 * L * sin(A) / (speed * duty)
 *
 * Longer legs take longer strides and so take longer over each one. Lift
 * scales the same way: the knee's bend lifts the foot `shin * (1 - cos(knee))`
 * at the middle of the swing, so a longer shin lifts it higher at the same
 * angle.
 *
 * This is what Balanced Annihilation and Splinter Faction do by hand. Their
 * walkers keep one set of poses and divide every sleep by the unit's speed
 * (`armpw.bos` in BA 15.9.8, `xhammer.bos` in Splinter Faction), so the poses,
 * and with them the stride, stay the same and the period goes as one over the
 * speed. Those scripts read `CURRENT_SPEED` while walking. This bakes the
 * unit's `speed` in when the script is written instead, because the presets
 * are a function of time alone, which is what the preview plays and the
 * parity fixture checks.
 *
 * The game maker's numbers stay as overrides. A period set by hand keeps that
 * period and fits the swing angle to it, and a swing set by hand keeps that
 * angle and fits the period. Both set means both are used as given. Either
 * way the period is rounded to an even number of frames and the time on the
 * ground to a whole number, which the script needs (`walkPoses`).
 */

import {
  type AnimPreset,
  type AppliedPreset,
  presetById,
  WALK_BIPED,
  WALK_DROP,
  WALK_FITTED,
  WALK_SHIN,
  WALK_SPEED,
  WALK_THIGH,
  walkSweep,
} from "./animPresets";
import type { LegoPiece, LegoProject } from "./model";
import { type Problem, problem } from "./problems";

/** Sim frames per second, the engine's `GAME_SPEED`. A period is a whole
 *  number of them, because `cycleThread` sleeps whole frames. */
const ENGINE_FPS = 30;

const WALK_PRESETS = new Set(["walk.biped", "walk.quad"]);

/** What a walk is fitted to. */
export interface WalkBody {
  /** Hip joint to ankle joint, in elmos: the skeleton's `legLength`. */
  legLength: number;
  /** The unit's `speed`, in elmos a second. */
  speed: number;
  /**
   * Hip joint to knee joint and knee joint to ankle joint, in elmos, the mean
   * over the unit's legs (#3350). Absent when the leg pieces do not give
   * them, and then the knee stays straight on the ground as it did in #3349.
   */
  thighLength?: number;
  shinLength?: number;
}

/** Where a piece's joint rests in the unit, its parents' positions added up. */
function jointOf(project: LegoProject, piece: LegoPiece): number[] {
  const at = [0, 0, 0];
  const seen = new Set<string>();
  let current: LegoPiece | undefined = piece;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    for (let axis = 0; axis < 3; axis++) at[axis] += current.position[axis];
    const parentId: string | null = current.parentId;
    current = parentId
      ? project.pieces.find((other) => other.id === parentId)
      : undefined;
  }
  return at;
}

/**
 * The thigh's and the shin's lengths, the mean over every leg with all three
 * of its pieces, or null when there is no such leg or one of them does not
 * hang down. The solve takes a leg as hanging straight down from the hip at
 * rest, as every body plan builds it, so a knee that is not below its hip or
 * an ankle that is not below its knee has no length the solve can use.
 */
export function legLengths(
  project: LegoProject,
): { thighLength: number; shinLength: number } | null {
  const thighs: number[] = [];
  const shins: number[] = [];
  for (const leg of ["l1", "r1", "l2", "r2"]) {
    const joint = (segment: string) => {
      const piece = project.pieces.find(
        (entry) => entry.role === `leg.${leg}.${segment}`,
      );
      return piece ? jointOf(project, piece) : null;
    };
    const [hip, knee, ankle] = ["thigh", "shin", "foot"].map(joint);
    if (!hip || !knee || !ankle) continue;
    if (!(knee[1] < hip[1]) || !(ankle[1] < knee[1])) return null;
    thighs.push(Math.hypot(...knee.map((n, axis) => n - hip[axis])));
    shins.push(Math.hypot(...ankle.map((n, axis) => n - knee[axis])));
  }
  if (thighs.length === 0) return null;
  const mean = (values: number[]) =>
    values.reduce((sum, n) => sum + n, 0) / values.length;
  return { thighLength: mean(thighs), shinLength: mean(shins) };
}

/**
 * The unit's leg length and speed, or null when it has no skeleton with legs
 * or no speed to walk at, in which case the walk is left as it was.
 */
export function walkBody(project: LegoProject): WalkBody | null {
  const legLength = project.skeleton?.proportions.legLength;
  const speed = project.movement?.speed;
  if (typeof legLength !== "number" || !(legLength > 0)) return null;
  if (typeof speed !== "number" || !(speed > 0)) return null;
  return { legLength, speed, ...legLengths(project) };
}

function given(params: Record<string, number>, id: string): number | undefined {
  const value = params[id];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function range(preset: AnimPreset, id: string) {
  const param = preset.params.find((entry) => entry.id === id);
  if (!param) throw new Error(`walk has no ${id} param`);
  return param;
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** The swing angle, in degrees, whose ground sweep is `sweep`. Held to the
 *  slider's range, so a stride the leg cannot reach is cut short. */
function swingFor(sweep: number, legLength: number): number {
  const { min, max } = range(WALK_BIPED, "stride");
  const reach = clamp(sweep / (2 * legLength), 0, 1);
  return clamp((Math.asin(reach) * 180) / Math.PI, min, max);
}

/**
 * The walk's params fitted to `body`: `period` and `stride` worked out from
 * the leg length and speed unless the game maker set them, and the fitted
 * flag set. Every other param is passed through.
 */
export function fitWalk(
  body: WalkBody,
  params: Record<string, number>,
): Record<string, number> {
  const { legLength, speed } = body;
  const ownPeriod = given(params, "period");
  const ownSwing = given(params, "stride");
  const share =
    (given(params, "duty") ?? range(WALK_BIPED, "duty").fallback) / 100;

  // The period in an even number of frames and the time on the ground in a
  // whole number, so a foot comes down and lifts on a frame for each leg,
  // half a cycle apart, and the script has a pose there (`walkPoses`). The
  // swing is then fitted to what was rounded, unless it was set by hand, so
  // the rounding does not leave the foot sliding.
  const { min, max } = range(WALK_BIPED, "period");
  const rawPeriod =
    ownPeriod ??
    (2 *
      legLength *
      Math.sin(
        ((ownSwing ?? range(WALK_BIPED, "stride").fallback) * Math.PI) / 180,
      )) /
      (speed * share);
  const frames = clamp(
    2 * Math.round((rawPeriod * ENGINE_FPS) / 2),
    Math.round(min * ENGINE_FPS),
    Math.round(max * ENGINE_FPS),
  );
  const down = clamp(Math.round(share * frames), 1, frames - 1);
  const period = frames / ENGINE_FPS;
  const duty = down / frames;
  const stride = ownSwing ?? swingFor(speed * period * duty, legLength);
  const { thighLength, shinLength } = body;
  return {
    ...params,
    period,
    stride,
    duty: 100 * duty,
    [WALK_FITTED]: 1,
    // What the legs are solved with (#3350). The body is lowered by as much
    // as a straight leg swung the fitted angle either side of upright rises,
    // so a foot reaches the ground at both ends of its time on it with the
    // knee straight there and bent between.
    ...(thighLength && shinLength
      ? {
          [WALK_THIGH]: thighLength,
          [WALK_SHIN]: shinLength,
          [WALK_SPEED]: speed,
          [WALK_DROP]:
            (thighLength + shinLength) *
            (1 - Math.cos((stride * Math.PI) / 180)),
        }
      : {}),
  };
}

/**
 * Whether a fitted walk's feet would have to reach further than the legs do,
 * with the body lowered by `drop`: the stride is longer than a leg swung its
 * angle either side of upright covers. That happens when the game maker sets
 * both the period and the swing, or a period so long the swing it needs is
 * past the slider's top. The solve then points the straight leg at a foot it
 * cannot reach, and the foot slides at the ends of its time on the ground.
 * The leeway is floating point's, since a fitted walk is exactly at full
 * reach at both ends.
 */
export function pastReach(
  params: Record<string, number>,
  drop = params[WALK_DROP] ?? 0,
): boolean {
  const thigh = params[WALK_THIGH];
  const shin = params[WALK_SHIN];
  if (!(thigh > 0 && shin > 0)) return false;
  const leg = thigh + shin;
  const furthest = Math.hypot(walkSweep(params) / 2, leg - drop);
  return furthest > leg * (1 + 1e-9);
}

/**
 * A preset's params as the script is written with them: a walk's fitted to
 * the unit's body when it has one, and every other preset's as they are.
 */
export function fittedParams(
  project: LegoProject,
  presetId: string,
  params: Record<string, number>,
): Record<string, number> {
  if (!WALK_PRESETS.has(presetId)) return params;
  const body = walkBody(project);
  return body ? fitWalk(body, params) : params;
}

/** The params a fitted walk works out for itself, which a game maker's own
 *  value replaces. */
const FITTED_WALK_PARAMS = ["period", "stride"];

/**
 * The params one copy of an applied preset is written with, as the Animation
 * panel shows them: its saved params, the copy's own laid over them, then
 * fitted as `buildLuaScript` fits them. `instance` null means the shared ones.
 */
export function shownParams(
  project: LegoProject,
  entry: AppliedPreset,
  instance: string | null,
): Record<string, number> {
  const own = instance !== null ? entry.instances?.[instance] : undefined;
  return fittedParams(
    project,
    entry.presetId,
    own ? { ...entry.params, ...own } : entry.params,
  );
}

/**
 * Whether the game maker has set a number the fit would otherwise work out,
 * on the shared params or on one copy's, for a walk the unit can be fitted
 * to. The panel offers to go back to the fitted numbers when it has.
 */
export function overridesFit(
  project: LegoProject,
  entry: AppliedPreset,
  instance: string | null,
): boolean {
  if (!WALK_PRESETS.has(entry.presetId) || !walkBody(project)) return false;
  const level =
    instance !== null ? (entry.instances?.[instance] ?? {}) : entry.params;
  return FITTED_WALK_PARAMS.some((id) => given(level, id) !== undefined);
}

/** The applied walk with the shared params', or one copy's, overrides of the
 *  fitted numbers dropped, so the fit works them out again. */
export function withoutFitOverrides(
  entry: AppliedPreset,
  instance: string | null,
): AppliedPreset {
  const drop = (params: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(params).filter(([id]) => !FITTED_WALK_PARAMS.includes(id)),
    );
  if (instance === null) return { ...entry, params: drop(entry.params) };
  const own = entry.instances?.[instance];
  if (!own) return entry;
  const { [instance]: _old, ...others } = entry.instances ?? {};
  const kept = drop(own);
  const instances =
    Object.keys(kept).length > 0 ? { ...others, [instance]: kept } : others;
  const { instances: _was, ...rest } = entry;
  return Object.keys(instances).length > 0 ? { ...rest, instances } : rest;
}

/**
 * The walk's lines in the problems list (#3350): a walk whose stride is past
 * the legs' reach, and a walker whose leg joints give the solve no lengths.
 * Each set of legs is checked with the drop the shared walk lowers the body
 * by, as `walkEmit` solves it.
 */
export function walkProblems(project: LegoProject): Problem[] {
  const body = walkBody(project);
  if (!body) return [];
  const out: Problem[] = [];
  for (const entry of project.animations ?? []) {
    if (!WALK_PRESETS.has(entry.presetId)) continue;
    const label = presetById(entry.presetId)?.label ?? entry.presetId;
    const thighs = project.pieces
      .filter((piece) => /^leg\.[lr][12]\.thigh$/.test(piece.role ?? ""))
      .map((piece) => piece.id);
    if (body.thighLength === undefined) {
      out.push(
        problem(
          "skeleton",
          "warning",
          `The legs do not hang down from their joints, so "${label}" cannot keep the feet planted.`,
          thighs,
        ),
      );
      continue;
    }
    const shared = shownParams(project, entry, null);
    const copies = [
      shared,
      ...Object.keys(entry.instances ?? {}).map((id) =>
        shownParams(project, entry, id),
      ),
    ];
    if (copies.some((params) => pastReach(params, shared[WALK_DROP]))) {
      out.push(
        problem(
          "skeleton",
          "warning",
          `"${label}" strides further than the legs reach, so the feet slide.`,
          thighs,
        ),
      );
    }
  }
  return out;
}
