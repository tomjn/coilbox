/**
 * Adding a generated shape from the parts strip (#3337).
 *
 * Lands where `addPart` in the builder puts a part: a new piece at its parent's
 * origin, hanging off whatever is selected. Only the kind and its numbers are
 * stored, as `shapes.ts` describes.
 */

import { type LegoProject, uniquePieceName } from "./model";
import type { ShapeKind } from "./shapes";

export function addShape(
  project: LegoProject,
  info: ShapeKind,
  parentId: string,
  pieceId: string,
): LegoProject {
  return {
    ...project,
    pieces: [
      ...project.pieces,
      {
        id: pieceId,
        name: uniquePieceName(
          info.label,
          project.pieces.map((piece) => piece.name),
        ),
        parentId,
        partId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        shape: {
          kind: info.kind,
          size: [...info.size],
          ...(info.options ? { options: { ...info.options } } : {}),
        },
      },
    ],
  };
}
