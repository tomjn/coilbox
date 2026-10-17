/**
 * Copies of a piece spaced evenly round the unit's vertical axis (issue #3317).
 *
 * The axis is the root piece's own vertical, through the root's origin, the way
 * the mirror's centre line belongs to the root. A copy is the piece turned
 * about that axis by a whole fraction of a turn, so it is a proper rotation:
 * no negative scale, and nothing for `s3oBuild.ts` to wind differently.
 *
 * Only the piece placed is copied, with its subtree. Its children are
 * positioned against it, so turning it carries them. What the pieces are
 * saved as is in `ringSet.ts`.
 *
 * Roles are not changed. There is no sensible mapping of `leg.l1` onto the
 * third of six legs, so every copy keeps the original's role.
 *
 * Each copy is its own module instance, because #3302 animates an instance on
 * its own. A mirror twin of a sided leg joins the original's instance so the
 * pair counts as one set of legs (#4316). A ring of wheels is N of the same
 * thing, which is what separate instances mean.
 */

import * as THREE from "three";

import { insertCompoundAt, subtreeAsCompound } from "./compounds";
import { freePiece } from "./connectors";
import { asTransform, rejoined } from "./mirror";
import {
  childrenOf,
  descendantIds,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import type { LoadedPack } from "./pack";
import {
  framesAgree,
  localFromWorld,
  SAME_PLACE,
  worldMatrix,
} from "./reparent";
import { ringMembers, validRingCount } from "./ringSet";

/**
 * The root's place without its scale. A scaled root would otherwise skew the
 * turn into something that is not a rotation.
 */
function rootFrame(project: LegoProject): THREE.Matrix4 {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  worldMatrix(project, project.rootPieceId).decompose(
    position,
    rotation,
    new THREE.Vector3(),
  );
  return new THREE.Matrix4().compose(
    position,
    rotation,
    new THREE.Vector3(1, 1, 1),
  );
}

/** The turn about the unit's vertical axis, in the frame the document's
 *  transforms are written in. */
function turnAbout(project: LegoProject, angle: number): THREE.Matrix4 {
  const root = rootFrame(project);
  return root
    .clone()
    .multiply(new THREE.Matrix4().makeRotationY(angle))
    .multiply(root.clone().invert());
}

/** Where a piece stands when turned `angle` about the axis. */
function turnedWorld(
  project: LegoProject,
  pieceId: string,
  angle: number,
): THREE.Matrix4 {
  return turnAbout(project, angle).multiply(worldMatrix(project, pieceId));
}

/**
 * Whether a piece's origin is on the vertical axis, at any height.
 *
 * A piece there is its own copy at every angle, so a ring of it would be a
 * stack of identical pieces in one place.
 */
export function onAxis(project: LegoProject, pieceId: string): boolean {
  const inRoot = rootFrame(project)
    .invert()
    .multiply(worldMatrix(project, pieceId));
  const spot = new THREE.Vector3().applyMatrix4(inRoot);
  return Math.hypot(spot.x, spot.z) <= SAME_PLACE;
}

/** Whether placing this piece should give it a ring. Not the root, and not a
 *  piece on the axis. */
export function canRingTwin(project: LegoProject, pieceId: string): boolean {
  if (pieceId === project.rootPieceId) return false;
  return pieceById(project, pieceId) !== undefined && !onAxis(project, pieceId);
}

/**
 * What the copy `step` places round should hang off.
 *
 * A child of a ring member hangs off the member `step` places round, when that
 * ring has the same count. Failing that, off whatever stands where the parent's
 * turned frame stands, as a mirror twin does. A parent on the axis is its own
 * copy at every angle. Nothing here invents a piece: it answers `parentId` when
 * there is no better answer.
 */
function ringParent(
  project: LegoProject,
  parentId: string,
  step: number,
  count: number,
): string {
  const members = ringMembers(project.pieces, parentId);
  if (members?.length === count) return members[step % count];
  if (onAxis(project, parentId)) return parentId;
  const turned = turnedWorld(project, parentId, (step * 2 * Math.PI) / count);
  const matches = project.pieces.filter((piece) =>
    framesAgree(worldMatrix(project, piece.id), turned),
  );
  return matches.length === 1 ? matches[0].id : parentId;
}

/** A copy of a piece and its subtree turned `angle` about the axis, hung off
 *  `parentId`. The copy is in no ring yet. */
function ringCopy(
  project: LegoProject,
  pieceId: string,
  angle: number,
  parentId: string,
  newId: () => string,
  pack: LoadedPack | null,
): { project: LegoProject; pieceId: string } | null {
  const source = pieceById(project, pieceId);
  if (!source) return null;
  const cutting = subtreeAsCompound(project, pieceId, {
    id: newId(),
    now: project.updatedAt,
    newId,
  });
  if (!cutting) return null;

  const inserted = insertCompoundAt(
    project,
    cutting,
    parentId,
    {
      position: source.position,
      rotation: source.rotation,
      scale: source.scale,
    },
    newId,
  );
  const world = turnedWorld(project, pieceId, angle);
  const transform = asTransform(
    localFromWorld(project, parentId, world, false),
  );
  const placed: LegoProject = {
    ...inserted.project,
    pieces: inserted.project.pieces.map((piece) =>
      piece.id === inserted.rootPieceId
        ? { ...freePiece(piece), ...transform }
        : piece,
    ),
  };
  return {
    project: rejoined(
      placed,
      pack,
      inserted.rootPieceId,
      source.connection?.connector,
      world,
    ),
    pieceId: inserted.rootPieceId,
  };
}

/** The members saved as one ring, in the order given, each naming the next. */
function linked(project: LegoProject, members: string[]): LegoProject {
  const next = new Map(
    members.map((id, i) => [id, members[(i + 1) % members.length]]),
  );
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      const after = next.get(piece.id);
      return after
        ? { ...piece, ring: { next: after, count: members.length } }
        : piece;
    }),
  };
}

