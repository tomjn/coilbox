/**
 * Drawing and reshaping a layout's terrain steps (issue #4793).
 *
 * Arithmetic on plain steps, so the editor's tools can be tested without a GPU.
 * The editor's pointer layer calls these as the author drags, and the shared
 * editing rules in `../lib/scenarioEditing/terrain.ts` call them to change the
 * document, so what is shown during a drag is what lands on release.
 *
 * Every point is an offset from the layout's origin, snapped to the 8 elmo
 * heightmap grid, because that is the grid Zero-K's gadget changes the ground
 * on.
 */

import type { Point } from "../scenario/model";
import type { TerrainStep } from "./model";

/** The heightmap grid, in elmos. */
export const HEIGHTMAP_SQUARE = 8;

/** What each of the four tools draws. */
export type TerrainTool = "wall" | "area" | "ramp" | "smooth";

/**
 * What a new step starts as. A new wall raises the ground it follows and a new
 * area levels it, because those are what most players draw. These are starting
 * values the author changes on the selected step, not limits.
 */
export const NEW_WALL_HEIGHT = 40;
export const NEW_RAMP_WIDTH = 64;
export const NEW_RAMP_RISE = 40;

/** A point on the heightmap grid. */
export function snapPoint(point: Point): Point {
  const snap = (v: number) =>
    Math.round(v / HEIGHTMAP_SQUARE) * HEIGHTMAP_SQUARE + 0;
  return { x: snap(point.x), z: snap(point.z) };
}

/** The fewest points a step of this kind and shape keeps, which is what
 *  removing a corner stops at. */
export function fewestPoints(
  step: Pick<TerrainStep, "kind" | "shape">,
): number {
  if (step.kind === "ramp") return 2;
  return step.shape === "area" ? 3 : 2;
}

/** Whether the points the author has clicked make a step of this tool yet. */
export function enoughPoints(tool: TerrainTool, points: number): boolean {
  if (tool === "wall" || tool === "ramp") return points >= 2;
  return points >= 3;
}

/** A new step from what was drawn with a tool, before every building. */
export function newStep(tool: TerrainTool, points: Point[]): TerrainStep {
  const at = points.map(snapPoint);
  switch (tool) {
    case "wall":
      return {
        kind: "raise",
        shape: "wall",
        points: at,
        height: NEW_WALL_HEIGHT,
        before: 0,
      };
    case "area":
      return { kind: "level", shape: "area", points: at, height: 0, before: 0 };
    case "smooth":
      return { kind: "smooth", shape: "area", points: at, before: 0 };
    case "ramp":
      return {
        kind: "ramp",
        shape: "wall",
        points: at.slice(0, 2),
        heights: [0, NEW_RAMP_RISE],
        width: NEW_RAMP_WIDTH,
        before: 0,
      };
  }
}

/** The four corners of a rectangle dragged from one point to another, going
 *  round, or null when it has no area on the grid. */
export function rectanglePoints(from: Point, to: Point): Point[] | null {
  const a = snapPoint(from);
  const b = snapPoint(to);
  if (a.x === b.x || a.z === b.z) return null;
  return [
    { x: a.x, z: a.z },
    { x: b.x, z: a.z },
    { x: b.x, z: b.z },
    { x: a.x, z: b.z },
  ];
}

/** A step with its points replaced, every other field carried over. */
function withPoints(step: TerrainStep, points: Point[]): TerrainStep {
  return {
    ...step,
    points,
    ...(step.heights ? { heights: [step.heights[0], step.heights[1]] } : {}),
  };
}

/** A step moved by `delta`, snapped to the grid. */
export function movedStep(step: TerrainStep, delta: Point): TerrainStep {
  const by = snapPoint(delta);
  return withPoints(
    step,
    step.points.map((p) => ({ x: p.x + by.x, z: p.z + by.z })),
  );
}

/** A step with one corner moved by `delta`, snapped to the grid. */
export function cornerMoved(
  step: TerrainStep,
  corner: number,
  delta: Point,
): TerrainStep {
  if (!step.points[corner]) return step;
  return withPoints(
    step,
    step.points.map((p, i) =>
      i === corner ? snapPoint({ x: p.x + delta.x, z: p.z + delta.z }) : p,
    ),
  );
}

/**
 * The sides a corner can be added on, as the index of the corner each starts
 * at. An area's last side closes it back to the first corner. A ramp has none,
 * because it is always its two ends.
 */
export function stepEdges(step: TerrainStep): number[] {
  if (step.kind === "ramp") return [];
  const count =
    step.shape === "area" ? step.points.length : step.points.length - 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => i);
}

