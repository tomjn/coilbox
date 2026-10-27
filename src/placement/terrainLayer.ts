/**
 * A blueprint's terrain steps drawn over the ground, in the look of the in-game
 * widget's preview (issue #4794).
 *
 * The widget's own is `lua/blueprint-widget/luaui/coilbox_blueprints/terrain.lua`
 * and this follows it: a see-through green volume over raised ground and a red
 * one over dug ground, a thin wire grid on its top and down its slopes, a thin
 * cyan grid on the ground under the whole area a step touches, slopes included,
 * and a small white height number with a dark shadow. The colours, the alphas,
 * the 16 elmo spacing of the grids and the cap on cells are copied from there.
 * Dug ground is under the terrain, so it is drawn without the depth test.
 *
 * `overlayMesh` is the arithmetic and is tested. `createTerrainLayer` is the
 * three.js half.
 */

import * as THREE from "three";

import { SQUARE_SIZE } from "@/blueprint/footprint";
import type { TerrainStep } from "@/blueprint/model";
import {
  type LayoutPlacement,
  placedSteps,
  type StepResult,
} from "@/blueprint/terraform";
import type { MapScene3D } from "@/lib/mapScene";
import type { Point } from "@/scenario/model";
import { worldToScene } from "./scene";
import type { Relief } from "./terrainRelief";

/** The widget's spacing of its grids, in elmos. */
const GRID = 16;
/** `M.CELL_LIMIT`: a step with more cells than this is not drawn. */
export const CELL_LIMIT = 12000;
/** `M.FACE_ALPHA`, and the selected step's, which is a deeper shade of the
 *  same see-through face. */
const FACE_ALPHA = 0.18;
const SELECTED_FACE_ALPHA = 0.36;
/** `M.GROUND_LIFT`: how far above the ground its grid floats, in elmos. */
const GROUND_LIFT = 1;

/** `M.COLORS`. */
const RAISE = 0x00ff00;
const DIG = 0xff0000;
const WIRE_RAISE = { color: 0x00ff00, alpha: 0.9 };
const WIRE_DIG = { color: 0xcc6644, alpha: 0.8 };
const GROUND_GRID = { color: 0x00b3b3, alpha: 0.6 };

/** One step to draw. */
export interface TerrainMark {
  /** The step's index in the layout's `terrain`. */
  index: number;
  /** What the step says, written beside it: `+112`, `-50`, `ramp 0 to +64`.
   *  Empty for a smooth. */
  label: string;
  /** The corners the ground took from this step, slope included, in map elmos.
   *  Null when the step is not on the ground (the game's terrain switch is off,
   *  or the gadget refused or cancelled it). */
  corners: Point[] | null;
  /** The step as its author drew it, for when it is not on the ground. */
  drawn: Point[][];
}

/** A signed height, as the widget writes one. */
function signed(height: number): string {
  return `${height > 0 ? "+" : ""}${height}`;
}

