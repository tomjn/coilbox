/**
 * Driving the unit along a path in the preview (issue #3324).
 *
 * The unit steers the way a ground unit does in the engine: every frame it
 * wants to face the next waypoint, turns towards it no faster than its turn
 * rate allows, then moves along the way it now faces. So it does not follow
 * the path exactly. It cuts corners and swings wide on a tight bend, the same
 * as in a game, and what its script is told is what made it do that.
 *
 * Pure: a path and the unit's motion go in, a frame by frame record of where
 * the unit is and the call-ins the engine would fire come out. The viewport
 * plays the record and the runtimes are told about it, so the two agree.
 *
 * It slows for a turn the way the engine does, so it can make one. Its speed
 * ramps as the engine's does (issue #4288): each frame it moves towards the
 * speed it wants by no more than the unit's `maxAcc` when speeding up and
 * `maxDec` when slowing (`GMTDefaultPathController::GetDeltaSpeed`,
 * `IPathController.cpp:6-38`), and the wanted speed drops to nothing once the
 * goal is within the unit's braking distance (`GroundMoveType.cpp:1324,1333`).
 *
 * A unit with a reverse speed backs up when the engine would (issue #4156).
 * The engine reverses a unit only when its definition has `rSpeed` above 0
 * (`GroundMoveType.cpp:501`), and then only when `WantReverse` finds backing up
 * to the goal quicker than turning round, which `wantsReverse` ports. `StartMoving`
 * is told which way the unit sets off.
 */

import {
  unitAccelerationOf,
  unitBrakeRateOf,
  unitReverseSpeedOf,
  unitSpeedOf,
  unitTurnRateOf,
} from "@/workshop/moveClasses";
import {
  type Flight,
  flightOf,
  hoverBankStep,
  strafeRollStep,
} from "./banking";
import { type GroundShape, groundHeight, groundNormal } from "./environment";
import type { LegoProject } from "./model";
import type { ScriptDrive, ScriptEvent } from "./scriptPlayback";

type Vec3 = [number, number, number];
type Vec2 = [number, number];

/** `SPRING_MAX_HEADING` and `SPRING_CIRCLE_DIVS`, `rts/System/SpringMath.h:16-17`. */
const MAX_HEADING = 32768;
const CIRCLE_DIVS = MAX_HEADING * 2;

/**
 * The engine's own `minScriptChangeHeading`, `(SPRING_CIRCLE_DIVS - 1) >> 1`
 * (`GroundMoveType.cpp:498`). A turn rate is clamped to the same number
 * (`GroundMoveType.cpp:518`), so no frame ever turns that far and an
 * unchanged unit's script is never sent `ChangeHeading`. A game lowers it with
 * `Spring.MoveCtrl.SetGroundMoveTypeData`.
 */
export const ENGINE_MIN_SCRIPT_CHANGE_HEADING = (CIRCLE_DIVS - 1) >> 1;

/** `SQUARE_SIZE`, `rts/Sim/Misc/GlobalConstants.h:24`. */
const SQUARE_SIZE = 8;

/** How near a waypoint counts as reached, before the unit heads for the next:
 *  `std::max(WAYPOINT_RADIUS, currentSpeed * 1.05f)`, with `WAYPOINT_RADIUS`
 *  1.25 squares (`GroundMoveType.cpp:94,2259`). */
const WAYPOINT_RADIUS = 1.25 * SQUARE_SIZE;

/** A move order's goal radius, `SQUARE_SIZE` (`MobileCAI.h:25`). The unit
 *  has arrived inside it (`GroundMoveType.cpp:929`). */
const GOAL_RADIUS = SQUARE_SIZE;

/** How fast a ground unit's turn speeds up, as a share of its turn rate:
 *  `turnRate * mix(0.333f, 0.033f, isShip)` (`GroundMoveType.cpp:519`). The
 *  preview does not know a class's kind, so every unit turns as a vehicle. */
const TURN_ACCEL_SHARE = 0.333;