/** The middle of a side, which is where its handle is drawn. */
export function edgeMiddle(step: TerrainStep, edge: number): Point {
  const a = step.points[edge];
  const b = step.points[(edge + 1) % step.points.length];
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/** A step with a corner added on a side, at `at`, snapped. The step back when
 *  it has no such side. */
export function cornerAdded(
  step: TerrainStep,
  edge: number,
  at: Point,
): TerrainStep {
  if (!stepEdges(step).includes(edge)) return step;
  const points = step.points.slice();
  points.splice(edge + 1, 0, snapPoint(at));
  return withPoints(step, points);
}

/** A step with a corner taken away, or the step back when that would leave
 *  too few to be one. */
export function cornerRemoved(step: TerrainStep, corner: number): TerrainStep {
  if (!step.points[corner]) return step;
  if (step.points.length <= fewestPoints(step)) return step;
  return withPoints(
    step,
    step.points.filter((_, i) => i !== corner),
  );
}

/**
 * A step switched between raising the ground and levelling it. Walls and areas
 * only: a ramp and a smooth have no such choice. The height is kept, so
 * switching back is lossless.
 */
export function withKind(
  step: TerrainStep,
  kind: "raise" | "level",
): TerrainStep {
  if (step.kind !== "raise" && step.kind !== "level") return step;
  if (step.kind === kind) return step;
  return { ...step, kind, height: step.height ?? 0 };
}

/* -------------------------------------------------------------------------- *
 * The build order. A structure cannot be raised or lowered once it is built,
 * so every terrain step comes before every building (issue #4817): the order
 * an author sees is the steps, in the order the `terrain` array holds them,
 * then the buildings. A step read in with a `before` above 0 is shown first
 * all the same, and is written back with 0 the next time the steps change.
 * -------------------------------------------------------------------------- */

/** One place in the build order. */
export type BuildEntry =
  | { kind: "building"; index: number }
  | { kind: "step"; index: number };

/** The build order of a layout with `buildings` buildings and these steps. */
export function buildSequence(
  buildings: number,
  terrain: readonly TerrainStep[],
): BuildEntry[] {
  return [
    ...terrain.map((_, index): BuildEntry => ({ kind: "step", index })),
    ...Array.from(
      { length: buildings },
      (_, index): BuildEntry => ({ kind: "building", index }),
    ),
  ];
}

/** Every step before every building, which is the only place a step goes. */
export function stepsFirst(terrain: readonly TerrainStep[]): TerrainStep[] {
  return terrain.map((step) =>
    step.before === 0 ? step : { ...step, before: 0 },
  );
}

/** A new step, after the steps already there and before every building. */
export function stepAdded(
  terrain: readonly TerrainStep[],
  step: TerrainStep,
): { terrain: TerrainStep[]; index: number } {
  return {
    terrain: [...stepsFirst(terrain), { ...step, before: 0 }],
    index: terrain.length,
  };
}

/**
 * What moving one place in the build order `delta` places (1 or -1) changes,
 * or null when it cannot move that way.
 *
 * - `steps`: two steps swapped, and `index` is where the one that moved is now,
 *   for keeping it selected.
 * - `buildings`: a building moving past another building, which is the
 *   buildings' own move.
 *
 * A step never moves below a building and a building never above a step, so
 * the last step and the first building stop there.
 */
export function movedInSequence(
  buildings: number,
  terrain: readonly TerrainStep[],
  entry: BuildEntry,
  delta: 1 | -1,
):
  | { steps: TerrainStep[]; index: number }
  | { buildings: { index: number; delta: 1 | -1 } }
  | null {
  const to = entry.index + delta;
  if (entry.kind === "building") {
    return to >= 0 && to < buildings
      ? { buildings: { index: entry.index, delta } }
      : null;
  }
  if (to < 0 || to >= terrain.length || !terrain[entry.index]) return null;
  const steps = stepsFirst(terrain);
  steps[entry.index] = steps[to];
  steps[to] = stepsFirst([terrain[entry.index]])[0];
  return { steps, index: to };
}

/** Whether two segments cross or touch. */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) =>
    Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  const between = (p: Point, q: Point, r: Point) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.z, q.z) <= r.z &&
    r.z <= Math.max(p.z, q.z);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  if (d1 !== d2 && d3 !== d4) return true;
  return (
    (d1 === 0 && between(c, d, a)) ||
    (d2 === 0 && between(c, d, b)) ||
    (d3 === 0 && between(a, b, c)) ||
    (d4 === 0 && between(a, b, d))
  );
}

/**
 * The walls that close on themselves with no way out (issue #4816): a wall
 * whose last point is its first, that raises or lowers the ground, and that no
 * ramp crosses. Zero-K's slopes are too steep for most units to climb, so
 * whatever is inside such a ring when it is built stays there. A ring with a
 * gap is not closed. The indexes are into `steps`.
 */
export function trappingRings(steps: readonly TerrainStep[]): number[] {
  const ramps = steps.filter((s) => s.kind === "ramp" && s.points.length >= 2);
  const out: number[] = [];
  steps.forEach((step, index) => {
    const points = step.points;
    const first = points[0];
    const last = points[points.length - 1];
    const closed =
      step.shape === "wall" &&
      (step.kind === "raise" || step.kind === "level") &&
      (step.height ?? 0) !== 0 &&
      points.length >= 4 &&
      first.x === last.x &&
      first.z === last.z;
    if (!closed) return;
    const crossed = ramps.some((ramp) =>
      points
        .slice(1)
        .some((p, i) =>
          segmentsMeet(points[i], p, ramp.points[0], ramp.points[1]),
        ),
    );
    if (!crossed) out.push(index);
  });
  return out;
}
