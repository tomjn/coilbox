import { roleLabel } from "./animPresets";
import { boneEnd } from "./boneEnd";
import { childrenOf, type LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { type BakedPiece, bakedPieces } from "./s3oBuild";

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
  /** The piece it hangs from, or null for the root. A piece that is not a bone
   *  can stand between two bones, so this is not always a joint. */
  parentId: string | null;
  /** Where the geometry skeleton's bone ends: the far end of the piece's own
   *  geometry, in the piece's own space and in the unit's. Absent on a bone of
   *  a real skeleton, and on an empty piece, which has no geometry. */
  reach?: { local: [number, number, number]; at: [number, number, number] };
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

  const walk = (
    pieceId: string,
    parentAt: [number, number, number] | null,
    parentId: string | null,
  ) => {
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
        parentId,
      });
    }
    for (const child of childrenOf(project, pieceId))
      walk(child.id, at, pieceId);
  };

  walk(project.rootPieceId, null, null);
  return joints;
}

/**
 * The far end of a piece's geometry in its own space, or null for a piece with
 * none. The box is the baked vertices' min and max, which is what the engine
 * reports as the piece's `min` and `max` for the s3o written from the same
 * bake, so the bone ends where the widget's does in a game.
 */
export function pieceReach(
  baked: Pick<BakedPiece, "vertices">,
): [number, number, number] | null {
  if (baked.vertices.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of baked.vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis] as number, pos[axis] as number);
      max[axis] = Math.max(max[axis] as number, pos[axis] as number);
    }
  }
  return boneEnd(min, max);
}

/**
 * The geometry skeleton of a unit with no skeleton (#5183): every piece is a
 * joint named for its piece, with a bone from its origin to the far end of its
 * own geometry, by the rule the in-game widget uses. An empty piece is a joint
 * with no bone.
 */
export function geometryJoints(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): SkeletonJoint[] {
  const { pieces } = bakedPieces(project, pack, raw);
  const joints: SkeletonJoint[] = [];

  const walk = (
    pieceId: string,
    parentAt: [number, number, number] | null,
    parentId: string | null,
  ) => {
    const baked = pieces.get(pieceId);
    const piece = project.pieces.find((p) => p.id === pieceId);
    if (!baked || !piece) return;
    const [x, y, z] = parentAt ?? [0, 0, 0];
    const at: [number, number, number] = [
      x + baked.offset[0],
      y + baked.offset[1],
      z + baked.offset[2],
    ];
    const local = pieceReach(baked);
    joints.push({
      pieceId,
      label: piece.name,
      at,
      parentAt,
      parentId,
      ...(local && {
        reach: {
          local,
          at: [at[0] + local[0], at[1] + local[1], at[2] + local[2]],
        },
      }),
    });
    for (const child of childrenOf(project, pieceId))
      walk(child.id, at, pieceId);
  };

  walk(project.rootPieceId, null, null);
  return joints;
}
