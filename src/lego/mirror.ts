/**
 * Reflecting a piece and everything under it across the unit's centre line.
 *
 * The centre line is the plane x = 0 in the root piece's own space. Spring
 * models are built facing +z with left and right either side of x, so that is
 * the plane a leg crosses to become the other leg, and the root is what every
 * other piece is positioned against.
 *
 * Only the piece being mirrored changes. Its children are already positioned
 * against it, so reflecting its transform carries the whole subtree over: a
 * child's place in the unit is its parent's transform times its own, and
 * reflecting the parent reflects the product.
 *
 * A reflection is a negative scale, which is what the piece ends up carrying,
 * and `s3oBuild.ts` already reverses triangle winding whenever the transform it
 * bakes has a negative determinant. So there is no separate mirror flag: the
 * scale is the mirror, and one sign cannot disagree with the other.
 */

import * as THREE from "three";

import { insertCompoundAt, subtreeAsCompound } from "./compounds";
import {
  descendantIds,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { worldMatrix } from "./reparent";
import { MIN_SCREEN_THRESHOLD } from "./snapping";

/** Reflection across x = 0, the plane the unit's centre line runs down. */
const REFLECT_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * How close two points have to be to count as the same place.
 *
 * The snap's own floor: the tightest a seat ever gets, however far the camera
 * is pulled back. Two points this builder would already snap together are two
 * points these answers treat as one.
 */
const SAME_PLACE = MIN_SCREEN_THRESHOLD;

/**
 * The reflection of the unit's own centre line, in the frame the document's
 * transforms are written in.
 *
 * The centre line belongs to the root, so its reflection has to be carried into
 * world space before it is any use. A unit whose root is offset or turned still
 * mirrors about its own middle rather than about the world's.
 */
function reflection(project: LegoProject): THREE.Matrix4 {
  const root = worldMatrix(project, project.rootPieceId);
  return root.clone().multiply(REFLECT_X).multiply(root.clone().invert());
}

/** A local matrix as the three fields the document stores. */
function asTransform(
  local: THREE.Matrix4,
): Pick<LegoPiece, "position" | "rotation" | "scale"> {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  // `decompose` puts the reflection on x when the matrix turns space inside
  // out, which is exactly the negative scale the exporter reads.
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z],
  };
}

/**
 * Whether a piece can be mirrored.
 *
 * Everything but the root. The root is the frame the centre line is measured
 * in, so reflecting it about its own plane is a statement about the whole unit
 * rather than about a piece, and the same reasoning already keeps the root out
 * of duplicate and delete.
 */
export function canMirror(project: LegoProject, pieceId: string): boolean {
  if (pieceId === project.rootPieceId) return false;
  return pieceById(project, pieceId) !== undefined;
}

/**
 * The role a mirrored piece takes: the same job on the other side.
 *
 * Left and right are in the role vocabulary itself, `leg.l1.thigh` against
 * `leg.r1.thigh`, and the walk presets ask for one of each. A mirrored leg that
 * kept its role would be a second left leg, and the preset would still be a
 * right one short. Every other role is sideless and comes back unchanged.
 */
export function mirrorRole(role: string): string {
  return role.replace(
    /^leg\.([lr])(\d)\./,
    (_match, side: string, pair: string) =>
      `leg.${side === "l" ? "r" : "l"}${pair}.`,
  );
}

/**
 * Reflect a piece and its subtree across the unit's centre line.
 *
 * The piece keeps its parent and lands where a mirror would put it: a leg
 * hanging off the left of the hull swings to the right, still hanging off the
 * hull. A piece already sitting on the centre line stays put and turns inside
 * out in place, which is what a mirror does to it. Mirroring twice returns the
 * piece to where it started.
 *
 * Returns the project untouched when the piece cannot be mirrored.
 */
export function mirrorPiece(
  project: LegoProject,
  pieceId: string,
): LegoProject {
  if (!canMirror(project, pieceId)) return project;
  const piece = pieceById(project, pieceId) as LegoPiece;

  // Reflect where the piece sits in the unit, then write that back against its
  // parent, which has not moved. A document with a second parentless piece is
  // already broken, and treating it as its own frame is enough to not crash.
  const parent = piece.parentId
    ? worldMatrix(project, piece.parentId)
    : new THREE.Matrix4();
  const local = parent
    .clone()
    .invert()
    .multiply(reflection(project))
    .multiply(worldMatrix(project, pieceId));
  const transform = asTransform(local);

  const subtree = new Set(descendantIds(project, pieceId));
  return {
    ...project,
    pieces: project.pieces.map((current) => {
      if (!subtree.has(current.id)) return current;
      const sided = current.role
        ? { ...current, role: mirrorRole(current.role) }
        : current;
      return current.id === pieceId ? { ...sided, ...transform } : sided;
    }),
  };
}

/**
 * Add a mirrored copy of a piece and its subtree beside the original.
 *
 * This is the leg case: the first leg stays and the second one is its
 * reflection. The copy is lifted and put back through the same machinery the
 * clipboard and duplicate use, so its new ids and its names come from one place
 * rather than a third scheme of this file's own.
 *
 * Hangs off the source's own parent unless another is named, which is what
 * symmetry mode does to put a mirrored child under the mirrored parent.
 *
 * Answers null when the piece cannot be mirrored, and otherwise the new
 * document with the copy's own piece id.
 */
