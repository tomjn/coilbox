/**
 * Adding a generated shape from the parts strip (#3337).
 *
 * Lands where `addPart` in the builder puts a part: a new piece at its parent's
 * origin, hanging off whatever is selected. Only the kind and its numbers are
 * stored, as `shapes.ts` describes.
 */

import { type LegoProject, uniquePieceName } from "./model";
import type { LoadedPack } from "./pack";
import { mostUsedSwatch } from "./roundShape";
import type { LegoShape, ShapeKind } from "./shapes";
import type { Vec3 } from "./snapping";
import { addShapePiece } from "./wheelAxle";

/**
 * The numbers a new shape of this kind starts with, or null when the pack lists
 * no swatches, which means it offers no shapes. It takes the colourway most of
 * the unit's parts use, or the pack's first swatch when none has one.
 */
export function newShape(
  project: LegoProject,
  info: ShapeKind,
  pack: Pick<LoadedPack, "manifest" | "byId">,
): LegoShape | null {
  const swatches = pack.manifest.swatches ?? [];
  if (swatches.length === 0) return null;
  return {
    kind: info.kind,
    size: [...info.size],
    swatch: mostUsedSwatch(project, pack, swatches),
    ...(info.options ? { options: { ...info.options } } : {}),
  };
}

/**
 * The project with a new shape of this kind added under `parentId`, at the
 * parent's origin unless given a `position` in the parent's axes, or null when
 * `newShape` is. A round shape landing at or under a wheel is turned to spin
 * about its axle.
 */
export function addShape(
  project: LegoProject,
  info: ShapeKind,
  pack: Pick<LoadedPack, "manifest" | "byId">,
  parentId: string,
  pieceId: string,
  position: Vec3 = [0, 0, 0],
): LegoProject | null {
  const shape = newShape(project, info, pack);
  if (!shape) return null;
  return addShapePiece(project, {
    id: pieceId,
    name: uniquePieceName(
      info.id,
      project.pieces.map((piece) => piece.name),
    ),
    parentId,
    partId: null,
    shape,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
}
