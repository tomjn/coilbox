/**
 * How a built unit moves, worked out from how it is built and from the game it
 * is going into (issue #3255).
 *
 * The roles say what kind of mover it is: a piece in the `wheel` role makes a
 * wheeled or tracked vehicle, a piece in any `leg.*` role a walker. The game says
 * which of its movement classes are that kind. Only a class the game declares can
 * go into the definition, because `UnitDef.cpp` throws the unit away when its
 * `movementClass` does not resolve, so this never makes up a name.
 *
 * Speed and turn rate come from the game too, as the median of the game's own
 * units on the chosen class, so the numbers a unit starts with are ones the game
 * already plays with. The preview's driving mode reads them back off
 * `LegoProject.movement` (issue #3324).
 */

import {
  climbableDegrees,
  DEFAULT_MAX_SLOPE,
  field,
  flag,
  type MoveKind,
  moveClassesOf,
  moveClassOf,
  moveDefsOf,
  requiresMoveDef,
  unitAccelerationOf,
  unitBrakeRateOf,
  unitReverseSpeedOf,
  unitSpeedOf,
  unitTurnRateOf,
} from "@/workshop/moveClasses";
import { bankingKeys, withEngineBanking } from "./banking";
import type { FlightStyle, LegoMovement, LegoProject } from "./model";
import { type Problem, problem } from "./problems";

/**
 * The kinds of mover the build is. Empty for a unit with neither wheels nor legs,
 * which stays static unless the game maker picks a class anyway.
 */
export function movementKinds(project: LegoProject): MoveKind[] {
  const roles = project.pieces.map((piece) => piece.role ?? "");
  const kinds: MoveKind[] = [];
  if (roles.some((role) => role.startsWith("leg."))) kinds.push("kbot");
  if (roles.includes("wheel") || roles.includes("track")) kinds.push("tank");
  return kinds;
}

/** The presets that only play while the unit moves, and the kind each makes it. */
const MOVING_PRESETS: Record<string, MoveKind> = {
  "walk.biped": "kbot",
  "walk.quad": "kbot",
  "walk.legs": "kbot",
  "wheels.roll": "tank",
};

/**
 * The kinds of mover the unit was built as: its roles, or failing those its
 * walk or roll presets.
 */
function builtAs(project: LegoProject): MoveKind[] {
  const kinds = movementKinds(project);
  if (kinds.length > 0) return kinds;
  return [
    ...new Set(
      (project.animations ?? []).flatMap((applied) => {
        const kind = MOVING_PRESETS[applied.presetId];
        return kind ? [kind] : [];
      }),
    ),
  ];
}

/**
 * The movement the Test drawer writes into the scratch game (issue #4472).
 *
 * A unit built to move with no movement chosen, such as one with no game to
 * pick a class from, would otherwise go in as a building. It gets the first
 * class `offerMoveClasses` offers it from the test game, with that class's
 * numbers from `suggestMotion`. Anything chosen is kept. Nothing is guessed
 * when the game's move definitions were not read, since the classes off the
 * unit table carry no kind to pick a walker by.
 */
export function scratchMovement(
  project: LegoProject,
  game: GameMovementData | null,
  gameName: string,
  footprint: number,
): LegoMovement | undefined {
  if (project.movement || !game) return project.movement;
  const kinds = builtAs(project);
  if (kinds.length === 0) return undefined;
  const offer = offerMoveClasses(game, kinds, footprint);
  const pick = offer.source === "movedefs" ? offer.classes[0] : undefined;
  return pick ? suggestMotion(game, gameName, pick.name) : undefined;
}

/** Whether a unit is built to move but has no movement class chosen. */
export function builtToMove(project: LegoProject): boolean {
  return !project.movement && builtAs(project).length > 0;
}

/** A warning for a unit built to move that has no movement (issue #4472). */
export function movementProblems(project: LegoProject): Problem[] {
  if (project.movement) return [];
  const kinds = builtAs(project);
  if (kinds.length === 0) return [];
  const parts = kinds.includes("kbot") ? "legs" : "wheels or tracks";
  return [
    problem(
      "skeleton",
      "warning",
      `It has ${parts} but no movement class, so it exports as a building.`,
    ),
  ];
}

/** One class the picker offers. */
export interface OfferedClass {
  name: string;
  /** Absent when the class came off the unit table, which carries no kind. */
  kind?: MoveKind;
  /** Absent for the same reason. */
  footprint?: number;
  /** How many of the game's units use it. */
  units: number;
  /** The build's kind this class stands in for, when the game has none of it. */
  standsInFor?: MoveKind;
}

/**
 * The kinds to offer, in order, when the game has no class of the build's kind.
 * Ground movers fall back on each other, then hover. A ship has no near kind.
 */