/**
 * Add the copies that make a piece a ring of `count`, itself included.
 *
 * Symmetry mode, round the vertical axis: place one leg and get the others. The
 * copies are in step order, so the first is a turn of `1/count` round and the
 * last a turn short of the start.
 *
 * Answers null when the piece cannot have a ring, when the count is not one a
 * ring can have, or when the piece is already in a pair or a ring.
 */
export function ringTwins(
  project: LegoProject,
  pieceId: string,
  count: number,
  newId: () => string,
  pack: LoadedPack | null = null,
): { project: LegoProject; ids: string[] } | null {
  if (!validRingCount(count) || !canRingTwin(project, pieceId)) return null;
  const source = pieceById(project, pieceId) as LegoPiece;
  if (source.twin !== undefined || source.ring !== undefined) return null;

  const parent = source.parentId ?? project.rootPieceId;
  let next = project;
  const ids: string[] = [];
  for (let step = 1; step < count; step++) {
    const copy = ringCopy(
      next,
      pieceId,
      (step * 2 * Math.PI) / count,
      ringParent(project, parent, step, count),
      newId,
      pack,
    );
    if (!copy) return null;
    next = copy.project;
    ids.push(copy.pieceId);
  }
  return { project: linked(next, [pieceId, ...ids]), ids };
}

/**
 * Move every other member of a piece's ring to where the ring puts it now.
 *
 * What keeps a ring in step while symmetry mode holds it together: drag one leg
 * and the others go with it, turned to match. Everything hanging off a member
 * comes along, being positioned against it. A joined piece's copies stay joined
 * by the same connector to the face the turn lands on, when `pack` is given.
 *
 * Returns the project untouched when the piece is in no ring or the ring has
 * lost a member, so a deleted member quietly stops it following.
 */
export function followRing(
  project: LegoProject,
  pieceId: string,
  pack: LoadedPack | null = null,
): LegoProject {
  const members = ringMembers(project.pieces, pieceId);
  const lead = pieceById(project, pieceId);
  if (!members || !lead) return project;

  let next = project;
  members.forEach((id, step) => {
    if (step === 0) return;
    const world = turnedWorld(
      project,
      pieceId,
      (step * 2 * Math.PI) / members.length,
    );
    const target = pieceById(next, id) as LegoPiece;
    const transform = asTransform(
      localFromWorld(next, target.parentId, world, false),
    );
    next = {
      ...next,
      pieces: next.pieces.map((piece) =>
        piece.id === id ? { ...freePiece(piece), ...transform } : piece,
      ),
    };
    next = rejoined(next, pack, id, lead.connection?.connector, world);
  });
  return next;
}

/** Take a piece and everything in its ring out of the ring, leaving them where
 *  they stand. */
