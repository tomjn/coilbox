/**
 * A layout's terrain steps drawn on the editor's ground (issue #4793).
 *
 * Each step is drawn simply, as an outline on the ground in the colours the
 * plan thumbnails use (`@/hub/terrainDraw.ts`): raised ground blue, dug or
 * levelled-flat ground grey, a wall as a band 0.6 build squares thick and a
 * ramp as its band with an uphill arrow. What the ground looks like afterwards
 * is not drawn here. That is issue #4794, which replaces {@link stepMarks} and
 * keeps everything else: the keys, the pick meshes and the handles.
 *
 * Everything that can be pointed at carries a `placementKey`, so the shared
 * picking in `useMapEditing` treats a step the way it treats a zone: an
 * overlay whose drags it is told about rather than moving the objects itself.
 *
 * - `terrain:<i>` is the step itself, and dragging it moves the step.
 * - `terrain:<i>:corner:<j>` is a corner of the selected step, and dragging it
 *   reshapes the step.
 * - `terrain:<i>:edge:<j>` is the middle of a side of the selected step. A
 *   click there adds a corner, and a drag adds one where it is let go.
 */

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

import { BUILD_SQUARE } from "@/blueprint/footprint";
import type { TerrainStep } from "@/blueprint/model";
import {
  cornerAdded,
  cornerMoved,
  edgeMiddle,
  movedStep,
  stepEdges,
  type TerrainTool,
} from "@/blueprint/terrainEdit";
import { placeStep, WALL_THICKNESS } from "@/hub/terrainDraw";
import type { MapScene3D } from "@/lib/mapScene";
import type { Point } from "@/scenario/model";
import { worldToScene } from "./scene";
import type { OverlayLayer } from "./useMapEditing";

/** What the steps are drawn under, so the layer can be found as one thing. */
const ROOT_NAME = "blueprint-terrain";

/** How far above the ground a mark is drawn, in elmos, so it is not lost in
 *  the ground it lies on. */
const LIFT_ELMOS = 1;

/** The colours of the plan thumbnails: Tailwind's blue-500 for raised ground
 *  and neutral-400 for everything else. */
const UP_COLOR = 0x3b82f6;
const EVEN_COLOR = 0xa3a3a3;

/** The selected step, and a step being drawn: the lime the build order list
 *  marks the selection with. */
const SELECTED_COLOR = 0xbef264;

/** Line widths in pixels. `Line2` rather than `THREE.Line`, because a driver
 *  ignores `linewidth` on a plain line. */
const LINE_WIDTH = 2;
const SELECTED_LINE_WIDTH = 3;

/** How wide a wall's pick band is, in elmos: wider than the wall is drawn, so a
 *  thin wall can still be taken hold of. */
const WALL_PICK_ELMOS = BUILD_SQUARE * 2;

/** How big a handle is, as a fraction of the view's height. The same size on
 *  screen at any zoom. */
const HANDLE_SIZE = 0.022;
const EDGE_HANDLE_SIZE = 0.016;

/** The keys this layer draws, and what each one names. */
export type TerrainRef =
  | { part: "step"; index: number }
  | { part: "corner"; index: number; at: number }
  | { part: "edge"; index: number; at: number };

export function stepKey(index: number): string {
  return `terrain:${index}`;
}

function partKey(index: number, part: "corner" | "edge", at: number): string {
  return `terrain:${index}:${part}:${at}`;
}

export function parseTerrainKey(key: string | null): TerrainRef | null {
  if (!key) return null;
  const match = /^terrain:(\d+)(?::(corner|edge):(\d+))?$/.exec(key);
  if (!match) return null;
  const index = Number(match[1]);
  if (!match[2]) return { part: "step", index };
  return {
    part: match[2] as "corner" | "edge",
    index,
    at: Number(match[3]),
  };
}

