/**
 * A blueprint's terrain steps as lines on the ground (issue #4794).
 *
 * Each step gets a solid outline round the corners it levelled, and a dashed
 * line round the outer edge of the slope Zero-K adds, so the player can see how
 * much ground a step really takes. The colours are the plan drawings' and the
 * widget's: raised ground blue, anything else grey.
 *
 * `terrainMarks` is the arithmetic and is tested. `createTerrainLayer` is the
 * three.js half, which drapes those lines over whatever relief the ground has.
 */

import * as THREE from "three";

import { SQUARE_SIZE } from "@/blueprint/footprint";
import type { TerrainStep } from "@/blueprint/model";
import {
  type LayoutPlacement,
  placedSteps,
  type StepResult,
} from "@/blueprint/terraform";
import { type TerrainTone, toneOf } from "@/hub/terrainDraw";
import type { MapScene3D } from "@/lib/mapScene";
import type { Point } from "@/scenario/model";
import { worldToScene } from "./scene";

/** Half a corner's square: a corner owns the ground this far round it. */
const HALF = SQUARE_SIZE / 2;

/** One step as lines, in map elmos. */
export interface TerrainMark {
  /** The step's index in the layout's `terrain`. */
  index: number;
  tone: TerrainTone;
  /** Drawn solid. Each is a run of points to join up. */
  solid: Point[][];
  /** Drawn dashed. The outer edge of the slope. */
  dashed: Point[][];
  /** The step is drawn as the author drew it rather than as the ground took it:
   *  switched off, refused, or cancelled. */
  asDrawn: boolean;
}

/**
 * The straight runs round a set of corners.
 *
 * Each corner owns the 8 elmo square centred on it, and the line is the edge of
 * the squares owned, so it follows the ground the step reached corner by corner.
 * Neighbouring edges are joined into one run, so a dashed line reads as dashes
 * and not as a dash for every 8 elmos.
 */
export function boundaryRuns(corners: readonly Point[]): Point[][] {
  const owned = new Set<string>();
  const cell = (x: number, z: number) => `${x},${z}`;
  for (const p of corners) owned.add(cell(p.x, p.z));
  // Edge runs along x, by the z they are at, and along z by the x.
  const along = new Map<string, number[]>();
  const down = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, line: number, from: number) => {
    const key = `${line}`;
    const list = map.get(key);
    if (list) list.push(from);
    else map.set(key, [from]);
  };
  for (const p of corners) {
    const { x, z } = p;
    if (!owned.has(cell(x, z - SQUARE_SIZE))) add(along, z - HALF, x - HALF);
    if (!owned.has(cell(x, z + SQUARE_SIZE))) add(along, z + HALF, x - HALF);
    if (!owned.has(cell(x - SQUARE_SIZE, z))) add(down, x - HALF, z - HALF);
    if (!owned.has(cell(x + SQUARE_SIZE, z))) add(down, x + HALF, z - HALF);
  }
  const runs: Point[][] = [];
  const join = (
    map: Map<string, number[]>,
    point: (line: number, at: number) => Point,
  ) => {
    for (const [key, starts] of map) {
      const line = Number(key);
      starts.sort((a, b) => a - b);
      let from = starts[0];
      let to = from + SQUARE_SIZE;
      for (let i = 1; i < starts.length; i++) {
        if (starts[i] === to) {
          to += SQUARE_SIZE;
          continue;
        }
        runs.push([point(line, from), point(line, to)]);
        from = starts[i];
        to = from + SQUARE_SIZE;
      }
      runs.push([point(line, from), point(line, to)]);
    }
  };
  join(along, (z, x) => ({ x, z }));
  join(down, (x, z) => ({ x, z }));
  return runs;
}

/** A step as its author drew it, on the map: an area's outline closed up, a
 *  wall's path, and the band a ramp covers. */
export function drawnRuns(step: TerrainStep): Point[][] {
  if (step.points.length === 0) return [];
  if (step.kind === "ramp") {
    const [a, b] = step.points;
    if (!a || !b) return [];
    const half = (step.width ?? 0) / 2;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const along =
      length > 0
        ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length }
        : { x: 1, z: 0 };
    const across = { x: -along.z * half, z: along.x * half };
    return [
      [
        { x: a.x + across.x, z: a.z + across.z },
        { x: b.x + across.x, z: b.z + across.z },
        { x: b.x - across.x, z: b.z - across.z },
        { x: a.x - across.x, z: a.z - across.z },
        { x: a.x + across.x, z: a.z + across.z },
      ],
    ];
  }
  return [
    step.shape === "area" ? [...step.points, step.points[0]] : step.points,
  ];
}

/**
 * Every step as the lines to draw for it.
 *
 * `results` are what the ground took, in map elmos, and are absent when the
 * steps are not being applied (the game's terrain switch is off), when every
 * step is drawn as its author drew it. A step the gadget refused or cancelled
 * has no ground of its own and is drawn that way too.
 */
