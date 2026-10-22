/**
 * The weapon module, and the `weapons` table it writes (issue #3274).
 *
 * A module is a compound, like the build arm (`buildArm.ts`): a turret, a
 * barrel pointing forward and a muzzle flare at its end, dropped in with
 * `insertCompound`. What it fires is kept on the turret piece, so a copy or a
 * mirrored twin of the turret fires the same weapon.
 *
 * Slot n of the definition is the nth turret or aim point, in piece order, that
 * has a weapon picked. The builder derives the slots and nothing else (#3313).
 *
 * A game weapon is named as it stands. The slot carries the name in both keys
 * a game reads: `name`, which the engine looks up, and `def`, which Beyond All
 * Reason's `gamedata/weapondefs_post.lua` calls `:lower()` on for every slot
 * and so needs to be a string. Splinter Faction's and Balanced Annihilation's
 * post files only rename a slot when `<unit>_<def>` is one of the unit's own
 * weapons, so a game weapon's name passes through all three untouched.
 *
 * A library weapon is a reference into a workshop project, not a copy. The
 * workshop is where weapon definitions are edited (#3313), so every export
 * reads the weapon again and writes it as `weapons/coilbox_<unit>_<key>.lua`,
 * the same file and the same full name `<unit>_<key>` the workshop's own
 * compile writes for an equipped weapon (`weapon_file` in `compile.rs`). The
 * base content's `gamedata/weapondefs.lua` reads every `weapons/*.lua` into
 * the weapon table, and Splinter Faction, Balanced Annihilation and Beyond All
 * Reason all use it, so the slot finds the weapon there. A reference whose
 * project or weapon is gone is left out of the slots and reported.
 */

import { t } from "@lingui/core/macro";
import { describeError } from "@/i18n/uiError";
import type { CompiledMod } from "@/workshop/compile";
import { type WeaponInput, weaponStats } from "@/workshop/derivedStats";
import { EMPTY_EDITS, type ModProject } from "@/workshop/project";
import { libraryWeaponDef } from "@/workshop/weaponLibrary";
import { insertCompound } from "./compounds";
import { yawArc, yawRange } from "./jointLimits";
import {
  type LegoPiece,
  type LegoPieceLimits,
  type LegoPieceWeapon,
  type LegoProject,
  type LegoWeaponRef,
  newProject,
  pieceById,
} from "./model";
import { type LegoPartInfo, partSize } from "./pack";

/** The roles a weapon is mounted on. */
export const WEAPON_ROLES = ["turret", "aim"];

/** Every piece that can carry a weapon, in piece order. */
export function weaponCarriers(project: LegoProject): LegoPiece[] {
  return project.pieces.filter(
    (piece) => piece.role !== undefined && WEAPON_ROLES.includes(piece.role),
  );
}

/** One weapon the definition will name. */
export interface MountedWeapon {
  piece: LegoPiece;
  weapon: LegoPieceWeapon;
  fires: LegoWeaponRef;
}

/** The carriers that fire something, in slot order. */
export function mountedWeapons(project: LegoProject): MountedWeapon[] {
  return weaponCarriers(project).flatMap((piece) => {
    const fires = piece.weapon?.fires;
    return piece.weapon && fires
      ? [{ piece, weapon: piece.weapon, fires }]
      : [];
  });
}

/** A weapon as the unit script sees it: the pieces that are its own. */
export interface ScriptWeapon {
  /** The turret or aim point it is on, null on a unit that has neither. */
  carrier: LegoPiece | null;
  barrel: LegoPiece | null;
  flare: LegoPiece | null;
}

/**
 * The weapons the generated script writes call-ins for, in slot order, so
 * `AimWeapon<n>` and slot n of the `weapons` table are the same weapon.
 *
 * Before any weapon is picked, every carrier is numbered in piece order, so the
 * preview can aim each turret while the unit is being built. A unit with no
 * carrier at all gets one weapon, which is what the script wrote before it
 * wrote more than one.
 *
 * A barrel or flare belongs to the nearest carrier above it in the tree, which
 * is how the Weapon button inserts them. One with no carrier above it goes to
 * the first weapon still without one, in piece order, so a hand-built unit
 * whose barrel sits beside its turret still has it.
 */
