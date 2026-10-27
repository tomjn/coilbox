/**
 * A terrain step as outlines on the plan (issue #4795).
 *
 * The website draws the same marks in `lib/gallery/blueprintPreview.ts` in
 * tomjn/coilbox-hub, with the same arithmetic, and the in-game widget's
 * `layoutMap` follows it too, so a step reads the same wherever it is drawn.
 */

import { BUILD_SQUARE } from "@/blueprint/footprint";
import type { PayloadTerrainStep } from "@/blueprint/payload";

/** How thick a wall is drawn, in build squares. A wall has no width in the
 *  payload, only a path, so this is a mark that reads as a wall at any size. */
export const WALL_THICKNESS = 0.6;

/** The size of an uphill arrow's head, in build squares. */
const ARROW_HEAD = 0.8;

/**
 * Which way a step moves the ground, which is all the two shades say. `up` is
 * raised ground, `down` is dug ground, and `even` is a step that moves it
 * neither way: a smooth, or a level of height 0.
 */
export type TerrainTone = "up" | "down" | "even";

/** A point in the box, in build squares from its top left. */
export interface BoxPoint {
  x: number;
  y: number;
}

/** A ramp's arrow as tail, tip and the two ends of the head. */
export type TerrainArrow = [BoxPoint, BoxPoint, BoxPoint, BoxPoint];

/** One terrain step, as outlines in the same box as the squares. */
export interface TerrainDraw {
  kind: PayloadTerrainStep["kind"];
  shape: PayloadTerrainStep["shape"];
  tone: TerrainTone;
  /** An area's outline, or a wall's path. A ramp's two ends. */
  points: BoxPoint[];
  /** A ramp's four corners, going round. Null for every other step. */
  band: BoxPoint[] | null;
  /** Null for every step but a ramp, and for a ramp whose ends are the same
   *  height. */
  arrow: TerrainArrow | null;
}

/** A step in build squares from the layout's origin, before the box is
 *  measured. */
export type PlacedStep = TerrainDraw & {
  /** Ground the mark reaches past its points, for the frame. */
  reach: number;
};

function toneOf(step: PayloadTerrainStep): TerrainTone {
  const height =
    step.kind === "ramp" && step.heights
      ? (step.heights[0] + step.heights[1]) / 2
      : (step.height ?? 0);
  return height > 0 ? "up" : height < 0 ? "down" : "even";
}

export function placeStep(step: PayloadTerrainStep): PlacedStep {
  const points = step.points.map((point) => ({
    x: point.x / BUILD_SQUARE,
    y: point.z / BUILD_SQUARE,
  }));
  const placed: PlacedStep = {
    kind: step.kind,
    shape: step.shape,
    tone: toneOf(step),
    points,
    band: null,
    arrow: null,
    reach: step.shape === "wall" ? WALL_THICKNESS / 2 : 0,
  };
  if (step.kind !== "ramp" || points.length < 2 || !step.heights) {
    return placed;
  }

  // A ramp is a path of two points with a width on the ground, so the band is
  // the line between them pushed out half the width either side.
  const [from, to] = points;
  const half = (step.width ?? 0) / BUILD_SQUARE / 2;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const along =
    length > 0
      ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
      : { x: 1, y: 0 };
  const across = { x: -along.y, y: along.x };
  placed.band = [
    { x: from.x + across.x * half, y: from.y + across.y * half },
    { x: to.x + across.x * half, y: to.y + across.y * half },
    { x: to.x - across.x * half, y: to.y - across.y * half },
    { x: from.x - across.x * half, y: from.y - across.y * half },
  ];
  placed.reach = 0;

  const [low, high] = step.heights;
  if (low !== high) {
    // The arrow runs along the middle of the band towards the higher end,
    // starting and stopping a fifth of the way in so it stays inside the band.
    const uphill = high > low ? 1 : -1;
    const start = uphill === 1 ? from : to;
    const end = uphill === 1 ? to : from;
    const at = (t: number) => ({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
    const tail = at(0.2);
    const tip = at(0.8);
    const head = Math.min(ARROW_HEAD, length * 0.3);
    const back = {
      x: tip.x - along.x * uphill * head,
      y: tip.y - along.y * uphill * head,
    };
    placed.arrow = [
      tail,
      tip,
      { x: back.x + across.x * head * 0.6, y: back.y + across.y * head * 0.6 },
      { x: back.x - across.x * head * 0.6, y: back.y - across.y * head * 0.6 },
    ];
  }
  return placed;
}
