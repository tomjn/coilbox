/**
 * Beyond All Reason's blueprint file, read and written (issue #1312).
 *
 * The game's own `luaui/Widgets/cmd_blueprint.lua` keeps saved layouts in
 * `LuaUI/Config/blueprints.json`, and its `serializeBlueprint` is the shape
 * below. Units are named rather than carrying a runtime def id, which is what
 * makes the file portable between installs and worth reading at all.
 *
 * Coilbox's format is the superset, so the two directions are not symmetrical:
 *
 * - Reading loses nothing about the buildings, and gains a name and a build
 *   order that map straight onto ours. What it cannot keep is the gap the game
 *   repeats a layout at while dragging one out, which is a placement setting
 *   rather than a fact about the shape.
 * - Writing loses the mission-only fields a base carries on top of its layout:
 *   the trigger name, the factory queue and its repeat. {@link strippedByBar}
 *   names them so an author decides rather than finds out later.
 *
 * The one place this file is subtle is the blueprint's own `facing`. The game
 * stores the quarter turn a layout was last rotated to and applies it when
 * placing, so a layout read without applying it comes out on its side. Coilbox
 * layouts carry no such field, so the turn is applied to the buildings here and
 * reported, which is also what makes a round trip come back where it started.
 */

import type { BaseBuildingRole, Facing, Point } from "../scenario/model";
import type { SnapBuilding } from "./footprint";
import type {
  BlueprintFormat,
  ImportedBlueprint,
  ImportReport,
  MergePlan,
} from "./format";
import type { BaseBlueprint, BlueprintBuilding } from "./model";
import { type KnownUnits, unknownBuildings } from "./units";

/** Where the game reads and writes it, under whichever directory it writes to. */
const BAR_FILE = "LuaUI/Config/blueprints.json";

/** One building of a saved layout, as the file has it. `position` is a three
 *  element array because Lua wrote it as one: x, the ground height, and z. */
interface BarUnit {
  unitName: string;
  position: [number, number, number];
  facing: number;
  /** What the unit was before the game substituted another side's equivalent for
   *  it. The game's own `blueprint_substitution` writes this and reads it back to
   *  undo the swap, and coilbox keeps it for the same reason (issue #1314). */
  originalName?: string;
}