export function scriptWeapons(project: LegoProject): ScriptWeapon[] {
  const carriers = weaponCarriers(project);
  const picked = mountedWeapons(project).map((mounted) => mounted.piece);
  const slots: (LegoPiece | null)[] =
    picked.length > 0 ? picked : carriers.length > 0 ? carriers : [null];
  const carrierIds = new Set(carriers.map((piece) => piece.id));

  const owner = (piece: LegoPiece): string | null => {
    const seen = new Set<string>();
    let parentId = piece.parentId;
    while (parentId && !seen.has(parentId)) {
      if (carrierIds.has(parentId)) return parentId;
      seen.add(parentId);
      parentId = pieceById(project, parentId)?.parentId ?? null;
    }
    return null;
  };

  const weapons: ScriptWeapon[] = slots.map((carrier) => ({
    carrier,
    barrel: null,
    flare: null,
  }));
  for (const role of ["barrel", "flare"] as const) {
    const pieces = project.pieces.filter((piece) => piece.role === role);
    const loose = pieces.filter((piece) => owner(piece) === null);
    for (const weapon of weapons) {
      const own = weapon.carrier
        ? pieces.find((piece) => owner(piece) === weapon.carrier?.id)
        : undefined;
      weapon[role] = own ?? loose.shift() ?? null;
    }
  }
  return weapons;
}

/** The full name a library weapon has on `unit`, as the workshop gives it. */
export function libraryWeaponName(unit: string, key: string): string {
  return `${unit.toLowerCase()}_${key}`;
}

/** What a slot names its weapon by. See the module comment for why both. */
export function slotTarget(
  unit: string,
  fires: LegoWeaponRef,
): { def: string; name: string } {
  if (fires.from === "game") {
    const name = fires.name.toLowerCase();
    return { def: name, name };
  }
  return { def: fires.key, name: libraryWeaponName(unit, fires.key) };
}

/**
 * The arc keys, or none for a full circle, which is the engine's default.
 *
 * `maxAngleDif` is the full width in degrees (`UnitDefWeapon` in
 * `UnitDef.cpp`). `mainDir` is in the unit's own space, x mapped onto
 * `rightdir` (`GetObjectSpaceVec`, `SolidObject.h:232`), so a positive heading
 * turns it to the unit's right.
 *
 * A yaw range on the weapon's turret (#3353) is the arc: its width and middle
 * replace the weapon's own arc and facing, so the engine refuses the same
 * targets the script does. A range of a full turn or more limits nothing and
 * leaves the weapon's own fields in force.
 */
export function arcFields(
  weapon: LegoPieceWeapon,
  limits?: LegoPieceLimits,
): Record<string, unknown> {
  const yaw = yawRange(limits);
  const own = yaw ? yawArc(yaw) : { arc: weapon.arc, heading: weapon.heading };
  const arc = own.arc;
  if (arc === undefined || arc >= 360) return {};
  const radians = ((own.heading ?? 0) * Math.PI) / 180;
  const round = (n: number) => String(Number(n.toFixed(3)) || 0);
  return {
    maxangledif: Math.max(0, arc),
    maindir: `${round(Math.sin(radians))} 0 ${round(Math.cos(radians))}`,
  };
}

/** What an export writes for the unit's weapons. */
export interface WeaponExportPlan {
  /** The `weapons` table, in slot order. */
  slots: Record<string, unknown>[];
  /** Library weapons to write a file for, with the project each is read from. */
  files: { key: string; project: ModProject }[];
  /** A line for each weapon left out, and why. */
  missing: string[];
}