/** What a step says about itself, as the widget's label does. */
export function stepLabel(step: TerrainStep): string {
  if (step.kind === "ramp") {
    const [from, to] = step.heights ?? [0, 0];
    return `ramp ${signed(from)} to ${signed(to)}`;
  }
  if (step.kind === "smooth") return "";
  return signed(step.height ?? 0);
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
 * Every step as what to draw for it.
 *
 * `results` are what the ground took, in map elmos. They are absent when the
 * steps are not being applied, and then every step is drawn as its author drew
 * it. A step the gadget refused or cancelled has no ground of its own and is
 * drawn that way too.
 */
export function terrainMarks(
  steps: readonly TerrainStep[],
  placement: LayoutPlacement,
  results: readonly StepResult[] | null,
): TerrainMark[] {
  const placed = placedSteps(steps, placement);
  return placed.map((step, index) => {
    const result = results?.find((r) => r.index === index);
    const built = result?.outcome === "built" && result.shape.length > 0;
    return {
      index,
      label: stepLabel(step),
      corners: built ? [...result.shape, ...result.slope] : null,
      drawn: drawnRuns(step),
    };
  });
}

/** The pieces of one step's overlay, as flat `x, y, z` runs in map elmos:
 *  triangles for the faces and pairs of points for the lines. */
export interface OverlayMesh {
  capped: boolean;
  cells: number;
  upFaces: number[];
  upWire: number[];
  downFaces: number[];
  downWire: number[];
  grid: number[];
}

/**
 * The overlay for the corners a step changed, as `M.mesh` in the widget builds
 * it.
 *
 * Every 8 elmo cell with a changed corner is a face at the heights the ground is
 * left at, green when the cell is raised on average and red when it is dug. A
 * cell that moves less than half an elmo on average has no face and no wire.
 * The wire and the grid on the ground go along the cell edges that lie on a 16
 * elmo line, and along the outer edge of the whole area, so a shared edge is
 * drawn once.
 *
 * `heightAt` is the ground now and `baseAt` the ground before any step.
 */
export function overlayMesh(
  corners: readonly Point[],
  heightAt: (x: number, z: number) => number,
  baseAt: (x: number, z: number) => number,
): OverlayMesh {
  const out: OverlayMesh = {
    capped: false,
    cells: 0,
    upFaces: [],
    upWire: [],
    downFaces: [],
    downWire: [],
    grid: [],
  };
  const key = (x: number, z: number) =>
    `${Math.round(x / SQUARE_SIZE)},${Math.round(z / SQUARE_SIZE)}`;
  const changed = new Set<string>();
  for (const p of corners) changed.add(key(p.x, p.z));
  const cells = new Map<string, Point>();
  for (const p of corners) {
    for (const dx of [-SQUARE_SIZE, 0]) {
      for (const dz of [-SQUARE_SIZE, 0]) {
        const cell = { x: p.x + dx, z: p.z + dz };
        cells.set(key(cell.x, cell.z), cell);
      }
    }
  }
  out.cells = cells.size;
  if (cells.size > CELL_LIMIT) {
    out.capped = true;
    return out;
  }
  const top = (x: number, z: number) =>
    changed.has(key(x, z)) ? heightAt(x, z) : baseAt(x, z);
  const has = (cx: number, cz: number) => cells.has(key(cx, cz));

  for (const { x, z } of cells.values()) {
    const at = [
      [x, z],
      [x + SQUARE_SIZE, z],
      [x, z + SQUARE_SIZE],
      [x + SQUARE_SIZE, z + SQUARE_SIZE],
    ];
    const fx = at.map(([cx, cz]) => top(cx, cz));
    const gx = at.map(([cx, cz]) => baseAt(cx, cz));
    let mean = 0;
    for (let i = 0; i < 4; i++) mean += (fx[i] - gx[i]) / 4;
    const up = mean >= 0;
    const shown = Math.abs(mean) >= 0.5;
    if (shown) {
      const faces = up ? out.upFaces : out.downFaces;
      for (const i of [0, 1, 2, 1, 3, 2]) faces.push(at[i][0], fx[i], at[i][1]);
    }
    const wire = up ? out.upWire : out.downWire;
    // A cell's top and left edges are lines when they lie on a 16 elmo line or
    // have no cell beyond them. Its bottom and right edges only when there is no
    // cell beyond.
    const edge = (a: number, b: number, onLine: boolean, beyond: boolean) => {
      if (!onLine && beyond) return;
      if (shown) {
        wire.push(at[a][0], fx[a], at[a][1], at[b][0], fx[b], at[b][1]);
      }
      out.grid.push(
        at[a][0],
        gx[a] + GROUND_LIFT,
        at[a][1],
        at[b][0],
        gx[b] + GROUND_LIFT,
        at[b][1],
      );
    };
    edge(0, 1, z % GRID === 0, has(x, z - SQUARE_SIZE));
    edge(0, 2, x % GRID === 0, has(x - SQUARE_SIZE, z));
    if (!has(x, z + SQUARE_SIZE)) edge(2, 3, false, false);
    if (!has(x + SQUARE_SIZE, z)) edge(1, 3, false, false);
  }
  return out;
}

export interface TerrainLayer {
  /** Draw these marks, with one highlighted, replacing what was drawn before.
   *  `dim` draws them faintly, for steps that are not changing the ground. */
  draw: (
    marks: readonly TerrainMark[],
    selected: number | null,
    dim: boolean,
  ) => void;
  dispose: () => void;
}

/** A height written on a transparent card: white with a dark shadow. */
function labelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0, 0, 0, 0.95)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 128, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    }),
  );
  sprite.renderOrder = 3;
  return sprite;
}

