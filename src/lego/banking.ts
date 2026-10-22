/**
 * How the engine banks an aircraft, and the keys that tune it (issue #3359).
 *
 * The engine rolls and pitches a flying unit itself, from unit definition keys.
 * Nothing in a unit's script can add to that roll: the move type writes the
 * unit's `updir`, `frontdir` and `rightdir` directly, and the script only moves
 * pieces inside that frame. So the builder writes the keys and the preview
 * shows their effect, and writes no banking script.
 *
 * Two move types, picked by `UnitDef.h:76-77`:
 *
 * - A gunship (`hoverAttack`, a builder or a transport) gets `CHoverAirMoveType`.
 *   It reads one key, `bankingAllowed` (`HoverAirMoveType.cpp:151`), and banks
 *   by the sideways acceleration it has (`HoverAirMoveType.cpp:716`). `maxBank`
 *   and `maxPitch` are not read by it.
 * - A plane gets `CStrafeAirMoveType`. It reads `maxBank`, `maxPitch`,
 *   `maxAileron`, `maxElevator` and `maxRudder`. It does not read
 *   `bankingAllowed`, which no code outside `CHoverAirMoveType` reads.
 *
 * A hovercraft is a ground unit with a hover movement class. It has no banking
 * keys: it tilts to the slope under it (`GroundMoveType.cpp:1440`), at the
 * rate `upDirSmoothing` sets (`UnitDef.cpp:373`).
 *
 * The preview's roll is an illustration of these rules, not the flight model.
 */

import { t } from "@lingui/core/macro";
import type { FlightStyle, LegoMovement } from "./model";

/** One banking key: its spelling in the definition and the engine's default. */
export interface BankingKey {
  /** The key as the engine reads it. */
  key: keyof BankingValues;
  label: string;
  /** What the engine uses when the definition leaves the key out. */
  engineDefault: number | boolean;
  /** Where the engine reads the key and its default. */
  source: string;
  /** What the number is measured in. */
  unit: string;
}

export interface BankingValues {
  bankingAllowed: boolean;
  maxBank: number;
  maxPitch: number;
  maxAileron: number;
  maxElevator: number;
  maxRudder: number;
}

const GUNSHIP_KEYS: BankingKey[] = [
  {
    key: "bankingAllowed",
    get label() {
      return t`Banking allowed`;
    },
    engineDefault: true,
    source: "UnitDef.cpp:522",
    get unit() {
      return t`on or off`;
    },
  },
];

const PLANE_KEYS: BankingKey[] = [
  {
    key: "maxBank",
    get label() {
      return t`Max bank`;
    },
    engineDefault: 0.8,
    source: "UnitDef.cpp:559",
    get unit() {
      return t`the sine of the roll angle, so 0.8 is 53 degrees`;
    },
  },
  {
    key: "maxPitch",
    get label() {
      return t`Max pitch`;
    },
    engineDefault: 0.45,
    source: "UnitDef.cpp:560",
    get unit() {
      return t`the sine of the pitch angle, so 0.45 is 27 degrees`;
    },
  },
  {
    key: "maxAileron",
    get label() {
      return t`Max aileron`;
    },
    engineDefault: 0.015,
    source: "UnitDef.cpp:564",
    get unit() {
      return t`roll speed per elmo a frame of flying speed`;
    },
  },
  {
    key: "maxElevator",
    get label() {
      return t`Max elevator`;
    },
    engineDefault: 0.01,
    source: "UnitDef.cpp:565",
    get unit() {
      return t`pitch speed per elmo a frame of flying speed`;
    },
  },
  {
    key: "maxRudder",
    get label() {
      return t`Max rudder`;
    },
    engineDefault: 0.004,
    source: "UnitDef.cpp:566",
    get unit() {
      return t`turn speed per elmo a frame of flying speed`;
    },
  },
];

/** The keys that tune banking for a flier of this style, in the order shown. */
export function bankingKeys(style: FlightStyle): BankingKey[] {
  return style === "gunship" ? GUNSHIP_KEYS : PLANE_KEYS;
}

/** The engine's default for every banking key. */
export const ENGINE_BANKING: BankingValues = {
  bankingAllowed: true,
  maxBank: 0.8,
  maxPitch: 0.45,
  maxAileron: 0.015,
  maxElevator: 0.01,
  maxRudder: 0.004,
};

/** The movement with each banking key its style reads set to the engine's
 *  default, where the game has not suggested one. */
export function withEngineBanking(movement: LegoMovement): LegoMovement {
  if (!movement.flies) return movement;
  const filled: LegoMovement = { ...movement };
  for (const { key, engineDefault } of bankingKeys(movement.flies)) {
    if (filled[key] === undefined) {
      Object.assign(filled, {
        [key]: engineDefault,
        [`${key}From`]: "Engine default",
      });
    }
  }
  return filled;
}