/** The least share of its top speed a turn slows a unit to
 *  (`GroundMoveType.cpp:1340`). */
const LEAST_TURN_SPEED = 0.1;

/** The frames a second, `GAME_SPEED`. */
const GAME_SPEED = 30;

/** `maxAcc` for a unit that states none, `UnitDef.cpp:455`. The brake rate
 *  defaults to the acceleration (`UnitDef.cpp:459`). */
const DEFAULT_ACCELERATION = 0.5;

/** The least `accRate` and `decRate` the move type holds
 *  (`GroundMoveType.cpp:523-524`). */
const LEAST_RATE = 0.01;

/** The unit's `accRate` and `decRate`, elmos a frame squared. A unit that
 *  states no brake rate brakes at its acceleration (`UnitDef.cpp:459`). */
export function rates(motion: DriveMotion): {
  accRate: number;
  decRate: number;
} {
  const accRate = Math.max(
    LEAST_RATE,
    motion.acceleration ?? DEFAULT_ACCELERATION,
  );
  const decRate = Math.max(
    LEAST_RATE,
    motion.brakeRate ?? motion.acceleration ?? DEFAULT_ACCELERATION,
  );
  return { accRate, decRate };
}

/** How fast the unit goes and turns, in the units the engine holds them in. */
export interface DriveMotion {
  /** Elmos a frame. */
  speed: number;
  /** Heading units a frame, already clamped as `GroundMoveType.cpp:518` does. */
  turnRate: number;
  /** Elmos a frame it backs up at, the engine's `maxReverseSpeed`. Absent or 0
   *  for a unit that cannot reverse. */
  reverseSpeed?: number;
  /** Elmos a frame squared it speeds up by, only used to decide whether to
   *  reverse. Absent means the engine's 0.5. */
  acceleration?: number;
  /** Elmos a frame squared it slows by. Absent means the acceleration. */
  brakeRate?: number;
  /** Set for a flier, which the engine banks (`banking.ts`). Absent for every
   *  other unit, whose frames then carry no `bank`. */
  flight?: Flight;
}

/** Where `DriveMotion`'s two numbers came from, for the panel to say. */
export interface DriveSource {
  motion: DriveMotion;
  speed: "movement" | "definition" | "preview";
  turnRate: "movement" | "definition" | "none";
  reverseSpeed: "movement" | "definition" | "none";
}

/**
 * The speed and turn rate the next export would write, from the unit's
 * movement section, or the game's own definition for a unit read out of one.
 *
 * A unit with no speed moves at the preview's one elmo a frame, the same speed
 * every other scenario tells a script it moves at. A unit with no turn rate
 * turns at the engine's floor of one heading unit a frame, because that is
 * what the engine does with a definition that sets none (`UnitDef.cpp:525`,
 * clamped up to 1 at `GroundMoveType.cpp:518`).
 */
export function driveMotion(project: LegoProject): DriveSource {
  const def = project.gameUnitDef ?? undefined;
  const ownSpeed = project.movement?.speed;
  const defSpeed = def ? unitSpeedOf(def) : 0;
  const speed =
    typeof ownSpeed === "number" && ownSpeed > 0
      ? { value: ownSpeed / GAME_SPEED, from: "movement" as const }
      : defSpeed > 0
        ? { value: defSpeed / GAME_SPEED, from: "definition" as const }
        : { value: 1, from: "preview" as const };

  const ownTurn = project.movement?.turnRate;
  const defTurn = def ? unitTurnRateOf(def) : undefined;
  const turn =
    typeof ownTurn === "number"
      ? { value: ownTurn, from: "movement" as const }
      : typeof defTurn === "number"
        ? { value: defTurn, from: "definition" as const }
        : { value: 0, from: "none" as const };

  const ownReverse = project.movement?.reverseSpeed;
  const defReverse = def ? unitReverseSpeedOf(def) : 0;
  const reverse =
    typeof ownReverse === "number" && ownReverse > 0
      ? { value: ownReverse / GAME_SPEED, from: "movement" as const }
      : defReverse > 0
        ? { value: defReverse / GAME_SPEED, from: "definition" as const }
        : { value: 0, from: "none" as const };

  const acceleration =
    project.movement?.acceleration ??
    (def ? unitAccelerationOf(def) : undefined);
  const brakeRate =
    project.movement?.brakeRate ?? (def ? unitBrakeRateOf(def) : undefined);

  const flight = flightOf(project.movement);
  return {
    motion: {
      speed: speed.value,
      ...(flight ? { flight } : {}),
      ...(acceleration !== undefined ? { acceleration } : {}),
      ...(brakeRate !== undefined ? { brakeRate } : {}),
      turnRate: Math.min(Math.max(turn.value, 1), MAX_HEADING - 1),
      ...(reverse.value > 0 ? { reverseSpeed: reverse.value } : {}),
    },
    speed: speed.from,
    turnRate: turn.from,
    reverseSpeed: reverse.from,
  };
}