export function unringPiece(
  project: LegoProject,
  pieceId: string,
): LegoProject {
  const members = new Set(ringMembers(project.pieces, pieceId) ?? [pieceId]);
  if (!pieceById(project, pieceId)?.ring) return project;
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (!members.has(piece.id)) return piece;
      const { ring: _gone, ...rest } = piece;
      return rest;
    }),
  };
}

/**
 * The rings that go round in step with a ring: the same count, each member
 * hanging off the matching member of `parents`, in the same direction. Rings
 * in step with those are found too, however deep. A ring that is not one per
 * parent is not in step and is not listed.
 *
 * Each ring is listed in the order of the parents it hangs off.
 */
function ringsInStep(project: LegoProject, parents: string[]): string[][] {
  const found: string[][] = [];
  for (const candidate of childrenOf(project, parents[0])) {
    if (!candidate.ring) continue;
    const chain = ringMembers(project.pieces, candidate.id);
    if (chain?.length !== parents.length) continue;
    const hangs = chain.every(
      (id, i) => pieceById(project, id)?.parentId === parents[i],
    );
    if (hangs) found.push(chain, ...ringsInStep(project, chain));
  }
  return found;
}

/** Which piece in the copy of a subtree stands for each piece in the original,
 *  found by walking both together. */
function matchCopy(
  project: LegoProject,
  original: string,
  copy: string,
  into: Map<string, string> = new Map(),
): Map<string, string> {
  into.set(original, copy);
  const from = childrenOf(project, original);
  const to = childrenOf(project, copy);
  from.forEach((child, i) => {
    if (to[i]) matchCopy(project, child.id, to[i].id, into);
  });
  return into;
}

/**
 * Change how many pieces a ring has, keeping `pieceId` where it is and spacing
 * the whole ring evenly again.
 *
 * Fewer removes the last members round the ring along with their subtrees.
 * More adds copies of `pieceId`. One edit either way, and removing asks nothing.
 *
 * Rings further down that go round in step with this one (the same count, one
 * member under each of its members) are resized with it, to any depth. A new
 * copy of a member brings a copy of each child ring's lead under it, with the
 * child's own place against its parent, and that copy joins the child ring.
 * Rings further down that are not in step are let go first: their count would
 * be left behind by this change, and a ring that follows at the wrong spacing
 * is worse than one that does not follow.
 *
 * Returns the project untouched when the piece is in no ring, the count is the
 * same, or the count is not one a ring can have.
 */
export function resizeRing(
  project: LegoProject,
  pieceId: string,
  count: number,
  newId: () => string,
  pack: LoadedPack | null = null,
): LegoProject {
  const members = ringMembers(project.pieces, pieceId);
  if (!members || !validRingCount(count) || members.length === count) {
    return project;
  }

  const stepRings = ringsInStep(project, members);
  const inStep = new Set(stepRings.flat());
  const below = new Set(
    members.flatMap((id) => descendantIds(project, id).slice(1)),
  );
  let next: LegoProject = {
    ...project,
    pieces: project.pieces.map((piece) => {
      if (!piece.ring || !below.has(piece.id) || inStep.has(piece.id)) {
        return piece;
      }
      const nested = ringMembers(project.pieces, piece.id);
      if (!nested?.every((id) => below.has(id))) return piece;
      const { ring: _gone, ...rest } = piece;
      return rest;
    }),
  };

  const keep = members.slice(0, count);
  const keepSteps = stepRings.map((chain) => chain.slice(0, count));
  if (count < members.length) {
    const doomed = new Set(
      members.slice(count).flatMap((id) => descendantIds(next, id)),
    );
    next = {
      ...next,
      pieces: next.pieces.filter((piece) => !doomed.has(piece.id)),
    };
  } else {
    const parent = pieceById(next, pieceId)?.parentId ?? next.rootPieceId;
    for (let step = members.length; step < count; step++) {
      const copy = ringCopy(
        next,
        pieceId,
        (step * 2 * Math.PI) / count,
        ringParent(next, parent, step, count),
        newId,
        pack,
      );
      if (!copy) return project;
      next = copy.project;
      keep.push(copy.pieceId);
      const matched = matchCopy(next, pieceId, copy.pieceId);
      stepRings.forEach((chain, i) => {
        const made = matched.get(chain[0]);
        if (!made) return;
        keepSteps[i].push(made);
      });
    }
  }
  for (const chain of keepSteps) next = linked(next, chain);
  return followRing(linked(next, keep), pieceId, pack);
}
