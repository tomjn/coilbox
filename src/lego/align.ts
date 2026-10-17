/**
 * Aligning and distributing a set of pieces (issue #3320).
 *
 * Each action works out one world-space offset per piece and hands them to
 * `moveEach`, which writes them against each piece's parent. The offsets are
 * measured on boxes in the unit's space, so a piece's rotation, its scale and
 * its parents' do not change what "lowest" means.
 *
 * Pure, so it needs neither a renderer nor a pack: the caller measures the
 * boxes and applies the answer as one group edit.
 */

import {
  applyGroupTransform,
  moveEach,
  type PieceTransform,
  transformRoots,
} from "./groupTransform";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { worldMatrix } from "./reparent";
import { type PieceBox, pieceBoxes } from "./s3oBuild";
import { freeMoved } from "./seat";
import type { Vec3 } from "./snapping";

export type Axis = "x" | "y" | "z";
export type Edge = "low" | "middle" | "high";

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/**
 * The box each piece is lined up by: its measured box, or its own origin when
 * it has no geometry anywhere under it.
 */
export function boxesOrOrigins(
  measured: Map<string, PieceBox>,
  origins: Map<string, Vec3>,
  pieceIds: string[],
): Map<string, PieceBox> {
  const out = new Map<string, PieceBox>();
  for (const id of pieceIds) {
    const box = measured.get(id);
    if (box) {
      out.set(id, box);
      continue;
    }
    const at = origins.get(id);
    if (at) out.set(id, { min: [...at], max: [...at] });
  }
  return out;
}

/** Offsets that put every piece's low, middle or high edge on the set's. */
export function alignOffsets(
  boxes: Map<string, PieceBox>,
  axis: Axis,
  edge: Edge,
): Map<string, Vec3> {
  const a = AXIS_INDEX[axis];
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const box of boxes.values()) {
    low = Math.min(low, box.min[a]);
    high = Math.max(high, box.max[a]);
  }
  const target =
    edge === "low" ? low : edge === "high" ? high : (low + high) / 2;

  const out = new Map<string, Vec3>();
  for (const [id, box] of boxes) {
    const at =
      edge === "low"
        ? box.min[a]
        : edge === "high"
          ? box.max[a]
          : (box.min[a] + box.max[a]) / 2;
    out.set(id, offset(a, target - at));
  }
  return out;
}

/**
 * Offsets that leave equal gaps between neighbouring boxes. The two pieces at
 * the ends, by the middle of their boxes, stay where they are. Fewer than
 * three pieces have nothing to spread.
 */
export function distributeOffsets(
  boxes: Map<string, PieceBox>,
  axis: Axis,
): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  if (boxes.size < 3) return out;
  const a = AXIS_INDEX[axis];

  const ordered = [...boxes].sort(
    ([, p], [, q]) => p.min[a] + p.max[a] - (q.min[a] + q.max[a]),
  );
  const first = ordered[0][1];
  const last = ordered[ordered.length - 1][1];
  let sizes = 0;
  for (const [, box] of ordered) sizes += box.max[a] - box.min[a];
  const gap = (last.max[a] - first.min[a] - sizes) / (ordered.length - 1);

  let cursor = first.max[a] + gap;
  for (const [id, box] of ordered.slice(1, -1)) {
    out.set(id, offset(a, cursor - box.min[a]));
    cursor += box.max[a] - box.min[a] + gap;
  }
  return out;
}

function offset(axis: number, amount: number): Vec3 {
  const out: Vec3 = [0, 0, 0];
  out[axis] = amount;
  return out;
}

/** The offsets as new transforms, leaving out any piece that does not move. */
export function moveByOffsets(
  project: LegoProject,
  offsets: Map<string, Vec3>,
): Map<string, PieceTransform> {
  const moving = new Map(
    [...offsets].filter(([, o]) => o.some((n) => Math.abs(n) > 1e-6)),
  );
  return moveEach(project, moving);
}

export type ArrangeAction =
  | { kind: "align"; axis: Axis; edge: Edge }
  | { kind: "distribute"; axis: Axis };

/**
 * One align or distribute on a selection: the new transforms for the pieces
 * that move, and the names of the joined pieces that moving them frees.
 *
 * A joined piece that moves is freed, as a drag or a typed position frees it.
 * Keeping the join would put it straight back on its face, and a move along
 * the face is a slide, which these actions do not make.
 */
export function arrange(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  selectedIds: string[],
  action: ArrangeAction,
): { changes: Map<string, PieceTransform>; detached: string[] } {
  const roots = transformRoots(project, selectedIds);
  const origins = new Map<string, Vec3>();
  for (const id of roots) {
    const m = worldMatrix(project, id).elements;
    origins.set(id, [m[12], m[13], m[14]]);
  }
  const boxes = boxesOrOrigins(
    pieceBoxes(project, pack, raw, roots),
    origins,
    roots,
  );
  const offsets =
    action.kind === "align"
      ? alignOffsets(boxes, action.axis, action.edge)
      : distributeOffsets(boxes, action.axis);
  const changes = moveByOffsets(project, offsets);

  const freed = freeMoved(project, applyGroupTransform(project, changes));
  const detached = freed.pieces
    .filter(
      (piece) =>
        !piece.connection &&
        project.pieces.find((was) => was.id === piece.id)?.connection,
    )
    .map((piece) => piece.name);
  return { changes, detached };
}