/** The banking numbers a flier is previewed with: what it states, else the
 *  engine's default. */
export interface Flight {
  style: FlightStyle;
  bankingAllowed: boolean;
  maxBank: number;
  maxAileron: number;
}

export function flightOf(movement: LegoMovement | undefined): Flight | null {
  if (!movement?.flies) return null;
  return {
    style: movement.flies,
    bankingAllowed: movement.bankingAllowed ?? ENGINE_BANKING.bankingAllowed,
    maxBank: movement.maxBank ?? ENGINE_BANKING.maxBank,
    maxAileron: movement.maxAileron ?? ENGINE_BANKING.maxAileron,
  };
}

/** How far `CHoverAirMoveType` moves `currentBank` in a frame, radians
 *  (`HoverAirMoveType.cpp:722,724`). */
const HOVER_BANK_STEP = 0.03;

/** The `Square(0.15f)` in `bankLimit` (`HoverAirMoveType.cpp:689`). */
const HOVER_BANK_LIMIT_SCALE = 0.15 * 0.15;

export interface HoverBankInput {
  /** `currentBank` from the frame before, radians, positive to the right. */
  bank: number;
  /** The sideways part of this frame's change in velocity, elmos a frame
   *  squared, positive to the unit's right: `rightDir2D.dot(deltaSpeed)`. */
  lateral: number;
  /** The unit's `accRate`, `max(0.01, maxAcc)` (`AAirMoveType.cpp:107`). */
  accRate: number;
  /** How far the unit is from its goal, elmos. */
  goalDistance: number;
  /** `bankingAllowed`, and false while the unit hovers or lands. */
  banking: boolean;
}

/**
 * One frame of a gunship's bank, `CHoverAirMoveType::UpdateBanking`
 * (`HoverAirMoveType.cpp:689-724`), the roll applied to `updir` at line 729 as
 * `cos(bank)` up plus `sin(bank)` right.
 *
 *   wantedBank = lateral / accRate * 0.5                  (line 716)
 *   if wantedBank^2 > min(1, goalDistance^2 * 0.15^2)     (lines 689,717)
 *     wantedBank = sqrt(min(1, goalDistance^2 * 0.15^2))  (line 718)
 *   bank moves towards wantedBank by at most 0.03         (lines 721-725)
 *
 * The limit is applied as the engine applies it, to the square, and the
 * replacement is the positive root, so a left bank past the limit becomes a
 * right one. That is the engine's code and the preview does the same.
 */
export function hoverBankStep(input: HoverBankInput): number {
  const limit = Math.min(
    1,
    input.goalDistance * input.goalDistance * HOVER_BANK_LIMIT_SCALE,
  );
  let wanted = input.banking ? (input.lateral / input.accRate) * 0.5 : 0;
  if (wanted * wanted > limit) wanted = Math.sqrt(limit);
  const step = Math.min(HOVER_BANK_STEP, Math.abs(wanted - input.bank));
  return input.bank + Math.sign(wanted - input.bank) * step;
}

/** `spd.w > 1.5f` (`StrafeAirMoveType.cpp:190`): below this the ailerons only
 *  level the wings. */
const STRAFE_BANK_SPEED = 1.5;

export interface StrafeRollInput {
  /** The sine of the roll from the frame before, positive to the right. */
  roll: number;
  /** The sine of the angle from the unit's front to the way it wants to go,
   *  positive when that is to its right: `goalDotRight`. */
  goalDotRight: number;
  /** Elmos a frame. */
  speed: number;
  maxBank: number;
  maxAileron: number;
}

/**
 * One frame of a plane's roll, as the ailerons settle it in cruise
 * (`GetAileronDeflection`, `StrafeAirMoveType.cpp:186-207`).
 *
 * The ailerons push until `goalBankDif = goalDotRight + rightdir.y * 0.5` is
 * zero (line 187), and `rightdir.y` is minus the sine of a right roll, so the
 * roll settles at sin(roll) = 2 * goalDotRight. They stop pushing past
 * `maxBank` (lines 197-198). The roll moves at `maxAileron * speed` a frame
 * (lines 1097,1120). Below 1.5 elmos a frame they only level the wings.
 *
 * Left out: the engine's smoothing of the control over three frames
 * (line 343), the stronger pull while attacking (the 0.2 at line 171) and the wing levelling when the plane is low.
 */
export function strafeRollStep(input: StrafeRollInput): number {
  const wanted =
    input.speed > STRAFE_BANK_SPEED
      ? Math.max(
          -input.maxBank,
          Math.min(input.maxBank, 2 * input.goalDotRight),
        )
      : 0;
  const rate = input.maxAileron * input.speed;
  const step = Math.min(rate, Math.abs(wanted - input.roll));
  return input.roll + Math.sign(wanted - input.roll) * step;
}
