/**
 * The build arm module, and what kind of builder a unit has become (issue
 * #3291).
 *
 * A module here is a compound: pieces that arrive together, dropped in with
 * `insertCompound`. The arm, its nozzle and its nano point belong together, so
 * this builds all four with their roles set and applies the presets that fit.
 *
 * The kind follows the engine's own definitions in `rts/Sim/Units/UnitDef.h`.
 * A builder is `builder && buildSpeed > 0 && buildDistance > 0`. It is mobile
 * unless it is immobile (`pathType == -1 && !canfly && speed <= 0`), and an
 * immobile builder is a factory when it also has a yardmap (`IsBuildingUnit` is
 * `IsImmobileUnit() && !yardmap.empty()`, `IsFactoryUnit` is that and
 * `IsBuilderUnit`). The yardmap is the only extra key a factory needs. The
 * builder writes none, so a built unit is a factory only once the game's file
 * for it has one.
 */

import { insertCompound } from "./compounds";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  pieceById,
} from "./model";
import { movesInGame } from "./movement";
import { type LegoPartInfo, partSize } from "./pack";
import { isBuilder } from "./unitDef";

export type BuilderKind = "mobile" | "static" | "factory";

/** The kind of builder, and the reason, in words that follow "because". */
export interface BuilderKindAnswer {
  kind: BuilderKind;
  reason: string;
}

function entryNamed(
  def: Record<string, unknown> | undefined,
  name: string,
): unknown {
  if (!def) return undefined;
  return Object.entries(def).find(([key]) => key.toLowerCase() === name)?.[1];
}

/**
 * What kind of builder the unit is, or null when it is not one.
 *
 * `gameDef` is the unit's definition as the game has it, which is where a
 * yardmap would come from: the file in the game, including what the workshop
 * wrote into it. Absent when the game has not read the unit.
 */
export function builderKind(
  project: LegoProject,
  gameDef?: Record<string, unknown>,
): BuilderKindAnswer | null {
  if (!isBuilder(project)) return null;
  const movement = project.movement;
  if (movesInGame(movement)) {
    return {
      kind: "mobile",
      reason: `it moves on ${movement.moveClass} at ${movement.speed}`,
    };
  }
  const yardmap = entryNamed(gameDef, "yardmap");
  if (typeof yardmap === "string" && yardmap !== "") {
    return { kind: "factory", reason: "it cannot move and has a yardmap" };
  }
  return {
    kind: "static",
    reason: movement?.moveClass.trim()
      ? "it has no speed"
      : "it has no movement class",
  };
}

/** How many units a line names before it counts the rest. */
const NAMED_UNITS = 4;

/** One line on what a builder builds, from its build list. */
export function buildsLine(options: string[]): string {
  if (options.length === 0) return "Builds nothing yet.";
  const named = options.slice(0, NAMED_UNITS).join(", ");
  const rest = options.length - NAMED_UNITS;
  const count = `${options.length} ${options.length === 1 ? "unit" : "units"}`;
  return rest > 0
    ? `Builds ${count}: ${named} and ${rest} more.`
    : `Builds ${count}: ${named}.`;
}

/** The three parts of geometry the arm is made from. */
export interface ArmParts {
  base: LegoPartInfo;
  arm: LegoPartInfo;
  nozzle: LegoPartInfo;
}

/** The length the arm's beam is chosen to be nearest to, in part units. */
const ARM_LENGTH = 2;

/**
 * Parts for the arm out of whatever pack is loaded: the smallest block for the
 * base, the beam nearest two long for the arm and the shortest beam for the
 * nozzle. Null when the pack has no block or no beam.
 */
export function pickArmParts(parts: LegoPartInfo[]): ArmParts | null {
  const bySize = (a: LegoPartInfo, b: LegoPartInfo) =>
    partSize(a) - partSize(b);
  const blocks = parts.filter((part) => part.shape === "block").sort(bySize);
  const beams = parts.filter((part) => part.shape === "beam").sort(bySize);
  const base = blocks[0];
  const nozzle = beams[0];
  if (!base || !nozzle) return null;
  const arm = [...beams].sort(
    (a, b) =>
      Math.abs(partSize(a) - ARM_LENGTH) - Math.abs(partSize(b) - ARM_LENGTH) ||
      bySize(a, b),
  )[0];
  return { base, arm, nozzle };
}

function height(part: LegoPartInfo): number {
  return part.bbox.max[1] - part.bbox.min[1];
}

/**
 * The module: a base, an arm on it, a nozzle on the arm and an empty nano point
 * at the nozzle's end, stacked upward. The first piece is the compound's root.
 */
export function buildArmModule(
  parts: ArmParts,
  newId: () => string,
  now: string,
): LegoProject {
  const ids = {
    base: newId(),
    arm: newId(),
    nozzle: newId(),
    nano: newId(),
  };
  const piece = (
    id: string,
    name: string,
    parentId: string | null,
    partId: string | null,
    role: string,
    y: number,
  ): LegoPiece => ({
    id,
    name,
    parentId,
    partId,
    position: [0, y, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    role,
  });
  const empty = newProject({
    id: newId(),
    rootPieceId: ids.base,
    name: "Build arm",
    packId: parts.base.packId,
    packVersion: "",
    now,
  });
  return {
    ...empty,
    pieces: [
      piece(ids.base, "buildbase", null, parts.base.id, "buildarm.base", 0),
      piece(
        ids.arm,
        "buildarm",
        ids.base,
        parts.arm.id,
        "buildarm.arm",
        (height(parts.base) + height(parts.arm)) / 2,
      ),
      piece(
        ids.nozzle,
        "nozzle",
        ids.arm,
        parts.nozzle.id,
        "buildarm.nozzle",
        (height(parts.arm) + height(parts.nozzle)) / 2,
      ),
      piece(
        ids.nano,
        "nano1",
        ids.nozzle,
        null,
        "buildarm.nano",
        height(parts.nozzle) / 2,
      ),
    ],
  };
}

/**
 * Put the module on a unit and apply the presets that go with it, as one
 * change.
 *
 * A factory is handed nothing to aim at, because it builds inside itself, so it
 * gets the nano preset alone. Any other builder also gets the aim preset. A
 * preset the unit already has stays as it is, settings and all.
 */
export function addBuildArm(
  project: LegoProject,
  parts: ArmParts,
  options: {
    parentId: string;
    factory: boolean;
    newId: () => string;
    now: string;
  },
): { project: LegoProject; rootPieceIds: string[] } {
  const parentId = pieceById(project, options.parentId)
    ? options.parentId
    : project.rootPieceId;
  const inserted = insertCompound(
    project,
    buildArmModule(parts, options.newId, options.now),
    parentId,
    options.newId,
  );
  const wanted = options.factory ? ["build.nano"] : ["build.aim", "build.nano"];
  const applied = inserted.project.animations ?? [];
  const added = wanted
    .filter((id) => !applied.some((entry) => entry.presetId === id))
    .map((presetId) => ({ presetId, params: {} }));
  return {
    project: { ...inserted.project, animations: [...applied, ...added] },
    rootPieceIds: inserted.rootPieceIds,
  };
}
