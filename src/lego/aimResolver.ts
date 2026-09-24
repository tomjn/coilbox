/**
 * Turn "aim at the stand-in" into the two angles the engine would hand a
 * script.
 *
 * Pure: a scenario and some measurements of the model go in, a scenario whose
 * aiming call-ins carry concrete radians comes out. Nothing here runs a script
 * or touches a scene.
 *
 * The two call-ins do not share a formula, and the difference is not cosmetic.
 * `AimWeapon` projects the wanted direction onto the unit's own basis and
 * negates the heading (`rts/Sim/Weapons/Weapon.cpp:410-424`). `StartBuilding`
 * takes the world heading minus the unit's own and does not negate
 * (`rts/Sim/Units/UnitTypes/Builder.cpp:942-955`). Both land in the same
 * convention, which is the thing worth knowing and the thing the tests assert:
 * a positive heading means the target is to the unit's left, a positive pitch
 * means above.
 *
 * Aiming is measured from a piece's rest position, not from where the piece is
 * on the frame the call-in fires. The engine uses the live animated position,
 * but the arguments have to be known before the script runs, so reading the
 * animated position would be circular. A turret's pivot barely moves relative
 * to its unit, so the error is small, and a second pass to close it would
 * double the latency of every scrub.
 */

import {
  type Scenario,
  type ScriptEvent,
  type ScriptWorld,
  STAND_IN_UNIT_ID,
  type StandInAttach,
  type StandInTrack,
} from "./scriptPlayback";
import {
  attachedAt,
  STAND_IN_MID_Y,
  standInAt,
  standInHeight,
} from "./standIn";

type Vec3 = [number, number, number];

/** What the resolver has to be told about the model to do its arithmetic. */
export interface AimContext {
  /** The stand-in's radius beside this unit, in elmos. */
  radius: number;
  /** The unit's aim point, which is also the mid the engine builds from. */
  mid: Vec3;
  /** Where each piece rests in unit space, by name. */
  pieceRest: Map<string, Vec3>;
  /** The first piece a probe named for a call-in, or null for none. */
  probed: (callin: string) => string | null;
}

export interface ResolvedScenario {
  events: ScriptEvent[];
  /** What could not be worked out, for the panel to show. */
  notes: string[];
}

/**
 * Where the stand-in's middle is on one frame, in unit space.
 *
 * Its middle rather than its base, because that is what a weapon aims at: the
 * engine fires at a unit's `aimPos`, which sits inside the unit rather than on
 * the ground under it.
 */
export function standInMid(
  track: StandInTrack,
  frame: number,
  radius: number,
): Vec3 | null {
  const pose = standInAt(track, frame, radius);
  if (!pose) return null;
  return [pose.pos[0], pose.pos[1] + STAND_IN_MID_Y * radius, pose.pos[2]];
}

/**
 * The heading and pitch `AimWeapon` is handed, from a piece to a target.
 *
 * `rts/Sim/Weapons/Weapon.cpp:410-424`, written out rather than reduced so it
 * can be read against the engine line for line. With the unit at heading zero
 * on flat ground its basis is the model's own: `frontdir` is `+z`, `updir` is
 * `+y`, and `rightdir` is `(-1,0,0)` (`rts/Sim/Objects/SolidObject.cpp:440`
 * with `GetVectorFromHeading(0)` being `(0,0,1)`). The editor never has a unit
 * at any other heading or on any other ground.
 */