export function terrainMarks(
  steps: readonly TerrainStep[],
  placement: LayoutPlacement,
  results: readonly StepResult[] | null,
): TerrainMark[] {
  const placed = placedSteps(steps, placement);
  return placed.map((step, index) => {
    const result = results?.find((r) => r.index === index);
    const tone = toneOf(step);
    if (result?.outcome !== "built" || result.shape.length === 0) {
      return {
        index,
        tone,
        solid: drawnRuns(step),
        dashed: [],
        asDrawn: true,
      };
    }
    return {
      index,
      tone,
      solid: boundaryRuns(result.shape),
      // Only when the slope has anywhere to be, so a step on ground that
      // already matched it is not drawn twice over.
      dashed:
        result.slope.length > 0
          ? boundaryRuns([...result.shape, ...result.slope])
          : [],
      asDrawn: false,
    };
  });
}

const UP_HEX = 0x3b82f6;
const GREY_HEX = 0xa3a3a3;
const SELECTED_HEX = 0xfbbf24;

/** How far above the ground a line is held, in elmos, so it is not buried in
 *  it. */
const LIFT = 1.5;
/** A dash and the gap after it, in elmos. */
const DASH = 10;
const GAP = 7;

export interface TerrainLayer {
  /** Draw these marks, with one highlighted, replacing what was drawn. `dim`
   *  draws them faintly, for ground that is not being changed. */
  draw: (
    marks: readonly TerrainMark[],
    selected: number | null,
    dim: boolean,
  ) => void;
  dispose: () => void;
}

export function createTerrainLayer(deps: {
  handle: MapScene3D;
  worldWidth: number;
  worldHeight: number;
  /** The ground's height in elmos at a map position, as it stands now. */
  groundAt: () => (pos: Point) => number;
}): TerrainLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  handle.scene.add(root);

  /** One line, held to the ground a point every 8 elmos. Returns positions and
   *  how far along each is, in scene units, for the dashes. */
  const drape = (
    run: readonly Point[],
    groundAt: (pos: Point) => number,
    positions: number[],
    distances: number[],
  ) => {
    let along = 0;
    let last: THREE.Vector3 | null = null;
    const at = (p: Point) => {
      const s = worldToScene(
        p,
        deps.worldWidth,
        deps.worldHeight,
        handle.scale,
      );
      return new THREE.Vector3(s.x, (groundAt(p) + LIFT) * handle.scale, s.z);
    };
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i];
      const b = run[i + 1];
      const pieces = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / SQUARE_SIZE),
      );
      for (let k = 0; k < pieces; k++) {
        const from =
          last ??
          at({
            x: a.x + ((b.x - a.x) * k) / pieces,
            z: a.z + ((b.z - a.z) * k) / pieces,
          });
        const to = at({
          x: a.x + ((b.x - a.x) * (k + 1)) / pieces,
          z: a.z + ((b.z - a.z) * (k + 1)) / pieces,
        });
        positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
        distances.push(along);
        along += from.distanceTo(to);
        distances.push(along);
        last = to;
      }
    }
  };

  const lines = (
    runs: readonly (readonly Point[])[],
    material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
    groundAt: (pos: Point) => number,
    lift: number,
  ): THREE.LineSegments | null => {
    const positions: number[] = [];
    const distances: number[] = [];
    for (const run of runs) drape(run, groundAt, positions, distances);
    if (positions.length === 0) return null;
    if (lift !== 0) {
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] += lift * handle.scale;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "lineDistance",
      new THREE.Float32BufferAttribute(distances, 1),
    );
    const object = new THREE.LineSegments(geometry, material);
    object.renderOrder = 2;
    return object;
  };

  const materials: (THREE.LineBasicMaterial | THREE.LineDashedMaterial)[] = [];
  const clear = () => {
    for (const child of [...root.children]) {
      if (child instanceof THREE.LineSegments) child.geometry.dispose();
      root.remove(child);
    }
    for (const m of materials) m.dispose();
    materials.length = 0;
  };
  const solid = (hex: number, opacity: number) => {
    const m = new THREE.LineBasicMaterial({
      color: hex,
      transparent: true,
      opacity,
      depthTest: false,
    });
    materials.push(m);
    return m;
  };
  const dashed = (hex: number, opacity: number) => {
    const m = new THREE.LineDashedMaterial({
      color: hex,
      transparent: true,
      opacity,
      depthTest: false,
      dashSize: DASH * handle.scale,
      gapSize: GAP * handle.scale,
    });
    materials.push(m);
    return m;
  };

  return {
    draw: (marks, selected, dim) => {
      clear();
      const groundAt = deps.groundAt();
      const faint = dim ? 0.35 : 1;
      for (const mark of marks) {
        const chosen = mark.index === selected;
        const hex = chosen
          ? SELECTED_HEX
          : mark.tone === "up"
            ? UP_HEX
            : GREY_HEX;
        const opacity = chosen ? 1 : mark.asDrawn ? 0.55 * faint : 0.9 * faint;
        const add = (object: THREE.Object3D | null) => {
          if (object) root.add(object);
        };
        add(lines(mark.solid, solid(hex, opacity), groundAt, 0));
        // A second line a little higher, so the selected outline is heavier
        // than a hairline lines can only be.
        if (chosen) add(lines(mark.solid, solid(hex, opacity), groundAt, 0.8));
        add(lines(mark.dashed, dashed(hex, opacity * 0.85), groundAt, 0));
      }
      handle.render();
    },
    dispose: () => {
      clear();
      root.removeFromParent();
    },
  };
}
