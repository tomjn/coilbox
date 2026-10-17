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
import { moduleForUnit } from "./liftPiece";
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

  // Read off the disk rather than taken from the view, so meshes that only
  // undone pieces still name are kept.
  const [own, from] = await Promise.all([
    loadRawGeometryIfAny(unitId),
    loadRawGeometry(module.id).catch((error: unknown) => {
      throw new Error(
        `The meshes of ${module.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }),
  ]);
  const merged = mergeRawGeometry(own, from, placed.keys);
  if (own && merged.byId.size === own.byId.size) {
    return { module: placed.module, raw: own };
  }
  await legoGeometrySave({
    id: unitId,
    bytes: Array.from(gzipSync(encodeRawGeometry(merged))),
  });
  return { module: placed.module, raw: merged };
}
