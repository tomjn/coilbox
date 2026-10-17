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

import { type DriveFrame, headingRadians, scriptDrive } from "./drive";
import type { GroundShape } from "./environment";
import {
  type Scenario,
  type ScriptEvent,
  type ScriptGround,
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
  /** The shape of the ground the stand-in stands on, absent or null for flat
   *  ground at 0. */
  ground?: GroundShape | null;
  /** Which way is up for the unit on that ground, from `unitUp`, or absent or
   *  null for a unit that stands level. The unit tilts only while it plays, and
   *  an upright unit stays level, so this is null for both. */
  up?: Vec3 | null;
  /** The unit's pose on each frame of a drive, for a scenario that aims while
   *  the unit drives. Where it is and which way it faces move the weapon's
   *  piece and turn the axes the angles are measured against, and its `up`
   *  replaces `up` above, because it changes as the unit moves. Absent or null
   *  for a unit that stays at the origin. */
  drive?: DriveFrame[] | null;
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
 * the ground under it. That ground is `ground`, which the stand-in stands on at
 * its own position.
 */
export function standInMid(
  track: StandInTrack,
  frame: number,
  radius: number,
  ground?: GroundShape | null,
): Vec3 | null {
  const pose = standInAt(track, frame, radius, ground);
  if (!pose) return null;
  return [pose.pos[0], pose.pos[1] + STAND_IN_MID_Y * radius, pose.pos[2]];
}

/**
 * The unit's own axes in the world, at heading zero.
 *
 * Level, that is the model's own: `frontdir` is `+z`, `updir` is `+y`, and
 * `rightdir` is `(-1,0,0)` (`rts/Sim/Objects/SolidObject.cpp:440` with
 * `GetVectorFromHeading(0)` being `(0,0,1)`). On a slope the engine turns all
 * three by the shortest rotation from `+y` to the ground's normal
 * (`SolidObject.cpp:442-450`), which is what the viewport does to the unit.
 * A driving unit is turned about straight up by its heading first, and the
 * tilt then turns that (`SolidObject.cpp:435-451`), so the heading is a turn
 * of the level axes before the tilt takes them.
 */
interface Basis {
  right: Vec3;
  up: Vec3;
  front: Vec3;
}

function basisOf(up?: Vec3 | null, heading = 0): Basis {
  const angle = headingRadians(heading);
  // `GetVectorFromHeading`, and `frontdir x updir` for the right.
  const level: Basis = {
    right: [-Math.cos(angle), 0, Math.sin(angle)],
    up: [0, 1, 0],
    front: [Math.sin(angle), 0, Math.cos(angle)],
  };
  if (!up) return level;
  // `CQuaternion quat(uDir.z, 0, -uDir.x, 1 + uDir.y)`, normalised: x, y, z, w.
  const length = Math.hypot(up[2], up[0], 1 + up[1]);
  const q = [up[2] / length, 0, -up[0] / length, (1 + up[1]) / length];
  return {
    right: rotate(q, level.right),
    up,
    front: rotate(q, level.front),
  };
}

/** A vector turned by the unit quaternion `q` (x, y, z, w). */
function rotate(q: number[], v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  // v + 2w(u x v) + 2 u x (u x v), with u the quaternion's xyz.
  const cx = qy * v[2] - qz * v[1];
  const cy = qz * v[0] - qx * v[2];
  const cz = qx * v[1] - qy * v[0];
  const dx = qy * cz - qz * cy;
  const dy = qz * cx - qx * cz;
  const dz = qx * cy - qy * cx;
  return [
    v[0] + 2 * (qw * cx + dx),
    v[1] + 2 * (qw * cy + dy),
    v[2] + 2 * (qw * cz + dz),
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The heading and pitch `AimWeapon` is handed, from a piece to a target.
 *
 * `rts/Sim/Weapons/Weapon.cpp:410-424`, written out rather than reduced so it
 * can be read against the engine line for line. `from` is the piece in unit
 * space and `to` is in the world, so a tilted unit's piece is turned with it
 * first. `up` is the unit's up on a slope, absent for a level unit. `placed`
 * is where a driving unit stands and which way it faces, absent for a unit at
 * the origin facing +z. The piece is measured from where it is in the world
 * (`Weapon.cpp:410-424`), so the unit's position moves it, and the heading
 * turns the axes the direction is projected onto.
 */
export function aimWeaponAngles(
  from: Vec3,
  to: Vec3,
  up?: Vec3 | null,
  placed?: { pos: Vec3; heading: number } | null,
): { heading: number; pitch: number } {
  const basis = basisOf(up, placed?.heading);
  const turned = up || placed ? toWorld(from, basis) : from;
  const at: Vec3 = placed
    ? [
        turned[0] + placed.pos[0],
        turned[1] + placed.pos[1],
        turned[2] + placed.pos[2],
      ]
    : turned;
  const dir = normalize([to[0] - at[0], to[1] - at[1], to[2] - at[2]]);

  const localX = dot(dir, basis.right);
  const localY = dot(dir, basis.up);
  const localZ = dot(dir, basis.front);

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
 * `rts/Sim/Units/UnitTypes/Builder.cpp:942-955`. The unit's own heading is
 * zero in the editor, so that term is left out rather than written as `- 0`.
 * The heading is the world's, not the tilted unit's. The pitch is against
 * `updir`, less `asin(frontdir·updir)`, which is zero for a unit whose axes
 * are at right angles, as they are on any ground. `mid` is in unit space and
 * is turned with a tilted unit first.
 */
export function startBuildingAngles(
  mid: Vec3,
  to: Vec3,
  up?: Vec3 | null,
): { heading: number; pitch: number } {
  const basis = basisOf(up);
  const at = up ? toWorld(mid, basis) : mid;
  const dir = normalize([to[0] - at[0], to[1] - at[1], to[2] - at[2]]);
  const p = Math.asin(Math.min(Math.max(dot(dir, basis.up), -1), 1));
  const pitch = Math.asin(
    Math.min(Math.max(dot(basis.front, basis.up), -1), 1),
  );
  return {
    heading: clampRadPi(headingFromVector(dir[0], dir[2])),
    pitch: p - pitch,
  };
}

/** A point in unit space, where the tilted unit puts it in the world. The unit
 *  stands at the origin, so this is only the turn. */
function toWorld(v: Vec3, { right, up, front }: Basis): Vec3 {
  // The model's x is the unit's left, which is `-rightdir`.
  return [
    -v[0] * right[0] + v[1] * up[0] + v[2] * front[0],
    -v[0] * right[1] + v[1] * up[1] + v[2] * front[1],
    -v[0] * right[2] + v[1] * up[2] + v[2] * front[2],
  ];
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

  let series = false;
  const events = scenario.events.flatMap((event): ScriptEvent[] => {
    if (event.dropAtStandIn)
      return [putDown(event, track, ctx.radius, ctx.ground, notes)];

    const marker = event.aimAtStandIn;
    if (!marker) return [event];
    const { aimAtStandIn: _marker, ...rest } = event;

    const target = track
      ? standInMid(track, event.frame, ctx.radius, ctx.ground)
      : null;
    if (!track || !target) {
      notes.push(
        `${event.callin} aims at a stand-in, and this scenario places no stand-in on frame ${event.frame}. It is aimed straight ahead instead.`,
      );
      return [{ ...rest, args: [0, 0] }];
    }

    const angles = anglesFor(event, marker.from, ctx, notes);
    if (marker.until === undefined) {
      const { heading, pitch } = angles(target, event.frame);
      return [{ ...rest, args: [heading, pitch] }];
    }
    series = true;
    return keptAiming(rest, marker.until, track, ctx, angles);
  });

  // A re-aim can fire many times in one scenario, and each miss produces the
  // same wording. Dedupe so the panel shows each distinct note once rather
  // than one row per event, which also keeps AnimationPanel's `key={note}`
  // list free of duplicate keys.
  return {
    // Only a series is out of order. Every other scenario keeps the order it
    // was written in, which for two events on one frame is the order they
    // fire in.
    events: series ? events.sort(byFrameAimFirst) : events,
    notes: [...new Set(notes)],
  };
}

/** Frame order, with an aim landing before a fire on the same frame, since a
 *  script fires after it has turned to face the target rather than before. */
function byFrameAimFirst(a: ScriptEvent, b: ScriptEvent): number {
  return a.frame - b.frame || Number(!a.callin) - Number(!b.callin);
}

type Angles = (
  target: Vec3,
  frame: number,
) => { heading: number; pitch: number };

/** The unit's pose on `frame` of a drive, the last one past its end, or null
 *  for a unit that does not drive. */
function poseAt(ctx: AimContext, frame: number): DriveFrame | null {
  const frames = ctx.drive;
  if (!frames || frames.length === 0) return null;
  return frames[Math.min(Math.max(frame, 0), frames.length - 1)];
}

/** The formula an aiming event's call-in is handed its angles by. */
function anglesFor(
  event: ScriptEvent,
  from: "AimFromWeapon" | "midPos",
  ctx: AimContext,
  notes: string[],
): Angles {
  if (from === "midPos")
    return (target) => startBuildingAngles(ctx.mid, target, ctx.up);

  // `AimFromWeapon<n>` rather than `AimFromWeapon`: the marker names the
  // engine's concept, and the probe was asked for the weapon this event's
  // own `AimWeapon<n>` drives, `expandForWeapons` having already given each
  // weapon its own copy of the event.
  const callin = `AimFromWeapon${weaponNumberOf(event.callin)}`;
  const piece = ctx.probed(callin);
  const at = piece ? ctx.pieceRest.get(piece) : undefined;
  if (!at) {
    notes.push(
      `This script names no ${callin} piece, so the aim is measured from the unit's origin rather than from where its weapon sits.`,
    );
  }
  return (target, frame) => {
    const pose = poseAt(ctx, frame);
    return aimWeaponAngles(
      at ?? [0, 0, 0],
      target,
      pose ? pose.up : ctx.up,
      pose,
    );
  };
}

/**
 * How often the engine calls a weapon's aiming script while it keeps a target.
 * `CWeapon::UpdateAim` calls `CallAimingScript` on every frame it has one
 * (`Weapon.cpp:352-357`), and `CanCallAimingScript` lets the call through once
 * `reaimTime` frames have passed since the last (`Weapon.cpp:380`).
 * `reaimTime` is `GAME_SPEED >> 1`, 15 frames, for every weapon type
 * (`Weapon.cpp:137`). Only Lua changes it, through `SetUnitWeaponState`.
 */
const REAIM_INTERVAL_FRAMES = 15;

/**
 * It also lets the call through as soon as the wanted direction is 20 degrees
 * or more from the one last asked for: `maxAimOffset` is a fixed
 * `cos(20 degrees)`, and `maxFireAngle` is the weapon's `firetolerance`, which
 * defaults to 3640, also 20 degrees (`Weapon.cpp:376-383`, `WeaponDef.cpp:113`).
 * The preview reads no weapon definition, so it has the default.
 */
const REAIM_TURN_COS = Math.cos((20 * Math.PI) / 180);

/** An aiming call-in on every frame from `event`'s to `until` that the
 *  engine would call it, for a weapon that keeps the stand-in as its target. */
function keptAiming(
  event: ScriptEvent,
  until: number,
  track: StandInTrack,
  ctx: AimContext,
  angles: Angles,
): ScriptEvent[] {
  const aims: ScriptEvent[] = [];
  let last: { frame: number; dir: Vec3 } | null = null;
  for (let frame = event.frame; frame <= until; frame++) {
    const target = standInMid(track, frame, ctx.radius, ctx.ground);
    if (!target) continue;
    const { heading, pitch } = angles(target, frame);
    // In the world, because the engine checks the wanted direction there
    // (`Weapon.cpp:376-383`). A unit that stays put turns both directions the
    // same way, so the angle between them is the same in its own frame. A
    // driving unit turns between frames, so its own frame would not do.
    const dir = worldAim(heading, pitch, poseAt(ctx, frame));
    if (
      last &&
      frame < last.frame + REAIM_INTERVAL_FRAMES &&
      dot(dir, last.dir) > REAIM_TURN_COS
    )
      continue;
    aims.push({ ...event, frame, args: [heading, pitch] });
    last = { frame, dir };
  }
  return aims;
}

/** `TransportDrop`'s Lua arguments for a `dropAtStandIn` marker. */
function putDown(
  event: ScriptEvent,
  track: StandInTrack | undefined,
  radius: number,
  ground: GroundShape | null | undefined,
  notes: string[],
): ScriptEvent {
  const { dropAtStandIn: marker, ...rest } = event;
  const pose =
    track && marker ? standInAt(track, marker.frame, radius, ground) : null;
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
  /** The ground the viewport draws, absent or null for flat ground. The same
   *  on every frame, because nothing in a run moves the ground. */
  ground?: ScriptGround | null;
  /** The unit's own path, for a scenario that drives it: where it is on each
   *  frame and its top speed, in elmos a frame. On a shaped ground its up
   *  comes from the frame rather than from `ground`, because it changes as
   *  the unit moves over it. */
  drive?: { frames: DriveFrame[]; maxSpeed: number } | null;
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

  const pose = standInAt(track, frame, ctx.radius, ctx.ground?.shape);
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
  return events.map((event) => {
    const driven = ctx.drive?.frames[event.frame];
    const ground =
      ctx.ground && driven ? { ...ctx.ground, up: driven.up } : ctx.ground;
    return {
      ...event,
      world: {
        ...worldAt(track, event.frame, ctx, buildStart),
        ...(ground ? { ground } : {}),
        ...(ctx.drive && driven
          ? { drive: scriptDrive(driven, ctx.drive.maxSpeed) }
          : {}),
      },
    };
  });
}

/** An aim in the world for a unit standing as `pose` has it, or as it is for
 *  a unit with no pose. */
function worldAim(heading: number, pitch: number, pose: DriveFrame | null) {
  const dir = aimDirection(heading, pitch);
  return pose ? toWorld(dir, basisOf(pose.up, pose.heading)) : dir;
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
 *  faces the latest one (`Weapon.cpp:509-510`). `drive` is the unit's pose on
 *  each frame when it drives, which turns each aim into the world's, where a
 *  flame is drawn. */
export function aimsOf(
  events: ScriptEvent[],
  drive?: DriveFrame[] | null,
): Aim[] {
  const aims: Aim[] = [];
  for (const event of events) {
    const [heading, pitch] = event.args ?? [];
    if (!/^AimWeapon\d+$/.test(event.callin ?? "")) continue;
    if (typeof heading !== "number" || typeof pitch !== "number") continue;
    const pose = drive?.length
      ? drive[Math.min(Math.max(event.frame, 0), drive.length - 1)]
      : null;
    aims.push({ frame: event.frame, dir: worldAim(heading, pitch, pose) });
  }
  return aims;
}

/** The weapon number an `AimWeapon<n>` call-in names, or 1 for anything else,
 *  which is every scenario's own convention before it drives more than one
 *  weapon. */
function weaponNumberOf(callin: string | undefined): number {
  const match = /^AimWeapon(\d+)$/.exec(callin ?? "");
  return match ? Number(match[1]) : 1;
}

/** The Recoil ordinal names a unit script may still define instead of a
 *  numbered call-in, one per call-in stem: `QueryPrimary`, `AimPrimary`,
 *  `AimFromPrimary`, `FirePrimary`, and the `Secondary` and `Tertiary` forms
 *  of each (`CobScriptNames.cpp:79-90`, aliased back the same way by
 *  `alias()` in `crates/tauri-plugin-coilbox-anim/src/cobrun.rs`). Only the
 *  first three weapons ever had these names. */
const ORDINAL_WEAPON_CALLIN =
  /^(?:Query|Aim|AimFrom|Fire)(Primary|Secondary|Tertiary)$/;

/** The weapon slot each ordinal above means. */
const ORDINAL_WEAPON_NUMBERS: Record<string, number> = {
  Primary: 1,
  Secondary: 2,
  Tertiary: 3,
};

/**
 * How many weapons the firing scenario should drive.
 *
 * A unit definition's own `weapons` table is definitive when there is one:
 * the highest numbered slot it fills, `weapons` being keyed `"1"`, `"2"` and
 * so on. Without a definition, the script's own numbered weapon functions are
 * the next best answer, since a script defining `AimWeapon3` has a third
 * weapon whether or not its definition is known here. A script with only
 * plain call-ins and no definition to count from gets one weapon, which is
 * what every scenario drove before this.
 */
export function weaponCount(
  unitDef: Record<string, unknown> | null | undefined,
  functions: string[],
): number {
  if (unitDef) return weaponCountFromDef(unitDef) ?? 1;
  return weaponCountFromFunctions(functions);
}

/** `MAX_WEAPONS_PER_UNIT`, `rts/Sim/Misc/GlobalConstants.h:126`: the engine
 *  never reads a unit def's `weapons` table past this many slots. */
const MAX_WEAPONS_PER_UNIT = 32;

/** The name a `weapons` table slot gives its weapon, empty when the slot
 *  names none: the entry is either the weapon's own name as a string, or a
 *  table naming it in `name` (`UnitDef.cpp:749-758`). */
function weaponEntryName(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const name = (entry as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/**
 * `UnitDef::ParseWeaponsTable` (`UnitDef.cpp:749-771`): the table is read
 * slot by slot from 1. An empty slot is tolerated, and skipped over, only
 * among the first four (`w <= 3`). An empty slot after that stops the table
 * being read at all, so a weapon named past that point is never seen. This
 * assumes any named slot resolves to a real `WeaponDef`, which is the best a
 * preview with no weapon-def table to check against can do.
 */
function weaponCountFromDef(unitDef: Record<string, unknown>): number | null {
  const weapons = unitDef.weapons;
  if (!weapons || typeof weapons !== "object") return null;
  const table = weapons as Record<string, unknown>;
  const entryAt = (slot: number): unknown =>
    Array.isArray(weapons) ? weapons[slot] : table[String(slot + 1)];
  let highest = 0;
  for (let slot = 0; slot < MAX_WEAPONS_PER_UNIT; slot++) {
    if (weaponEntryName(entryAt(slot))) {
      highest = slot + 1;
      continue;
    }
    if (slot > 3) break;
  }
  return highest > 0 ? highest : null;
}

function weaponCountFromFunctions(functions: string[]): number {
  let highest = 0;
  for (const name of functions) {
    const numbered = /^(?:AimWeapon|FireWeapon|QueryWeapon)(\d+)$/.exec(name);
    if (numbered) highest = Math.max(highest, Number(numbered[1]));
    const ordinal = ORDINAL_WEAPON_CALLIN.exec(name);
    if (ordinal)
      highest = Math.max(highest, ORDINAL_WEAPON_NUMBERS[ordinal[1]]);
  }
  return highest || 1;
}

/**
 * A scenario's events with every weapon 1 aim and shot matched by one for
 * every other weapon the unit has.
 *
 * An `AimWeapon1` event gets a same-frame `AimWeapon<n>` for each other
 * weapon, which `resolveScenario` then measures from that weapon's own
 * `AimFromWeapon<n>` piece. A weapon 1 `fire` engine event gets one for each
 * other weapon too, spread evenly across the gap to weapon 1's next shot
 * rather than trailing past it: weapon `n` fires
 * `floor((n - 1) * intervalFrames / weapons)` frames later in the same
 * volley, so the shots read apart without the last weapon overlapping the
 * next round.
 *
 * A no-op below two weapons: nothing here duplicates when there is only the
 * one to drive.
 */
export function expandForWeapons(
  events: ScriptEvent[],
  weapons: number,
  intervalFrames: number,
): ScriptEvent[] {
  if (weapons <= 1) return events;
  const expanded: ScriptEvent[] = [];
  for (const event of events) {
    expanded.push(event);
    if (event.callin === "AimWeapon1") {
      for (let weapon = 2; weapon <= weapons; weapon++) {
        expanded.push({ ...event, callin: `AimWeapon${weapon}` });
      }
      continue;
    }
    if (event.engine === "fire" && (event.args?.[0] ?? 1) === 1) {
      for (let weapon = 2; weapon <= weapons; weapon++) {
        expanded.push({
          ...event,
          frame:
            event.frame + Math.floor(((weapon - 1) * intervalFrames) / weapons),
          args: [weapon],
        });
      }
    }
  }
  // Frame order, with an aim landing before a fire on the same frame, the
  // same tie-break `aimedFire` uses when it first builds the firing
  // scenario's events.
  return expanded.sort(
    (a, b) => a.frame - b.frame || Number(!a.callin) - Number(!b.callin),
  );
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
