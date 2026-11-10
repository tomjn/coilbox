/**
 * Which of a game unit's pieces are its legs, from one stride (#5184).
 *
 * Motion alone cannot say which of six turning pieces is the front left shin.
 * Motion plus the piece tree plus where the pieces sit at rest can. A leg is a
 * chain of pieces that turn about x as the unit walks, each the child of the
 * last, hanging off a piece that does not: thigh, shin and foot from the top
 * down. Which side it is on comes from where its thigh joint sits in the unit,
 * and the order of a side's legs front to back from the same place.
 *
 * Anything that does not fit that shape is said in a note and proposed as
 * nothing. A wrong leg animates a unit inside out, which is worse than none.
 */

import { t } from "@lingui/core/macro";
import * as THREE from "three";

import type { LegRole } from "./animPresets";
import type { LegoPiece, LegoProject } from "./model";
import type { Vec3 } from "./planMeasure";
import { worldMatrix } from "./reparent";

/** One proposed leg, in the shape a body plan's leg bones are picked in. */
export interface LegProposal {
  side: LegRole["side"];
  /** Counted from 1 at the front, per side, as a body plan counts its pairs. */
  pair: number;
  /** Piece names, top down. */
  chain: { thigh: string; shin: string; foot: string };
  /** The piece the chain hangs off, which did not turn. Null when the thigh
   *  hangs off nothing. */
  hangsFrom: string | null;
  /** The thigh joint's rest position in the unit, in elmos. +x is the unit's
   *  left and +z its front, as the engine has them. */
  position: Vec3;
}

export interface LegFindings {
  legs: LegProposal[];
  notes: string[];
  /** Pieces that turned as part of a chain of two or more, or as a joint more
   *  than one chain hangs off, or alone under a turning piece. None of them
   *  is a wheel, whatever else they are. */
  chained: Set<string>;
  /** Whether no piece but the root turned or slid at all, so the script
   *  animates nothing when the unit moves. */
  still: boolean;
}

/** The part of a run's timeline the reading needs. */
export interface Stride {
  pieces: string[];
  frames: number[][];
}

/**
 * How close to the unit's centre line counts as on it, and how close two legs
 * on one side can be front to back before they have no order. A thousandth of
 * an elmo: well above the rounding a 32 bit float model offset carries, and
 * far below any distance a modeller places a leg at on purpose.
 */
const ON_THE_LINE = 0.001;

/** The angle between two rotations, the short way round, since a run reports
 *  rotations in `[0, 2π)`. */
function turnedBy(from: number, to: number): number {
  const delta = (to - from) % (2 * Math.PI);
  return Math.abs(
    delta > Math.PI
      ? delta - 2 * Math.PI
      : delta < -Math.PI
        ? delta + 2 * Math.PI
        : delta,
  );
}

/**
 * The most each piece turned about x, turned about y or z, and slid on any
 * axis, at any point in the stride, against where it started.
 *
 * Every frame rather than first against last, because a stride comes back on
 * itself: a thigh that swung forward and back again ends near where it began.
 */
function motion(stride: Stride) {
  const first = stride.frames[0];
  const turned = new Map<string, number>();
  const swung = new Map<string, number>();
  const slid = new Map<string, number>();
  if (!first) return { turned, swung, slid };
  stride.pieces.forEach((name, index) => {
    let turn = 0;
    let swing = 0;
    let slide = 0;
    for (const frame of stride.frames) {
      const at = index * 6;
      turn = Math.max(turn, turnedBy(first[at + 3] ?? 0, frame[at + 3] ?? 0));
      for (const axis of [4, 5]) {
        swing = Math.max(
          swing,
          turnedBy(first[at + axis] ?? 0, frame[at + axis] ?? 0),
        );
      }
      for (const axis of [0, 1, 2]) {
        slide = Math.max(
          slide,
          Math.abs((frame[at + axis] ?? 0) - (first[at + axis] ?? 0)),
        );
      }
    }
    turned.set(name, turn);
    swung.set(name, swing);
    slid.set(name, slide);
  });
  return { turned, swung, slid };
}

function restPosition(project: LegoProject, piece: LegoPiece): Vec3 {
  const at = new THREE.Vector3().setFromMatrixPosition(
    worldMatrix(project, piece.id),
  );
  return [at.x, at.y, at.z];
}

/**
 * Read a stride for legs. `moved` is how far, in radians or elmos, a piece
 * has to turn or slide to count as moving.
 *
 * The unit's root piece is never part of a leg. It is the body the engine
 * moves the whole unit by, and a walk that rocks it is rocking the body.
 */