export function createTerrainLayer(deps: {
  handle: MapScene3D;
  worldWidth: number;
  worldHeight: number;
  /** The ground the steps are on, as it stands now. */
  relief: () => Relief | null;
}): TerrainLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  handle.scene.add(root);
  const owned: { dispose(): void }[] = [];

  const clear = () => {
    for (const child of [...root.children]) root.remove(child);
    for (const one of owned) one.dispose();
    owned.length = 0;
  };

  /** Map elmos with a height to scene units. */
  const toScene = (flat: readonly number[]): Float32Array => {
    const out = new Float32Array(flat.length);
    for (let i = 0; i < flat.length; i += 3) {
      const s = worldToScene(
        { x: flat[i], z: flat[i + 2] },
        deps.worldWidth,
        deps.worldHeight,
        handle.scale,
      );
      out[i] = s.x;
      out[i + 1] = flat[i + 1] * handle.scale;
      out[i + 2] = s.z;
    }
    return out;
  };

  const add = (
    flat: readonly number[],
    kind: "faces" | "lines",
    color: number,
    alpha: number,
    depthTest: boolean,
  ) => {
    if (flat.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(toScene(flat), 3),
    );
    owned.push(geometry);
    if (kind === "faces") {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: alpha,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest,
      });
      owned.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      root.add(mesh);
      return;
    }
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: alpha,
      depthWrite: false,
      depthTest,
    });
    owned.push(material);
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 2;
    root.add(lines);
  };

  return {
    draw: (marks, selected, dim) => {
      clear();
      const relief = deps.relief();
      if (!relief) {
        handle.render();
        return;
      }
      const fade = dim ? 0.4 : 1;
      for (const mark of marks) {
        const chosen = mark.index === selected;
        if (mark.corners) {
          const mesh = overlayMesh(
            mark.corners,
            (x, z) => relief.heightAt(x, z),
            (x, z) => relief.baseAt(x, z),
          );
          const face = (chosen ? SELECTED_FACE_ALPHA : FACE_ALPHA) * fade;
          const wire = (a: number) => (chosen ? 1 : a) * fade;
          add(mesh.upFaces, "faces", RAISE, face, true);
          add(mesh.downFaces, "faces", DIG, face, false);
          add(
            mesh.upWire,
            "lines",
            WIRE_RAISE.color,
            wire(WIRE_RAISE.alpha),
            true,
          );
          add(
            mesh.downWire,
            "lines",
            WIRE_DIG.color,
            wire(WIRE_DIG.alpha),
            false,
          );
          add(
            mesh.grid,
            "lines",
            GROUND_GRID.color,
            GROUND_GRID.alpha * fade,
            true,
          );
        } else {
          // Not on the ground: the step as drawn, as thin lines on the ground.
          const flat: number[] = [];
          for (const run of mark.drawn) {
            for (let i = 0; i + 1 < run.length; i++) {
              for (const p of [run[i], run[i + 1]]) {
                flat.push(p.x, relief.heightAt(p.x, p.z) + GROUND_LIFT, p.z);
              }
            }
          }
          add(
            flat,
            "lines",
            GROUND_GRID.color,
            chosen ? 1 : GROUND_GRID.alpha * fade,
            false,
          );
        }
        const list = mark.corners ?? mark.drawn[0] ?? [];
        if (mark.label && list.length > 0) {
          let sumX = 0;
          let sumZ = 0;
          for (const p of list) {
            sumX += p.x;
            sumZ += p.z;
          }
          const centre = { x: sumX / list.length, z: sumZ / list.length };
          const sprite = labelSprite(mark.label);
          const s = worldToScene(
            centre,
            deps.worldWidth,
            deps.worldHeight,
            handle.scale,
          );
          const top = Math.max(
            relief.heightAt(centre.x, centre.z),
            relief.baseAt(centre.x, centre.z),
          );
          sprite.position.set(s.x, (top + 14) * handle.scale, s.z);
          sprite.scale.set(64 * handle.scale, 16 * handle.scale, 1);
          const material = sprite.material;
          material.opacity = fade;
          owned.push(material);
          if (material.map) owned.push(material.map);
          root.add(sprite);
        }
      }
      handle.render();
    },
    dispose: () => {
      clear();
      root.removeFromParent();
    },
  };
}
