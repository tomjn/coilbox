import { roleLabel } from "./animPresets";
import { childrenOf, type LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { bakedPieces } from "./s3oBuild";

/** One bone of a unit's skeleton, placed in the unit's space. */
export interface SkeletonJoint {
  pieceId: string;
  /** The bone's role as the animation panel names it, or its piece name when
   *  it has none. */
  label: string;
  /** The bone's origin. */
  at: [number, number, number];
  /** The origin of the piece it hangs from, or null for the root. */
  parentAt: [number, number, number] | null;
}

/**
 * Every bone of a unit with a skeleton, where it rests, for the viewport to
 * draw (#3247). A piece that is not a bone is left out, but still carries the
 * bones under it.
 */
export function skeletonJoints(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): SkeletonJoint[] {
  if (!project.skeleton) return [];
  const { pieces } = bakedPieces(project, pack, raw);
  const joints: SkeletonJoint[] = [];

  const walk = (pieceId: string, parentAt: [number, number, number] | null) => {
    const baked = pieces.get(pieceId);
    const piece = project.pieces.find((p) => p.id === pieceId);
    if (!baked || !piece) return;
    const [x, y, z] = parentAt ?? [0, 0, 0];
    const at: [number, number, number] = [
      x + baked.offset[0],
      y + baked.offset[1],
      z + baked.offset[2],
    ];
    if (piece.bone !== undefined) {
      joints.push({
        pieceId,
        label: piece.role ? roleLabel(piece.role) : piece.name,
        at,
        parentAt,
      });
    }
    for (const child of childrenOf(project, pieceId)) walk(child.id, at);
  };

  walk(project.rootPieceId, null);
  return joints;
}