const NEAREST_KINDS: Record<MoveKind, MoveKind[]> = {
  kbot: ["tank", "hover"],
  tank: ["kbot", "hover"],
  hover: ["tank", "kbot"],
  ship: [],
};

/**
 * What the picker has to offer. `movedefs` means the game's own
 * `gamedata/movedefs.lua`, narrowed to the build's kinds. `units` means the
 * classes the game's units use, because the move definitions could not be read,
 * and those carry no kind to narrow by.
 */
export interface MoveClassOffer {
  source: "movedefs" | "units";
  classes: OfferedClass[];
}

/** The two halves of the unit-defs read this needs. */
export interface GameMovementData {
  units: Record<string, Record<string, unknown>>;
  moveDefs: unknown[];
}

function unitsOn(
  units: GameMovementData["units"],
  names: Set<string>,
): Record<string, unknown>[] {
  return Object.values(units).filter(
    (def) => requiresMoveDef(def) && names.has(moveClassOf(def).toLowerCase()),
  );
}

/**
 * The classes to offer a unit of these kinds, nearest the unit's own footprint
 * first. A unit of no kind is offered every class, since nothing in the build
 * narrows it.
 */
export function offerMoveClasses(
  game: GameMovementData,
  kinds: MoveKind[],
  footprint: number,
): MoveClassOffer {
  const declared = moveDefsOf(game.moveDefs);
  const used = moveClassesOf(game.units);
  if (declared.length === 0) {
    return { source: "units", classes: used };
  }
  const counts = new Map<string, number>();
  for (const entry of used) {
    const key = entry.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + entry.units);
  }
  // A build kind the game has no class of is stood in for by the nearest kind
  // the game does have. Which kind a class is stays the engine's answer.
  const wanted = new Map<MoveKind, MoveKind | undefined>();
  for (const kind of kinds) {
    if (declared.some((entry) => entry.kind === kind)) {
      wanted.set(kind, undefined);
      continue;
    }
    const near = NEAREST_KINDS[kind].find((other) =>
      declared.some((entry) => entry.kind === other),
    );
    if (near && !wanted.has(near)) wanted.set(near, kind);
  }
  const classes = declared
    .filter((entry) => kinds.length === 0 || wanted.has(entry.kind))
    .map((entry) => ({
      ...entry,
      units: counts.get(entry.name.toLowerCase()) ?? 0,
      standsInFor: wanted.get(entry.kind),
    }))
    .sort(
      (a, b) =>
        Math.abs(a.footprint - footprint) - Math.abs(b.footprint - footprint) ||
        a.name.localeCompare(b.name),
    );
  return { source: "movedefs", classes };
}

function median(
  values: number[],
  round: (value: number) => number = tenth,
): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return round(value);
}

// The parser holds numbers as 32 bit floats, so a game's 96 arrives as
// 96.0000015. A tenth is finer than any speed or turn rate a game writes.
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// Accelerations are small: BA writes 0.026 and 0.057, which a tenth would turn
// into 0. Six significant figures drops the float noise and keeps those.
function significant(value: number): number {
  return Number(value.toPrecision(6));
}

/**
 * Starting speed and turn rate for a class, with where each came from: the
 * game's units on that class, or failing that its units on any class of the
 * same kind. Absent when no unit in the game moves that way, which leaves the
 * game maker to set it.
 */
export function suggestMotion(
  game: GameMovementData,
  gameName: string,
  moveClass: string,
): LegoMovement {
  const target = moveClass.toLowerCase();
  const declared = moveDefsOf(game.moveDefs);
  const kind = declared.find(
    (entry) => entry.name.toLowerCase() === target,
  )?.kind;
  const pools: { units: Record<string, unknown>[]; label: string }[] = [
    {
      units: unitsOn(game.units, new Set([target])),
      label: `on ${moveClass}`,
    },
  ];
  if (kind) {
    const sameKind = declared.filter((entry) => entry.kind === kind);
    pools.push({
      units: unitsOn(
        game.units,
        new Set(sameKind.map((entry) => entry.name.toLowerCase())),
      ),
      label: `on ${KIND_LABEL[kind]} classes`,
    });
  }

  const movement: LegoMovement = { moveClass };
  for (const pool of pools) {
    const speed = median(pool.units.map(unitSpeedOf));
    if (speed === undefined) continue;
    movement.speed = speed;
    movement.speedFrom = `Median of ${pool.units.length} ${gameName} units ${pool.label}`;
    break;
  }
  for (const pool of pools) {
    const rates = pool.units
      .map(unitTurnRateOf)
      .filter((rate): rate is number => rate !== undefined);
    const turnRate = median(rates);
    if (turnRate === undefined) continue;
    movement.turnRate = turnRate;
    movement.turnRateFrom = `Median of ${rates.length} ${gameName} units ${pool.label}`;
    break;
  }
  for (const pool of pools) {
    const speeds = pool.units.map(unitReverseSpeedOf).filter((s) => s > 0);
    const reverseSpeed = median(speeds);
    if (reverseSpeed === undefined) continue;
    movement.reverseSpeed = reverseSpeed;
    movement.reverseSpeedFrom = `Median of ${speeds.length} ${gameName} units ${pool.label}`;
    break;
  }
  for (const pool of pools) {
    const values = pool.units
      .map(unitAccelerationOf)
      .filter((value): value is number => value !== undefined);
    const acceleration = median(values, significant);
    if (acceleration === undefined) continue;
    movement.acceleration = acceleration;
    movement.accelerationFrom = `Median of ${values.length} ${gameName} units ${pool.label}`;
    break;
  }
  for (const pool of pools) {
    const values = pool.units
      .map(unitBrakeRateOf)
      .filter((value): value is number => value !== undefined);
    const brakeRate = median(values, significant);
    if (brakeRate === undefined) continue;
    movement.brakeRate = brakeRate;
    movement.brakeRateFrom = `Median of ${values.length} ${gameName} units ${pool.label}`;
    break;
  }
  return movement;
}

