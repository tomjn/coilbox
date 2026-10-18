/**
 * Three mistakes in a unit's legs and wheels that look right in the viewport
 * and wrong in a game (#3265): a foot off the ground, a pivot away from its
 * joint, and a left side that does not match the right.
 *
 * They run on any unit, not only one with a skeleton, since a hand built
 * walker has the same faults. Each returns problems for the single list and
 * names the piece to select. None of them blocks saving or export.
 */

import * as THREE from "three";

import { isSupportRole, SAME_POSITION, worldGeometry } from "./balance";
import { pieceOwnBox } from "./connectors";
import { mirrorRole, reflection } from "./mirror";
import { childrenOf, type LegoPiece, type LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { currentPivot } from "./pivot";
import { type Problem, problem } from "./problems";
import type { RawGeometry } from "./rawGeometry";
import { SAME_PLACE } from "./reparent";
import { bakedPieces } from "./s3oBuild";
import { walkProblems } from "./walkFit";

type Vec3 = [number, number, number];

/** The roles that swing about one end, so their origin should be a joint. A
 *  foot is left out: its part is often centred on the ankle on purpose. */
const SWINGS_ABOUT_AN_END = /^(leg\.[lr][12]\.(thigh|shin)|buildarm\.arm)$/;

/** A distance for a sentence, to two places, or two significant figures for a
 *  distance too small to show in two. */
function elmos(distance: number): number {
  return Number(distance.toFixed(2)) || Number(distance.toPrecision(2));
}

/** The problems for the three checks, in the order they are described, and
 *  the walk's own (`walkProblems`). */
export function skeletonProblems(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
): Problem[] {
  const baked = bakedPieces(project, pack, raw);
  const origins = pieceOrigins(project, baked.pieces);
  return [
    ...feetOffGround(project, baked, origins),
    ...pivotsAwayFromJoints(project, pack),
    ...mismatchedSides(project, baked.pieces, origins),
    ...walkProblems(project),
  ];
}

/** Where each piece's origin rests in the unit's space. */
function pieceOrigins(
  project: LegoProject,
  pieces: ReturnType<typeof bakedPieces>["pieces"],
): Map<string, Vec3> {
  const origins = new Map<string, Vec3>();
  const walk = (id: string, from: Vec3) => {
    const piece = pieces.get(id);
    if (!piece) return;
    const at: Vec3 = [
      from[0] + piece.offset[0],
      from[1] + piece.offset[1],
      from[2] + piece.offset[2],
    ];
    origins.set(id, at);
    for (const child of childrenOf(project, id)) walk(child.id, at);
  };
  walk(project.rootPieceId, [0, 0, 0]);
  return origins;
}

/**
 * A foot or wheel whose lowest point, counting everything hung from it, is not
 * on the ground (y = 0, where `sitOnGround` puts a unit). Within
 * `SAME_POSITION` is on it, the same tolerance the balance check uses to say a
 * foot rests, which a unit built from each body plan stays far inside.
 *
 * A foot with no geometry is judged by its origin, the ankle, which the body
 * plans put on the ground. A wheel with no geometry is not judged: its origin
 * is the axle, and the tread is what touches the ground. A track with none is
 * the middle of the track, not its underside.
 */
function feetOffGround(
  project: LegoProject,
  baked: ReturnType<typeof bakedPieces>,
  origins: Map<string, Vec3>,
): Problem[] {
  const out: Problem[] = [];
  for (const piece of project.pieces) {
    if (!isSupportRole(piece.role)) continue;
    const range = baked.ranges.get(piece.id);
    let lowest: number | undefined;
    if (range && range[0] < range[1]) {
      lowest = Number.POSITIVE_INFINITY;
      for (let i = range[0]; i < range[1]; i++) {
        lowest = Math.min(lowest, baked.world[i].y);
      }
    } else if (piece.role !== "wheel" && piece.role !== "track") {
      lowest = origins.get(piece.id)?.[1];
    }
    if (lowest === undefined || Math.abs(lowest) <= SAME_POSITION) continue;
    out.push(
      problem(
        "skeleton",
        "warning",
        `"${piece.name}" is ${elmos(Math.abs(lowest))} elmos ${lowest > 0 ? "above" : "below"} the ground.`,
        [piece.id],
      ),
    );
  }
  return out;
}

/**
 * A leg segment or build arm with a part or a shape whose pivot is its middle,
 * which is the propeller problem `pivot.ts` describes. A piece with neither
 * has its origin as its joint, so there is nothing to say about it.
 * `currentPivot` is what says where the pivot is.
 */
function pivotsAwayFromJoints(
  project: LegoProject,
  pack: LoadedPack,
): Problem[] {
  const out: Problem[] = [];
  for (const piece of project.pieces) {
    if (!piece.role || !SWINGS_ABOUT_AN_END.test(piece.role)) continue;
    // A part or a shape starts at its middle. A mesh starts where its model
    // put the origin, so it is left out.
    const bbox = piece.meshId ? undefined : pieceOwnBox(pack, piece);
    if (!bbox || currentPivot({ bbox }, piece.pivot) !== "middle") continue;
    out.push(
      problem(
        "skeleton",
        "warning",
        `"${piece.name}" turns about its middle, not its joint.`,
        [piece.id],
      ),
    );
  }
  return out;
}

/** The box round some points. */
function boxOf(points: THREE.Vector3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], p.getComponent(axis));
      max[axis] = Math.max(max[axis], p.getComponent(axis));
    }
  }
  return { min, max };
}