export function aimWeaponAngles(
  from: Vec3,
  to: Vec3,
): { heading: number; pitch: number } {
  const dir = normalize([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);

  const localX = -dir[0]; // dir · rightdir
  const localY = dir[1]; //  dir · updir
  const localZ = dir[2]; //  dir · frontdir

  const heading = headingFromVector(localX, localZ);
  return {
    heading: clampRadPi(-heading),
    pitch: Math.asin(Math.min(Math.max(localY, -1), 1)),
  };
}

/**
 * The heading and pitch `StartBuilding` is handed, from the unit's mid to a
 * build position.
 *
 * `rts/Sim/Units/UnitTypes/Builder.cpp:942-955`. Two terms in that line are
 * zero here and are left out rather than written as `- 0`: the unit's own
 * heading, which is zero in the editor, and `asin(frontdir·updir)`, which is
 * zero for a unit on flat ground, which is the only ground the builder draws.
 */
export function startBuildingAngles(
  mid: Vec3,
  to: Vec3,
): { heading: number; pitch: number } {
  const dir = normalize([to[0] - mid[0], to[1] - mid[1], to[2] - mid[2]]);
  return {
    heading: clampRadPi(headingFromVector(dir[0], dir[2])),
    pitch: Math.asin(Math.min(Math.max(dir[1], -1), 1)),
  };
}

/**
 * A scenario with every `aimAtStandIn` marker turned into real arguments.
 *
 * An event whose angles cannot be worked out still fires, aiming straight
 * ahead and level, and the reason goes in `notes`. Dropping the call-in would
 * leave the preview showing a unit that never aims, which reads as the
 * script's fault rather than as the preview's.
 */
export function resolveScenario(
  scenario: Scenario,
  ctx: AimContext,
): ResolvedScenario {
  const notes: string[] = [];
  const track = scenario.standIn;

  const events = scenario.events.map((event) => {
    if (event.dropAtStandIn) return putDown(event, track, ctx.radius, notes);

    const marker = event.aimAtStandIn;
    if (!marker) return event;
    const { aimAtStandIn: _marker, ...rest } = event;

    const target = track ? standInMid(track, event.frame, ctx.radius) : null;
    if (!target) {
      notes.push(
        `${event.callin} aims at a stand-in, and this scenario places no stand-in on frame ${event.frame}. It is aimed straight ahead instead.`,
      );
      return { ...rest, args: [0, 0] };
    }

    if (marker.from === "midPos") {
      const { heading, pitch } = startBuildingAngles(ctx.mid, target);
      return { ...rest, args: [heading, pitch] };
    }

    // `AimFromWeapon1` rather than `AimFromWeapon`: the marker names the
    // engine's concept, the probe asks for the weapon the scenario drives, and
    // every scenario here drives weapon 1.
    const callin = "AimFromWeapon1";
    const piece = ctx.probed(callin);
    const from = piece ? ctx.pieceRest.get(piece) : undefined;
    if (!from) {
      notes.push(
        `This script names no ${callin} piece, so the aim is measured from the unit's origin rather than from where its weapon sits.`,
      );
    }
    const { heading, pitch } = aimWeaponAngles(from ?? [0, 0, 0], target);
    return { ...rest, args: [heading, pitch] };
  });

  return { events, notes };
}

/** `TransportDrop`'s Lua arguments for a `dropAtStandIn` marker. */
function putDown(
  event: ScriptEvent,
  track: StandInTrack | undefined,
  radius: number,
  notes: string[],
): ScriptEvent {
  const { dropAtStandIn: marker, ...rest } = event;
  const pose = track && marker ? standInAt(track, marker.frame, radius) : null;
  if (!pose) {
    notes.push(
      `${event.callin} puts the stand-in down where it stood on frame ${marker?.frame}, and this scenario places no stand-in then. It is put down at the unit's origin instead.`,
    );
    return { ...rest, args: [STAND_IN_UNIT_ID, 0, 0, 0] };
  }
  return { ...rest, args: [STAND_IN_UNIT_ID, ...pose.pos] };
}

/** What the scene resolver needs to know about the unit and its script. */
export interface WorldContext {
  /** The stand-in's radius beside this unit, in elmos. */
  radius: number;
  /** The unit's own size, as its exported header would carry it. */
  self: { radius: number; height: number };
  /** Where the piece a call-in names rests, or null when the script names
   *  none or cannot be asked. */
  attachPiece: (from: StandInAttach["from"]) => Vec3 | null;
}

/**
 * The scene on one frame, as a script asking about it is told.
 *
 * A stand-in on a build piece is where that piece rests. Rest rather than
 * animated, for the reason the aim is measured from rest: the answer has to
 * exist before the run.
 */
export function worldAt(
  track: StandInTrack | null,
  frame: number,
  ctx: WorldContext,
  /** The scenario's own `factory-build` event frame, for an attach with no
   *  `frame` of its own. `withWorld` reads this out of the events once,
   *  rather than every call working it out itself. */
  buildStart?: number,
): ScriptWorld {
  if (!track) return { standIn: null, self: ctx.self };
  const base = {
    id: STAND_IN_UNIT_ID,
    radius: ctx.radius,
    height: standInHeight(ctx.radius),
  };

  const attach = attachedAt(track, frame);

  // An attach with no `frame` is the preview's own factory scenario, whose
  // real start is the run's own `build-start`, unknowable before the run
  // happens. This world is built before the run, so it takes the scenario's
  // own `factory-build` event frame instead: before it the buildee does not
  // exist yet, so there is nothing to report, and its rest position stands in
  // for where the run will carry it from that frame on.
  if (attach && attach.frame === undefined) {
    if (buildStart === undefined || frame < buildStart) {
      // The buildee does not exist before `factory-build`, so there is no
      // stand-in to report at all, not one with nowhere to stand.
      return { standIn: null, self: ctx.self };
    }
    const resting = ctx.attachPiece(attach.from);
    if (resting) return { standIn: { ...base, pos: resting }, self: ctx.self };
  }

  // A factory's stand-in sits on its build piece from the frame after the
  // attach. The rule came from the air arm, which attaches in the runtime
  // now, and is kept for the factory rather than changed in passing
  // (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453`).
  const riding =
    attach && attach.frame !== undefined && frame > attach.frame
      ? ctx.attachPiece(attach.from)
      : null;
  if (riding) return { standIn: { ...base, pos: riding }, self: ctx.self };

  const pose = standInAt(track, frame, ctx.radius);
  if (!pose) return { standIn: { ...base, pos: null }, self: ctx.self };
  return { standIn: { ...base, pos: pose.pos }, self: ctx.self };
}

/** Every event with the scene on its own frame. */
export function withWorld(
  events: ScriptEvent[],
  track: StandInTrack | null,
  ctx: WorldContext,
): ScriptEvent[] {
  const buildStart = events.find((e) => e.engine === "factory-build")?.frame;
  return events.map((event) => ({
    ...event,
    world: worldAt(track, event.frame, ctx, buildStart),
  }));
}

/**
 * The unit direction `AimWeapon`'s heading and pitch point along, which is
 * the inverse of `aimWeaponAngles` and the engine's `wantedDir`.
 */
export function aimDirection(heading: number, pitch: number): Vec3 {
  return [
    Math.cos(pitch) * Math.sin(heading),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(heading),
  ];
}

/** Where a resolved `AimWeapon` aimed, and when. */
export interface Aim {
  frame: number;
  dir: Vec3;
}

/** Every resolved `AimWeapon<n>` in a run's events, in order. A muzzle flame
 *  faces the latest one (`Weapon.cpp:509-510`). */
export function aimsOf(events: ScriptEvent[]): Aim[] {
  const aims: Aim[] = [];
  for (const event of events) {
    const [heading, pitch] = event.args ?? [];
    if (!/^AimWeapon\d+$/.test(event.callin ?? "")) continue;
    if (typeof heading !== "number" || typeof pitch !== "number") continue;
    aims.push({ frame: event.frame, dir: aimDirection(heading, pitch) });
  }
  return aims;
}

/**
 * `GetHeadingFromVectorF` in `rts/System/SpringMath.inl:38-62`.
 *
 * That function is a polynomial approximation of `atan2(dx, dz)`, written for
 * a simulation that has to give bit-identical answers on every machine in the
 * game. A preview has no such obligation and wants the accurate answer, so
 * this is the function the engine's version approximates rather than a copy of
 * the approximation.
 */
function headingFromVector(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** `ClampRadPi` in `rts/System/SpringMath.inl:171-182`: an angle brought into
 *  -PI..PI. */
function clampRadPi(angle: number): number {
  const wrapped = angle - Math.PI * 2 * Math.floor(angle / (Math.PI * 2));
  return wrapped >= Math.PI ? wrapped - Math.PI * 2 : wrapped;
}

/** A direction, or straight ahead when the two points are the same and there
 *  is no direction to have. */
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 1];
  return [v[0] / length, v[1] / length, v[2] / length];
}