/** One saved layout, as the file has it. */
export interface BarBlueprint {
  name: string;
  spacing: number;
  facing: number;
  ordered: boolean;
  units: BarUnit[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The whole file as an object, or a thrown error naming what is wrong with it.
 *
 * Both reading and merging start here, and both refuse rather than guess: a
 * merge that treated an unreadable file as an empty one would replace somebody's
 * layouts with ours.
 */
function parseFile(text: string): {
  root: Record<string, unknown>;
  entries: unknown[];
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return raise("This file could not be read as JSON.");
  }
  if (!isRecord(value)) {
    return raise("This file could not be read as a blueprints file.");
  }
  const saved = value.savedBlueprints;
  // The widget writes `0` rather than an empty array when it has nothing to
  // save, so that is what an empty file looks like in the wild.
  if (saved === undefined || saved === 0) return { root: value, entries: [] };
  if (!Array.isArray(saved)) {
    return raise("This file's savedBlueprints is not a list of blueprints.");
  }
  return { root: value, entries: saved };
}

function raise(message: string): never {
  throw new Error(message);
}

/** One of the four facings, from whatever number the file holds. */
function facingOf(value: unknown): Facing {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return (((Math.round(n) % 4) + 4) % 4) as Facing;
}

/**
 * A point turned `facing` quarter turns about the layout's own centre, which is
 * `rotateBlueprint` in the game's `api_blueprint.lua` done in whole numbers.
 * Its rotation is by `-facing` right angles, so facing 1 sends (x, z) to
 * (z, -x).
 */
function turned(point: Point, facing: Facing): Point {
  switch (facing) {
    case 1:
      return { x: point.z, z: -point.x };
    case 2:
      return { x: -point.x, z: -point.z };
    case 3:
      return { x: -point.z, z: point.x };
    default:
      return point;
  }
}

/** Whole elmos. The file holds floats, because it holds where units stood. */
function round(point: Point): Point {
  return { x: Math.round(point.x), z: Math.round(point.z) };
}

/** One building of a saved layout, or null when the entry is not one. */
function readUnit(value: unknown): {
  def: string;
  pos: Point;
  facing: Facing;
  originalName?: string;
} | null {
  if (!isRecord(value)) return null;
  const def = value.unitName;
  const pos = value.position;
  if (typeof def !== "string" || def.length === 0) return null;
  if (!Array.isArray(pos)) return null;
  const [x, , z] = pos;
  if (typeof x !== "number" || typeof z !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const was = value.originalName;
  return {
    def,
    pos: { x, z },
    facing: facingOf(value.facing),
    ...(typeof was === "string" && was.trim() !== ""
      ? { originalName: was }
      : {}),
  };
}

/**
 * One entry of the file as a layout, or null when this reader cannot make one
 * of it. Null is not a failure of the file: the game filters the same entries
 * out on load and writes them back untouched on save, and so does the merge
 * below.
 */
function readEntry(
  value: unknown,
  index: number,
  snap?: SnapBuilding,
): Omit<ImportedBlueprint, "unknown"> | null {
  if (!isRecord(value) || !Array.isArray(value.units)) return null;
  const read = value.units.map(readUnit);
  if (read.length === 0 || read.some((unit) => unit === null)) return null;

  const facing = facingOf(value.facing);
  const snapped: ImportedBlueprint["snapped"] = [];
  const buildings: BlueprintBuilding[] = read.map((unit, at) => {
    // Not null: the whole entry was refused above if any of them were.
    const {
      def,
      pos,
      facing: own,
      originalName,
    } = unit as NonNullable<typeof unit>;
    const facingHere = ((own + facing) % 4) as Facing;
    const from = round(turned(pos, facing));
    const offset = snap ? snap(from, def, facingHere) : from;
    if (offset.x !== from.x || offset.z !== from.z) {
      snapped.push({ index: at, def, from, to: offset });
    }
    return {
      def,
      offset,
      facing: facingHere,
      ...(originalName ? { originalName } : {}),
    };
  });

  const name =
    typeof value.name === "string" && value.name.trim().length > 0
      ? value.name
      : // What the game calls a nameless one when it talks about it.
        `#${index + 1}`;

  const dropped: string[] = [];
  const spacing = value.spacing;
  if (typeof spacing === "number" && spacing > 0) {
    dropped.push(`the ${spacing} square gap it repeats at`);
  }

  const layout: Omit<BaseBlueprint, "id"> = { name, buildings };
  if (value.ordered === true) layout.ordered = true;
  return { layout, turned: facing, snapped, dropped };
}

/**
 * Every layout a Beyond All Reason blueprints file holds.
 *
 * One file holds every game's layouts, because the path the widget writes to
 * has no game in it, so `known` is how a layout gets tied back to a game at
 * all. A layout naming units this game has not got is read like any other and
 * carries the list of them, because the person reading is the one deciding
 * whether it is worth taking.
 */
export function readBarFile(
  text: string,
  snap?: SnapBuilding,
  known?: KnownUnits,
): ImportReport {
  const { entries } = parseFile(text);
  const blueprints: ImportedBlueprint[] = [];
  let unreadable = 0;
  entries.forEach((entry, index) => {
    const read = readEntry(entry, index, snap);
    if (read) {
      blueprints.push({
        ...read,
        unknown: unknownBuildings(read.layout.buildings, known),
      });
    } else unreadable += 1;
  });
  return { blueprints, unreadable, checked: known !== undefined };
}

/**
 * One coilbox layout as the game's file wants it.
 *
 * `spacing` and `facing` are written as the game's own defaults for a freshly
 * saved layout, because that is what they mean here: the buildings are already
 * where they belong, and there is no turn left to apply.
 */
export function barEntry(layout: BaseBlueprint): BarBlueprint {
  return {
    name: layout.name,
    spacing: 0,
    facing: 0,
    ordered: layout.ordered === true,
    units: layout.buildings.map((building) => ({
      unitName: building.def,
      // The middle number is the ground height the unit stood at, which the
      // game reads off the map when it places one, so nothing is lost by
      // writing the ground.
      position: [building.offset.x, 0, building.offset.z],
      facing: building.facing,
      ...(building.originalName ? { originalName: building.originalName } : {}),
    })),
  };
}

/** "1 building" or "3 buildings", so a warning reads as English. */
function count(n: number): string {
  return `${n} building${n === 1 ? "" : "s"}`;
}

/**
 * What writing a base out to this format loses.
 *
 * A blueprint is geometry, and the fields listed here belong to a base in a
 * mission rather than to the shape: nothing in the game's file can hold them, so
 * an export drops them. Naming them is the whole point, because the alternative
 * is quietly writing a lesser file.
 *
 * The team and the origin are not here. A blueprint has neither by design, which
 * is what makes it placeable anywhere, so leaving them behind is the feature.
 */
export function strippedByBar(roles: BaseBuildingRole[]): string[] {
  const named = roles.filter((role) => role.id !== undefined).length;
  const queued = roles.filter(
    (role) => role.queue !== undefined && role.queue.length > 0,
  ).length;
  const repeating = roles.filter((role) => role.repeat === true).length;
  const out: string[] = [];
  if (named > 0) out.push(`the trigger name on ${count(named)}`);
  if (queued > 0) out.push(`the build queue on ${count(queued)}`);
  if (repeating > 0) out.push(`the repeating queue on ${count(repeating)}`);
  return out;
}

/** The name an entry answers to for the purpose of matching, or null when it
 *  has none: a nameless entry is never something coilbox replaces. */
function entryName(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const name = entry.name;
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}

/**
 * A Beyond All Reason blueprints file with these layouts merged into it.
 *
 * Everything the file already said is kept: entries this reader cannot make a
 * layout of stay exactly as they are, in the place they were, and so does every
 * other key the file carries. A layout whose name is already in the file
 * replaces that entry where it stands rather than being appended, so a player's
 * list does not grow a second copy each time they send one over.
 */
export function mergeBarFile(
  existing: string,
  layouts: BaseBlueprint[],
): MergePlan {
  const { root, entries } =
    existing.trim().length === 0
      ? { root: {} as Record<string, unknown>, entries: [] as unknown[] }
      : parseFile(existing);

  const out = entries.slice();
  const replaced: string[] = [];
  const added: string[] = [];
  for (const layout of layouts) {
    const entry = barEntry(layout);
    const at = out.findIndex((held) => entryName(held) === layout.name);
    if (at >= 0) {
      out[at] = entry;
      replaced.push(layout.name);
    } else {
      out.push(entry);
      added.push(layout.name);
    }
  }

  const kept = entries.filter(
    (entry, at) => out[at] === entry && !isReadable(entry),
  ).length;

  return {
    text: `${JSON.stringify({ ...root, savedBlueprints: out }, null, 2)}\n`,
    replaced,
    added,
    kept,
  };
}

/** Whether an entry is one this adapter can make a layout of, which is what
 *  decides whether carrying it through was the file being protected. */
function isReadable(entry: unknown): boolean {
  return readEntry(entry, 0) !== null;
}

export const barFormat: BlueprintFormat = {
  id: "bar",
  label: "Beyond All Reason",
  file: BAR_FILE,
  read: readBarFile,
  merge: mergeBarFile,
  stripped: strippedByBar,
};
