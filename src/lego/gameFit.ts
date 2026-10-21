/**
 * Whether a built unit fits the game it is going into: its armour class, its
 * categories and its movement class (issue #3305).
 *
 * The builder knows none of these, so a unit can load and still be wrong for
 * the game. This reads them and reports. It changes nothing.
 *
 * - Armour class has no unit field. The engine puts a unit in the class whose
 *   list in `armordefs.lua` names it, and in `default` otherwise, so a built unit
 *   is in `default` until the game's file lists it (see `armorClasses.ts`).
 * - Category is a string of names. The engine makes a new category for a name it
 *   has not seen, so an unknown name is not an error. The risk is a unit with
 *   none: `CWeapon::TestTarget` drops a target when `category & onlyTargetCategory`
 *   is 0, and the default mask matches every bit, so no weapon can target a
 *   unit whose category is 0.
 * - Movement class has to name one of the game's move definitions or the engine
 *   drops a unit that can move (see `movement.ts`).
 *
 * The caller passes the definition to check. That is the game's own entry for
 * the unit once it is exported and read back, since the file in the game is the
 * only place a built unit's stats live (issue #3313), and the definition the
 * builder would write otherwise.
 */

import { t } from "@lingui/core/macro";
import { armorClassOf } from "@/workshop/armorClasses";
import {
  field,
  flag,
  moveClassOf,
  moveClassProblem,
} from "@/workshop/moveClasses";
import { declaresMoveClass, type GameMovementData } from "./movement";

/** What the check reads of a game: its unit table and its class lists. */
export interface GameFitData extends GameMovementData {
  armorDefs: Record<string, string[]>;
}

export interface FitRow {
  id: "armour" | "category" | "movement";
  status: "ok" | "warn";
  text: string;
  /** Categories the game's similar units use, offered when the unit has none
   *  or names one the game does not use. */
  suggested?: string[];
}

/** How many categories to offer. */
const SUGGESTION_LIMIT = 6;

/** A def's categories, lowercased as the engine lowercases them. */
function categoriesOf(def: Record<string, unknown> | undefined): string[] {
  const value = field(def, "category");
  const names = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
  return [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
}

function armourRow(unitKey: string, game: GameFitData): FitRow {
  const className = armorClassOf(game.armorDefs, undefined, unitKey);
  if (className !== "default")
    return {
      id: "armour",
      status: "ok",
      text: t`Armour class: ${className}.`,
    };
  if (Object.keys(game.armorDefs).length === 0)
    return {
      id: "armour",
      status: "ok",
      text: t`Armour class: default. The game declares no other class.`,
    };
  return {
    id: "armour",
    status: "warn",
    text: t`Armour class: default. No class in the game's armordefs.lua lists this unit, so damage that depends on class does not apply to it.`,
  };
}

/** The categories the game's units most often carry, among units that move the
 *  way this one does. */
function similarCategories(
  def: Record<string, unknown>,
  game: GameFitData,
  own: string[],
): string[] {
  const moveClass = moveClassOf(def).toLowerCase();
  const moves = flag(field(def, "canmove")) && moveClass !== "";
  const flies = flag(field(def, "canfly"));
  const counts = new Map<string, number>();
  for (const other of Object.values(game.units)) {
    // An aircraft has no movement class, so it is matched on flying instead.
    if (flies) {
      if (!flag(field(other, "canfly"))) continue;
    } else if (flag(field(other, "canfly"))) continue;
    const otherClass = moveClassOf(other).toLowerCase();
    const otherMoves = flag(field(other, "canmove")) && otherClass !== "";
    if (moves ? otherClass !== moveClass : otherMoves) continue;
    for (const name of categoriesOf(other))
      counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .filter(([name]) => !own.includes(name))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SUGGESTION_LIMIT)
    .map(([name]) => name);
}

function categoryRow(def: Record<string, unknown>, game: GameFitData): FitRow {
  const own = categoriesOf(def);
  if (own.length === 0)
    return {
      id: "category",
      status: "warn",
      text: t`No category. No weapon can target this unit.`,
      suggested: similarCategories(def, game, own),
    };
  const used = new Set(Object.values(game.units).flatMap(categoriesOf));
  const unknown = own.filter((name) => !used.has(name));
  if (unknown.length > 0) {
    const names = unknown.join(", ");
    return {
      id: "category",
      status: "warn",
      text: t`Category ${names}: no unit in the game uses it, so no weapon is set to look for it.`,
      suggested: similarCategories(def, game, own),
    };
  }
  const names = own.join(" ");
  return { id: "category", status: "ok", text: t`Category: ${names}.` };
}

function movementRow(
  def: Record<string, unknown>,
  game: GameFitData,
): FitRow | null {
  if (flag(field(def, "canfly"))) return null;
  const problem = moveClassProblem(def);
  if (problem) return { id: "movement", status: "warn", text: problem };
  if (!flag(field(def, "canmove")))
    return {
      id: "movement",
      status: "ok",
      text: t`This unit does not move.`,
    };
  const name = moveClassOf(def);
  return declaresMoveClass(game, name)
    ? { id: "movement", status: "ok", text: t`Movement class: ${name}.` }
    : {
        id: "movement",
        status: "warn",
        text: t`The game has no movement class ${name}, so the engine drops this unit at load.`,
      };
}

/** What does and does not fit, one row for each thing checked. */
export function gameFit(
  def: Record<string, unknown>,
  unitKey: string,
  game: GameFitData,
): FitRow[] {
  const movement = movementRow(def, game);
  return [
    armourRow(unitKey, game),
    categoryRow(def, game),
    ...(movement ? [movement] : []),
  ];
}
