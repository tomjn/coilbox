/**
 * Locking a loadout or a module until a campaign grants it (#3289).
 *
 * A lock is data for a mission and nothing more. It never reaches a model, a
 * script or a unit definition, so a locked unit is a normal exported unit.
 * The mission side is the runtime's `restrictions.buildable` list and its
 * `unlock_unit` action, which already work on any unit definition name: the
 * game maker puts the locked names on the list and grants them mid mission.
 *
 * A loadout is locked when it is marked itself, or when it holds a module the
 * unit has locked. The chassis is held by every loadout, so a locked module on
 * the chassis locks them all. A unit without loadouts is locked by its modules
 * alone.
 */

import { t } from "@lingui/core/macro";
import { receiptFor } from "./exportRecord";
import { loadoutUnit, loadoutUnitNames } from "./loadouts";
import type { LegoProject } from "./model";

/** What locks one unit a project exports: a loadout, or the whole unit when it
 *  has none. */
export interface UnitLock {
  /** Null for a unit without loadouts. */
  loadoutId: string | null;
  /** The unit definition name it exports under. */
  unitName: string;
  locked: boolean;
  /** The loadout is marked locked itself. Never true without loadouts. */
  own: boolean;
  /** The locked modules it holds, by module id. */
  modules: string[];
}

/** The ids of the modules in `project`'s pieces, once each, in the order met. */
function moduleIds(project: LegoProject): string[] {
  const ids = new Set<string>();
  for (const piece of project.pieces) {
    if (piece.module) ids.add(piece.module.id);
  }
  return [...ids];
}

/**
 * Every module the unit holds in any of its loadouts, once each. What the
 * builder offers a lock for.
 */
export function heldModules(project: LegoProject): string[] {
  const ids = new Set<string>();
  for (const loadout of project.loadouts ?? []) {
    const unit = loadoutUnit(project, loadout.id);
    for (const id of moduleIds(unit ?? project)) ids.add(id);
  }
  for (const id of moduleIds(project)) ids.add(id);
  return [...ids];
}

/** Each unit the project exports, and whether and why it is locked. */
export function unitLocks(project: LegoProject): UnitLock[] {
  const locked = new Set(project.lockedModules ?? []);
  const causes = (unit: LegoProject) =>
    moduleIds(unit).filter((id) => locked.has(id));
  if (!project.loadouts) {
    const modules = causes(project);
    return [
      {
        loadoutId: null,
        unitName: project.unitName,
        locked: modules.length > 0,
        own: false,
        modules,
      },
    ];
  }
  const names = loadoutUnitNames(project);
  return project.loadouts.map((loadout) => {
    const unit = loadoutUnit(project, loadout.id);
    const modules = unit ? causes(unit) : [];
    const own = loadout.locked === true;
    return {
      loadoutId: loadout.id,
      unitName: names.get(loadout.id) ?? project.unitName,
      locked: own || modules.length > 0,
      own,
      modules,
    };
  });
}

/** The unit definition names that are locked, in loadout order. */
export function lockedUnitNames(project: LegoProject): string[] {
  return unitLocks(project)
    .filter((lock) => lock.locked)
    .map((lock) => lock.unitName);
}

/**
 * Short text for why a unit is locked, naming the modules that lock it, or null
 * when it is free.
 */
export function lockReason(
  lock: UnitLock,
  moduleName: (id: string) => string,
): string | null {
  if (!lock.locked) return null;
  if (lock.modules.length === 0) return "Locked";
  const by = `by ${lock.modules.map(moduleName).join(", ")}`;
  return lock.own ? `Locked, and ${by}` : `Locked ${by}`;
}

/** Lock loadout `id`, or free it. Its modules may still lock it. */
export function setLoadoutLocked(
  project: LegoProject,
  id: string,
  locked: boolean,
): LegoProject {
  const loadouts = project.loadouts;
  if (!loadouts?.some((l) => l.id === id && (l.locked === true) !== locked))
    return project;
  return {
    ...project,
    loadouts: loadouts.map((l) => {
      if (l.id !== id) return l;
      const { locked: _was, ...rest } = l;
      return locked ? { ...rest, locked: true as const } : rest;
    }),
  };
}

/** Lock a module for this unit, or free it. Every loadout holding it follows. */
export function setModuleLocked(
  project: LegoProject,
  moduleId: string,
  locked: boolean,
): LegoProject {
  const was = project.lockedModules ?? [];
  if (was.includes(moduleId) === locked) return project;
  const now = locked ? [...was, moduleId] : was.filter((id) => id !== moduleId);
  const { lockedModules: _old, ...rest } = project;
  return now.length > 0 ? { ...rest, lockedModules: now } : rest;
}

/** Where the list is written, relative to the game folder. One file for each
 *  chassis, so two units exported into one game never overwrite each other. */
export function lockedListPath(project: LegoProject): string {
  return `luarules/configs/coilbox_locked_units/${project.unitName}.lua`;
}

/**
 * The list as a Lua file a game or a mission can read with `VFS.Include`: a
 * table of unit definition names. Empty when nothing is locked, which is how a
 * list written earlier is cleared.
 */
export function lockedListText(project: LegoProject): string {
  return listText(lockedUnitNames(project));
}

/** The list with nothing in it, which is what a list is cleared to. */
export const EMPTY_LOCKED_LIST = listText([]);

function listText(names: string[]): string {
  const rows = names.map((name) => `\t${JSON.stringify(name)},\n`);
  return [
    "-- Written by coilbox. The units of this chassis a campaign unlocks.",
    "-- Put them on a mission's buildable list and grant them with unlock_unit.",
    `return {\n${rows.join("")}}\n`,
  ].join("\n");
}

/** A locked unit exported into a game, as the scenario editor's picker offers it. */
export interface LockedUnit {
  name: string;
  /** Where it came from, such as "Heavy of Pawn". */
  label: string;
}

/**
 * The locked units of `projects` that were exported into the game at
 * `gameFolder`, by the name each has there. Only those: a name the game has no
 * unit for would restrict nothing.
 */
export function lockedExportedUnits(
  projects: readonly LegoProject[],
  gameFolder: string | undefined,
): LockedUnit[] {
  if (!gameFolder) return [];
  const out: LockedUnit[] = [];
  for (const project of projects) {
    const loadouts = project.loadouts;
    for (const lock of unitLocks(project)) {
      if (!lock.locked) continue;
      const entry = loadouts?.find((l) => l.id === lock.loadoutId);
      const receipt = receiptFor(entry ?? project, gameFolder);
      if (!receipt) continue;
      const loadoutName = entry?.name ?? "";
      const projectName = project.name;
      out.push({
        name: receipt.unitName.toLowerCase(),
        label: entry ? t`${loadoutName} of ${projectName}` : projectName,
      });
    }
  }
  return out;
}
