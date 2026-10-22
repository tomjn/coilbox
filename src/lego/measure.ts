/**
 * The measure tool's arithmetic: the distance between two points, how a figure
 * reads, and where a clicked point lands once it snaps.
 *
 * Every figure is in elmos, because a scene unit is an elmo: the exporter's
 * `header()` in `s3oBuild.ts` writes each vertex's world position straight into
 * the s3o, with no scale between the two. A step is the pack's part unit (see
 * `partUnit` in `pack.ts`), which the manifest states in the same units as a
 * part's `bbox`, so a count of steps is the elmos divided by it.
 */

import { plural } from "@lingui/core/macro";
import { type GuideLine, type GuidePlane, snapToGuides } from "./guides";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { pieceBoxes } from "./s3oBuild";
import { nearestSnap, type Vec3 } from "./snapping";

/**
 * One end of a measurement. An end placed on a piece names the piece and the
 * point in that piece's own space, so it moves, turns and animates with the
 * piece. One on the ground or a guide has `on` null and stays at `at`, which
 * is also where an end placed on a piece was put.
 */
export interface MeasureEnd {
  at: Vec3;
  on: { pieceId: string; local: Vec3 } | null;
}

/** Two ends someone measured between. Never saved. */
export interface Measurement {
  id: string;
  from: MeasureEnd;
  to: MeasureEnd;
}

/** A measurement with both ends where they are now. */
export interface MeasuredLine {
  id: string;
  from: Vec3;
  to: Vec3;
}

/**
 * Where an end is now. An end on a piece is its local point carried through
 * `matrix`, the piece's world matrix in three.js's column-major order. With no
 * matrix, because the piece is gone, it is `last`, the last place it was
 * drawn, else the point it was put at.
 */
export function endPosition(
  end: MeasureEnd,
  matrix: ArrayLike<number> | null,
  last?: Vec3,
): Vec3 {
  if (!end.on) return end.at;
  if (!matrix) return last ?? end.at;
  const [x, y, z] = end.on.local;
  const e = matrix;
  return [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];
}

/** The text on a line and in the readout: its length. */
export function lineLabel(from: Vec3, to: Vec3, step: number | null): string {
  return figure(measureBetween(from, to).length, step);
}

/** The offset from `from` to `to` on each axis, and the straight distance. */
export function measureBetween(
  from: Vec3,
  to: Vec3,
): { delta: Vec3; length: number } {
  const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  return { delta, length: Math.hypot(...delta) };
}

/** A number to three decimals with trailing zeros dropped, and no `-0`. */
export function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(3));
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * One length as a count of elmos and a count of steps. Elmos only when the pack
 * has no step to count in.
 */
export function figure(elmos: number, step: number | null): string {
  const e = formatNumber(elmos);
  const elmoCount = Number(e);
  if (step === null) {
    return plural(elmoCount, { one: `${e} elmo`, other: `${e} elmos` });
  }
  const s = formatNumber(elmos / step);
  const stepCount = Number(s);
  return plural(elmoCount, {
    one: `${e} elmo, ${plural(stepCount, { one: `${s} step`, other: `${s} steps` })}`,
    other: `${e} elmos, ${plural(stepCount, { one: `${s} step`, other: `${s} steps` })}`,
  });
}

/** Three lengths, one per axis, as a line of elmos and a line of steps. */
export function axesText(
  values: Vec3,
  step: number | null,
): { elmos: string; steps: string | null } {
  const row = (scale: number) =>
    (["X", "Y", "Z"] as const)
      .map((axis, i) => `${axis} ${formatNumber(values[i] / scale)}`)
      .join(", ");
  return { elmos: row(1), steps: step === null ? null : row(step) };
}

/**
 * Where a point clicked in the world lands: on the nearest anchor within
 * `threshold`, else on the guides in reach, else where it was clicked.
 *
 * The same order a drag uses (`applySnap`): another piece's anchor first, which
 * fixes all three coordinates, then a guide line and guide planes. The part
 * unit step is left out, because a point on a surface has no reason to sit on
 * a grid.
 */
export function snapMeasurePoint(
  point: Vec3,
  anchors: Vec3[],
  planes: GuidePlane[],
  lines: GuideLine[],
  threshold: number,
): {
  point: Vec3;
  to: "anchor" | "guide" | null;
  /** Which of `anchors` it landed on, when it landed on one. */
  anchorIndex: number | null;
} {
  const anchor = nearestSnap([point], anchors, threshold);
  if (anchor)
    return { point: anchor.at, to: "anchor", anchorIndex: anchor.targetIndex };
  const guides = snapToGuides([point], planes, threshold, lines);
  if (guides.guides.length === 0) return { point, to: null, anchorIndex: null };
  return {
    point: [
      point[0] + guides.delta[0],
      point[1] + guides.delta[1],
      point[2] + guides.delta[2],
    ],
    to: "guide",
    anchorIndex: null,
  };
}

/**
 * How far a piece reaches along each axis, in elmos, with everything under it.
 * Measured off the bake in the unit's space, so a turned or scaled piece, or a
 * parent that is, reads as the file will have it. Null for a piece with no
 * geometry anywhere under it.
 */
export function pieceSize(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  pieceId: string,
): Vec3 | null {
  const box = pieceBoxes(project, pack, raw, [pieceId]).get(pieceId);
  if (!box) return null;
  return [
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  ];
}

/**
 * The piece scaled evenly until its longest side, with everything under it, is
 * a whole number of `step`s, and at least one (#3269). A lifted piece arrives
 * at its game's size, which a pack's part unit does not divide. The signs of
 * the scale stay, so a mirror stays a mirror.
 *
 * The same document when the piece has no geometry, there is no step, or it
 * already fits.
 */
export function fitToSteps(
  project: LegoProject,
  pack: LoadedPack,
  raw: RawGeometry | null,
  pieceId: string,
  step: number,
): LegoProject {
  const size = pieceSize(project, pack, raw, pieceId);
  const longest = size ? Math.max(...size) : 0;
  if (!size || !(step > 0) || !(longest > 0)) return project;
  const factor = (Math.max(1, Math.round(longest / step)) * step) / longest;
  if (Math.abs(factor - 1) < 1e-9) return project;
  return {
    ...project,
    pieces: project.pieces.map((piece) =>
      piece.id === pieceId
        ? {
            ...piece,
            scale: piece.scale.map((s) => s * factor) as Vec3,
          }
        : piece,
    ),
  };
}
