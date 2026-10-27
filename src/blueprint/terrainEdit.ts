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
 * The build order. Steps sit among the buildings by `before`, so the order an
 * author sees is one list: the steps before building 0, building 0, the steps
 * before building 1, and so on, with the steps that come after every building
 * last. Steps with the same `before` go in the order the `terrain` array holds
 * them.
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
  const out: BuildEntry[] = [];
  for (let at = 0; at <= buildings; at++) {
    terrain.forEach((step, index) => {
      if (Math.min(step.before, buildings) === at) {
        out.push({ kind: "step", index });
      }
    });
    if (at < buildings) out.push({ kind: "building", index: at });
  }
  return out;
}

/**
 * A step put at one end of the steps that share its `before`: `first` puts it
 * straight after the building before them, otherwise it goes straight before
 * the building after them. Its index in `terrain` moves with it, so the order
 * of steps that share a `before` is still the array's.
 */
function placedInGroup(
  terrain: readonly TerrainStep[],
  step: TerrainStep,
  first: boolean,
): { terrain: TerrainStep[]; index: number } {
  const out = terrain.slice();
  const sharing = out.flatMap((one, i) =>
    one.before === step.before ? [i] : [],
  );
  let index = 0;
  if (sharing.length > 0) {
    index = first ? sharing[0] : sharing[sharing.length - 1] + 1;
  } else {
    // Nothing shares it, so it goes after every step that comes sooner.
    out.forEach((one, i) => {
      if (one.before < step.before) index = i + 1;
    });
  }
  out.splice(index, 0, step);
  return { terrain: out, index };
}

/** A new step, after the steps already before every building, so it is the
 *  last of them and still before every building. */
export function stepAdded(
  terrain: readonly TerrainStep[],
  step: TerrainStep,
): { terrain: TerrainStep[]; index: number } {
  return placedInGroup(terrain, { ...step, before: 0 }, false);
}

/** The steps after a building is taken out of the layout: each that came
 *  after it keeps its place among the rest. */
export function stepsWithoutBuilding(
  terrain: readonly TerrainStep[],
  building: number,
): TerrainStep[] {
  return terrain.map((step) =>
    step.before > building ? { ...step, before: step.before - 1 } : step,
  );
}

/** One step given a new `before`, at the end of its new group nearest where it
 *  came from. */
function regrouped(
  terrain: readonly TerrainStep[],
  index: number,
  before: number,
  first: boolean,
): { terrain: TerrainStep[]; index: number } {
  const rest = terrain.filter((_, i) => i !== index);
  return placedInGroup(rest, { ...terrain[index], before }, first);
}

/**
 * What moving one place in the build order `delta` places (1 or -1) changes.
 *
 * - `steps`: the new `terrain` when only steps change, which is a step moving
 *   past a building or past another step, or a building moving past a step.
 *   `index` is where the step that moved is now, for keeping it selected.
 * - `buildings`: a building moving past another building, which is the
 *   buildings' own move and leaves the steps where they are.
 * - null at either end of the list.
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
  const sequence = buildSequence(buildings, terrain);
  const at = sequence.findIndex(
    (one) => one.kind === entry.kind && one.index === entry.index,
  );
  const other = sequence[at + delta];
  if (at < 0 || !other) return null;

  if (entry.kind === "building" && other.kind === "building") {
    return { buildings: { index: entry.index, delta } };
  }
  if (entry.kind === "step" && other.kind === "step") {
    // Two steps with the same `before`: their order is the array's.
    const steps = terrain.slice();
    steps[entry.index] = terrain[other.index];
    steps[other.index] = terrain[entry.index];
    return { steps, index: other.index };
  }
  if (entry.kind === "step") {
    // Past a building: up it comes just before it, down just after it.
    const moved =
      delta < 0
        ? regrouped(terrain, entry.index, other.index, false)
        : regrouped(terrain, entry.index, other.index + 1, true);
    return { steps: moved.terrain, index: moved.index };
  }
  // A building past a step moves the step the other way round it.
  const moved =
    delta < 0
      ? regrouped(terrain, other.index, entry.index + 1, true)
      : regrouped(terrain, other.index, entry.index, false);
  return { steps: moved.terrain, index: moved.index };
}