export function mirrorCopy(
  project: LegoProject,
  pieceId: string,
  newId: () => string,
  parentId?: string,
): { project: LegoProject; pieceId: string } | null {
  const source = pieceById(project, pieceId);
  if (!source || !canMirror(project, pieceId)) return null;

  const ownParent = source.parentId ?? project.rootPieceId;
  const target = parentId ?? ownParent;
  // The copy has to start from where the original stands before it is
  // reflected, which under the original's own parent is simply the original's
  // transform, and under any other is that same place written against the new
  // parent instead.
  const at =
    target === ownParent
      ? {
          position: source.position,
          rotation: source.rotation,
          scale: source.scale,
        }
      : asTransform(
          worldMatrix(project, target)
            .invert()
            .multiply(worldMatrix(project, pieceId)),
        );

  // The compound in the middle is never stored, so its id and its timestamp are
  // only there to satisfy the shape a saved one has.
  const cutting = subtreeAsCompound(project, pieceId, {
    id: newId(),
    now: project.updatedAt,
    newId,
  });
  if (!cutting) return null;

  // Lifting drops the subtree root's transform, because a compound is defined
  // by how its pieces sit against each other rather than by where it came from.
  // A mirror has to start from where the original stands: reflecting a leg that
  // had been dropped back at the hull's origin would not be the other leg.
  const inserted = insertCompoundAt(project, cutting, target, at, newId);

  return {
    project: mirrorPiece(inserted.project, inserted.rootPieceId),
    pieceId: inserted.rootPieceId,
  };
}

/**
 * Whether a piece's own origin sits on the unit's centre line.
 *
 * Measured in the root's space rather than the world's, because that is the
 * frame the centre line is the plane x = 0 of, and a unit that has been slid
 * sideways still has its middle down its own middle.
 */
export function onCentreLine(project: LegoProject, pieceId: string): boolean {
  const inRoot = worldMatrix(project, project.rootPieceId)
    .invert()
    .multiply(worldMatrix(project, pieceId));
  return Math.abs(new THREE.Vector3().applyMatrix4(inRoot).x) <= SAME_PLACE;
}

/**
 * The four points a frame is compared by: its origin and the tip of each axis.
 *
 * Comparing where a frame puts these, rather than its sixteen numbers, asks the
 * question in world units throughout, so one threshold covers position,
 * rotation and scale at once and a left-handed frame never passes for a
 * right-handed one.
 */
const PROBES = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

/** Whether two frames stand in the same place, the same way round, the same
 *  size. */
function framesAgree(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  return PROBES.every(
    (probe) =>
      probe.clone().applyMatrix4(a).distanceTo(probe.clone().applyMatrix4(b)) <=
      SAME_PLACE,
  );
}

/**
 * The piece standing where `parentId`'s own reflection stands, or `parentId`
 * itself when there is no such piece.
 *
 * What a mirrored child should hang off. Mirror the left thigh and the copy is
 * the reflection of the left thigh's frame, so a shin added to the left thigh
 * afterwards has somewhere on the right to go, and the pair keeps its
 * hierarchy instead of the twin dangling off the leg it was reflected from.
 *
 * Derived, never stored: the answer is read out of where the pieces stand each
 * time it is asked for, so nothing has to be kept in step. Two pieces standing
 * in the same reflected place is a document nobody can mean anything definite
 * by, so that falls back too. Nothing here ever invents a piece.
 */
export function mirrorParent(project: LegoProject, parentId: string): string {
  const reflected = reflection(project).multiply(
    worldMatrix(project, parentId),
  );
  const matches = project.pieces.filter((piece) =>
    framesAgree(worldMatrix(project, piece.id), reflected),
  );
  return matches.length === 1 ? matches[0].id : parentId;
}

/**
 * Whether placing this piece should give it a twin.
 *
 * A piece on the centre line is its own reflection, so a twin would be a second
 * copy of it sitting inside the first.
 */
export function canMirrorTwin(project: LegoProject, pieceId: string): boolean {
  return canMirror(project, pieceId) && !onCentreLine(project, pieceId);
}

/**
 * Add the mirrored twin of a piece that has just been placed.
 *
 * Symmetry mode: place one leg and get the other. The twin hangs off whatever
 * stands where its parent's own reflection stands, so a piece added to the left
 * thigh is twinned onto the right thigh rather than onto the left one.
 *
 * Nothing links the two afterwards. They are two ordinary pieces, and moving,
 * turning or deleting one says nothing about the other.
 *
 * Returns the project untouched when the piece should not be twinned.
 */
export function mirrorTwin(
  project: LegoProject,
  pieceId: string,
  newId: () => string,
): LegoProject {
  if (!canMirrorTwin(project, pieceId)) return project;
  const source = pieceById(project, pieceId) as LegoPiece;
  const parent = mirrorParent(project, source.parentId ?? project.rootPieceId);
  return mirrorCopy(project, pieceId, newId, parent)?.project ?? project;
}
