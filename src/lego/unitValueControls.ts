/**
 * Which control a unit value id should be edited with, and how to read and
 * write the number it stores.
 *
 * Every unit value is an integer underneath, whatever it means: a switch is 0
 * or 1, a heading is 65536ths of a circle, a percentage is already the number
 * a person would type. Editing all of them as a bare integer would be correct
 * and useless, so this maps a value's name, from `CUnitScript::GetUnitVal` in
 * the engine, to the control that makes it a number a person can set without
 * reading the engine source first.
 */

/** COB's fixed-point scale: 65536ths of an elmo, or of a full circle. */
const COB_SCALE = 65536;

/** A control edits a display number, and `toRaw`/`toDisplay` convert it to and
 *  from the integer a unit value is actually stored as. */
export type UnitValueControl =
  | { kind: "switch"; label: string }
  | {
      kind: "slider";
      label: string;
      min: number;
      max: number;
      step: number;
      suffix: string;
      toDisplay: (raw: number) => number;
      toRaw: (display: number) => number;
    }
  | {
      kind: "select";
      label: string;
      options: { value: number; label: string }[];
    }
  | { kind: "number"; label: string };

/** On or off, with nothing in between. */
const SWITCHES = new Set([
  "ACTIVATION",
  "INBUILDSTANCE",
  "BUSY",
  "YARD_OPEN",
  "ARMORED",
  "IN_WATER",
  "CLOAKED",
  "WANT_CLOAK",
  "UPRIGHT",
  "REVERSING",
]);

/** Already a 0 to 100 number, so the display value is the raw one. */
const PERCENTS = new Set([
  "HEALTH",
  "BUILD_PERCENT_LEFT",
  "UNIT_BUILD_PERCENT_LEFT",
]);

const MOVE_ORDERS = [
  { value: 0, label: "Hold position" },
  { value: 1, label: "Manoeuvre" },
  { value: 2, label: "Roam" },
];

const FIRE_ORDERS = [
  { value: 0, label: "Hold fire" },
  { value: 1, label: "Return fire" },
  { value: 2, label: "Fire at will" },
];

/** A nicer label than sentence-casing the engine's own name would give.
 *  Everything else falls back to that instead. */
const LABELS: Record<string, string> = {
  HEALTH: "Health",
  INBUILDSTANCE: "Build stance",
  STANDINGMOVEORDERS: "Move orders",
  STANDINGFIREORDERS: "Fire orders",
  HEADING: "Heading",
  CURRENT_SPEED: "Speed",
};

/** `YARD_OPEN` becomes "Yard open": lower-cased, underscores to spaces, and
 *  the first letter capitalised. */
function sentenceCase(name: string): string {
  const lower = name.toLowerCase().replaceAll("_", " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const identity = (value: number) => value;

/**
 * The control a unit value should be edited with, and the label to show
 * beside it.
 *
 * `name` is the engine's own name for the id, from `unitvalue::NAMES`, or
 * null when the id has none: every unit value a script can read has an
 * integer, but only some of them have a name the engine's own `COB` table
 * gives Lua, and an id nothing named still needs something to edit it with.
 */
export function controlFor(id: number, name: string | null): UnitValueControl {
  if (name === null) return { kind: "number", label: `Value ${id}` };

  const label = LABELS[name] ?? sentenceCase(name);

  if (SWITCHES.has(name)) return { kind: "switch", label };

  if (PERCENTS.has(name)) {
    return {
      kind: "slider",
      label,
      min: 0,
      max: 100,
      step: 1,
      suffix: "%",
      toDisplay: identity,
      toRaw: Math.round,
    };
  }

  if (name === "STANDINGMOVEORDERS")
    return { kind: "select", label, options: MOVE_ORDERS };
  if (name === "STANDINGFIREORDERS")
    return { kind: "select", label, options: FIRE_ORDERS };

  if (name === "HEADING") {
    return {
      kind: "slider",
      label,
      min: -180,
      max: 180,
      step: 1,
      suffix: "°",
      toDisplay: (raw) => (raw * 360) / COB_SCALE,
      toRaw: (display) => Math.round((display * COB_SCALE) / 360),
    };
  }

  if (name === "CURRENT_SPEED") {
    return {
      kind: "slider",
      label,
      min: 0,
      max: 2,
      step: 0.05,
      suffix: " elmos/frame",
      toDisplay: (raw) => raw / COB_SCALE,
      toRaw: (display) => Math.round(display * COB_SCALE),
    };
  }

  return { kind: "number", label };
}