/** Whether the engine hovers this def when it flies (`UnitDef.h:77`): a
 *  builder, a transport or `hoverAttack`. */
function hoversInAir(def: Record<string, unknown>): boolean {
  return (
    flag(field(def, "hoverattack")) ||
    flag(field(def, "builder")) ||
    Number(field(def, "transportcapacity")) > 0
  );
}

/** A flier's cruise height, read as `UnitDef.cpp:520` does. */
function cruiseAltitudeOf(def: Record<string, unknown>): number | undefined {
  const value = Number(field(def, "cruisealtitude") ?? field(def, "cruisealt"));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Starting numbers for a flier of this style, as the median of the game's own
 * fliers of that style, or failing that of all its fliers. Absent where no
 * flier in the game states the number.
 */
export function suggestFlight(
  game: GameMovementData,
  gameName: string,
  style: FlightStyle,
): LegoMovement {
  const fliers = Object.values(game.units).filter((def) =>
    flag(field(def, "canfly")),
  );
  const pools = [
    {
      units: fliers.filter((def) => hoversInAir(def) === (style === "gunship")),
      label: style === "gunship" ? "gunships" : "planes",
    },
    { units: fliers, label: "fliers" },
  ];
  const movement: LegoMovement = { moveClass: "", flies: style };
  const set = (
    read: (def: Record<string, unknown>) => number | undefined,
    round: (value: number) => number,
    apply: (value: number, from: string) => void,
  ) => {
    for (const pool of pools) {
      const values = pool.units
        .map(read)
        .filter((value): value is number => value !== undefined);
      const value = median(values, round);
      if (value === undefined) continue;
      apply(value, `Median of ${values.length} ${gameName} ${pool.label}`);
      return;
    }
  };
  set(
    (def) => {
      const speed = unitSpeedOf(def);
      return speed > 0 ? speed : undefined;
    },
    tenth,
    (value, from) => {
      movement.speed = value;
      movement.speedFrom = from;
    },
  );
  set(unitTurnRateOf, tenth, (value, from) => {
    movement.turnRate = value;
    movement.turnRateFrom = from;
  });
  set(cruiseAltitudeOf, tenth, (value, from) => {
    movement.cruiseAltitude = value;
    movement.cruiseAltitudeFrom = from;
  });
  set(unitAccelerationOf, significant, (value, from) => {
    movement.acceleration = value;
    movement.accelerationFrom = from;
  });
  set(unitBrakeRateOf, significant, (value, from) => {
    movement.brakeRate = value;
    movement.brakeRateFrom = from;
  });
  for (const { key } of bankingKeys(style)) {
    if (key === "bankingAllowed") {
      setBankingAllowed(movement, pools, gameName);
      continue;
    }
    set(
      (def) => {
        const value = Number(field(def, key.toLowerCase()));
        return field(def, key.toLowerCase()) !== undefined &&
          Number.isFinite(value)
          ? value
          : undefined;
      },
      significant,
      (value, from) => {
        movement[key] = value;
        movement[`${key}From`] = from;
      },
    );
  }
  return withEngineBanking(movement);
}

/**
 * `bankingAllowed` is the value most of the game's gunships state, the engine's
 * true on a tie, and absent when none states it.
 */
function setBankingAllowed(
  movement: LegoMovement,
  pools: { units: Record<string, unknown>[]; label: string }[],
  gameName: string,
) {
  for (const pool of pools) {
    const stated = pool.units
      .map((def) => field(def, "bankingallowed"))
      .filter((value) => value !== undefined)
      .map(flag);
    if (stated.length === 0) continue;
    const yes = stated.filter(Boolean).length;
    movement.bankingAllowed = yes * 2 >= stated.length;
    movement.bankingAllowedFrom = `Majority of ${stated.length} ${gameName} ${pool.label}`;
    return;
  }
}

/** The kinds in words, for the picker and for where a number came from. */
export const KIND_LABEL: Record<MoveKind, string> = {
  tank: "vehicle",
  kbot: "walker",
  hover: "hover",
  ship: "ship",
};

/**
 * Whether the definition is written as a unit that moves. A class and a speed
 * above zero, because `UnitDef::RequireMoveDef` is `canmove && speed > 0`, and a
 * unit with `canmove` and no speed is static to the engine anyway.
 */
export function movesInGame(
  movement: LegoMovement | undefined,
): movement is LegoMovement & { speed: number } {
  return (
    !!movement &&
    (!!movement.flies || movement.moveClass.trim() !== "") &&
    typeof movement.speed === "number" &&
    movement.speed > 0
  );
}

/**
 * Whether the game has a class by this name, matched case blind as
 * `MoveDefHandler::GetMoveDefByName` matches it. Against the unit table when the
 * game's move definitions could not be read.
 */
export function declaresMoveClass(
  game: GameMovementData,
  moveClass: string,
): boolean {
  const target = moveClass.toLowerCase();
  const declared = moveDefsOf(game.moveDefs);
  const names =
    declared.length > 0
      ? declared.map((entry) => entry.name)
      : moveClassesOf(game.units).map((entry) => entry.name);
  return names.some((name) => name.toLowerCase() === target);
}

/** What the movement picker can show, given what is known about the game. */
export type MovementState =
  | { state: "no-game"; reason: string }
  | { state: "loading"; gameName: string }
  | { state: "error"; gameName: string; message: string }
  | { state: "none-fit"; gameName: string; kinds: MoveKind[] }
  | { state: "offer"; gameName: string; offer: MoveClassOffer };

/**
 * Where the picker stands. `gameName` is null when there is no game to read,
 * and `noGame` then says why in a line the panel can show.
 */
export function movementState(input: {
  gameName: string | null;
  noGame: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  game: GameMovementData | null;
  kinds: MoveKind[];
  footprint: number;
}): MovementState {
  const { gameName } = input;
  if (!gameName) return { state: "no-game", reason: input.noGame };
  if (input.status === "error") {
    return {
      state: "error",
      gameName,
      message: input.error ?? "The game's definitions could not be read.",
    };
  }
  if (input.status !== "ready" || !input.game) {
    return { state: "loading", gameName };
  }
  const offer = offerMoveClasses(input.game, input.kinds, input.footprint);
  if (offer.classes.length === 0) {
    return { state: "none-fit", gameName, kinds: input.kinds };
  }
  return { state: "offer", gameName, offer };
}

/** A slope angle without a trailing zero: 22.5, 15. */
function degreesText(degrees: number): string {
  return String(Math.round(degrees * 10) / 10);
}

/**
 * One line saying whether the unit can climb a slope of `degrees`, or null when
 * there is nothing to say (issue #4128).
 *
 * A unit with no movement class is static, and its own `maxslope` only limits
 * where it can be built, so it gets no line about climbing. Otherwise the
 * class's `maxSlope` is looked up in the game's move definitions and compared
 * at its engine value, 1.5 times the number written (`climbableDegrees`). A
 * class that came off the unit table, or is not declared, has no `maxSlope` to
 * read, and the line says so rather than assuming the kind's default.
 *
 * `game` is null while the game is not read, which is also unknown.
 */
export function slopeVerdict(
  movement: LegoMovement | undefined,
  game: Pick<GameMovementData, "moveDefs"> | null,
  degrees: number,
): string | null {
  const name = movement?.moveClass.trim();
  if (!name) return null;
  const target = name.toLowerCase();
  const move = game
    ? moveDefsOf(game.moveDefs).find(
        (entry) => entry.name.toLowerCase() === target,
      )
    : undefined;
  if (!move) {
    return `Climbing limit unknown: ${name}'s maxSlope is not read from the game.`;
  }
  const limit = climbableDegrees(move);
  if (limit === null) return `${name} is a ship class, which has no maxSlope.`;
  const written =
    move.maxSlope === undefined
      ? `default maxSlope ${DEFAULT_MAX_SLOPE[move.kind]}`
      : `maxSlope ${move.maxSlope}`;
  const reach = `climbs up to ${degreesText(limit)}\u00b0 (${written})`;
  return degrees <= limit + 1e-9
    ? `${name} can climb this: it ${reach}.`
    : `${name} cannot climb this: it ${reach}.`;
}