/** The slots and weapon files for an export, from the workshop's projects. */
export function weaponExportPlan(
  project: LegoProject,
  projects: readonly ModProject[],
): WeaponExportPlan {
  const plan: WeaponExportPlan = { slots: [], files: [], missing: [] };
  for (const { piece, weapon, fires } of mountedWeapons(project)) {
    if (fires.from === "library") {
      const source = projects.find((p) => p.id === fires.projectId);
      const key = fires.key;
      if (!source) {
        plan.missing.push(t`${key}: its workshop project is gone.`);
        continue;
      }
      const sourceName = source.name;
      if (!source.edits.weapons?.[fires.key]) {
        plan.missing.push(t`${key} is no longer in ${sourceName}.`);
        continue;
      }
      // One file per name on this unit, so two projects cannot both have one.
      const taken = plan.files.find((file) => file.key === fires.key);
      if (taken && taken.project.id !== source.id) {
        const takenName = taken.project.name;
        plan.missing.push(
          t`${key} from ${sourceName}: ${takenName} has a weapon of the same name on this unit.`,
        );
        continue;
      }
      if (!taken) plan.files.push({ key: fires.key, project: source });
    }
    plan.slots.push({
      ...slotTarget(project.unitName, fires),
      ...arcFields(weapon, piece.limits),
    });
  }
  return plan;
}

/** The file the workshop writes library weapon `key` on `unit` into. */
export function weaponFileName(unit: string, key: string): string {
  return `coilbox_${unit.toLowerCase()}_${key}.lua`;
}

/**
 * A project to hand the workshop's compiler for one weapon file: the source
 * project's library, and that weapon equipped on the unit. Compiling it writes
 * the file the workshop itself would, supporting weapons and all, so there is
 * one writer of weapon definitions rather than two.
 */
export function weaponFileProject(
  unit: string,
  key: string,
  source: ModProject,
): ModProject {
  const { readOnlyLua: _lua, ...rest } = source;
  return {
    ...rest,
    edits: {
      ...EMPTY_EDITS,
      weapons: source.edits.weapons,
      equipped: { [unit.toLowerCase()]: { "0": key } },
    },
  };
}

/** The weapon file out of a compile, or null when it wrote none. */
export function pickWeaponFile(
  compiled: CompiledMod,
  unit: string,
  key: string,
): string | null {
  const path = `weapons/${weaponFileName(unit, key)}`;
  return compiled.files.find((file) => file.path === path)?.contents ?? null;
}

/** One weapon the picker offers. */
export interface WeaponOption {
  ref: LegoWeaponRef;
  label: string;
  /** The project's name for a library weapon, the game's for a game weapon. */
  group: string;
  def: Record<string, unknown>;
}

/**
 * Everything a module on this game can fire: each workshop project's library
 * for the game first, since those are the game maker's own, then the game's
 * weapon table, each sorted by name.
 */
export function weaponOptions(
  gameName: string,
  weaponDefs: Record<string, Record<string, unknown>>,
  projects: readonly ModProject[],
): WeaponOption[] {
  const byLabel = (a: WeaponOption, b: WeaponOption) =>
    a.label.localeCompare(b.label);
  const library = projects
    .filter((p) => p.gameName === gameName)
    .flatMap((p) =>
      Object.values(p.edits.weapons ?? {})
        .map(
          (weapon): WeaponOption => ({
            ref: { from: "library", projectId: p.id, key: weapon.key },
            label: weapon.key,
            group: p.name,
            def: libraryWeaponDef(weapon),
          }),
        )
        .sort(byLabel),
    );
  const game = Object.entries(weaponDefs)
    .map(
      ([name, def]): WeaponOption => ({
        ref: { from: "game", name },
        label: name,
        group: gameName,
        def,
      }),
    )
    .sort(byLabel);
  return [...library, ...game];
}

/** Whether two references name the same weapon. */
export function sameWeapon(a: LegoWeaponRef, b: LegoWeaponRef): boolean {
  if (a.from === "game" && b.from === "game")
    return a.name.toLowerCase() === b.name.toLowerCase();
  if (a.from === "library" && b.from === "library")
    return a.projectId === b.projectId && a.key === b.key;
  return false;
}