/** A step as a drag would leave it, which is also what the drag lands as. */
export function draggedStep(
  step: TerrainStep,
  ref: TerrainRef,
  delta: Point,
): TerrainStep {
  if (ref.part === "step") return movedStep(step, delta);
  if (ref.part === "corner") return cornerMoved(step, ref.at, delta);
  const middle = edgeMiddle(step, ref.at);
  return cornerAdded(step, ref.at, {
    x: middle.x + delta.x,
    z: middle.z + delta.z,
  });
}

/** A step being drawn with a tool: the points clicked so far and where the
 *  pointer is, both as offsets from the layout's origin. */
export interface TerrainDraft {
  tool: TerrainTool;
  points: Point[];
  hover: Point | null;
}

export interface TerrainView {
  /** Where the layout's offsets are measured from, in map elmos. */
  origin: Point;
  steps: readonly TerrainStep[];
  /** The selected step's index, which gets handles. */
  selected: number | null;
  /** Steps not drawn, which is the ones a playback has not reached. */
  hidden?: ReadonlySet<number>;
  /** Whether a step can be picked at all. Off while a tool is drawing, so a
   *  click on a step adds a point rather than taking hold of it. */
  pickable: boolean;
  draft: TerrainDraft | null;
}

export interface TerrainLayer extends OverlayLayer {
  draw: (view: TerrainView) => void;
  /** The corner of the selected step under a screen point, for the right
   *  click that removes one. */
  cornerAt: (clientX: number, clientY: number) => TerrainRef | null;
  dispose: () => void;
}

export interface TerrainLayerDeps {
  handle: MapScene3D;
  worldWidth: number;
  worldHeight: number;
  groundAt: (pos: Point) => number;
}

/** A disc for the handles, drawn once. */
function discTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#0f172a";
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

/** The band a path is drawn as, `width` elmos across, with square ends, as
 *  triangles in elmos. */
function bandTriangles(points: readonly Point[], width: number): number[] {
  const half = width / 2;
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const along =
      length > 0
        ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length }
        : { x: 1, z: 0 };
    const across = { x: -along.z * half, z: along.x * half };
    const from = { x: a.x - along.x * half, z: a.z - along.z * half };
    const to = { x: b.x + along.x * half, z: b.z + along.z * half };
    const c = [
      { x: from.x + across.x, z: from.z + across.z },
      { x: to.x + across.x, z: to.z + across.z },
      { x: to.x - across.x, z: to.z - across.z },
      { x: from.x - across.x, z: from.z - across.z },
    ];
    for (const at of [0, 1, 2, 0, 2, 3]) out.push(c[at].x, 0, c[at].z);
  }
  return out;
}

/** An outline's fill as triangles in elmos. */
function fillTriangles(points: readonly Point[]): number[] {
  const contour = points.map((p) => new THREE.Vector2(p.x, p.z));
  const out: number[] = [];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    for (const at of [a, b, c]) out.push(points[at].x, 0, points[at].z);
  }
  return out;
}

