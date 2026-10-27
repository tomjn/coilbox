/**
 * What the pointer works with on a layout's terrain steps (issue #4793): the
 * meshes a step is taken hold of by, the handles of the selected step, a thin
 * outline saying which one is selected, a red line along each ring of wall
 * with no way out, and the guide for a step being drawn.
 *
 * What a step looks like is not drawn here. That is `terrainLayer.ts` and the
 * relief it lies on (issue #4794). Everything here lies on the ground the
 * steps leave, so a handle sits on top of a raised step.
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

import type { TerrainStep } from "@/blueprint/model";
import {
  cornerAdded,
  cornerMoved,
  edgeMiddle,
  movedStep,
  stepEdges,
  trappingRings,
} from "@/blueprint/terrainEdit";
import type { MapScene3D } from "@/lib/mapScene";
import type { Point } from "@/scenario/model";
import { worldToScene } from "./scene";
import type { OverlayLayer } from "./useMapEditing";

/** What the layer is drawn under, so it can be found as one thing. */
const ROOT_NAME = "blueprint-terrain";

/** How far above the ground a guide is drawn, in elmos, so it is not lost in
 *  the ground (the widget's `M.GROUND_LIFT`). */
const LIFT_ELMOS = 1;

/** The widget's green (`M.COLORS.raise` in `terrain.lua`), for the guide of a
 *  step being drawn and its points. */
const GUIDE_COLOR = new THREE.Color(0, 1, 0);

/** The selected step's outline and corner handles. */
const SELECTED_COLOR = 0xffffff;

/** A ring of wall with no way out (issue #4816), in the widget's red for
 *  what the ground refuses (`blocked` in `model.lua`). */
const TRAP_COLOR = new THREE.Color(1, 0.05, 0.1);

/** How wide a wall is taken hold of, in elmos: the gadget's 5 by 5 corners
 *  round each wall point (`wallSegments` in `@/blueprint/terraform.ts`). */
const WALL_PICK_ELMOS = 32;

/** How big a handle is, as a fraction of the view's height. The same size on
 *  screen at any zoom. */
const HANDLE_SIZE = 0.018;
const EDGE_HANDLE_SIZE = 0.012;

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

/** A step being drawn: the points clicked so far and where the pointer is,
 *  both as offsets from the layout's origin. */
export interface TerrainGuide {
  points: Point[];
  hover: Point | null;
  closed: boolean;
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
  guide: TerrainGuide | null;
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

/** The band a path is taken hold of by, `width` elmos across, as triangles. */
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
    for (const at of [0, 1, 2, 0, 2, 3]) out.push(c[at].x, c[at].z);
  }
  return out;
}

/** An outline's inside as triangles. */
function fillTriangles(points: readonly Point[]): number[] {
  const contour = points.map((p) => new THREE.Vector2(p.x, p.z));
  const out: number[] = [];
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    for (const at of [a, b, c]) out.push(points[at].x, points[at].z);
  }
  return out;
}

/** A ramp's band on the ground, going round. */
function rampBand(step: TerrainStep): Point[] {
  const [from, to] = step.points;
  if (!from || !to) return [];
  const half = (step.width ?? 0) / 2;
  const length = Math.hypot(to.x - from.x, to.z - from.z) || 1;
  const across = {
    x: (-(to.z - from.z) / length) * half,
    z: ((to.x - from.x) / length) * half,
  };
  return [
    { x: from.x + across.x, z: from.z + across.z },
    { x: to.x + across.x, z: to.z + across.z },
    { x: to.x - across.x, z: to.z - across.z },
    { x: from.x - across.x, z: from.z - across.z },
  ];
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

  /** A point of the layout in scene units, on the ground. */
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

  const pickMesh = (origin: Point, flat: number[]) => {
    const positions = new Float32Array((flat.length / 2) * 3);
    for (let i = 0; i < flat.length; i += 2) {
      const at = sceneAt(origin, { x: flat[i], z: flat[i + 1] });
      positions.set([at.x, at.y, at.z], (i / 2) * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      colorWrite: false,
    });
    owned.push(geometry, material);
    return new THREE.Mesh(geometry, material);
  };

  const thinLine = (
    origin: Point,
    points: readonly Point[],
    closed: boolean,
    color: THREE.ColorRepresentation,
  ) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => sceneAt(origin, p)),
    );
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    owned.push(geometry, material);
    const line = closed
      ? new THREE.LineLoop(geometry, material)
      : new THREE.Line(geometry, material);
    line.renderOrder = 4;
    return line;
  };

  const sprite = (
    position: THREE.Vector3,
    map: THREE.Texture,
    width: number,
    height: number,
    color: THREE.ColorRepresentation = 0xffffff,
  ) => {
    const material = new THREE.SpriteMaterial({
      map,
      color,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
    });
    owned.push(material);
    const one = new THREE.Sprite(material);
    one.position.copy(position);
    one.scale.set(width, height, 1);
    one.renderOrder = 6;
    return one;
  };

  const handleSprite = (
    origin: Point,
    at: Point,
    key: string,
    size: number,
    color: THREE.ColorRepresentation,
  ) => {
    const one = sprite(sceneAt(origin, at), disc, size, size, color);
    one.userData = { placementKey: key };
    keys.add(key);
    return one;
  };

  const render = (shown: TerrainView, steps: readonly TerrainStep[]) => {
    root.clear();
    for (const spent of owned) spent.dispose();
    owned = [];
    keys.clear();
    corners = [];
    const { origin } = shown;
    const trapped = new Set(trappingRings(steps));

    steps.forEach((step, index) => {
      if (shown.hidden?.has(index) || step.points.length === 0) return;
      if (trapped.has(index)) {
        root.add(thinLine(origin, step.points, false, TRAP_COLOR));
      }
      const outline = step.kind === "ramp" ? rampBand(step) : step.points;
      if (shown.pickable) {
        const flat =
          step.kind === "ramp"
            ? fillTriangles(outline)
            : step.shape === "wall"
              ? bandTriangles(step.points, WALL_PICK_ELMOS)
              : fillTriangles(step.points);
        const pick = pickMesh(origin, flat);
        pick.userData = { placementKey: stepKey(index) };
        keys.add(stepKey(index));
        root.add(pick);
      }
      if (index !== shown.selected) return;
      root.add(
        thinLine(
          origin,
          outline,
          step.shape === "area" || step.kind === "ramp",
          SELECTED_COLOR,
        ),
      );
      if (!shown.pickable) return;
      for (const edge of stepEdges(step)) {
        root.add(
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
        const one = handleSprite(
          origin,
          p,
          partKey(index, "corner", at),
          HANDLE_SIZE,
          SELECTED_COLOR,
        );
        corners.push(one);
        root.add(one);
      });
    });

    const guide = shown.guide;
    if (guide) {
      const run = guide.hover ? [...guide.points, guide.hover] : guide.points;
      if (run.length >= 2) {
        root.add(thinLine(origin, run, guide.closed, GUIDE_COLOR));
      }
      for (const p of guide.points) {
        root.add(
          sprite(
            sceneAt(origin, p),
            disc,
            EDGE_HANDLE_SIZE,
            EDGE_HANDLE_SIZE,
            GUIDE_COLOR,
          ),
        );
      }
      if (guide.hover) {
        root.add(
          sprite(
            sceneAt(origin, guide.hover),
            disc,
            EDGE_HANDLE_SIZE,
            EDGE_HANDLE_SIZE,
            GUIDE_COLOR,
          ),
        );
      }
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
