/**
 * A terrain step's volume as faces and lines, the way the in-game widget draws
 * its preview (issue #4793).
 *
 * A port of `M.mesh` in `lua/blueprint-widget/luaui/coilbox_blueprints/
 * terrain.lua`, with its colours and grid spacing, so the editor and a match
 * show a step the same way: a see-through prism over the 8 elmo cells the
 * step sets, green over raised ground and red over dug ground, a wire grid
 * every 16 elmos on its top and straight sides, and a cyan grid on the ground
 * it covers. The slopes Zero-K adds round a step are issue #4794's.
 *
 * Plain arithmetic over the corners `stepCorners` in `./terraform.ts` finds,
 * so it can be tested without a GPU.
 */

import type { Target } from "./terraform";

/** The heightmap square and the grid spacing, in elmos. */
const SQUARE = 8;
const GRID = 16;

/** How see-through a face is, 0 to 1 (`M.FACE_ALPHA`). */
export const FACE_ALPHA = 0.18;

/** The widget's colours, red, green, blue and alpha from 0 to 1. */
export const VOLUME_COLORS = {
  raise: [0, 1, 0],
  dig: [1, 0, 0],
  wireRaise: [0, 1, 0, 0.9],
  wireDig: [0.8, 0.4, 0.3, 0.8],
  ground: [0, 0.7, 0.7, 0.6],
} as const;

/** How far above the ground its grid floats, in elmos (`M.GROUND_LIFT`). */
export const GROUND_LIFT = 1;

/** A point in elmos, `y` up. */
export type Vec3 = [number, number, number];

/** Faces as triangles and lines as pairs of points, each list one colour. */
export interface StepMesh {
  /** Over raised ground, drawn with the depth test. */
  faces: Vec3[];
  wire: Vec3[];
  /** Over dug ground, which is under the ground and drawn without it. */
  downFaces: Vec3[];
  downWire: Vec3[];
  /** The cyan grid on the ground. */
  grid: Vec3[];
}

const cornerKey = (x: number, z: number) =>
  `${Math.round(x / SQUARE)},${Math.round(z / SQUARE)}`;

/** Lua's `%`, which floors, so -8 % 16 is 8. */
const mod = (a: number, b: number) => a - Math.floor(a / b) * b;

/**
 * The faces and lines of one step, or null when it has more than `limit`
 * cells, which the widget does not draw either.
 */
export function stepMesh(
  corners: readonly Target[],
  heightAt: (x: number, z: number) => number,
  limit = Number.POSITIVE_INFINITY,
): StepMesh | null {
  const out: StepMesh = {
    faces: [],
    wire: [],
    downFaces: [],
    downWire: [],
    grid: [],
  };
  const at = new Map<string, Target>();
  for (const p of corners) at.set(cornerKey(p.x, p.z), p);
  const cells = new Set<string>();
  const cellList: Target[] = [];
  for (const p of corners) {
    if (
      at.has(cornerKey(p.x + SQUARE, p.z)) &&
      at.has(cornerKey(p.x, p.z + SQUARE)) &&
      at.has(cornerKey(p.x + SQUARE, p.z + SQUARE))
    ) {
      cells.add(cornerKey(p.x, p.z));
      cellList.push(p);
    }
  }
  if (cellList.length > limit) return null;
  const cellAt = (x: number, z: number) => cells.has(cornerKey(x, z));
  const vertical = new Set<string>();
  const quad = (into: Vec3[], a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    into.push(a, b, c, b, d, c);
  };

  for (const p of cellList) {
    const { x, z } = p;
    const c = [
      p,
      at.get(cornerKey(x + SQUARE, z)) as Target,
      at.get(cornerKey(x, z + SQUARE)) as Target,
      at.get(cornerKey(x + SQUARE, z + SQUARE)) as Target,
    ];
    const top = (t: Target): Vec3 => [t.x, t.aim, t.z];
    let mean = 0;
    for (const one of c) mean += (one.aim - heightAt(one.x, one.z)) / 4;
    const up = mean >= 0;
    const raised = Math.abs(mean) >= 0.5;
    if (raised) {
      quad(
        up ? out.faces : out.downFaces,
        top(c[0]),
        top(c[1]),
        top(c[2]),
        top(c[3]),
      );
    }
    const wires = up ? out.wire : out.downWire;
    // Each cell's top and left edges are lines when they lie on a 16 elmo line
    // or have no cell beyond them, and its bottom and right edges only when
    // there is no cell beyond, so a shared edge is drawn once.
    const edge = (i: number, j: number, onLine: boolean, beyond: boolean) => {
      if (!onLine && beyond) return;
      const a = c[i];
      const b = c[j];
      if (raised) wires.push(top(a), top(b));
      out.grid.push(
        [a.x, heightAt(a.x, a.z) + GROUND_LIFT, a.z],
        [b.x, heightAt(b.x, b.z) + GROUND_LIFT, b.z],
      );
    };
    edge(0, 1, mod(z, GRID) === 0, cellAt(x, z - SQUARE));
    edge(0, 2, mod(x, GRID) === 0, cellAt(x - SQUARE, z));
    if (!cellAt(x, z + SQUARE)) edge(2, 3, false, false);
    if (!cellAt(x + SQUARE, z)) edge(1, 3, false, false);

    // The straight sides, down from the top to the ground, where there is no
    // cell beyond, with a vertical line every 16 elmos along them.
    const side = (i: number, j: number, beyond: boolean, axis: "x" | "z") => {
      if (beyond) return;
      const a = c[i];
      const b = c[j];
      const ga = heightAt(a.x, a.z);
      const gb = heightAt(b.x, b.z);
      const sideMean = (a.aim - ga + b.aim - gb) / 2;
      if (Math.abs(sideMean) < 0.5) return;
      const sideUp = sideMean > 0;
      quad(
        sideUp ? out.faces : out.downFaces,
        top(a),
        top(b),
        [a.x, ga, a.z],
        [b.x, gb, b.z],
      );
      for (const [e, g] of [
        [a, ga],
        [b, gb],
      ] as const) {
        const along = axis === "x" ? e.x : e.z;
        const k = cornerKey(e.x, e.z);
        if (mod(along, GRID) === 0 && !vertical.has(k)) {
          vertical.add(k);
          (sideUp ? out.wire : out.downWire).push(top(e), [e.x, g, e.z]);
        }
      }
    };
    side(0, 1, cellAt(x, z - SQUARE), "x");
    side(2, 3, cellAt(x, z + SQUARE), "x");
    side(0, 2, cellAt(x - SQUARE, z), "z");
    side(1, 3, cellAt(x + SQUARE, z), "z");
  }
  return out;
}
