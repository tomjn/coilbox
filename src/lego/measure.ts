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

import { type GuideLine, type GuidePlane, snapToGuides } from "./guides";
import type { LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { pieceBoxes } from "./s3oBuild";
import { nearestSnap, type Vec3 } from "./snapping";

/** Two points in the world that someone measured between. Never saved. */
export interface Measurement {
  id: string;
  from: Vec3;
  to: Vec3;
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

function plural(count: string, one: string, many: string): string {
  return count === "1" ? one : many;
}

/**
 * One length as a count of elmos and a count of steps. Elmos only when the pack
 * has no step to count in.
 */
export function figure(elmos: number, step: number | null): string {
  const e = formatNumber(elmos);
  const inElmos = `${e} ${plural(e, "elmo", "elmos")}`;
  if (step === null) return inElmos;
  const s = formatNumber(elmos / step);
  return `${inElmos}, ${s} ${plural(s, "step", "steps")}`;
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
): { point: Vec3; to: "anchor" | "guide" | null } {
  const anchor = nearestSnap([point], anchors, threshold);
  if (anchor) return { point: anchor.at, to: "anchor" };
  const guides = snapToGuides([point], planes, threshold, lines);
  if (guides.guides.length === 0) return { point, to: null };
  return {
    point: [
      point[0] + guides.delta[0],
      point[1] + guides.delta[1],
      point[2] + guides.delta[2],
    ],
    to: "guide",
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