export function createTerrainLayer(deps: TerrainLayerDeps): TerrainLayer {
  const { handle } = deps;
  const root = new THREE.Group();
  root.name = ROOT_NAME;
  handle.scene.add(root);
  const disc = discTexture();
  const raycaster = new THREE.Raycaster();

  let view: TerrainView | null = null;
  const keys = new Set<string>();
  let owned: { dispose: () => void }[] = [];
  /** The handles of the selected step, for the right click. */
  let corners: THREE.Object3D[] = [];

  /** A point of the layout in scene units, at the ground under it. */
  const sceneAt = (origin: Point, offset: Point): THREE.Vector3 => {
    const world = { x: origin.x + offset.x, z: origin.z + offset.z };
    const at = worldToScene(
      world,
      deps.worldWidth,
      deps.worldHeight,
      handle.scale,
    );
    return new THREE.Vector3(
      at.x,
      (deps.groundAt(world) + LIFT_ELMOS) * handle.scale,
      at.z,
    );
  };

  /** Triangles in elmos, laid on the ground about the layout's origin. */
  const meshOf = (
    origin: Point,
    triangles: number[],
    material: THREE.Material,
  ): THREE.Mesh => {
    const positions = new Float32Array(triangles.length);
    for (let i = 0; i < triangles.length; i += 3) {
      const at = sceneAt(origin, { x: triangles[i], z: triangles[i + 2] });
      positions[i] = at.x;
      positions[i + 1] = at.y;
      positions[i + 2] = at.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    owned.push(geometry);
    return new THREE.Mesh(geometry, material);
  };

  const lineOf = (
    origin: Point,
    points: readonly Point[],
    closed: boolean,
    color: number,
    width: number,
    opacity = 1,
  ): Line2 => {
    const run = closed && points.length > 2 ? [...points, points[0]] : points;
    const geometry = new LineGeometry();
    geometry.setPositions(
      run.flatMap((p) => {
        const at = sceneAt(origin, p);
        return [at.x, at.y, at.z];
      }),
    );
    const viewport = new THREE.Vector2();
    handle.renderer.getSize(viewport);
    const material = new LineMaterial({
      color,
      linewidth: width,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
    });
    material.resolution.copy(viewport);
    owned.push(geometry, material);
    const line = new Line2(geometry, material);
    line.renderOrder = 3;
    return line;
  };

  const fillMaterial = (color: number, opacity: number) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    owned.push(material);
    return material;
  };

  /** A material that is never seen, for the meshes a pointer takes hold of. */
  const pickMaterial = () => {
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      colorWrite: false,
    });
    owned.push(material);
    return material;
  };

  const handleSprite = (
    origin: Point,
    at: Point,
    key: string,
    size: number,
    color: number,
  ): THREE.Sprite => {
    const material = new THREE.SpriteMaterial({
      map: disc,
      color,
      sizeAttenuation: false,
      depthTest: false,
    });
    owned.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(sceneAt(origin, at));
    sprite.scale.set(size, size, 1);
    sprite.renderOrder = 5;
    sprite.userData = { placementKey: key };
    keys.add(key);
    return sprite;
  };

  /**
   * What one step looks like: the part issue #4794 replaces with the ground
   * as the step leaves it.
   */
  const stepMarks = (
    origin: Point,
    step: TerrainStep,
    selected: boolean,
  ): THREE.Object3D[] => {
    const placed = placeStep(step);
    const color = placed.tone === "up" ? UP_COLOR : EVEN_COLOR;
    const filled = placed.tone !== "even";
    const outline = selected ? SELECTED_COLOR : color;
    const width = selected ? SELECTED_LINE_WIDTH : LINE_WIDTH;
    const out: THREE.Object3D[] = [];
    if (step.kind === "ramp" && placed.band) {
      const band = placed.band.map((p) => ({
        x: p.x * BUILD_SQUARE,
        z: p.y * BUILD_SQUARE,
      }));
      out.push(
        meshOf(origin, fillTriangles(band), fillMaterial(color, 0.25)),
        lineOf(origin, band, true, outline, width),
      );
      if (placed.arrow) {
        const [tail, tip, left, right] = placed.arrow.map((p) => ({
          x: p.x * BUILD_SQUARE,
          z: p.y * BUILD_SQUARE,
        }));
        out.push(
          lineOf(origin, [tail, tip], false, outline, width),
          lineOf(origin, [left, tip, right], false, outline, width),
        );
      }
      return out;
    }
    if (step.shape === "wall") {
      out.push(
        meshOf(
          origin,
          bandTriangles(step.points, WALL_THICKNESS * BUILD_SQUARE),
          fillMaterial(color, filled ? 0.75 : 0.5),
        ),
      );
      if (selected) {
        out.push(lineOf(origin, step.points, false, outline, width));
      }
      return out;
    }
    out.push(
      meshOf(
        origin,
        fillTriangles(step.points),
        fillMaterial(color, filled ? 0.25 : 0.08),
      ),
      lineOf(origin, step.points, true, outline, width),
    );
    return out;
  };

  /** What a pointer takes hold of a step by. */
  const stepPick = (origin: Point, step: TerrainStep): THREE.Mesh => {
    const placed = placeStep(step);
    const triangles =
      step.kind === "ramp" && placed.band
        ? fillTriangles(
            placed.band.map((p) => ({
              x: p.x * BUILD_SQUARE,
              z: p.y * BUILD_SQUARE,
            })),
          )
        : step.shape === "wall"
          ? bandTriangles(step.points, WALL_PICK_ELMOS)
          : fillTriangles(step.points);
    return meshOf(origin, triangles, pickMaterial());
  };

  const draftMarks = (origin: Point, draft: TerrainDraft): THREE.Object3D[] => {
    const points = draft.hover ? [...draft.points, draft.hover] : draft.points;
    const out: THREE.Object3D[] = [];
    if (points.length >= 2) {
      const closed = draft.tool === "area" || draft.tool === "smooth";
      out.push(lineOf(origin, points, closed, SELECTED_COLOR, LINE_WIDTH, 0.9));
    }
    draft.points.forEach((p, i) => {
      const sprite = handleSprite(
        origin,
        p,
        `terrain-draft:${i}`,
        EDGE_HANDLE_SIZE,
        SELECTED_COLOR,
      );
      // Drawn, never picked.
      sprite.userData = {};
      out.push(sprite);
    });
    return out;
  };

  const render = (shown: TerrainView, steps: readonly TerrainStep[]) => {
    root.clear();
    for (const spent of owned) spent.dispose();
    owned = [];
    keys.clear();
    corners = [];
    const { origin } = shown;
    steps.forEach((step, index) => {
      if (shown.hidden?.has(index) || step.points.length === 0) return;
      const selected = index === shown.selected;
      const group = new THREE.Group();
      for (const mark of stepMarks(origin, step, selected)) group.add(mark);
      if (shown.pickable) {
        const pick = stepPick(origin, step);
        pick.userData = { placementKey: stepKey(index) };
        keys.add(stepKey(index));
        group.add(pick);
      }
      if (selected && shown.pickable) {
        for (const edge of stepEdges(step)) {
          group.add(
            handleSprite(
              origin,
              edgeMiddle(step, edge),
              partKey(index, "edge", edge),
              EDGE_HANDLE_SIZE,
              SELECTED_COLOR,
            ),
          );
        }
        step.points.forEach((p, at) => {
          const sprite = handleSprite(
            origin,
            p,
            partKey(index, "corner", at),
            HANDLE_SIZE,
            0xffffff,
          );
          corners.push(sprite);
          group.add(sprite);
        });
      }
      root.add(group);
    });
    if (shown.draft) {
      for (const mark of draftMarks(origin, shown.draft)) root.add(mark);
    }
    handle.render();
  };

  return {
    root,
    has: (key) => keys.has(key),
    drag: (key, delta) => {
      const ref = parseTerrainKey(key);
      if (!view || !ref) return;
      const steps = view.steps.map((step, index) =>
        index === ref.index ? draggedStep(step, ref, delta) : step,
      );
      render(view, steps);
    },
    draw: (next) => {
      view = next;
      render(next, next.steps);
    },
    cornerAt: (clientX, clientY) => {
      if (corners.length === 0) return null;
      const rect = handle.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, handle.camera);
      const hit = raycaster.intersectObjects(corners, false)[0];
      const key = hit?.object.userData?.placementKey;
      return typeof key === "string" ? parseTerrainKey(key) : null;
    },
    dispose: () => {
      root.clear();
      for (const spent of owned) spent.dispose();
      owned = [];
      keys.clear();
      disc.dispose();
      root.removeFromParent();
      handle.render();
    },
  };
}