export type DrivePath = "straight" | "bend" | "circle" | "behind" | "own";

export const DRIVE_PATHS: { value: DrivePath; label: string }[] = [
  { value: "straight", label: "Straight ahead" },
  { value: "bend", label: "Turning right" },
  { value: "circle", label: "A circle to the left" },
  { value: "behind", label: "Behind the unit" },
  { value: "own", label: "Your own path" },
];

/** Points on the circle. Close enough together that heading for the next one
 *  is a smaller turn than a frame's at any usual turn rate, so the unit does
 *  not slow down at every point as it would at a corner. */
const CIRCLE_POINTS = 128;

/**
 * The waypoints of a path, x and z in elmos from where the unit starts, which
 * is the origin facing +z.
 *
 * The fixed paths are measured in how far the unit goes in a second, so every
 * unit takes the same time over them and finishes inside the preview's 15
 * seconds: 8 seconds straight on, 4 and 4 either side of a right turn, and a
 * circle about 12.6 seconds round, with its middle to the unit's left so it
 * sets off along it. `behind` is one second's travel straight back, near
 * enough that a unit with a reverse speed finds backing up quicker than
 * turning round. `own` is the points the game maker clicked, as they are.
 */
export function pathPoints(
  path: DrivePath,
  motion: DriveMotion,
  own: Vec2[],
): Vec2[] {
  const second = motion.speed * GAME_SPEED;
  if (path === "own") return own;
  if (path === "straight") return [[0, 8 * second]];
  if (path === "behind") return [[0, -second]];
  if (path === "bend") {
    // The unit's right is -x.
    return [
      [0, 4 * second],
      [-4 * second, 4 * second],
    ];
  }
  const radius = 2 * second;
  return Array.from({ length: CIRCLE_POINTS }, (_, index) => {
    const angle = ((index + 1) / CIRCLE_POINTS) * 2 * Math.PI;
    return [radius - radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

/**
 * How far from the origin a drive takes the base of the unit, in elmos. The
 * frames are included as well as the waypoints, because a unit swings wide of
 * a bend and the ground has to be there under that too.
 */
export function driveReach(path: Vec2[], frames: DriveFrame[]): number {
  let reach = 0;
  for (const [x, z] of path) reach = Math.max(reach, Math.hypot(x, z));
  for (const { pos } of frames)
    reach = Math.max(reach, Math.hypot(pos[0], pos[2]));
  return reach;
}

/** The unit on one frame of a drive. */
export interface DriveFrame {
  /** Its base, in elmos, on the ground. */
  pos: Vec3;
  /** The engine's `heading`: 65536 to a circle, 0 facing +z, positive to the
   *  unit's left. */
  heading: number;
  /** Elmos a frame it moved on this frame, 0 when it did not move. */
  speed: number;
  /** Whether it backs up, which stays as the engine's `reversing` does once it
   *  has stopped. */
  reversing: boolean;
  /** Which way is up for it, or null for a unit that stays upright. */
  up: Vec3 | null;
  /** How far the engine rolls a flier on this frame, radians about its front,
   *  positive to its right. Absent for a unit that is not a flier. */
  bank?: number;
}

export interface DriveRun {
  /** One per frame of the run. */
  frames: DriveFrame[];
  /** `StartMoving`, each `ChangeHeading` and `StopMoving`, in frame order. */
  events: ScriptEvent[];
  /** The frame it arrived, or null when it was still going at the end. */
  arrived: number | null;
}

export interface DriveOptions {
  /** The frame the move order is given, which is `StartMoving`'s. */
  start: number;
  /** How many frames to record. */
  frames: number;
  ground: GroundShape | null;
  /** Whether the unit turns to the ground under it, which a unit that is not
   *  `upright` does (`GroundMoveType.cpp` calls `UpdateDirVectors` with
   *  `!owner->upright && owner->IsOnGround()`). */
  tilts: boolean;
  /** The smallest turn in one frame that is sent as `ChangeHeading`. */
  minScriptChangeHeading: number;
}

/** A number as the engine's `short` holds it: truncated, then wrapped. */
function toShort(value: number): number {
  const whole = Math.trunc(value);
  return (
    ((((whole + MAX_HEADING) % CIRCLE_DIVS) + CIRCLE_DIVS) % CIRCLE_DIVS) -
    MAX_HEADING
  );
}

/** `Sign` in `rts/System/SpringMath.h:203`, which calls zero negative. */
function sign(value: number): number {
  return value > 0 ? 1 : -1;
}

/**
 * `GetHeadingFromVector`, `rts/System/SpringMath.inl:64-81`, over the exact
 * angle rather than the engine's polynomial approximation of it, for the
 * reason `headingFromVector` in `aimResolver.ts` gives.
 */
export function headingFromVector(dx: number, dz: number): number {
  let heading = Math.trunc((Math.atan2(dx, dz) * MAX_HEADING) / Math.PI);
  // Straight behind comes out of `atan2` as either PI or -PI. Taken as -PI,
  // so the modulo below does not turn it into straight ahead.
  if (heading >= MAX_HEADING) heading -= CIRCLE_DIVS;
  heading += heading === -MAX_HEADING ? 1 : 0;
  return heading % MAX_HEADING;
}

/** A heading in radians about +y, which is the same turn in three.js. */
export function headingRadians(heading: number): number {
  return (heading * Math.PI) / MAX_HEADING;
}

/**
 * How fast the unit goes while it turns towards `wanted`: slower the further
 * it has to turn, down to a tenth of its top speed, and on its last leg no
 * faster than lets it turn onto the goal rather than circle it
 * (`CGroundMoveType::ChangeSpeed`, `GroundMoveType.cpp:1332-1358`, for a unit
 * with the default `turnInPlace` and `turnInPlaceAngleLimit` of 0,
 * `UnitDef.cpp:526,531`). `toGo` is how far it is to the waypoint it heads
 * for.
 */
function turnSpeed(
  heading: number,
  wanted: number,
  motion: DriveMotion,
  last: boolean,
  toGo: number,
): number {
  const required = Math.abs((180 * toShort(heading - wanted)) / MAX_HEADING);
  if (required === 0) return motion.speed;
  const most = (motion.turnRate / CIRCLE_DIVS) * 360;
  let speed =
    motion.speed * Math.min(Math.max(most / required, LEAST_TURN_SPEED), 1);
  if (last) {
    const framesToTurn = CIRCLE_DIVS / motion.turnRate;
    speed = Math.min(speed, (toGo * Math.PI) / framesToTurn);
  }
  return speed;
}

/** `AMoveType::BrakingDistance`, `MoveType.h:80-84`. */
function brakingDistance(speed: number, rate: number): number {
  const time = speed / Math.max(rate, 0.001);
  return 0.5 * rate * time * time;
}

/**
 * One frame's turn, with the engine's turn inertia:
 * `GMTDefaultPathController::GetDeltaHeading`, `rts/Sim/Path/IPathController.cpp:66-94`,
 * which `MODEL_TURN_INERTIA` selects (`GroundMoveType.cpp:86,1444`). The turn
 * speed builds up by `turnAccel` a frame and eases off ahead of the wanted
 * heading, and it carries over from one frame to the next in `turn`.
 */
function turnDelta(
  wanted: number,
  heading: number,
  turnRate: number,
  turn: { speed: number },
): number {
  const accel = turnRate * TURN_ACCEL_SHARE;
  let speed = turn.speed;
  const braking = Math.abs(speed) >= accel ? 1 : 0;
  const stopAt = toShort(
    heading + brakingDistance(speed, accel) * sign(speed) * braking,
  );
  const delta = toShort(wanted - stopAt);
  const step = sign(delta) * Math.min(Math.abs(delta), accel);
  speed = braking === 0 ? step : speed + step;
  speed = Math.min(Math.max(speed, -turnRate), turnRate);
  turn.speed = speed;
  return toShort(speed);
}

/**
 * `CGroundMoveType::WantReverse`, `GroundMoveType.cpp:3616-3669`: whether
 * backing up to the goal would get a unit there sooner than turning round. It
 * compares how long each takes, the turn, the speeding up or slowing down it
 * needs and the run itself. A unit whose waypoint is ahead of it never reverses.
 *
 * The two per unit tunables `maxReverseDist` and `minReverseAngle` are left
 * out, since the builder writes neither and the engine ignores both at 0.
 */
function wantsReverse(
  waypointDir: Vec2,
  heading: number,
  goalDistance: number,
  currentSpeed: number,
  reversing: boolean,
  motion: DriveMotion,
): boolean {
  const maxReverseSpeed = motion.reverseSpeed ?? 0;
  if (maxReverseSpeed <= 0) return false;
  if (motion.speed <= 0) return true;
  if (motion.turnRate <= 0) return false;

  const angle = headingRadians(heading);
  const dot =
    waypointDir[0] * Math.sin(angle) + waypointDir[1] * Math.cos(angle);
  if (dot >= 0) return false;

  const goalForwardETA = goalDistance / motion.speed;
  const goalReverseETA = goalDistance / maxReverseSpeed;

  const turnDegrees =
    Math.acos(Math.min(Math.max(dot, -1), 0)) * (180 / Math.PI);
  const forwardTurn = (turnDegrees / 360) * CIRCLE_DIVS;
  const reverseTurn = MAX_HEADING - forwardTurn;

  // Units start accelerating before finishing the turn, so the engine takes
  // some off.
  const turnTimeMod = 5;
  const forwardTurnTime = Math.max(
    0,
    forwardTurn / motion.turnRate - turnTimeMod,
  );
  const reverseTurnTime = Math.max(
    0,
    reverseTurn / motion.turnRate - turnTimeMod,
  );

  const { accRate, decRate } = rates(motion);
  const forwardSpeedAfterTurn = Math.max(
    0,
    currentSpeed - 0.125 * (forwardTurnTime * decRate),
  );
  const reverseSpeedAfterTurn = Math.max(
    0,
    currentSpeed - 0.125 * (reverseTurnTime * decRate),
  );

  const forwardBrake = (reversing ? forwardSpeedAfterTurn : 0) / decRate;
  const reverseBrake = (reversing ? 0 : reverseSpeedAfterTurn) / decRate;
  const forwardAccelerate =
    (motion.speed - (reversing ? 0 : forwardSpeedAfterTurn)) / accRate;
  const reverseAccelerate =
    (maxReverseSpeed - (reversing ? reverseSpeedAfterTurn : 0)) / accRate;

  const forwardETA =
    goalForwardETA + forwardTurnTime + forwardAccelerate + forwardBrake;
  const reverseETA =
    goalReverseETA + reverseTurnTime + reverseBrake + reverseAccelerate;
  return forwardETA > reverseETA;
}

/**
 * Drive the unit through `points`, starting at the origin facing +z.
 *
 * The order on each frame is the engine's: the speed is set for the turn the
 * unit wants, `CGroundMoveType::ChangeHeading` calls the script's
 * `ChangeHeading` with the frame's turn before it turns the unit
 * (`GroundMoveType.cpp:1427-1454`), and the unit then moves along the way it
 * faces. `StartMoving` is the frame the order is given and the unit moves
 * from the frame after. `StopMoving` is the frame it arrives, inside the goal
 * radius, and it does not move on that frame (`GroundMoveType.cpp:2436,2455`).
 *
 * A reversing unit turns to put its back to the waypoint, `UpdateObstacleAvoidance`
 * flipping the direction it wants (`GroundMoveType.cpp:1095-1096`), and moves
 * against its heading at its reverse speed, which sets how fast it turns too
 * (`GroundMoveType.cpp:1341`).
 */
export function driveAlong(
  points: Vec2[],
  motion: DriveMotion,
  options: DriveOptions,
): DriveRun {
  const frames: DriveFrame[] = [];
  const events: ScriptEvent[] = [];
  let x = 0;
  let z = 0;
  let heading = 0;
  const turn = { speed: 0 };
  let next = 0;
  let moving = false;
  let arrived: number | null = null;
  let reversing = false;
  let currentSpeed = 0;

  /** Whether the unit would back up to head for `points[next]` from here. */
  const wantReverse = (): boolean => {
    const [tx, tz] = points[next];
    const length = Math.hypot(tx - x, tz - z);
    if (length === 0) return false;
    const [gx, gz] = points[points.length - 1];
    return wantsReverse(
      [(tx - x) / length, (tz - z) / length],
      heading,
      Math.hypot(gx - x, gz - z),
      currentSpeed,
      reversing,
      motion,
    );
  };

  // A flier's bank carries from frame to frame, as the engine's does.
  const flight = motion.flight;
  let hoverBank = 0;
  let strafeRoll = 0;
  let lastVelocity: Vec2 = [0, 0];

  /** The flier's bank on this frame, from how it is steering. */
  const bankNow = (
    speed: number,
    steer: { goalDotRight: number; goalDistance: number } | null,
  ): number => {
    if (!flight) return 0;
    const angle = headingRadians(heading);
    const way = reversing ? -1 : 1;
    const velocity: Vec2 = [
      Math.sin(angle) * speed * way,
      Math.cos(angle) * speed * way,
    ];
    if (flight.style === "gunship") {
      const lateral =
        -Math.cos(angle) * (velocity[0] - lastVelocity[0]) +
        Math.sin(angle) * (velocity[1] - lastVelocity[1]);
      hoverBank = hoverBankStep({
        bank: hoverBank,
        lateral,
        accRate: rates(motion).accRate,
        goalDistance: steer?.goalDistance ?? 0,
        banking: flight.bankingAllowed && steer !== null,
      });
      lastVelocity = velocity;
      return hoverBank;
    }
    strafeRoll = strafeRollStep({
      roll: strafeRoll,
      goalDotRight: steer?.goalDotRight ?? 0,
      speed,
      maxBank: flight.maxBank,
      maxAileron: flight.maxAileron,
    });
    return Math.asin(strafeRoll);
  };

  const place = (
    speed: number,
    steer: { goalDotRight: number; goalDistance: number } | null = null,
  ): DriveFrame => {
    const shape = options.ground;
    currentSpeed = speed;
    return {
      ...(flight ? { bank: bankNow(speed, steer) } : {}),
      pos: [x, shape ? groundHeight(shape, x, z) : 0, z],
      heading,
      speed,
      reversing,
      up: shape && options.tilts ? groundNormal(shape, x, z) : null,
    };
  };

  /** After the order ends the unit is not stopped dead: `StopEngine` only sets
   *  the wanted speed to 0 (`GroundMoveType.cpp:2463-2464`, `hardStop` is
   *  false by default, `GroundMoveType.h:170`), so it slows at its brake rate
   *  and rolls on along the way it faces until it stops. */
  const coast = (): DriveFrame => {
    if (currentSpeed <= 0) return place(0);
    const speed = Math.max(0, currentSpeed - rates(motion).decRate);
    const way = reversing ? -1 : 1;
    const angle = headingRadians(heading);
    x += Math.sin(angle) * speed * way;
    z += Math.cos(angle) * speed * way;
    return place(speed);
  };

  for (let frame = 0; frame < options.frames; frame++) {
    if (frame === options.start && points.length > 0 && arrived === null) {
      moving = true;
      reversing = wantReverse();
      events.push({
        frame,
        callin: "StartMoving",
        args: [reversing ? 1 : 0],
      });
      frames.push(place(0));
      continue;
    }
    if (!moving) {
      frames.push(coast());
      continue;
    }

    let [tx, tz] = points[next];
    const last = next === points.length - 1;
    const distance = Math.hypot(tx - x, tz - z);
    const { accRate, decRate } = rates(motion);
    if (last && distance <= Math.max(GOAL_RADIUS, currentSpeed * 1.05)) {
      moving = false;
      arrived = frame;
      events.push({ frame, callin: "StopMoving" });
      frames.push(coast());
      continue;
    }
    if (!last && distance <= Math.max(WAYPOINT_RADIUS, currentSpeed * 1.05)) {
      next++;
      [tx, tz] = points[next];
    }

    reversing = wantReverse();
    const way = reversing ? -1 : 1;
    const wanted = headingFromVector(way * (tx - x), way * (tz - z));
    const wantedSpeed = turnSpeed(
      heading,
      wanted,
      reversing ? { ...motion, speed: motion.reverseSpeed ?? 0 } : motion,
      next === points.length - 1,
      Math.hypot(tx - x, tz - z),
    );
    // Within its braking distance of the goal the unit wants to stop; then it
    // moves towards the wanted speed by at most one frame's rate.
    const braking =
      next === points.length - 1 &&
      Math.hypot(points[next][0] - x, points[next][1] - z) <=
        brakingDistance(currentSpeed, decRate);
    const targetSpeed = braking ? 0 : wantedSpeed;
    const difference = targetSpeed - currentSpeed;
    const speed = Math.max(
      0,
      currentSpeed +
        (difference >= 0
          ? Math.min(difference, accRate)
          : -Math.min(-difference, decRate)),
    );
    // `goalDotRight`: the sine of the angle to the goal, positive to the right
    // (`StrafeAirMoveType.cpp:861`). A heading counts up to the left.
    const steer = {
      goalDotRight: -Math.sin(headingRadians(toShort(wanted - heading))),
      goalDistance: Math.hypot(
        points[points.length - 1][0] - x,
        points[points.length - 1][1] - z,
      ),
    };
    if (wanted !== heading) {
      const delta = turnDelta(wanted, heading, motion.turnRate, turn);
      if (Math.abs(delta) >= options.minScriptChangeHeading) {
        events.push({ frame, callin: "ChangeHeading", args: [delta] });
      }
      heading = toShort(heading + delta);
    }

    const angle = headingRadians(heading);
    x += Math.sin(angle) * speed * way;
    z += Math.cos(angle) * speed * way;
    frames.push(place(speed, steer));
  }
  return { frames, events, arrived };
}

/** What a script is told about the unit on one frame of a drive. Mirrors
 *  `Drive` in `crates/coilbox-unitpose/src/lib.rs`. */
export function scriptDrive(frame: DriveFrame, maxSpeed: number): ScriptDrive {
  return {
    pos: frame.pos,
    heading: frame.heading,
    speed: frame.speed,
    maxSpeed,
    reversing: frame.reversing,
  };
}