export function findLegs(
  project: LegoProject,
  stride: Stride,
  moved: number,
): LegFindings {
  const { turned, swung, slid } = motion(stride);
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));
  const parentOf = (piece: LegoPiece) =>
    piece.parentId === null ? undefined : byId.get(piece.parentId);
  const isRoot = (piece: LegoPiece) =>
    piece.id === project.rootPieceId || parentOf(piece) === undefined;
  const turns = (piece: LegoPiece | undefined): piece is LegoPiece =>
    !!piece && !isRoot(piece) && (turned.get(piece.name) ?? 0) >= moved;
  const turningChildren = (piece: LegoPiece) =>
    project.pieces.filter(
      (child) => child.parentId === piece.id && turns(child),
    );

  const notes: string[] = [];
  const chained = new Set<string>();
  const found: Omit<LegProposal, "pair">[] = [];

  for (const piece of project.pieces) {
    if (!turns(piece)) continue;
    const parent = parentOf(piece);
    // Where a chain starts: off a piece that holds still, or off a joint
    // that more than one chain hangs from, such as a pelvis rocking with both
    // legs.
    const starts =
      !turns(parent) || (parent && turningChildren(parent).length > 1);
    if (!starts) continue;
    if (turningChildren(piece).length > 1) {
      chained.add(piece.name);
      continue;
    }

    const chain = [piece];
    for (;;) {
      const next = turningChildren(chain[chain.length - 1] as LegoPiece);
      if (next.length !== 1) break;
      chain.push(next[0] as LegoPiece);
    }
    // A lone piece off a turning fork, such as a toe under a turning foot, is
    // part of the structure it hangs from, so it is not a wheel either.
    if (chain.length === 1) {
      if (turns(parent)) chained.add(piece.name);
      continue;
    }
    for (const link of chain) chained.add(link.name);

    const names = chain.map((link) => link.name).join(", ");
    if (chain.length === 2) {
      notes.push(
        t`${names} turn as a chain of two when the unit moves. That could be a thigh and foot or a shin and foot, so no leg is proposed for them.`,
      );
      continue;
    }
    if (chain.length > 3) {
      const count = chain.length;
      notes.push(
        t`${names} turn as a chain of ${count} when the unit moves, more than a thigh, shin and foot, so no leg is proposed for them.`,
      );
      continue;
    }
    const [thigh, shin, foot] = chain as [LegoPiece, LegoPiece, LegoPiece];
    const position = restPosition(project, thigh);
    if (Math.abs(position[0]) < ON_THE_LINE) {
      const top = thigh.name;
      notes.push(
        t`${names} turn like a leg when the unit moves, but ${top} sits on the unit's centre line, so which side it is on is unknown and no leg is proposed for it.`,
      );
      continue;
    }
    found.push({
      side: position[0] > 0 ? "l" : "r",
      chain: { thigh: thigh.name, shin: shin.name, foot: foot.name },
      hangsFrom: parent?.name ?? null,
      position,
    });
  }

  // A leg that slides rather than turns. Said, so the user knows why a walker
  // came back with no legs, but never read as one.
  for (const piece of project.pieces) {
    if (isRoot(piece) || chained.has(piece.name)) continue;
    if ((slid.get(piece.name) ?? 0) < moved) continue;
    if ((turned.get(piece.name) ?? 0) >= moved) continue;
    if (Math.abs(restPosition(project, piece)[0]) < ON_THE_LINE) continue;
    const name = piece.name;
    notes.push(
      t`${name} slides rather than turns when the unit moves, so it is not proposed as a leg.`,
    );
  }

  // Pieces off the centre line that turn only about y or z, joined to another
  // piece that turns, such as a spider's legs splayed out sideways. Said, so a
  // walker that came back with no legs says why, but never read as legs. A
  // lone spinning piece is not a leg of any kind, so it is not said.
  const swings = (piece: LegoPiece | undefined): piece is LegoPiece =>
    !!piece &&
    !isRoot(piece) &&
    Math.max(turned.get(piece.name) ?? 0, swung.get(piece.name) ?? 0) >=
      moved;
  const sideways = project.pieces.filter(
    (piece) =>
      !chained.has(piece.name) &&
      swings(piece) &&
      (turned.get(piece.name) ?? 0) < moved &&
      Math.abs(restPosition(project, piece)[0]) >= ON_THE_LINE &&
      (swings(parentOf(piece)) ||
        project.pieces.some(
          (child) => child.parentId === piece.id && swings(child),
        )),
  );
  if (sideways.length > 0) {
    const names = sideways.map((piece) => piece.name).join(", ");
    notes.push(
      t`${names} turn about y or z when the unit moves, and a leg swings about x, so they are not proposed as legs.`,
    );
  }

  const still = project.pieces.every(
    (piece) =>
      isRoot(piece) ||
      ((turned.get(piece.name) ?? 0) < moved &&
        (swung.get(piece.name) ?? 0) < moved &&
        (slid.get(piece.name) ?? 0) < moved),
  );

  const legs: LegProposal[] = [];
  for (const side of ["l", "r"] as const) {
    const ones = found
      .filter((leg) => leg.side === side)
      .sort((a, b) => b.position[2] - a.position[2]);
    const tied = ones.some(
      (leg, i) =>
        i > 0 &&
        Math.abs((ones[i - 1] as LegProposal).position[2] - leg.position[2]) <
          ON_THE_LINE,
    );
    if (tied) {
      const names = ones.map((leg) => leg.chain.thigh).join(", ");
      notes.push(
        t`${names} are legs on the same side at the same distance front to back, so which pair each is in is unknown and none of them is proposed.`,
      );
      continue;
    }
    ones.forEach((leg, i) => {
      legs.push({ ...leg, pair: i + 1 });
    });
  }
  return { legs, notes, chained, still };
}

/** The three roles a leg proposes, top down. */
export function legRoles(
  leg: LegProposal,
): { pieceName: string; role: string }[] {
  return (["thigh", "shin", "foot"] as const).map((segment) => ({
    pieceName: leg.chain[segment],
    role: `leg.${leg.side}${leg.pair}.${segment}`,
  }));
}