/** A picked weapon's definition, or why there is none to show. */
export function pickedWeapon(
  ref: LegoWeaponRef,
  gameName: string,
  weaponDefs: Record<string, Record<string, unknown>> | null,
  projects: readonly ModProject[],
): { def: Record<string, unknown> } | { problem: string } | null {
  if (ref.from === "library") {
    const source = projects.find((p) => p.id === ref.projectId);
    if (!source) return { problem: t`Its workshop project is gone.` };
    const weapon = source.edits.weapons?.[ref.key];
    if (!weapon) {
      const sourceName = source.name;
      return { problem: t`No longer in ${sourceName}.` };
    }
    return { def: libraryWeaponDef(weapon) };
  }
  // Nothing to say until the game is read.
  if (!weaponDefs) return null;
  const def = weaponDefs[ref.name.toLowerCase()];
  return def
    ? { def }
    : { problem: t`${gameName} has no weapon of that name.` };
}

/** What an export writes for the unit's weapons, files and all. */
export interface ExportedWeapons {
  slots: Record<string, unknown>[];
  files: { name: string; contents: string }[];
  missing: string[];
}

/**
 * The plan with each library weapon compiled into its file. `compile` is the
 * workshop's compiler. A weapon it writes no file for is left out of the slots,
 * so no slot names a weapon the game will not have.
 */
export async function exportWeapons(
  project: LegoProject,
  projects: readonly ModProject[],
  compile: (project: ModProject) => Promise<CompiledMod>,
): Promise<ExportedWeapons> {
  const plan = weaponExportPlan(project, projects);
  const unit = project.unitName;
  const files: ExportedWeapons["files"] = [];
  const failed = new Set<string>();
  const missing = [...plan.missing];
  for (const { key, project: source } of plan.files) {
    let contents: string | null = null;
    let reason = t`the workshop wrote no file for it`;
    try {
      contents = pickWeaponFile(
        await compile(weaponFileProject(unit, key, source)),
        unit,
        key,
      );
    } catch (error) {
      reason = describeError(error);
    }
    if (contents === null) {
      failed.add(libraryWeaponName(unit, key));
      const sourceName = source.name;
      missing.push(t`${key} from ${sourceName}: ${reason}.`);
    } else {
      files.push({ name: weaponFileName(unit, key), contents });
    }
  }
  return {
    slots: plan.slots.filter((slot) => !failed.has(String(slot.name))),
    files,
    missing,
  };
}

/** What the scratch game is given for the unit's weapons. */
export interface ScratchWeapons extends ExportedWeapons {
  /** The unit without the game weapons the test game does not have. */
  project: LegoProject;
  /** A line for each weapon left out, library and game alike. */
  leftOut: string[];
}

/**
 * The weapons a test game is written with: the export's own slots and files
 * (`exportWeapons`), after leaving out each game weapon `gameWeapons` does not
 * hold, so the scratch unit never names a weapon the game cannot find. Null
 * `gameWeapons` means the game has not been read, and nothing is left out.
 */
export async function scratchWeapons(
  project: LegoProject,
  projects: readonly ModProject[],
  gameWeapons: Record<string, Record<string, unknown>> | null,
  compile: (project: ModProject) => Promise<CompiledMod>,
): Promise<ScratchWeapons> {
  const absent: string[] = [];
  const pieces = project.pieces.map((piece) => {
    const fires = piece.weapon?.fires;
    if (
      !piece.weapon ||
      !fires ||
      fires.from !== "game" ||
      !gameWeapons ||
      gameWeapons[fires.name.toLowerCase()]
    ) {
      return piece;
    }
    const weaponName = fires.name;
    absent.push(t`${weaponName} (not in this game).`);
    const { fires: _fires, ...weapon } = piece.weapon;
    return { ...piece, weapon };
  });
  const armed = absent.length > 0 ? { ...project, pieces } : project;
  const exported = await exportWeapons(armed, projects, compile);
  return {
    ...exported,
    project: armed,
    leftOut: [...absent, ...exported.missing],
  };
}

