/**
 * Putting a piece lifted from a game into a unit of parts (#3259).
 *
 * The module's meshes are copied into the unit's own geometry sidecar under
 * keys of their own (`moduleForUnit`), before the pieces go in. So the unit
 * owns its geometry the way an imported unit does: removing the module from
 * the inventory takes nothing from it, and the startup sweep keeps the file
 * because the unit's document names it.
 */

import { gzipSync } from "fflate";

import { legoGeometrySave } from "./bindings";
import { moduleForUnit, withMeshBoxes } from "./liftPiece";
import type { LegoProject } from "./model";
import {
  encodeRawGeometry,
  loadRawGeometry,
  loadRawGeometryIfAny,
  mergeRawGeometry,
  type RawGeometry,
} from "./rawGeometry";

/**
 * The module as it goes into the unit `unitId`, and the unit's geometry with
 * its meshes in. The geometry is null for a module of parts, which needs none.
 * Throws, saying why, when either sidecar cannot be read or written, and then
 * nothing has changed.
 */
export async function liftIntoUnit(
  unitId: string,
  module: LegoProject,
): Promise<{ module: LegoProject; raw: RawGeometry | null }> {
  const placed = moduleForUnit(module);
  if (placed.keys.size === 0) return { module: placed.module, raw: null };

  const raw = await copyMeshes(unitId, module.id, module.name, placed.keys);
  // The pieces take their boxes from the unit's meshes, which hold the keys
  // they now name. A module lifted before boxes were recorded gets them here.
  return {
    module: raw ? withMeshBoxes(placed.module, raw) : placed.module,
    raw,
  };
}

/**
 * Copy the meshes `keys` names out of the geometry file of `fromId` into the
 * unit `unitId`'s, and return the unit's geometry. Writes nothing when the unit
 * already holds them.
 */
async function copyMeshes(
  unitId: string,
  fromId: string,
  name: string,
  keys: ReadonlyMap<string, string>,
): Promise<RawGeometry | null> {
  // Read off the disk rather than taken from the view, so meshes that only
  // undone pieces still name are kept.
  const [own, from] = await Promise.all([
    loadRawGeometryIfAny(unitId),
    loadRawGeometry(fromId).catch((error: unknown) => {
      throw new Error(
        `The meshes of ${name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }),
  ]);
  const merged = mergeRawGeometry(own, from, keys);
  if (own && merged.byId.size === own.byId.size) return own;
  await legoGeometrySave({
    id: unitId,
    bytes: Array.from(gzipSync(encodeRawGeometry(merged))),
  });
  return merged;
}

/**
 * Write the geometry file of a module saved out of the unit `unitId` (#4344).
 *
 * The file is named after the module and holds exactly the meshes its pieces
 * name, copied out of the unit's own file under the keys they already have, so
 * the pieces need no rewriting. A module of parts needs none: null. Throws,
 * saying why, when either file cannot be read or written, and then the module
 * has not been saved.
 */
export async function saveModuleMeshes(
  unitId: string,
  module: LegoProject,
): Promise<RawGeometry | null> {
  const keys = new Map<string, string>();
  for (const piece of module.pieces) {
    if (piece.meshId) keys.set(piece.meshId, piece.meshId);
  }
  if (keys.size === 0) return null;

  const from = await loadRawGeometry(unitId).catch((error: unknown) => {
    throw new Error(
      `The meshes of ${module.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const raw = mergeRawGeometry(null, from, keys);
  if (raw.byId.size < keys.size) {
    throw new Error(
      `${module.name} names meshes this unit's geometry file does not hold.`,
    );
  }
  await legoGeometrySave({
    id: module.id,
    bytes: Array.from(gzipSync(encodeRawGeometry(raw))),
  });
  return raw;
}

/**
 * Give the unit `unitId` the meshes of pieces pasted into it (#4343).
 *
 * The pieces keep the mesh keys they had in the unit `sourceId` they were
 * copied from, so those meshes are copied across under the same keys. Null when
 * there is nothing to copy: the pieces draw no mesh, or they were copied from
 * this unit (or by a build that did not say), where the keys already resolve.
 * Throws, saying why, when a file cannot be read or written, and then nothing
 * has changed.
 */
export async function pasteIntoUnit(
  unitId: string,
  sourceId: string | undefined,
  pasted: LegoProject,
): Promise<RawGeometry | null> {
  if (!sourceId || sourceId === unitId) return null;
  const keys = new Map<string, string>();
  for (const piece of pasted.pieces) {
    if (piece.meshId) keys.set(piece.meshId, piece.meshId);
  }
  if (keys.size === 0) return null;
  return copyMeshes(unitId, sourceId, pasted.name, keys);
}