/**
 * A piece with a sided role (`leg.l1.thigh`) and the piece with the mirrored
 * role, which should stand where its reflection across the centre line does.
 *
 * Their origins and the boxes round their geometry are compared to
 * `SAME_PLACE`, the distance `mirror.ts` already calls the same place for a
 * reflection. A piece's geometry is its own and that of the pieces hung on it
 * that have no sided role of their own, since a part placed on a bone is a
 * child of the bone. The frames are not compared with `framesAgree`: a bone's
 * twin has the same handedness as the bone, since a skeleton's bones carry no
 * negative scale, so reflecting one never gives the other's frame
 * (`mirrorParent`).
 *
 * A piece is paired with its saved twin when that has the mirrored role, and
 * otherwise with the nearest piece that has it. One fault moves everything
 * below it, so a piece is left out when the piece it hangs from is reported.
 */
function mismatchedSides(
  project: LegoProject,
  pieces: ReturnType<typeof bakedPieces>["pieces"],
  origins: Map<string, Vec3>,
): Problem[] {
  const isSided = (role: string | undefined): role is string =>
    role !== undefined && mirrorRole(role) !== role;
  const sided = project.pieces.filter(
    (piece): piece is LegoPiece & { role: string } => isSided(piece.role),
  );
  if (sided.length === 0) return [];

  const mirror = reflection(project);
  const geometry = new Map(
    worldGeometry(project, pieces).map((g) => [
      g.id,
      g.points.map((p) => new THREE.Vector3(...p)),
    ]),
  );
  const pointsOf = (id: string): THREE.Vector3[] => [
    ...(geometry.get(id) ?? []),
    ...childrenOf(project, id)
      .filter((child) => !isSided(child.role))
      .flatMap((child) => pointsOf(child.id)),
  ];
  const originOf = (id: string) =>
    new THREE.Vector3(...(origins.get(id) ?? [0, 0, 0]));

  const found: { piece: LegoPiece; problem: Problem }[] = [];
  for (const piece of sided) {
    const isLeft = /^leg\.l/.test(piece.role);
    const others = sided.filter((p) => p.role === mirrorRole(piece.role));
    if (others.length === 0) {
      found.push({
        piece,
        problem: problem(
          "skeleton",
          "warning",
          `"${piece.name}" has no ${isLeft ? "right" : "left"} side piece.`,
          [piece.id],
        ),
      });
      continue;
    }
    // Each pair is judged once, from its left piece.
    if (!isLeft) continue;

    const target = originOf(piece.id).applyMatrix4(mirror);
    const other =
      others.find((p) => p.id === piece.twin) ??
      others.reduce((best, p) =>
        originOf(p.id).distanceTo(target) < originOf(best.id).distanceTo(target)
          ? p
          : best,
      );

    const mine = pointsOf(piece.id).map((p) => p.clone().applyMatrix4(mirror));
    const theirs = pointsOf(other.id);
    let matches = originOf(other.id).distanceTo(target) <= SAME_PLACE;
    if (matches && (mine.length > 0 || theirs.length > 0)) {
      const a = boxOf(mine);
      const b = boxOf(theirs);
      matches =
        mine.length > 0 &&
        theirs.length > 0 &&
        [0, 1, 2].every(
          (axis) =>
            Math.abs(a.min[axis] - b.min[axis]) <= SAME_PLACE &&
            Math.abs(a.max[axis] - b.max[axis]) <= SAME_PLACE,
        );
    }
    if (!matches) {
      found.push({
        piece,
        problem: problem(
          "skeleton",
          "warning",
          `"${other.name}" does not mirror "${piece.name}".`,
          [other.id, piece.id],
        ),
      });
    }
  }

  const reported = new Set(found.map((f) => f.piece.id));
  return found
    .filter((f) => !(f.piece.parentId && reported.has(f.piece.parentId)))
    .map((f) => f.problem);
}