function figure(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** Range, damage and reload in one line, from `weaponStats`. */
export function weaponSummary(def: WeaponInput["def"]): string {
  const stats = weaponStats({ def });
  const range = figure(stats.range);
  const reload = figure(stats.cycleSeconds);
  if (stats.alphaDamage !== null) {
    const damage = figure(stats.alphaDamage);
    return t`Range ${range}, ${damage} damage, reloads in ${reload}s`;
  }
  const omitted = String(stats.omitted);
  return t`Range ${range}, no damage (${omitted}), reloads in ${reload}s`;
}

/** The two parts of geometry the module is made from. */
export interface WeaponParts {
  turret: LegoPartInfo;
  barrel: LegoPartInfo;
}

/** The length the barrel's beam is chosen to be nearest to, in part units. */
const BARREL_LENGTH = 2;

/**
 * Parts for the module out of whatever pack is loaded: the smallest block for
 * the turret and the beam nearest two long for the barrel. Null when the pack
 * has no block or no beam.
 */
export function pickWeaponParts(parts: LegoPartInfo[]): WeaponParts | null {
  const bySize = (a: LegoPartInfo, b: LegoPartInfo) =>
    partSize(a) - partSize(b);
  const turret = parts.filter((p) => p.shape === "block").sort(bySize)[0];
  const barrel = parts
    .filter((p) => p.shape === "beam")
    .sort(
      (a, b) =>
        Math.abs(partSize(a) - BARREL_LENGTH) -
          Math.abs(partSize(b) - BARREL_LENGTH) || bySize(a, b),
    )[0];
  return turret && barrel ? { turret, barrel } : null;
}

function extent(part: LegoPartInfo, axis: 0 | 1 | 2): number {
  return part.bbox.max[axis] - part.bbox.min[axis];
}

/**
 * The module: a turret, a barrel on it and an empty flare at the barrel's end.
 * A beam's length runs along y, so the barrel is turned a quarter about x to
 * point it along +z, the unit's front. The flare hangs off the barrel, so it is
 * placed along the barrel's own length. The first piece is the compound's root.
 */
export function buildWeaponModule(
  parts: WeaponParts,
  newId: () => string,
  now: string,
): LegoProject {
  const ids = { turret: newId(), barrel: newId(), flare: newId() };
  const length = extent(parts.barrel, 1);
  const piece = (
    id: string,
    name: string,
    parentId: string | null,
    partId: string | null,
    role: string,
    position: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0],
  ): LegoPiece => ({
    id,
    name,
    parentId,
    partId,
    position,
    rotation,
    scale: [1, 1, 1],
    role,
  });
  const empty = newProject({
    id: newId(),
    rootPieceId: ids.turret,
    name: "Weapon",
    packId: parts.turret.packId,
    packVersion: "",
    now,
  });
  return {
    ...empty,
    pieces: [
      {
        ...piece(
          ids.turret,
          "turret",
          null,
          parts.turret.id,
          "turret",
          [0, 0, 0],
        ),
        weapon: {},
      },
      piece(
        ids.barrel,
        "barrel",
        ids.turret,
        parts.barrel.id,
        "barrel",
        [0, 0, extent(parts.turret, 2) / 2 + length / 2],
        [Math.PI / 2, 0, 0],
      ),
      piece(ids.flare, "flare", ids.barrel, null, "flare", [0, length / 2, 0]),
    ],
  };
}

/**
 * The module id the pieces of a generated weapon record (#3302), fixed for the
 * same reason as `BUILD_ARM_ID`.
 */
export const WEAPON_ID = "generated:weapon";

/**
 * Put the module on a unit and apply the turret sweep and recoil presets, as
 * one change. A preset the unit already has stays as it is.
 */
export function addWeaponModule(
  project: LegoProject,
  parts: WeaponParts,
  options: { parentId: string; newId: () => string; now: string },
): { project: LegoProject; rootPieceIds: string[] } {
  const parentId = pieceById(project, options.parentId)
    ? options.parentId
    : project.rootPieceId;
  const inserted = insertCompound(
    project,
    { ...buildWeaponModule(parts, options.newId, options.now), id: WEAPON_ID },
    parentId,
    options.newId,
    true,
  );
  const applied = inserted.project.animations ?? [];
  const added = ["turret.track", "recoil"]
    .filter((id) => !applied.some((entry) => entry.presetId === id))
    .map((presetId) => ({ presetId, params: {} }));
  return {
    project: { ...inserted.project, animations: [...applied, ...added] },
    rootPieceIds: inserted.rootPieceIds,
  };
}
