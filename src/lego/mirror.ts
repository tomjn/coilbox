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
import { freePiece, joinAt } from "./connectors";
import {
  descendantIds,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import { pieceFingerprint } from "./moduleUpdates";
import type { LoadedPack } from "./pack";
import {
  framesAgree,
  localFromWorld,
  SAME_PLACE,
  worldMatrix,
} from "./reparent";
import { withoutBrokenRings } from "./ringSet";

/** Reflection across x = 0, the plane the unit's centre line runs down. */
const REFLECT_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * The reflection of the unit's own centre line, in the frame the document's
 * transforms are written in.
 *
 * The centre line belongs to the root, so its reflection has to be carried into
 * world space before it is any use. A unit whose root is offset or turned still
 * mirrors about its own middle rather than about the world's.
 */
export function reflection(project: LegoProject): THREE.Matrix4 {
  const root = worldMatrix(project, project.rootPieceId);
  return root.clone().multiply(REFLECT_X).multiply(root.clone().invert());
}

/** A local matrix as the three fields the document stores. */
export function asTransform(
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
 * Where `targetId` has to sit to be the mirror image of `sourceId`, written
 * against its own parent.
 *
 * The two are the same piece when a piece is reflected in place, and different
 * pieces when one of a pair is following the other. A document with a second
 * parentless piece is already broken, and treating it as its own frame is
 * enough to not crash.
 *
 * Written for the target as a free piece, which it is until `rejoined` finds
 * the face its reflection sits on.
 */
function mirroredTransform(
  project: LegoProject,
  sourceId: string,
  targetId: string,
): Pick<LegoPiece, "position" | "rotation" | "scale"> {
  const target = pieceById(project, targetId);
  return asTransform(
    localFromWorld(
      project,
      target?.parentId ?? null,
      mirroredWorld(project, sourceId),
      false,
    ),
  );
}

/** Where the mirror image of a piece stands in the unit. */
function mirroredWorld(project: LegoProject, sourceId: string): THREE.Matrix4 {
  return reflection(project).multiply(worldMatrix(project, sourceId));
}

/**
 * A free piece joined again by its own `connector`, to the face of its parent
 * that puts it at `world` (issue #3309), or left free when no face does.
 *
 * A reflected piece joins by the same connector it did before. Its whole part
 * is reflected with it, so that connector is now on the side facing the
 * parent. Only the parent's face changes, and which face that is comes from
 * where the reflection stands. The twist and the offset along the face come out
 * reflected too.
 */
export function rejoined(
  project: LegoProject,
  pack: LoadedPack | null,
  pieceId: string,
  connector: string | undefined,
  world: THREE.Matrix4,
): LegoProject {
  if (!pack || connector === undefined) return project;
  return joinAt(project, pack, pieceId, connector, world) ?? project;
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
 * A joined piece is joined again to the face its reflection sits on, by the
 * same connector, when `pack` is given and the parent has a face there. It is
 * left free otherwise.
 *
 * Returns the project untouched when the piece cannot be mirrored.
 */
export function mirrorPiece(
  project: LegoProject,
  pieceId: string,
  pack: LoadedPack | null = null,
): LegoProject {
  if (!canMirror(project, pieceId)) return project;
  const transform = mirroredTransform(project, pieceId, pieceId);
  const connector = pieceById(project, pieceId)?.connection?.connector;

  const subtree = new Set(descendantIds(project, pieceId));
  const mirrored: LegoProject = {
    ...project,
    pieces: project.pieces.map((current) => {
      if (!subtree.has(current.id)) return current;
      const roled = current.role
        ? { ...current, role: mirrorRole(current.role) }
        : current;
      // A weapon's arc points to the other side too (issue #3274).
      const sided =
        roled.weapon?.heading !== undefined
          ? {
              ...roled,
              weapon: { ...roled.weapon, heading: -roled.weapon.heading || 0 },
            }
          : roled;
      // The mirrored piece is placed by the mirror, and its old join would put
      // it straight back, so it is freed and then joined again. Joins below it
      // are written against it and still hold.
      return current.id === pieceId
        ? { ...freePiece(sided), ...transform }
        : sided;
    }),
  };
  return rejoined(
    mirrored,
    pack,
    pieceId,
    connector,
    mirroredWorld(project, pieceId),
  );
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
 * A joined source gives a copy joined by the same connector to the face its
 * reflection sits on, as `mirrorPiece` does, when `pack` is given.
 *
 * Answers null when the piece cannot be mirrored, and otherwise the new
 * document with the copy's own piece id.
 */
export function mirrorCopy(
  project: LegoProject,
  pieceId: string,
  newId: () => string,
  parentId?: string,
  pack: LoadedPack | null = null,
): { project: LegoProject; pieceId: string } | null {
  const source = pieceById(project, pieceId);
  if (!source || !canMirror(project, pieceId)) return null;

  const ownParent = source.parentId ?? project.rootPieceId;
  const target = parentId ?? ownParent;
  // The copy has to start from where the original stands before it is
  // reflected, which under the original's own parent is simply the original's
  // transform and join, and under any other is that same place written against
  // the new parent instead.
  const at =
    target === ownParent
      ? {
          position: source.position,
          rotation: source.rotation,
          scale: source.scale,
          ...(source.connection ? { connection: source.connection } : {}),
        }
      : asTransform(
          // The copy goes in free, so the new parent's scale is part of its place.
          localFromWorld(project, target, worldMatrix(project, pieceId), false),
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

  const mirrored = joinsInstance(
    mirrorPiece(inserted.project, inserted.rootPieceId),
    inserted.rootPieceId,
    project,
    pieceId,
  );
  return {
    project: rejoined(
      mirrored,
      pack,
      inserted.rootPieceId,
      source.connection?.connector,
      mirroredWorld(project, pieceId),
    ),
    pieceId: inserted.rootPieceId,
  };
}

/**
 * A mirrored copy of a sided piece, such as a leg, is the other half of the set
 * it was copied from, so it joins the original's module instance instead of
 * starting one. Otherwise a pair of legs counts as two sets of legs, each with
 * one side, and a preset that needs both sides finds neither complete (issue
 * #4316). A piece with no sided role is a second copy of itself, such as a
 * second build arm, and keeps the instance of its own that the copy was given.
 */
function joinsInstance(
  mirrored: LegoProject,
  copyId: string,
  original: LegoProject,
  sourceId: string,
): LegoProject {
  const instance = pieceById(original, sourceId)?.module;
  if (!instance) return mirrored;
  const sided = descendantIds(original, sourceId).some((id) => {
    const role = pieceById(original, id)?.role;
    return role !== undefined && mirrorRole(role) !== role;
  });
  if (!sided) return mirrored;
  const copied = new Set(descendantIds(mirrored, copyId));
  return {
    ...mirrored,
    pieces: mirrored.pieces.map((piece) =>
      copied.has(piece.id) && piece.module
        ? {
            ...piece,
            module: {
              ...piece.module,
              instance: instance.instance,
              fp: pieceFingerprint(piece, piece.id === copyId),
            },
          }
        : piece,
    ),
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
 * The piece standing where `parentId`'s own reflection stands, or `parentId`
 * itself when there is no such piece.
 *
 * What a mirrored child should hang off. Mirror the left thigh and the copy is
 * the reflection of the left thigh's frame, so a shin added to the left thigh
 * afterwards has somewhere on the right to go, and the pair keeps its
 * hierarchy instead of the twin dangling off the leg it was reflected from.
 *
 * A parent on the centre line is its own reflection and is returned as is,
 * mirrored or not (issue #4306).
 *
 * Derived, never stored: the answer is read out of where the pieces stand each
 * time it is asked for, so nothing has to be kept in step. Two pieces standing
 * in the same reflected place is a document nobody can mean anything definite
 * by, so that falls back too. Nothing here ever invents a piece.
 */
export function mirrorParent(project: LegoProject, parentId: string): string {
  // A parent on the centre line is its own reflection. Its reflected frame is
  // not its own frame when it is mirrored, and can be another piece's, such as
  // the root's, so frames are only compared for a parent off the line.
  if (onCentreLine(project, parentId)) return parentId;
  // A bone of a skeleton names its twin outright (#3315), and the two frames
  // differ in handedness, so a frame match cannot find it (#3256).
  const saved = pieceById(project, parentId)?.twin;
  if (saved !== undefined && pieceById(project, saved)) return saved;
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
 * A piece joined to a face gives a twin joined to the face that mirrors it,
 * when `pack` is given (issues #3309 and #4291).
 *
 * Answers null when the piece should not be twinned, and otherwise the new
 * document and the twin's own piece id, which is what the pair is then followed
 * by.
 */
export function mirrorTwin(
  project: LegoProject,
  pieceId: string,
  newId: () => string,
  pack: LoadedPack | null = null,
): { project: LegoProject; twinId: string } | null {
  if (!canMirrorTwin(project, pieceId)) return null;
  const source = pieceById(project, pieceId) as LegoPiece;
  const parent = mirrorParent(project, source.parentId ?? project.rootPieceId);
  const copy = mirrorCopy(project, pieceId, newId, parent, pack);
  return copy
    ? {
        project: pairPieces(copy.project, pieceId, copy.pieceId),
        twinId: copy.pieceId,
      }
    : null;
}

/**
 * Record two pieces as each other's twin (#3315). Either was perhaps paired
 * with another piece before, and that piece is let go rather than left naming a
 * piece that no longer names it back.
 */
export function pairPieces(
  project: LegoProject,
  firstId: string,
  secondId: string,
): LegoProject {
  const letGo = new Set<string>();
  for (const id of [firstId, secondId]) {
    const old = pieceById(project, id)?.twin;
    if (old && old !== firstId && old !== secondId) letGo.add(old);
  }
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (piece.id === firstId) return { ...piece, twin: secondId };
      if (piece.id === secondId) return { ...piece, twin: firstId };
      if (letGo.has(piece.id)) {
        const { twin: _gone, ...rest } = piece;
        return rest;
      }
      return piece;
    }),
  };
}

/**
 * Break the pairing a piece is in, leaving both pieces as ordinary pieces where
 * they stand. Returns the project untouched when the piece has no twin.
 */
export function unpairPiece(
  project: LegoProject,
  pieceId: string,
): LegoProject {
  const twinId = pieceById(project, pieceId)?.twin;
  if (twinId === undefined) return project;
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (
        piece.id !== pieceId &&
        !(piece.id === twinId && piece.twin === pieceId)
      )
        return piece;
      const { twin: _gone, ...rest } = piece;
      return rest;
    }),
  };
}

/**
 * Drop every pairing that names a piece the unit no longer has, so deleting
 * either piece of a pair leaves the other as an ordinary piece. A ring that
 * lost a member (#3317) is let go the same way.
 */
export function withoutDanglingTwins(project: LegoProject): LegoProject {
  const present = new Set(project.pieces.map((piece) => piece.id));
  const ringed = withoutBrokenRings(project.pieces);
  if (
    ringed === project.pieces &&
    !project.pieces.some((p) => p.twin !== undefined && !present.has(p.twin))
  )
    return project;
  return {
    ...project,
    pieces: ringed.map((piece) => {
      if (piece.twin === undefined || present.has(piece.twin)) return piece;
      const { twin: _gone, ...rest } = piece;
      return rest;
    }),
  };
}

/**
 * Move a twin to wherever the mirror of its counterpart now is.
 *
 * What keeps a pair in step while symmetry mode holds them together: drag the
 * left leg and the right one goes with it, turned and scaled to match rather
 * than merely shifted. Everything hanging off the twin comes along, because it
 * is positioned against the twin rather than against the unit.
 *
 * The twin's join follows its counterpart's. A counterpart joined to a face, or
 * slid along one, leaves the twin joined to the face that mirrors it, when
 * `pack` is given. A counterpart that is free leaves the twin free.
 *
 * Returns the project untouched when either piece has since gone, so a deleted
 * twin quietly stops following instead of resurrecting or throwing.
 */
export function followMirror(
  project: LegoProject,
  pieceId: string,
  twinId: string,
  pack: LoadedPack | null = null,
): LegoProject {
  const partner = pieceById(project, pieceId);
  if (!partner || !pieceById(project, twinId)) return project;
  if (!canMirror(project, twinId)) return project;
  const transform = mirroredTransform(project, pieceId, twinId);
  const followed: LegoProject = {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === twinId ? { ...freePiece(piece), ...transform } : piece,
    ),
  };
  return rejoined(
    followed,
    pack,
    twinId,
    partner.connection?.connector,
    mirroredWorld(project, pieceId),
  );
}
